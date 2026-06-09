import { describe, expect, it } from "vitest";
import { mindMapJsonBlockCharLimit, parseMindMapMarkdown, serializeMindMapMarkdown } from "./mindMapMarkdown.js";

describe("mindMapMarkdown", () => {
  it("round-trips full MindCode data through the app data block", () => {
    const data = {
      nodes: [
        {
          id: "ai-systems",
          label: "AI Systems",
          parentId: "",
          desc: "AI 系统中心主题。",
          sources: [{ text: "local-doc.md", createdAt: 1 }],
          cards: [{ id: "card-1", question: "什么是 AI Systems？", answer: "围绕模型、数据和评估构建的系统。" }],
        },
        {
          id: "retrieval",
          label: "Retrieval",
          parentId: "ai-systems",
          desc: "从外部知识中检索上下文。",
        },
      ],
      edges: [{ id: "legacy-edge", from: "ai-systems", to: "retrieval", label: "兼容旧关系" }],
    };

    const markdown = serializeMindMapMarkdown({ title: "AI Systems", data });
    const parsed = parseMindMapMarkdown(markdown, "Fallback");

    expect(parsed.title).toBe("AI Systems");
    expect(parsed.data.nodes).toHaveLength(2);
    expect(parsed.data.nodes.find((node) => node.id === "retrieval")?.parentId).toBe("ai-systems");
    expect(parsed.data.nodes.find((node) => node.id === "ai-systems")?.sources[0].text).toBe("local-doc.md");
    expect(parsed.data.edges[0].label).toBe("兼容旧关系");
  });

  it("imports a basic hierarchy from markdown headings without a data block", () => {
    const parsed = parseMindMapMarkdown(`# AI Knowledge

## Models
### Transformers
## Evaluation
`, "Fallback");

    const models = parsed.data.nodes.find((node) => node.label === "Models");
    const transformers = parsed.data.nodes.find((node) => node.label === "Transformers");

    expect(parsed.title).toBe("AI Knowledge");
    expect(models?.parentId).toBe("ai-knowledge");
    expect(transformers?.parentId).toBe(models?.id);
  });

  it("rejects oversized embedded map data blocks", () => {
    const markdown = `# Oversized

\`\`\`mindcode-json
${" ".repeat(mindMapJsonBlockCharLimit + 1)}
\`\`\`
`;

    expect(() => parseMindMapMarkdown(markdown, "Fallback")).toThrow("导图 JSON 数据块超过");
  });
});
