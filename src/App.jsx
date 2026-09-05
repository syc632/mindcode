import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useInView } from "motion/react";
import CircularGallery from "./CircularGallery.jsx";
import { MarkdownText } from "./components/MarkdownText.jsx";
import { MindLogo } from "./components/MindLogo.jsx";
import { NavDock } from "./components/NavDock.jsx";
import {
  Check,
  ChevronDown,
  CirclePlus,
  Download,
  Edit3,
  FolderOpen,
  KeyRound,
  Loader2,
  Plus,
  Save,
  Search,
  Sparkles,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { categories, seedData } from "./shared/seedData.js";
import { extractWithMock } from "./shared/mockExtractor.js";
import { daysUntil, isDue, sm2 } from "./shared/sm2.js";
import { normalizeCard, normalizeEdge, normalizeMindCodeData, normalizeNode } from "./shared/schema.js";
import { mapTitleFromData } from "./shared/mindMapMarkdown.js";
import { isReviewAnswerMatch } from "./shared/reviewAnswer.js";
import { sourcesForAcceptedNode } from "./shared/extractionSources.js";
import {
  arrangeRowsByHierarchy,
  curveDamping,
  curveSpring,
  descendantIdsForNode,
  edgePoints,
  graphCenter,
  graphLevelForNode,
  graphNodePadding,
  graphViewport,
  hierarchyEdgesForNodes,
  mindMapHierarchyPositions,
  mindMapVisibleNodes,
  naturalCurveTarget,
  nodeHeightForLevel,
  nodeWidthForLabel,
  parentIdForNode,
  springForCurve,
} from "./utils/graph.js";
import {
  cardsForNode,
  nodeIsDue,
  nodeNextReview,
  nodeSearchText,
  reviewCardKey,
  reviewQueue,
  todayCount,
} from "./utils/review.js";

const storageKey = "mindcode-browser-data";
const currentMapStorageKey = "mindcode-current-map-id";
const browserMapStorageKey = "mindcode-browser-map";
const categoryOptions = Object.entries(categories).map(([value, item]) => ({ value, label: item.label }));
const extractionProgressStages = [
  { startMs: 0, endMs: 3000, message: "Reading document content...", from: 8, to: 22 },
  { startMs: 3000, endMs: 10000, message: "AI is identifying concepts...", from: 22, to: 45 },
  { startMs: 10000, endMs: 20000, message: "Organizing concept relationships...", from: 45, to: 65 },
  { startMs: 20000, endMs: 40000, message: "Preparing the mind map draft...", from: 65, to: 86 },
  { startMs: 40000, endMs: 90000, message: "Still working. Larger documents can take over a minute...", from: 86, to: 95 },
  { startMs: 90000, endMs: Infinity, message: "Still processing. Keep this window open while AI finishes...", from: 95, to: 98 },
];

function extractionProgressForElapsed(elapsedMs) {
  const stage = extractionProgressStages.find((item) => elapsedMs >= item.startMs && elapsedMs < item.endMs) ?? extractionProgressStages.at(-1);
  const stageDuration = Number.isFinite(stage.endMs) ? stage.endMs - stage.startMs : 20000;
  const elapsedInStage = Math.min(Math.max(elapsedMs - stage.startMs, 0), stageDuration);
  const percent = Math.round(stage.from + ((stage.to - stage.from) * elapsedInStage) / stageDuration);
  return { message: stage.message, percent };
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

function readBrowserMap() {
  try {
    const raw = localStorage.getItem(browserMapStorageKey);
    if (raw) {
      const parsed = JSON.parse(raw);
      const data = normalizeMindCodeData(parsed.data);
      return {
        map: {
          id: parsed.map?.id || "browser-preview.mindcode.md",
          title: parsed.map?.title || mapTitleFromData(data),
        },
        data,
      };
    }
  } catch {
    // Fall through to the legacy browser cache.
  }

  const data = readLocalCache() || normalizeMindCodeData(seedData());
  return {
    map: { id: "browser-preview.mindcode.md", title: mapTitleFromData(data) },
    data,
  };
}

function writeBrowserMap(map, data) {
  const normalized = normalizeMindCodeData(data);
  writeLocalCache(normalized);
  try {
    localStorage.setItem(browserMapStorageKey, JSON.stringify({ map, data: normalized }));
    localStorage.setItem(currentMapStorageKey, map?.id || "");
  } catch {
    // Browser preview can continue without persistent localStorage.
  }
}

async function loadInitialMindMap() {
  if (window.mindcode?.listMaps && window.mindcode?.loadMap) {
    const listed = await window.mindcode.listMaps();
    const maps = listed.maps || [];
    const preferredId = localStorage.getItem(currentMapStorageKey);
    const target = maps.find((map) => map.id === preferredId) || maps[0];
    const loaded = await window.mindcode.loadMap({ id: target?.id });
    const map = loaded.map || target || { id: "MindCode.mindcode.md", title: mapTitleFromData(loaded.data) };
    localStorage.setItem(currentMapStorageKey, map.id);
    return { maps, map, data: loaded.data, warning: loaded.warning };
  }

  const browserMap = readBrowserMap();
  return { maps: [browserMap.map], map: browserMap.map, data: browserMap.data, source: "localStorage" };
}

async function saveCurrentMindMap(map, data) {
  const normalized = normalizeMindCodeData(data);
  const title = mapTitleFromData(normalized, map?.title || "MindCode Map");
  writeBrowserMap({ ...map, title }, normalized);

  if (window.mindcode?.saveMap) {
    return window.mindcode.saveMap({ id: map?.id, title, data: normalized });
  }

  return { ok: true, map: { ...map, title }, data: normalized };
}

async function createMindMapFile(title, data) {
  const normalized = normalizeMindCodeData(data);
  if (window.mindcode?.createMap) {
    return window.mindcode.createMap({ title, data: normalized });
  }

  const map = { id: `${Date.now()}-${title || "MindCode"}.mindcode.md`, title: title || mapTitleFromData(normalized) };
  writeBrowserMap(map, normalized);
  return { ok: true, map, data: normalized };
}

async function exportMindMapFile(map, data) {
  const normalized = normalizeMindCodeData(data);
  const title = mapTitleFromData(normalized, map?.title || "MindCode Map");
  if (window.mindcode?.exportMap) {
    return window.mindcode.exportMap({ id: map?.id, title, data: normalized });
  }

  writeBrowserMap({ ...map, title }, normalized);
  return { ok: true, browserOnly: true };
}

async function importMindMapFile() {
  if (window.mindcode?.importMap) return window.mindcode.importMap();
  return { canceled: true, browserOnly: true };
}

async function openMindMapFile() {
  if (window.mindcode?.openMapFile) return window.mindcode.openMapFile();
  return { canceled: true, browserOnly: true };
}

async function extractConcepts(text, existingLabels, options = {}) {
  if (window.mindcode?.extractConcepts) {
    return window.mindcode.extractConcepts({ text, existingLabels, ...options });
  }

  if (options.requireAi) throw new Error("DashScope API key required for local document scan.");
  return extractWithMock({ text, existingLabels });
}

function formatScannedDocuments(documents = []) {
  return documents
    .map((document) => [`# ${document.relativePath || document.name || document.path}`, document.text || ""].join("\n"))
    .join("\n\n---\n\n")
    .trim();
}

function displayNameForDocument(document) {
  return document?.name || document?.relativePath?.split("/").pop() || document?.path || "Untitled document";
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

function FilterDropdown({ label, value, options, onChange, onDeleteOption, disabled = false }) {
  const [open, setOpen] = useState(false);
  const [hoveredOptionIndex, setHoveredOptionIndex] = useState(null);
  const [contextOption, setContextOption] = useState(null);
  const ref = useRef(null);
  const hoverCloseTimerRef = useRef(null);
  const selectedOption = options.find((option) => option.value === value) || options[0];
  const selectedIndex = Math.max(0, options.findIndex((option) => option.value === selectedOption?.value));
  const activeOptionIndex = hoveredOptionIndex ?? selectedIndex;
  const activeOptionOffset = `${activeOptionIndex * 54}px`;

  const clearHoverCloseTimer = useCallback(() => {
    if (!hoverCloseTimerRef.current) return;
    window.clearTimeout(hoverCloseTimerRef.current);
    hoverCloseTimerRef.current = null;
  }, []);

  useEffect(() => {
    if (!open) return undefined;

    const closeOnOutside = (event) => {
      if (!ref.current?.contains(event.target)) {
        setOpen(false);
        setHoveredOptionIndex(null);
        setContextOption(null);
      }
    };
    const closeOnEscape = (event) => {
      if (event.key === "Escape") {
        setOpen(false);
        setHoveredOptionIndex(null);
        setContextOption(null);
      }
    };

    document.addEventListener("pointerdown", closeOnOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  useEffect(() => () => clearHoverCloseTimer(), [clearHoverCloseTimer]);

  function openOnHover() {
    if (disabled) return;
    clearHoverCloseTimer();
    setOpen(true);
  }

  function closeAfterHover() {
    if (contextOption) return;
    clearHoverCloseTimer();
    hoverCloseTimerRef.current = window.setTimeout(() => {
      setOpen(false);
      setHoveredOptionIndex(null);
      setContextOption(null);
      hoverCloseTimerRef.current = null;
    }, 160);
  }

  function choose(nextValue) {
    clearHoverCloseTimer();
    onChange(nextValue);
    setOpen(false);
    setHoveredOptionIndex(null);
    setContextOption(null);
  }

  return (
    <div
      ref={ref}
      className={`filter-dropdown ${open ? "is-open" : ""}`}
      onMouseEnter={openOnHover}
      onMouseLeave={closeAfterHover}
    >
      <button
        type="button"
        className="filter-trigger"
        onClick={() => {
          clearHoverCloseTimer();
          setOpen((current) => !current);
          setHoveredOptionIndex(null);
          setContextOption(null);
        }}
        disabled={disabled}
        aria-haspopup="true"
        aria-expanded={open}
      >
        <span>
          {label ? <em>{label}: </em> : null}
          {selectedOption?.label || ""}
        </span>
        <ChevronDown size={15} />
      </button>
      <AnimatePresence>
        {open ? (
          <motion.div
            className={`filter-menu ${hoveredOptionIndex !== null ? "is-hovering" : ""}`}
            role="radiogroup"
            aria-label={label ? `${label} options` : "Filter options"}
            style={{
              "--active-option-offset": activeOptionOffset,
              "--filter-option-count": options.length,
            }}
            initial={{ opacity: 0, y: -4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98 }}
            transition={{ duration: 0.12 }}
            onMouseLeave={() => setHoveredOptionIndex(null)}
          >
            {options.map((option, index) => (
              <button
                key={option.value}
                type="button"
                className={[
                  "filter-option",
                  option.value === value ? "is-selected" : "",
                  index === activeOptionIndex ? "is-indicator-active" : "",
                ].filter(Boolean).join(" ")}
                onClick={() => choose(option.value)}
                onMouseEnter={() => setHoveredOptionIndex(index)}
                onFocus={() => setHoveredOptionIndex(index)}
                onContextMenu={
                  onDeleteOption
                    ? (event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        setContextOption({ ...option, x: event.clientX, y: event.clientY });
                      }
                    : undefined
                }
                role="radio"
                aria-checked={option.value === value}
              >
                <span>{option.label}</span>
                {option.value === value ? <Check size={14} /> : null}
              </button>
            ))}
          </motion.div>
        ) : null}
      </AnimatePresence>
      {contextOption ? (
        <div
          className="option-context-menu"
          role="menu"
          style={{ "--context-menu-x": `${contextOption.x}px`, "--context-menu-y": `${contextOption.y}px` }}
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              onDeleteOption(contextOption.value);
              setContextOption(null);
              setOpen(false);
            }}
          >
            <Trash2 size={14} />
            Delete Map
          </button>
        </div>
      ) : null}
    </div>
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
      <section className="settings-modal" role="dialog" aria-modal="true" aria-label="DashScope API Key Settings">
        <div className="modal-header">
          <div>
            <h3>DashScope API Key</h3>
            <p>{status?.hasApiKey ? "A local API key is saved." : "AI document scanning and concept extraction require a DashScope API key."}</p>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>
        {message ? <p className="inline-warning">{message}</p> : null}
        <label>
          <span>API Key</span>
          <input
            value={draft}
            onChange={(event) => onDraftChange(event.target.value)}
            placeholder={status?.hasApiKey ? "Enter a new key to replace the saved one" : "sk-..."}
            type="password"
            autoFocus
          />
        </label>
        <div className="modal-actions">
          <button className="secondary-button" onClick={onClear} disabled={saving || !status?.hasApiKey}>
            <Trash2 size={16} />
            Clear
          </button>
          <button className="primary-button" onClick={onSave} disabled={saving || !draft.trim()}>
            {saving ? <Loader2 size={16} className="spin" /> : <Save size={16} />}
            {saving ? "Saving" : "Save"}
          </button>
        </div>
      </section>
    </div>
  );
}

function AppBrandHeader({ view, currentMap, data }) {
  const viewLabels = {
    graph: currentMap?.title ? `Map: ${currentMap.title}` : "Map",
    library: "Library",
    review: "Review",
    add: "Add Concept",
  };
  const dueCount = todayCount(data.nodes);

  return (
    <header className="app-header" aria-label="MindCode">
      <div className="brand">
        <div className="brand-mark" aria-hidden="true">
          <MindLogo size={64} surface="var(--surface)" />
        </div>
        <div className="brand-copy">
          <h1>MindCode</h1>
          <p>{viewLabels[view] || "Knowledge Graph"}</p>
        </div>
      </div>
      <div className="header-controls app-header-stats" aria-label="Map stats">
        <span>{data.nodes.length} nodes</span>
        <span>{dueCount} due</span>
      </div>
    </header>
  );
}

function GraphCanvas({ nodes, edges, selectedId, onSelect, onToggleNode, onOpenDetail }) {
  const svgRef = useRef(null);
  const positionsRef = useRef({});
  const edgesRef = useRef(edges);
  const curveSpringsRef = useRef({});
  const curveAnimationRef = useRef(null);
  const nodeClickTimerRef = useRef(null);
  const pointerStartRef = useRef(null);
  const panRef = useRef(null);
  const [positions, setPositions] = useState(() => mindMapHierarchyPositions(nodes));
  const [viewport, setViewport] = useState(graphViewport);
  const [, setCurveRevision] = useState(0);
  const [tooltip, setTooltip] = useState(null);
  const [isPanning, setIsPanning] = useState(false);
  const [hoveredNodeId, setHoveredNodeId] = useState(null);
  const [edgeAnimationKey, setEdgeAnimationKey] = useState(0);

  useEffect(() => {
    setPositions(mindMapHierarchyPositions(nodes));
  }, [nodes]);

  useEffect(() => {
    setEdgeAnimationKey((current) => (current + 1) % 1000);
  }, [nodes, edges]);

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

      if (moving) {
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

  useEffect(
    () => () => {
      if (curveAnimationRef.current) window.cancelAnimationFrame(curveAnimationRef.current);
      if (nodeClickTimerRef.current) window.clearTimeout(nodeClickTimerRef.current);
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

  const handlePointerDown = (event) => {
    setTooltip(null);
    pointerStartRef.current = { x: event.clientX, y: event.clientY, moved: false };
    event.stopPropagation();
  };

  const handleCanvasPointerDown = (event) => {
    if (event.button !== 0 || event.target.closest?.(".graph-node")) return;
    event.preventDefault();
    setTooltip(null);
    onSelect(null);
    panRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      viewport,
    };
    setIsPanning(true);
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const handlePointerMove = (event) => {
    if (panRef.current) {
      const svg = svgRef.current;
      const start = panRef.current;
      const scaleX = start.viewport.width / Math.max(svg?.clientWidth || 1, 1);
      const scaleY = start.viewport.height / Math.max(svg?.clientHeight || 1, 1);
      setViewport({
        ...start.viewport,
        x: start.viewport.x - (event.clientX - start.startX) * scaleX,
        y: start.viewport.y - (event.clientY - start.startY) * scaleY,
      });
      return;
    }

    const pointerStart = pointerStartRef.current;
    if (pointerStart && Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y) > 4) {
      pointerStart.moved = true;
    }
  };

  const stopPan = (event) => {
    if (!panRef.current) return;
    event.currentTarget.releasePointerCapture?.(panRef.current.pointerId);
    panRef.current = null;
    setIsPanning(false);
  };

  const zoomAt = useCallback((factor, anchor) => {
    setViewport((previous) => {
      const width = Math.max(360, Math.min(2800, previous.width * factor));
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

  const handleWheel = (event) => {
    event.preventDefault();
    zoomAt(event.deltaY > 0 ? 1.12 : 0.89, getPoint(event));
  };

  const handleNodeClick = (event, node) => {
    if (event.detail !== 1 || pointerStartRef.current?.moved) return;
    event.preventDefault();
    event.stopPropagation();
    if (nodeClickTimerRef.current) window.clearTimeout(nodeClickTimerRef.current);
    nodeClickTimerRef.current = window.setTimeout(() => {
      onSelect(node.id);
      if (node.graphVirtual) return;
      if (node.graphHasChildren && graphLevelForNode(node) >= 1) onToggleNode?.(node.id);
    }, 170);
  };

  const handleNodeDoubleClick = (event, node) => {
    event.preventDefault();
    event.stopPropagation();
    if (nodeClickTimerRef.current) window.clearTimeout(nodeClickTimerRef.current);
    if (!node.graphVirtual) onOpenDetail?.(node.id);
  };

  const nodeIds = new Set(nodes.map((node) => node.id));
  const nodesById = new Map(nodes.map((node) => [node.id, node]));

  return (
    <div className="graph-stage">
      <svg
        ref={svgRef}
        className={`graph-canvas is-fixed ${isPanning ? "is-panning" : ""}`}
        viewBox={`${viewport.x} ${viewport.y} ${viewport.width} ${viewport.height}`}
        onPointerDown={handleCanvasPointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={stopPan}
        onPointerCancel={stopPan}
        onPointerLeave={stopPan}
        onWheel={handleWheel}
      >
        <defs>
          <pattern id="dot-grid" x="0" y="0" width="22" height="22" patternUnits="userSpaceOnUse">
            <circle cx="0" cy="0" r="0.7" fill="rgba(0,0,0,0.05)" />
          </pattern>
        </defs>

        <rect x="-2000" y="-2000" width="6000" height="6000" fill="url(#dot-grid)" />

        {edges
          .filter((edge) => nodeIds.has(edge.from) && nodeIds.has(edge.to))
          .map((edge) => {
            const from = positions[edge.from] || graphCenter;
            const to = positions[edge.to] || graphCenter;
            const { start, end } = edgePoints(from, to, nodesById.get(edge.from), nodesById.get(edge.to));
            const control = curveSpringsRef.current[edge.id] || naturalCurveTarget(from, to);
            const isHoveredEdge = hoveredNodeId && (edge.from === hoveredNodeId || edge.to === hoveredNodeId);
            const isSelectedEdge = selectedId && (edge.from === selectedId || edge.to === selectedId);
            const edgePath = `M ${start.x} ${start.y} C ${control.c1x} ${control.c1y} ${control.c2x} ${control.c2y} ${end.x} ${end.y}`;
            return (
              <g
                key={`${edge.id}-${edgeAnimationKey}-${isHoveredEdge ? hoveredNodeId : "idle"}`}
                className={[
                  "edge",
                  `edge-level-${Math.min(Number(edge.level || 1), 3)}`,
                  isHoveredEdge ? "is-hovered" : "",
                  isSelectedEdge ? "is-selected-edge" : "",
                ].filter(Boolean).join(" ")}
              >
                <path className="edge-path" d={edgePath} />
                <path className="edge-draw" d={edgePath} pathLength="1" />
              </g>
            );
          })}

        <AnimatePresence initial={false}>
          {nodes.map((node, index) => {
            const point = positions[node.id] || graphCenter;
            const parentId = parentIdForNode(node, nodeIds);
            const parentPoint = parentId ? positions[parentId] || point : point;
            const level = graphLevelForNode(node);
            const category = categoryFor(node);
            const selected = selectedId === node.id;
            const hovered = hoveredNodeId === node.id;
            const due = !node.graphVirtual && nodeIsDue(node);
            const width = nodeWidthForLabel(node.label, level);
            const height = nodeHeightForLevel(level);
            const objectWidth = width + graphNodePadding * 2;
            const objectHeight = height + graphNodePadding * 2;
            const transition = { type: "spring", stiffness: 260, damping: 32, mass: 0.86 };
            return (
              <motion.g
                key={node.id}
                className={[
                  "graph-node",
                  `graph-node-level-${Math.min(level, 3)}`,
                  selected ? "is-selected" : "",
                  hovered ? "is-hovered" : "",
                  node.graphHasChildren ? "has-children" : "",
                  node.graphExpanded ? "is-expanded" : "",
                ].filter(Boolean).join(" ")}
                initial={{ x: parentPoint.x, y: parentPoint.y, opacity: 0, scale: 0.8 }}
                animate={{ x: point.x, y: point.y, opacity: level > 2 ? 0.76 : 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.82, transition: { duration: 0.18, ease: [0.23, 1, 0.32, 1] } }}
                transition={transition}
                onPointerDown={handlePointerDown}
                onClick={(event) => handleNodeClick(event, node)}
                onDoubleClick={(event) => handleNodeDoubleClick(event, node)}
                onMouseEnter={(event) => {
                  setHoveredNodeId(node.id);
                  setTooltip({ desc: node.desc, x: event.clientX, y: event.clientY });
                }}
                onMouseLeave={() => {
                  setHoveredNodeId(null);
                  setTooltip(null);
                }}
                onMouseMove={(event) => setTooltip((current) => current ? { ...current, x: event.clientX, y: event.clientY } : null)}
              >
                <foreignObject
                  className="graph-node-fo"
                  x={-objectWidth / 2}
                  y={-objectHeight / 2}
                  width={objectWidth}
                  height={objectHeight}
                >
                  <div
                    className="graph-node-card"
                    xmlns="http://www.w3.org/1999/xhtml"
                    style={{
                      "--node-width": `${width}px`,
                      "--node-height": `${height}px`,
                      "--node-accent": category.color,
                      "--node-pop-delay": `${Math.min(index * 22, 220)}ms`,
                    }}
                  >
                    <span>{node.label}</span>
                    {due ? <i aria-hidden="true" /> : null}
                  </div>
                </foreignObject>
              </motion.g>
            );
          })}
        </AnimatePresence>
      </svg>

      {tooltip && (
        <div className="node-tooltip" style={{ left: tooltip.x + 14, top: tooltip.y - 10 }}>
          {tooltip.desc}
        </div>
      )}
    </div>
  );
}

function NodeDetail({ node, onClose, onUpdate, onDelete }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({
    label: node.label,
    desc: node.desc,
    cards: cardsForNode(node).map((card) => ({ ...card })),
  });

  useEffect(() => {
    setEditing(false);
    setDraft({
      label: node.label,
      desc: node.desc,
      cards: cardsForNode(node).map((card) => ({ ...card })),
    });
  }, [node]);

  function saveEdit() {
    const label = draft.label.trim();
    if (!label) return;
    const desc = draft.desc.trim() || "No explanation has been added.";
    onUpdate(node.id, {
      label,
      category: node.category,
      desc,
      cards: draft.cards.map((card, index) =>
        normalizeCard(
          {
            ...card,
            question: card.question.trim() || `How would you explain ${label}?`,
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
            question: `Ask another question about ${current.label || node.label}`,
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

  const category = categoryFor(node);

  return (
    <aside className={`node-detail ${editing ? "is-editing" : ""}`}>
      <button className="icon-button close-button" onClick={onClose} aria-label="Close details">
        <X size={16} />
      </button>

      {editing ? (
        <div className="node-form review-card-editor-panel">
          <div className="review-card-editor-scroll">
            <div className="review-card-meta-fields">
              <label>
                <span>Name</span>
                <input value={draft.label} onChange={(event) => setDraft({ ...draft, label: event.target.value })} />
              </label>
              <label>
                <span>Explanation</span>
                <textarea value={draft.desc} onChange={(event) => setDraft({ ...draft, desc: event.target.value })} />
              </label>
            </div>
            <section className="card-editor">
              <div className="review-card-editor-header">
                <h3>Review Cards</h3>
                <button className="review-card-add-button" onClick={addDraftCard}>
                  <Plus size={14} />
                  Add Card
                </button>
              </div>
              <div className="review-card-editor-list">
                {draft.cards.map((card, index) => (
                  <article key={card.id} className="card-edit-item">
                    <div className="card-edit-title">
                      <strong>Card {index + 1}</strong>
                      <button
                        className="icon-button review-card-delete-button"
                        onClick={() => removeDraftCard(card.id)}
                        disabled={draft.cards.length === 1}
                        aria-label={`Delete card ${index + 1}`}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                    <label>
                      <span>Review Question</span>
                      <textarea value={card.question} onChange={(event) => updateDraftCard(card.id, { question: event.target.value })} />
                    </label>
                    <label>
                      <span>Card Answer</span>
                      <textarea value={card.answer} onChange={(event) => updateDraftCard(card.id, { answer: event.target.value })} />
                    </label>
                    <label>
                      <span>Code Example</span>
                      <textarea
                        className="code-input"
                        value={card.codeExample}
                        onChange={(event) => updateDraftCard(card.id, { codeExample: event.target.value })}
                        placeholder="Optional, shortest runnable example"
                      />
                    </label>
                  </article>
                ))}
              </div>
            </section>
          </div>
          <div className="node-actions review-card-editor-actions">
            <button className="review-card-cancel-button" onClick={() => setEditing(false)}>
              Cancel
            </button>
            <button className="review-card-save-button" onClick={saveEdit} disabled={!draft.label.trim()}>
              <Save size={15} />
              Save
            </button>
          </div>
        </div>
      ) : (
        <>
          <header className="inspector-header">
            <div className="node-detail-tags">
              <span className="category-badge" style={{ color: category.color, background: category.light }}>
                {category.label}
              </span>
              <span className={nodeIsDue(node) ? "detail-review-state is-due" : "detail-review-state is-planned"}>
                {nodeIsDue(node) ? "Due" : `Next ${daysUntil(nodeNextReview(node))}`}
              </span>
            </div>
            <h3>{node.label}</h3>
            <p>{node.desc}</p>
            <div className="node-actions inspector-actions">
              <button className="inspector-action" onClick={() => setEditing(true)}>
                <Edit3 size={15} />
                Edit
              </button>
              <button className="inspector-action is-danger" onClick={() => onDelete(node.id)}>
                <Trash2 size={15} />
                Delete
              </button>
            </div>
          </header>

          <div className="node-meta inspector-metrics">
            <Stat label="Ease" value={cardsForNode(node)[0].ef.toFixed(2)} />
            <Stat label="Cards" value={cardsForNode(node).length} />
            <Stat label="Due" value={cardsForNode(node).filter((card) => isDue(card)).length} />
          </div>

          <section className="inspector-section">
            <h4 className="inspector-section-title">Review</h4>
            <div className="card-fields">
              {cardsForNode(node).map((card, index) => (
                <div key={card.id}>
                  <span>Card {index + 1}</span>
                  <strong>{card.question}</strong>
                  <MarkdownText text={card.answer} />
                  {card.codeExample ? <pre>{card.codeExample}</pre> : null}
                  <small>
                    {isDue(card) ? "Due today" : daysUntil(card.nextReview)} · reviewed {card.repetitions} times
                  </small>
                </div>
              ))}
            </div>
          </section>

          {node.sources.length ? (
            <section className="source-block inspector-section">
              <h4 className="inspector-section-title">Sources</h4>
              {node.sources.slice(-2).map((source) => (
                <p key={`${source.createdAt}-${source.text.slice(0, 12)}`}>{source.text}</p>
              ))}
            </section>
          ) : null}
        </>
      )}
    </aside>
  );
}

function GraphView({
  data,
  maps,
  currentMap,
  selectedId,
  onSelect,
  onLoadMap,
  onCreateMap,
  onDeleteMap,
  fileActionsAvailable,
  onOpenMapFile,
  onImportMap,
  onExportMap,
  onUpdateNode,
  onDeleteNode,
}) {
  const [detailMode, setDetailMode] = useState("preview");
  const [expandedIds, setExpandedIds] = useState(() => new Set());
  const [creatingMap, setCreatingMap] = useState(false);
  const [newMapTitle, setNewMapTitle] = useState("");
  const [submittingMap, setSubmittingMap] = useState(false);
  const [fileAction, setFileAction] = useState("");

  useEffect(() => {
    setExpandedIds((current) => {
      const validIds = new Set(data.nodes.map((node) => node.id));
      const next = new Set([...current].filter((id) => validIds.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [data.nodes]);

  const filtered = useMemo(() => {
    const nodes = mindMapVisibleNodes(data.nodes, expandedIds);
    const edges = hierarchyEdgesForNodes(nodes);
    return { nodes, edges };
  }, [data.nodes, expandedIds]);

  const selectedNode = filtered.nodes.find((node) => node.id === selectedId && !node.graphVirtual);

  function selectPreview(nodeId) {
    setDetailMode("preview");
    onSelect(nodeId);
  }

  function openFullDetail(nodeId) {
    if (!nodeId) return;
    onSelect(nodeId);
    setDetailMode("full");
  }

  function closeDetail() {
    setDetailMode("preview");
    onSelect(null);
  }

  function toggleNode(nodeId) {
    setExpandedIds((current) => {
      const next = new Set(current);
      if (next.has(nodeId)) {
        next.delete(nodeId);
        descendantIdsForNode(data.nodes, nodeId).forEach((id) => next.delete(id));
      } else {
        next.add(nodeId);
      }
      return next;
    });
  }

  async function submitNewMap(event) {
    event.preventDefault();
    const title = newMapTitle.trim();
    if (!title) return;
    setSubmittingMap(true);
    const created = await onCreateMap(title);
    setSubmittingMap(false);
    if (!created) return;
    setNewMapTitle("");
    setCreatingMap(false);
  }

  async function runFileAction(action, handler) {
    if (!handler || fileAction) return;
    setFileAction(action);
    try {
      await handler();
    } finally {
      setFileAction("");
    }
  }

  return (
    <section className="surface graph-view">
      <div className="map-switcher" aria-label="Current mind map">
        <FilterDropdown
          label="Map"
          value={currentMap?.id || ""}
          options={maps.map((map) => ({ value: map.id, label: map.title }))}
          onChange={onLoadMap}
          onDeleteOption={onDeleteMap}
          disabled={!maps.length}
        />
        {creatingMap ? (
          <form className="map-create-form" onSubmit={submitNewMap}>
            <input
              value={newMapTitle}
              onChange={(event) => setNewMapTitle(event.target.value)}
              placeholder="New map name"
              autoFocus
            />
            <button className="inspector-action" type="submit" disabled={!newMapTitle.trim() || submittingMap}>
              {submittingMap ? <Loader2 size={14} className="spin" /> : <Save size={14} />}
              Save
            </button>
            <button
              className="icon-button"
              type="button"
              onClick={() => {
                setCreatingMap(false);
                setNewMapTitle("");
              }}
              aria-label="Cancel new map"
            >
              <X size={14} />
            </button>
          </form>
        ) : (
          <button className="inspector-action" onClick={() => setCreatingMap(true)}>
            <Plus size={14} />
            New
          </button>
        )}
        {fileActionsAvailable ? (
          <div className="map-file-actions" aria-label="Map file actions">
            <button
              className="icon-button map-file-button"
              type="button"
              onClick={() => runFileAction("open", onOpenMapFile)}
              disabled={Boolean(fileAction)}
              aria-label="Open .mindcode.md"
              title="Open .mindcode.md"
            >
              {fileAction === "open" ? <Loader2 size={15} className="spin" /> : <FolderOpen size={15} />}
            </button>
            <button
              className="icon-button map-file-button"
              type="button"
              onClick={() => runFileAction("import", onImportMap)}
              disabled={Boolean(fileAction)}
              aria-label="Import .mindcode.md"
              title="Import .mindcode.md"
            >
              {fileAction === "import" ? <Loader2 size={15} className="spin" /> : <Upload size={15} />}
            </button>
            <button
              className="icon-button map-file-button"
              type="button"
              onClick={() => runFileAction("export", onExportMap)}
              disabled={Boolean(fileAction)}
              aria-label="Export .mindcode.md"
              title="Export .mindcode.md"
            >
              {fileAction === "export" ? <Loader2 size={15} className="spin" /> : <Download size={15} />}
            </button>
          </div>
        ) : null}
      </div>

      <GraphCanvas
        key={currentMap?.id || "current-map"}
        nodes={filtered.nodes}
        edges={filtered.edges}
        selectedId={selectedId}
        onSelect={selectPreview}
        onToggleNode={toggleNode}
        onOpenDetail={openFullDetail}
      />

      {!filtered.nodes.length ? (
        <div className="graph-empty">
          <Search size={34} />
          <h3>No concepts yet</h3>
          <p>Add a concept and it will appear here.</p>
        </div>
      ) : null}

      {selectedNode && detailMode === "full" ? (
        <NodeDetail
          node={selectedNode}
          onClose={closeDetail}
          onUpdate={onUpdateNode}
          onDelete={onDeleteNode}
        />
      ) : null}
    </section>
  );
}

function LibraryAnimatedRow({ index, node, dueCount, nextReview, hierarchyDepth = 0, isFocused, onOpenNode, onDeleteNode }) {
  const ref = useRef(null);
  const inView = useInView(ref, { amount: 0.15, triggerOnce: false });
  const categoryMeta = categoryFor(node);

  return (
    <motion.article
      ref={ref}
      className={`library-row ${isFocused ? "is-focused" : ""}`}
      style={{ "--hierarchy-depth": Math.min(hierarchyDepth, 2) }}
      aria-level={hierarchyDepth + 1}
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
        {dueCount ? `${dueCount} due` : daysUntil(nextReview)}
      </span>
      <div className="library-actions">
        <button className="icon-button relation-delete" onClick={() => onDeleteNode(node.id)} aria-label={`Delete ${node.label}`}>
          <Trash2 size={14} />
        </button>
      </div>
    </motion.article>
  );
}

function LibraryView({ data, onOpenNode, onDeleteNode }) {
  const [query, setQuery] = useState("");
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const tableRef = useRef(null);

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();

    const flatRows = data.nodes
      .filter((node) => {
        const matchesQuery = !needle || nodeSearchText(node).includes(needle);
        return matchesQuery;
      })
      .map((node) => ({
        node,
        dueCount: cardsForNode(node).filter((card) => isDue(card)).length,
        cardCount: cardsForNode(node).length,
        nextReview: nodeNextReview(node),
      }))
      .sort((left, right) => right.node.updatedAt - left.node.updatedAt);

    return arrangeRowsByHierarchy(flatRows);
  }, [data.nodes, query]);

  // Reset focus when the filtered or sorted row set changes.
  useEffect(() => { setFocusedIndex(-1); }, [rows]);

  // Keyboard navigation.
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

  // Scroll the focused row into view.
  useEffect(() => {
    if (focusedIndex < 0 || !tableRef.current) return;
    const el = tableRef.current.querySelectorAll(".library-row")[focusedIndex];
    el?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [focusedIndex]);

  return (
    <section className="surface library-view">
      <div className="library-toolbar">
        <div className="search-box library-search uiverse-search">
          <Search size={15} />
          <div className="search-float-wrap">
            <input value={query} onChange={(event) => setQuery(event.target.value)} required />
            <label>
              {"Search concepts, cards, or source notes".split("").map((ch, index) => (
                <span key={`${ch}-${index}`} style={{ transitionDelay: `${index * 40}ms` }}>
                  {ch}
                </span>
              ))}
            </label>
            <button
              className="search-clear"
              type="button"
              onClick={(e) => { e.preventDefault(); setQuery(""); }}
              aria-label="Clear search"
            >
              <X size={10} />
            </button>
          </div>
        </div>
      </div>

      {rows.length ? (
        <div className="library-table" ref={tableRef}>
          <div className="library-head">
            <span>Concept</span>
            <span>Category</span>
            <span>Review</span>
            <span />
          </div>
          {rows.map(({ node, dueCount, nextReview, hierarchyDepth }, index) => (
            <LibraryAnimatedRow
              key={node.id}
              index={index}
              node={node}
              dueCount={dueCount}
              nextReview={nextReview}
              hierarchyDepth={hierarchyDepth}
              isFocused={focusedIndex === index}
              onOpenNode={onOpenNode}
              onDeleteNode={onDeleteNode}
            />
          ))}
        </div>
      ) : (
        <div className="library-empty">
          <Search size={28} />
          <strong>No matching concepts</strong>
          <span>Adjust the search term, category, or review status.</span>
        </div>
      )}
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function ReviewFlipCard({
  card,
  reviewMode,
  answerDraft,
  reviewResult,
  onAnswerChange,
  onSubmit,
  onContinue,
}) {
  const cat = categories[card?.category] || categories.new;

  if (!card) return null;

  return (
    <div className="review-flip-layer">
      <div className="review-flip-card">
        <div className="review-flip-inner is-flipped">
          <div className="review-flip-face review-flip-front">
            <span>{cat.label}</span>
            <strong>{card.nodeLabel || card.label}</strong>
            <small>Click to review</small>
          </div>

          <div className="review-flip-face review-flip-back">
            {reviewMode === "answering" ? (
              <form className="review-flip-back-scroll review-answer-form" onSubmit={onSubmit}>
                <div className="review-session-field">
                  <span>Question</span>
                  <strong>{card.question}</strong>
                </div>
                <label>
                  <span>Your Answer</span>
                  <textarea
                    value={answerDraft}
                    onChange={(event) => onAnswerChange(event.target.value)}
                    placeholder="Enter your answer on the back of the card"
                    autoFocus
                  />
                </label>
                <button className="review-submit-button" type="submit" disabled={!answerDraft.trim()}>
                  Submit Answer
                </button>
              </form>
            ) : null}

            {reviewMode === "revealed" && reviewResult ? (
              <div className="review-flip-back-scroll">
                <div className={`review-result-banner ${reviewResult.isCorrect ? "is-correct" : "is-wrong"}`}>
                  <span>{reviewResult.isCorrect ? "Mastered" : "Missed"}</span>
                  <strong>{reviewResult.isCorrect ? "Answer matched. The card moved into a mastered interval." : "Answer differed. The card is scheduled for tomorrow."}</strong>
                </div>
                <div className="review-session-answer">
                  <div className="review-session-field">
                    <span>Your Answer</span>
                    <p>{reviewResult.submittedAnswer}</p>
                  </div>
                  <div className="review-session-field">
                    <span>Correct Answer</span>
                    <MarkdownText text={card.answer} />
                  </div>
                  {card.codeExample ? (
                    <pre>
                      <code>{card.codeExample}</code>
                    </pre>
                  ) : null}
                </div>
                <div className="review-detail-block">
                  <span>Concept Details</span>
                  <h4>{card.nodeLabel}</h4>
                  <p>{card.desc}</p>
                  <div className="review-detail-stats">
                    <span>{card.cardCount} cards</span>
                    <span>{card.dueCount} due</span>
                    <span>{card.repetitions} reviews</span>
                  </div>
                  {card.sourceSummary ? <blockquote>{card.sourceSummary}</blockquote> : null}
                </div>
                <button className="review-submit-button" onClick={onContinue}>
                  Continue
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function ReviewView({ dueCards, onRate }) {
  const [selectedCardKey, setSelectedCardKey] = useState("");
  const [reviewMode, setReviewMode] = useState("idle");
  const [answerDraft, setAnswerDraft] = useState("");
  const [reviewResult, setReviewResult] = useState(null);
  const resultCardKey = reviewResult?.cardKey || "";
  const galleryCards = useMemo(() => {
    if (reviewMode !== "revealed" || !reviewResult?.card) return dueCards;
    return [reviewResult.card, ...dueCards.filter((card) => reviewCardKey(card) !== reviewResult.cardKey)];
  }, [dueCards, reviewMode, reviewResult]);
  const selectedCard = useMemo(
    () =>
      reviewMode === "revealed" && reviewResult?.card
        ? reviewResult.card
        : dueCards.find((card) => reviewCardKey(card) === selectedCardKey) || dueCards[0] || null,
    [dueCards, reviewMode, reviewResult, selectedCardKey],
  );
  const activeCardKey = reviewMode === "revealed" ? resultCardKey : reviewCardKey(selectedCard);

  useEffect(() => {
    if (!dueCards.length && reviewMode !== "revealed") {
      setSelectedCardKey("");
      setReviewMode("idle");
      setAnswerDraft("");
      setReviewResult(null);
      return;
    }

    if (reviewMode !== "revealed" && dueCards.length) {
      const selectedStillDue = dueCards.some((card) => reviewCardKey(card) === selectedCardKey);
      if (!selectedStillDue) {
        setSelectedCardKey(reviewCardKey(dueCards[0]));
        setAnswerDraft("");
        setReviewMode("idle");
      }
    }
  }, [dueCards, reviewMode, selectedCardKey]);

  const selectCard = useCallback((card) => {
    if (!card) return;
    setSelectedCardKey(reviewCardKey(card));
    setAnswerDraft("");
    setReviewResult(null);
    setReviewMode("answering");
  }, []);

  const deselectCard = useCallback(() => {
    setSelectedCardKey("");
    setAnswerDraft("");
    setReviewResult(null);
    setReviewMode("idle");
  }, []);

  function submitAnswer(event) {
    event.preventDefault();
    if (!selectedCard || !answerDraft.trim()) return;
    const isCorrect = isReviewAnswerMatch(answerDraft, selectedCard.answer);
    const result = {
      card: selectedCard,
      cardKey: reviewCardKey(selectedCard),
      isCorrect,
      submittedAnswer: answerDraft,
      quality: isCorrect ? 5 : 1,
    };
    setReviewResult(result);
    setSelectedCardKey(result.cardKey);
    setReviewMode("revealed");
    onRate?.(selectedCard, result.quality);
  }

  function continueReview() {
    const nextCard = dueCards.find((card) => reviewCardKey(card) !== resultCardKey);
    setReviewResult(null);
    setAnswerDraft("");
    if (nextCard) {
      setSelectedCardKey(reviewCardKey(nextCard));
      setReviewMode("answering");
    } else {
      setSelectedCardKey("");
      setReviewMode("idle");
    }
  }

  return (
    <section className="surface review-view">
      {galleryCards.length ? (
        <div className={`review-workbench ${reviewMode === "idle" ? "is-idle" : "has-active-card"}`}>
          <div className="review-dome-wrap">
            <CircularGallery
              cards={galleryCards}
              selectedCardKey={activeCardKey}
              faceState="front"
              onSelect={selectCard}
              onDeselect={deselectCard}
              bend={2}
              borderRadius={0.06}
              scrollSpeed={2}
              scrollEase={0.05}
            />
            {reviewMode !== "idle" && selectedCard ? (
              <ReviewFlipCard
                key={activeCardKey}
                card={selectedCard}
                reviewMode={reviewMode}
                answerDraft={answerDraft}
                reviewResult={reviewResult}
                onAnswerChange={setAnswerDraft}
                onSubmit={submitAnswer}
                onContinue={continueReview}
              />
            ) : null}
          </div>
        </div>
      ) : (
        <div className="empty-state">
          <Check size={40} />
          <h3>No concepts due today</h3>
          <p>New concepts enter the review queue immediately.</p>
        </div>
      )}
    </section>
  );
}

function AddView({ data, onAdd, onAcceptExtraction, onToast }) {
  const [manualDraft, setManualDraft] = useState({
    label: "",
    parentId: "",
    desc: "",
    question: "",
    answer: "",
    codeExample: "",
  });
  const [noteInput, setNoteInput] = useState("");
  const [extracting, setExtracting] = useState(false);
  const [extractionProgress, setExtractionProgress] = useState(null);
  const [extractionOutcome, setExtractionOutcome] = useState(null);
  const [committingPreview, setCommittingPreview] = useState(false);
  const [extractError, setExtractError] = useState("");
  const [preview, setPreview] = useState(null);
  const [scannedDocuments, setScannedDocuments] = useState([]);
  const [scanningDocuments, setScanningDocuments] = useState(false);
  const [documentSourceText, setDocumentSourceText] = useState("");
  const [aiConfigStatus, setAiConfigStatus] = useState(null);
  const [apiKeyModalOpen, setApiKeyModalOpen] = useState(false);
  const [apiKeyDraft, setApiKeyDraft] = useState("");
  const [apiKeyMessage, setApiKeyMessage] = useState("");
  const [savingApiKey, setSavingApiKey] = useState(false);
  const previewRef = useRef(null);

  useEffect(() => {
    if (!extracting) {
      setExtractionProgress(null);
      return undefined;
    }

    const startedAt = Date.now();
    setExtractionProgress(extractionProgressForElapsed(0));
    const interval = window.setInterval(() => {
      setExtractionProgress(extractionProgressForElapsed(Date.now() - startedAt));
    }, 500);

    return () => window.clearInterval(interval);
  }, [extracting]);

  useEffect(() => {
    if (!window.mindcode?.getAiConfigStatus) return;

    window.mindcode
      .getAiConfigStatus()
      .then((status) => setAiConfigStatus(status))
      .catch(() => setAiConfigStatus(null));
  }, []);

  useEffect(() => {
    if (!preview) return undefined;

    const handle = window.requestAnimationFrame(() => {
      previewRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    return () => window.cancelAnimationFrame(handle);
  }, [preview]);

  function openApiKeyModal(message = "") {
    setApiKeyDraft("");
    setApiKeyMessage(message);
    setApiKeyModalOpen(true);
  }

  function errorNeedsApiKey(error) {
    return String(error?.message || error || "").includes("DashScope API key");
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
      onToast("DashScope API key saved");
    } catch (error) {
      setApiKeyMessage(`Save failed: ${error.message}`);
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
      onToast("DashScope API key cleared", "warning");
    } catch (error) {
      setApiKeyMessage(`Clear failed: ${error.message}`);
    } finally {
      setSavingApiKey(false);
    }
  }

  function submit() {
    const added = onAdd(manualDraft);
    if (added) {
      setManualDraft({
        label: "",
        parentId: "",
        desc: "",
        question: "",
        answer: "",
        codeExample: "",
      });
    }
  }

  function patchPreviewNode(nodeId, patch) {
    setPreview((current) => ({
      ...current,
      nodes: current.nodes.map((node) =>
        node.id === nodeId
          ? {
              ...node,
              ...patch,
              cards: node.cards.map((card, index) =>
                index === 0
                  ? {
                      ...card,
                      question: patch.question ?? card.question,
                      answer: patch.answer ?? card.answer,
                      codeExample: patch.codeExample ?? card.codeExample,
                    }
                  : card,
              ),
            }
          : node,
      ),
    }));
  }

  function patchPreviewEdge(edgeId, patch) {
    setPreview((current) => ({
      ...current,
      edges: current.edges.map((edge) => (edge.id === edgeId ? { ...edge, ...patch } : edge)),
    }));
  }

  async function scanLocalDocuments() {
    if (!window.mindcode?.scanDocuments) {
      onToast("Local document scanning is available in the desktop app.", "warning");
      return;
    }

    setExtractError("");
    setExtractionOutcome(null);
    const status = aiConfigStatus || (await refreshAiConfigStatus().catch(() => null));
    if (!status?.hasApiKey) {
      openApiKeyModal("AI document scanning requires a DashScope API key. Save one, then scan again.");
      return;
    }

    setScanningDocuments(true);
    try {
      const result = await window.mindcode.scanDocuments();
      if (result?.canceled) return;
      const documents = result?.documents || [];
      const sourceText = formatScannedDocuments(documents);

      setScannedDocuments(documents);
      setDocumentSourceText(sourceText);
      setNoteInput(sourceText);
      setPreview(null);
      setExtractionOutcome(null);

      if (!documents.length || !sourceText) {
        onToast("No scannable document content was found.", "warning");
        return;
      }

      if (result.warning) onToast(result.warning, "warning");
      else onToast(`Scanned ${documents.length} documents`);
    } catch (error) {
      if (errorNeedsApiKey(error)) {
        openApiKeyModal("AI document scanning requires a DashScope API key. Save one, then scan again.");
      } else {
        setExtractError(`Document scan failed: ${error.message}`);
      }
    } finally {
      setScanningDocuments(false);
    }
  }

  async function buildPreview() {
    const extractionText = noteInput.trim();
    const sourceText = (documentSourceText || noteInput).trim();
    if (!extractionText) {
      setExtractError("Scan local documents first, or paste notes/code snippets.");
      return;
    }

    setExtractError("");
    setExtractionOutcome(null);
    setExtracting(true);
    try {
      const result = await extractConcepts(
        extractionText,
        data.nodes.map((node) => node.label),
        scannedDocuments.length ? { requireAi: true } : {},
      );
      const nodes = (result.nodes || []).map((item, index) => {
        const node = normalizeNode(item, `preview-${index}`);
        return {
          ...node,
          selected: true,
          duplicate: false,
          duplicateTargetId: "",
          mergeMode: "new",
        };
      });
      const existingIds = new Set(data.nodes.map((node) => node.id));
      const endpointIds = new Set([...existingIds, ...nodes.map((node) => node.id)]);
      const edges = (result.edges || [])
        .map((edge, index) => ({ ...normalizeEdge(edge, index), selected: true }))
        .filter((edge) => endpointIds.has(edge.from) && endpointIds.has(edge.to));
      const generatedCardCount = nodes.reduce((total, node) => total + cardsForNode(node).length, 0);

      setPreview({
        provider: result.provider || "mock",
        warning: result.warning || "",
        sourceText,
        summaryText: extractionText,
        nodes,
        edges,
      });
      setPreviewStep(0);
      setExtractionOutcome(
        nodes.length
          ? {
              type: "success",
              message: `Draft ready: ${nodes.length} concepts and ${generatedCardCount} review cards generated. Review the draft below.`,
            }
          : {
              type: "warning",
              message: "No supported concepts were extracted. Try a smaller or more specific document section.",
            },
      );
      if (!nodes.length) onToast("No new concepts were extracted. You can create one manually.", "warning");
    } catch (error) {
      const message = `Extraction failed: ${error.message}`;
      setExtractError(message);
      setExtractionOutcome({ type: "error", message });
    } finally {
      setExtracting(false);
    }
  }

  async function acceptPreview() {
    if (!preview || committingPreview) return;
    setCommittingPreview(true);
    try {
      const committed = await onAcceptExtraction({
        nodes: preview.nodes.filter((node) => node.selected || node.mergeMode === "append-card"),
        edges: preview.edges.filter((edge) => edge.selected),
        sourceText: preview.sourceText,
      });
      if (committed) {
        setPreview(null);
        setPreviewStep(0);
        setExtractionOutcome(null);
        setNoteInput("");
      }
    } finally {
      setCommittingPreview(false);
    }
  }

  const [previewStep, setPreviewStep] = useState(0);
  const [cardFlipped, setCardFlipped] = useState(false);

  const previewEndpointOptions = preview ? [...data.nodes, ...preview.nodes] : [];
  const previewWillWrite = preview?.nodes.some((node) => node.selected || node.mergeMode === "append-card");
  const providerLabel = aiConfigStatus?.hasApiKey ? "Qwen" : "API Key";
  const parentOptions = data.nodes;
  const scannedDocumentNameCounts = scannedDocuments.reduce((counts, document) => {
    const displayName = displayNameForDocument(document);
    counts.set(displayName, (counts.get(displayName) || 0) + 1);
    return counts;
  }, new Map());

  const manualHasLabel = manualDraft.label.trim().length > 0;
  const manualHasDesc = manualDraft.desc.trim().length > 0;
  const manualHasQuestion = manualDraft.question.trim().length > 0;
  const previewQuestion = manualDraft.question.trim() || (manualHasLabel ? `How would you explain ${manualDraft.label.trim()}?` : "");
  const previewAnswer = manualDraft.answer.trim() || manualDraft.desc.trim();

  function goToPreviewStep(index) {
    setPreviewStep(Math.max(0, Math.min(index, preview?.nodes.length ?? 0)));
  }

  const currentPreviewNode = preview?.nodes[previewStep] ?? null;
  const isOnEdgesStep = Boolean(preview) && previewStep >= preview.nodes.length;
  const currentPreviewCards = currentPreviewNode ? cardsForNode(currentPreviewNode) : [];
  const currentPreviewSource = currentPreviewNode?.sources?.map((source) => source.text).filter(Boolean).join("\n\n") || "";

  return (
    <section className="surface add-view">
      <header className="add-workspace-header">
        <span>Add Concept Workspace</span>
        <h2>Create Concept</h2>
        <p>Scan local documents into a mind map, or add a single concept manually.</p>
      </header>
      <div className="add-workbench">
        <div className="add-pane notes-pane">
          <div className="pane-header">
            <div>
              <h3>Scan Local Documents</h3>
              <p>Select local documents or folders and let AI generate a new mind map draft.</p>
            </div>
            <div className="pane-actions">
              {window.mindcode?.getAiConfigStatus ? (
                <button className="secondary-button compact" onClick={() => openApiKeyModal()} disabled={savingApiKey}>
                  <KeyRound size={14} />
                  {providerLabel}
                </button>
              ) : null}
              <button className="secondary-button compact" onClick={scanLocalDocuments} disabled={scanningDocuments}>
                {scanningDocuments ? <Loader2 size={14} className="spin" /> : <Upload size={14} />}
                {scanningDocuments ? "Scanning" : "Choose Documents"}
              </button>
            </div>
          </div>
          <label>
            <span>Document Content</span>
            <textarea
              className="notes-editor"
              value={noteInput}
              onChange={(event) => {
                setNoteInput(event.target.value);
                setDocumentSourceText("");
                setScannedDocuments([]);
              }}
              placeholder="Content appears here after you choose local documents. You can also paste text to generate a draft."
            />
          </label>
          {scannedDocuments.length ? (
            <section className="local-document-sync" aria-label="Local document scan">
              <div className="local-document-sync-summary">
                <strong>Local Documents</strong>
                <span>{scannedDocuments.length} files loaded</span>
              </div>
              <div className="local-document-list">
                {scannedDocuments.slice(0, 12).map((document) => {
                  const displayName = displayNameForDocument(document);
                  const relativePath = document.relativePath || displayName;
                  const isDuplicateName = scannedDocumentNameCounts.get(displayName) > 1;
                  const showRelativePath = relativePath !== displayName || isDuplicateName;
                  return (
                    <div key={document.path} className="local-document-row" title={relativePath}>
                      <span>
                        <strong>{displayName}</strong>
                        {showRelativePath ? <small className={isDuplicateName ? "is-duplicate-path" : ""}>{relativePath}</small> : null}
                        <small>
                          {document.text.length} chars{document.truncated ? " · truncated" : ""}
                        </small>
                      </span>
                    </div>
                  );
                })}
              </div>
            </section>
          ) : null}
          {extractError && extractionOutcome?.type !== "error" ? <p className="inline-warning">{extractError}</p> : null}
          <div className="action-row">
            <button className="primary-button ai-action" onClick={buildPreview} disabled={extracting || !noteInput.trim()}>
              {extracting ? <Loader2 size={16} className="spin" /> : <Sparkles size={16} />}
              {extracting ? "Generating" : "Generate Mind Map Draft"}
            </button>
          </div>
          {extracting && extractionProgress ? (
            <div className="extraction-progress" role="status" aria-live="polite">
              <div className="extraction-progress-meta">
                <span>{extractionProgress.message}</span>
                <strong>{extractionProgress.percent}%</strong>
              </div>
              <div
                className="extraction-progress-track"
                role="progressbar"
                aria-label="AI extraction progress"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={extractionProgress.percent}
              >
                <span style={{ width: `${extractionProgress.percent}%` }} />
              </div>
            </div>
          ) : null}
          {!extracting && extractionOutcome ? (
            <div className={`extraction-result is-${extractionOutcome.type}`} role={extractionOutcome.type === "error" ? "alert" : "status"}>
              {extractionOutcome.message}
            </div>
          ) : null}
        </div>

        <div className="add-pane manual-pane">
          <div className="pane-header">
            <div>
              <h3>Quick Create</h3>
              <p>Quickly create a concept and its first review card.</p>
            </div>
          </div>
          <div className="manual-fields">
            <label>
              <span>Concept Name</span>
              <input
                value={manualDraft.label}
                onChange={(event) => setManualDraft({ ...manualDraft, label: event.target.value })}
                placeholder="Example: Promise.all"
                autoComplete="off"
              />
            </label>

            <label>
              <span>Parent Concept <em>Optional</em></span>
              <FilterDropdown
                value={manualDraft.parentId}
                options={[
                  { value: "", label: "No parent · root/standalone topic" },
                  ...parentOptions.map((node) => ({ value: node.id, label: node.label })),
                ]}
                onChange={(value) => setManualDraft({ ...manualDraft, parentId: value })}
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
                  <span>Explanation</span>
                  <textarea
                    value={manualDraft.desc}
                    onChange={(event) => setManualDraft({ ...manualDraft, desc: event.target.value })}
                    placeholder="Explain this concept in one sentence."
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
                    <span>Review Question <em>Optional</em></span>
                    <textarea
                      value={manualDraft.question}
                      onChange={(event) => setManualDraft({ ...manualDraft, question: event.target.value })}
                      placeholder={`How would you explain ${manualDraft.label.trim()}?`}
                    />
                  </label>
                  <label>
                    <span>Card Answer <em>Optional</em></span>
                    <textarea
                      value={manualDraft.answer}
                      onChange={(event) => setManualDraft({ ...manualDraft, answer: event.target.value })}
                      placeholder="Leave blank to use the explanation."
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
                  <span>Code Example <em>Optional</em></span>
                  <textarea
                    className="code-input"
                    value={manualDraft.codeExample}
                    onChange={(event) => setManualDraft({ ...manualDraft, codeExample: event.target.value })}
                    placeholder="Shortest runnable example"
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
                  <div className="manual-card-preview-label">Card Preview</div>
                  <button
                    className={`manual-flip-card ${cardFlipped ? "is-flipped" : ""}`}
                    onClick={() => setCardFlipped((v) => !v)}
                    aria-label={cardFlipped ? "Show front" : "Flip to back"}
                  >
                    <span className="manual-flip-inner">
                      <span className="manual-flip-face manual-flip-front">
                        <strong>{previewQuestion || "The review question will appear here"}</strong>
                        <small>{manualDraft.label.trim()}</small>
                        <i />
                      </span>
                      <span className="manual-flip-face manual-flip-back">
                        <strong>{manualDraft.label.trim()}</strong>
                        <span>{previewAnswer || "The answer will appear here"}</span>
                        {manualDraft.codeExample.trim() ? <code>{manualDraft.codeExample.trim()}</code> : null}
                      </span>
                    </span>
                  </button>
                  <div className="manual-card-hint">{cardFlipped ? "Front" : "Back"} · click to flip</div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <div className="action-row">
            <button className="primary-button" onClick={submit} disabled={!manualDraft.label.trim()}>
              <CirclePlus size={16} />
              Create Concept
            </button>
          </div>
        </div>
      </div>

      {preview ? (
        <div className="extraction-preview" ref={previewRef}>
          <div className="pane-header">
            <div>
              <h3>Draft Preview</h3>
              <p>Review each concept before writing it to the knowledge graph.</p>
            </div>
            <div className="preview-stepper-nav">
              <span className="preview-step-count">
                {isOnEdgesStep ? "Confirm Write" : `${previewStep + 1} / ${preview.nodes.length}`}
              </span>
              <button
                className="icon-button"
                onClick={() => goToPreviewStep(previewStep - 1)}
                disabled={previewStep === 0}
                aria-label="Previous"
              >
                ‹
              </button>
              <button
                className="icon-button"
                onClick={() => goToPreviewStep(previewStep + 1)}
                aria-label="Next"
                disabled={isOnEdgesStep}
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
                    <span>Matches an existing concept</span>
                    <FilterDropdown
                      value={currentPreviewNode.mergeMode}
                      options={[
                        { value: "skip", label: "Skip" },
                        { value: "append-card", label: "Append card to existing concept" },
                        { value: "new", label: "Rename and create new" },
                      ]}
                      onChange={(value) =>
                        patchPreviewNode(currentPreviewNode.id, {
                          mergeMode: value,
                          selected: value === "new" ? currentPreviewNode.selected : false,
                        })
                      }
                    />
                  </div>
                ) : null}
                <div className="preview-fields">
                  <label>
                    <span>Name</span>
                    <input value={currentPreviewNode.label} onChange={(event) => patchPreviewNode(currentPreviewNode.id, { label: event.target.value })} />
                  </label>
                  <label>
                    <span>Category</span>
                    <FilterDropdown
                      value={currentPreviewNode.category}
                      options={categoryOptions}
                      onChange={(value) => patchPreviewNode(currentPreviewNode.id, { category: value })}
                    />
                  </label>
                  <label>
                    <span>Parent Concept</span>
                    <FilterDropdown
                      value={currentPreviewNode.parentId || ""}
                      options={[
                        { value: "", label: "No parent · root/standalone topic" },
                        ...previewEndpointOptions
                          .filter((node) => node.id !== currentPreviewNode.id)
                          .map((node) => ({ value: node.id, label: node.label })),
                      ]}
                      onChange={(value) => patchPreviewNode(currentPreviewNode.id, { parentId: value })}
                    />
                  </label>
                  <label>
                    <span>Explanation</span>
                    <textarea value={currentPreviewNode.desc} onChange={(event) => patchPreviewNode(currentPreviewNode.id, { desc: event.target.value })} />
                  </label>
                  {currentPreviewSource ? (
                    <div className="preview-source-summary">
                      <span>Source Summary</span>
                      <p>{currentPreviewSource}</p>
                    </div>
                  ) : null}
                  <label>
                    <span>Review Question</span>
                    <textarea value={currentPreviewNode.question} onChange={(event) => patchPreviewNode(currentPreviewNode.id, { question: event.target.value })} placeholder="Review question" />
                  </label>
                  <label>
                    <span>Card Answer</span>
                    <textarea value={currentPreviewNode.answer} onChange={(event) => patchPreviewNode(currentPreviewNode.id, { answer: event.target.value })} placeholder="Card answer" />
                  </label>
                  {currentPreviewCards.length > 1 ? (
                    <div className="preview-card-list">
                      <span>Generated Cards ({currentPreviewCards.length})</span>
                      {currentPreviewCards.map((card, index) => (
                        <article key={card.id}>
                          <strong>Card {index + 1}</strong>
                          <p>{card.question}</p>
                          <small>{card.answer}</small>
                        </article>
                      ))}
                    </div>
                  ) : null}
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
                    Accept
                  </button>
                  <button
                    className={`preview-decision-btn ${!currentPreviewNode.selected && currentPreviewNode.mergeMode !== "append-card" ? "is-skip" : ""}`}
                    onClick={() => {
                      patchPreviewNode(currentPreviewNode.id, { selected: false, mergeMode: "skip" });
                      goToPreviewStep(previewStep + 1);
                    }}
                  >
                    <X size={15} />
                    Skip
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
                <strong className="preview-step-label">Relations ({preview.edges.length})</strong>
                {preview.edges.length ? (
                  <div className="preview-edge-list">
                    {preview.edges.map((edge) => (
                      <div key={edge.id} className="preview-edge">
                        <input
                          type="checkbox"
                          checked={edge.selected}
                          onChange={(event) => patchPreviewEdge(edge.id, { selected: event.target.checked })}
                          aria-label={`Write relation ${edge.label}`}
                        />
                        <FilterDropdown
                          value={edge.from}
                          options={previewEndpointOptions.map((node) => ({ value: node.id, label: node.label }))}
                          onChange={(value) => patchPreviewEdge(edge.id, { from: value })}
                        />
                        <input value={edge.label} onChange={(event) => patchPreviewEdge(edge.id, { label: event.target.value })} />
                        <FilterDropdown
                          value={edge.to}
                          options={previewEndpointOptions.map((node) => ({ value: node.id, label: node.label }))}
                          onChange={(value) => patchPreviewEdge(edge.id, { to: value })}
                        />
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="relation-empty">No relations were extracted. You can connect nodes manually in the details panel after saving.</p>
                )}
                <div className="preview-actions">
                  <button className="secondary-button" onClick={() => { setPreview(null); setPreviewStep(0); setExtractionOutcome(null); }} disabled={committingPreview}>
                    Discard Draft
                  </button>
                  <button className="primary-button" onClick={acceptPreview} disabled={!previewWillWrite || committingPreview}>
                    {committingPreview ? <Loader2 size={16} className="spin" /> : <Save size={16} />}
                    {committingPreview ? "Writing" : "Confirm Write"}
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      ) : (
        <div className="add-empty-state">
          <strong>Knowledge will appear here</strong>
          <span>Create from notes or add manually.</span>
        </div>
      )}
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
  const [availableMaps, setAvailableMaps] = useState([]);
  const [currentMap, setCurrentMap] = useState(null);
  const [view, setView] = useState("graph");
  const [selectedId, setSelectedId] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [toast, setToast] = useState(null);
  const skipSave = useRef(true);
  const saveHandle = useRef(null);

  const dueCards = useMemo(() => reviewQueue(data.nodes), [data.nodes]);

  const showToast = useCallback((message, type = "info") => {
    setToast({ message, type });
    window.clearTimeout(showToast.timer);
    showToast.timer = window.setTimeout(() => setToast(null), 3000);
  }, []);

  useEffect(() => {
    let cancelled = false;
    loadInitialMindMap()
      .then((result) => {
        if (cancelled) return;
        setData(normalizeMindCodeData(result.data));
        setAvailableMaps(result.maps || (result.map ? [result.map] : []));
        setCurrentMap(result.map || null);
        setLoaded(true);
        skipSave.current = true;
        writeLocalCache(result.data);
        if (result.warning) showToast(result.warning, "warning");
      })
      .catch((error) => {
        if (cancelled) return;
        setLoaded(true);
        skipSave.current = true;
        showToast(`Load failed. Sample data is being used: ${error.message}`, "warning");
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
      saveHandle.current = null;
      saveCurrentMindMap(currentMap, { ...data, updatedAt: Date.now() })
        .then((result) => {
          if (result?.map) {
            setCurrentMap(result.map);
            setAvailableMaps((maps) => {
              const byId = new Map(maps.map((map) => [map.id, map]));
              byId.set(result.map.id, result.map);
              return [...byId.values()].sort((left, right) => right.updatedAt - left.updatedAt || left.title.localeCompare(right.title, "en-US"));
            });
          }
        })
        .catch((error) => showToast(`Save failed: ${error.message}`, "warning"));
    }, 250);
    saveHandle.current = handle;

    return () => {
      window.clearTimeout(handle);
      if (saveHandle.current === handle) saveHandle.current = null;
    };
  }, [currentMap, data, loaded, showToast]);

  const reloadMaps = useCallback(async () => {
    if (!window.mindcode?.listMaps) return;
    const result = await window.mindcode.listMaps();
    setAvailableMaps(result.maps || []);
  }, []);

  const loadMapById = useCallback(
    async (mapId) => {
      if (!mapId) return;
      try {
        const result = window.mindcode?.loadMap ? await window.mindcode.loadMap({ id: mapId }) : null;
        if (!result?.data) return;
        skipSave.current = true;
        setData(normalizeMindCodeData(result.data));
        setCurrentMap(result.map);
        setSelectedId(null);
        localStorage.setItem(currentMapStorageKey, result.map.id);
        if (window.mindcode?.listMaps) await reloadMaps();
        showToast(`Opened ${result.map.title}`);
      } catch (error) {
        showToast(`Open failed: ${error.message}`, "warning");
      }
    },
    [reloadMaps, showToast],
  );

  const deleteMapById = useCallback(
    async (mapId) => {
      const map = availableMaps.find((item) => item.id === mapId);
      if (!map || !window.mindcode?.deleteMap) return;
      const message = map.external ? `Remove "${map.title}" from recent maps? The original file will not be deleted.` : `Delete map "${map.title}"? This cannot be undone.`;
      if (!window.confirm(message)) return;

      try {
        if (currentMap?.id === mapId) {
          window.clearTimeout(saveHandle.current);
          saveHandle.current = null;
          skipSave.current = true;
        }
        const result = await window.mindcode.deleteMap({ id: mapId });
        const maps = result.maps || [];
        setAvailableMaps(maps);
        if (currentMap?.id !== mapId) {
          showToast(map.external ? `Removed ${map.title}` : `Deleted ${map.title}`);
          return;
        }

        const nextMap = maps[0];
        if (!nextMap) {
          const fallbackData = normalizeMindCodeData({
            nodes: [
              normalizeNode({
                label: "MindCode",
                category: "core",
                desc: "New mind map root topic.",
              }),
            ],
            edges: [],
          });
          const created = await createMindMapFile("MindCode", fallbackData);
          skipSave.current = true;
          setData(normalizeMindCodeData(created.data));
          setCurrentMap(created.map);
          setAvailableMaps(created.map ? [created.map] : []);
          setSelectedId(created.data.nodes[0]?.id || null);
          localStorage.setItem(currentMapStorageKey, created.map.id);
          showToast(map.external ? `Removed ${map.title} and created a new blank map` : `Deleted ${map.title} and created a new blank map`);
          return;
        }
        const loadedMap = await window.mindcode.loadMap({ id: nextMap.id });
        skipSave.current = true;
        setData(normalizeMindCodeData(loadedMap.data));
        setCurrentMap(loadedMap.map);
        setSelectedId(null);
        localStorage.setItem(currentMapStorageKey, loadedMap.map.id);
        showToast(map.external ? `Removed ${map.title}` : `Deleted ${map.title}`);
      } catch (error) {
        showToast(`Delete failed: ${error.message}`, "warning");
      }
    },
    [availableMaps, currentMap, showToast],
  );

  const openMapResult = useCallback(
    (result, messagePrefix) => {
      if (!result?.data || !result?.map) return false;
      const normalized = normalizeMindCodeData(result.data);
      skipSave.current = true;
      setData(normalized);
      setCurrentMap(result.map);
      setSelectedId(normalized.nodes[0]?.id || null);
      setView("graph");
      setAvailableMaps((maps) => {
        const byId = new Map(maps.map((map) => [map.id, map]));
        byId.set(result.map.id, result.map);
        return [...byId.values()].sort((left, right) => (right.updatedAt || 0) - (left.updatedAt || 0) || left.title.localeCompare(right.title, "en-US"));
      });
      localStorage.setItem(currentMapStorageKey, result.map.id);
      showToast(`${messagePrefix} ${result.map.title}`);
      return true;
    },
    [showToast],
  );

  const handleOpenMapFile = useCallback(async () => {
    try {
      const result = await openMindMapFile();
      if (result?.browserOnly) {
        showToast("The browser preview cannot open local map files.", "warning");
        return;
      }
      if (!result?.canceled) openMapResult(result, "Opened");
    } catch (error) {
      showToast(`Open failed: ${error.message}`, "warning");
    }
  }, [openMapResult, showToast]);

  const handleImportMap = useCallback(async () => {
    try {
      const result = await importMindMapFile();
      if (result?.browserOnly) {
        showToast("The browser preview cannot import local map files.", "warning");
        return;
      }
      if (!result?.canceled) openMapResult(result, "Imported");
    } catch (error) {
      showToast(`Import failed: ${error.message}`, "warning");
    }
  }, [openMapResult, showToast]);

  const handleExportMap = useCallback(async () => {
    try {
      const result = await exportMindMapFile(currentMap, data);
      if (result?.browserOnly) {
        showToast("The browser preview saved the current map cache.", "warning");
        return;
      }
      if (!result?.canceled) showToast("Exported .mindcode.md");
    } catch (error) {
      showToast(`Export failed: ${error.message}`, "warning");
    }
  }, [currentMap, data, showToast]);

  const createBlankMap = useCallback(
    async (title) => {
      const normalized = normalizeMindCodeData({
        nodes: [
          normalizeNode({
            label: title,
            category: "core",
            desc: "New mind map root topic.",
          }),
        ],
        edges: [],
      });
      try {
        const result = await createMindMapFile(title, normalized);
        skipSave.current = true;
        setData(normalizeMindCodeData(result.data));
        setCurrentMap(result.map);
        setAvailableMaps((maps) => [result.map, ...maps.filter((map) => map.id !== result.map.id)]);
        setSelectedId(result.data.nodes[0]?.id || null);
        setView("graph");
        localStorage.setItem(currentMapStorageKey, result.map.id);
        showToast(`Created ${result.map.title}`);
        return true;
      } catch (error) {
        showToast(`Create failed: ${error.message}`, "warning");
        return false;
      }
    },
    [showToast],
  );

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
    showToast("Concept updated");
  };

  const deleteNode = (nodeId) => {
    const node = data.nodes.find((item) => item.id === nodeId);
    if (!node) return;
    const confirmed = window.confirm(`Delete "${node.label}"? Related relations will also be removed.`);
    if (!confirmed) return;
    setData((previous) => ({
      ...previous,
      nodes: previous.nodes.filter((item) => item.id !== nodeId),
      edges: previous.edges.filter((edge) => edge.from !== nodeId && edge.to !== nodeId),
      updatedAt: Date.now(),
    }));
    setSelectedId(null);
    showToast("Concept deleted");
  };

  const openNodeInGraph = (nodeId) => {
    setSelectedId(nodeId);
    setView("graph");
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
  };

  const handleAdd = ({ label, parentId, desc, question, answer, codeExample }) => {
    if (!label) {
      showToast("Cannot add: enter a concept name", "warning");
      return false;
    }

    const newNode = normalizeNode(
      {
        label,
        parentId: parentId || undefined,
        desc: desc || undefined,
        question: question || undefined,
        answer: answer || undefined,
        codeExample: codeExample || undefined,
      },
      `concept-${Date.now()}`,
    );
    if (data.nodes.some((node) => node.id === newNode.id)) {
      showToast("Cannot add: a concept with this name already exists", "warning");
      return false;
    }

    setData((previous) => ({
      ...previous,
      nodes: [...previous.nodes, newNode],
      updatedAt: Date.now(),
    }));
    setView("graph");
    setSelectedId(newNode.id);
    showToast("Concept added");
    return true;
  };

  const acceptExtraction = async ({ nodes, edges, sourceText }) => {
    const timestamp = Date.now();
    const acceptedIds = new Map();
    const acceptedNodes = [];

    nodes.forEach((node, index) => {
      if (!node.selected) return;
      const next = normalizeNode(
        {
          ...node,
          id: undefined,
          sources: sourcesForAcceptedNode(node, sourceText, timestamp),
        },
        `extracted-${index}`,
      );
      acceptedIds.set(node.id, next.id);
      acceptedNodes.push(next);
    });

    if (!acceptedNodes.length) {
      showToast("The draft has no new concepts to write.", "warning");
      return false;
    }

    const validParentIds = new Set(acceptedNodes.map((node) => node.id));
    const resolvedAcceptedNodes = acceptedNodes.map((node) => {
      const parentId = acceptedIds.get(node.parentId) || node.parentId || "";
      return {
        ...node,
        parentId: parentId && validParentIds.has(parentId) && parentId !== node.id ? parentId : "",
      };
    });

    const endpointIds = new Set(resolvedAcceptedNodes.map((node) => node.id));
    const existingEdgeKeys = new Set();
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

    const nextData = normalizeMindCodeData({
      nodes: resolvedAcceptedNodes,
      edges: acceptedEdges,
      updatedAt: timestamp,
    });
    const title = mapTitleFromData(nextData, "AI Mind Map");

    try {
      const result = await createMindMapFile(title, nextData);
      skipSave.current = true;
      setData(normalizeMindCodeData(result.data));
      setCurrentMap(result.map);
      setAvailableMaps((maps) => [result.map, ...maps.filter((map) => map.id !== result.map.id)]);
      setView("graph");
      setSelectedId(result.data.nodes[0]?.id || null);
      localStorage.setItem(currentMapStorageKey, result.map.id);
      showToast(`Generated new mind map: ${result.map.title}`);
      return true;
    } catch (error) {
      showToast(`Failed to create mind map: ${error.message}`, "warning");
      return false;
    }
  };

  return (
    <div className="app-shell">
      <AppBrandHeader view={view} currentMap={currentMap} data={data} />
      <main className="main-panel">
        {view === "graph" ? (
          <GraphView
            data={data}
            maps={availableMaps}
            currentMap={currentMap}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onLoadMap={loadMapById}
            onCreateMap={createBlankMap}
            onDeleteMap={window.mindcode?.deleteMap ? deleteMapById : undefined}
            fileActionsAvailable={Boolean(window.mindcode?.openMapFile && window.mindcode?.importMap && window.mindcode?.exportMap)}
            onOpenMapFile={handleOpenMapFile}
            onImportMap={handleImportMap}
            onExportMap={handleExportMap}
            onUpdateNode={updateNode}
            onDeleteNode={deleteNode}
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
