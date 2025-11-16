const { app, BrowserWindow, ipcMain } = require("electron");
const { fork, execFile, spawn } = require("child_process");
const path = require("path");

let detectionProcess = null;
let mainWindow = null;
let pythonErrorReceived = false; // Track if Python sent a specific error

// Helper function to safely send messages to renderer
function safelySendToRenderer(channel, data) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, data);
  }
}

// Alert monitoring state
let alertMonitor = {
  enabled: false,
  deviceId: null,
  lineUserId: null,

  // Separate tracking for two scenarios
  lastSeenInZoneTime: null,      // Last time dog was IN safe zone
  lastSeenAnywhereTime: null,    // Last time dog was detected ANYWHERE

  // Alert flags for each scenario
  wanderingAlertSent: false,     // Alert sent for "dog outside zone"
  disappearedAlertSent: false,   // Alert sent for "dog not detected"

  // Current status
  dogDetected: false,            // Is dog currently detected?
  dogInZone: false,              // Is dog currently in safe zone?

  checkInterval: null,
  safeZone: [],
  apiBaseUrl: null,
};

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

// ============================================================================
// Alert Monitoring System
// ============================================================================

// Point-in-polygon check using ray casting algorithm
function isPointInPolygon(point, polygon) {
  if (!polygon || polygon.length < 3) return true; // No safe zone = always "inside"

  let x = point.x, y = point.y;
  let inside = false;

  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    let xi = polygon[i].x, yi = polygon[i].y;
    let xj = polygon[j].x, yj = polygon[j].y;

    let intersect = ((yi > y) !== (yj > y))
        && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }

  return inside;
}

// Check if dog is inside safe zone
function isDogInSafeZone(detection, frameWidth, frameHeight, safeZone) {
  if (!safeZone || safeZone.length === 0) return true; // No safe zone = always inside

  // Get center point of bounding box
  const [x1, y1, x2, y2] = detection.bbox;
  const centerX = (x1 + x2) / 2 / frameWidth;  // Normalize to 0-1
  const centerY = (y1 + y2) / 2 / frameHeight; // Normalize to 0-1

  return isPointInPolygon({ x: centerX, y: centerY }, safeZone);
}

// Send alert notification via Firebase Function
async function sendAlertNotification(message, alertType = "general") {
  if (!alertMonitor.apiBaseUrl) {
    console.error("⚠️ API base URL not configured for alerts");
    return;
  }

  try {
    const fetch = require("node-fetch");
    const response = await fetch(`${alertMonitor.apiBaseUrl}/send-dog-alert`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        deviceId: alertMonitor.deviceId,
        message: message,
        alertType: alertType,  // "wandering", "disappeared", "returned", or "general"
        timestamp: new Date().toISOString()
      })
    });

    const result = await response.json();
    if (result.success) {
      console.log(`✅ ${alertType} alert sent successfully to LINE`);
    } else {
      console.log("⚠️ Alert not sent:", result.reason || result.error);
    }
  } catch (error) {
    console.error("❌ Failed to send alert:", error);
  }
}

