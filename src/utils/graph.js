export const graphViewport = { x: 0, y: 0, width: 2200, height: 1500 };
export const graphCenter = { x: graphViewport.width / 2, y: graphViewport.height / 2 };
export const graphNodePadding = 14;
export const curveSpring = 0.26;
export const curveDamping = 0.82;

export function naturalCurveTarget(from, to) {
  const deltaX = to.x - from.x;
  const deltaY = to.y - from.y;
  return {
    c1x: from.x + deltaX * 0.16,
    c1y: from.y + deltaY * 0.16,
    c2x: to.x - deltaX * 0.16,
    c2y: to.y - deltaY * 0.16,
  };
}

export function springForCurve(target) {
  return {
    ...target,
    v1x: 0,
    v1y: 0,
    v2x: 0,
    v2y: 0,
  };
}

export function graphLevelForNode(node) {
  return Math.max(0, Number(node?.graphLevel ?? 1));
}

export function nodeHeightForLevel(level = 1) {
  if (level <= 0) return 54;
  if (level === 1) return 44;
  if (level === 2) return 38;
  return 34;
}

export function nodeWidthForLabel(label, level = 1) {
  const textLength = String(label || "").length;
  if (level <= 0) return Math.min(280, Math.max(174, textLength * 10.5 + 54));
  if (level === 1) return Math.min(230, Math.max(128, textLength * 9.4 + 44));
  if (level === 2) return Math.min(190, Math.max(104, textLength * 8.4 + 34));
  return Math.min(170, Math.max(92, textLength * 7.8 + 28));
}

function pointOnNodeEdge(center, target, width, height, gap = 4) {
  const deltaX = target.x - center.x;
  const deltaY = target.y - center.y;
  const distance = Math.max(Math.hypot(deltaX, deltaY), 1);
  const halfWidth = width / 2;
  const halfHeight = height / 2;
  const scale = 1 / Math.max(Math.abs(deltaX) / halfWidth, Math.abs(deltaY) / halfHeight, 1);

  return {
    x: center.x + deltaX * scale + (deltaX / distance) * gap,
    y: center.y + deltaY * scale + (deltaY / distance) * gap,
  };
}

export function edgePoints(from, to, fromNode, toNode) {
  const deltaX = to.x - from.x;
  const deltaY = to.y - from.y;
  const distance = Math.max(Math.hypot(deltaX, deltaY), 1);
  const fromLevel = graphLevelForNode(fromNode);
  const toLevel = graphLevelForNode(toNode);

  return {
    distance,
    start: pointOnNodeEdge(from, to, nodeWidthForLabel(fromNode?.label, fromLevel), nodeHeightForLevel(fromLevel), fromLevel <= 0 ? 7 : 5),
    end: pointOnNodeEdge(to, from, nodeWidthForLabel(toNode?.label, toLevel), nodeHeightForLevel(toLevel), toLevel <= 0 ? 7 : 5),
  };
}

export function parentIdForNode(node, nodeIds) {
  const parentId = node?.graphParentId || node?.parentId || "";
  return parentId && nodeIds.has(parentId) && parentId !== node.id ? parentId : "";
}

export function hierarchyEdgesForNodes(nodes) {
  const nodeIds = new Set(nodes.map((node) => node.id));
  return nodes
    .map((node) => {
      const parentId = parentIdForNode(node, nodeIds);
      return parentId
        ? {
            id: `parent-${parentId}-${node.id}`,
            from: parentId,
            to: node.id,
            label: "包含",
            level: graphLevelForNode(node),
          }
        : null;
    })
    .filter(Boolean);
}

