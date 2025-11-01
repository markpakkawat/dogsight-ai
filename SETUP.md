# DogSight Setup Guide

## New Architecture Overview

The new architecture resolves the camera access conflict by using a single camera stream:

```
Camera → Python Detection (YOLOv11) → HTTP Stream → Electron App & Personal Link
```

**Benefits:**
- ✅ No camera lock conflicts
- ✅ Model output visible in both app and personal link
- ✅ Safe zone overlay shown on both streams
- ✅ Can refresh personal link anytime
- ✅ Real-time dog detection with alerts

## Prerequisites

### 1. Python 3.8 or higher
Check your Python version:
```bash
python3 --version
# or on Windows:
python --version
```

### 2. Node.js and npm
```bash
node --version
npm --version
```

### 3. Camera/Webcam
Make sure you have a working camera connected to your computer.

## Installation

### Step 1: Install Python Dependencies

Navigate to the detection directory and install required packages:

```bash
cd app/detection
pip3 install -r requirements.txt
```

**Note:** On first run, YOLOv11 will automatically download the pre-trained model (~6MB).

### Step 2: Install Node.js Dependencies

Install Electron app dependencies:

```bash
cd app
npm install
```

Install frontend dependencies:

```bash
cd app/frontend
npm install
```

### Step 3: Set up Firebase Credentials

The Python detection module needs Firebase credentials to sync safe zones and send alerts.

**Option A: Using service account key (Development)**
1. Download your Firebase service account key from Firebase Console
2. Save it as `app/detection/serviceAccountKey.json`
3. Update `detect.py` to load credentials:
   ```python
   cred = credentials.Certificate('serviceAccountKey.json')
   firebase_admin.initialize_app(cred)
   ```

**Option B: Using default credentials (Production)**
Set the environment variable:
```bash
export GOOGLE_APPLICATION_CREDENTIALS="/path/to/serviceAccountKey.json"
```

## Running the Application

### Method 1: Automatic (Recommended)

The Electron app will automatically start the Python detection server:

```bash
cd app
npm start
```

This will:
1. Start the Electron app
2. Automatically launch the Python detection server (after 2 seconds)
3. Display the live detection feed in the app

### Method 2: Manual (For Development/Debugging)

**Terminal 1 - Python Detection Server:**
```bash
cd app/detection
python3 detect.py
```

You should see:
```
🐶 DogSight Detection Starting...
📦 Loading YOLOv11 model...
✅ YOLOv11 model loaded
📹 Starting camera capture...
✅ Camera opened
🌐 Starting HTTP server on http://localhost:5000
📺 Stream available at: http://localhost:5000/stream
```

**Terminal 2 - Electron App:**
```bash
cd app
npm start
```

## Testing the Detection Stream

### 1. Test in Browser
Open `http://localhost:5000/stream` in your browser to see the processed video feed.

### 2. Health Check
```bash
curl http://localhost:5000/health
```

Expected response:
```json
{
  "status": "ok",
  "model_loaded": true,
  "camera_active": true,
  "safe_zone_defined": false,
  "alert_enabled": false
}
```

## Using the Application

### 1. Pairing with LINE
1. Launch the Electron app
2. Scan the QR code with LINE
3. Complete authentication
4. The app will automatically set your user ID in the detection server

### 2. Setting Up Safe Zone
1. Navigate to the "Safe Zone" section in the app
2. Click on the canvas to place points defining your safe zone (minimum 3 points)
3. Click "Close" to complete the polygon
4. Click "Save" to store the safe zone in Firestore

The safe zone will automatically appear on the live detection feed!

### 3. Enabling Alerts
1. Toggle the "Alert Controls" switch to ON
2. When a dog is detected outside the safe zone, you'll receive a LINE notification
3. Alerts have a 2-minute cooldown to prevent spam

### 4. Sharing Personal Link
Send "WATCH" or "LIVE" via LINE chat to get a shareable link that shows the live detection feed with safe zone overlay.

