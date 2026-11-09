import { CELL, cellToWorld, isWall, worldToCell, type GameMap } from './mapgen';
import type { Vec2 } from './types';

const NEIGHBOURS: [number, number][] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

/** Sampled grid ray: cheap and accurate enough for 3-unit cells. */
export function hasLineOfSight(map: GameMap, a: Vec2, b: Vec2): boolean {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dist = Math.hypot(dx, dy);
  const steps = Math.max(1, Math.ceil(dist / (CELL * 0.4)));
  for (let i = 1; i < steps; i += 1) {
    const t = i / steps;
    const cell = worldToCell({ x: a.x + dx * t, y: a.y + dy * t });
    if (isWall(map, cell.x, cell.y)) return false;
  }
  return true;
}

function nearestWalkable(map: GameMap, cell: Vec2): Vec2 | null {
  if (!isWall(map, cell.x, cell.y)) return cell;
  for (let radius = 1; radius <= 4; radius += 1) {
    for (let dy = -radius; dy <= radius; dy += 1) {
      for (let dx = -radius; dx <= radius; dx += 1) {
        if (!isWall(map, cell.x + dx, cell.y + dy)) return { x: cell.x + dx, y: cell.y + dy };
      }
    }
  }
  return null;
}

function smoothPath(map: GameMap, from: Vec2, points: Vec2[]): Vec2[] {
  const out: Vec2[] = [];
  let anchor = from;
  let i = 0;
  while (i < points.length) {
    let j = i;
    while (j + 1 < points.length && hasLineOfSight(map, anchor, points[j + 1])) j += 1;
    out.push(points[j]);
    anchor = points[j];
    i = j + 1;
  }
  return out;
}

/** Breadth-first grid path converted to smoothed world-space waypoints. */
export function findPath(map: GameMap, from: Vec2, to: Vec2): Vec2[] {
  const startCell = worldToCell(from);
  if (isWall(map, startCell.x, startCell.y)) return [];
  const goalCell = nearestWalkable(map, worldToCell(to));
  if (!goalCell) return [];

  const w = map.width;
  const h = map.height;
  const total = w * h;
  const prev = new Int32Array(total).fill(-1);
  const seen = new Uint8Array(total);
  const queue = new Int32Array(total);
  let head = 0;
  let tail = 0;

  const startIndex = startCell.y * w + startCell.x;
  const goalIndex = goalCell.y * w + goalCell.x;
  seen[startIndex] = 1;
  queue[tail++] = startIndex;

  while (head < tail) {
    const current = queue[head++];
    if (current === goalIndex) break;
    const cx = current % w;
    const cy = (current - cx) / w;
    for (const [dx, dy] of NEIGHBOURS) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (isWall(map, nx, ny)) continue;
      const index = ny * w + nx;
      if (seen[index]) continue;
      seen[index] = 1;
      prev[index] = current;
      queue[tail++] = index;
    }
  }

  if (!seen[goalIndex]) return [];

  const cells: number[] = [];
  let node = goalIndex;
  while (node !== -1) {
    cells.push(node);
    if (node === startIndex) break;
    node = prev[node];
  }
  cells.reverse();

  const points = cells.map((index) => {
    const x = index % w;
    const y = (index - x) / w;
    return cellToWorld(x, y);
  });
  if (points.length) points.shift();
  return smoothPath(map, from, points);
}

export function canStandAt(map: GameMap, p: Vec2, radius: number): boolean {
  const offsets: [number, number][] = [
    [-radius, -radius],
    [radius, -radius],
    [-radius, radius],
    [radius, radius],
  ];
  for (const [ox, oy] of offsets) {
    const cell = worldToCell({ x: p.x + ox, y: p.y + oy });
    if (isWall(map, cell.x, cell.y)) return false;
  }
  return true;
}

/** Axis-separated sliding collision, so the player brushes along walls. */
export function moveWithCollision(map: GameMap, pos: Vec2, delta: Vec2, radius: number): Vec2 {
  let nx = pos.x;
  let ny = pos.y;
  if (delta.x !== 0 && canStandAt(map, { x: pos.x + delta.x, y: pos.y }, radius)) nx = pos.x + delta.x;
  if (delta.y !== 0 && canStandAt(map, { x: nx, y: pos.y + delta.y }, radius)) ny = pos.y + delta.y;
  return { x: nx, y: ny };
}

/** Flood fill used by tests and by the level validator. */
export function reachableCells(map: GameMap, from: Vec2): Set<number> {
  const startCell = worldToCell(from);
  const w = map.width;
  const seen = new Set<number>();
  if (isWall(map, startCell.x, startCell.y)) return seen;
  const stack = [startCell.y * w + startCell.x];
  seen.add(stack[0]);
  while (stack.length) {
    const current = stack.pop()!;
    const cx = current % w;
    const cy = (current - cx) / w;
    for (const [dx, dy] of NEIGHBOURS) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (isWall(map, nx, ny)) continue;
      const index = ny * w + nx;
      if (seen.has(index)) continue;
      seen.add(index);
      stack.push(index);
    }
  }
  return seen;
}
