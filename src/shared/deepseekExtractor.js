import { normalizeEdge, normalizeNode } from "./schema.js";
import { limitToTwoSentences } from "./obsidian.js";

const deepSeekBaseUrl = "https://api.deepseek.com";
export const defaultDeepSeekModel = "deepseek-v4-flash";

function cleanJsonText(value) {
  return String(value || "")
    .replace(/```json|```/g, "")
    .trim();
}

function deepSeekText(data) {
  return data?.choices?.[0]?.message?.content || "";
}

async function createDeepSeekChatCompletion({ apiKey, model = defaultDeepSeekModel, messages, maxTokens }) {
  if (!apiKey) throw new Error("Missing DeepSeek API key");

  const response = await fetch(`${deepSeekBaseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages,
      max_tokens: maxTokens,
      stream: false,
    }),
  });

  if (!response.ok) {
    throw new Error(`DeepSeek API returned ${response.status}`);
  }

  return response.json();
}

export async function extractWithDeepSeek({ text, existingLabels = [], apiKey, model = defaultDeepSeekModel }) {
  const data = await createDeepSeekChatCompletion({
    apiKey,
    model,
    maxTokens: 1000,
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
  });

  const parsed = JSON.parse(cleanJsonText(deepSeekText(data)) || "{}");
  const nodes = (parsed.nodes || []).slice(0, 5).map((node, index) => normalizeNode(node, `ai-${index}`));
  const ids = new Set(nodes.map((node) => node.id));
  const edges = (parsed.edges || [])
    .map(normalizeEdge)
    .filter((edge) => ids.has(edge.from) || ids.has(edge.to));

  return { nodes, edges, provider: "deepseek" };
}

export async function summarizeObsidianNotesWithDeepSeek({ notes = [], apiKey, model = defaultDeepSeekModel }) {
  const sourceNotes = notes
    .map((note) => ({
      path: String(note?.path || note?.name || "未命名笔记").trim(),
      content: String(note?.content || "").trim(),
    }))
    .filter((note) => note.path && note.content);

  if (!sourceNotes.length) return { notes: [], provider: "deepseek" };

  const data = await createDeepSeekChatCompletion({
    apiKey,
    model,
    maxTokens: 1200,
    messages: [
      {
        role: "user",
        content: `请总结下面的 Obsidian 编程学习笔记，用于制作概念复习卡。

要求：
- 每篇笔记单独总结。
- 每篇 summary 必须是中文，最多两句话。
- 只保留适合做编程概念卡片的核心含义、关键机制、常见误区或代码行为。
- 不要复述无关叙事、日记、链接、标签或格式说明。

严格只返回 JSON：
{"notes":[{"path":"原路径","summary":"最多两句话"}]}

笔记：
${JSON.stringify(sourceNotes)}`,
      },
    ],
  });

  const parsed = JSON.parse(cleanJsonText(deepSeekText(data)) || "{}");
  const summariesByPath = new Map(
    (parsed.notes || [])
      .map((note) => [String(note?.path || "").trim(), limitToTwoSentences(note?.summary || "")])
      .filter(([path, summary]) => path && summary),
  );

  const summarized = sourceNotes
    .map((note) => ({
      path: note.path,
      summary: summariesByPath.get(note.path) || "",
    }))
    .filter((note) => note.summary);

  if (!summarized.length) {
    throw new Error("DeepSeek 没有返回可用摘要");
  }

  return { notes: summarized, provider: "deepseek" };
}
