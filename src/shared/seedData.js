const now = () => Date.now();

export const categories = {
  async: { label: "异步", color: "#444442", light: "#f0efed" },
  runtime: { label: "运行时", color: "#444442", light: "#f0efed" },
  core: { label: "核心", color: "#444442", light: "#f0efed" },
  tool: { label: "工具", color: "#444442", light: "#f0efed" },
  new: { label: "新概念", color: "#444442", light: "#f0efed" },
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
      node("promise", "Promise", "async", "表示一个异步操作的最终完成或失败，以及其结果值。", -1000),
      node("async-await", "async/await", "async", "基于 Promise 的语法糖，让异步代码看起来像同步代码。", 86400000),
      node("event-loop", "Event Loop", "runtime", "JavaScript 单线程运行时的核心机制，负责调度异步任务。", -5000),
      node("closure", "Closure", "core", "函数能够记住并访问其词法作用域，即使函数在其词法作用域之外执行。", 2 * 86400000),
      node("prototype", "Prototype Chain", "core", "JavaScript 对象通过原型链实现继承。", -2000),
      node("microtask", "Microtask Queue", "runtime", "Promise 回调进入的队列，优先级高于宏任务队列。", 3 * 86400000),
    ],
    edges: [
      { id: "edge-promise-async-await", from: "promise", to: "async-await", label: "语法糖" },
      { id: "edge-promise-microtask", from: "promise", to: "microtask", label: "回调进入" },
      { id: "edge-event-loop-microtask", from: "event-loop", to: "microtask", label: "优先处理" },
      { id: "edge-closure-prototype", from: "closure", to: "prototype", label: "关联" },
    ],
    updatedAt: timestamp,
  };
}
