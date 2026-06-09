import { app, BrowserWindow, dialog, ipcMain } from "electron";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import mammoth from "mammoth";
import { PDFParse } from "pdf-parse";
import { seedData } from "../src/shared/seedData.js";
import { defaultQwenModel, extractWithQwen } from "../src/shared/qwenExtractor.js";
import { extractWithMock } from "../src/shared/mockExtractor.js";
import { normalizeMindCodeData } from "../src/shared/schema.js";
import { normalizeAiConfig, publicAiConfigStatus } from "../src/shared/aiConfig.js";
import { mapTitleFromData, parseMindMapMarkdown, serializeMindMapMarkdown } from "../src/shared/mindMapMarkdown.js";
import { documentRelativePath, documentRelativeRoot } from "../src/shared/documentPaths.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDev = Boolean(process.env.VITE_DEV_SERVER_URL);

let mainWindow;
let lastAutoBackupAt = 0;

const backupLimit = 12;
const autoBackupInterval = 5 * 60 * 1000;
const dataFileByteLimit = 10 * 1024 * 1024;
const aiConfigFileByteLimit = 64 * 1024;
const openedMapsFileByteLimit = 256 * 1024;
const aiApiKeyCharLimit = 4_096;
const mapExtension = ".mindcode.md";
const mapFileFilters = [{ name: "MindCode Map (.mindcode.md)", extensions: ["mindcode.md"] }];
const mindMapFileByteLimit = 5 * 1024 * 1024;
const documentScanFileLimit = 80;
const documentScanFileByteLimit = 15 * 1024 * 1024;
const documentScanCharLimit = 30_000;
const documentScanTotalCharLimit = 180_000;
const extractConceptTextLimit = documentScanTotalCharLimit;
const extractConceptLabelLimit = 500;
const extractConceptLabelCharLimit = 120;
const textDocumentExtensions = new Set([".md", ".txt", ".js", ".jsx", ".ts", ".tsx", ".py", ".json", ".css", ".html"]);
const binaryDocumentExtensions = new Set([".pdf", ".docx"]);
const ignoredDocumentFolders = new Set([".git", "node_modules", ".trash", ".obsidian"]);
const openedMapFiles = new Map();

function aiConfigPath() {
  return path.join(app.getPath("userData"), "ai-config.json");
}

async function readStoredAiConfig() {
  try {
    const raw = await readUtf8FileWithinLimit(aiConfigPath(), aiConfigFileByteLimit, "AI 配置文件");
    return normalizeAiConfig(JSON.parse(raw));
  } catch {
    return normalizeAiConfig();
  }
}

async function readAiConfig() {
  const stored = await readStoredAiConfig();
  return normalizeAiConfig({
    ...stored,
    apiKey: stored.apiKey || process.env.DASHSCOPE_API_KEY || "",
  });
}

async function saveAiApiKey(payload) {
  const apiKey = String(payload?.apiKey || "").trim();
  if (apiKey.length > aiApiKeyCharLimit) {
    throw new Error(`API Key 超过 ${aiApiKeyCharLimit} 字符。`);
  }
  const config = normalizeAiConfig({
    apiKey,
    model: defaultQwenModel,
  });

  await fs.mkdir(path.dirname(aiConfigPath()), { recursive: true });
  const serialized = `${JSON.stringify(config, null, 2)}\n`;
  assertTextByteLimit(serialized, aiConfigFileByteLimit, "AI 配置文件");
  await fs.writeFile(aiConfigPath(), serialized, { encoding: "utf8", mode: 0o600 });
  await fs.chmod(aiConfigPath(), 0o600).catch(() => {});
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
    title: "需要 DashScope API Key",
    message: "AI 扫描本地文档需要 DashScope API key",
    detail: "请先在 MindCode 中保存 DashScope API key，然后重新扫描本地文档。",
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

function mapsPath() {
  return path.join(app.getPath("userData"), "maps");
}

function openedMapsPath() {
  return path.join(app.getPath("userData"), "opened-maps.json");
}

function fileTimestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function formatBytes(bytes) {
  if (bytes >= 1024 * 1024) return `${Math.round(bytes / 1024 / 1024)}MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)}KB`;
  return `${bytes}B`;
}

function assertByteLimit(size, limit, label) {
  if (size > limit) {
    throw new Error(`${label}超过 ${formatBytes(limit)}，已跳过。`);
  }
}

function assertTextByteLimit(text, limit, label) {
  assertByteLimit(Buffer.byteLength(String(text || ""), "utf8"), limit, label);
}

async function readUtf8FileWithinLimit(filePath, limit, label) {
  const stats = await fs.stat(filePath);
  assertByteLimit(stats.size, limit, label);
  return fs.readFile(filePath, "utf8");
}

function safeMapFileName(title) {
  const safe = String(title || "MindCode Map")
    .trim()
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, " ")
    .slice(0, 80) || "MindCode Map";
  return safe.endsWith(mapExtension) ? safe : `${safe}${mapExtension}`;
}

