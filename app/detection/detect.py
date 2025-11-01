#!/usr/bin/env python3
"""
DogSight Detection Module
Captures camera, runs YOLOv11 detection, overlays safe zone, and streams via HTTP
"""

import cv2
import numpy as np
from flask import Flask, Response
import threading
import time
import os
import sys
from datetime import datetime, timedelta
import firebase_admin
from firebase_admin import credentials, firestore
import requests
from ultralytics import YOLO
from shapely.geometry import Point, Polygon as ShapelyPolygon

# Initialize Flask app
app = Flask(__name__)

# Global variables
camera = None
model = None
latest_frame = None
frame_lock = threading.Lock()
safe_zone_polygon = None
user_id = None
alert_enabled = False
last_alert_time = None
ALERT_COOLDOWN = timedelta(minutes=2)  # Don't spam alerts

# Firebase configuration
firebase_initialized = False

def init_firebase():
    """Initialize Firebase Admin SDK"""
    global firebase_initialized
    if firebase_initialized:
        return

    try:
        # Try to initialize with default credentials (works in production)
        if not firebase_admin._apps:
            firebase_admin.initialize_app()
        firebase_initialized = True
        print("✅ Firebase initialized")
    except Exception as e:
        print(f"⚠️ Firebase init failed: {e}")
        print("   Detection will work, but safe zone sync disabled.")

def load_model():
    """Load YOLOv11 model (downloads pre-trained weights automatically)"""
    global model
    print("📦 Loading YOLOv11 model...")
    try:
        # This will auto-download yolo11n.pt on first run (~6MB, fastest model)
        # Options: yolo11n.pt (nano), yolo11s.pt (small), yolo11m.pt (medium)
        model = YOLO('yolo11n.pt')
        print("✅ YOLOv11 model loaded")
        return True
    except Exception as e:
        print(f"❌ Failed to load model: {e}")
        return False

def fetch_safe_zone(user_id):
    """Fetch safe zone polygon from Firestore"""
    global safe_zone_polygon
    try:
        if not firebase_initialized:
            return None

        db = firestore.client()
        doc_ref = db.collection('safezones').document(user_id)
        doc = doc_ref.get()

        if doc.exists:
            data = doc.to_dict()
            polygon = data.get('polygon', [])
            if polygon and len(polygon) >= 3:
                safe_zone_polygon = polygon
                print(f"✅ Safe zone loaded: {len(polygon)} points")
                return polygon

        print("⚠️ No safe zone defined yet")
        return None
    except Exception as e:
        print(f"⚠️ Error fetching safe zone: {e}")
        return None

def check_alert_status(user_id):
    """Check if alerts are enabled for this user"""
    global alert_enabled
    try:
        if not firebase_initialized:
            return False

        db = firestore.client()
        doc_ref = db.collection('users').document(user_id)
        doc = doc_ref.get()

        if doc.exists:
            data = doc.to_dict()
            alert_enabled = data.get('alertEnabled', False)
            return alert_enabled
        return False
    except Exception as e:
        print(f"⚠️ Error checking alert status: {e}")
        return False

def send_line_alert(user_id, message):
    """Send LINE notification (via Firebase function)"""
    global last_alert_time

    # Check cooldown
    if last_alert_time:
        if datetime.now() - last_alert_time < ALERT_COOLDOWN:
            return

    try:
        # In production, call your Firebase function to send LINE message
        # For now, just log it
        print(f"🚨 ALERT: {message}")
        last_alert_time = datetime.now()

        # TODO: Call your backend to push LINE message
        # requests.post(f"{BACKEND_URL}/send-alert", json={
        #     "userId": user_id,
        #     "message": message
        # })
    except Exception as e:
        print(f"⚠️ Failed to send alert: {e}")

def is_point_in_polygon(point, polygon_normalized, frame_width, frame_height):
    """Check if a point is inside the safe zone polygon"""
    if not polygon_normalized or len(polygon_normalized) < 3:
        return True  # If no safe zone defined, consider everything safe

    try:
        # Convert normalized polygon to pixel coordinates
        polygon_pixels = [(p['x'] * frame_width, p['y'] * frame_height)
                          for p in polygon_normalized]

        # Use shapely for robust point-in-polygon test
        poly = ShapelyPolygon(polygon_pixels)
        pt = Point(point[0], point[1])
        return poly.contains(pt)
    except Exception as e:
        print(f"⚠️ Point-in-polygon error: {e}")
        return True