// Start alert monitoring
function startAlertMonitoring(config) {
  const { deviceId, lineUserId, safeZone, apiBaseUrl } = config;

  console.log("🔔 Starting alert monitoring for device:", deviceId);

  alertMonitor.enabled = true;
  alertMonitor.deviceId = deviceId;
  alertMonitor.lineUserId = lineUserId;
  alertMonitor.safeZone = safeZone || [];
  alertMonitor.apiBaseUrl = apiBaseUrl;

  // Initialize timing and state
  const now = Date.now();
  alertMonitor.lastSeenInZoneTime = now;
  alertMonitor.lastSeenAnywhereTime = now;
  alertMonitor.wanderingAlertSent = false;
  alertMonitor.disappearedAlertSent = false;
  alertMonitor.dogDetected = false;
  alertMonitor.dogInZone = false;

  // Clear any existing interval
  if (alertMonitor.checkInterval) {
    clearInterval(alertMonitor.checkInterval);
  }

  // Check every 5 seconds if dog has been missing for 30 seconds
  alertMonitor.checkInterval = setInterval(() => {
    if (!alertMonitor.enabled) return;

    const now = Date.now();
    const timeSinceInZone = now - (alertMonitor.lastSeenInZoneTime || 0);
    const timeSinceAnywhere = now - (alertMonitor.lastSeenAnywhereTime || 0);

    // Priority 1: Dog completely disappeared (not detected at all)
    // Trigger after 30 seconds of no detection
    if (timeSinceAnywhere >= 30000 && !alertMonitor.disappearedAlertSent) {
      console.log("🚨 Dog has completely disappeared! Sending alert...");
      sendAlertNotification(
        "🚨 URGENT: Your dog has completely disappeared from the camera view for 30 seconds!",
        "disappeared"
      );
      alertMonitor.disappearedAlertSent = true;
    }
    // Priority 2: Dog wandering outside safe zone
    // Trigger after 30 seconds outside zone (but still visible)
    // Only if NOT disappeared
    else if (
      timeSinceInZone >= 30000 &&
      !alertMonitor.wanderingAlertSent &&
      alertMonitor.dogDetected
    ) {
      console.log("⚠️ Dog wandering outside safe zone! Sending alert...");
      sendAlertNotification(
        "⚠️ WARNING: Your dog has been outside the safe zone for 30 seconds.",
        "wandering"
      );
      alertMonitor.wanderingAlertSent = true;
    }
  }, 5000); // Check every 5 seconds

  console.log("✅ Alert monitoring started");
}

// Stop alert monitoring
function stopAlertMonitoring() {
  console.log("🔕 Stopping alert monitoring");

  alertMonitor.enabled = false;

  if (alertMonitor.checkInterval) {
    clearInterval(alertMonitor.checkInterval);
    alertMonitor.checkInterval = null;
  }

  // Clear all state
  alertMonitor.lastSeenInZoneTime = null;
  alertMonitor.lastSeenAnywhereTime = null;
  alertMonitor.wanderingAlertSent = false;
  alertMonitor.disappearedAlertSent = false;
  alertMonitor.dogDetected = false;
  alertMonitor.dogInZone = false;
}

// Process detection data for alert monitoring
function processDetectionForAlert(data) {
  if (!alertMonitor.enabled || !data.detections) return;

  const now = Date.now();

  // Check if any dog is detected (anywhere in frame)
  const dogDetections = data.detections.filter(d => d.class === "dog");
  const dogDetected = dogDetections.length > 0;

  // Check if any detected dog is inside the safe zone
  let dogInSafeZone = false;
  if (dogDetected) {
    for (const detection of dogDetections) {
      const inZone = isDogInSafeZone(
        detection,
        data.frame_width,
        data.frame_height,
        alertMonitor.safeZone
      );

      if (inZone) {
        dogInSafeZone = true;
        break;
      }
    }
  }

  // Update current status
  alertMonitor.dogDetected = dogDetected;
  alertMonitor.dogInZone = dogInSafeZone;

  // Scenario 1: Dog is in safe zone (normal state)
  if (dogInSafeZone) {
    alertMonitor.lastSeenInZoneTime = now;
    alertMonitor.lastSeenAnywhereTime = now;

    // Check if dog was in alert state and send return notification
    const wasWandering = alertMonitor.wanderingAlertSent;
    const wasDisappeared = alertMonitor.disappearedAlertSent;

    alertMonitor.wanderingAlertSent = false;
    alertMonitor.disappearedAlertSent = false;

    if (wasWandering || wasDisappeared) {
      console.log("✅ Dog has returned to safe zone! Sending notification...");
      sendAlertNotification(
        "✅ Good news! Your dog has returned to the safe zone.",
        "returned"
      );
    }
  }
  // Scenario 2: Dog detected but outside safe zone (wandering)
  else if (dogDetected) {
    alertMonitor.lastSeenAnywhereTime = now;

    // If dog was disappeared, it's now wandering - clear disappeared alert
    if (alertMonitor.disappearedAlertSent) {
      console.log("🔍 Dog reappeared but is outside the safe zone");
      alertMonitor.disappearedAlertSent = false;
    }
  }
  // Scenario 3: Dog not detected at all (disappeared)
  // lastSeenAnywhereTime will become stale, triggering disappeared alert in interval check
}