export function hierarchyForNodes(nodes) {
  const nodeIds = new Set(nodes.map((node) => node.id));
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const children = new Map(nodes.map((node) => [node.id, []]));
  const roots = [];

  nodes.forEach((node) => {
    const parentId = parentIdForNode(node, nodeIds);
    if (parentId && children.has(parentId)) children.get(parentId).push(node);
    else roots.push(node);
  });

  const sortedRoots = roots.length ? roots : nodes.slice(0, 1);
  const levels = new Map();
  const visited = new Set();

  function visit(node, level, trail = new Set()) {
    if (!node || trail.has(node.id)) return;
    visited.add(node.id);
    levels.set(node.id, level);
    const nextTrail = new Set(trail).add(node.id);
    (children.get(node.id) || []).forEach((child) => visit(child, level + 1, nextTrail));
  }

  sortedRoots.forEach((root) => visit(root, 0));
  nodes.forEach((node) => {
    if (!visited.has(node.id)) {
      roots.push(node);
      visit(node, 0);
    }
  });

  return { nodeIds, nodeById, children, roots: sortedRoots, levels };
}

export function mindMapVisibleNodes(nodes, expandedIds) {
  const hierarchy = hierarchyForNodes(nodes);
  const visible = [];
  const useVirtualRoot = hierarchy.roots.length > 1;
  const virtualRoot = useVirtualRoot
    ? {
        id: "mindcode-map-root",
        label: "MindCode",
        category: "core",
        desc: "知识图谱中心",
        cards: [],
        sources: [],
        graphVirtual: true,
      }
    : null;

  function visit(node, level, trail = new Set(), graphParentId = "") {
    if (!node || trail.has(node.id)) return;
    const children = hierarchy.children.get(node.id) || [];
    const isExpanded = level === 0 || expandedIds.has(node.id);
    visible.push({
      ...node,
      graphParentId,
      graphLevel: level,
      graphHasChildren: children.length > 0,
      graphExpanded: isExpanded,
      graphChildCount: children.length,
    });

    if (!isExpanded) return;
    const nextTrail = new Set(trail).add(node.id);
    children.forEach((child) => visit(child, level + 1, nextTrail, node.id));
  }

  if (virtualRoot) {
    visible.push({
      ...virtualRoot,
      graphLevel: 0,
      graphHasChildren: true,
      graphExpanded: true,
      graphChildCount: hierarchy.roots.length,
    });
    hierarchy.roots.forEach((root) => visit(root, 1, new Set([virtualRoot.id]), virtualRoot.id));
  } else {
    hierarchy.roots.forEach((root) => visit(root, 0));
  }

  return visible;
}

export function descendantIdsForNode(nodes, nodeId) {
  const { children } = hierarchyForNodes(nodes);
  const descendants = new Set();
  const queue = [...(children.get(nodeId) || [])];

  for (let index = 0; index < queue.length; index += 1) {
    const node = queue[index];
    if (descendants.has(node.id)) continue;
    descendants.add(node.id);
    queue.push(...(children.get(node.id) || []));
  }

  return descendants;
}

export function arrangeRowsByHierarchy(rows) {
  const rowById = new Map(rows.map((row) => [row.node.id, row]));
  const children = new Map();
  const roots = [];

  rows.forEach((row) => children.set(row.node.id, []));
  rows.forEach((row) => {
    const parentId = row.node.parentId || "";
    if (parentId && rowById.has(parentId)) children.get(parentId).push(row);
    else roots.push(row);
  });

  const arranged = [];
  const visit = (row, depth, trail = new Set()) => {
    if (trail.has(row.node.id)) return;
    arranged.push({ ...row, hierarchyDepth: Math.min(depth, 2) });
    const nextTrail = new Set(trail).add(row.node.id);
    (children.get(row.node.id) || []).forEach((child) => visit(child, depth + 1, nextTrail));
  };

  roots.forEach((row) => visit(row, 0));
  return arranged;
}

function clampGraphPosition(point, margin = 84) {
  return {
    x: Math.max(margin, Math.min(graphViewport.width - margin, point.x)),
    y: Math.max(margin, Math.min(graphViewport.height - margin, point.y)),
  };
}

export function distributeAround(items, origin, radius, startAngle = -Math.PI / 2, arc = Math.PI * 2) {
  if (!items.length) return {};
  const positions = {};
  const step = items.length === 1 ? 0 : arc / items.length;
  items.forEach((item, index) => {
    const angle = startAngle + step * index;
    positions[item.id] = clampGraphPosition({
      x: origin.x + Math.cos(angle) * radius,
      y: origin.y + Math.sin(angle) * radius,
    });
  });
  return positions;
}

