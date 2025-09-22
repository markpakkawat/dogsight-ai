const { app, BrowserWindow, ipcMain } = require("electron");
const { exec, execFile } = require("child_process");
const path = require("path");

function createWindow() {
  const win = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
    },
  });

  win.loadFile(path.join(__dirname, "../frontend/build/index.html"));
}

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

// ✅ Start backend + detection only after pairing
ipcMain.on("paired", () => {
  console.log("🔥 User paired with LINE, starting backend + detection...");

  exec("node ../backend/server.js", (err, stdout, stderr) => {
    if (err) console.error("Backend error:", err);
    console.log(stdout);
  });

  execFile("../detection/dist/detect.exe", (err, stdout, stderr) => {
    if (err) console.error("Detection error:", err);
    console.log(stdout);
  });
});
