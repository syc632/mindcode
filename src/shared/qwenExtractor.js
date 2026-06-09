import { normalizeEdge, normalizeNode } from "./schema.js";

const dashScopeBaseUrl = "https://dashscope.aliyuncs.com/compatible-mode/v1";
export const defaultQwenModel = "qwen3.6-plus";
const qwenRequestTimeoutMs = 45_000;
const qwenNodeLimit = 18;
const qwenEdgeLimit = 60;

function cleanJsonText(value) {
  return String(value || "")
    .replace(/```json|```/g, "")
    .trim();
}

function qwenText(data) {
  return data?.choices?.[0]?.message?.content || "";
}

async function createQwenChatCompletion({ apiKey, model = defaultQwenModel, messages, maxTokens }) {
  if (!apiKey) throw new Error("Missing DashScope API key");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), qwenRequestTimeoutMs);

  let response;
  try {
    response = await fetch(`${dashScopeBaseUrl}/chat/completions`, {
      method: "POST",
      signal: controller.signal,
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
  } catch (error) {
    if (error.name === "AbortError") throw new Error("DashScope API request timed out");
    throw error;
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    throw new Error(`DashScope API returned ${response.status}`);
  }

  return response.json();
}

export async function extractWithQwen({ text, existingLabels = [], apiKey, model = defaultQwenModel }) {
  const data = await createQwenChatCompletion({
    apiKey,
    model,
    maxTokens: 1800,
    messages: [
      {
        role: "user",
        content: `从下面的本地文档/编程笔记中提取一张层级思维导图。

已有概念（不要重复）: ${existingLabels.join(", ") || "无"}

笔记内容:
${text}

要求：
- 返回 1 个中心主题，若干一级概念，必要时加入二级概念。
- 每个节点都必须有 kebab-case id。
- parentId 为空字符串表示中心主题；一级概念的 parentId 指向中心主题 id；二级概念的 parentId 指向对应一级概念 id。
- 不要为了关系额外制造 edges；edges 可为空数组。图谱主要使用 parentId。
- 总节点数控制在 6 到 18 个，优先保留真正核心的概念。
- 所有解释和复习卡内容使用中文。

严格只返回 JSON：
{"nodes":[{"id":"kebab-case-id","parentId":"","label":"概念名称","category":"async|runtime|core|tool|new","desc":"一句话解释","question":"一条适合复习卡正面的提问","answer":"适合复习卡背面的答案","codeExample":"可选的短代码示例"}],"edges":[]}`,
      },
    ],
  });

  const parsed = JSON.parse(cleanJsonText(qwenText(data)) || "{}");
  const parsedNodes = Array.isArray(parsed.nodes) ? parsed.nodes : [];
  const parsedEdges = Array.isArray(parsed.edges) ? parsed.edges : [];
  const nodes = parsedNodes.slice(0, qwenNodeLimit).map((node, index) => normalizeNode(node, `ai-${index}`));
  const ids = new Set(nodes.map((node) => node.id));
  const idByLabel = new Map(nodes.map((node) => [node.label.toLowerCase(), node.id]));
  const resolvedNodes = nodes.map((node) => {
    const parentId = String(node.parentId || "").trim();
    const labelMatchedParentId = idByLabel.get(parentId.toLowerCase()) || "";
    const resolvedParentId = ids.has(parentId) ? parentId : labelMatchedParentId;
    return {
      ...node,
      parentId: resolvedParentId && resolvedParentId !== node.id ? resolvedParentId : "",
    };
  });
  const resolvedIds = new Set(resolvedNodes.map((node) => node.id));
  const edges = parsedEdges
    .slice(0, qwenEdgeLimit)
    .map(normalizeEdge)
    .filter((edge) => resolvedIds.has(edge.from) && resolvedIds.has(edge.to));

  return { nodes: resolvedNodes, edges, provider: "qwen" };
}