function ensureMindMapExtension(filePath) {
  const normalizedPath = String(filePath || "").trim();
  if (!normalizedPath) return "";
  return normalizedPath.endsWith(mapExtension) ? normalizedPath : `${normalizedPath}${mapExtension}`;
}

function assertMindMapExtension(filePath) {
  if (!path.basename(String(filePath || "")).endsWith(mapExtension)) {
    throw new Error("请选择 .mindcode.md 文件。");
  }
}

function safeMapId(id) {
  return path.basename(String(id || ""));
}

function externalMapId(filePath) {
  return `file:${filePath}`;
}

function titleFromMapPath(filePath) {
  return path.basename(filePath).slice(0, -mapExtension.length) || "MindCode Map";
}

async function readOpenedMapFiles() {
  try {
    const raw = await readUtf8FileWithinLimit(openedMapsPath(), openedMapsFileByteLimit, "最近打开文件列表");
    const filePaths = JSON.parse(raw);
    if (!Array.isArray(filePaths)) return;
    filePaths.forEach((filePath) => {
      const resolvedPath = path.resolve(String(filePath || ""));
      if (resolvedPath.endsWith(mapExtension)) openedMapFiles.set(externalMapId(resolvedPath), resolvedPath);
    });
  } catch (error) {
    if (error.code !== "ENOENT") console.warn("Failed to read opened MindCode maps:", error.message);
  }
}

async function persistOpenedMapFiles() {
  await fs.mkdir(path.dirname(openedMapsPath()), { recursive: true });
  const filePaths = [...new Set(openedMapFiles.values())].slice(-20);
  const serialized = `${JSON.stringify(filePaths, null, 2)}\n`;
  assertTextByteLimit(serialized, openedMapsFileByteLimit, "最近打开文件列表");
  await fs.writeFile(openedMapsPath(), serialized, "utf8");
}

async function registerOpenedMapFile(filePath) {
  const resolvedPath = path.resolve(filePath);
  assertMindMapExtension(resolvedPath);
  const id = externalMapId(resolvedPath);
  openedMapFiles.set(id, resolvedPath);
  await persistOpenedMapFiles();
  return id;
}

function mapFilePath(id) {
  const safeId = safeMapId(id);
  if (!safeId.endsWith(mapExtension)) throw new Error("无效的思维导图文件。");
  return path.join(mapsPath(), safeId);
}

async function uniqueMapFileName(title) {
  const baseName = safeMapFileName(title);
  const stem = baseName.slice(0, -mapExtension.length);
  let candidate = baseName;
  let index = 2;

  while (true) {
    const filePath = path.join(mapsPath(), candidate);
    try {
      await fs.access(filePath);
      candidate = `${stem} ${index}${mapExtension}`;
      index += 1;
    } catch {
      return candidate;
    }
  }
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
  const serialized = `${JSON.stringify(normalized, null, 2)}\n`;
  assertTextByteLimit(serialized, dataFileByteLimit, "备份数据");
  await fs.writeFile(filePath, serialized, "utf8");
  await pruneBackups();
  return { ok: true, filePath };
}

