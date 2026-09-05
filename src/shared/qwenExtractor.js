import { normalizeEdge, normalizeNode } from "./schema.js";

const dashScopeBaseUrl = "https://dashscope.aliyuncs.com/compatible-mode/v1";
export const defaultQwenModel = "qwen3.6-plus";
export const qwenRequestTimeoutMs = 120_000;
const qwenEdgeLimit = 60;

function cleanJsonText(value) {
  return String(value || "")
    .replace(/```json|```/g, "")
    .trim();
}

function qwenText(data) {
  return data?.choices?.[0]?.message?.content || "";
}

function qwenFinishReason(data) {
  return data?.choices?.[0]?.finish_reason || "";
}

function parseQwenJson(text) {
  const cleaned = cleanJsonText(text);
  if (!cleaned) return {};

  try {
    return JSON.parse(cleaned);
  } catch {
    const jsonStart = cleaned.indexOf("{");
    const jsonEnd = cleaned.lastIndexOf("}");
    if (jsonStart >= 0 && jsonEnd > jsonStart) {
      try {
        return JSON.parse(cleaned.slice(jsonStart, jsonEnd + 1));
      } catch {
        // Fall through to the friendlier extraction error below.
      }
    }
    throw new Error("DashScope API returned invalid JSON. Try again or reduce the scan scope.");
  }
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
        response_format: { type: "json_object" },
        stream: false,
      }),
    });
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error("DashScope API request timed out after 120 seconds. Try a smaller document or narrower scan scope.");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    throw new Error(`DashScope API returned ${response.status}`);
  }

  return response.json();
}

function sourceTextFromParsedNode(node) {
  const sourceSummary = String(node?.sourceSummary || "").trim();
  const evidenceQuote = String(node?.evidenceQuote || "").trim();
  const parts = [
    sourceSummary ? `Summary: ${sourceSummary}` : "",
    evidenceQuote ? `Evidence: ${evidenceQuote}` : "",
  ].filter(Boolean);
  return parts.join("\n");
}

export async function extractWithQwen({ text, existingLabels = [], apiKey, model = defaultQwenModel }) {
  const data = await createQwenChatCompletion({
    apiKey,
    model,
    maxTokens: 12000,
    messages: [
      {
        role: "user",
        content: `Extract a hierarchical mind map from the local documents or programming notes below.

Existing concepts (do not duplicate): ${existingLabels.join(", ") || "none"}

Notes:
${text}

Requirements:
- Use only information explicitly supported by Notes. Do not use outside knowledge.
- Extract comprehensively. Do not compress the document into only a few high-level concepts.
- Do not cap the number of nodes or review cards to an arbitrary small number.
- Cover every distinct concept, definition, rule, workflow step, caveat, API, command, example, tradeoff, and relationship explicitly present in Notes.
- Return 1 central topic, first-level concepts, and second-level concepts when useful.
- Every node must have a kebab-case id.
- An empty parentId means the central topic; first-level concepts point parentId to the central topic id; second-level concepts point parentId to the matching first-level concept id.
- Do not invent edges just to show hierarchy; edges can be an empty array. The graph primarily uses parentId.
- All explanations and review card content must be in English.
- Every node must include cards: a non-empty array of review cards.
- Generate as many review cards as needed to preserve the source knowledge instead of merging many facts into one broad card.
- Prefer focused atomic cards: one testable fact, rule, caveat, or example per card.
- If one concept has multiple important facts, keep one node and add multiple cards to that node.
- Also include top-level question, answer, and codeExample fields matching the first card for backward compatibility.
- Every node must include sourceSummary: one short sentence summarizing the exact part of Notes that supports this node.
- Every node must include evidenceQuote: a short exact quote or near-exact phrase from Notes. Keep the original source language for evidenceQuote.
- Do not reuse the same generic document introduction, cover page, or table of contents as evidence for unrelated nodes.
- If Notes do not directly support a node, do not include that node.

Return JSON only:
{"nodes":[{"id":"kebab-case-id","parentId":"","label":"Concept Name","category":"async|runtime|core|tool|new","desc":"One-sentence explanation","question":"First card question","answer":"First card answer","codeExample":"Optional first card code example","cards":[{"id":"short-card-id","question":"Focused review question","answer":"Focused review answer","codeExample":"Optional short code example"}],"sourceSummary":"Node-specific summary grounded in Notes","evidenceQuote":"Short quote from Notes"}],"edges":[]}`,
      },
    ],
  });

  if (qwenFinishReason(data) === "length") {
    throw new Error("DashScope API response was truncated. Try a smaller document or narrower scan scope.");
  }

  const parsed = parseQwenJson(qwenText(data));
  const parsedNodes = Array.isArray(parsed.nodes) ? parsed.nodes : [];
  const parsedEdges = Array.isArray(parsed.edges) ? parsed.edges : [];
  const nodes = parsedNodes.map((node, index) => {
    const sourceText = sourceTextFromParsedNode(node);
    return normalizeNode(
      {
        ...node,
        sources: sourceText ? [{ text: sourceText }] : node.sources,
      },
      `ai-${index}`,
    );
  });
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
