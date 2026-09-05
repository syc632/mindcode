import { useRef, useState } from "react";
import { AnimatePresence, motion, useMotionValue, useSpring, useTransform } from "motion/react";
import { CirclePlus, GitBranch, LibraryBig, RotateCcw } from "lucide-react";

export function DockNavItem({ item, isActive, mouseX, onClick }) {
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

export function NavDock({ view, setView, reviewCount }) {
  const mouseX = useMotionValue(Infinity);

  const items = [
    { id: "graph",   label: "Map",     icon: GitBranch },
    { id: "library", label: "Library", icon: LibraryBig },
    { id: "review",  label: "Review",  icon: RotateCcw,  badge: reviewCount || null },
    { id: "add",     label: "Add",     icon: CirclePlus },
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
