import { app, BrowserWindow, ipcMain } from "electron";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { seedData } from "../src/shared/seedData.js";
import { extractWithAnthropic } from "../src/shared/anthropicExtractor.js";
import { extractWithMock } from "../src/shared/mockExtractor.js";
import { normalizeMindCodeData } from "../src/shared/schema.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDev = Boolean(process.env.VITE_DEV_SERVER_URL);

let mainWindow;

function dataPath() {
  return path.join(app.getPath("userData"), "mindcode-data.json");
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

async function writeData(data) {
  const normalized = normalizeMindCodeData(data);
  await fs.mkdir(path.dirname(dataPath()), { recursive: true });
  await fs.writeFile(dataPath(), `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
  return { ok: true };
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
ipcMain.handle("extract:concepts", async (_event, payload) => {
  const text = payload?.text ?? "";
  const existingLabels = payload?.existingLabels ?? [];
  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (apiKey) {
    try {
      return await extractWithAnthropic({ text, existingLabels, apiKey });
    } catch (error) {
      return {
        ...(await extractWithMock({ text, existingLabels })),
        warning: `Anthropic 提取失败，已使用离线提取器：${error.message}`,
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