// ============================================================================
// Detection process management
function startDetection() {
  if (detectionProcess) {
    console.log("⚠️ Detection already running");
    return;
  }

  // Check if we should use compiled executable or Python script
  const fs = require("fs");
  const detectExePathWin = path.join(__dirname, "detection", "detect.exe");
  const detectExePathMac = path.join(__dirname, "detection", "detect");
  const detectPyPath = path.join(__dirname, "detection", "detect.py");

  let detectionArgs = [];
  let detectionCommand = "";

  // Try compiled executable first (platform-specific)
  if (process.platform === "win32" && fs.existsSync(detectExePathWin)) {
    detectionCommand = detectExePathWin;
    console.log("🐶 Using compiled detection executable (Windows)");
  } else if (process.platform === "darwin" && fs.existsSync(detectExePathMac)) {
    detectionCommand = detectExePathMac;
    console.log("🐶 Using compiled detection executable (Mac)");
  } else if (fs.existsSync(detectPyPath)) {
    // Fall back to Python script (use python3 on Mac, python on Windows)
    detectionCommand = process.platform === "darwin" ? "python3" : "python";
    detectionArgs = [detectPyPath];
    console.log(`🐶 Using Python script for detection (${detectionCommand})`);
  } else {
    console.error("⚠️ Detection script not found");
    safelySendToRenderer("detection-error", {
      error: "detection_not_found",
      message: "Detection script not found. Please ensure Python is installed or compile the detection script.",
    });
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

            // Track if Python sent an error
            if (result.error) {
              pythonErrorReceived = true;
            }

            // Process for alert monitoring
            processDetectionForAlert(result);

            // Send detection result to renderer
            safelySendToRenderer("detection-result", result);
          } catch (err) {
            console.error("⚠️ Failed to parse detection output:", line);
          }
        }
      });
    });

    // Handle stderr (errors and logs)
    detectionProcess.stderr.on("data", (data) => {
      const errorMsg = data.toString();
      console.error("🐶 Detection stderr:", errorMsg);

      // Forward stderr to renderer so users can see Python errors
      safelySendToRenderer("detection-error", {
        error: "stderr_output",
        message: errorMsg,
      });
    });

    // Handle process exit
    detectionProcess.on("exit", (code) => {
      console.log(`🐶 Detection process exited with code ${code}`);
      detectionProcess = null;
      safelySendToRenderer("detection-stopped", { code });

      // Only send generic error if Python didn't already send a specific error
      if (code !== 0 && code !== null && !pythonErrorReceived) {
        safelySendToRenderer("detection-error", {
          error: "process_exit",
          message: `Detection process exited unexpectedly (code ${code}). Check camera availability and permissions.`,
        });
      }

      // Reset flag for next run
      pythonErrorReceived = false;
    });

    // Handle process errors
    detectionProcess.on("error", (err) => {
      console.error("⚠️ Detection process error:", err);
      detectionProcess = null;
      safelySendToRenderer("detection-error", {
        error: "process_error",
        message: err.message,
      });
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

// Alert monitoring handlers
ipcMain.on("start-alert-monitoring", (event, config) => {
  console.log("🔔 Start alert monitoring requested");
  startAlertMonitoring(config);
});

ipcMain.on("stop-alert-monitoring", () => {
  console.log("🔕 Stop alert monitoring requested");
  stopAlertMonitoring();
});

// Cleanup on app quit
app.on("before-quit", () => {
  stopDetection();
  stopAlertMonitoring();
});
