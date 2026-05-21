import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Archive,
  Brain,
  Check,
  CirclePlus,
  Database,
  Download,
  Edit3,
  Filter,
  GitBranch,
  LibraryBig,
  Loader2,
  Link2,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Save,
  Search,
  Sparkles,
  Trash2,
  Upload,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { categories, seedData } from "./shared/seedData.js";
import { extractWithMock } from "./shared/mockExtractor.js";
import { daysUntil, isDue, sm2 } from "./shared/sm2.js";
import { normalizeCard, normalizeEdge, normalizeMindCodeData, normalizeNode } from "./shared/schema.js";

const storageKey = "mindcode-browser-data";
const views = [
  { id: "graph", label: "图谱", icon: GitBranch },
  { id: "library", label: "知识库", icon: LibraryBig },
  { id: "review", label: "复习", icon: RotateCcw },
];
const viewLabels = { graph: "图谱", library: "知识库", review: "复习", add: "添加" };
const graphViewport = { x: 0, y: 0, width: 900, height: 540 };
const graphCenter = { x: graphViewport.width / 2, y: graphViewport.height / 2 };
const curveSpring = 0.14;
const curveDamping = 0.68;
const reviewCarouselColors = [
  "142, 249, 252",
  "142, 252, 204",
  "142, 252, 157",
  "215, 252, 142",
  "252, 252, 142",
  "252, 208, 142",
  "252, 142, 142",
  "252, 142, 239",
  "204, 142, 252",
  "142, 202, 252",
];

function naturalCurveTarget(from, to) {
  const deltaX = to.x - from.x;
  const deltaY = to.y - from.y;
  return {
    c1x: from.x + deltaX * 0.35,
    c1y: from.y + deltaY * 0.35,
    c2x: to.x - deltaX * 0.35,
    c2y: to.y - deltaY * 0.35,
  };
}

function springForCurve(target) {
  return {
    ...target,
    v1x: 0,
    v1y: 0,
    v2x: 0,
    v2y: 0,
  };
}

function edgePoints(from, to) {
  const deltaX = to.x - from.x;
  const deltaY = to.y - from.y;
  const distance = Math.max(Math.hypot(deltaX, deltaY), 1);
  const inset = Math.min(56, distance / 4);

  return {
    distance,
    start: {
      x: from.x + (deltaX / distance) * inset,
      y: from.y + (deltaY / distance) * inset,
    },
    end: {
      x: to.x - (deltaX / distance) * inset,
      y: to.y - (deltaY / distance) * inset,
    },
  };
}

function cardsForNode(node) {
  return node.cards?.length ? node.cards : [node];
}

function nodeIsDue(node) {
  return cardsForNode(node).some((card) => isDue(card));
}

function todayCount(nodes) {
  return nodes.reduce((count, node) => count + cardsForNode(node).filter((card) => isDue(card)).length, 0);
}

function reviewQueue(nodes) {
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
      })),
  );
}

function nodeSearchText(node) {
  return [
    node.label,
    node.desc,
    ...cardsForNode(node).flatMap((card) => [card.question, card.answer, card.codeExample]),
    ...node.sources.map((source) => source.text),
  ]
    .join(" ")
    .toLowerCase();
}

function nodeNextReview(node) {
  return Math.min(...cardsForNode(node).map((card) => card.nextReview || 0));
}