def draw_safe_zone(frame, polygon_normalized):
    """Draw safe zone polygon on frame"""
    if not polygon_normalized or len(polygon_normalized) < 3:
        return frame

    try:
        h, w = frame.shape[:2]
        # Convert normalized coordinates to pixels
        points = np.array([
            [int(p['x'] * w), int(p['y'] * h)]
            for p in polygon_normalized
        ], dtype=np.int32)

        # Draw filled polygon with transparency
        overlay = frame.copy()
        cv2.fillPoly(overlay, [points], (57, 255, 20))  # Green color
        cv2.addWeighted(overlay, 0.15, frame, 0.85, 0, frame)

        # Draw polygon border
        cv2.polylines(frame, [points], True, (57, 255, 20), 2)

        # Add label
        cv2.putText(frame, "SAFE ZONE", (10, 30),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.7, (57, 255, 20), 2)
    except Exception as e:
        print(f"⚠️ Error drawing safe zone: {e}")

    return frame

def process_frame(frame, skip_detection=False):
    """Process a single frame with YOLOv11 detection"""
    global safe_zone_polygon, alert_enabled

    if model is None:
        return frame

    try:
        # Draw safe zone overlay first (always show it)
        if safe_zone_polygon:
            frame = draw_safe_zone(frame, safe_zone_polygon)

        # Skip heavy detection if requested (for performance)
        if skip_detection:
            return frame

        # Run YOLOv11 detection with smaller input size for speed
        results = model(frame, verbose=False, imgsz=320)  # Smaller input = faster

        # Get frame dimensions
        h, w = frame.shape[:2]

        dog_detected = False
        dog_outside_zone = False

        # Process detections
        for result in results:
            boxes = result.boxes
            for box in boxes:
                # Get class ID and confidence
                cls_id = int(box.cls[0])
                conf = float(box.conf[0])

                # COCO dataset: class 16 is 'dog'
                if cls_id == 16 and conf > 0.5:
                    dog_detected = True

                    # Get bounding box coordinates
                    x1, y1, x2, y2 = map(int, box.xyxy[0])

                    # Calculate center point of bounding box
                    center_x = (x1 + x2) // 2
                    center_y = (y1 + y2) // 2

                    # Check if dog is in safe zone
                    in_safe_zone = is_point_in_polygon(
                        (center_x, center_y),
                        safe_zone_polygon,
                        w, h
                    )

                    if not in_safe_zone:
                        dog_outside_zone = True

                    # Draw bounding box (red if outside zone, green if inside)
                    color = (0, 0, 255) if not in_safe_zone else (0, 255, 0)
                    cv2.rectangle(frame, (x1, y1), (x2, y2), color, 2)

                    # Draw label
                    label = f"Dog {conf:.2f}"
                    if not in_safe_zone:
                        label += " ⚠️ OUTSIDE"

                    (label_w, label_h), _ = cv2.getTextSize(
                        label, cv2.FONT_HERSHEY_SIMPLEX, 0.6, 2
                    )
                    cv2.rectangle(frame, (x1, y1 - label_h - 10),
                                  (x1 + label_w, y1), color, -1)
                    cv2.putText(frame, label, (x1, y1 - 5),
                                cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 2)

                    # Draw center point
                    cv2.circle(frame, (center_x, center_y), 5, color, -1)

        # Send alert if dog is outside zone and alerts are enabled
        if dog_outside_zone and alert_enabled and user_id:
            send_line_alert(user_id, "🚨 Your dog has left the safe zone!")

        # Add status text
        status_y = h - 20
        if dog_detected:
            status_text = "Dog Detected" if not dog_outside_zone else "⚠️ Dog Outside Safe Zone!"
            status_color = (0, 255, 0) if not dog_outside_zone else (0, 0, 255)
            cv2.putText(frame, status_text, (10, status_y),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.7, status_color, 2)

    except Exception as e:
        print(f"⚠️ Error processing frame: {e}")

    return frame

