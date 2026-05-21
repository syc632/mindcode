import { normalizeEdge, normalizeNode } from "./schema.js";

export async function extractWithAnthropic({ text, existingLabels = [], apiKey }) {
  if (!apiKey) throw new Error("Missing Anthropic API key");

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-20250514",
      max_tokens: 1000,
      messages: [
        {
          role: "user",
          content: `从下面的编程笔记中提取技术概念，并识别关系。

已有概念（不要重复）: ${existingLabels.join(", ") || "无"}

笔记内容:
${text}

严格只返回 JSON：
{"nodes":[{"id":"kebab-case-id","label":"概念名称","category":"async|runtime|core|tool|new","desc":"一句话解释","question":"一条适合复习卡正面的提问","answer":"适合复习卡背面的答案","codeExample":"可选的短代码示例"}],"edges":[{"from":"id1","to":"id2","label":"关系描述"}]}`,
        },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`Anthropic API returned ${response.status}`);
  }

  const data = await response.json();
  const raw = data.content?.[0]?.text || "{}";
  const clean = raw.replace(/```json|```/g, "").trim();
  const parsed = JSON.parse(clean);
  const nodes = (parsed.nodes || []).slice(0, 5).map((node, index) => normalizeNode(node, `ai-${index}`));
  const ids = new Set(nodes.map((node) => node.id));
  const edges = (parsed.edges || [])
    .map(normalizeEdge)
    .filter((edge) => ids.has(edge.from) || ids.has(edge.to));

  return { nodes, edges, provider: "anthropic" };
}
