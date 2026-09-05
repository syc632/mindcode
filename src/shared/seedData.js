const now = () => Date.now();

export const categories = {
  async: { label: "Async", color: "#444442", light: "#f0efed" },
  runtime: { label: "Runtime", color: "#444442", light: "#f0efed" },
  core: { label: "Core", color: "#444442", light: "#f0efed" },
  tool: { label: "Tool", color: "#444442", light: "#f0efed" },
  new: { label: "New Concept", color: "#444442", light: "#f0efed" },
};

function node(id, label, category, desc, nextReviewOffset) {
  const timestamp = now();
  return {
    id,
    label,
    category,
    desc,
    ef: 2.5,
    interval: 1,
    repetitions: 0,
    nextReview: timestamp + nextReviewOffset,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export function seedData() {
  const timestamp = now();
  return {
    version: 1,
    nodes: [
      node("promise", "Promise", "async", "Represents the eventual completion or failure of an asynchronous operation and its result value.", -1000),
      node("async-await", "async/await", "async", "Promise-based syntax that lets asynchronous code read like synchronous code.", 86400000),
      node("event-loop", "Event Loop", "runtime", "The core JavaScript runtime mechanism that schedules asynchronous tasks.", -5000),
      node("closure", "Closure", "core", "A function's ability to remember and access its lexical scope even when executed outside that scope.", 2 * 86400000),
      node("prototype", "Prototype Chain", "core", "JavaScript objects implement inheritance by following the prototype chain.", -2000),
      node("microtask", "Microtask Queue", "runtime", "A high-priority queue where Promise callbacks are scheduled before macrotasks.", 3 * 86400000),
    ],
    edges: [
      { id: "edge-promise-async-await", from: "promise", to: "async-await", label: "Sugar" },
      { id: "edge-promise-microtask", from: "promise", to: "microtask", label: "Callbacks" },
      { id: "edge-event-loop-microtask", from: "event-loop", to: "microtask", label: "Priority" },
      { id: "edge-closure-prototype", from: "closure", to: "prototype", label: "Related" },
    ],
    updatedAt: timestamp,
  };
}
