import { describe, expect, it } from "vitest";
import { extractWithMock } from "./mockExtractor.js";

describe("extractWithMock", () => {
  it("extracts known concepts and avoids existing labels", async () => {
    const result = await extractWithMock({
      text: "Promise.all 和 async/await 都依赖 Promise，回调会进入 Microtask Queue。",
      existingLabels: ["Promise"],
    });

    expect(result.provider).toBe("mock");
    expect(result.nodes.some((node) => node.label === "Promise")).toBe(false);
    expect(result.nodes.some((node) => node.label === "Promise.all")).toBe(true);
    expect(result.nodes.every((node) => node.id && node.desc)).toBe(true);
  });

  it("returns valid edges only between extracted nodes", async () => {
    const result = await extractWithMock({
      text: "Electron 使用 IPC 连接主进程和渲染进程，React 负责界面。",
      existingLabels: [],
    });

    const ids = new Set(result.nodes.map((node) => node.id));
    expect(result.edges.every((edge) => ids.has(edge.from) && ids.has(edge.to))).toBe(true);
  });
});
