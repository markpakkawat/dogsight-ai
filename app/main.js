const { app, BrowserWindow, ipcMain } = require("electron");
const { fork, execFile } = require("child_process");
const path = require("path");

function createWindow() {
  const win = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const startUrl = path.join(__dirname, "frontend/build/index.html");
  win.loadURL(`file://${startUrl}`);
}

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

// ✅ Start detection only after pairing
ipcMain.on("paired", () => {
  // Start detection exe (optional stub until model ready)
  const detectPath = path.join(__dirname, "detection", "dist", "detect.exe");
  execFile(detectPath, (err, stdout, stderr) => {
    if (err) {
      console.error("⚠️ Detection error:", err);
      return;
    }
    if (stdout) console.log("🐶 Detection output:", stdout);
    if (stderr) console.error("🐶 Detection stderr:", stderr);
  });
});
