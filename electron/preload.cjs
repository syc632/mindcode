const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("mindcode", {
  loadData: () => ipcRenderer.invoke("data:load"),
  saveData: (data) => ipcRenderer.invoke("data:save", data),
  exportData: (data) => ipcRenderer.invoke("data:export", data),
  importData: () => ipcRenderer.invoke("data:import"),
  backupData: (data) => ipcRenderer.invoke("data:backup", data),
  extractConcepts: (payload) => ipcRenderer.invoke("extract:concepts", payload),
});
