import { normalizeEdge, normalizeNode, slugify } from "./schema.js";

const KNOWN_TERMS = [
  ["Promise.all", "async", "Waits for all input Promises to fulfill and returns an array of results."],
  ["Promise", "async", "An object representing the eventual completion or failure of an asynchronous operation."],
  ["async/await", "async", "Syntax for writing Promise-based asynchronous flows in a synchronous style."],
  ["Event Loop", "runtime", "The runtime mechanism that coordinates the call stack, task queue, and microtask queue."],
  ["Microtask Queue", "runtime", "A high-priority queue that stores microtasks such as Promise callbacks."],
  ["Closure", "core", "A function's ability to carry and access its lexical scope."],
  ["Prototype Chain", "core", "The inheritance mechanism where objects look up properties and methods along prototypes."],
  ["React", "tool", "A component-based frontend library for building user interfaces."],
  ["useEffect", "tool", "A React Hook for handling side effects and synchronizing with external systems."],
  ["localStorage", "tool", "Browser-provided local key-value persistence."],
  ["Electron", "tool", "A runtime framework for building cross-platform desktop apps with web technologies."],
  ["IPC", "runtime", "A communication mechanism for sending messages and data between processes."],
];

function fallbackCandidates(text) {
  const matches = text.match(/[A-Za-z][A-Za-z0-9_./-]{2,}|[\u4e00-\u9fa5]{2,8}/g) || [];
  return matches
    .filter((term) => !/^(const|let|var|function|return|import|export|from|await|async)$/i.test(term))
    .slice(0, 12)
    .map((term) => [term, "new", `${term} was identified as a candidate technical concept from the input.`]);
}

export async function extractWithMock({ text, existingLabels = [] }) {
  const existing = new Set(existingLabels.map((label) => label.toLowerCase()));
  const lowerText = text.toLowerCase();
  const source = [
    ...KNOWN_TERMS.filter(([label]) => lowerText.includes(label.toLowerCase())),
    ...fallbackCandidates(text),
  ];

  const seen = new Set();
  const nodes = [];
  for (const [label, category, desc] of source) {
    const key = label.toLowerCase();
    if (existing.has(key) || seen.has(key)) continue;
    seen.add(key);
    nodes.push(
      normalizeNode({
        id: slugify(label),
        label,
        category,
        desc,
        nextReview: Date.now(),
      }),
    );
    if (nodes.length >= 5) break;
  }

  const edges = [];
  for (let i = 1; i < nodes.length; i += 1) {
    edges.push(
      normalizeEdge({
        from: nodes[i - 1].id,
        to: nodes[i].id,
        label: "Related",
      }, i),
    );
  }

  return { nodes, edges, provider: "mock" };
}