function readLocalCache() {
  try {
    const raw = localStorage.getItem(storageKey);
    return raw ? normalizeMindCodeData(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

function writeLocalCache(data) {
  try {
    localStorage.setItem(storageKey, JSON.stringify(normalizeMindCodeData(data)));
  } catch {
    // Electron file persistence remains the source of truth if localStorage is unavailable.
  }
}

async function loadData() {
  const cached = readLocalCache();

  if (window.mindcode?.loadData) {
    const result = await window.mindcode.loadData();
    if (result.source === "seed" && cached) {
      return { data: cached, source: "localStorage", warning: result.warning };
    }
    return result;
  }

  if (!cached) return { data: normalizeMindCodeData(seedData()), source: "seed" };
  return { data: cached, source: "localStorage" };
}

async function saveData(data) {
  const normalized = normalizeMindCodeData(data);
  writeLocalCache(normalized);

  if (window.mindcode?.saveData) {
    return window.mindcode.saveData(normalized);
  }

  return { ok: true };
}

function downloadJsonExport(data) {
  const normalized = normalizeMindCodeData(data);
  const blob = new Blob([`${JSON.stringify(normalized, null, 2)}\n`], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `MindCode-export-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  return { ok: true };
}

async function extractConcepts(text, existingLabels) {
  if (window.mindcode?.extractConcepts) {
    return window.mindcode.extractConcepts({ text, existingLabels });
  }

  return extractWithMock({ text, existingLabels });
}

function categoryFor(node) {
  return categories[node.category] || categories.new;
}

function Stat({ label, value }) {
  return (
    <div className="stat">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function Toast({ toast, onClear }) {
  if (!toast) return null;
  return (
    <button className={`toast toast-${toast.type || "info"}`} onClick={onClear}>
      {toast.message}
    </button>
  );
}

function GraphCanvas({ nodes, edges, selectedId, onSelect }) {
  const svgRef = useRef(null);
  const dragOffset = useRef({ x: 0, y: 0 });
  const panStart = useRef(null);
  const positionsRef = useRef({});
  const edgesRef = useRef(edges);
  const curveSpringsRef = useRef({});
  const curveAnimationRef = useRef(null);
  const draggingRef = useRef(null);
  const [positions, setPositions] = useState({});
  const [dragging, setDragging] = useState(null);
  const [panning, setPanning] = useState(false);
  const [viewport, setViewport] = useState(graphViewport);
  const [, setCurveRevision] = useState(0);

  useEffect(() => {
    const width = 900;
    const height = 540;
    setPositions((previous) => {
      const next = {};
      nodes.forEach((node, index) => {
        if (previous[node.id]) {
          next[node.id] = previous[node.id];
          return;
        }
        const angle = (index / Math.max(nodes.length, 1)) * Math.PI * 2;
        const radius = Math.min(width, height) * 0.32;
        next[node.id] = {
          x: width / 2 + radius * Math.cos(angle),
          y: height / 2 + radius * Math.sin(angle),
        };
      });
      return next;
    });
  }, [nodes]);

  const pointFor = useCallback((nodeId) => positionsRef.current[nodeId] || graphCenter, []);

  const startCurveAnimation = useCallback(() => {
    if (curveAnimationRef.current) return;

    const step = () => {
      let moving = false;

      edgesRef.current.forEach((edge) => {
        const target = naturalCurveTarget(pointFor(edge.from), pointFor(edge.to));
        const spring = curveSpringsRef.current[edge.id] || springForCurve(target);
        curveSpringsRef.current[edge.id] = spring;

        const force1X = (target.c1x - spring.c1x) * curveSpring;
        const force1Y = (target.c1y - spring.c1y) * curveSpring;
        const force2X = (target.c2x - spring.c2x) * curveSpring;
        const force2Y = (target.c2y - spring.c2y) * curveSpring;

        spring.v1x = (spring.v1x + force1X) * curveDamping;
        spring.v1y = (spring.v1y + force1Y) * curveDamping;
        spring.v2x = (spring.v2x + force2X) * curveDamping;
        spring.v2y = (spring.v2y + force2Y) * curveDamping;
        spring.c1x += spring.v1x;
        spring.c1y += spring.v1y;
        spring.c2x += spring.v2x;
        spring.c2y += spring.v2y;

        if (Math.abs(spring.v1x) + Math.abs(spring.v1y) + Math.abs(spring.v2x) + Math.abs(spring.v2y) > 0.04) {
          moving = true;
        }
      });

      setCurveRevision((revision) => revision + 1);

      if (moving || draggingRef.current) {
        curveAnimationRef.current = window.requestAnimationFrame(step);
        return;
      }

      curveAnimationRef.current = null;
    };

    curveAnimationRef.current = window.requestAnimationFrame(step);
  }, [pointFor]);

  useEffect(() => {
    positionsRef.current = positions;
    startCurveAnimation();
  }, [positions, startCurveAnimation]);

  useEffect(() => {
    edgesRef.current = edges;
    startCurveAnimation();
  }, [edges, startCurveAnimation]);

  useEffect(() => {
    draggingRef.current = dragging;
    if (dragging) startCurveAnimation();
  }, [dragging, startCurveAnimation]);

  useEffect(
    () => () => {
      if (curveAnimationRef.current) window.cancelAnimationFrame(curveAnimationRef.current);
    },
    [],
  );

  const getPoint = useCallback((event) => {
    const svg = svgRef.current;
    const point = svg.createSVGPoint();
    point.x = event.clientX;
    point.y = event.clientY;
    return point.matrixTransform(svg.getScreenCTM().inverse());
  }, []);

  const handlePointerDown = (event, nodeId) => {
    const point = getPoint(event);
    const current = positions[nodeId] || { x: 450, y: 270 };
    dragOffset.current = { x: point.x - current.x, y: point.y - current.y };
    setDragging(nodeId);
    onSelect(nodeId);
    event.currentTarget.setPointerCapture?.(event.pointerId);
    event.stopPropagation();
  };

  const handleCanvasPointerDown = (event) => {
    if (event.button !== 0 || event.target.closest?.(".graph-node")) return;
    panStart.current = { x: event.clientX, y: event.clientY, viewport };
    setPanning(true);
    onSelect(null);
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const handlePointerMove = useCallback(
    (event) => {
      if (dragging) {
        const point = getPoint(event);
        setPositions((previous) => ({
          ...previous,
          [dragging]: {
            x: Math.max(64, Math.min(836, point.x - dragOffset.current.x)),
            y: Math.max(48, Math.min(492, point.y - dragOffset.current.y)),
          },
        }));
        return;
      }

      if (!panning || !panStart.current || !svgRef.current) return;
      const bounds = svgRef.current.getBoundingClientRect();
      const { viewport: startViewport } = panStart.current;
      const deltaX = ((event.clientX - panStart.current.x) / Math.max(bounds.width, 1)) * startViewport.width;
      const deltaY = ((event.clientY - panStart.current.y) / Math.max(bounds.height, 1)) * startViewport.height;
      setViewport({
        ...startViewport,
        x: startViewport.x - deltaX,
        y: startViewport.y - deltaY,
      });
    },
    [dragging, getPoint, panning],
  );

  const stopPointerGesture = () => {
    setDragging(null);
    setPanning(false);
    panStart.current = null;
  };

  const zoomAt = useCallback((factor, anchor) => {
    setViewport((previous) => {
      const width = Math.max(360, Math.min(1800, previous.width * factor));
      const scale = width / previous.width;
      const height = previous.height * scale;
      return {
        x: anchor.x - (anchor.x - previous.x) * scale,
        y: anchor.y - (anchor.y - previous.y) * scale,
        width,
        height,
      };
    });
  }, []);

  const zoomFromCenter = (factor) => {
    zoomAt(factor, {
      x: viewport.x + viewport.width / 2,
      y: viewport.y + viewport.height / 2,
    });
  };

  const handleWheel = (event) => {
    event.preventDefault();
    zoomAt(event.deltaY > 0 ? 1.12 : 0.89, getPoint(event));
  };

  const nodeIds = new Set(nodes.map((node) => node.id));

  return (
    <div className="graph-stage">
      <svg
        ref={svgRef}
        className={`graph-canvas ${dragging ? "is-node-dragging" : ""} ${panning ? "is-panning" : ""}`}
        viewBox={`${viewport.x} ${viewport.y} ${viewport.width} ${viewport.height}`}
        onPointerDown={handleCanvasPointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={stopPointerGesture}
        onPointerCancel={stopPointerGesture}
        onWheel={handleWheel}
      >
        <defs>
          <marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto">
            <path d="M2 2L8 5L2 8" className="edge-arrow" />
          </marker>
        </defs>

        <g className="grid-lines">
          {Array.from({ length: 10 }, (_, index) => (
            <line key={`v-${index}`} x1={index * 100} y1="0" x2={index * 100} y2="540" />
          ))}
          {Array.from({ length: 7 }, (_, index) => (
            <line key={`h-${index}`} x1="0" y1={index * 90} x2="900" y2={index * 90} />
          ))}
        </g>

        {edges
          .filter((edge) => nodeIds.has(edge.from) && nodeIds.has(edge.to))
          .map((edge) => {
            const from = positions[edge.from] || graphCenter;
            const to = positions[edge.to] || graphCenter;
            const { start, end } = edgePoints(from, to);
            const control = curveSpringsRef.current[edge.id] || naturalCurveTarget(from, to);
            const label = {
              x: 0.125 * (start.x + end.x) + 0.375 * (control.c1x + control.c2x),
              y: 0.125 * (start.y + end.y) + 0.375 * (control.c1y + control.c2y),
            };
            return (
              <g key={edge.id} className="edge">
                <path
                  d={`M ${start.x} ${start.y} C ${control.c1x} ${control.c1y} ${control.c2x} ${control.c2y} ${end.x} ${end.y}`}
                  markerEnd="url(#arrow)"
                />
                <text x={label.x} y={label.y - 8} textAnchor="middle">
                  {edge.label}
                </text>
              </g>
            );
          })}

        {nodes.map((node) => {
          const point = positions[node.id] || { x: 450, y: 270 };
          const category = categoryFor(node);
          const selected = selectedId === node.id;
          const due = nodeIsDue(node);
          const width = Math.min(190, Math.max(108, node.label.length * 9 + 32));
          return (
            <g
              key={node.id}
              className={`graph-node ${selected ? "is-selected" : ""}`}
              onPointerDown={(event) => handlePointerDown(event, node.id)}
            >
              {selected ? (
                <rect
                  x={point.x - width / 2 - 5}
                  y={point.y - 25}
                  width={width + 10}
                  height="50"
                  rx="10"
                  className="node-ring"
                  style={{ stroke: category.color }}
                />
              ) : null}
              <rect
                x={point.x - width / 2}
                y={point.y - 20}
                width={width}
                height="40"
                rx="8"
                style={{ fill: category.light, stroke: category.color }}
              />
              {due ? <circle cx={point.x + width / 2 - 5} cy={point.y - 17} r="5" className="due-dot" /> : null}
              <text x={point.x} y={point.y + 1} textAnchor="middle" dominantBaseline="middle" style={{ fill: category.color }}>
                {node.label}
              </text>
            </g>
          );
        })}
      </svg>

      <div className="graph-controls" aria-label="图谱缩放">
        <button onClick={() => zoomFromCenter(0.82)} aria-label="放大">
          <ZoomIn size={16} />
        </button>
        <button onClick={() => zoomFromCenter(1.18)} aria-label="缩小">
          <ZoomOut size={16} />
        </button>
        <button onClick={() => setViewport(graphViewport)} aria-label="重置视图">
          <RotateCcw size={16} />
        </button>
      </div>
      <div className="graph-hint">滚轮缩放，拖拽空白处平移</div>
    </div>
  );
}

function GraphFilters({ filters, onChange, visibleCount, totalCount }) {
  const selectedCategories = new Set(filters.categories);

  function toggleCategory(categoryId) {
    const next = new Set(filters.categories);
    if (next.has(categoryId)) next.delete(categoryId);
    else next.add(categoryId);
    onChange({ ...filters, categories: [...next] });
  }

  return (
    <div className="graph-filters">
      <label className="search-box graph-search">
        <Search size={15} />
        <input
          value={filters.query}
          onChange={(event) => onChange({ ...filters, query: event.target.value })}
          placeholder="搜索概念或解释"
        />
      </label>
      <div className="filter-chips">
        {Object.entries(categories).map(([key, category]) => (
          <button
            key={key}
            className={selectedCategories.size === 0 || selectedCategories.has(key) ? "active" : ""}
            onClick={() => toggleCategory(key)}
            style={{ "--chip-color": category.color, "--chip-bg": category.light }}
          >
            {category.label}
          </button>
        ))}
      </div>
      <div className="filter-summary">
        <Filter size={14} />
        {visibleCount} / {totalCount}
      </div>
    </div>
  );
}

function NodeDetail({ node, nodes, edges, onClose, onUpdate, onDelete, onCreateEdge, onUpdateEdge, onDeleteEdge }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({
    label: node.label,
    category: node.category,
    desc: node.desc,
    cards: cardsForNode(node).map((card) => ({ ...card })),
  });
  const [edgeLabels, setEdgeLabels] = useState({});
  const [relationTarget, setRelationTarget] = useState("");
  const [relationLabel, setRelationLabel] = useState("相关");

  useEffect(() => {
    setEditing(false);
    setDraft({
      label: node.label,
      category: node.category,
      desc: node.desc,
      cards: cardsForNode(node).map((card) => ({ ...card })),
    });
    const firstTarget = nodes.find((item) => item.id !== node.id);
    setRelationTarget(firstTarget?.id || "");
    setRelationLabel("相关");
  }, [node, nodes]);

  const relatedEdges = edges.filter((edge) => edge.from === node.id || edge.to === node.id);

  useEffect(() => {
    setEdgeLabels(Object.fromEntries(edges.filter((edge) => edge.from === node.id || edge.to === node.id).map((edge) => [edge.id, edge.label])));
  }, [edges, node.id]);

  function saveEdit() {
    const label = draft.label.trim();
    if (!label) return;
    const desc = draft.desc.trim() || "暂未添加解释。";
    onUpdate(node.id, {
      label,
      category: draft.category,
      desc,
      cards: draft.cards.map((card, index) =>
        normalizeCard(
          {
            ...card,
            question: card.question.trim() || `如何解释 ${label}？`,
            answer: card.answer.trim() || desc,
            codeExample: card.codeExample.trim(),
          },
          { label, desc },
          `card-${index + 1}`,
        ),
      ),
    });
    setEditing(false);
  }

  function updateDraftCard(cardId, patch) {
    setDraft((current) => ({
      ...current,
      cards: current.cards.map((card) => (card.id === cardId ? { ...card, ...patch } : card)),
    }));
  }

  function addDraftCard() {
    setDraft((current) => ({
      ...current,
      cards: [
        ...current.cards,
        normalizeCard(
          {
            id: `card-${Date.now()}`,
            question: `围绕 ${current.label || node.label} 再问一个问题`,
            answer: current.desc || node.desc,
            nextReview: Date.now(),
          },
          { label: current.label || node.label, desc: current.desc || node.desc },
        ),
      ],
    }));
  }

  function removeDraftCard(cardId) {
    setDraft((current) => ({
      ...current,
      cards: current.cards.length > 1 ? current.cards.filter((card) => card.id !== cardId) : current.cards,
    }));
  }

  function addRelation() {
    if (!relationTarget || relationTarget === node.id) return;
    if (onCreateEdge({ from: node.id, to: relationTarget, label: relationLabel.trim() || "相关" })) {
      setRelationLabel("相关");
    }
  }

  function nodeLabel(nodeId) {
    return nodes.find((item) => item.id === nodeId)?.label || nodeId;
  }

  const category = categoryFor(node);

  return (
    <aside className="node-detail">
      <button className="icon-button close-button" onClick={onClose} aria-label="关闭详情">
        <X size={16} />
      </button>

      {editing ? (
        <div className="node-form">
          <label>
            <span>名称</span>
            <input value={draft.label} onChange={(event) => setDraft({ ...draft, label: event.target.value })} />
          </label>
          <label>
            <span>分类</span>
            <select value={draft.category} onChange={(event) => setDraft({ ...draft, category: event.target.value })}>
              {Object.entries(categories).map(([key, item]) => (
                <option key={key} value={key}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>解释</span>
            <textarea value={draft.desc} onChange={(event) => setDraft({ ...draft, desc: event.target.value })} />
          </label>
          <div className="card-editor">
            <div className="pane-header">
              <h3>复习卡片</h3>
              <button className="secondary-button compact" onClick={addDraftCard}>
                <Plus size={14} />
                加卡片
              </button>
            </div>
            {draft.cards.map((card, index) => (
              <article key={card.id} className="card-edit-item">
                <div className="card-edit-title">
                  <strong>卡片 {index + 1}</strong>
                  <button
                    className="icon-button relation-delete"
                    onClick={() => removeDraftCard(card.id)}
                    disabled={draft.cards.length === 1}
                    aria-label={`删除卡片 ${index + 1}`}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
                <label>
                  <span>复习问题</span>
                  <textarea value={card.question} onChange={(event) => updateDraftCard(card.id, { question: event.target.value })} />
                </label>
                <label>
                  <span>卡片答案</span>
                  <textarea value={card.answer} onChange={(event) => updateDraftCard(card.id, { answer: event.target.value })} />
                </label>
                <label>
                  <span>代码示例</span>
                  <textarea
                    className="code-input"
                    value={card.codeExample}
                    onChange={(event) => updateDraftCard(card.id, { codeExample: event.target.value })}
                    placeholder="可选，写最短可运行示例"
                  />
                </label>
              </article>
            ))}
          </div>
          <div className="node-actions">
            <button className="secondary-button" onClick={() => setEditing(false)}>
              取消
            </button>
            <button className="primary-button compact" onClick={saveEdit} disabled={!draft.label.trim()}>
              <Save size={15} />
              保存
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="node-detail-tags">
            <span className="category-badge" style={{ color: category.color, background: category.light }}>
              {category.label}
            </span>
            <span className={nodeIsDue(node) ? "detail-review-state is-due" : "detail-review-state is-planned"}>
              {nodeIsDue(node) ? "待复习" : `下次 ${daysUntil(nodeNextReview(node))}`}
            </span>
          </div>
          <h3>{node.label}</h3>
          <p>{node.desc}</p>
          <div className="node-meta">
            <Stat label="熟练度" value={cardsForNode(node)[0].ef.toFixed(2)} />
            <Stat label="卡片" value={cardsForNode(node).length} />
            <Stat label="待复习" value={cardsForNode(node).filter((card) => isDue(card)).length} />
            <Stat label="关系" value={relatedEdges.length} />
          </div>
          <div className="card-fields">
            {cardsForNode(node).map((card, index) => (
              <div key={card.id}>
                <span>卡片 {index + 1}</span>
                <strong>{card.question}</strong>
                <p>{card.answer}</p>
                {card.codeExample ? <pre>{card.codeExample}</pre> : null}
                <small>
                  {isDue(card) ? "今天到期" : daysUntil(card.nextReview)} · 已复习 {card.repetitions} 次
                </small>
              </div>
            ))}
          </div>
          {node.sources.length ? (
            <div className="source-block">
              <h4>来源笔记</h4>
              {node.sources.slice(-2).map((source) => (
                <p key={`${source.createdAt}-${source.text.slice(0, 12)}`}>{source.text}</p>
              ))}
            </div>
          ) : null}
          <div className="node-actions">
            <button className="secondary-button" onClick={() => setEditing(true)}>
              <Edit3 size={15} />
              编辑
            </button>
            <button className="danger-button" onClick={() => onDelete(node.id)}>
              <Trash2 size={15} />
              删除
            </button>
          </div>
        </>
      )}

      <div className="relation-editor">
        <h4>
          <Link2 size={14} />
          关系
        </h4>
        {relatedEdges.length ? (
          <div className="relation-list">
            {relatedEdges.map((edge) => (
              <div key={edge.id} className="relation-row">
                <span>{edge.from === node.id ? `到 ${nodeLabel(edge.to)}` : `来自 ${nodeLabel(edge.from)}`}</span>
                <input
                  value={edgeLabels[edge.id] ?? edge.label}
                  onChange={(event) => setEdgeLabels((labels) => ({ ...labels, [edge.id]: event.target.value }))}
                  aria-label={`编辑关系 ${edge.label}`}
                />
                <button
                  className="icon-button"
                  onClick={() => onUpdateEdge(edge.id, { label: edgeLabels[edge.id] || "相关" })}
                  aria-label={`保存关系 ${edge.label}`}
                >
                  <Save size={14} />
                </button>
                <button className="icon-button relation-delete" onClick={() => onDeleteEdge(edge.id)} aria-label={`删除关系 ${edge.label}`}>
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="relation-empty">还没有关系。</p>
        )}
        {nodes.length > 1 ? (
          <div className="relation-create">
            <select value={relationTarget} onChange={(event) => setRelationTarget(event.target.value)} aria-label="关系目标概念">
              {nodes
                .filter((item) => item.id !== node.id)
                .map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
            </select>
            <input value={relationLabel} onChange={(event) => setRelationLabel(event.target.value)} aria-label="关系标签" />
            <button className="secondary-button compact" onClick={addRelation}>
              <Plus size={14} />
              连接
            </button>
          </div>
        ) : null}
      </div>
    </aside>
  );
}

function GraphView({
  data,
  selectedId,
  onSelect,
  filters,
  onFiltersChange,
  onUpdateNode,
  onDeleteNode,
  onCreateEdge,
  onUpdateEdge,
  onDeleteEdge,
}) {
  const filtered = useMemo(() => {
    const needle = filters.query.trim().toLowerCase();
    const selectedCategories = new Set(filters.categories);
    const nodes = data.nodes.filter((node) => {
      const matchesQuery = !needle || nodeSearchText(node).includes(needle);
      const matchesCategory = selectedCategories.size === 0 || selectedCategories.has(node.category);
      return matchesQuery && matchesCategory;
    });
    const visibleIds = new Set(nodes.map((node) => node.id));
    const edges = data.edges.filter((edge) => visibleIds.has(edge.from) && visibleIds.has(edge.to));
    return { nodes, edges };
  }, [data, filters]);

  const selectedNode = filtered.nodes.find((node) => node.id === selectedId);

  return (
    <section className="surface graph-view">
      <div className="section-header">
        <div>
          <h2>知识图谱</h2>
          <p>拖动节点调整位置，关系线会弹性跟随；点击查看掌握度和复习计划。</p>
        </div>
        <div className="legend">
          {Object.entries(categories).map(([key, category]) => (
            <span key={key} style={{ color: category.color, background: category.light }}>
              {category.label}
            </span>
          ))}
          <span className="legend-due">待复习</span>
        </div>
      </div>

      <GraphFilters
        filters={filters}
        onChange={onFiltersChange}
        visibleCount={filtered.nodes.length}
        totalCount={data.nodes.length}
      />

      <GraphCanvas nodes={filtered.nodes} edges={filtered.edges} selectedId={selectedId} onSelect={onSelect} />

      {!filtered.nodes.length ? (
        <div className="graph-empty">
          <Search size={34} />
          <h3>没有匹配的概念</h3>
          <p>调整关键词或分类筛选。</p>
        </div>
      ) : null}

      {selectedNode ? (
        <NodeDetail
          node={selectedNode}
          nodes={data.nodes}
          edges={data.edges}
          onClose={() => onSelect(null)}
          onUpdate={onUpdateNode}
          onDelete={onDeleteNode}
          onCreateEdge={onCreateEdge}
          onUpdateEdge={onUpdateEdge}
          onDeleteEdge={onDeleteEdge}
        />
      ) : null}
    </section>
  );
}

function LibraryView({ data, desktopDataTools, dataTask, onOpenNode, onDeleteNode, onExportData, onImportData, onBackupData }) {
  const importRef = useRef(null);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [reviewState, setReviewState] = useState("all");
  const [sortBy, setSortBy] = useState("updated");

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const relationCounts = data.edges.reduce((counts, edge) => {
      counts.set(edge.from, (counts.get(edge.from) || 0) + 1);
      counts.set(edge.to, (counts.get(edge.to) || 0) + 1);
      return counts;
    }, new Map());

    return data.nodes
      .filter((node) => {
        const dueCount = cardsForNode(node).filter((card) => isDue(card)).length;
        const matchesQuery = !needle || nodeSearchText(node).includes(needle);
        const matchesCategory = category === "all" || node.category === category;
        const matchesReview =
          reviewState === "all" ||
          (reviewState === "due" && dueCount > 0) ||
          (reviewState === "clear" && dueCount === 0);
        return matchesQuery && matchesCategory && matchesReview;
      })
      .map((node) => ({
        node,
        dueCount: cardsForNode(node).filter((card) => isDue(card)).length,
        cardCount: cardsForNode(node).length,
        relationCount: relationCounts.get(node.id) || 0,
        nextReview: nodeNextReview(node),
      }))
      .sort((left, right) => {
        if (sortBy === "label") return left.node.label.localeCompare(right.node.label, "zh-Hans-CN");
        if (sortBy === "due") return right.dueCount - left.dueCount || left.nextReview - right.nextReview;
        if (sortBy === "cards") return right.cardCount - left.cardCount || left.node.label.localeCompare(right.node.label, "zh-Hans-CN");
        return right.node.updatedAt - left.node.updatedAt;
      });
  }, [category, data.edges, data.nodes, query, reviewState, sortBy]);

  return (
    <section className="surface library-view">
      <div className="section-header">
        <div>
          <h2>知识库</h2>
          <p>用列表管理概念、卡片和复习状态，再回到图谱查看关系。</p>
        </div>
        <div className="library-header-actions">
          <div className="review-count">{rows.length} / {data.nodes.length}</div>
          <div className="library-data-actions" aria-label="数据操作">
            <button className="secondary-button compact" onClick={onExportData} disabled={Boolean(dataTask)}>
              <Download size={14} />
              导出
            </button>
            <button
              className="secondary-button compact"
              onClick={() => (desktopDataTools ? onImportData() : importRef.current?.click())}
              disabled={Boolean(dataTask)}
            >
              <Upload size={14} />
              导入
            </button>
            <button className="secondary-button compact" onClick={onBackupData} disabled={Boolean(dataTask)}>
              <Archive size={14} />
              备份
            </button>
            <input
              ref={importRef}
              className="hidden-file-input"
              type="file"
              accept="application/json,.json"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) onImportData(file);
                event.target.value = "";
              }}
            />
          </div>
        </div>
      </div>

      <div className="library-toolbar">
        <label className="search-box library-search">
          <Search size={15} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索概念、卡片或来源笔记" />
        </label>
        <label>
          <span>分类</span>
          <select value={category} onChange={(event) => setCategory(event.target.value)}>
            <option value="all">全部分类</option>
            {Object.entries(categories).map(([key, item]) => (
              <option key={key} value={key}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>复习</span>
          <select value={reviewState} onChange={(event) => setReviewState(event.target.value)}>
            <option value="all">全部状态</option>
            <option value="due">今天到期</option>
            <option value="clear">未到期</option>
          </select>
        </label>
        <label>
          <span>排序</span>
          <select value={sortBy} onChange={(event) => setSortBy(event.target.value)}>
            <option value="updated">最近更新</option>
            <option value="due">待复习优先</option>
            <option value="cards">卡片数量</option>
            <option value="label">名称</option>
          </select>
        </label>
      </div>

      {rows.length ? (
        <div className="library-table">
          <div className="library-head">
            <span>概念</span>
            <span>分类</span>
            <span>卡片</span>
            <span>关系</span>
            <span>复习</span>
            <span />
          </div>
          {rows.map(({ node, dueCount, cardCount, relationCount, nextReview }) => {
            const categoryMeta = categoryFor(node);
            return (
              <article key={node.id} className="library-row">
                <button className="library-concept" onClick={() => onOpenNode(node.id)}>
                  <strong>{node.label}</strong>
                  <span>{node.desc}</span>
                </button>
                <span className="category-badge" style={{ color: categoryMeta.color, background: categoryMeta.light }}>
                  {categoryMeta.label}
                </span>
                <strong>{cardCount}</strong>
                <strong>{relationCount}</strong>
                <span className={dueCount ? "library-due" : "library-next"}>
                  {dueCount ? `${dueCount} 张到期` : daysUntil(nextReview)}
                </span>
                <div className="library-actions">
                  <button className="secondary-button compact" onClick={() => onOpenNode(node.id)}>
                    打开
                  </button>
                  <button className="icon-button relation-delete" onClick={() => onDeleteNode(node.id)} aria-label={`删除 ${node.label}`}>
                    <Trash2 size={14} />
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="library-empty">
          <Search size={28} />
          <strong>没有匹配的概念</strong>
          <span>调整搜索词、分类或复习状态。</span>
        </div>
      )}
    </section>
  );
}

function ReviewView({ dueCards, onRate }) {
  const [selectedIndex, setSelectedIndex] = useState(null);
  const [spinning, setSpinning] = useState(true);
  const selectedCard = selectedIndex === null ? null : dueCards[selectedIndex];
  const carouselQuantity = Math.max(dueCards.length, 3);

  useEffect(() => {
    setSelectedIndex(null);
    setSpinning(true);
  }, [dueCards]);

  function toggleCard(index) {
    if (selectedIndex === index) {
      setSelectedIndex(null);
      setSpinning(true);
      return;
    }

    setSelectedIndex(index);
    setSpinning(false);
  }

  function toggleSpin() {
    setSpinning((value) => {
      const next = !value;
      if (next) setSelectedIndex(null);
      return next;
    });
  }

  return (
    <section className="surface review-view">
      <div className="section-header">
        <div>
          <h2>知识卡牌</h2>
          <p>选择一张待复习卡片，翻面后按当前掌握程度评分。</p>
        </div>
        <div className="review-count">{dueCards.length ? `${dueCards.length} 张待复习` : "0 张待复习"}</div>
      </div>

      {dueCards.length ? (
        <div className="review-carousel">
          <div className="progress-track">
            <div style={{ width: selectedIndex === null ? "0%" : `${((selectedIndex + 1) / dueCards.length) * 100}%` }} />
          </div>

          <div className="review-carousel-stage">
            <div
              className={`review-carousel-inner ${spinning ? "is-spinning" : ""}`}
              style={{ "--carousel-quantity": carouselQuantity }}
            >
              {dueCards.map((card, index) => {
                const category = categoryFor(card);
                const color = reviewCarouselColors[index % reviewCarouselColors.length];
                const selected = selectedIndex === index;
                return (
                  <button
                    key={`${card.nodeId}-${card.id}`}
                    className={`review-carousel-slot ${selected ? "is-selected is-flipped" : ""}`}
                    style={{ "--carousel-index": index, "--carousel-color": color }}
                    onClick={() => toggleCard(index)}
                    aria-label={`${selected ? "收起" : "翻转"} ${card.question}`}
                  >
                    <span className="review-carousel-flipper">
                      <span className="review-carousel-face review-carousel-front">
                        <span className="review-carousel-tag" style={{ color: category.color }}>
                          {category.label}
                        </span>
                        <strong>{card.question}</strong>
                        <small>{card.label}</small>
                        <i />
                      </span>
                      <span className="review-carousel-face review-carousel-back">
                        <span className="review-carousel-tag" style={{ color: category.color }}>
                          {category.label}
                        </span>
                        <strong>{card.label}</strong>
                        <span>{card.answer}</span>
                        {card.codeExample ? <code>{card.codeExample}</code> : null}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="review-carousel-controls">
            <button className="secondary-button compact" onClick={toggleSpin}>
              {spinning ? <Pause size={14} /> : <Play size={14} />}
              {spinning ? "暂停" : "旋转"}
            </button>
            {selectedCard ? (
              <button
                className="secondary-button compact"
                onClick={() => {
                  setSelectedIndex(null);
                  setSpinning(true);
                }}
              >
                <X size={14} />
                取消选中
              </button>
            ) : null}
          </div>

          {selectedCard ? (
            <div className="review-rate-panel">
              <strong>{selectedCard.question}</strong>
              <p>{selectedCard.label} 的掌握程度如何？</p>
              <div className="review-rate-grid">
                {[
                  { quality: 1, label: "忘了", tone: "lost" },
                  { quality: 2, label: "模糊", tone: "fuzzy" },
                  { quality: 4, label: "基本会", tone: "good" },
                  { quality: 5, label: "掌握", tone: "mastered" },
                ].map((item) => (
                  <button key={item.quality} className={`review-rate-button ${item.tone}`} onClick={() => onRate(selectedCard, item.quality)}>
                    {item.label}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="empty-state">
          <Check size={40} />
          <h3>今天没有待复习的概念</h3>
          <p>新增概念会立即进入复习队列。</p>
        </div>
      )}
    </section>
  );
}

function AddView({ data, onAdd, onAcceptExtraction, onToast }) {
  const [manualDraft, setManualDraft] = useState({
    label: "",
    desc: "",
    question: "",
    answer: "",
    codeExample: "",
  });
  const [noteInput, setNoteInput] = useState("");
  const [extracting, setExtracting] = useState(false);
  const [extractError, setExtractError] = useState("");
  const [preview, setPreview] = useState(null);
  const [query, setQuery] = useState("");

  const visibleNodes = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return data.nodes;
    return data.nodes.filter((node) => `${node.label} ${node.desc}`.toLowerCase().includes(needle));
  }, [data.nodes, query]);

  function submit() {
    const added = onAdd(manualDraft);
    if (added) {
      setManualDraft({
        label: "",
        desc: "",
        question: "",
        answer: "",
        codeExample: "",
      });
    }
  }

  function patchPreviewNode(nodeId, patch) {
    const duplicatePatch =
      typeof patch.label === "string"
        ? (() => {
            const target = data.nodes.find((node) => node.label.toLowerCase() === patch.label.trim().toLowerCase());
            return target
              ? { duplicate: true, duplicateTargetId: target.id, mergeMode: "skip", selected: false }
              : { duplicate: false, duplicateTargetId: "", mergeMode: "new" };
          })()
        : {};
    setPreview((current) => ({
      ...current,
      nodes: current.nodes.map((node) => (node.id === nodeId ? { ...node, ...patch, ...duplicatePatch } : node)),
    }));
  }

  function patchPreviewEdge(edgeId, patch) {
    setPreview((current) => ({
      ...current,
      edges: current.edges.map((edge) => (edge.id === edgeId ? { ...edge, ...patch } : edge)),
    }));
  }

  async function buildPreview() {
    const sourceText = noteInput.trim();
    if (!sourceText) {
      setExtractError("先粘贴笔记或代码片段。");
      return;
    }

    setExtractError("");
    setExtracting(true);
    try {
      const result = await extractConcepts(
        sourceText,
        data.nodes.map((node) => node.label),
      );
      const existingById = new Map(data.nodes.map((node) => [node.id, node]));
      const existingByLabel = new Map(data.nodes.map((node) => [node.label.toLowerCase(), node]));
      const nodes = (result.nodes || []).map((item, index) => {
        const node = normalizeNode(item, `preview-${index}`);
        const duplicateTarget = existingById.get(node.id) || existingByLabel.get(node.label.toLowerCase());
        return {
          ...node,
          selected: !duplicateTarget,
          duplicate: Boolean(duplicateTarget),
          duplicateTargetId: duplicateTarget?.id || "",
          mergeMode: duplicateTarget ? "skip" : "new",
        };
      });
      const existingIds = new Set(data.nodes.map((node) => node.id));
      const endpointIds = new Set([...existingIds, ...nodes.map((node) => node.id)]);
      const edges = (result.edges || [])
        .map((edge, index) => ({ ...normalizeEdge(edge, index), selected: true }))
        .filter((edge) => endpointIds.has(edge.from) && endpointIds.has(edge.to));

      setPreview({
        provider: result.provider || "mock",
        warning: result.warning || "",
        sourceText,
        nodes,
        edges,
      });
      if (!nodes.length) onToast("没有提取到新概念，可改用手动建卡。", "warning");
    } catch (error) {
      setExtractError(`提取失败：${error.message}`);
    } finally {
      setExtracting(false);
    }
  }

  function acceptPreview() {
    if (!preview) return;
    const committed = onAcceptExtraction({
      nodes: preview.nodes.filter((node) => node.selected || node.mergeMode === "append-card"),
      edges: preview.edges.filter((edge) => edge.selected),
      sourceText: preview.sourceText,
    });
    if (committed) {
      setPreview(null);
      setNoteInput("");
    }
  }

  const previewEndpointOptions = preview ? [...data.nodes, ...preview.nodes] : [];
  const previewWillWrite = preview?.nodes.some((node) => node.selected || node.mergeMode === "append-card");

  return (
    <section className="surface add-view">
      <div className="section-header">
        <div>
          <h2>添加与提取</h2>
          <p>新内容先变成可校正的卡片和关系草稿，确认后再写入图谱。</p>
        </div>
        <Database size={22} />
      </div>

      <div className="add-workbench">
        <div className="add-pane">
          <div className="pane-header">
            <h3>从笔记提取</h3>
            <span>先预览后入库</span>
          </div>
          <label>
            <span>笔记或代码</span>
            <textarea
              value={noteInput}
              onChange={(event) => setNoteInput(event.target.value)}
              placeholder="粘贴一段学习笔记。离线时会使用 mock 提取器，仍然先生成草稿供你确认。"
            />
          </label>
          {extractError ? <p className="inline-warning">{extractError}</p> : null}
          <div className="action-row">
            <button className="primary-button" onClick={buildPreview} disabled={extracting || !noteInput.trim()}>
              {extracting ? <Loader2 size={16} className="spin" /> : <Sparkles size={16} />}
              {extracting ? "提取中" : "生成草稿"}
            </button>
          </div>
        </div>

        <div className="add-pane manual-pane">
          <div className="pane-header">
            <h3>手动建卡</h3>
            <span>直接创建</span>
          </div>
          <div className="manual-grid">
            <label>
              <span>概念名称</span>
              <input
                value={manualDraft.label}
                onChange={(event) => setManualDraft({ ...manualDraft, label: event.target.value })}
                placeholder="例如：Promise.all"
              />
            </label>
            <label>
              <span>解释</span>
              <textarea
                value={manualDraft.desc}
                onChange={(event) => setManualDraft({ ...manualDraft, desc: event.target.value })}
                placeholder="一句话说明这个概念。"
              />
            </label>
            <label>
              <span>复习问题</span>
              <textarea
                value={manualDraft.question}
                onChange={(event) => setManualDraft({ ...manualDraft, question: event.target.value })}
                placeholder="Promise.all 在什么情况下 reject？"
              />
            </label>
            <label>
              <span>卡片答案</span>
              <textarea
                value={manualDraft.answer}
                onChange={(event) => setManualDraft({ ...manualDraft, answer: event.target.value })}
                placeholder="用于复习卡背面。留空时使用解释。"
              />
            </label>
            <label>
              <span>代码示例</span>
              <textarea
                className="code-input"
                value={manualDraft.codeExample}
                onChange={(event) => setManualDraft({ ...manualDraft, codeExample: event.target.value })}
                placeholder="可选。"
              />
            </label>
          </div>
          <div className="action-row">
            <button className="secondary-button" onClick={submit} disabled={!manualDraft.label.trim()}>
              <CirclePlus size={16} />
              创建卡片
            </button>
          </div>
        </div>
      </div>

      {preview ? (
        <div className="extraction-preview">
          <div className="pane-header">
            <h3>提取草稿</h3>
            <span>{preview.provider === "anthropic" ? "Anthropic" : "离线提取器"}</span>
          </div>
          {preview.warning ? <p className="inline-warning">{preview.warning}</p> : null}
          <div className="preview-section">
            <strong>概念</strong>
            <div className="preview-grid">
              {preview.nodes.map((node) => (
                <article key={node.id} className={`preview-item ${node.duplicate ? "is-duplicate" : ""}`}>
                  <label className="check-row">
                    <input
                      type="checkbox"
                      checked={node.selected}
                      disabled={node.duplicate && node.mergeMode === "append-card"}
                      onChange={(event) => patchPreviewNode(node.id, { selected: event.target.checked })}
                    />
                    <span>{node.duplicate ? "与已有概念冲突，确认前先改名" : "写入图谱"}</span>
                  </label>
                  {node.duplicate ? (
                    <label className="duplicate-action">
                      <span>重复建议</span>
                      <select
                        value={node.mergeMode}
                        onChange={(event) =>
                          patchPreviewNode(node.id, {
                            mergeMode: event.target.value,
                            selected: event.target.value === "new" ? node.selected : false,
                          })
                        }
                      >
                        <option value="skip">跳过重复概念</option>
                        <option value="append-card">向已有概念添加卡片</option>
                        <option value="new">改名后新建节点</option>
                      </select>
                    </label>
                  ) : null}
                  <div className="preview-fields">
                    <input value={node.label} onChange={(event) => patchPreviewNode(node.id, { label: event.target.value })} />
                    <select value={node.category} onChange={(event) => patchPreviewNode(node.id, { category: event.target.value })}>
                      {Object.entries(categories).map(([key, item]) => (
                        <option key={key} value={key}>
                          {item.label}
                        </option>
                      ))}
                    </select>
                    <textarea value={node.desc} onChange={(event) => patchPreviewNode(node.id, { desc: event.target.value })} />
                    <textarea
                      value={node.question}
                      onChange={(event) => patchPreviewNode(node.id, { question: event.target.value })}
                      placeholder="复习问题"
                    />
                    <textarea
                      value={node.answer}
                      onChange={(event) => patchPreviewNode(node.id, { answer: event.target.value })}
                      placeholder="卡片答案"
                    />
                  </div>
                </article>
              ))}
            </div>
          </div>
          <div className="preview-section">
            <strong>关系</strong>
            {preview.edges.length ? (
              <div className="preview-edge-list">
                {preview.edges.map((edge) => (
                  <div key={edge.id} className="preview-edge">
                    <input
                      type="checkbox"
                      checked={edge.selected}
                      onChange={(event) => patchPreviewEdge(edge.id, { selected: event.target.checked })}
                      aria-label={`写入关系 ${edge.label}`}
                    />
                    <select value={edge.from} onChange={(event) => patchPreviewEdge(edge.id, { from: event.target.value })}>
                      {previewEndpointOptions.map((node, index) => (
                        <option key={`from-${edge.id}-${node.id}-${index}`} value={node.id}>
                          {node.label}
                        </option>
                      ))}
                    </select>
                    <input value={edge.label} onChange={(event) => patchPreviewEdge(edge.id, { label: event.target.value })} />
                    <select value={edge.to} onChange={(event) => patchPreviewEdge(edge.id, { to: event.target.value })}>
                      {previewEndpointOptions.map((node, index) => (
                        <option key={`to-${edge.id}-${node.id}-${index}`} value={node.id}>
                          {node.label}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
            ) : (
              <p className="relation-empty">这次没有提取到关系，入库后可在节点详情里手动连接。</p>
            )}
          </div>
          <div className="preview-actions">
            <button className="secondary-button" onClick={() => setPreview(null)}>
              丢弃草稿
            </button>
            <button className="primary-button" onClick={acceptPreview} disabled={!previewWillWrite}>
              <Save size={16} />
              确认写入
            </button>
          </div>
        </div>
      ) : null}

      <div className="concept-list-header">
        <strong>已有概念</strong>
        <label className="search-box">
          <Search size={15} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索" />
        </label>
      </div>

      <div className="concept-list">
        {visibleNodes.map((node) => (
          <button key={node.id} style={{ color: categoryFor(node).color, background: categoryFor(node).light }}>
            {node.label}
          </button>
        ))}
      </div>
    </section>
  );
}

export function App() {
  const [data, setData] = useState(() => normalizeMindCodeData(seedData()));
  const [view, setView] = useState("graph");
  const [selectedId, setSelectedId] = useState(null);
  const [graphFilters, setGraphFilters] = useState({ query: "", categories: [] });
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dataTask, setDataTask] = useState("");
  const [toast, setToast] = useState(null);
  const skipSave = useRef(true);

  const dueCards = useMemo(() => reviewQueue(data.nodes), [data.nodes]);

  const showToast = useCallback((message, type = "info") => {
    setToast({ message, type });
    window.clearTimeout(showToast.timer);
    showToast.timer = window.setTimeout(() => setToast(null), 3000);
  }, []);

  useEffect(() => {
    let cancelled = false;
    loadData()
      .then((result) => {
        if (cancelled) return;
        setData(normalizeMindCodeData(result.data));
        setLoaded(true);
        skipSave.current = true;
        writeLocalCache(result.data);
        if (result.warning) showToast(result.warning, "warning");
      })
      .catch((error) => {
        if (cancelled) return;
        setLoaded(true);
        skipSave.current = true;
        showToast(`加载失败，已使用示例数据：${error.message}`, "warning");
      });
    return () => {
      cancelled = true;
    };
  }, [showToast]);

  useEffect(() => {
    if (!loaded) return;
    if (skipSave.current) {
      skipSave.current = false;
      return;
    }

    const handle = window.setTimeout(() => {
      setSaving(true);
      saveData({ ...data, updatedAt: Date.now() })
        .catch((error) => showToast(`保存失败：${error.message}`, "warning"))
        .finally(() => setSaving(false));
    }, 250);

    return () => window.clearTimeout(handle);
  }, [data, loaded, showToast]);

  const updateNode = (nodeId, patch) => {
    const timestamp = Date.now();
    setData((previous) => ({
      ...previous,
      nodes: previous.nodes.map((node) =>
        node.id === nodeId
          ? {
              ...node,
              ...patch,
              label: patch.label ?? node.label,
              category: patch.category ?? node.category,
              desc: patch.desc ?? node.desc,
              updatedAt: timestamp,
            }
          : node,
      ),
      updatedAt: timestamp,
    }));
    showToast("概念已更新");
  };

  const deleteNode = (nodeId) => {
    const node = data.nodes.find((item) => item.id === nodeId);
    if (!node) return;
    const confirmed = window.confirm(`删除「${node.label}」？相关关系也会一并删除。`);
    if (!confirmed) return;
    setData((previous) => ({
      ...previous,
      nodes: previous.nodes.filter((item) => item.id !== nodeId),
      edges: previous.edges.filter((edge) => edge.from !== nodeId && edge.to !== nodeId),
      updatedAt: Date.now(),
    }));
    setSelectedId(null);
    showToast("概念已删除");
  };

  const exportDataAction = async () => {
    setDataTask("export");
    try {
      const result = window.mindcode?.exportData ? await window.mindcode.exportData(data) : downloadJsonExport(data);
      if (!result?.canceled) showToast("数据已导出");
    } catch (error) {
      showToast(`导出失败：${error.message}`, "warning");
    } finally {
      setDataTask("");
    }
  };

  const importDataAction = async (file) => {
    setDataTask("import");
    try {
      let result;
      if (file) {
        result = { ok: true, data: normalizeMindCodeData(JSON.parse(await file.text())), browserImport: true };
      } else if (window.mindcode?.importData) {
        result = await window.mindcode.importData();
      } else {
        showToast("请在桌面应用中选择文件，或使用知识库里的文件导入按钮。", "warning");
        return;
      }

      if (result?.canceled) return;
      const nextData = normalizeMindCodeData(result.data);
      skipSave.current = !result.browserImport;
      setData(nextData);
      setGraphFilters({ query: "", categories: [] });
      setSelectedId(null);
      showToast(`已导入 ${nextData.nodes.length} 个概念`);
    } catch (error) {
      showToast(`导入失败：${error.message}`, "warning");
    } finally {
      setDataTask("");
    }
  };

  const backupDataAction = async () => {
    setDataTask("backup");
    try {
      if (window.mindcode?.backupData) {
        await window.mindcode.backupData(data);
        showToast("备份快照已创建");
      } else {
        downloadJsonExport(data);
        showToast("当前是浏览器预览，已导出 JSON 作为备份");
      }
    } catch (error) {
      showToast(`备份失败：${error.message}`, "warning");
    } finally {
      setDataTask("");
    }
  };

  const openNodeInGraph = (nodeId) => {
    setGraphFilters({ query: "", categories: [] });
    setSelectedId(nodeId);
    setView("graph");
  };

  const createEdge = ({ from, to, label }) => {
    if (!from || !to || from === to) {
      showToast("关系需要连接两个不同概念", "warning");
      return false;
    }

    if (data.edges.some((edge) => edge.from === from && edge.to === to && edge.label === label)) {
      showToast("相同关系已存在", "warning");
      return false;
    }

    const edge = normalizeEdge({ id: `edge-${Date.now()}`, from, to, label }, data.edges.length);
    setData((previous) => ({
      ...previous,
      edges: [...previous.edges, edge],
      updatedAt: Date.now(),
    }));
    showToast("关系已创建");
    return true;
  };

  const updateEdge = (edgeId, patch) => {
    setData((previous) => ({
      ...previous,
      edges: previous.edges.map((edge) => (edge.id === edgeId ? normalizeEdge({ ...edge, ...patch }) : edge)),
      updatedAt: Date.now(),
    }));
    showToast("关系已更新");
  };

  const deleteEdge = (edgeId) => {
    setData((previous) => ({
      ...previous,
      edges: previous.edges.filter((edge) => edge.id !== edgeId),
      updatedAt: Date.now(),
    }));
    showToast("关系已删除");
  };

  const handleRate = (card, quality) => {
    if (!card) return;
    const updated = sm2(card, quality);
    setData((previous) => ({
      ...previous,
      nodes: previous.nodes.map((node) =>
        node.id === card.nodeId
          ? {
              ...node,
              cards: cardsForNode(node).map((item) => (item.id === card.id ? { ...item, ...updated } : item)),
              updatedAt: Date.now(),
            }
          : node,
      ),
      updatedAt: Date.now(),
    }));

    if (dueCards.length <= 1) {
      setView("graph");
      showToast("今日复习完成");
    }
  };

  const handleAdd = ({ label, desc, question, answer, codeExample }) => {
    if (!label) {
      showToast("无法添加：请填写概念名称", "warning");
      return false;
    }

    const newNode = normalizeNode(
      {
        label,
        desc: desc || undefined,
        question: question || undefined,
        answer: answer || undefined,
        codeExample: codeExample || undefined,
      },
      `concept-${Date.now()}`,
    );
    if (data.nodes.some((node) => node.id === newNode.id)) {
      showToast("无法添加：已有同名概念", "warning");
      return false;
    }

    setData((previous) => ({
      ...previous,
      nodes: [...previous.nodes, newNode],
      updatedAt: Date.now(),
    }));
    setView("graph");
    setSelectedId(newNode.id);
    showToast("概念已添加");
    return true;
  };

  const acceptExtraction = ({ nodes, edges, sourceText }) => {
    const timestamp = Date.now();
    const existingIds = new Set(data.nodes.map((node) => node.id));
    const existingLabels = new Set(data.nodes.map((node) => node.label.toLowerCase()));
    const existingNodes = new Map(data.nodes.map((node) => [node.id, node]));
    const acceptedIds = new Map();
    const appendedCards = new Map();
    const acceptedNodes = [];

    nodes.forEach((node, index) => {
      if (node.mergeMode === "append-card") {
        const target = existingNodes.get(node.duplicateTargetId);
        if (!target) return;
        const card = normalizeCard(
          {
            ...cardsForNode(node)[0],
            id: `card-${timestamp}-${index}`,
            nextReview: timestamp,
            createdAt: timestamp,
            updatedAt: timestamp,
          },
          target,
        );
        const next = appendedCards.get(target.id) || [];
        next.push(card);
        appendedCards.set(target.id, next);
        acceptedIds.set(node.id, target.id);
        return;
      }

      if (!node.selected) return;
      const next = normalizeNode(
        {
          ...node,
          id: undefined,
          sources: [...node.sources, { text: sourceText, createdAt: timestamp }],
        },
        `extracted-${index}`,
      );
      const duplicate = existingIds.has(next.id) || existingLabels.has(next.label.toLowerCase());
      if (duplicate) return;
      existingIds.add(next.id);
      existingLabels.add(next.label.toLowerCase());
      acceptedIds.set(node.id, next.id);
      acceptedNodes.push(next);
    });

    if (!acceptedNodes.length && !appendedCards.size) {
      showToast("草稿里没有可写入的新概念", "warning");
      return false;
    }

    const endpointIds = new Set([...data.nodes.map((node) => node.id), ...acceptedNodes.map((node) => node.id)]);
    const existingEdgeKeys = new Set(data.edges.map((edge) => `${edge.from}:${edge.to}:${edge.label}`));
    const acceptedEdges = edges
      .map((edge, index) =>
        normalizeEdge(
          {
            ...edge,
            id: `extract-edge-${Date.now()}-${index}`,
            from: acceptedIds.get(edge.from) || edge.from,
            to: acceptedIds.get(edge.to) || edge.to,
          },
          index,
        ),
      )
      .filter((edge) => {
        const key = `${edge.from}:${edge.to}:${edge.label}`;
        const valid = endpointIds.has(edge.from) && endpointIds.has(edge.to) && edge.from !== edge.to && !existingEdgeKeys.has(key);
        if (valid) existingEdgeKeys.add(key);
        return valid;
      });

    setData((previous) => ({
      ...previous,
      nodes: [
        ...previous.nodes.map((node) =>
          appendedCards.has(node.id)
            ? {
                ...node,
                cards: [...cardsForNode(node), ...appendedCards.get(node.id)],
                sources: [...node.sources, { text: sourceText, createdAt: timestamp }],
                updatedAt: timestamp,
              }
            : node,
        ),
        ...acceptedNodes,
      ],
      edges: [...previous.edges, ...acceptedEdges],
      updatedAt: timestamp,
    }));
    setView("graph");
    setSelectedId(acceptedNodes[0]?.id || [...appendedCards.keys()][0]);
    showToast(`已写入 ${acceptedNodes.length} 个概念、${[...appendedCards.values()].flat().length} 张附加卡、${acceptedEdges.length} 条关系`);
    return true;
  };

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand-group">
          <div className="brand">
            <div className="brand-mark">
              <Brain size={22} />
            </div>
            <div>
              <h1>MindCode</h1>
              <p>编程概念知识图谱与间隔复习工具</p>
            </div>
          </div>
          <span className="count-chip">{data.nodes.length} concepts</span>
        </div>

        <div className="header-controls">
          <nav className="nav-list" aria-label="主导航">
            {views.map((item) => {
              const Icon = item.icon;
              const count = item.id === "review" ? todayCount(data.nodes) : null;
              return (
                <button
                  key={item.id}
                  className={view === item.id ? "active" : ""}
                  onClick={() => {
                    setView(item.id);
                  }}
                >
                  <Icon size={16} />
                  <span>{item.label}</span>
                  {count ? <strong>{count}</strong> : null}
                </button>
              );
            })}
          </nav>
          <div className="sync-state">
            {loaded ? null : <Loader2 size={16} className="spin" />}
            {saving ? "保存中" : loaded ? "已保存" : "加载中"}
          </div>
        </div>
      </header>

      <main className="main-panel">
        <div className="overview-row">
          <div>
            <p className="eyebrow">Desktop MVP</p>
            <h2>{viewLabels[view]}</h2>
          </div>
          <div>
            <div className="overview-stats">
              <Stat label="概念" value={data.nodes.length} />
              <Stat label="关系" value={data.edges.length} />
              <Stat label="今日" value={todayCount(data.nodes)} />
            </div>
          </div>
        </div>

        {view === "graph" ? (
          <GraphView
            data={data}
            selectedId={selectedId}
            onSelect={setSelectedId}
            filters={graphFilters}
            onFiltersChange={setGraphFilters}
            onUpdateNode={updateNode}
            onDeleteNode={deleteNode}
            onCreateEdge={createEdge}
            onUpdateEdge={updateEdge}
            onDeleteEdge={deleteEdge}
          />
        ) : null}
        {view === "library" ? (
          <LibraryView
            data={data}
            desktopDataTools={Boolean(window.mindcode?.importData)}
            dataTask={dataTask}
            onOpenNode={openNodeInGraph}
            onDeleteNode={deleteNode}
            onExportData={exportDataAction}
            onImportData={importDataAction}
            onBackupData={backupDataAction}
          />
        ) : null}
        {view === "review" ? <ReviewView dueCards={dueCards} onRate={handleRate} /> : null}
        {view === "add" ? (
          <AddView data={data} onAdd={handleAdd} onAcceptExtraction={acceptExtraction} onToast={showToast} />
        ) : null}
      </main>

      <button className={`add-fab ${view === "add" ? "active" : ""}`} onClick={() => setView("add")}>
        <CirclePlus size={19} />
        <span>添加新概念</span>
      </button>
      <Toast toast={toast} onClear={() => setToast(null)} />
    </div>
  );
}
