const { app, BrowserWindow, ipcMain } = require("electron");
const { spawn } = require("child_process");
const path = require("path");
const axios = require("axios");

let detectionProcess = null;
let mainWindow = null;

// Function to check if Python detection server is running
async function checkDetectionServer() {
  try {
    const response = await axios.get("http://localhost:5000/health", { timeout: 2000 });
    return response.data.status === "ok";
  } catch (error) {
    return false;
  }
}

// Function to start Python detection server
function startDetectionServer() {
  if (detectionProcess) {
    console.log("⚠️ Detection server already running");
    return;
  }

  const detectPath = path.join(__dirname, "detection", "detect.py");
  console.log("🚀 Starting Python detection server...");

  // Start Python process
  // Use 'python3' on macOS/Linux, 'python' on Windows
  const pythonCmd = process.platform === "win32" ? "python" : "python3";

  detectionProcess = spawn(pythonCmd, [detectPath], {
    cwd: path.join(__dirname, "detection"),
    env: { ...process.env },
  });

  detectionProcess.stdout.on("data", (data) => {
    console.log(`[Detection] ${data.toString().trim()}`);
  });

  detectionProcess.stderr.on("data", (data) => {
    console.error(`[Detection Error] ${data.toString().trim()}`);
  });

  detectionProcess.on("close", (code) => {
    console.log(`🛑 Detection server exited with code ${code}`);
    detectionProcess = null;
  });

  detectionProcess.on("error", (err) => {
    console.error("❌ Failed to start detection server:", err.message);
    detectionProcess = null;
  });
}

// Function to stop Python detection server
function stopDetectionServer() {
  if (detectionProcess) {
    console.log("🛑 Stopping detection server...");
    detectionProcess.kill();
    detectionProcess = null;
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1024,
    height: 768,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const startUrl = path.join(__dirname, "frontend/build/index.html");
  mainWindow.loadURL(`file://${startUrl}`);

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  createWindow();

  // Check if detection server is already running
  const isRunning = await checkDetectionServer();
  if (!isRunning) {
    // Start detection server automatically
    setTimeout(() => {
      startDetectionServer();
    }, 2000); // Wait 2 seconds for app to initialize
  } else {
    console.log("✅ Detection server already running");
  }
});

app.on("window-all-closed", () => {
  stopDetectionServer();
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

app.on("before-quit", () => {
  stopDetectionServer();
});

// IPC handlers
ipcMain.on("paired", (event, userId) => {
  console.log(`✅ User paired: ${userId}`);

  // Set the user ID in the detection server
  if (userId) {
    axios.get(`http://localhost:5000/set-user/${userId}`)
      .then(() => console.log("✅ User ID set in detection server"))
      .catch((err) => console.error("⚠️ Failed to set user ID:", err.message));
  }
});

ipcMain.on("start-detection", () => {
  startDetectionServer();
});

ipcMain.on("stop-detection", () => {
  stopDetectionServer();
});
