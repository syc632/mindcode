import { normalizeMindCodeData, normalizeNode, slugify } from "./schema.js";

const dataBlockPattern = /```mindcode-json[^\n\r]*(?:\r?\n)([\s\S]*?)```/i;
export const mindMapMarkdownCharLimit = 2_000_000;
export const mindMapJsonBlockCharLimit = 1_000_000;
export const mindMapHeadingLimit = 1_000;

export function mapTitleFromData(data, fallback = "MindCode Map") {
  const normalized = normalizeMindCodeData(data);
  const root = normalized.nodes.find((node) => !node.parentId) || normalized.nodes[0];
  return String(root?.label || fallback).trim() || fallback;
}

function markdownEscape(value) {
  return String(value || "").replace(/\r/g, "").trim();
}

function childrenByParent(nodes) {
  const children = new Map(nodes.map((node) => [node.id, []]));
  const roots = [];
  const ids = new Set(nodes.map((node) => node.id));

  nodes.forEach((node) => {
    if (node.parentId && ids.has(node.parentId)) children.get(node.parentId).push(node);
    else roots.push(node);
  });

  return { children, roots };
}

export function serializeMindMapMarkdown({ title, data }) {
  const normalized = normalizeMindCodeData(data);
  const mapTitle = markdownEscape(title || mapTitleFromData(normalized));
  const { children, roots } = childrenByParent(normalized.nodes);
  const lines = [`# ${mapTitle}`, ""];
  const visited = new Set();

  function writeNodeBody(node) {
    if (node.desc) lines.push(markdownEscape(node.desc));
    const firstCard = node.cards?.[0];
    if (firstCard?.question || firstCard?.answer) {
      lines.push("", `- Q: ${markdownEscape(firstCard.question)}`, `- A: ${markdownEscape(firstCard.answer)}`);
    }
    lines.push("");
  }

  function writeNode(node, depth) {
    if (!node || visited.has(node.id)) return;
    visited.add(node.id);
    const level = Math.min(depth + 1, 6);
    lines.push(`${"#".repeat(level)} ${markdownEscape(node.label)}`);
    lines.push("");
    writeNodeBody(node);
    (children.get(node.id) || []).forEach((child) => writeNode(child, depth + 1));
  }

  if (roots.length === 1 && roots[0].label === mapTitle) {
    visited.add(roots[0].id);
    writeNodeBody(roots[0]);
    (children.get(roots[0].id) || []).forEach((child) => writeNode(child, 1));
  } else {
    roots.forEach((root) => writeNode(root, 1));
  }
  normalized.nodes.filter((node) => !visited.has(node.id)).forEach((node) => writeNode(node, 2));

  lines.push("---", "", "```mindcode-json", JSON.stringify({ title: mapTitle, data: normalized }, null, 2), "```", "");
  return lines.join("\n");
}

export function parseMindMapMarkdown(markdown, fallbackTitle = "MindCode Map") {
  const source = String(markdown || "");
  if (source.length > mindMapMarkdownCharLimit) {
    throw new Error(`Mind map Markdown exceeds ${mindMapMarkdownCharLimit} characters.`);
  }
  const match = source.match(dataBlockPattern);
  if (match) {
    if (match[1].length > mindMapJsonBlockCharLimit) {
      throw new Error(`Mind map JSON data block exceeds ${mindMapJsonBlockCharLimit} characters.`);
    }
    const parsed = JSON.parse(match[1]);
    return {
      title: String(parsed.title || mapTitleFromData(parsed.data, fallbackTitle)).trim(),
      data: normalizeMindCodeData(parsed.data),
    };
  }

  const headings = source
    .split(/\n/)
    .map((line) => {
      const heading = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
      if (!heading) return null;
      return { depth: heading[1].length, label: heading[2].replace(/[#*_`]/g, "").trim() };
    })
    .filter((heading) => heading?.label);

  if (headings.length > mindMapHeadingLimit) {
    throw new Error(`Mind map heading count exceeds ${mindMapHeadingLimit}.`);
  }

  if (!headings.length) {
    return { title: fallbackTitle, data: normalizeMindCodeData({ nodes: [], edges: [] }) };
  }

  const title = headings[0].label || fallbackTitle;
  const stack = [];
  const nodes = headings.map((heading, index) => {
    while (stack.length && stack[stack.length - 1].depth >= heading.depth) stack.pop();
    const parentId = stack[stack.length - 1]?.id || "";
    const id = slugify(heading.label) || `markdown-${index}`;
    const node = normalizeNode(
      {
        id,
        label: heading.label,
        parentId,
        desc: index === 0 ? "Markdown mind map root topic." : "Concept imported from a Markdown heading.",
      },
      `markdown-${index}`,
    );
    stack.push({ depth: heading.depth, id: node.id });
    return node;
  });

  return { title, data: normalizeMindCodeData({ nodes, edges: [] }) };
}
