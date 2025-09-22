// This exposes a safe window.electronAPI.sendPaired() function to your React frontend.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  sendPaired: () => ipcRenderer.send("paired"),
});
