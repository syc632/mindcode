import { spawn } from "node:child_process";
import process from "node:process";
import { createServer } from "vite";

const isWindows = process.platform === "win32";
const npmBin = isWindows ? "npm.cmd" : "npm";
const electronBin = isWindows ? "electron.cmd" : "electron";
const preferredPort = Number(process.env.MINDCODE_DEV_PORT || 5173);

const server = await createServer({
  server: {
    host: "127.0.0.1",
    port: preferredPort,
    strictPort: false,
  },
});

await server.listen();
server.printUrls();

const localUrls = server.resolvedUrls?.local || [];
const devUrl = (localUrls.find((url) => url.includes("127.0.0.1")) || localUrls[0] || `http://127.0.0.1:${preferredPort}/`).replace(
  /\/$/,
  "",
);

const electron = spawn(npmBin, ["exec", "--", electronBin, "."], {
  stdio: "inherit",
  env: {
    ...process.env,
    VITE_DEV_SERVER_URL: devUrl,
  },
});

async function shutdown(code = 0) {
  await server.close();
  process.exit(code);
}

electron.on("exit", (code) => {
  shutdown(code ?? 0);
});

process.on("SIGINT", () => {
  electron.kill("SIGTERM");
  shutdown(0);
});

process.on("SIGTERM", () => {
  electron.kill("SIGTERM");
  shutdown(0);
});
