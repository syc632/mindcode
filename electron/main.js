import { app, BrowserWindow, dialog, ipcMain } from "electron";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { seedData } from "../src/shared/seedData.js";
import { defaultDeepSeekModel, extractWithDeepSeek, summarizeObsidianNotesWithDeepSeek } from "../src/shared/deepseekExtractor.js";
import { extractWithMock } from "../src/shared/mockExtractor.js";
import { normalizeMindCodeData } from "../src/shared/schema.js";
import { normalizeAiConfig, publicAiConfigStatus } from "../src/shared/aiConfig.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDev = Boolean(process.env.VITE_DEV_SERVER_URL);

let mainWindow;
let lastAutoBackupAt = 0;

const backupLimit = 12;
const autoBackupInterval = 5 * 60 * 1000;
const obsidianNoteLimit = 240;
const obsidianNoteCharLimit = 30_000;
const ignoredObsidianFolders = new Set([".obsidian", ".trash", ".git", "node_modules"]);

function aiConfigPath() {
  return path.join(app.getPath("userData"), "ai-config.json");
}

async function readStoredAiConfig() {
  try {
    const raw = await fs.readFile(aiConfigPath(), "utf8");
    return normalizeAiConfig(JSON.parse(raw));
  } catch {
    return normalizeAiConfig();
  }
}

async function readAiConfig() {
  const stored = await readStoredAiConfig();
  return normalizeAiConfig({
    ...stored,
    apiKey: stored.apiKey || process.env.DEEPSEEK_API_KEY || "",
  });
}

async function saveAiApiKey(payload) {
  const config = normalizeAiConfig({
    apiKey: payload?.apiKey,
    model: defaultDeepSeekModel,
  });

  await fs.mkdir(path.dirname(aiConfigPath()), { recursive: true });
  await fs.writeFile(aiConfigPath(), `${JSON.stringify(config, null, 2)}\n`, "utf8");
  return publicAiConfigStatus(config);
}

async function clearAiApiKey() {
  await fs.rm(aiConfigPath(), { force: true });
  return publicAiConfigStatus(await readAiConfig());
}

async function getAiConfigStatus() {
  return publicAiConfigStatus(await readAiConfig());
}

async function showMissingAiKeyDialog() {
  await dialog.showMessageBox(mainWindow, {
    type: "warning",
    title: "需要 DeepSeek API Key",
    message: "Obsidian 导入需要 DeepSeek API key",
    detail: "请先在 MindCode 中保存 DeepSeek API key，然后重新点击 Obsidian。",
    buttons: ["知道了"],
  });
  return { ok: true };
}

function dataPath() {
  return path.join(app.getPath("userData"), "mindcode-data.json");
}

function backupsPath() {
  return path.join(app.getPath("userData"), "backups");
}

function fileTimestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

async function pruneBackups() {
  const files = await fs.readdir(backupsPath(), { withFileTypes: true }).catch(() => []);
  const snapshots = await Promise.all(
    files
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map(async (entry) => {
        const filePath = path.join(backupsPath(), entry.name);
        const stats = await fs.stat(filePath);
        return { filePath, mtimeMs: stats.mtimeMs };
      }),
  );

  const stale = snapshots.sort((left, right) => right.mtimeMs - left.mtimeMs).slice(backupLimit);
  await Promise.all(stale.map((snapshot) => fs.unlink(snapshot.filePath)));
}

