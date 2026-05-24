import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useInView, useMotionValue, useSpring, useTransform } from "motion/react";
import CircularGallery from "./CircularGallery.jsx";
import {
  Check,
  CirclePlus,
  Edit3,
  Filter,
  GitBranch,
  KeyRound,
  LibraryBig,
  Loader2,
  Link2,
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
import { formatObsidianNotes, formatObsidianSummaries, sourceTextForExtraction } from "./shared/obsidian.js";

const storageKey = "mindcode-browser-data";
const views = [
  { id: "graph", label: "图谱", icon: GitBranch },
  { id: "library", label: "知识库", icon: LibraryBig },
  { id: "review", label: "复习", icon: RotateCcw },
];
const graphViewport = { x: 0, y: 0, width: 1600, height: 1100 };
const graphCenter = { x: graphViewport.width / 2, y: graphViewport.height / 2 };
const curveSpring = 0.14;
const curveDamping = 0.68;
const reviewCarouselColors = [
  "30, 30, 28",
  "55, 54, 51",
  "80, 78, 74",
  "105, 103, 98",
  "45, 44, 42",
  "65, 63, 60",
  "35, 34, 32",
  "90, 88, 84",
  "50, 49, 46",
  "70, 68, 64",
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

function ApiKeyModal({
  open,
  status,
  draft,
  message,
  saving,
  onDraftChange,
  onSave,
  onClear,
  onClose,
}) {
  if (!open) return null;

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="settings-modal" role="dialog" aria-modal="true" aria-label="DeepSeek API Key 设置">
        <div className="modal-header">
          <div>
            <h3>DeepSeek API Key</h3>
            <p>{status?.hasApiKey ? "已保存本机 API key。" : "Obsidian 导入和 AI 提取需要 DeepSeek API key。"}</p>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="关闭">
            <X size={18} />
          </button>
        </div>
        {message ? <p className="inline-warning">{message}</p> : null}
        <label>
          <span>API Key</span>
          <input
            value={draft}
            onChange={(event) => onDraftChange(event.target.value)}
            placeholder={status?.hasApiKey ? "输入新 key 可覆盖已保存配置" : "sk-..."}
            type="password"
            autoFocus
          />
        </label>
        <div className="modal-actions">
          <button className="secondary-button" onClick={onClear} disabled={saving || !status?.hasApiKey}>
            <Trash2 size={16} />
            清除
          </button>
          <button className="primary-button" onClick={onSave} disabled={saving || !draft.trim()}>
            {saving ? <Loader2 size={16} className="spin" /> : <Save size={16} />}
            {saving ? "保存中" : "保存"}
          </button>
        </div>
      </section>
    </div>
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
  const neighborVelocityRef = useRef({});
  const lastDragPosRef = useRef(null);
  const [positions, setPositions] = useState({});
  const [dragging, setDragging] = useState(null);
  const [panning, setPanning] = useState(false);
  const [viewport, setViewport] = useState(graphViewport);
  const [, setCurveRevision] = useState(0);
  const [tooltip, setTooltip] = useState(null);

  useEffect(() => {
    const width = 1600;
    const height = 1100;
    setPositions((previous) => {
      const next = {};
      nodes.forEach((node) => {
        if (previous[node.id]) {
          next[node.id] = previous[node.id];
          return;
        }
        const padding = 120;
        next[node.id] = {
          x: padding + Math.random() * (width - padding * 2),
          y: padding + Math.random() * (height - padding * 2),
        };
      });

      const repulsion = 18000;
      const attraction = 0.012;
      const centerGravity = 0.002;
      const targetLength = 260;
      const centerX = width / 2;
      const centerY = height / 2;
      const iterations = 120;
      const nodeList = nodes.map((node) => ({ id: node.id, ...next[node.id] }));

      for (let iteration = 0; iteration < iterations; iteration += 1) {
        const forces = Object.fromEntries(nodeList.map((node) => [node.id, { fx: 0, fy: 0 }]));

        for (let i = 0; i < nodeList.length; i += 1) {
          for (let j = i + 1; j < nodeList.length; j += 1) {
            const first = nodeList[i];
            const second = nodeList[j];
            const deltaX = second.x - first.x || 0.1;
            const deltaY = second.y - first.y || 0.1;
            const distanceSquared = Math.max(deltaX * deltaX + deltaY * deltaY, 1);
            const distance = Math.sqrt(distanceSquared);
            const force = repulsion / distanceSquared;
            const forceX = (deltaX / distance) * force;
            const forceY = (deltaY / distance) * force;

            forces[first.id].fx -= forceX;
            forces[first.id].fy -= forceY;
            forces[second.id].fx += forceX;
            forces[second.id].fy += forceY;
          }
        }

        edges.forEach((edge) => {
          const first = nodeList.find((node) => node.id === edge.from);
          const second = nodeList.find((node) => node.id === edge.to);
          if (!first || !second) return;

          const deltaX = second.x - first.x;
          const deltaY = second.y - first.y;
          const distance = Math.max(Math.hypot(deltaX, deltaY), 1);
          const stretch = distance - targetLength;
          const forceX = (deltaX / distance) * stretch * attraction * distance;
          const forceY = (deltaY / distance) * stretch * attraction * distance;

          forces[first.id].fx += forceX;
          forces[first.id].fy += forceY;
          forces[second.id].fx -= forceX;
          forces[second.id].fy -= forceY;
        });

        nodeList.forEach((node) => {
          forces[node.id].fx += (centerX - node.x) * centerGravity;
          forces[node.id].fy += (centerY - node.y) * centerGravity;
        });

        const cooling = 1 - iteration / iterations;
        const maxStep = 60 * cooling + 2;
        nodeList.forEach((node) => {
          const force = forces[node.id];
          const magnitude = Math.hypot(force.fx, force.fy) || 1;
          const step = Math.min(magnitude, maxStep);
          node.x += (force.fx / magnitude) * step;
          node.y += (force.fy / magnitude) * step;
          node.x = Math.max(80, Math.min(width - 80, node.x));
          node.y = Math.max(80, Math.min(height - 80, node.y));
        });
      }

      nodeList.forEach((node) => {
        next[node.id] = { x: node.x, y: node.y };
      });

      return next;
    });
  }, [edges, nodes]);

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
    setTooltip(null);
    const point = getPoint(event);
    const current = positions[nodeId] || { x: 800, y: 550 };
    dragOffset.current = { x: point.x - current.x, y: point.y - current.y };
    neighborVelocityRef.current = {};
    lastDragPosRef.current = null;
    setDragging(nodeId);
    onSelect(nodeId);
    event.currentTarget.setPointerCapture?.(event.pointerId);
    event.stopPropagation();
  };

  const handleCanvasPointerDown = (event) => {
    if (event.button !== 0 || event.target.closest?.(".graph-node")) return;
    setTooltip(null);
    panStart.current = { x: event.clientX, y: event.clientY, viewport };
    setPanning(true);
    onSelect(null);
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const handlePointerMove = useCallback(
    (event) => {
      if (dragging) {
        const point = getPoint(event);
        const newX = Math.max(64, Math.min(1536, point.x - dragOffset.current.x));
        const newY = Math.max(48, Math.min(1052, point.y - dragOffset.current.y));

        setPositions((previous) => {
          const next = { ...previous, [dragging]: { x: newX, y: newY } };
          const last = lastDragPosRef.current || { x: newX, y: newY };
          const dragDeltaX = newX - last.x;
          const dragDeltaY = newY - last.y;
          lastDragPosRef.current = { x: newX, y: newY };

          const neighborIds = new Set();
          edgesRef.current.forEach((edge) => {
            if (edge.from === dragging) neighborIds.add(edge.to);
            if (edge.to === dragging) neighborIds.add(edge.from);
          });

          const springStrength = 0.18;
          const damping = 0.72;
          const dragTransfer = 0.28;
          const restLength = 260;

          neighborIds.forEach((neighborId) => {
            if (!next[neighborId]) return;

            const velocity = neighborVelocityRef.current[neighborId] || { vx: 0, vy: 0 };
            const anchor = next[dragging];
            const neighbor = next[neighborId];
            const deltaX = anchor.x - neighbor.x;
            const deltaY = anchor.y - neighbor.y;
            const distance = Math.hypot(deltaX, deltaY) || 1;
            const stretch = distance - restLength;

            velocity.vx = (velocity.vx + dragDeltaX * dragTransfer) * damping;
            velocity.vy = (velocity.vy + dragDeltaY * dragTransfer) * damping;

            if (Math.abs(stretch) > 10) {
              velocity.vx += (deltaX / distance) * stretch * springStrength * 0.06;
              velocity.vy += (deltaY / distance) * stretch * springStrength * 0.06;
            }

            neighborVelocityRef.current[neighborId] = velocity;
            next[neighborId] = {
              x: Math.max(64, Math.min(1536, neighbor.x + velocity.vx)),
              y: Math.max(48, Math.min(1052, neighbor.y + velocity.vy)),
            };
          });

          return next;
        });
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
    neighborVelocityRef.current = {};
    lastDragPosRef.current = null;
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
          <pattern id="dot-grid" x="0" y="0" width="40" height="40" patternUnits="userSpaceOnUse">
            <circle cx="0" cy="0" r="0.9" fill="rgba(0,0,0,0.13)" />
          </pattern>
        </defs>

        <rect x="-2000" y="-2000" width="6000" height="6000" fill="url(#dot-grid)" />

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
          const point = positions[node.id] || { x: 800, y: 550 };
          const category = categoryFor(node);
          const selected = selectedId === node.id;
          const due = nodeIsDue(node);
          const width = Math.min(190, Math.max(108, node.label.length * 9 + 32));
          return (
            <g
              key={node.id}
              className={`graph-node ${selected ? "is-selected" : ""}`}
              onPointerDown={(event) => handlePointerDown(event, node.id)}
              onMouseEnter={(e) => { if (!draggingRef.current) setTooltip({ desc: node.desc, x: e.clientX, y: e.clientY }); }}
              onMouseLeave={() => setTooltip(null)}
              onMouseMove={(e) => { if (draggingRef.current) { setTooltip(null); return; } setTooltip(t => t ? { ...t, x: e.clientX, y: e.clientY } : null); }}
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

      {tooltip && (
        <div className="node-tooltip" style={{ left: tooltip.x + 14, top: tooltip.y - 10 }}>
          {tooltip.desc}
        </div>
      )}
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
        <button
          className="search-clear"
          type="button"
          onClick={(e) => { e.preventDefault(); onChange({ ...filters, query: "" }); }}
          aria-label="清除搜索"
        >
          <X size={10} />
        </button>
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

function LibraryAnimatedRow({ index, node, dueCount, nextReview, isFocused, onOpenNode, onDeleteNode }) {
  const ref = useRef(null);
  const inView = useInView(ref, { amount: 0.15, triggerOnce: false });
  const categoryMeta = categoryFor(node);

  return (
    <motion.article
      ref={ref}
      className={`library-row ${isFocused ? "is-focused" : ""}`}
      initial={{ opacity: 0, y: 10 }}
      animate={inView ? { opacity: 1, y: 0 } : { opacity: 0, y: 10 }}
      transition={{ duration: 0.2, delay: Math.min(index * 0.04, 0.32), ease: [0.23, 1, 0.32, 1] }}
    >
      <button className="library-concept" onClick={() => onOpenNode(node.id)}>
        <strong>{node.label}</strong>
        <span>{node.desc}</span>
      </button>
      <span className="category-badge" style={{ color: categoryMeta.color, background: categoryMeta.light }}>
        {categoryMeta.label}
      </span>
      <span className={dueCount ? "library-due" : "library-next"}>
        {dueCount ? `${dueCount} 张到期` : daysUntil(nextReview)}
      </span>
      <div className="library-actions">
        <button className="icon-button relation-delete" onClick={() => onDeleteNode(node.id)} aria-label={`删除 ${node.label}`}>
          <Trash2 size={14} />
        </button>
      </div>
    </motion.article>
  );
}

function LibraryView({ data, onOpenNode, onDeleteNode }) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [reviewState, setReviewState] = useState("all");
  const [sortBy, setSortBy] = useState("updated");
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const tableRef = useRef(null);

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

  // 筛选/排序变化时重置焦点
  useEffect(() => { setFocusedIndex(-1); }, [rows]);

  // 键盘导航
  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setFocusedIndex((prev) => Math.min(prev + 1, rows.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setFocusedIndex((prev) => Math.max(prev - 1, 0));
      } else if (e.key === "Enter" && focusedIndex >= 0) {
        onOpenNode(rows[focusedIndex].node.id);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [rows, focusedIndex, onOpenNode]);

  // 滚动到焦点行
  useEffect(() => {
    if (focusedIndex < 0 || !tableRef.current) return;
    const el = tableRef.current.querySelectorAll(".library-row")[focusedIndex];
    el?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [focusedIndex]);

  return (
    <section className="surface library-view">
      <div className="library-toolbar">
        <label className="search-box library-search">
          <Search size={15} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索概念、卡片或来源笔记" />
          <button
            className="search-clear"
            type="button"
            onClick={(e) => { e.preventDefault(); setQuery(""); }}
            aria-label="清除搜索"
          >
            <X size={10} />
          </button>
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
        <div className="library-table" ref={tableRef}>
          <div className="library-head">
            <span>概念</span>
            <span>分类</span>
            <span>复习</span>
            <span />
          </div>
          {rows.map(({ node, dueCount, nextReview }, index) => (
            <LibraryAnimatedRow
              key={node.id}
              index={index}
              node={node}
              dueCount={dueCount}
              nextReview={nextReview}
              isFocused={focusedIndex === index}
              onOpenNode={onOpenNode}
              onDeleteNode={onDeleteNode}
            />
          ))}
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

// ─── NavDock ──────────────────────────────────────────────────────────────────

function DockNavItem({ item, isActive, mouseX, onClick }) {
  const ref = useRef(null);
  const BASE = 46;
  const MAX  = 68;
  const DIST = 150;
  const springCfg = { mass: 0.1, stiffness: 180, damping: 14 };
  const Icon = item.icon;

  const mouseDistance = useTransform(mouseX, (val) => {
    const rect = ref.current?.getBoundingClientRect() ?? { x: 0, width: BASE };
    return val - rect.x - BASE / 2;
  });
  const targetSize = useTransform(mouseDistance, [-DIST, 0, DIST], [BASE, MAX, BASE]);
  const size = useSpring(targetSize, springCfg);

  const [hovered, setHovered] = useState(false);

  return (
    <div className="dock-item-wrap">
      <AnimatePresence>
        {hovered && (
          <motion.span
            className="dock-item-label"
            initial={{ opacity: 0, y: 6, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6, scale: 0.9 }}
            transition={{ duration: 0.12 }}
          >
            {item.label}
          </motion.span>
        )}
      </AnimatePresence>

      <motion.button
        ref={ref}
        style={{ width: size, height: size }}
        className={`dock-item-btn ${isActive ? "active" : ""}`}
        onClick={onClick}
        onHoverStart={() => setHovered(true)}
        onHoverEnd={() => setHovered(false)}
        aria-label={item.label}
      >
        <Icon size={20} strokeWidth={isActive ? 2.5 : 1.8} />
        {item.badge ? <span className="dock-item-badge">{item.badge}</span> : null}
      </motion.button>

      <span className={`dock-item-dot ${isActive ? "visible" : ""}`} />
    </div>
  );
}

function NavDock({ view, setView, reviewCount }) {
  const mouseX = useMotionValue(Infinity);

  const items = [
    { id: "graph",   label: "图谱",   icon: GitBranch },
    { id: "library", label: "知识库", icon: LibraryBig },
    { id: "review",  label: "复习",   icon: RotateCcw,  badge: reviewCount || null },
    { id: "add",     label: "添加",   icon: CirclePlus },
  ];

  return (
    <div className="nav-dock-outer">
      <motion.div
        className="nav-dock-panel"
        onMouseMove={(e) => mouseX.set(e.pageX)}
        onMouseLeave={() => mouseX.set(Infinity)}
      >
        {items.map((item) => (
          <DockNavItem
            key={item.id}
            item={item}
            isActive={view === item.id}
            mouseX={mouseX}
            onClick={() => setView(item.id)}
          />
        ))}
      </motion.div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function ReviewView({ dueCards, onRate }) {
  const [selectedCard, setSelectedCard] = useState(null);
  const [flipped, setFlipped] = useState(false);

  // 评分后 dueCards 变化 → 重置选中状态
  useEffect(() => {
    setSelectedCard(null);
    setFlipped(false);
  }, [dueCards]);

  function handleSelect(card) {
    setSelectedCard(card);
    setFlipped(false);
  }

  const cardColor = selectedCard
    ? reviewCarouselColors[dueCards.indexOf(selectedCard) % reviewCarouselColors.length]
    : null;
  const cardCategory = selectedCard ? categoryFor(selectedCard) : null;

  return (
    <section className="surface review-view">
      {dueCards.length ? (
        <div className="review-dome-wrap">
          <CircularGallery
            cards={dueCards}
            onSelect={handleSelect}
            bend={2}
            borderRadius={0.06}
            scrollSpeed={2}
            scrollEase={0.05}
          />
          {/* 点空白取消选中：遮罩盖住画廊，z-index 低于面板 */}
          {selectedCard && (
            <div
              className="review-dome-backdrop"
              onClick={() => { setSelectedCard(null); setFlipped(false); }}
            />
          )}

          <AnimatePresence>
            {selectedCard && (
              <motion.div
                className="review-dome-panel"
                initial={{ y: 48, opacity: 0 }}
                animate={{ y: 0,  opacity: 1 }}
                exit={{    y: 48, opacity: 0 }}
                transition={{ duration: 0.28, ease: [0.23, 1, 0.32, 1] }}
              >
                {/* 可翻转卡片 */}
                <button
                  className={`review-dome-card ${flipped ? "is-flipped" : ""}`}
                  style={{ "--carousel-color": cardColor }}
                  onClick={() => setFlipped(v => !v)}
                  aria-label={flipped ? "显示正面" : "翻到背面"}
                >
                  <span className="review-carousel-flipper">
                    <span className="review-carousel-face review-carousel-front">
                      <span className="review-carousel-tag" style={{ color: cardCategory?.color }}>
                        {cardCategory?.label}
                      </span>
                      <strong>{selectedCard.question}</strong>
                      <small>{selectedCard.label}</small>
                      <i />
                    </span>
                    <span className="review-carousel-face review-carousel-back">
                      <span className="review-carousel-tag" style={{ color: cardCategory?.color }}>
                        {cardCategory?.label}
                      </span>
                      <strong>{selectedCard.label}</strong>
                      <span>{selectedCard.answer}</span>
                      {selectedCard.codeExample ? <code>{selectedCard.codeExample}</code> : null}
                    </span>
                  </span>
                </button>

                {/* 评分面板：翻到背面后出现 */}
                <AnimatePresence>
                  {flipped && (
                    <motion.div
                      className="review-rate-panel"
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{    opacity: 0, y: 10 }}
                      transition={{ duration: 0.2 }}
                    >
                      <p>{selectedCard.label} 的掌握程度如何？</p>
                      <div className="review-rate-grid">
                        {[
                          { quality: 1, label: "忘了",   tone: "lost"     },
                          { quality: 2, label: "模糊",   tone: "fuzzy"    },
                          { quality: 4, label: "基本会", tone: "good"     },
                          { quality: 5, label: "掌握",   tone: "mastered" },
                        ].map((item) => (
                          <button
                            key={item.quality}
                            className={`review-rate-button ${item.tone}`}
                            onClick={() => onRate(selectedCard, item.quality)}
                          >
                            {item.label}
                          </button>
                        ))}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            )}
          </AnimatePresence>
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
  const [obsidianVault, setObsidianVault] = useState(null);
  const [readingObsidian, setReadingObsidian] = useState(false);
  const [summarizingObsidian, setSummarizingObsidian] = useState(false);
  const [obsidianSourceText, setObsidianSourceText] = useState("");
  const [aiConfigStatus, setAiConfigStatus] = useState(null);
  const [apiKeyModalOpen, setApiKeyModalOpen] = useState(false);
  const [apiKeyDraft, setApiKeyDraft] = useState("");
  const [apiKeyMessage, setApiKeyMessage] = useState("");
  const [savingApiKey, setSavingApiKey] = useState(false);

  const visibleNodes = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return data.nodes;
    return data.nodes.filter((node) => `${node.label} ${node.desc}`.toLowerCase().includes(needle));
  }, [data.nodes, query]);

  useEffect(() => {
    if (!window.mindcode?.getAiConfigStatus) return;

    window.mindcode
      .getAiConfigStatus()
      .then((status) => setAiConfigStatus(status))
      .catch(() => setAiConfigStatus(null));
  }, []);

  function openApiKeyModal(message = "") {
    setApiKeyDraft("");
    setApiKeyMessage(message);
    setApiKeyModalOpen(true);
  }

  function errorNeedsApiKey(error) {
    return String(error?.message || error || "").includes("DeepSeek API key");
  }

  async function refreshAiConfigStatus() {
    if (!window.mindcode?.getAiConfigStatus) return null;
    const status = await window.mindcode.getAiConfigStatus();
    setAiConfigStatus(status);
    return status;
  }

  async function saveApiKey() {
    if (!window.mindcode?.saveAiApiKey) return;

    setSavingApiKey(true);
    setApiKeyMessage("");
    try {
      const status = await window.mindcode.saveAiApiKey({ apiKey: apiKeyDraft });
      setAiConfigStatus(status);
      setApiKeyDraft("");
      setApiKeyModalOpen(false);
      onToast("DeepSeek API key 已保存");
    } catch (error) {
      setApiKeyMessage(`保存失败：${error.message}`);
    } finally {
      setSavingApiKey(false);
    }
  }

  async function clearApiKey() {
    if (!window.mindcode?.clearAiApiKey) return;

    setSavingApiKey(true);
    setApiKeyMessage("");
    try {
      const status = await window.mindcode.clearAiApiKey();
      setAiConfigStatus(status);
      setApiKeyDraft("");
      onToast("DeepSeek API key 已清除", "warning");
    } catch (error) {
      setApiKeyMessage(`清除失败：${error.message}`);
    } finally {
      setSavingApiKey(false);
    }
  }

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

  async function chooseObsidianVault() {
    if (!window.mindcode?.readObsidianVault) return;

    setExtractError("");
    const status = aiConfigStatus || (await refreshAiConfigStatus().catch(() => null));
    if (!status?.hasApiKey) {
      openApiKeyModal("Obsidian 导入需要 DeepSeek API key。保存后请重新点击 Obsidian。");
      return;
    }

    setReadingObsidian(true);
    try {
      const result = await window.mindcode.readObsidianVault();
      if (result?.canceled) return;
      const notes = (result?.notes || []).map((note, index) => ({ ...note, selected: index < 3 }));

      setObsidianVault({ ...result, notes });
      setObsidianSourceText("");
      setPreview(null);

      if (!notes.length) {
        onToast("这个 Vault 里没有可读取的 Markdown 笔记。", "warning");
        return;
      }

      if (result.warning) onToast(result.warning, "warning");
      else onToast(`已读取 ${notes.length} 篇 Obsidian 笔记`);
    } catch (error) {
      if (errorNeedsApiKey(error)) {
        openApiKeyModal("Obsidian 导入需要 DeepSeek API key。保存后请重新点击 Obsidian。");
      } else {
        setExtractError(`读取 Obsidian 失败：${error.message}`);
      }
    } finally {
      setReadingObsidian(false);
    }
  }

  function toggleObsidianNote(notePath, selected) {
    setObsidianVault((current) => ({
      ...current,
      notes: current.notes.map((note) => (note.path === notePath ? { ...note, selected } : note)),
    }));
  }

  function loadSelectedObsidianNotes() {
    return summarizeSelectedObsidianNotes();
  }

  async function summarizeSelectedObsidianNotes() {
    const selectedNotes = obsidianVault?.notes.filter((note) => note.selected) || [];
    const rawSourceText = formatObsidianNotes(selectedNotes);
    if (!rawSourceText) {
      setExtractError("至少选择一篇有内容的 Obsidian 笔记。");
      return;
    }

    if (!window.mindcode?.summarizeObsidianNotes) {
      setExtractError("当前环境不支持 Obsidian AI 总结。");
      return;
    }

    setExtractError("");
    setSummarizingObsidian(true);
    try {
      const result = await window.mindcode.summarizeObsidianNotes({ notes: selectedNotes });
      const summariesByPath = new Map((result.notes || []).map((note) => [note.path, note.summary]));
      const summarizedNotes = selectedNotes
        .map((note) => ({
          path: note.path,
          summary: summariesByPath.get(note.path) || "",
        }))
        .filter((note) => note.summary);
      const summaryText = formatObsidianSummaries(summarizedNotes);

      if (!summaryText) {
        setExtractError("AI 没有返回可用的 Obsidian 摘要。");
        return;
      }

      setNoteInput(summaryText);
      setObsidianSourceText(rawSourceText);
      setPreview(null);
      onToast(`已总结 ${summarizedNotes.length} 篇 Obsidian 笔记`);
    } catch (error) {
      if (errorNeedsApiKey(error)) {
        openApiKeyModal("Obsidian 导入需要 DeepSeek API key。保存后请重新点击 Obsidian。");
      } else {
        setExtractError(`Obsidian 总结失败：${error.message}`);
      }
    } finally {
      setSummarizingObsidian(false);
    }
  }

  async function buildPreview() {
    const { extractionText, sourceText } = sourceTextForExtraction({
      summaryText: noteInput,
      rawSourceText: obsidianSourceText,
    });
    if (!extractionText) {
      setExtractError("先粘贴笔记或代码片段。");
      return;
    }

    setExtractError("");
    setExtracting(true);
    try {
      const result = await extractConcepts(
        extractionText,
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
        summaryText: extractionText,
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

  const [previewStep, setPreviewStep] = useState(0);
  const [cardFlipped, setCardFlipped] = useState(false);

  const previewEndpointOptions = preview ? [...data.nodes, ...preview.nodes] : [];
  const previewWillWrite = preview?.nodes.some((node) => node.selected || node.mergeMode === "append-card");
  const selectedObsidianCount = obsidianVault?.notes.filter((note) => note.selected).length || 0;
  const providerLabel = aiConfigStatus?.hasApiKey ? "DeepSeek" : "API Key";

  const manualHasLabel = manualDraft.label.trim().length > 0;
  const manualHasDesc = manualDraft.desc.trim().length > 0;
  const manualHasQuestion = manualDraft.question.trim().length > 0;
  const previewQuestion = manualDraft.question.trim() || (manualHasLabel ? `如何解释 ${manualDraft.label.trim()}？` : "");
  const previewAnswer = manualDraft.answer.trim() || manualDraft.desc.trim();

  function goToPreviewStep(index) {
    setPreviewStep(Math.max(0, Math.min(index, (preview?.nodes.length ?? 0))));
  }

  const currentPreviewNode = preview?.nodes[previewStep] ?? null;
  const isOnEdgesStep = preview && previewStep >= preview.nodes.length;

  return (
    <section className="surface add-view">
      <div className="add-workbench">
        <div className="add-pane">
          <div className="pane-header">
            <h3>从笔记提取</h3>
            <div className="pane-actions">
              {window.mindcode?.getAiConfigStatus ? (
                <button className="secondary-button compact" onClick={() => openApiKeyModal()} disabled={savingApiKey}>
                  <KeyRound size={14} />
                  {providerLabel}
                </button>
              ) : null}
              {window.mindcode?.readObsidianVault ? (
                <button className="secondary-button compact" onClick={chooseObsidianVault} disabled={readingObsidian}>
                  {readingObsidian ? <Loader2 size={14} className="spin" /> : <Upload size={14} />}
                  {readingObsidian ? "读取中" : "Obsidian"}
                </button>
              ) : (
                <span>先预览后入库</span>
              )}
            </div>
          </div>
          <label>
            <span>笔记或代码</span>
            <textarea
              value={noteInput}
              onChange={(event) => setNoteInput(event.target.value)}
              placeholder="粘贴一段学习笔记。离线时会使用 mock 提取器，仍然先生成草稿供你确认。"
            />
          </label>
          {obsidianVault ? (
            <section className="obsidian-sync" aria-label="Obsidian 同步">
              <div className="obsidian-sync-summary">
                <strong>{obsidianVault.vaultName}</strong>
                <span>
                  已选 {selectedObsidianCount} / {obsidianVault.notes.length}
                </span>
              </div>
              <div className="obsidian-note-list">
                {obsidianVault.notes.map((note) => (
                  <label key={note.path} className="obsidian-note-row">
                    <input
                      type="checkbox"
                      checked={note.selected}
                      onChange={(event) => toggleObsidianNote(note.path, event.target.checked)}
                    />
                    <span>
                      <strong>{note.path}</strong>
                      <small>
                        {note.content.length} 字符{note.truncated ? " · 已截断" : ""}
                      </small>
                    </span>
                  </label>
                ))}
              </div>
              <div className="obsidian-sync-actions">
                <button
                  className="secondary-button compact"
                  onClick={loadSelectedObsidianNotes}
                  disabled={!selectedObsidianCount || summarizingObsidian}
                >
                  {summarizingObsidian ? <Loader2 size={14} className="spin" /> : <Sparkles size={14} />}
                  {summarizingObsidian ? "总结中" : "总结所选笔记"}
                </button>
              </div>
            </section>
          ) : null}
          {extractError ? <p className="inline-warning">{extractError}</p> : null}
          <div className="action-row">
            <button className="primary-button ai-action" onClick={buildPreview} disabled={extracting || !noteInput.trim()}>
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
          <div className="manual-fields">
            <label>
              <span>概念名称</span>
              <input
                value={manualDraft.label}
                onChange={(event) => setManualDraft({ ...manualDraft, label: event.target.value })}
                placeholder="例如：Promise.all"
                autoComplete="off"
              />
            </label>

            <AnimatePresence initial={false}>
              {manualHasLabel && (
                <motion.label
                  key="desc"
                  initial={{ opacity: 0, y: -6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.18 }}
                >
                  <span>解释</span>
                  <textarea
                    value={manualDraft.desc}
                    onChange={(event) => setManualDraft({ ...manualDraft, desc: event.target.value })}
                    placeholder="一句话说明这个概念。"
                  />
                </motion.label>
              )}

              {manualHasDesc && (
                <motion.div
                  key="qa"
                  className="manual-qa"
                  initial={{ opacity: 0, y: -6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.18 }}
                >
                  <label>
                    <span>复习问题 <em>可选</em></span>
                    <textarea
                      value={manualDraft.question}
                      onChange={(event) => setManualDraft({ ...manualDraft, question: event.target.value })}
                      placeholder={`如何解释 ${manualDraft.label.trim()}？`}
                    />
                  </label>
                  <label>
                    <span>卡片答案 <em>可选</em></span>
                    <textarea
                      value={manualDraft.answer}
                      onChange={(event) => setManualDraft({ ...manualDraft, answer: event.target.value })}
                      placeholder="留空时使用解释。"
                    />
                  </label>
                </motion.div>
              )}

              {manualHasQuestion && (
                <motion.label
                  key="code"
                  initial={{ opacity: 0, y: -6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.18 }}
                >
                  <span>代码示例 <em>可选</em></span>
                  <textarea
                    className="code-input"
                    value={manualDraft.codeExample}
                    onChange={(event) => setManualDraft({ ...manualDraft, codeExample: event.target.value })}
                    placeholder="最短可运行示例"
                  />
                </motion.label>
              )}
            </AnimatePresence>

            <AnimatePresence>
              {manualHasLabel && (
                <motion.div
                  key="preview-card"
                  className="manual-card-preview"
                  initial={{ opacity: 0, scale: 0.96 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.96 }}
                  transition={{ duration: 0.2 }}
                >
                  <div className="manual-card-preview-label">卡片预览</div>
                  <button
                    className={`manual-flip-card ${cardFlipped ? "is-flipped" : ""}`}
                    onClick={() => setCardFlipped((v) => !v)}
                    aria-label={cardFlipped ? "显示正面" : "翻到背面"}
                  >
                    <span className="manual-flip-inner">
                      <span className="manual-flip-face manual-flip-front">
                        <strong>{previewQuestion || "复习问题将显示在这里"}</strong>
                        <small>{manualDraft.label.trim()}</small>
                        <i />
                      </span>
                      <span className="manual-flip-face manual-flip-back">
                        <strong>{manualDraft.label.trim()}</strong>
                        <span>{previewAnswer || "答案将显示在这里"}</span>
                        {manualDraft.codeExample.trim() ? <code>{manualDraft.codeExample.trim()}</code> : null}
                      </span>
                    </span>
                  </button>
                  <div className="manual-card-hint">{cardFlipped ? "正面" : "背面"} · 点击翻转</div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <div className="action-row">
            <button className="primary-button" onClick={submit} disabled={!manualDraft.label.trim()}>
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
            <div className="preview-stepper-nav">
              <span className="preview-step-count">
                {isOnEdgesStep ? "关系" : `${previewStep + 1} / ${preview.nodes.length}`}
              </span>
              <button
                className="icon-button"
                onClick={() => goToPreviewStep(previewStep - 1)}
                disabled={previewStep === 0}
                aria-label="上一个"
              >
                ‹
              </button>
              <button
                className="icon-button"
                onClick={() => goToPreviewStep(previewStep + 1)}
                disabled={isOnEdgesStep}
                aria-label="下一个"
              >
                ›
              </button>
            </div>
          </div>
          {preview.warning ? <p className="inline-warning">{preview.warning}</p> : null}

          <AnimatePresence mode="wait">
            {!isOnEdgesStep && currentPreviewNode ? (
              <motion.div
                key={`node-${previewStep}`}
                className={`preview-step-node ${currentPreviewNode.duplicate ? "is-duplicate" : ""}`}
                initial={{ opacity: 0, x: 18 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -18 }}
                transition={{ duration: 0.16 }}
              >
                {currentPreviewNode.duplicate ? (
                  <div className="preview-duplicate-banner">
                    <span>与已有概念重名</span>
                    <select
                      value={currentPreviewNode.mergeMode}
                      onChange={(event) =>
                        patchPreviewNode(currentPreviewNode.id, {
                          mergeMode: event.target.value,
                          selected: event.target.value === "new" ? currentPreviewNode.selected : false,
                        })
                      }
                    >
                      <option value="skip">跳过</option>
                      <option value="append-card">附加卡片到已有概念</option>
                      <option value="new">改名后新建</option>
                    </select>
                  </div>
                ) : null}
                <div className="preview-fields">
                  <label>
                    <span>名称</span>
                    <input value={currentPreviewNode.label} onChange={(event) => patchPreviewNode(currentPreviewNode.id, { label: event.target.value })} />
                  </label>
                  <label>
                    <span>分类</span>
                    <select value={currentPreviewNode.category} onChange={(event) => patchPreviewNode(currentPreviewNode.id, { category: event.target.value })}>
                      {Object.entries(categories).map(([key, item]) => (
                        <option key={key} value={key}>{item.label}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span>解释</span>
                    <textarea value={currentPreviewNode.desc} onChange={(event) => patchPreviewNode(currentPreviewNode.id, { desc: event.target.value })} />
                  </label>
                  <label>
                    <span>复习问题</span>
                    <textarea value={currentPreviewNode.question} onChange={(event) => patchPreviewNode(currentPreviewNode.id, { question: event.target.value })} placeholder="复习问题" />
                  </label>
                  <label>
                    <span>卡片答案</span>
                    <textarea value={currentPreviewNode.answer} onChange={(event) => patchPreviewNode(currentPreviewNode.id, { answer: event.target.value })} placeholder="卡片答案" />
                  </label>
                </div>
                <div className="preview-step-actions">
                  <button
                    className={`preview-decision-btn ${currentPreviewNode.selected || currentPreviewNode.mergeMode === "append-card" ? "is-accept" : ""}`}
                    onClick={() => {
                      patchPreviewNode(currentPreviewNode.id, { selected: true });
                      goToPreviewStep(previewStep + 1);
                    }}
                  >
                    <Check size={15} />
                    接受
                  </button>
                  <button
                    className={`preview-decision-btn ${!currentPreviewNode.selected && currentPreviewNode.mergeMode !== "append-card" ? "is-skip" : ""}`}
                    onClick={() => {
                      patchPreviewNode(currentPreviewNode.id, { selected: false, mergeMode: "skip" });
                      goToPreviewStep(previewStep + 1);
                    }}
                  >
                    <X size={15} />
                    跳过
                  </button>
                </div>
              </motion.div>
            ) : (
              <motion.div
                key="edges"
                className="preview-edges-step"
                initial={{ opacity: 0, x: 18 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -18 }}
                transition={{ duration: 0.16 }}
              >
                <strong className="preview-step-label">关系 ({preview.edges.length})</strong>
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
                            <option key={`from-${edge.id}-${node.id}-${index}`} value={node.id}>{node.label}</option>
                          ))}
                        </select>
                        <input value={edge.label} onChange={(event) => patchPreviewEdge(edge.id, { label: event.target.value })} />
                        <select value={edge.to} onChange={(event) => patchPreviewEdge(edge.id, { to: event.target.value })}>
                          {previewEndpointOptions.map((node, index) => (
                            <option key={`to-${edge.id}-${node.id}-${index}`} value={node.id}>{node.label}</option>
                          ))}
                        </select>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="relation-empty">没有提取到关系，入库后可在节点详情里手动连接。</p>
                )}
                <div className="preview-actions">
                  <button className="secondary-button" onClick={() => { setPreview(null); setPreviewStep(0); }}>
                    丢弃草稿
                  </button>
                  <button className="primary-button" onClick={() => { acceptPreview(); setPreviewStep(0); }} disabled={!previewWillWrite}>
                    <Save size={16} />
                    确认写入
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      ) : null}
      <ApiKeyModal
        open={apiKeyModalOpen}
        status={aiConfigStatus}
        draft={apiKeyDraft}
        message={apiKeyMessage}
        saving={savingApiKey}
        onDraftChange={setApiKeyDraft}
        onSave={saveApiKey}
        onClear={clearApiKey}
        onClose={() => setApiKeyModalOpen(false)}
      />
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
      <main className="main-panel">
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
            onOpenNode={openNodeInGraph}
            onDeleteNode={deleteNode}
          />
        ) : null}
        {view === "review" ? <ReviewView dueCards={dueCards} onRate={handleRate} /> : null}
        {view === "add" ? (
          <AddView data={data} onAdd={handleAdd} onAcceptExtraction={acceptExtraction} onToast={showToast} />
        ) : null}
      </main>

      <NavDock view={view} setView={setView} reviewCount={todayCount(data.nodes)} />
      <Toast toast={toast} onClear={() => setToast(null)} />
    </div>
  );
}
