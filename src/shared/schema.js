import { seedData } from "./seedData.js";

export function slugify(value) {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

export function normalizeNode(node, fallbackId = "concept") {
  const timestamp = Date.now();
  const id = slugify(node?.id || node?.label || fallbackId) || fallbackId;
  return {
    id,
    label: String(node?.label || id).trim(),
    category: node?.category || "new",
    desc: String(node?.desc || "暂未添加解释。").trim(),
    ef: Number(node?.ef ?? 2.5),
    interval: Number(node?.interval ?? 1),
    repetitions: Number(node?.repetitions ?? 0),
    nextReview: Number(node?.nextReview ?? timestamp),
    createdAt: Number(node?.createdAt ?? timestamp),
    updatedAt: Number(node?.updatedAt ?? timestamp),
  };
}

export function normalizeEdge(edge, index = 0) {
  const from = slugify(edge?.from || "");
  const to = slugify(edge?.to || "");
  return {
    id: edge?.id || `edge-${from}-${to}-${index}`,
    from,
    to,
    label: String(edge?.label || "相关").trim().slice(0, 12),
  };
}

export function normalizeMindCodeData(data) {
  if (!data || typeof data !== "object") return seedData();
  const nodes = Array.isArray(data.nodes) ? data.nodes.map((item, i) => normalizeNode(item, `concept-${i}`)) : [];
  const nodeIds = new Set(nodes.map((item) => item.id));
  const edges = Array.isArray(data.edges)
    ? data.edges
        .map(normalizeEdge)
        .filter((edge) => edge.from && edge.to && nodeIds.has(edge.from) && nodeIds.has(edge.to) && edge.from !== edge.to)
    : [];

  return {
    version: 1,
    nodes,
    edges,
    updatedAt: Number(data.updatedAt ?? Date.now()),
  };
}