async function backupCurrentDiskData(reason) {
  try {
    const raw = await readUtf8FileWithinLimit(dataPath(), dataFileByteLimit, "本地数据文件");
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
    const raw = await readUtf8FileWithinLimit(dataPath(), dataFileByteLimit, "本地数据文件");
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
  const serialized = `${JSON.stringify(normalized, null, 2)}\n`;
  assertTextByteLimit(serialized, dataFileByteLimit, "本地数据文件");
  await fs.writeFile(dataPath(), serialized, "utf8");
  return { ok: true };
}

async function writeMindMapFile({ id, title, data, create = false }) {
  await fs.mkdir(mapsPath(), { recursive: true });
  const normalized = normalizeMindCodeData(data);
  const mapTitle = String(title || mapTitleFromData(normalized)).trim() || "MindCode Map";
  const fileName = create ? await uniqueMapFileName(mapTitle) : safeMapId(id || safeMapFileName(mapTitle));
  const filePath = path.join(mapsPath(), fileName);
  const serialized = serializeMindMapMarkdown({ title: mapTitle, data: normalized });
  assertTextByteLimit(serialized, mindMapFileByteLimit, "导图文件");
  await fs.writeFile(filePath, serialized, "utf8");
  const stats = await fs.stat(filePath);
  return { id: fileName, title: mapTitle, filePath, updatedAt: stats.mtimeMs, data: normalized };
}

async function readMindMapTextFile(filePath) {
  const stats = await fs.stat(filePath);
  assertByteLimit(stats.size, mindMapFileByteLimit, "导图文件");
  return { raw: await fs.readFile(filePath, "utf8"), stats };
}

async function readMindMapFile(filePath, id = null) {
  assertMindMapExtension(filePath);
  const { raw, stats } = await readMindMapTextFile(filePath);
  const parsed = parseMindMapMarkdown(raw, titleFromMapPath(filePath));
  const mapId = id || safeMapId(filePath);
  return {
    map: {
      id: mapId,
      title: parsed.title || titleFromMapPath(filePath),
      filePath,
      updatedAt: stats.mtimeMs,
      external: openedMapFiles.has(mapId),
    },
    data: parsed.data,
  };
}

async function ensureMindMaps() {
  await fs.mkdir(mapsPath(), { recursive: true });
  const files = await fs.readdir(mapsPath()).catch(() => []);
  if (files.some((file) => file.endsWith(mapExtension))) return;

  try {
    const raw = await fs.readFile(dataPath(), "utf8");
    const legacyData = normalizeMindCodeData(JSON.parse(raw));
    if (legacyData.nodes.length) {
      await writeMindMapFile({ title: "Legacy MindCode", data: legacyData, create: true });
      return;
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  await writeMindMapFile({ title: "MindCode", data: seedData(), create: true });
}

async function listMindMaps() {
  await ensureMindMaps();
  await readOpenedMapFiles();
  const entries = await fs.readdir(mapsPath(), { withFileTypes: true });
  const storedMaps = await Promise.all(
    entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(mapExtension))
      .map(async (entry) => {
        const filePath = path.join(mapsPath(), entry.name);
        const fallbackTitle = entry.name.slice(0, -mapExtension.length);
        try {
          const { raw, stats } = await readMindMapTextFile(filePath);
          const parsed = parseMindMapMarkdown(raw, fallbackTitle);
          return {
            id: entry.name,
            title: parsed.title || fallbackTitle,
            filePath,
            updatedAt: stats.mtimeMs,
          };
        } catch {
          return null;
        }
      }),
  );
  let openedMapsChanged = false;
  const externalMaps = (
    await Promise.all(
      [...openedMapFiles.entries()].map(async ([id, filePath]) => {
        try {
          return (await readMindMapFile(filePath, id)).map;
        } catch {
          openedMapFiles.delete(id);
          openedMapsChanged = true;
          return null;
        }
      }),
    )
  ).filter(Boolean);
  if (openedMapsChanged) await persistOpenedMapFiles();
  const maps = [...externalMaps, ...storedMaps.filter(Boolean)];
  maps.sort((left, right) => right.updatedAt - left.updatedAt || left.title.localeCompare(right.title, "zh-Hans-CN"));
  return { ok: true, maps };
}

async function loadMindMap(payload) {
  await ensureMindMaps();
  await readOpenedMapFiles();
  const id = payload?.id || (await listMindMaps()).maps[0]?.id;
  if (!id) return { ok: true, map: null, data: normalizeMindCodeData({ nodes: [], edges: [] }) };
  if (openedMapFiles.has(id)) {
    const loaded = await readMindMapFile(openedMapFiles.get(id), id);
    return { ok: true, ...loaded };
  }
  const filePath = mapFilePath(id);
  const loaded = await readMindMapFile(filePath, safeMapId(id));
  return { ok: true, ...loaded };
}

async function saveMindMap(payload) {
  await readOpenedMapFiles();
  if (payload?.id && openedMapFiles.has(payload.id)) {
    const filePath = openedMapFiles.get(payload.id);
    const normalized = normalizeMindCodeData(payload?.data);
    const mapTitle = String(payload?.title || mapTitleFromData(normalized)).trim() || titleFromMapPath(filePath);
    const serialized = serializeMindMapMarkdown({ title: mapTitle, data: normalized });
    assertTextByteLimit(serialized, mindMapFileByteLimit, "导图文件");
    await fs.writeFile(filePath, serialized, "utf8");
    const stats = await fs.stat(filePath);
    return {
      ok: true,
      map: { id: payload.id, title: mapTitle, filePath, updatedAt: stats.mtimeMs, external: true },
      data: normalized,
    };
  }

  const result = await writeMindMapFile({
    id: payload?.id,
    title: payload?.title,
    data: payload?.data,
    create: !payload?.id,
  });
  return { ok: true, map: { id: result.id, title: result.title, filePath: result.filePath, updatedAt: result.updatedAt }, data: result.data };
}

async function createMindMap(payload) {
  const title = String(payload?.title || "Untitled Mind Map").trim() || "Untitled Mind Map";
  const data = payload?.data || {
    nodes: [
      {
        id: title,
        label: title,
        category: "core",
        desc: "新的思维导图中心主题。",
      },
    ],
    edges: [],
  };
  const result = await writeMindMapFile({ title, data, create: true });
  return { ok: true, map: { id: result.id, title: result.title, filePath: result.filePath, updatedAt: result.updatedAt }, data: result.data };
}

async function deleteMindMap(payload) {
  await ensureMindMaps();
  await readOpenedMapFiles();
  const id = payload?.id;
  if (!id) throw new Error("请选择要删除的思维导图。");

  if (openedMapFiles.has(id)) {
    openedMapFiles.delete(id);
    await persistOpenedMapFiles();
  } else {
    await fs.unlink(mapFilePath(id));
  }

  return listMindMaps();
}

async function exportMindMapFile(payload) {
  const normalized = normalizeMindCodeData(payload?.data);
  const title = String(payload?.title || mapTitleFromData(normalized)).trim() || "MindCode Map";
  const result = await dialog.showSaveDialog(mainWindow, {
    title: "导出 MindCode 导图",
    defaultPath: safeMapFileName(title),
    filters: mapFileFilters,
  });
  if (result.canceled || !result.filePath) return { canceled: true };

  const filePath = ensureMindMapExtension(result.filePath);
  const serialized = serializeMindMapMarkdown({ title, data: normalized });
  assertTextByteLimit(serialized, mindMapFileByteLimit, "导图文件");
  await fs.writeFile(filePath, serialized, "utf8");
  return { ok: true, filePath };
}

async function importMindMapFile() {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "导入 MindCode 导图",
    properties: ["openFile"],
    filters: mapFileFilters,
  });
  const filePath = result.filePaths?.[0];
  if (result.canceled || !filePath) return { canceled: true };

  assertMindMapExtension(filePath);
  const loaded = await readMindMapFile(filePath);
  const imported = await writeMindMapFile({
    title: loaded.map.title || titleFromMapPath(filePath),
    data: loaded.data,
    create: true,
  });
  return {
    ok: true,
    sourceFilePath: filePath,
    map: { id: imported.id, title: imported.title, filePath: imported.filePath, updatedAt: imported.updatedAt },
    data: imported.data,
  };
}

