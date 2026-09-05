import { describe, expect, it } from "vitest";
import { extractWithMock } from "./mockExtractor.js";

describe("extractWithMock", () => {
  it("extracts known concepts and avoids existing labels", async () => {
    const result = await extractWithMock({
      text: "Promise.all and async/await both rely on Promise, and callbacks enter the Microtask Queue.",
      existingLabels: ["Promise"],
    });

    expect(result.provider).toBe("mock");
    expect(result.nodes.some((node) => node.label === "Promise")).toBe(false);
    expect(result.nodes.some((node) => node.label === "Promise.all")).toBe(true);
    expect(result.nodes.every((node) => node.id && node.desc)).toBe(true);
  });

  it("returns valid edges only between extracted nodes", async () => {
    const result = await extractWithMock({
      text: "Electron uses IPC to connect the main process and renderer process, while React handles the interface.",
      existingLabels: [],
    });

    const ids = new Set(result.nodes.map((node) => node.id));
    expect(result.edges.every((edge) => ids.has(edge.from) && ids.has(edge.to))).toBe(true);
  });
});
