# DogSight AI

A real-time AI-powered dog monitoring application that uses computer vision to detect and track dogs through webcam. The application can monitor designated safe zones and send LINE notifications when your dog wanders outside the safe area or disappears from view.

## Features

- **Real-time Dog Detection**: Uses YOLO11 AI model for accurate dog detection and tracking
- **Safe Zone Monitoring**: Define custom safe zones and receive alerts when your dog leaves the area
- **LINE Integration**: Automatic notifications via LINE Messaging API when alerts are triggered
- **Cross-Platform Desktop App**: Built with Electron, runs on Windows and macOS
- **Live Video Feed**: Real-time video display with bounding boxes around detected dogs
- **Device Pairing**: Secure pairing system using LINE Login for alert management

## Downloads

Pre-built binaries are available on the [Releases page](https://github.com/markpakkawat/dogsight-ai/releases).

- **Windows**: [DogSightAI-win32-x64.zip](https://github.com/markpakkawat/dogsight-ai/releases/download/v1.0.0/DogSightAI-win32-x64.zip)


## Technology Stack

### Frontend
- React.js
- Electron (Desktop application framework)
- HTML5 Canvas for video rendering

### Backend
- Firebase (Firestore & Cloud Functions)
- Node.js/Express
- LINE Messaging API
- LINE Login API

### AI Detection
- Python 3.8+
- YOLO11 (Ultralytics)
- OpenCV (cv2)
- PyTorch

## Project Structure

```
dogsight-ai/
├── app/                    # Electron desktop application
│   ├── frontend/          # React frontend
│   ├── detection/         # Python YOLO detection script
│   ├── main.js           # Electron main process
│   └── preload.js        # Electron preload script
├── backend/              # Firebase backend
│   ├── functions/        # Cloud Functions
│   └── firebase.json     # Firebase configuration
├── BUILD.md             # Detailed build instructions
```

## Prerequisites

### For Development
- Node.js v14 or higher
- Python 3.8+
- pip (Python package manager)
- Firebase account (for backend features)
- LINE Developer account (for notifications)

### For Running Pre-built App
- No dependencies required (Python is bundled in the packaged app)

## Quick Start

### 1. Clone the Repository

```bash
git clone https://github.com/markpakkawat/dogsight-ai.git
cd dogsight-ai
```

### 2. Install Python Dependencies (Development Mode)

```bash
cd app/detection
pip install -r requirements.txt
cd ../..
```

### 3. Build the Frontend

```bash
cd app/frontend
npm install
npm run build
cd ..
```

### 4. Run the Application

```bash
cd app
npm install
npm start
```
## Configuration

### Firebase Setup

1. Create a Firebase project at [Firebase Console](https://console.firebase.google.com/)
2. Enable Firestore Database
3. Create a collection `settings` with document `alerts`:
   - Field: `alertEnabled` (boolean)
4. Generate a service account private key and save as `serviceAccountKey.json` in `/backend`

### Backend .env

Create a `.env` file in `/backend/functions`:
```env
# LINE Messaging API (for sending alerts)
LINE_CHANNEL_ACCESS_TOKEN=your_channel_access_token
LINE_USER_ID=your_line_user_id

# LINE Login API (for device pairing)
CHANNEL_ID=your_channel_id
CHANNEL_SECRET=your_channel_secret
CALLBACK_URL=your_callback_url

# Firebase (if needed)
GOOGLE_APPLICATION_CREDENTIALS=/path/to/serviceAccountKey.json
```
### Frontend .env

create a `.env` file in `app/frontend/`:
```env
# Firebase Configuration (if frontend connects directly to Firebase)
REACT_APP_FIREBASE_API_KEY=your_api_key
REACT_APP_FIREBASE_AUTH_DOMAIN=your_project_id.firebaseapp.com
REACT_APP_FIREBASE_PROJECT_ID=your_project_id
REACT_APP_FIREBASE_STORAGE_BUCKET=your_project_id.appspot.com
REACT_APP_FIREBASE_MESSAGING_SENDER_ID=your_sender_id
REACT_APP_FIREBASE_APP_ID=your_app_id

# Backend API URL (if applicable)
REACT_APP_API_URL=http://localhost:5001
```


## Building for Distribution

For detailed build instructions including Python script compilation and platform-specific packaging, see [BUILD.md](BUILD.md).

### Quick Build (Windows)

```bash
# 1. Compile Python detection script
cd app/detection
pip install pyinstaller
pyinstaller --onefile --name detect --distpath . detect.py

# 2. Build frontend
cd ../frontend
npm install
npm run build

# 3. Package Electron app
cd ..
npm install
npx electron-packager . DogSightAI --platform=win32 --arch=x64 --out=dist --overwrite
```


## How It Works

1. **Detection**: The Python script (`detect.py`) captures video frames and runs YOLO11 object detection to identify dogs
2. **Tracking**: Uses IoU (Intersection over Union) based tracking with exponential moving average (EMA) smoothing for stable tracking
3. **Monitoring**: The Electron app monitors dog positions relative to user-defined safe zones
4. **Alerts**: When a dog leaves the safe zone or disappears, the app triggers alerts via LINE messaging
5. **Visualization**: Real-time video feed displays bounding boxes, confidence scores, and tracking IDs

## Features in Detail

### Safe Zone Definition
- Draw custom polygonal safe zones on the video feed
- Multiple points to define irregular shapes
- Visual feedback with zone overlay

### Alert System
Two types of alerts:
- **Wandering Alert**: Dog detected outside the safe zone
- **Disappearance Alert**: Dog not detected for extended period

### Detection Parameters
Configurable in `detect.py`:
- `min_area_output`: Minimum detection area (pixels²)
- `min_hits_output`: Minimum consecutive detections before tracking
- `iou_match_thresh`: IoU threshold for matching detections
- `max_age`: Frames to keep unmatched tracks
- `alpha`: EMA smoothing factor

## Development

### Running in Development Mode

```bash
# Terminal 1: Run React dev server (optional)
cd app/frontend
npm start

# Terminal 2: Run Electron
cd app
npm start
```

### Testing Firebase Functions Locally

```bash
cd backend
firebase emulators:start --only functions
```

### Using ngrok for Webhook Testing

```bash
ngrok http 3000
# Update LINE webhook URL with ngrok URL
```

## Troubleshooting

### Camera Issues

**"spawn python ENOENT" error**:
- Ensure Python 3 is installed and in PATH
- Or compile the detection script (see [BUILD.md](BUILD.md))

**Camera not detected**:
- Check OS camera permissions
- Ensure no other app is using the camera
- Try running with administrator/sudo privileges

### Model Issues

**Model file not found**:
- Ensure `yolo11s.pt` is in `app/detection/` directory
- Download from [Ultralytics YOLO](https://github.com/ultralytics/ultralytics) if missing

### LINE Integration Issues

- Verify webhook URL is accessible (use ngrok for local testing)
- Check LINE channel access token validity
- Ensure callback URL matches LINE Login settings

## API Endpoints

### Backend Cloud Functions

- `POST /dog-event`: Simulate dog detection events (testing)
- `GET /api/pair`: Initiate device pairing via LINE Login
- `GET /api/pair/callback`: LINE Login callback handler

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

This project is licensed under the ISC License.

## Acknowledgments

- [Ultralytics YOLO](https://github.com/ultralytics/ultralytics) for the object detection model
- [Electron](https://www.electronjs.org/) for the desktop application framework
- [Firebase](https://firebase.google.com/) for backend services
- [LINE Messaging API](https://developers.line.biz/) for notification system

## Support

For issues and questions, please open an issue in the GitHub repository.