export function resolveMindMapCollisions(positions, nodes) {
  const positionById = { ...positions };
  const nodeById = new Map(nodes.map((node) => [node.id, node]));

  for (let pass = 0; pass < 64; pass += 1) {
    for (let a = 0; a < nodes.length; a += 1) {
      for (let b = a + 1; b < nodes.length; b += 1) {
        const first = nodes[a];
        const second = nodes[b];
        const firstPoint = positionById[first.id];
        const secondPoint = positionById[second.id];
        if (!firstPoint || !secondPoint) continue;

        const firstLevel = graphLevelForNode(first);
        const secondLevel = graphLevelForNode(second);
        const minDistance =
          (nodeWidthForLabel(first.label, firstLevel) + nodeWidthForLabel(second.label, secondLevel)) / 2 +
          (firstLevel === 0 || secondLevel === 0 ? 48 : 34);
        const deltaX = secondPoint.x - firstPoint.x;
        const deltaY = secondPoint.y - firstPoint.y;
        const distance = Math.hypot(deltaX, deltaY) || 1;
        if (distance >= minDistance) continue;

        const push = (minDistance - distance) / 2;
        const pushX = (deltaX / distance) * push;
        const pushY = (deltaY / distance) * push;
        const firstPinned = graphLevelForNode(nodeById.get(first.id)) === 0;
        const secondPinned = graphLevelForNode(nodeById.get(second.id)) === 0;

        if (!firstPinned) {
          positionById[first.id] = clampGraphPosition({ x: firstPoint.x - pushX, y: firstPoint.y - pushY });
        }
        if (!secondPinned) {
          positionById[second.id] = clampGraphPosition({ x: secondPoint.x + pushX, y: secondPoint.y + pushY });
        }
      }
    }
  }

  return positionById;
}

export function mindMapHierarchyPositions(nodes) {
  const { children, roots } = hierarchyForNodes(nodes);
  const positions = {};

  if (roots.length === 1) {
    positions[roots[0].id] = { ...graphCenter };
  } else {
    Object.assign(positions, distributeAround(roots, graphCenter, Math.min(220, 132 + roots.length * 14), -Math.PI / 2, Math.PI * 2));
  }

  function layoutChildren(parent, parentAngle, level) {
    const childNodes = children.get(parent.id) || [];
    if (!childNodes.length || !positions[parent.id]) return;

    if (level === 1) {
      const radius = 250 + Math.max(0, childNodes.length - 8) * 12;
      Object.assign(positions, distributeAround(childNodes, positions[parent.id], radius, -Math.PI / 2, Math.PI * 2));
      childNodes.forEach((child) => {
        const childPoint = positions[child.id];
        const angle = Math.atan2(childPoint.y - positions[parent.id].y, childPoint.x - positions[parent.id].x);
        layoutChildren(child, angle, level + 1);
      });
      return;
    }

    const radius = (level === 2 ? 250 : 196) + Math.max(0, childNodes.length - 4) * (level === 2 ? 18 : 18);
    const spread = Math.min(Math.PI * 0.92, Math.max(0.52, childNodes.length * 0.36));
    const step = childNodes.length === 1 ? 0 : spread / (childNodes.length - 1);
    const startAngle = parentAngle - spread / 2;

    childNodes.forEach((child, index) => {
      const angle = childNodes.length === 1 ? parentAngle : startAngle + step * index;
      const parentPoint = positions[parent.id];
      positions[child.id] = clampGraphPosition({
        x: parentPoint.x + Math.cos(angle) * (radius + (level > 2 ? (index % 2) * 18 : 0)),
        y: parentPoint.y + Math.sin(angle) * (radius + (level > 2 ? (index % 2) * 18 : 0)),
      });
      layoutChildren(child, angle, level + 1);
    });
  }

  roots.forEach((root) => layoutChildren(root, 0, 1));

  nodes.forEach((node, index) => {
    if (positions[node.id]) return;
    const fallback = distributeAround([node], graphCenter, 380 + (index % 3) * 56, -Math.PI / 2 + index * 0.7);
    positions[node.id] = fallback[node.id];
  });

  return resolveMindMapCollisions(positions, nodes);
}
