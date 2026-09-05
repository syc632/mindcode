import { afterEach, describe, expect, it, vi } from "vitest";
import { extractWithQwen, qwenRequestTimeoutMs } from "./qwenExtractor.js";

function mockQwenResponse(content, choicePatch = {}) {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      choices: [{ message: { content }, ...choicePatch }],
    }),
  }));
}

describe("qwenExtractor", () => {
  afterEach(() => {
    vi.useRealTimers();
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
            desc: "Waits for multiple Promises to complete.",
            question: "When does Promise.all reject?",
            answer: "It rejects when any input Promise rejects.",
            cards: [
              {
                id: "rejects",
                question: "When does Promise.all reject?",
                answer: "It rejects when any input Promise rejects.",
              },
              {
                id: "fulfills",
                question: "When does Promise.all fulfill?",
                answer: "It fulfills when all input Promises fulfill.",
              },
            ],
            sourceSummary: "The notes say Promise.all waits for multiple Promises.",
            evidenceQuote: "Promise.all waits for multiple Promises.",
          },
        ],
        edges: [{ from: "promise-all", to: "promise-all", label: "Self check" }],
      }),
    );

    const result = await extractWithQwen({
      text: "Promise.all waits for multiple Promises.",
      existingLabels: [],
      apiKey: "sk-test",
    });

    expect(result.provider).toBe("qwen");
    expect(result.nodes[0].label).toBe("Promise.all");
    expect(result.nodes[0].cards).toHaveLength(2);
    expect(result.nodes[0].cards[1].question).toBe("When does Promise.all fulfill?");
    expect(result.nodes[0].sources[0].text).toContain("Summary: The notes say Promise.all waits for multiple Promises.");
    expect(result.nodes[0].sources[0].text).toContain("Evidence: Promise.all waits for multiple Promises.");
    expect(result.edges[0].label).toBe("Self check");
    expect(global.fetch).toHaveBeenCalledWith(
      "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
      expect.objectContaining({
        method: "POST",
        signal: expect.any(AbortSignal),
        headers: expect.objectContaining({ Authorization: "Bearer sk-test" }),
        body: expect.stringContaining('"model":"qwen3.6-plus"'),
      }),
    );
    expect(JSON.parse(global.fetch.mock.calls[0][1].body).response_format).toEqual({ type: "json_object" });
    expect(JSON.parse(global.fetch.mock.calls[0][1].body).max_tokens).toBe(12000);
  });

  it("treats malformed node and edge collections as empty results", async () => {
    mockQwenResponse(JSON.stringify({ nodes: { id: "not-array" }, edges: { from: "a" } }));

    const result = await extractWithQwen({
      text: "content",
      existingLabels: [],
      apiKey: "sk-test",
    });

    expect(result.nodes).toEqual([]);
    expect(result.edges).toEqual([]);
  });

  it("parses JSON even when Qwen wraps it in surrounding text", async () => {
    mockQwenResponse(`Here is the JSON:\n${JSON.stringify({
      nodes: [{ id: "event-loop", label: "Event Loop", desc: "Schedules asynchronous work." }],
      edges: [],
    })}`);

    const result = await extractWithQwen({
      text: "The event loop schedules asynchronous work.",
      existingLabels: [],
      apiKey: "sk-test",
    });

    expect(result.nodes[0].label).toBe("Event Loop");
  });

  it("does not truncate Qwen nodes to the old small extraction limit", async () => {
    const nodes = Array.from({ length: 25 }, (_item, index) => ({
      id: `concept-${index}`,
      label: `Concept ${index}`,
      desc: `Concept ${index} description.`,
      cards: [
        {
          id: `card-${index}`,
          question: `Question ${index}?`,
          answer: `Answer ${index}.`,
        },
      ],
    }));
    mockQwenResponse(JSON.stringify({ nodes, edges: [] }));

    const result = await extractWithQwen({
      text: "A document with many concepts.",
      existingLabels: [],
      apiKey: "sk-test",
    });

    expect(result.nodes).toHaveLength(25);
    expect(result.nodes[24].label).toBe("Concept 24");
  });

  it("reports a clear error when Qwen truncates the JSON response", async () => {
    mockQwenResponse('{"nodes":[', { finish_reason: "length" });

    await expect(
      extractWithQwen({
        text: "large document",
        existingLabels: [],
        apiKey: "sk-test",
      }),
    ).rejects.toThrow("response was truncated");
  });

  it("keeps long Qwen requests alive until the configured timeout", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn((_url, options) =>
        new Promise((_resolve, reject) => {
          options.signal.addEventListener("abort", () => {
            const error = new Error("Aborted");
            error.name = "AbortError";
            reject(error);
          });
        }),
      ),
    );

    const result = extractWithQwen({
      text: "large document",
      existingLabels: [],
      apiKey: "sk-test",
    });
    const handledResult = result.catch((error) => error);

    await vi.advanceTimersByTimeAsync(qwenRequestTimeoutMs - 1);
    expect(global.fetch).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    const error = await handledResult;
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toContain("timed out after 120 seconds");
  });
});
