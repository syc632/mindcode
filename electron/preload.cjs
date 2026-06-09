const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("mindcode", {
  loadData: () => ipcRenderer.invoke("data:load"),
  saveData: (data) => ipcRenderer.invoke("data:save", data),
  exportData: (data) => ipcRenderer.invoke("data:export", data),
  importData: () => ipcRenderer.invoke("data:import"),
  backupData: (data) => ipcRenderer.invoke("data:backup", data),
  listMaps: () => ipcRenderer.invoke("maps:list"),
  loadMap: (payload) => ipcRenderer.invoke("maps:load", payload),
  saveMap: (payload) => ipcRenderer.invoke("maps:save", payload),
  createMap: (payload) => ipcRenderer.invoke("maps:create", payload),
  deleteMap: (payload) => ipcRenderer.invoke("maps:delete", payload),
  exportMap: (payload) => ipcRenderer.invoke("maps:export", payload),
  importMap: () => ipcRenderer.invoke("maps:import"),
  openMapFile: () => ipcRenderer.invoke("maps:open-file"),
  getAiConfigStatus: () => ipcRenderer.invoke("ai:get-config-status"),
  saveAiApiKey: (payload) => ipcRenderer.invoke("ai:save-api-key", payload),
  clearAiApiKey: () => ipcRenderer.invoke("ai:clear-api-key"),
  showMissingAiKeyDialog: () => ipcRenderer.invoke("ai:show-missing-key-dialog"),
  scanDocuments: () => ipcRenderer.invoke("documents:scan"),
  extractConcepts: (payload) => ipcRenderer.invoke("extract:concepts", payload),
});