async function openMindMapFile() {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "打开 MindCode 导图",
    properties: ["openFile"],
    filters: mapFileFilters,
  });
  const filePath = result.filePaths?.[0];
  if (result.canceled || !filePath) return { canceled: true };

  const resolvedPath = path.resolve(filePath);
  assertMindMapExtension(resolvedPath);
  const id = externalMapId(resolvedPath);
  const loaded = await readMindMapFile(resolvedPath, id);
  await registerOpenedMapFile(resolvedPath);
  return { ok: true, map: { ...loaded.map, external: true }, data: loaded.data };
}

async function exportData(data) {
  return exportMindMapFile({ data, title: mapTitleFromData(data, `MindCode-${fileTimestamp()}`) });
}

async function importData() {
  return importMindMapFile();
}

function skipDocumentFolder(name) {
  return ignoredDocumentFolders.has(name) || name.startsWith(".");
}

function supportedDocumentExtension(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  return textDocumentExtensions.has(extension) || binaryDocumentExtensions.has(extension);
}

async function collectDocumentFiles(selectedPaths) {
  const files = [];
  let skippedFiles = 0;
  const selectedEntries = [];

  for (const selectedPath of selectedPaths) {
    const entryPath = path.resolve(selectedPath);
    const stats = await fs.stat(entryPath).catch(() => null);
    if (!stats) continue;
    selectedEntries.push({ filePath: entryPath, isDirectory: stats.isDirectory() });
  }

  const relativeRoot = documentRelativeRoot(selectedEntries);
  const pending = selectedEntries.map((entry) => entry.filePath);

  while (pending.length) {
    const entryPath = pending.shift();
    const stats = await fs.stat(entryPath).catch(() => null);
    if (!stats) continue;

    if (stats.isDirectory()) {
      const entries = await fs.readdir(entryPath, { withFileTypes: true }).catch(() => []);
      for (const entry of entries) {
        if (entry.isDirectory() && skipDocumentFolder(entry.name)) continue;
        pending.push(path.join(entryPath, entry.name));
      }
      continue;
    }

    if (!stats.isFile() || !supportedDocumentExtension(entryPath)) continue;
    if (files.length >= documentScanFileLimit) {
      skippedFiles += 1;
      continue;
    }
    files.push({
      path: entryPath,
      relativePath: documentRelativePath(entryPath, relativeRoot),
      size: stats.size,
    });
  }

  return { files, skippedFiles };
}

