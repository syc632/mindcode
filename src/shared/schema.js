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

export function normalizeCard(card, node, fallbackId = "card") {
  const timestamp = Date.now();
  const nodeLabel = String(node?.label || node?.id || "概念").trim();
  const desc = String(node?.desc || "暂未添加解释。").trim();
  const id = slugify(card?.id || fallbackId) || fallbackId;

  return {
    id,
    question: String(card?.question || node?.question || `如何解释 ${nodeLabel}？`).trim(),
    answer: String(card?.answer || node?.answer || desc).trim(),
    codeExample: String(card?.codeExample || node?.codeExample || "").trim(),
    ef: Number(card?.ef ?? node?.ef ?? 2.5),
    interval: Number(card?.interval ?? node?.interval ?? 1),
    repetitions: Number(card?.repetitions ?? node?.repetitions ?? 0),
    nextReview: Number(card?.nextReview ?? node?.nextReview ?? timestamp),
    createdAt: Number(card?.createdAt ?? node?.createdAt ?? timestamp),
    updatedAt: Number(card?.updatedAt ?? node?.updatedAt ?? timestamp),
  };
}

export function normalizeNode(node, fallbackId = "concept") {
  const timestamp = Date.now();
  const id = slugify(node?.id || node?.label || fallbackId) || fallbackId;
  const label = String(node?.label || id).trim();
  const desc = String(node?.desc || "暂未添加解释。").trim();
  const cardSource = Array.isArray(node?.cards) && node.cards.length ? node.cards : [{}];
  const cards = cardSource.map((card, index) => normalizeCard(card, { ...node, id, label, desc }, `card-${index + 1}`));
  const firstCard = cards[0];
  return {
    id,
    label,
    category: node?.category || "new",
    desc,
    question: firstCard.question,
    answer: firstCard.answer,
    codeExample: firstCard.codeExample,
    cards,
    sources: Array.isArray(node?.sources)
      ? node.sources
          .map((source) => ({
            text: String(source?.text || "").trim(),
            createdAt: Number(source?.createdAt ?? timestamp),
          }))
          .filter((source) => source.text)
      : [],
    ef: firstCard.ef,
    interval: firstCard.interval,
    repetitions: firstCard.repetitions,
    nextReview: firstCard.nextReview,
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
