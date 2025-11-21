#!/usr/bin/env python3
# detect.py - updated to provide stable track IDs, hits, and area in JSON output
# Drop-in replacement for your existing script.

import cv2
import json
import sys
import time
import base64
import torch
import argparse
from pathlib import Path
from ultralytics import YOLO
import threading
import math

# ------------------------------
# Threaded video capture class
# ------------------------------
class VideoStream:
    def __init__(self, src=0, width=640, height=480, fps=30):
        self.src = src
        self.cap = cv2.VideoCapture(src)

        # RTSP-specific optimizations
        if isinstance(src, str) and (src.startswith('rtsp://') or src.startswith('http://')):
            # Reduce buffer to minimize latency for IP cameras
            self.cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
            # Set timeouts for RTSP connections
            self.cap.set(cv2.CAP_PROP_OPEN_TIMEOUT_MSEC, 10000)  # 10 second timeout
            self.cap.set(cv2.CAP_PROP_READ_TIMEOUT_MSEC, 10000)

        # Set resolution and FPS (may not work for all RTSP cameras)
        self.cap.set(cv2.CAP_PROP_FRAME_WIDTH, width)
        self.cap.set(cv2.CAP_PROP_FRAME_HEIGHT, height)
        self.cap.set(cv2.CAP_PROP_FPS, fps)

        # Check if camera opened successfully
        if not self.cap.isOpened():
            raise RuntimeError(f"Failed to open camera source: {src}")

        self.ret, self.frame = self.cap.read()
        if not self.ret or self.frame is None:
            raise RuntimeError(f"Failed to read initial frame from camera source: {src}")

        self.stopped = False
        threading.Thread(target=self.update, daemon=True).start()

    def update(self):
        while not self.stopped:
            self.ret, self.frame = self.cap.read()

    def read(self):
        return self.frame.copy() if self.ret else None

    def stop(self):
        self.stopped = True
        try:
            self.cap.release()
        except:
            pass


# ------------------------------
# Utilities for simple tracker
# ------------------------------
def iou(a, b):
    # a and b are [x1,y1,x2,y2]
    xa1, ya1, xa2, ya2 = a
    xb1, yb1, xb2, yb2 = b
    xi1, yi1 = max(xa1, xb1), max(ya1, yb1)
    xi2, yi2 = min(xa2, xb2), min(ya2, yb2)
    inter_w = max(0.0, xi2 - xi1)
    inter_h = max(0.0, yi2 - yi1)
    inter = inter_w * inter_h
    area_a = max(0.0, xa2 - xa1) * max(0.0, ya2 - ya1)
    area_b = max(0.0, xb2 - xb1) * max(0.0, yb2 - yb1)
    union = area_a + area_b - inter
    return inter / union if union > 0 else 0.0

def ema_smooth(old_bbox, new_bbox, alpha):
    return [old_bbox[i] * (1 - alpha) + new_bbox[i] * alpha for i in range(4)]


