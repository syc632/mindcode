import { afterEach, describe, expect, it, vi } from "vitest";
import { extractWithQwen } from "./qwenExtractor.js";

function mockQwenResponse(content) {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      choices: [{ message: { content } }],
    }),
  }));
}

describe("qwenExtractor", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("parses concept extraction JSON from Qwen chat completions", async () => {
    mockQwenResponse(
      JSON.stringify({
        nodes: [
          {
            id: "promise-all",
            label: "Promise.all",
            category: "async",
            desc: "等待多个 Promise 完成。",
            question: "Promise.all 什么时候 reject？",
            answer: "任意一个输入 Promise reject 时 reject。",
          },
        ],
        edges: [{ from: "promise-all", to: "promise-all", label: "自测关系" }],
      }),
    );

    const result = await extractWithQwen({
      text: "Promise.all 会等待多个 Promise。",
      existingLabels: [],
      apiKey: "sk-test",
    });

    expect(result.provider).toBe("qwen");
    expect(result.nodes[0].label).toBe("Promise.all");
    expect(result.edges[0].label).toBe("自测关系");
    expect(global.fetch).toHaveBeenCalledWith(
      "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
      expect.objectContaining({
        method: "POST",
        signal: expect.any(AbortSignal),
        headers: expect.objectContaining({ Authorization: "Bearer sk-test" }),
        body: expect.stringContaining('"model":"qwen3.6-plus"'),
      }),
    );
  });

  it("treats malformed node and edge collections as empty results", async () => {
    mockQwenResponse(JSON.stringify({ nodes: { id: "not-array" }, edges: { from: "a" } }));

    const result = await extractWithQwen({
      text: "内容",
      existingLabels: [],
      apiKey: "sk-test",
    });

    expect(result.nodes).toEqual([]);
    expect(result.edges).toEqual([]);
  });
});
