# DogSight AI - Build Instructions

This guide explains how to build and package the DogSight AI application for distribution.

## Prerequisites

- Node.js (v14 or higher)
- Python 3.8+ (for compiling detection script)
- pip (Python package manager)

## Building the Application

### 1. Compile Python Detection Script (Recommended for Distribution)

Compiling the Python script creates a standalone executable that doesn't require users to have Python installed.

#### Windows

```bash
cd app/detection
pip install pyinstaller
pyinstaller --onefile --name detect --distpath . detect.py
```

This creates `app/detection/detect.exe`

**After compilation, move the YOLO model:**
```bash
copy yolo11n.pt detect.exe
```
(The model file must be in the same directory as the executable)

#### macOS

```bash
cd app/detection
pip3 install pyinstaller
pyinstaller --onefile --name detect --distpath . detect.py
```

This creates `app/detection/detect` (executable with no extension)

**After compilation, ensure the YOLO model is in the same directory:**
```bash
cp yolo11n.pt detect
```
(The model file must be in the same directory as the executable)

**Note**: The compiled executable must include the YOLO model file (`yolo11n.pt`) in the same directory.

### 2. Build React Frontend

```bash
cd app/frontend
npm install
npm run build
```

This creates the production build in `app/frontend/build/`

### 3. Package Electron Application

#### Windows Package

```bash
cd app
npm install
npx electron-packager . DogSightAI --platform=win32 --arch=x64 --out=dist --overwrite
```

Output: `app/dist/DogSightAI-win32-x64/`

#### macOS Package

```bash
cd app
npm install
npx electron-packager . DogSightAI --platform=darwin --arch=x64 --out=dist --overwrite
```

For Apple Silicon (M1/M2):
```bash
npx electron-packager . DogSightAI --platform=darwin --arch=arm64 --out=dist --overwrite
```

For both architectures:
```bash
npx electron-packager . DogSightAI --platform=darwin --arch=x64,arm64 --out=dist --overwrite
```

Output: `app/dist/DogSightAI-darwin-x64/DogSightAI.app`

## Full Build Process

Here's the complete build process from start to finish:

```bash
# 1. Compile Python detection script
cd app/detection
pip install pyinstaller
pyinstaller --onefile --name detect --distpath . detect.py
cd ../..

# 2. Build React frontend
cd app/frontend
npm install
npm run build
cd ..

# 3. Package Electron app (Windows example)
npm install
npx electron-packager . DogSightAI --platform=win32 --arch=x64 --out=dist --overwrite
```

## Distribution

### Windows
Zip the entire `app/dist/DogSightAI-win32-x64/` folder and distribute.

### macOS
Zip the `app/dist/DogSightAI-darwin-x64/DogSightAI.app` and distribute.

**Important**: Make sure to include:
- The compiled detection executable (`detect.exe` or `detect`)
- The YOLO model file (`yolo11n.pt`)
- All required dependencies

## Development Mode (Without Compilation)

If you want to run in development mode without compiling the Python script:

```bash
cd app/frontend
npm run build
cd ..
npm start
```

**Requirements**: Python 3 must be installed on the system, with required packages:
```bash
cd app/detection
pip install -r requirements.txt
```

## Troubleshooting

### "spawn python ENOENT" on Mac
- Ensure Python 3 is installed: `which python3`
- Or compile the detection script as described above

### "spawn python ENOENT" on Windows
- Ensure Python is installed and in PATH: `where python`
- Or compile the detection script as described above

### Camera not detected
- Check camera permissions in OS settings
- Ensure no other application is using the camera
- Try running with administrator/sudo privileges

### Model file not found
- Ensure `yolo11n.pt` is in `app/detection/` directory (same location as detect.exe or detect)
- The model file must be in the same directory as the compiled executable

## Notes

- The compiled detection executable is platform-specific (Windows .exe won't run on Mac and vice versa)
- You need to compile the detection script separately for each platform
- The Electron package includes the compiled executable, so end users don't need Python
- For cross-platform builds, build on each platform separately or use CI/CD
