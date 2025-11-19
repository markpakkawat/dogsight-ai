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

  // optional: map of registered track IDs (if you implement registration)
  registeredTrackIds: {}, // e.g. { "5": true }
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

  // debug
  // console.log("DBG center:", centerX, centerY, "safeZone:", safeZone);

  return isPointInPolygon({ x: centerX, y: centerY }, safeZone);
}

// Send alert notification via Firebase Function
async function sendAlertNotification(message, alertType = "general") {
  if (!alertMonitor.apiBaseUrl) {
    console.error("⚠️ API base URL not configured for alerts");
    return;
  }

  try {
    // Node 18+ has global fetch, otherwise use node-fetch
    let fetchFn;
    try {
      fetchFn = global.fetch || require("node-fetch");
    } catch (err) {
      fetchFn = global.fetch; // may be undefined, but try
    }

    if (!fetchFn) {
      console.error("⚠️ No fetch available. Please install node-fetch or upgrade Node.");
      return;
    }

    const response = await fetchFn(`${alertMonitor.apiBaseUrl}/send-dog-alert`, {
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
// Start alert monitoring (patched)
function startAlertMonitoring(config) {
  const { deviceId, lineUserId, safeZone, apiBaseUrl } = config || {};

  console.log("🔔 Starting alert monitoring for device:", deviceId);

  alertMonitor.enabled = true;
  alertMonitor.deviceId = deviceId;
  alertMonitor.lineUserId = lineUserId;
  alertMonitor.safeZone = safeZone || [];
  alertMonitor.apiBaseUrl = apiBaseUrl;

  // Initialize timing and state
  // IMPORTANT: set lastSeenInZoneTime to 0 so the system only considers "globalOutsideLongEnough"
  // after it has actually seen a dog in the safe zone since monitoring started.
  alertMonitor.lastSeenInZoneTime = 0;
  alertMonitor.lastSeenAnywhereTime = Date.now();
  alertMonitor.wanderingAlertSent = false;
  alertMonitor.disappearedAlertSent = false;
  alertMonitor.dogDetected = false;
  alertMonitor.dogInZone = false;

  // Initialize per-track maps used by processDetectionForAlert
  alertMonitor.trackOutsideSince = {};   // { trackId: firstOutsideTimestamp(ms) }
  alertMonitor.trackLastSeen = {};       // { trackId: lastSeenTimestamp(ms) }
  alertMonitor.trackSeenInside = {};     // { trackId: true } - mark tracks that were seen inside at least once

  // Normalize safeZone if it appears to be pixel coordinates
  // Adjust FRAME_W/FRAME_H if your camera resolution is not 640x480
  try {
    const FRAME_W = 640, FRAME_H = 480;
    if (alertMonitor.safeZone.length && typeof alertMonitor.safeZone[0].x === "number" && alertMonitor.safeZone[0].x > 1) {
      alertMonitor.safeZone = alertMonitor.safeZone.map(p => ({ x: p.x / FRAME_W, y: p.y / FRAME_H }));
      console.log("🔁 Normalized safeZone to 0..1 coordinates.");
    }
  } catch (e) {
    // ignore normalization errors
  }

  // Clear any existing interval
  if (alertMonitor.checkInterval) {
    clearInterval(alertMonitor.checkInterval);
  }

  // Check every 5 seconds if dog has been missing for 30 seconds
    // Check every 5 seconds if dog has been missing for 30 seconds
    // Check every 5 seconds if dog has been missing for 30 seconds
    // Check every 5 seconds if dog has been missing for 30 seconds
    // Check every 5 seconds if dog has been missing / wandering
  alertMonitor.checkInterval = setInterval(() => {
    if (!alertMonitor.enabled) return;

    const now = Date.now();
    // thresholds (ms)
    const DISAPPEARED_MS = 10000;       // no-detection timeout (10s) -- user requested
    const PER_TRACK_OUTSIDE_MS = 15000; // per-track outside duration required for wandering (unchanged)
    const KNOWN_PET_INZONE_TTL_MS = 10 * 60 * 1000; // in-zone TTL for "known" pet

    const timeSinceInZone = now - (alertMonitor.lastSeenInZoneTime || 0);
    const timeSinceAnywhere = now - (alertMonitor.lastSeenAnywhereTime || 0);

    // ---------- 1) Disappeared logic (10s) ----------
    if (timeSinceAnywhere >= DISAPPEARED_MS && !alertMonitor.disappearedAlertSent) {
      // If camera lost all detections for DISAPPEARED_MS, check whether any known track was
      // previously seen inside and then observed outside (even briefly) before the disappearance.
      let knownOutsideThenMissing = false;

      if (!alertMonitor.trackOutsideSince) alertMonitor.trackOutsideSince = {};
      if (!alertMonitor.trackSeenInside) alertMonitor.trackSeenInside = {};
      if (!alertMonitor.trackSeenInsideSince) alertMonitor.trackSeenInsideSince = {};

      for (const tid in alertMonitor.trackOutsideSince) {
        const since = alertMonitor.trackOutsideSince[tid];
        if (!since) continue;

        const wasSeenInside = !!alertMonitor.trackSeenInside[tid];
        const isRegistered = !!alertMonitor.registeredTrackIds[String(tid)];
        const seenInsideSince = alertMonitor.trackSeenInsideSince ? alertMonitor.trackSeenInsideSince[tid] : null;

        // Only consider tracks that were seen inside before (or explicitly registered)
        if (!(wasSeenInside || isRegistered)) continue;

        // If seen-inside is stale, treat as not-known
        if (wasSeenInside && (!seenInsideSince || (now - seenInsideSince) > KNOWN_PET_INZONE_TTL_MS)) continue;

        // If we have any track that moved outside (has trackOutsideSince), consider it "outside then missing"
        // We intentionally do not require PER_TRACK_OUTSIDE_MS here because the user requested detection of
        // "inside -> outside -> disappeared (no bbox) for 10s" — a short outside then disappearance should trigger.
        knownOutsideThenMissing = true;
        break;
      }

      if (knownOutsideThenMissing) {
        console.log("🚨 Dog disappeared after being seen outside — sending 'disappeared_after_outside' alert...");
        sendAlertNotification(
          "🚨 URGENT: Your dog was seen outside the safe zone and then disappeared from camera view! Please check immediately.",
          "disappeared_after_outside"
        );
      } else {
        console.log("🚨 Dog has completely disappeared from view — sending regular disappeared alert...");
        sendAlertNotification(
          "🚨 URGENT: Your dog has completely disappeared from the camera view for 10 seconds!",
          "disappeared"
        );
      }

      alertMonitor.disappearedAlertSent = true;
      return;
    }

    // ---------- 2) Wandering/outside logic (unchanged conservative check) ----------
    if (!alertMonitor.trackOutsideSince) alertMonitor.trackOutsideSince = {};
    if (!alertMonitor.trackSeenInside) alertMonitor.trackSeenInside = {};
    if (!alertMonitor.trackSeenInsideSince) alertMonitor.trackSeenInsideSince = {};

    let anyTrackOutsideLong = false;
    for (const tid in alertMonitor.trackOutsideSince) {
      const since = alertMonitor.trackOutsideSince[tid];
      if (!since) continue;

      const wasSeenInside = !!alertMonitor.trackSeenInside[tid];
      const isRegistered = !!alertMonitor.registeredTrackIds[String(tid)];
      const seenInsideSince = alertMonitor.trackSeenInsideSince ? alertMonitor.trackSeenInsideSince[tid] : null;

      if (!(wasSeenInside || isRegistered)) continue;
      if (wasSeenInside && (!seenInsideSince || (now - seenInsideSince) > KNOWN_PET_INZONE_TTL_MS)) continue;

      if (now - since >= PER_TRACK_OUTSIDE_MS) {
        anyTrackOutsideLong = true;
        break;
      }
    }

    // Wandering alert uses the global guard (you can tune this separately if desired)
    // NOTE: this still uses the original globalTimeSinceInZone guard (30s) — if you want that changed to 10s too,
    // replace the 30000 below with 10000.
    if (
      anyTrackOutsideLong &&
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

  // clear per-track memory
  alertMonitor.trackOutsideSince = {};
  alertMonitor.trackLastSeen = {};
  alertMonitor.trackSeenInside = {};
}

// Process detection data for alert monitoring
// Process detection data for alert monitoring (patched)
// Process detection data for alert monitoring (more conservative version)
// Process detection data for alert monitoring (balanced: permissive presence + strict wandering)
function processDetectionForAlert(data) {
  if (!alertMonitor.enabled || !data || !Array.isArray(data.detections)) return;

  const now = Date.now();

  // --- debug logs (useful while tuning) ---
  console.log("DBG detection frame:", data.frame || "na", "detections:", JSON.stringify(data.detections || []));
  console.log("DBG trackOutsideSince:", JSON.stringify(alertMonitor.trackOutsideSince || {}));
  console.log("DBG trackSeenInside:", JSON.stringify(alertMonitor.trackSeenInside || {}));
  console.log("DBG trackSeenInsideSince:", JSON.stringify(alertMonitor.trackSeenInsideSince || {}));
  console.log("DBG trackSeenInsideHits:", JSON.stringify(alertMonitor.trackSeenInsideHits || {}));
  console.log("DBG lastSeenInZoneTime:", alertMonitor.lastSeenInZoneTime);
  console.log("DBG lastSeenAnywhereTime:", alertMonitor.lastSeenAnywhereTime);

  // Tunables (adjust to taste)
  const MIN_HITS = 3;                   // require N hits for per-track stability (wandering decisions)
  const MIN_AREA = 2000;                // min bbox area in pixels
  const MIN_CONF = 0.25;                // min confidence
  const PER_TRACK_OUTSIDE_MS = 15000;   // per-track outside duration required (15s)
  const PRUNE_MS = 60000;               // prune track memory if not seen for this long
  const KNOWN_PET_INZONE_TTL_MS = 10 * 60 * 1000; // how long an "in-zone" sighting keeps a track known
  const MIN_INSIDE_HITS_TO_REGISTER = 2;// minimum in-zone hits to register as "seen inside"

  // Ensure per-track structures exist
  if (!alertMonitor.trackOutsideSince) alertMonitor.trackOutsideSince = {};
  if (!alertMonitor.trackLastSeen) alertMonitor.trackLastSeen = {};
  if (!alertMonitor.trackSeenInside) alertMonitor.trackSeenInside = {};
  if (!alertMonitor.trackSeenInsideSince) alertMonitor.trackSeenInsideSince = {};
  if (!alertMonitor.trackSeenInsideHits) alertMonitor.trackSeenInsideHits = {};

  // --- two-tier detection lists ---
  // rawPresenceDetections: permissive set for presence/disappearance (no hits requirement)
  const rawPresenceDetections = (data.detections || [])
    .filter(d => d.class === "dog")
    .filter(d => (d.confidence || 0) >= MIN_CONF && (d.area || 0) >= MIN_AREA);

  // stableDetections: strict set used for tracking / wandering decisions (requires hits)
  const stableDetections = rawPresenceDetections.filter(d => (d.hits || 0) >= MIN_HITS);

  // Update dogDetected & lastSeenAnywhereTime from permissive presence list
  const dogDetected = rawPresenceDetections.length > 0;
  if (dogDetected) {
    alertMonitor.lastSeenAnywhereTime = now;
  }
  alertMonitor.dogDetected = dogDetected;

  // Evaluate per-track inside/outside using stableDetections
  let dogInSafeZone = false;
  for (const detection of stableDetections) {
    const tid = detection.id != null ? String(detection.id) : null;

    // update last-seen per-track for pruning
    if (tid) alertMonitor.trackLastSeen[tid] = now;

    const inZone = isDogInSafeZone(detection, data.frame_width, data.frame_height, alertMonitor.safeZone);

    if (inZone) {
      dogInSafeZone = true;

      // count in-zone hits then register if enough
      if (tid) {
        alertMonitor.trackSeenInsideHits[tid] = (alertMonitor.trackSeenInsideHits[tid] || 0) + 1;
        if (alertMonitor.trackSeenInsideHits[tid] >= MIN_INSIDE_HITS_TO_REGISTER) {
          alertMonitor.trackSeenInside[tid] = true;
          alertMonitor.trackSeenInsideSince[tid] = now;
        }
      }

      // clear outside timer for that track
      if (tid && alertMonitor.trackOutsideSince[tid]) {
        delete alertMonitor.trackOutsideSince[tid];
      }

      // in-zone sighting -> update lastSeenInZoneTime & lastSeenAnywhereTime
      alertMonitor.lastSeenInZoneTime = now;
      alertMonitor.lastSeenAnywhereTime = now;

      // Reset wandering/disappeared flags (returned)
      const wasWandering = alertMonitor.wanderingAlertSent;
      const wasDisappeared = alertMonitor.disappearedAlertSent;
      alertMonitor.wanderingAlertSent = false;
      alertMonitor.disappearedAlertSent = false;

      if (wasWandering || wasDisappeared) {
        sendAlertNotification("✅ Good news! Your dog has returned to the safe zone.", "returned");
      }

      // treat this frame as safe and stop checking further stable detections
      break;
    } else {
      // outside zone: only start outside timer if we have an id (avoid anonymous false triggers)
      if (tid) {
        if (!alertMonitor.trackOutsideSince[tid]) {
          alertMonitor.trackOutsideSince[tid] = now;
        }
      }
    }
  }

  // Prune stale track memory
  for (const tid in Object.assign({}, alertMonitor.trackLastSeen)) {
    if (now - alertMonitor.trackLastSeen[tid] > PRUNE_MS) {
      delete alertMonitor.trackLastSeen[tid];
      delete alertMonitor.trackOutsideSince[tid];
      delete alertMonitor.trackSeenInside[tid];
      delete alertMonitor.trackSeenInsideSince[tid];
      delete alertMonitor.trackSeenInsideHits[tid];
    }
  }

  // Prune stale seen-inside marks (so old sightings don't keep a track known forever)
  for (const tid in Object.assign({}, alertMonitor.trackSeenInsideSince)) {
    if (now - alertMonitor.trackSeenInsideSince[tid] > KNOWN_PET_INZONE_TTL_MS) {
      delete alertMonitor.trackSeenInside[tid];
      delete alertMonitor.trackSeenInsideSince[tid];
      delete alertMonitor.trackSeenInsideHits[tid];
    }
  }

  // update state used by interval check
  alertMonitor.dogInZone = dogInSafeZone;

  // If there's an in-zone detection we already handled returning above
  if (dogInSafeZone) return;

  // If dog is detected but none in-zone -> consider wandering logic (use stableDetections and per-track timers)
  if (dogDetected && !dogInSafeZone) {
    // lastSeenAnywhereTime was set earlier from raw presence detections

    // Determine anyTrackOutsideLong (conservative)
    let anyTrackOutsideLong = false;
    for (const tid in alertMonitor.trackOutsideSince) {
      const since = alertMonitor.trackOutsideSince[tid];
      if (!since) continue;

      const wasSeenInside = !!alertMonitor.trackSeenInside[tid];
      const isRegistered = !!alertMonitor.registeredTrackIds[String(tid)];
      const seenInsideSince = alertMonitor.trackSeenInsideSince ? alertMonitor.trackSeenInsideSince[tid] : null;

      if (!(wasSeenInside || isRegistered)) continue; // ignore unknown tracks

      // if seen-inside is stale, skip
      if (wasSeenInside && (!seenInsideSince || (now - seenInsideSince) > KNOWN_PET_INZONE_TTL_MS)) continue;

      if (now - since >= PER_TRACK_OUTSIDE_MS) {
        anyTrackOutsideLong = true;
        break;
      }
    }

    // Only trigger wandering alert if both per-track and global conditions met
    const timeSinceInZone = now - (alertMonitor.lastSeenInZoneTime || 0);
    const globalOutsideLongEnough = timeSinceInZone >= 30000;

    console.log("DBG anyTrackOutsideLong:", anyTrackOutsideLong, "timeSinceInZone(ms):", timeSinceInZone);

    if (anyTrackOutsideLong && globalOutsideLongEnough && !alertMonitor.wanderingAlertSent) {
      alertMonitor.wanderingAlertSent = true;
      sendAlertNotification("⚠️ WARNING: Your dog has been outside the safe zone for 30 seconds.", "wandering");
    }

    // If previously disappeared alert set but we detected again, clear disappeared flag
    if (alertMonitor.disappearedAlertSent) {
      alertMonitor.disappearedAlertSent = false;
    }
    return;
  }

  // If no dog detected at all (rawPresenceDetections is empty) -> don't update lastSeenAnywhere (interval will handle disappeared)
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
