import { describe, expect, it } from "vitest";
import { mindCodeLabelCharLimit, mindCodeTextCharLimit, normalizeMindCodeData, normalizeNode } from "./schema.js";

describe("schema", () => {
  it("keeps review card fields and source notes on nodes", () => {
    const node = normalizeNode({
      label: "Promise.race",
      desc: "Returns the first Promise result to settle.",
      question: "What does Promise.race return?",
      answer: "The result of the first settled Promise.",
      codeExample: "await Promise.race(tasks)",
      sources: [{ text: "note snippet", createdAt: 123 }],
    });

    expect(node.question).toBe("What does Promise.race return?");
    expect(node.answer).toBe("The result of the first settled Promise.");
    expect(node.codeExample).toBe("await Promise.race(tasks)");
    expect(node.cards).toHaveLength(1);
    expect(node.cards[0].question).toBe("What does Promise.race return?");
    expect(node.sources).toEqual([{ text: "note snippet", createdAt: 123 }]);
  });

  it("backs card fields with the concept description during data normalization", () => {
    const data = normalizeMindCodeData({
      nodes: [{ id: "closure", label: "Closure", desc: "Lexical scope is preserved." }],
      edges: [],
    });

    expect(data.nodes[0].question).toBe("How would you explain Closure?");
    expect(data.nodes[0].answer).toBe("Lexical scope is preserved.");
    expect(data.nodes[0].cards).toHaveLength(1);
  });

  it("keeps independent review schedules for multiple cards", () => {
    const node = normalizeNode({
      label: "Event Loop",
      desc: "Task scheduling mechanism.",
      cards: [
        { id: "definition", question: "What is the Event Loop?", answer: "Task scheduling mechanism.", nextReview: 10 },
        { id: "order", question: "When do microtasks run?", answer: "After the current synchronous task finishes.", nextReview: 20 },
      ],
    });

    expect(node.cards.map((card) => card.id)).toEqual(["definition", "order"]);
    expect(node.cards.map((card) => card.nextReview)).toEqual([10, 20]);
  });

  it("does not truncate large generated card sets on a node", () => {
    const cards = Array.from({ length: 75 }, (_item, index) => ({
      id: `card-${index}`,
      question: `Question ${index}?`,
      answer: `Answer ${index}.`,
    }));

    const node = normalizeNode({
      label: "Large Topic",
      desc: "A topic with many generated facts.",
      cards,
    });

    expect(node.cards).toHaveLength(75);
    expect(node.cards[74].question).toBe("Question 74?");
  });

  it("deduplicates colliding node ids and remaps parent and edge references", () => {
    const data = normalizeMindCodeData({
      nodes: [
        { label: "C++", desc: "Systems programming language." },
        { label: "C#", parentId: "C++", desc: ".NET language." },
        { label: "Runtime", parentId: "C#", desc: "Runtime environment." },
      ],
      edges: [{ from: "C++", to: "Runtime", label: "Related" }],
    });

    expect(data.nodes.map((node) => node.id)).toEqual(["c", "c-2", "runtime"]);
    expect(data.nodes.find((node) => node.id === "c-2")?.parentId).toBe("c");
    expect(data.nodes.find((node) => node.id === "runtime")?.parentId).toBe("c");
    expect(data.edges[0]).toMatchObject({ from: "c", to: "runtime", label: "Related" });
  });

  it("translates legacy built-in demo content during normalization", () => {
    const data = normalizeMindCodeData({
      nodes: [
        {
          id: "promise",
          label: "Promise",
          desc: "\u8868\u793a\u4e00\u4e2a\u5f02\u6b65\u64cd\u4f5c\u7684\u6700\u7ec8\u5b8c\u6210\u6216\u5931\u8d25\uff0c\u4ee5\u53ca\u5176\u7ed3\u679c\u503c\u3002",
          cards: [
            {
              id: "card-1",
              question: "\u5982\u4f55\u89e3\u91ca Promise\uff1f",
              answer: "\u8868\u793a\u4e00\u4e2a\u5f02\u6b65\u64cd\u4f5c\u7684\u6700\u7ec8\u5b8c\u6210\u6216\u5931\u8d25\uff0c\u4ee5\u53ca\u5176\u7ed3\u679c\u503c\u3002",
            },
          ],
        },
        { id: "async-await", label: "async/await" },
      ],
      edges: [{ id: "edge-promise-async-await", from: "promise", to: "async-await", label: "\u8bed\u6cd5\u7cd6" }],
    });

    expect(data.nodes[0].desc).toBe("Represents the eventual completion or failure of an asynchronous operation and its result value.");
    expect(data.nodes[0].question).toBe("How would you explain Promise?");
    expect(data.nodes[0].answer).toBe("Represents the eventual completion or failure of an asynchronous operation and its result value.");
    expect(data.edges[0].label).toBe("Sugar");
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