The link:
- ✅ Shows processed video with detections
- ✅ Shows safe zone overlay
- ✅ Expires after 30 minutes
- ✅ Can be refreshed anytime
- ✅ Works on mobile browsers

## Architecture Details

### Camera → Model Flow
```
1. Python captures camera (cv2.VideoCapture)
2. Each frame is processed through YOLOv11
3. Detections are drawn on frame (bounding boxes)
4. Safe zone polygon is overlaid
5. Dog position is checked against safe zone
6. Alert sent if dog is outside and alerts enabled
7. Processed frame is served via HTTP/MJPEG
```

### Stream → App/Link Flow
```
1. Electron broadcaster.js fetches HTTP stream
2. Draws stream to canvas
3. Captures canvas as MediaStream
4. Sends MediaStream via WebRTC to personal link
5. App displays stream directly via <img> tag
```

## Troubleshooting

### Camera Not Found
```
❌ Failed to open camera
```
**Solution:**
- Check camera permissions
- Make sure no other app is using the camera
- On Linux, ensure you have v4l2 support: `sudo apt-get install v4l-utils`

### Model Download Failed
```
❌ Failed to load model
```
**Solution:**
- Check your internet connection
- YOLOv11 needs to download ~6MB on first run
- Try manually: `python3 -c "from ultralytics import YOLO; YOLO('yolo11n.pt')"`

### Port 5000 Already in Use
```
OSError: [Errno 48] Address already in use
```
**Solution:**
- Kill the existing process: `lsof -ti:5000 | xargs kill -9`
- Or change the port in `detect.py` (line 413): `app.run(host='0.0.0.0', port=5001, ...)`
- Also update broadcaster.js and HomePage.js to use the new port

### Detection Stream Not Showing in App
**Solution:**
1. Check if Python server is running: `curl http://localhost:5000/health`
2. Check browser console for errors
3. Make sure CORS is not blocking the request
4. Try opening the stream directly: `http://localhost:5000/stream`

### WebRTC Personal Link Not Working
**Solution:**
1. Ensure Python detection server is running
2. Check Firebase hosting is deployed
3. Verify watch.html can load the stream
4. Check browser console for WebRTC errors
5. May need TURN server for production (update broadcaster.js)

## Performance Tuning

### If Detection is Too Slow
1. **Use smaller model** (detect.py line 61):
   ```python
   model = YOLO('yolo11n.pt')  # Fastest (current)
   # model = YOLO('yolo11s.pt')  # Small
   # model = YOLO('yolo11m.pt')  # Medium (slower but more accurate)
   ```

2. **Reduce resolution** (detect.py line 284-286):
   ```python
   camera.set(cv2.CAP_PROP_FRAME_WIDTH, 320)  # Lower resolution
   camera.set(cv2.CAP_PROP_FRAME_HEIGHT, 240)
   ```

3. **Skip frames** (detect.py line 323):
   ```python
   time.sleep(0.05)  # Process every 2nd frame
   ```

### If Stream is Laggy
1. **Reduce JPEG quality** (detect.py line 348):
   ```python
   cv2.imencode('.jpg', latest_frame, [cv2.IMWRITE_JPEG_QUALITY, 70])
   ```

2. **Lower frame rate** (detect.py line 359):
   ```python
   time.sleep(0.05)  # ~20 FPS instead of 30
   ```

## Next Steps

1. **Deploy Backend**: Deploy your Firebase functions for production
2. **Setup TURN Server**: For reliable WebRTC in production
3. **Optimize Model**: Fine-tune YOLOv11 on your specific dog breed
4. **Add Features**:
   - Multiple safe zones
   - Recording/playback
   - Activity history
   - Multiple camera support

## Support

For issues or questions, check:
- Python logs in terminal
- Electron logs in app console
- Firebase Functions logs
- Browser console for WebRTC errors
