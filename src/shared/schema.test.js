import { describe, expect, it } from "vitest";
import { mindCodeLabelCharLimit, mindCodeTextCharLimit, normalizeMindCodeData, normalizeNode } from "./schema.js";

describe("schema", () => {
  it("keeps review card fields and source notes on nodes", () => {
    const node = normalizeNode({
      label: "Promise.race",
      desc: "返回最先完成的 Promise 结果。",
      question: "Promise.race 返回什么？",
      answer: "第一个 settled Promise 的结果。",
      codeExample: "await Promise.race(tasks)",
      sources: [{ text: "笔记片段", createdAt: 123 }],
    });

    expect(node.question).toBe("Promise.race 返回什么？");
    expect(node.answer).toBe("第一个 settled Promise 的结果。");
    expect(node.codeExample).toBe("await Promise.race(tasks)");
    expect(node.cards).toHaveLength(1);
    expect(node.cards[0].question).toBe("Promise.race 返回什么？");
    expect(node.sources).toEqual([{ text: "笔记片段", createdAt: 123 }]);
  });

  it("backs card fields with the concept description during data normalization", () => {
    const data = normalizeMindCodeData({
      nodes: [{ id: "closure", label: "Closure", desc: "词法作用域被保留。" }],
      edges: [],
    });

    expect(data.nodes[0].question).toBe("如何解释 Closure？");
    expect(data.nodes[0].answer).toBe("词法作用域被保留。");
    expect(data.nodes[0].cards).toHaveLength(1);
  });

  it("keeps independent review schedules for multiple cards", () => {
    const node = normalizeNode({
      label: "Event Loop",
      desc: "任务调度机制。",
      cards: [
        { id: "definition", question: "Event Loop 是什么？", answer: "任务调度机制。", nextReview: 10 },
        { id: "order", question: "微任务何时执行？", answer: "当前同步任务结束后。", nextReview: 20 },
      ],
    });

    expect(node.cards.map((card) => card.id)).toEqual(["definition", "order"]);
    expect(node.cards.map((card) => card.nextReview)).toEqual([10, 20]);
  });

  it("deduplicates colliding node ids and remaps parent and edge references", () => {
    const data = normalizeMindCodeData({
      nodes: [
        { label: "C++", desc: "系统编程语言。" },
        { label: "C#", parentId: "C++", desc: ".NET 语言。" },
        { label: "Runtime", parentId: "C#", desc: "运行环境。" },
      ],
      edges: [{ from: "C++", to: "Runtime", label: "关联" }],
    });

    expect(data.nodes.map((node) => node.id)).toEqual(["c", "c-2", "runtime"]);
    expect(data.nodes.find((node) => node.id === "c-2")?.parentId).toBe("c");
    expect(data.nodes.find((node) => node.id === "runtime")?.parentId).toBe("c");
    expect(data.edges[0]).toMatchObject({ from: "c", to: "runtime", label: "关联" });
  });

  it("limits persisted text fields during normalization", () => {
    const node = normalizeNode({
      label: "L".repeat(mindCodeLabelCharLimit + 10),
      desc: "D".repeat(mindCodeTextCharLimit + 10),
      sources: [{ text: "S".repeat(mindCodeTextCharLimit + 10) }],
    });

    expect(node.label).toHaveLength(mindCodeLabelCharLimit);
    expect(node.desc).toHaveLength(mindCodeTextCharLimit);
    expect(node.sources[0].text).toHaveLength(mindCodeTextCharLimit);
  });
});
