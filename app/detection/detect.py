import cv2
import json
import sys
import time
import base64
from pathlib import Path
from ultralytics import YOLO

def main():
    # Get the directory where this script is located
    script_dir = Path(__file__).parent
    model_path = script_dir / "yolo11n.pt"

    # Load YOLO11 model
    try:
        model = YOLO(str(model_path))
        print(json.dumps({"status": "model_loaded", "path": str(model_path)}), flush=True)
    except Exception as e:
        print(json.dumps({"error": "model_load_failed", "message": str(e)}), flush=True)
        sys.exit(1)

    # Initialize camera (0 = default camera)
    cap = cv2.VideoCapture(0)

    if not cap.isOpened():
        print(json.dumps({"error": "camera_failed", "message": "Could not open camera"}), flush=True)
        sys.exit(1)

    # Set camera properties for better performance
    cap.set(cv2.CAP_PROP_FRAME_WIDTH, 640)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)
    cap.set(cv2.CAP_PROP_FPS, 30)

    print(json.dumps({"status": "camera_opened"}), flush=True)

    frame_count = 0
    fps_start_time = time.time()
    fps = 0.0
    frame_send_interval = 2  # Send every 2nd frame to reduce IPC overhead

    try:
        while True:
            ret, frame = cap.read()

            if not ret:
                print(json.dumps({"error": "frame_read_failed"}), flush=True)
                break

            # Run YOLO detection
            results = model(frame, verbose=False)

            # Process detections
            detections = []
            for result in results:
                boxes = result.boxes
                for box in boxes:
                    # Get box coordinates (xyxy format)
                    x1, y1, x2, y2 = box.xyxy[0].tolist()

                    # Get class and confidence
                    cls_id = int(box.cls[0])
                    confidence = float(box.conf[0])
                    class_name = model.names[cls_id]

                    # Filter for dogs only (class 16 in COCO dataset)
                    if class_name == "dog":
                        detections.append({
                            "class": class_name,
                            "confidence": round(confidence, 3),
                            "bbox": [round(x1, 1), round(y1, 1), round(x2, 1), round(y2, 1)]
                        })

            # Calculate FPS
            frame_count += 1
            if frame_count % 30 == 0:
                fps_end_time = time.time()
                fps = 30 / (fps_end_time - fps_start_time)
                fps_start_time = fps_end_time

            # Encode frame as base64 JPEG (send every Nth frame to reduce overhead)
            frame_data = None
            if frame_count % frame_send_interval == 0:
                # Encode frame as JPEG with quality 75 (balance between size and quality)
                _, buffer = cv2.imencode('.jpg', frame, [cv2.IMWRITE_JPEG_QUALITY, 75])
                # Convert to base64 string
                frame_data = base64.b64encode(buffer).decode('utf-8')

            # Output detection result as JSON
            output = {
                "frame": frame_count,
                "timestamp": time.time(),
                "detections": detections,
                "fps": round(fps, 1),
                "frame_width": frame.shape[1],
                "frame_height": frame.shape[0]
            }

            # Only include frame_data when available
            if frame_data:
                output["frame_data"] = frame_data

            print(json.dumps(output), flush=True)

            # Small delay to prevent overwhelming the output
            time.sleep(0.01)

    except KeyboardInterrupt:
        print(json.dumps({"status": "stopped"}), flush=True)
    except Exception as e:
        print(json.dumps({"error": "runtime_error", "message": str(e)}), flush=True)
    finally:
        cap.release()
        print(json.dumps({"status": "cleanup_complete"}), flush=True)

if __name__ == "__main__":
    main()
