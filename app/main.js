const { app, BrowserWindow, ipcMain } = require("electron");
const { fork, execFile, spawn } = require("child_process");
const path = require("path");

let detectionProcess = null;
let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const startUrl = path.join(__dirname, "frontend/build/index.html");
  mainWindow.loadURL(`file://${startUrl}`);
}

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

// Detection process management
function startDetection() {
  if (detectionProcess) {
    console.log("⚠️ Detection already running");
    return;
  }

  // Check if we should use .exe or .py
  const detectExePath = path.join(__dirname, "detection", "dist", "detect.exe");
  const detectPyPath = path.join(__dirname, "detection", "detect.py");
  const fs = require("fs");

  let detectionArgs = [];
  let detectionCommand = "";

  // Try to use .exe first, fall back to Python
  if (fs.existsSync(detectExePath)) {
    detectionCommand = detectExePath;
    console.log("🐶 Using compiled detection executable");
  } else if (fs.existsSync(detectPyPath)) {
    detectionCommand = "python";
    detectionArgs = [detectPyPath];
    console.log("🐶 Using Python script for detection");
  } else {
    console.error("⚠️ Detection script not found");
    if (mainWindow) {
      mainWindow.webContents.send("detection-error", {
        error: "detection_not_found",
        message: "Detection script not found",
      });
    }
    return;
  }

  try {
    detectionProcess = spawn(detectionCommand, detectionArgs);

    console.log("🐶 Detection process started");

    // Handle stdout (detection results)
    detectionProcess.stdout.on("data", (data) => {
      const lines = data.toString().split("\n");
      lines.forEach((line) => {
        if (line.trim()) {
          try {
            const result = JSON.parse(line);
            // Send detection result to renderer
            if (mainWindow) {
              mainWindow.webContents.send("detection-result", result);
            }
          } catch (err) {
            console.error("⚠️ Failed to parse detection output:", line);
          }
        }
      });
    });

    // Handle stderr (errors and logs)
    detectionProcess.stderr.on("data", (data) => {
      console.error("🐶 Detection stderr:", data.toString());
    });

    // Handle process exit
    detectionProcess.on("exit", (code) => {
      console.log(`🐶 Detection process exited with code ${code}`);
      detectionProcess = null;
      if (mainWindow) {
        mainWindow.webContents.send("detection-stopped", { code });
      }
    });

    // Handle process errors
    detectionProcess.on("error", (err) => {
      console.error("⚠️ Detection process error:", err);
      detectionProcess = null;
      if (mainWindow) {
        mainWindow.webContents.send("detection-error", {
          error: "process_error",
          message: err.message,
        });
      }
    });
  } catch (err) {
    console.error("⚠️ Failed to start detection:", err);
    detectionProcess = null;
  }
}

function stopDetection() {
  if (detectionProcess) {
    console.log("🐶 Stopping detection process");
    detectionProcess.kill();
    detectionProcess = null;
  }
}

// IPC Handlers
ipcMain.on("paired", () => {
  console.log("✅ Device paired, starting detection");
  startDetection();
});

ipcMain.on("start-detection", () => {
  console.log("▶️ Start detection requested");
  startDetection();
});

ipcMain.on("stop-detection", () => {
  console.log("⏹️ Stop detection requested");
  stopDetection();
});

// Cleanup on app quit
app.on("before-quit", () => {
  stopDetection();
});
