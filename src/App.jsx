import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Brain,
  Check,
  CirclePlus,
  Database,
  Edit3,
  Filter,
  GitBranch,
  Loader2,
  RotateCcw,
  Save,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { categories, seedData } from "./shared/seedData.js";
import { daysUntil, isDue, sm2 } from "./shared/sm2.js";
import { normalizeMindCodeData, normalizeNode } from "./shared/schema.js";

const storageKey = "mindcode-browser-data";
const views = [
  { id: "graph", label: "图谱", icon: GitBranch },
  { id: "review", label: "复习", icon: RotateCcw },
  { id: "add", label: "添加", icon: CirclePlus },
];

function todayCount(nodes) {
  return nodes.filter((node) => isDue(node)).length;
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
  const [positions, setPositions] = useState({});
  const [dragging, setDragging] = useState(null);

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
  };

  const handlePointerMove = useCallback(
    (event) => {
      if (!dragging) return;
      const point = getPoint(event);
      setPositions((previous) => ({
        ...previous,
        [dragging]: {
          x: Math.max(64, Math.min(836, point.x - dragOffset.current.x)),
          y: Math.max(48, Math.min(492, point.y - dragOffset.current.y)),
        },
      }));
    },
    [dragging, getPoint],
  );

  const nodeIds = new Set(nodes.map((node) => node.id));

  return (
    <svg
      ref={svgRef}
      className={`graph-canvas ${dragging ? "is-dragging" : ""}`}
      viewBox="0 0 900 540"
      onPointerMove={handlePointerMove}
      onPointerUp={() => setDragging(null)}
      onPointerCancel={() => setDragging(null)}
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
          const from = positions[edge.from] || { x: 450, y: 270 };
          const to = positions[edge.to] || { x: 450, y: 270 };
          const middleX = (from.x + to.x) / 2;
          const middleY = (from.y + to.y) / 2;
          return (
            <g key={edge.id} className="edge">
              <line x1={from.x} y1={from.y} x2={to.x} y2={to.y} markerEnd="url(#arrow)" />
              <text x={middleX} y={middleY - 8} textAnchor="middle">
                {edge.label}
              </text>
            </g>
          );
        })}

      {nodes.map((node) => {
        const point = positions[node.id] || { x: 450, y: 270 };
        const category = categoryFor(node);
        const selected = selectedId === node.id;
        const due = isDue(node);
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

function NodeDetail({ node, onClose, onUpdate, onDelete }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({
    label: node.label,
    category: node.category,
    desc: node.desc,
  });

  useEffect(() => {
    setEditing(false);
    setDraft({
      label: node.label,
      category: node.category,
      desc: node.desc,
    });
  }, [node]);

  function saveEdit() {
    const label = draft.label.trim();
    if (!label) return;
    onUpdate(node.id, {
      label,
      category: draft.category,
      desc: draft.desc.trim() || "暂未添加解释。",
    });
    setEditing(false);
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
          <span className="category-badge" style={{ color: category.color, background: category.light }}>
            {category.label}
          </span>
          <h3>{node.label}</h3>
          <p>{node.desc}</p>
          <div className="node-meta">
            <Stat label="EF" value={node.ef.toFixed(2)} />
            <Stat label="已复习" value={`${node.repetitions} 次`} />
            <Stat label="下次" value={daysUntil(node.nextReview)} />
          </div>
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
    </aside>
  );
}

function GraphView({ data, selectedId, onSelect, filters, onFiltersChange, onUpdateNode, onDeleteNode }) {
  const filtered = useMemo(() => {
    const needle = filters.query.trim().toLowerCase();
    const selectedCategories = new Set(filters.categories);
    const nodes = data.nodes.filter((node) => {
      const matchesQuery = !needle || `${node.label} ${node.desc}`.toLowerCase().includes(needle);
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
          <p>拖动节点调整位置，点击查看掌握度和复习计划。</p>
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
        <NodeDetail node={selectedNode} onClose={() => onSelect(null)} onUpdate={onUpdateNode} onDelete={onDeleteNode} />
      ) : null}
    </section>
  );
}

function ReviewCard({ card, onRate }) {
  const [flipped, setFlipped] = useState(false);
  const category = categoryFor(card);

  useEffect(() => {
    setFlipped(false);
  }, [card.id]);

  return (
    <div className="review-card-wrap">
      <button
        className={`review-card ${flipped ? "is-flipped" : ""}`}
        onClick={() => setFlipped((value) => !value)}
        style={{ "--accent": category.color, "--accent-light": category.light }}
      >
        <span>{category.label}</span>
        <strong>{card.label}</strong>
        <p>{flipped ? card.desc : "点击翻转查看解释"}</p>
      </button>
      {flipped ? (
        <div className="rating-row">
          {[
            { quality: 1, label: "忘了" },
            { quality: 2, label: "模糊" },
            { quality: 4, label: "基本会" },
            { quality: 5, label: "掌握" },
          ].map((item) => (
            <button key={item.quality} onClick={() => onRate(item.quality)}>
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ReviewView({ dueCards, reviewIndex, onRate }) {
  const current = dueCards[reviewIndex];

  return (
    <section className="surface review-view">
      <div className="section-header">
        <div>
          <h2>今日复习</h2>
          <p>按当前掌握程度评分，MindCode 会自动计算下次复习时间。</p>
        </div>
        <div className="review-count">{dueCards.length ? `${reviewIndex + 1} / ${dueCards.length}` : "0 / 0"}</div>
      </div>

      {current ? (
        <>
          <div className="progress-track">
            <div style={{ width: `${(reviewIndex / Math.max(dueCards.length, 1)) * 100}%` }} />
          </div>
          <ReviewCard card={current} onRate={onRate} />
        </>
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

function AddView({ data, onAdd }) {
  const [nameInput, setNameInput] = useState("");
  const [definitionInput, setDefinitionInput] = useState("");
  const [query, setQuery] = useState("");

  const visibleNodes = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return data.nodes;
    return data.nodes.filter((node) => `${node.label} ${node.desc}`.toLowerCase().includes(needle));
  }, [data.nodes, query]);

  function submit() {
    const added = onAdd({
      label: nameInput.trim(),
      desc: definitionInput.trim(),
    });
    if (added) {
      setNameInput("");
      setDefinitionInput("");
    }
  }

  return (
    <section className="surface add-view">
      <div className="section-header">
        <div>
          <h2>添加概念</h2>
          <p>填写概念名称和定义，创建一张新的复习卡片。</p>
        </div>
        <Database size={22} />
      </div>

      <div className="add-form">
        <label>
          <span>概念名称</span>
          <input
            value={nameInput}
            onChange={(event) => setNameInput(event.target.value)}
            placeholder="例如：Promise.all"
          />
        </label>
        <label>
          <span>概念定义</span>
          <textarea
            value={definitionInput}
            onChange={(event) => setDefinitionInput(event.target.value)}
            placeholder="例如：Promise.all 接受多个 Promise，所有任务完成后返回结果数组。async/await 可以让异步流程更易读。"
          />
        </label>
      </div>

      <div className="action-row">
        <button className="primary-button" onClick={submit}>
          <CirclePlus size={16} />
          添加概念
        </button>
      </div>

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
  const [reviewIndex, setReviewIndex] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);
  const skipSave = useRef(true);

  const dueCards = useMemo(() => data.nodes.filter((node) => isDue(node)), [data.nodes]);

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

  const handleRate = (quality) => {
    const card = dueCards[reviewIndex];
    if (!card) return;
    const updated = sm2(card, quality);
    setData((previous) => ({
      ...previous,
      nodes: previous.nodes.map((node) => (node.id === card.id ? { ...node, ...updated } : node)),
      updatedAt: Date.now(),
    }));

    if (reviewIndex + 1 < dueCards.length) {
      setReviewIndex((index) => index + 1);
    } else {
      setReviewIndex(0);
      setView("graph");
      showToast("今日复习完成");
    }
  };

  const handleAdd = ({ label, desc }) => {
    if (!label) {
      showToast("无法添加：请填写概念名称", "warning");
      return false;
    }

    const newNode = normalizeNode({ label, desc: desc || undefined }, `concept-${Date.now()}`);
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
                    setReviewIndex(0);
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
            <h2>{views.find((item) => item.id === view)?.label}</h2>
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
          />
        ) : null}
        {view === "review" ? <ReviewView dueCards={dueCards} reviewIndex={reviewIndex} onRate={handleRate} /> : null}
        {view === "add" ? <AddView data={data} onAdd={handleAdd} /> : null}
      </main>

      <Toast toast={toast} onClear={() => setToast(null)} />
    </div>
  );
}
