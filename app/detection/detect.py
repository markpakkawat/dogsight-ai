import cv2
import json
import sys
import time
import base64
import torch
from pathlib import Path
from ultralytics import YOLO
import threading

# ------------------------------
# Threaded video capture class
# ------------------------------


class VideoStream:
    def __init__(self, src=0, width=640, height=480, fps=30):
        self.cap = cv2.VideoCapture(src)
        self.cap.set(cv2.CAP_PROP_FRAME_WIDTH, width)
        self.cap.set(cv2.CAP_PROP_FRAME_HEIGHT, height)
        self.cap.set(cv2.CAP_PROP_FPS, fps)
        self.ret, self.frame = self.cap.read()
        self.stopped = False
        threading.Thread(target=self.update, daemon=True).start()

    def update(self):
        while not self.stopped:
            self.ret, self.frame = self.cap.read()

    def read(self):
        return self.frame.copy() if self.ret else None

    def stop(self):
        self.stopped = True
        self.cap.release()


# ------------------------------
# Main detection loop
# ------------------------------
def main():
    print(json.dumps({"status": "startup",
                      "message": "Python detection script started"}), flush=True)

    # Model path
    script_dir = Path(__file__).parent
    model_path = script_dir / "yolo11m.pt"  # use nano for high FPS
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
    vs = VideoStream(width=640, height=480, fps=30)
    time.sleep(1)  # allow camera to warm up
    print(json.dumps({"status": "camera_ready",
                      "message": "Camera initialized"}), flush=True)

    frame_count = 0
    fps_start_time = time.time()
    fps = 0.0
    frame_send_interval = 2  # send every 2nd frame
    detect_interval = 2       # run detection every 2nd frame

    try:
        while True:
            frame = vs.read()
            if frame is None:
                continue

            frame_count += 1

            detections = []

            # Only run YOLO on every `detect_interval` frames
            if frame_count % detect_interval == 0:
                results = model(frame, device=device, imgsz=416, 
                                verbose=False)  # smaller imgsz for speed
                for result in results:
                    boxes = result.boxes
                    for box in boxes:
                        x1, y1, x2, y2 = box.xyxy[0].tolist()
                        cls_id = int(box.cls[0])
                        confidence = float(box.conf[0])
                        class_name = model.names[cls_id]

                        # filter for dogs only
                        if class_name == "dog":
                            detections.append({
                                "class": class_name,
                                "confidence": round(confidence, 3),
                                "bbox": [round(x1, 1), round(y1, 1), round(x2, 1), round(y2, 1)]
                            })

            # Calculate FPS every 30 frames
            if frame_count % 30 == 0:
                fps_end_time = time.time()
                fps = 30 / (fps_end_time - fps_start_time)
                fps_start_time = fps_end_time

            # Encode frame as base64 every `frame_send_interval` frames
            frame_data = None
            if frame_count % frame_send_interval == 0:
                _, buffer = cv2.imencode(
                    '.jpg', frame, [cv2.IMWRITE_JPEG_QUALITY, 75])
                frame_data = base64.b64encode(buffer).decode('utf-8')

            # Output JSON
            output = {
                "frame": frame_count,
                "timestamp": time.time(),
                "detections": detections,
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
        vs.stop()
        print(json.dumps({"status": "cleanup_complete"}), flush=True)


if __name__ == "__main__":
    main()
