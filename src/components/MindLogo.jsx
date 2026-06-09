import React from "react";

const staggerSeconds = 0.16;
const drawSeconds = 0.26;
const popSeconds = 0.46;

const compactNodes = [
  { id: "hub", x: 30, y: 60, depth: 0 },
  { id: "a", x: 86, y: 32, depth: 1, parent: "hub" },
  { id: "b", x: 86, y: 88, depth: 1, parent: "hub" },
];

const wideNodes = [
  { id: "hub", x: 30, y: 60, depth: 0 },
  { id: "a", x: 84, y: 32, depth: 1, parent: "hub" },
  { id: "b", x: 84, y: 88, depth: 1, parent: "hub" },
];

const childPositions = {
  a: [
    { x: 134, y: 16, label: "async / await" },
    { x: 140, y: 46, label: "Promise" },
  ],
  b: [
    { x: 140, y: 74, label: "Event Loop" },
    { x: 134, y: 104, label: "Closure" },
  ],
};

const radiusByDepth = { 0: 9, 1: 6, 2: 4 };

export function MindLogo({
  size = 200,
  variant = "mark",
  expandable = false,
  replayOnHover = true,
  autoplay = false,
  inverse = false,
  surface,
  labels,
  style,
  ...rest
}) {
  const [generation, setGeneration] = React.useState(0);
  const [playing, setPlaying] = React.useState(false);
  const [extraNodes, setExtraNodes] = React.useState([]);
  const [expanded, setExpanded] = React.useState({});

  const baseNodes = expandable ? wideNodes : compactNodes;
  const nodes = [...baseNodes, ...extraNodes];
  const nodesById = Object.fromEntries(nodes.map((node) => [node.id, node]));
  const viewBoxWidth = extraNodes.length ? 240 : 120;
  const viewBoxHeight = 120;
  const pixelScale = size / 120;

  const replay = React.useCallback(() => {
    setGeneration((current) => current + 1);
    setPlaying(true);
  }, []);

  React.useEffect(() => {
    if (!playing) return undefined;
    const duration = (baseNodes.length * staggerSeconds + drawSeconds + popSeconds + 0.25) * 1000;
    const timer = setTimeout(() => setPlaying(false), duration);
    return () => clearTimeout(timer);
  }, [baseNodes.length, generation, playing]);

  React.useEffect(() => {
    if (autoplay) replay();
  }, [autoplay, replay]);

  function expandNode(node) {
    if (!expandable || node.depth !== 1 || expanded[node.id]) return;
    const additions = (childPositions[node.id] || []).map((position, index) => {
      const slotBase = node.id === "a" ? 0 : 2;
      return {
        id: `${node.id}-c${index}`,
        x: position.x,
        y: position.y,
        label: labels?.[slotBase + index] || position.label,
        depth: 2,
        parent: node.id,
        born: true,
        delay: 0.04 + index * staggerSeconds,
      };
    });

    setExpanded((current) => ({ ...current, [node.id]: true }));
    setExtraNodes((current) => [...current, ...additions]);

    const ids = new Set(additions.map((addition) => addition.id));
    const settleMs = (Math.max(...additions.map((addition) => addition.delay)) + drawSeconds + popSeconds + 0.2) * 1000;
    setTimeout(() => {
      setExtraNodes((current) => current.map((child) => (ids.has(child.id) ? { ...child, born: false } : child)));
    }, settleMs);
  }

  function delayFor(node) {
    if (node.born) return node.delay;
    const index = baseNodes.findIndex((item) => item.id === node.id);
    return Math.max(0, index) * staggerSeconds;
  }

  const ink = inverse ? "#ffffff" : "var(--mc-ink, #111110)";
  const hollow = surface || (inverse ? "var(--mc-brand-bg, #25233a)" : "var(--mc-surface, #ffffff)");
  const markHeight = viewBoxHeight * pixelScale;

  return (
    <div
      className="mind-logo"
      onMouseEnter={() => replayOnHover && replay()}
      style={{ display: "inline-flex", alignItems: "center", gap: size * 0.16, lineHeight: 1, ...style }}
      {...rest}
    >
      <style>{mindLogoCss}</style>
      <svg
        viewBox={`0 0 ${viewBoxWidth} ${viewBoxHeight}`}
        width={viewBoxWidth * pixelScale}
        height={markHeight}
        style={{ overflow: "visible", display: "block", color: ink }}
        aria-label="MindCode"
        role="img"
      >
        <g key={generation}>
          {nodes.map((node) => {
            if (!node.parent) return null;
            const parent = nodesById[node.parent];
            if (!parent) return null;
            const length = Math.hypot(node.x - parent.x, node.y - parent.y);
            const animate = node.born || playing;
            const delay = delayFor(node);
            return (
              <line
                key={`edge-${node.id}`}
                x1={parent.x}
                y1={parent.y}
                x2={node.x}
                y2={node.y}
                className={`mind-logo-edge${animate ? " is-growing" : ""}`}
                stroke="currentColor"
                strokeOpacity={node.depth === 2 ? 0.34 : 0.6}
                strokeWidth={node.depth === 2 ? 1.2 : 1.7}
                strokeLinecap="round"
                style={{ "--line-length": length, strokeDasharray: length, animationDelay: `${delay}s` }}
              />
            );
          })}

          {nodes.map((node) => {
            const animate = node.born || playing;
            const delay = delayFor(node);
            const radius = radiusByDepth[node.depth] || radiusByDepth[1];
            const canExpand = expandable && node.depth === 1 && !expanded[node.id];
            const fill = node.depth === 0 || node.depth === 2 ? "currentColor" : hollow;
            const popDelay = node.depth === 0 ? delay : delay + drawSeconds * 0.6;
            return (
              <g
                key={`node-${node.id}`}
                className={`mind-logo-node${animate ? " is-growing" : ""}${canExpand ? " can-expand" : ""}`}
                style={{ animationDelay: `${popDelay}s`, cursor: canExpand ? "pointer" : "default" }}
                onClick={canExpand ? () => expandNode(node) : undefined}
              >
                {canExpand ? (
                  <circle
                    className="mind-logo-hint"
                    cx={node.x}
                    cy={node.y}
                    r={radius + 5}
                    fill="none"
                    stroke="currentColor"
                    strokeOpacity="0.4"
                    strokeWidth="1"
                    strokeDasharray="2 3"
                  />
                ) : null}
                <circle
                  className="mind-logo-dot"
                  cx={node.x}
                  cy={node.y}
                  r={radius}
                  fill={fill}
                  fillOpacity={node.depth === 2 ? 0.34 : 1}
                  stroke={node.depth === 1 ? "currentColor" : "none"}
                  strokeWidth={node.depth === 1 ? 1.7 : 0}
                />
                {node.label ? (
                  <text
                    className={`mind-logo-label${animate ? " is-growing" : ""}`}
                    x={node.x + radius + 5}
                    y={node.y + 3.4}
                    fill="currentColor"
                    fillOpacity="0.62"
                    style={{
                      fontFamily: "var(--mc-font-mono, monospace)",
                      fontSize: 9,
                      fontWeight: 600,
                      letterSpacing: 0,
                      animationDelay: `${popDelay + 0.08}s`,
                    }}
                  >
                    {node.label}
                  </text>
                ) : null}
              </g>
            );
          })}
        </g>
      </svg>
      {variant === "lockup" ? (
        <span
          key={`word-${generation}`}
          className={`mind-logo-word${playing ? " is-growing" : ""}`}
          style={{
            fontFamily: "var(--mc-font-sans, Inter, sans-serif)",
            fontSize: size * 0.34,
            fontWeight: 800,
            letterSpacing: 0,
            color: ink,
            animationDelay: `${baseNodes.length * staggerSeconds * 0.7}s`,
          }}
        >
          MindCode
        </span>
      ) : null}
    </div>
  );
}

