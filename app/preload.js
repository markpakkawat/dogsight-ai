// This exposes a safe window.electronAPI functions to your React frontend.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  sendPaired: (userId) => ipcRenderer.send("paired", userId),
  startDetection: () => ipcRenderer.send("start-detection"),
  stopDetection: () => ipcRenderer.send("stop-detection"),
});