# ------------------------------
# Main detection loop
# ------------------------------
def main():
    # Parse command-line arguments
    parser = argparse.ArgumentParser(description='YOLO Dog Detection with RTSP/Webcam support')
    parser.add_argument('--source', default='0',
                       help='Camera source: 0 for default webcam, or RTSP URL (e.g., rtsp://192.168.1.100:554/stream)')
    args = parser.parse_args()

    # Convert source to appropriate type
    if args.source.isdigit():
        camera_source = int(args.source)
    else:
        camera_source = args.source

    print(json.dumps({"status": "startup",
                      "message": f"Python detection script started with source: {camera_source}"}), flush=True)

    # Model path
    script_dir = Path(__file__).parent
    model_path = script_dir / "yolo11s.pt"  # use nano for high FPS if you have it
    device = "cuda:0" if torch.cuda.is_available() else "cpu"

    # Load YOLO model
    try:
        print(json.dumps({"status": "loading_model",
                          "message": "Loading YOLO model..."}), flush=True)
        model = YOLO(str(model_path))
        print(json.dumps({"status": "model_loaded",
                          "path": str(model_path)}), flush=True)
    except Exception as e:
        print(json.dumps({"error": "model_load_failed",
                          "message": str(e)}), flush=True)
        sys.exit(1)

    # Initialize threaded camera
    try:
        vs = VideoStream(src=camera_source, width=640, height=480, fps=30)
        time.sleep(1)  # allow camera to warm up
        print(json.dumps({"status": "camera_ready",
                          "message": f"Camera initialized successfully: {camera_source}"}), flush=True)
    except Exception as e:
        print(json.dumps({"error": "camera_init_failed",
                          "message": f"Failed to initialize camera: {str(e)}"}), flush=True)
        sys.exit(1)

    # Tracker state and parameters
    tracked = []  # list of dicts: {"id": int, "bbox": [x1,y1,x2,y2], "class": ..., "confidence": ..., "age": 0, "hits": n}
    next_track_id = 1  # unique ID counter for new tracks

    # Tunable parameters (adjust to reduce stray/false alerts)
    alpha = 0.6   # EMA smoothing factor (0<alpha<=1). Higher => follow new detections faster.
    iou_match_thresh = 0.3
    max_age = 5   # keep tracked object for up to N frames without matches (helps prevent flicker)
    min_conf_keep = 0.12  # if decayed confidence falls below this, drop track

    # Output filtering options (frontend may also filter)
    min_area_output = 2000.0   # if >0, will not include tiny detections in output (pixels^2)
    min_hits_output = 3     # minimum number of hits before a track appears in output (set higher to reduce one-offs)

    frame_count = 0
    fps_start_time = time.time()
    fps = 0.0
    frame_send_interval = 2  # send every 2nd frame
    detect_interval = 2       # run detection every 2nd frame (you can set to 1 to run every frame)

    try:
        while True:
            frame = vs.read()
            if frame is None:
                # small sleep to avoid tight loop when camera temporarily unavailable
                time.sleep(0.01)
                continue

            frame_count += 1
            raw_detections = []

            # Only run YOLO on every `detect_interval` frames
            if frame_count % detect_interval == 0:
                # Convert BGR->RGB (Ultralytics often expects RGB)
                try:
                    rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
                except Exception:
                    rgb = frame

                # Increase conf or change iou for more stable detections
                # using `conf` and `iou` kwargs (Ultralytics accepts these)
                results = model(rgb, device=device, imgsz=640, conf=0.35, iou=0.45, verbose=False)

                # results may be an iterable of result objects (one per image)
                for result in results:
                    boxes = getattr(result, "boxes", None)
                    if boxes is None:
                        continue
                    # boxes can be an object containing tensors; iterate
                    for box in boxes:
                        try:
                            # box.xyxy: tensor with shape (1,4) or similar; handle gracefully
                            xyxy = box.xyxy[0].tolist() if hasattr(box, "xyxy") else None
                            if not xyxy:
                                continue
                        except Exception:
                            try:
                                xyxy = box.xyxy.tolist()[0]
                            except Exception:
                                continue

                        # class and confidence handling
                        try:
                            cls_id = int(box.cls[0]) if hasattr(box, "cls") else int(box.cls)
                        except Exception:
                            try:
                                cls_id = int(box.cls.tolist()[0])
                            except Exception:
                                cls_id = 0
                        try:
                            confidence = float(box.conf[0]) if hasattr(box, "conf") else float(box.conf)
                        except Exception:
                            try:
                                confidence = float(box.conf.tolist()[0])
                            except Exception:
                                confidence = 0.0

                        # Resolve class name (model.names)
                        class_name = model.names[cls_id] if hasattr(model, "names") and cls_id in model.names else str(cls_id)

                        # filter for dogs only
                        if class_name == "dog":
                            x1, y1, x2, y2 = xyxy
                            raw_detections.append({
                                "class": class_name,
                                "confidence": confidence,
                                "bbox": [float(x1), float(y1), float(x2), float(y2)]
                            })

            # ---------- Simple IoU-based tracker with EMA smoothing ----------
            new_tracked = []
            matched_old = set()

            # Match raw detections to tracked objects
            for det in raw_detections:
                best_iou = 0.0
                best_idx = -1
                for i, t in enumerate(tracked):
                    if t.get("class") != det.get("class"):
                        continue
                    try:
                        iou_val = iou(t["bbox"], det["bbox"])
                    except Exception:
                        iou_val = 0.0
                    if iou_val > best_iou:
                        best_iou = iou_val
                        best_idx = i
                if best_idx != -1 and best_iou >= iou_match_thresh:
                    old = tracked[best_idx]
                    smoothed_bbox = ema_smooth(old["bbox"], det["bbox"], alpha)
                    new_entry = {
                        "id": old.get("id", None),
                        "bbox": smoothed_bbox,
                        "class": det["class"],
                        "confidence": max(det["confidence"], old.get("confidence", 0.0)),
                        "hits": int(old.get("hits", 0) + 1),
                        "age": 0
                    }
                    new_tracked.append(new_entry)
                    matched_old.add(best_idx)
                else:
                    # New detection -> add as new track with a new id
                    new_tracked.append({
                        "id": next_track_id,
                        "bbox": det["bbox"],
                        "class": det["class"],
                        "confidence": det["confidence"],
                        "hits": 1,
                        "age": 0
                    })
                    next_track_id += 1

            # Carry over unmatched old trackers for a few frames (prevents flicker when detection misses)
            for i, t in enumerate(tracked):
                if i not in matched_old:
                    t_copy = dict(t)
                    t_copy["age"] = t_copy.get("age", 0) + 1
                    # decay confidence slightly so that missing tracks eventually disappear
                    t_copy["confidence"] = float(t_copy.get("confidence", 0.0)) * 0.88
                    # preserve id and hits
                    if t_copy["age"] <= max_age and t_copy["confidence"] > min_conf_keep:
                        new_tracked.append(t_copy)

            # update tracked list
            tracked = new_tracked

            # Prepare output detections from tracked list (apply output filters)
            output_detections = []
            for t in tracked:
                x1, y1, x2, y2 = t["bbox"]
                w = max(0.0, x2 - x1)
                h = max(0.0, y2 - y1)
                area = w * h
                # Only include if enough hits and area threshold (tunable)
                if int(t.get("hits", 0)) >= min_hits_output and area >= min_area_output:
                    output_detections.append({
                        "id": int(t.get("id")) if t.get("id") is not None else None,
                        "class": t["class"],
                        "confidence": round(float(t.get("confidence", 0.0)), 3),
                        "hits": int(t.get("hits", 0)),
                        "area": round(area, 1),
                        "bbox": [round(float(x1), 1), round(float(y1), 1), round(float(x2), 1), round(float(y2), 1)]
                    })

            # Calculate FPS every 30 frames (moving window)
            if frame_count % 30 == 0:
                fps_end_time = time.time()
                elapsed = fps_end_time - fps_start_time
                fps = 30 / elapsed if elapsed > 0 else 0.0
                fps_start_time = fps_end_time

            # Encode frame as base64 every `frame_send_interval` frames
            frame_data = None
            if frame_count % frame_send_interval == 0:
                try:
                    _, buffer = cv2.imencode('.jpg', frame, [cv2.IMWRITE_JPEG_QUALITY, 75])
                    frame_data = base64.b64encode(buffer).decode('utf-8')
                except Exception:
                    frame_data = None

            # Output JSON
            output = {
                "frame": frame_count,
                "timestamp": time.time(),
                "detections": output_detections,
                "fps": round(fps, 1),
                "frame_width": frame.shape[1],
                "frame_height": frame.shape[0]
            }
            if frame_data:
                output["frame_data"] = frame_data

            print(json.dumps(output), flush=True)

    except KeyboardInterrupt:
        print(json.dumps({"status": "stopped"}), flush=True)
    except Exception as e:
        print(json.dumps({"error": "runtime_error",
                          "message": str(e)}), flush=True)
    finally:
        try:
            vs.stop()
        except:
            pass
        print(json.dumps({"status": "cleanup_complete"}), flush=True)


if __name__ == "__main__":
    main()