async function createBackup(data, reason = "manual") {
  const normalized = normalizeMindCodeData(data);
  const safeReason = String(reason).replace(/[^a-z-]/gi, "") || "manual";
  await fs.mkdir(backupsPath(), { recursive: true });
  const filePath = path.join(backupsPath(), `mindcode-${safeReason}-${fileTimestamp()}.json`);
  await fs.writeFile(filePath, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
  await pruneBackups();
  return { ok: true, filePath };
}

async function backupCurrentDiskData(reason) {
  try {
    const raw = await fs.readFile(dataPath(), "utf8");
    return createBackup(JSON.parse(raw), reason);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function maybeAutoBackup() {
  const timestamp = Date.now();
  if (timestamp - lastAutoBackupAt < autoBackupInterval) return;
  const backup = await backupCurrentDiskData("auto");
  if (backup) lastAutoBackupAt = timestamp;
}

async function readData() {
  try {
    const raw = await fs.readFile(dataPath(), "utf8");
    return {
      data: normalizeMindCodeData(JSON.parse(raw)),
      source: "disk",
    };
  } catch (error) {
    return {
      data: normalizeMindCodeData(seedData()),
      source: "seed",
      warning: error.code === "ENOENT" ? null : "本地数据读取失败，已加载内置示例数据。",
    };
  }
}

async function writeData(data, { autoBackup = true } = {}) {
  const normalized = normalizeMindCodeData(data);
  if (autoBackup) await maybeAutoBackup();
  await fs.mkdir(path.dirname(dataPath()), { recursive: true });
  await fs.writeFile(dataPath(), `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
  return { ok: true };
}

async function exportData(data) {
  const result = await dialog.showSaveDialog(mainWindow, {
    title: "导出 MindCode 数据",
    defaultPath: `MindCode-export-${fileTimestamp()}.json`,
    filters: [{ name: "MindCode JSON", extensions: ["json"] }],
  });
  if (result.canceled || !result.filePath) return { canceled: true };

  const normalized = normalizeMindCodeData(data);
  await fs.writeFile(result.filePath, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
  return { ok: true, filePath: result.filePath };
}

async function importData() {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "导入 MindCode 数据",
    properties: ["openFile"],
    filters: [{ name: "MindCode JSON", extensions: ["json"] }],
  });
  const filePath = result.filePaths?.[0];
  if (result.canceled || !filePath) return { canceled: true };

  const raw = await fs.readFile(filePath, "utf8");
  const data = normalizeMindCodeData(JSON.parse(raw));
  await backupCurrentDiskData("before-import");
  await writeData(data, { autoBackup: false });
  return { ok: true, filePath, data };
}

function skipObsidianFolder(name) {
  return ignoredObsidianFolders.has(name) || name.startsWith(".");
}

async function readObsidianNotes(vaultPath) {
  const pendingFolders = [vaultPath];
  const notes = [];
  let skippedMarkdownFiles = 0;

  while (pendingFolders.length) {
    const folderPath = pendingFolders.shift();
    const entries = await fs.readdir(folderPath, { withFileTypes: true }).catch(() => []);

    for (const entry of entries) {
      const entryPath = path.join(folderPath, entry.name);

      if (entry.isDirectory()) {
        if (!skipObsidianFolder(entry.name)) pendingFolders.push(entryPath);
        continue;
      }

      if (!entry.isFile() || path.extname(entry.name).toLowerCase() !== ".md") continue;
      if (notes.length >= obsidianNoteLimit) {
        skippedMarkdownFiles += 1;
        continue;
      }

      const raw = await fs.readFile(entryPath, "utf8").catch(() => "");
      const content = raw.trim();
      if (!content) continue;
      const stats = await fs.stat(entryPath);

      notes.push({
        name: path.basename(entry.name, ".md"),
        path: path.relative(vaultPath, entryPath),
        content: content.slice(0, obsidianNoteCharLimit),
        truncated: content.length > obsidianNoteCharLimit,
        updatedAt: stats.mtimeMs,
      });
    }
  }

  notes.sort((left, right) => right.updatedAt - left.updatedAt || left.path.localeCompare(right.path, "zh-Hans-CN"));
  return { notes, skippedMarkdownFiles };
}

async function readObsidianVault() {
  const aiConfig = await readAiConfig();
  if (!aiConfig.apiKey) {
    throw new Error("Obsidian 导入需要 DeepSeek API key。");
  }

  const result = await dialog.showOpenDialog(mainWindow, {
    title: "选择 Obsidian Vault",
    properties: ["openDirectory"],
  });
  const vaultPath = result.filePaths?.[0];
  if (result.canceled || !vaultPath) return { canceled: true };

  const { notes, skippedMarkdownFiles } = await readObsidianNotes(vaultPath);
  const warnings = [];
  if (skippedMarkdownFiles) warnings.push(`已读取前 ${obsidianNoteLimit} 篇 Markdown 笔记。`);
  if (notes.some((note) => note.truncated)) warnings.push(`超长笔记按每篇 ${obsidianNoteCharLimit} 字符载入。`);

  return {
    ok: true,
    vaultName: path.basename(vaultPath),
    notes,
    warning: warnings.join(" "),
  };
}

async function summarizeObsidianNotes(payload) {
  const aiConfig = await readAiConfig();
  if (!aiConfig.apiKey) {
    throw new Error("Obsidian 导入需要 DeepSeek API key。");
  }

  return summarizeObsidianNotesWithDeepSeek({
    notes: Array.isArray(payload?.notes) ? payload.notes : [],
    apiKey: aiConfig.apiKey,
    model: aiConfig.model,
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 920,
    minHeight: 640,
    title: "MindCode",
    backgroundColor: "#f7f4ef",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  if (isDev) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
    if (process.env.MINDCODE_OPEN_DEVTOOLS === "1") {
      mainWindow.webContents.openDevTools({ mode: "detach" });
    }
  } else {
    mainWindow.loadFile(path.join(__dirname, "../dist/index.html"));
  }
}

ipcMain.handle("data:load", readData);
ipcMain.handle("data:save", async (_event, data) => writeData(data));
ipcMain.handle("data:export", async (_event, data) => exportData(data));
ipcMain.handle("data:import", importData);
ipcMain.handle("data:backup", async (_event, data) => createBackup(data, "manual"));
ipcMain.handle("ai:get-config-status", getAiConfigStatus);
ipcMain.handle("ai:save-api-key", async (_event, payload) => saveAiApiKey(payload));
ipcMain.handle("ai:clear-api-key", clearAiApiKey);
ipcMain.handle("ai:show-missing-key-dialog", showMissingAiKeyDialog);
ipcMain.handle("obsidian:read-vault", readObsidianVault);
ipcMain.handle("obsidian:summarize-notes", async (_event, payload) => summarizeObsidianNotes(payload));
ipcMain.handle("extract:concepts", async (_event, payload) => {
  const text = payload?.text ?? "";
  const existingLabels = payload?.existingLabels ?? [];
  const aiConfig = await readAiConfig();

  if (aiConfig.apiKey) {
    try {
      return await extractWithDeepSeek({ text, existingLabels, apiKey: aiConfig.apiKey, model: aiConfig.model });
    } catch (error) {
      return {
        ...(await extractWithMock({ text, existingLabels })),
        warning: `DeepSeek 提取失败，已使用离线提取器：${error.message}`,
      };
    }
  }

  return extractWithMock({ text, existingLabels });
});

app.whenReady().then(() => {
  app.setName("MindCode");
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
