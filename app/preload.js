// This exposes a safe window.electronAPI.sendPaired() function to your React frontend.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  sendPaired: () => ipcRenderer.send("paired"),

  // Detection control
  startDetection: () => ipcRenderer.send("start-detection"),
  stopDetection: () => ipcRenderer.send("stop-detection"),

  // Detection event listeners
  onDetectionResult: (callback) => {
    ipcRenderer.on("detection-result", (event, data) => callback(data));
  },
  onDetectionError: (callback) => {
    ipcRenderer.on("detection-error", (event, data) => callback(data));
  },
  onDetectionStopped: (callback) => {
    ipcRenderer.on("detection-stopped", (event, data) => callback(data));
  },

  // Cleanup listeners
  removeDetectionListeners: () => {
    ipcRenderer.removeAllListeners("detection-result");
    ipcRenderer.removeAllListeners("detection-error");
    ipcRenderer.removeAllListeners("detection-stopped");
  },

  // Alert monitoring control
  startAlertMonitoring: (config) => ipcRenderer.send("start-alert-monitoring", config),
  stopAlertMonitoring: () => ipcRenderer.send("stop-alert-monitoring"),
});