async function extractTextFromDocument(filePath, fileSize = null) {
  const size = Number.isFinite(fileSize) ? fileSize : (await fs.stat(filePath)).size;
  assertByteLimit(size, documentScanFileByteLimit, "文档文件");
  const extension = path.extname(filePath).toLowerCase();

  if (textDocumentExtensions.has(extension)) {
    const text = await fs.readFile(filePath, "utf8");
    return text;
  }

  if (extension === ".pdf") {
    const buffer = await fs.readFile(filePath);
    const parser = new PDFParse({ data: buffer });
    try {
      const result = await parser.getText();
      return result.text || "";
    } finally {
      await parser.destroy();
    }
  }

  if (extension === ".docx") {
    const result = await mammoth.extractRawText({ path: filePath });
    return result.value || "";
  }

  return "";
}

async function scanDocuments() {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "选择要扫描的文档或文件夹",
    properties: ["openFile", "openDirectory", "multiSelections"],
    filters: [
      {
        name: "Documents",
        extensions: ["md", "txt", "js", "jsx", "ts", "tsx", "py", "json", "css", "html", "pdf", "docx"],
      },
    ],
  });

  if (result.canceled || !result.filePaths?.length) return { canceled: true };

  const { files, skippedFiles } = await collectDocumentFiles(result.filePaths);
  const documents = [];
  const failed = [];
  let totalCharacters = 0;

  for (const file of files) {
    const filePath = file.path;
    try {
      const rawText = (await extractTextFromDocument(filePath, file.size)).trim();
      if (!rawText) continue;
      const remaining = Math.max(0, documentScanTotalCharLimit - totalCharacters);
      if (!remaining) break;
      const text = rawText.slice(0, Math.min(documentScanCharLimit, remaining));
      totalCharacters += text.length;
      documents.push({
        name: path.basename(filePath),
        path: filePath,
        relativePath: file.relativePath,
        size: file.size,
        extension: path.extname(filePath).toLowerCase(),
        text,
        truncated: rawText.length > text.length,
      });
    } catch (error) {
      failed.push({ path: filePath, error: error.message });
    }
  }

  const warnings = [];
  if (skippedFiles) warnings.push(`已读取前 ${documentScanFileLimit} 个支持的文件。`);
  if (documents.some((document) => document.truncated)) warnings.push(`超长文档按每个 ${documentScanCharLimit} 字符截断。`);
  if (totalCharacters >= documentScanTotalCharLimit) warnings.push(`本次扫描总文本已限制在 ${documentScanTotalCharLimit} 字符。`);
  if (failed.some((item) => item.error?.includes("超过"))) warnings.push(`超过 ${formatBytes(documentScanFileByteLimit)} 的文件已跳过。`);
  if (failed.length) warnings.push(`${failed.length} 个文件解析失败，已跳过。`);

  return {
    ok: true,
    documents,
    failed,
    warning: warnings.join(" "),
  };
}

