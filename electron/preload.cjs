const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("mindcode", {
  loadData: () => ipcRenderer.invoke("data:load"),
  saveData: (data) => ipcRenderer.invoke("data:save", data),
  exportData: (data) => ipcRenderer.invoke("data:export", data),
  importData: () => ipcRenderer.invoke("data:import"),
  backupData: (data) => ipcRenderer.invoke("data:backup", data),
  getAiConfigStatus: () => ipcRenderer.invoke("ai:get-config-status"),
  saveAiApiKey: (payload) => ipcRenderer.invoke("ai:save-api-key", payload),
  clearAiApiKey: () => ipcRenderer.invoke("ai:clear-api-key"),
  showMissingAiKeyDialog: () => ipcRenderer.invoke("ai:show-missing-key-dialog"),
  readObsidianVault: () => ipcRenderer.invoke("obsidian:read-vault"),
  summarizeObsidianNotes: (payload) => ipcRenderer.invoke("obsidian:summarize-notes", payload),
  extractConcepts: (payload) => ipcRenderer.invoke("extract:concepts", payload),
});