def capture_loop():
    """Main camera capture and processing loop"""
    global camera, latest_frame, user_id

    print("📹 Starting camera capture...")

    # Open camera
    camera = cv2.VideoCapture(0)

    if not camera.isOpened():
        print("❌ Failed to open camera")
        return

    # Set camera properties for better performance
    camera.set(cv2.CAP_PROP_FRAME_WIDTH, 640)
    camera.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)
    camera.set(cv2.CAP_PROP_FPS, 30)

    print("✅ Camera opened")

    # Fetch safe zone periodically
    last_zone_fetch = time.time()
    last_alert_check = time.time()
    ZONE_FETCH_INTERVAL = 10  # seconds
    ALERT_CHECK_INTERVAL = 5  # seconds

    frame_count = 0
    DETECTION_SKIP = 3  # Only run detection every 3rd frame for performance

    while True:
        try:
            ret, frame = camera.read()

            if not ret:
                print("⚠️ Failed to read frame")
                time.sleep(0.1)
                continue

            frame_count += 1

            # Periodically fetch safe zone and alert status
            current_time = time.time()
            if current_time - last_zone_fetch > ZONE_FETCH_INTERVAL and user_id:
                fetch_safe_zone(user_id)
                last_zone_fetch = current_time

            if current_time - last_alert_check > ALERT_CHECK_INTERVAL and user_id:
                check_alert_status(user_id)
                last_alert_check = current_time

            # Run full detection only every Nth frame for better performance
            skip_detection = (frame_count % DETECTION_SKIP != 0)
            processed_frame = process_frame(frame, skip_detection=skip_detection)

            # Update latest frame
            with frame_lock:
                latest_frame = processed_frame.copy()

            # Small delay to prevent CPU overload
            time.sleep(0.01)

        except KeyboardInterrupt:
            break
        except Exception as e:
            print(f"⚠️ Error in capture loop: {e}")
            time.sleep(0.1)

    # Cleanup
    if camera:
        camera.release()
    print("📹 Camera released")

def generate_frames():
    """Generator function for MJPEG stream"""
    global latest_frame

    while True:
        with frame_lock:
            if latest_frame is None:
                time.sleep(0.1)
                continue

            # Encode frame as JPEG with lower quality for better streaming
            ret, buffer = cv2.imencode('.jpg', latest_frame,
                                       [cv2.IMWRITE_JPEG_QUALITY, 75])

            if not ret:
                continue

            frame_bytes = buffer.tobytes()

        # Yield frame in MJPEG format
        yield (b'--frame\r\n'
               b'Content-Type: image/jpeg\r\n\r\n' + frame_bytes + b'\r\n')

        time.sleep(0.05)  # ~20 FPS for smoother streaming

@app.route('/stream')
def video_stream():
    """HTTP endpoint for video stream"""
    return Response(generate_frames(),
                    mimetype='multipart/x-mixed-replace; boundary=frame')

@app.route('/health')
def health():
    """Health check endpoint"""
    return {
        'status': 'ok',
        'model_loaded': model is not None,
        'camera_active': camera is not None and camera.isOpened(),
        'safe_zone_defined': safe_zone_polygon is not None,
        'alert_enabled': alert_enabled
    }

@app.route('/set-user/<uid>')
def set_user(uid):
    """Set the user ID for this detection instance"""
    global user_id
    user_id = uid
    print(f"👤 User ID set to: {uid}")

    # Immediately fetch safe zone and alert status
    if firebase_initialized:
        fetch_safe_zone(user_id)
        check_alert_status(user_id)

    return {'status': 'ok', 'userId': uid}

def main():
    """Main entry point"""
    print("🐶 DogSight Detection Starting...")

    # Initialize Firebase
    init_firebase()

    # Load YOLOv11 model
    if not load_model():
        print("❌ Failed to load model, exiting...")
        sys.exit(1)

    # Start camera capture in background thread
    capture_thread = threading.Thread(target=capture_loop, daemon=True)
    capture_thread.start()

    # Give camera time to initialize
    time.sleep(2)

    # Start Flask server
    print("🌐 Starting HTTP server on http://localhost:5000")
    print("📺 Stream available at: http://localhost:5000/stream")
    app.run(host='0.0.0.0', port=5000, threaded=True, debug=False)

if __name__ == '__main__':
    main()