const mindLogoCss = `
.mind-logo-edge.is-growing { animation: mind-logo-draw ${drawSeconds}s var(--mc-ease-out, cubic-bezier(.23,1,.32,1)) both; }
.mind-logo-node { transform-box: fill-box; transform-origin: center; }
.mind-logo-node.is-growing { animation: mind-logo-pop ${popSeconds}s var(--mc-ease-spring, cubic-bezier(.68,-.55,.265,1.55)) both; }
.mind-logo-dot { transition: transform .18s var(--mc-ease-out, ease); transform-box: fill-box; transform-origin: center; }
.mind-logo-hint { opacity: 0; transition: opacity .2s ease; }
.mind-logo-node.can-expand:hover .mind-logo-hint { opacity: 1; }
.mind-logo-node.can-expand:hover .mind-logo-dot { transform: scale(1.16); }
.mind-logo-word { display: inline-block; white-space: nowrap; }
.mind-logo-word.is-growing { animation: mind-logo-word .5s var(--mc-ease-out, ease) both; }
.mind-logo-label.is-growing { animation: mind-logo-fade .4s var(--mc-ease-out, ease) both; }
@keyframes mind-logo-draw { from { stroke-dashoffset: var(--line-length); } to { stroke-dashoffset: 0; } }
@keyframes mind-logo-pop { 0% { transform: scale(0); opacity: 0; } 70% { opacity: 1; } 100% { transform: scale(1); opacity: 1; } }
@keyframes mind-logo-word { from { opacity: 0; transform: translateX(-8px); } to { opacity: 1; transform: translateX(0); } }
@keyframes mind-logo-fade { from { opacity: 0; } to { opacity: 0.62; } }
@media (prefers-reduced-motion: reduce) {
  .mind-logo-edge.is-growing,
  .mind-logo-node.is-growing,
  .mind-logo-word.is-growing,
  .mind-logo-label.is-growing { animation-duration: .001s !important; animation-delay: 0s !important; }
}
`;
