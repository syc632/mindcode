import { normalizeEdge, normalizeNode, slugify } from "./schema.js";

const KNOWN_TERMS = [
  ["Promise.all", "async", "等待多个 Promise 全部完成并返回结果数组。"],
  ["Promise", "async", "表示异步操作最终完成或失败的对象。"],
  ["async/await", "async", "用同步风格书写 Promise 异步流程的语法。"],
  ["Event Loop", "runtime", "协调调用栈、任务队列和微任务队列的运行时机制。"],
  ["Microtask Queue", "runtime", "保存 Promise 回调等微任务的高优先级队列。"],
  ["Closure", "core", "函数携带并访问其词法作用域的能力。"],
  ["Prototype Chain", "core", "对象沿原型链查找属性和方法的继承机制。"],
  ["React", "tool", "用于构建用户界面的组件化前端库。"],
  ["useEffect", "tool", "React 中处理副作用和同步外部系统的 Hook。"],
  ["localStorage", "tool", "浏览器提供的本地键值持久化能力。"],
  ["Electron", "tool", "用 Web 技术构建跨平台桌面应用的运行框架。"],
  ["IPC", "runtime", "进程之间传递消息和数据的通信机制。"],
];

function fallbackCandidates(text) {
  const matches = text.match(/[A-Za-z][A-Za-z0-9_./-]{2,}|[\u4e00-\u9fa5]{2,8}/g) || [];
  return matches
    .filter((term) => !/^(const|let|var|function|return|import|export|from|await|async)$/i.test(term))
    .slice(0, 12)
    .map((term) => [term, "new", `${term} 是从输入内容中识别出的候选技术概念。`]);
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
        label: "相关",
      }, i),
    );
  }

  return { nodes, edges, provider: "mock" };
}
