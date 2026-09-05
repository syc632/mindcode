import { seedData } from "./seedData.js";

export const mindCodeNodeLimit = 1_000;
export const mindCodeEdgeLimit = 2_000;
export const mindCodeCardLimit = Infinity;
export const mindCodeSourceLimit = 50;
export const mindCodeLabelCharLimit = 120;
export const mindCodeQuestionCharLimit = 500;
export const mindCodeTextCharLimit = 4_000;
export const mindCodeCodeCharLimit = 8_000;
export const mindCodeCategoryCharLimit = 32;

const legacyDemoTextById = {
  promise: {
    question: "How would you explain Promise?",
    answer: "Represents the eventual completion or failure of an asynchronous operation and its result value.",
  },
  "async-await": {
    question: "How would you explain async/await?",
    answer: "Promise-based syntax that lets asynchronous code read like synchronous code.",
  },
  "event-loop": {
    question: "How would you explain Event Loop?",
    answer: "The core JavaScript runtime mechanism that schedules asynchronous tasks.",
  },
  closure: {
    question: "How would you explain Closure?",
    answer: "A function's ability to remember and access its lexical scope even when executed outside that scope.",
  },
  prototype: {
    question: "How would you explain Prototype Chain?",
    answer: "JavaScript objects implement inheritance by following the prototype chain.",
  },
  microtask: {
    question: "How would you explain Microtask Queue?",
    answer: "A high-priority queue where Promise callbacks are scheduled before macrotasks.",
  },
};

const legacyDemoEdgeLabelsById = {
  "edge-promise-async-await": "Sugar",
  "edge-promise-microtask": "Callbacks",
  "edge-event-loop-microtask": "Priority",
  "edge-closure-prototype": "Related",
};

function hasCjkText(value) {
  return /[\u4e00-\u9fff]/.test(String(value || ""));
}

function englishizeLegacyDemoNode(node) {
  const replacement = legacyDemoTextById[node.id];
  if (!replacement) return node;

  const cards = node.cards.map((card) => ({
    ...card,
    question: hasCjkText(card.question) ? replacement.question : card.question,
    answer: hasCjkText(card.answer) ? replacement.answer : card.answer,
  }));
  const firstCard = cards[0];

  return {
    ...node,
    desc: hasCjkText(node.desc) ? replacement.answer : node.desc,
    question: firstCard?.question ?? node.question,
    answer: firstCard?.answer ?? node.answer,
    cards,
  };
}

function englishizeLegacyDemoEdge(edge) {
  const label = legacyDemoEdgeLabelsById[edge.id];
  return label && hasCjkText(edge.label) ? { ...edge, label } : edge;
}

function limitedText(value, limit) {
  return String(value || "").trim().slice(0, limit);
}

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
  const nodeLabel = limitedText(node?.label || node?.id || "Concept", mindCodeLabelCharLimit);
  const desc = limitedText(node?.desc || "No explanation has been added.", mindCodeTextCharLimit);
  const id = slugify(card?.id || fallbackId) || fallbackId;

  return {
    id,
    question: limitedText(card?.question || node?.question || `How would you explain ${nodeLabel}?`, mindCodeQuestionCharLimit),
    answer: limitedText(card?.answer || node?.answer || desc, mindCodeTextCharLimit),
    codeExample: limitedText(card?.codeExample || node?.codeExample || "", mindCodeCodeCharLimit),
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
  const label = limitedText(node?.label || id, mindCodeLabelCharLimit);
  const desc = limitedText(node?.desc || "No explanation has been added.", mindCodeTextCharLimit);
  const parentId = slugify(node?.parentId || "");
  const cardSource = Array.isArray(node?.cards) && node.cards.length ? node.cards : [{}];
  const cards = cardSource.slice(0, mindCodeCardLimit).map((card, index) => normalizeCard(card, { ...node, id, label, desc }, `card-${index + 1}`));
  const firstCard = cards[0];
  return {
    id,
    parentId: parentId && parentId !== id ? parentId : "",
    label,
    category: limitedText(node?.category || "new", mindCodeCategoryCharLimit) || "new",
    desc,
    question: firstCard.question,
    answer: firstCard.answer,
    codeExample: firstCard.codeExample,
    cards,
    sources: Array.isArray(node?.sources)
      ? node.sources
          .slice(0, mindCodeSourceLimit)
          .map((source) => ({
            text: limitedText(source?.text, mindCodeTextCharLimit),
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
    label: limitedText(edge?.label || "Related", 12),
  };
}

export function normalizeMindCodeData(data) {
  if (!data || typeof data !== "object") return seedData();
  const usedIds = new Set();
  const idAliases = new Map();
  const normalizedNodes = Array.isArray(data.nodes)
    ? data.nodes.slice(0, mindCodeNodeLimit).map((item, i) => {
        const parentId = slugify(item?.parentId || "");
        const node = normalizeNode(item, `concept-${i}`);
        const originalId = node.id;
        let id = originalId;
        let suffix = 2;
        while (usedIds.has(id)) {
          id = `${originalId}-${suffix}`;
          suffix += 1;
        }
        usedIds.add(id);
        if (!idAliases.has(originalId)) idAliases.set(originalId, id);
        return { ...node, id, parentId };
      })
    : [];
  const nodeIds = new Set(normalizedNodes.map((item) => item.id));
  const nodes = normalizedNodes.map((node) => ({
    ...node,
    parentId: idAliases.has(node.parentId) && idAliases.get(node.parentId) !== node.id ? idAliases.get(node.parentId) : "",
  })).map(englishizeLegacyDemoNode);
  const edges = Array.isArray(data.edges)
    ? data.edges
        .slice(0, mindCodeEdgeLimit)
        .map(normalizeEdge)
        .map((edge) => ({
          ...edge,
          from: idAliases.get(edge.from) || edge.from,
          to: idAliases.get(edge.to) || edge.to,
        }))
        .map(englishizeLegacyDemoEdge)
        .filter((edge) => edge.from && edge.to && nodeIds.has(edge.from) && nodeIds.has(edge.to) && edge.from !== edge.to)
    : [];

  return {
    version: 1,
    nodes,
    edges,
    updatedAt: Number(data.updatedAt ?? Date.now()),
  };
}