function normalizeExtractConceptPayload(payload) {
  const text = String(payload?.text || "");
  if (text.length > extractConceptTextLimit) {
    throw new Error(`提取文本超过 ${extractConceptTextLimit} 字符，请缩小扫描范围后重试。`);
  }
  const existingLabels = Array.isArray(payload?.existingLabels)
    ? payload.existingLabels
        .slice(0, extractConceptLabelLimit)
        .map((label) => String(label || "").trim().slice(0, extractConceptLabelCharLimit))
        .filter(Boolean)
    : [];
  return { text, existingLabels };
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
ipcMain.handle("maps:list", listMindMaps);
ipcMain.handle("maps:load", async (_event, payload) => loadMindMap(payload));
ipcMain.handle("maps:save", async (_event, payload) => saveMindMap(payload));
ipcMain.handle("maps:create", async (_event, payload) => createMindMap(payload));
ipcMain.handle("maps:delete", async (_event, payload) => deleteMindMap(payload));
ipcMain.handle("maps:export", async (_event, payload) => exportMindMapFile(payload));
ipcMain.handle("maps:import", importMindMapFile);
ipcMain.handle("maps:open-file", openMindMapFile);
ipcMain.handle("ai:get-config-status", getAiConfigStatus);
ipcMain.handle("ai:save-api-key", async (_event, payload) => saveAiApiKey(payload));
ipcMain.handle("ai:clear-api-key", clearAiApiKey);
ipcMain.handle("ai:show-missing-key-dialog", showMissingAiKeyDialog);
ipcMain.handle("documents:scan", scanDocuments);
ipcMain.handle("extract:concepts", async (_event, payload) => {
  const { text, existingLabels } = normalizeExtractConceptPayload(payload);
  const aiConfig = await readAiConfig();

  if (payload?.requireAi && !aiConfig.apiKey) {
    throw new Error("DashScope API key required for local document scan.");
  }

  if (aiConfig.apiKey) {
    try {
      return await extractWithQwen({ text, existingLabels, apiKey: aiConfig.apiKey, model: aiConfig.model });
    } catch (error) {
      return {
        ...(await extractWithMock({ text, existingLabels })),
        warning: `千问提取失败，已使用离线提取器：${error.message}`,
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
