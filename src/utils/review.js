import { isDue } from "../shared/sm2.js";

export function cardsForNode(node) {
  return node.cards?.length ? node.cards : [node];
}

export function nodeIsDue(node) {
  return cardsForNode(node).some((card) => isDue(card));
}

export function todayCount(nodes) {
  return nodes.reduce((count, node) => count + cardsForNode(node).filter((card) => isDue(card)).length, 0);
}

export function reviewQueue(nodes) {
  return nodes.flatMap((node) =>
    cardsForNode(node)
      .filter((card) => isDue(card))
      .map((card) => ({
        ...card,
        nodeId: node.id,
        nodeLabel: node.label,
        label: node.label,
        category: node.category,
        desc: node.desc,
        sourceSummary: node.sources.slice(-2).map((source) => source.text).join("\n\n"),
        cardCount: cardsForNode(node).length,
        dueCount: cardsForNode(node).filter((item) => isDue(item)).length,
      })),
  );
}

export function reviewCardKey(card) {
  return card ? `${card.nodeId}:${card.id}` : "";
}

export function nodeSearchText(node) {
  return [
    node.label,
    node.desc,
    ...cardsForNode(node).flatMap((card) => [card.question, card.answer, card.codeExample]),
    ...node.sources.map((source) => source.text),
  ]
    .join(" ")
    .toLowerCase();
}

export function nodeNextReview(node) {
  return Math.min(...cardsForNode(node).map((card) => card.nextReview || 0));
}
