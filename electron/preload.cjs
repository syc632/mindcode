const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("mindcode", {
  loadData: () => ipcRenderer.invoke("data:load"),
  saveData: (data) => ipcRenderer.invoke("data:save", data),
  extractConcepts: (payload) => ipcRenderer.invoke("extract:concepts", payload),
});
