import { useEffect, useMemo, useRef, useCallback } from 'react';
import { useGesture } from '@use-gesture/react';
import { categories } from './shared/seedData.js';
import './ReviewDome.css';

const clamp = (v, min, max) => Math.min(Math.max(v, min), max);
const wrapAngleSigned = (deg) => {
  const a = (((deg + 180) % 360) + 360) % 360;
  return a - 180;
};

const TILE_COLORS = [
  '#1e1e1c', '#232320', '#282825', '#1a1a18', '#201f1d',
  '#252522', '#1c1c1a', '#2a2927', '#1f1f1d', '#242321',
];

function buildCardItems(cards, seg) {
  const xCols = Array.from({ length: seg }, (_, i) => -37 + i * 2);
  const evenYs = [-4, -2, 0, 2, 4];
  const oddYs  = [-3, -1, 1,  3, 5];

  const coords = xCols.flatMap((x, c) => {
    const ys = c % 2 === 0 ? evenYs : oddYs;
    return ys.map(y => ({ x, y, sizeX: 2, sizeY: 2 }));
  });

  return coords.map((c, i) => ({
    ...c,
    card: i < cards.length ? cards[i] : null,
    cardIndex: i,
  }));
}

export default function ReviewDome({
  cards = [],
  onSelect,
  selectedCard = null,
  fit = 0.82,
  minRadius = 560,
  segments = 34,
  dragDampening = 2,
  maxVerticalRotationDeg = 18,
  blurColor = '#f8f8f7',
}) {
  const rootRef   = useRef(null);
  const mainRef   = useRef(null);
  const sphereRef = useRef(null);

  const rotationRef   = useRef({ x: 0, y: 0 });
  const startRotRef   = useRef({ x: 0, y: 0 });
  const startPosRef   = useRef(null);
  const draggingRef   = useRef(false);
  const movedRef      = useRef(false);
  const inertiaRAF    = useRef(null);
  const lastDragEndAt = useRef(0);
  const dragSensitivity = 20;

  const items = useMemo(() => buildCardItems(cards, segments), [cards, segments]);

  const applyTransform = useCallback((xDeg, yDeg) => {
    const el = sphereRef.current;
    if (el) el.style.transform =
      `translateZ(calc(var(--dg-radius) * -1)) rotateX(${xDeg}deg) rotateY(${yDeg}deg)`;
  }, []);

  // 响应容器尺寸，更新 CSS 变量
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const ro = new ResizeObserver(entries => {
      const { width: w, height: h } = entries[0].contentRect;
      const basis = Math.min(w, h);
      const radius = Math.round(clamp(basis * fit, minRadius, Infinity));
      root.style.setProperty('--dg-radius', `${radius}px`);
      applyTransform(rotationRef.current.x, rotationRef.current.y);
    });
    ro.observe(root);
    return () => ro.disconnect();
  }, [fit, minRadius, applyTransform]);

  useEffect(() => { applyTransform(0, 0); }, [applyTransform]);

  const stopInertia = useCallback(() => {
    if (inertiaRAF.current) { cancelAnimationFrame(inertiaRAF.current); inertiaRAF.current = null; }
  }, []);

  const startInertia = useCallback((vx, vy) => {
    const MAX_V = 1.4;
    let vX = clamp(vx, -MAX_V, MAX_V) * 80;
    let vY = clamp(vy, -MAX_V, MAX_V) * 80;
    const d = clamp(dragDampening, 0, 1);
    const friction = 0.94 + 0.055 * d;
    const stop     = 0.015 - 0.01 * d;
    const maxF     = Math.round(90 + 270 * d);
    let frames = 0;
    const step = () => {
      vX *= friction; vY *= friction;
      if ((Math.abs(vX) < stop && Math.abs(vY) < stop) || ++frames > maxF) {
        inertiaRAF.current = null; return;
      }
      const nx = clamp(rotationRef.current.x - vY / 200, -maxVerticalRotationDeg, maxVerticalRotationDeg);
      const ny = wrapAngleSigned(rotationRef.current.y + vX / 200);
      rotationRef.current = { x: nx, y: ny };
      applyTransform(nx, ny);
      inertiaRAF.current = requestAnimationFrame(step);
    };
    stopInertia();
    inertiaRAF.current = requestAnimationFrame(step);
  }, [dragDampening, maxVerticalRotationDeg, stopInertia, applyTransform]);

  useGesture(
    {
      onDragStart: ({ event }) => {
        stopInertia();
        draggingRef.current = true;
        movedRef.current    = false;
        startRotRef.current = { ...rotationRef.current };
        startPosRef.current = { x: event.clientX, y: event.clientY };
      },
      onDrag: ({ event, last, velocity = [0, 0], direction = [0, 0], movement }) => {
        if (!draggingRef.current || !startPosRef.current) return;
        const dx = event.clientX - startPosRef.current.x;
        const dy = event.clientY - startPosRef.current.y;
        if (!movedRef.current && dx * dx + dy * dy > 16) movedRef.current = true;

        const nx = clamp(startRotRef.current.x - dy / dragSensitivity, -maxVerticalRotationDeg, maxVerticalRotationDeg);
        const ny = wrapAngleSigned(startRotRef.current.y + dx / dragSensitivity);
        if (rotationRef.current.x !== nx || rotationRef.current.y !== ny) {
          rotationRef.current = { x: nx, y: ny };
          applyTransform(nx, ny);
        }
        if (last) {
          draggingRef.current = false;
          let [vmx, vmy] = velocity;
          const [dx2, dy2] = direction;
          let vx = vmx * dx2, vy = vmy * dy2;
          if (Math.abs(vx) < 0.001 && Math.abs(vy) < 0.001 && Array.isArray(movement)) {
            vx = clamp((movement[0] / dragSensitivity) * 0.02, -1.2, 1.2);
            vy = clamp((movement[1] / dragSensitivity) * 0.02, -1.2, 1.2);
          }
          if (Math.abs(vx) > 0.005 || Math.abs(vy) > 0.005) startInertia(vx, vy);
          if (movedRef.current) lastDragEndAt.current = performance.now();
          movedRef.current = false;
        }
      },
    },
    { target: mainRef, eventOptions: { passive: true } }
  );

  const onTileClick = useCallback(e => {
    if (movedRef.current) return;
    if (performance.now() - lastDragEndAt.current < 80) return;
    const idx = parseInt(e.currentTarget.dataset.cardIndex, 10);
    if (!isNaN(idx) && cards[idx]) onSelect?.(cards[idx]);
  }, [cards, onSelect]);

  return (
    <div
      ref={rootRef}
      className="dg-root"
      style={{
        '--dg-segments-x': segments,
        '--dg-segments-y': segments,
        '--dg-blur-color': blurColor,
      }}
    >
      <main ref={mainRef} className="dg-main">
        <div className="dg-stage">
          <div ref={sphereRef} className="dg-sphere">
            {items.map((it, i) => {
              const isSelected = selectedCard && it.card && it.card.id === selectedCard.id && it.card.nodeId === selectedCard.nodeId;
              const cat = it.card ? (categories[it.card.category] || categories.new) : null;
              return (
                <div
                  key={`${it.x},${it.y},${i}`}
                  className="dg-item"
                  style={{
                    '--dg-offset-x':    it.x,
                    '--dg-offset-y':    it.y,
                    '--dg-item-size-x': it.sizeX,
                    '--dg-item-size-y': it.sizeY,
                  }}
                >
                  <div
                    className={`dg-tile${it.card ? ' dg-tile--card' : ''}${isSelected ? ' dg-tile--selected' : ''}`}
                    role={it.card ? 'button' : undefined}
                    tabIndex={it.card ? 0 : -1}
                    data-card-index={it.cardIndex}
                    onClick={it.card ? onTileClick : undefined}
                    style={it.card ? { background: TILE_COLORS[it.cardIndex % TILE_COLORS.length] } : undefined}
                  >
                    {it.card && (
                      <>
                        <span className="dg-tile-cat" style={{ color: cat?.color }}>
                          {cat?.label ?? ''}
                        </span>
                        <strong className="dg-tile-label">{it.card.nodeLabel}</strong>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="dg-overlay" />
        <div className="dg-overlay dg-overlay--blur" />
        <div className="dg-edge dg-edge--top" />
        <div className="dg-edge dg-edge--bottom" />
      </main>
    </div>
  );
}
