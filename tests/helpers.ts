import { CELL, cellToWorld, isWall, type GameMap } from '../src/game/mapgen';
import { hasLineOfSight } from '../src/game/nav';
import { distance } from '../src/game/vec';
import type { Vec2 } from '../src/game/types';

/** Two open cells far enough apart that a wall blocks the straight line. */
export function findBlockedPair(map: GameMap, minD = 6, maxD = 12): { a: Vec2; b: Vec2 } {
  const open: Vec2[] = [];
  for (let y = 1; y < map.height - 1; y += 1) {
    for (let x = 1; x < map.width - 1; x += 1) {
      if (!isWall(map, x, y)) open.push(cellToWorld(x, y));
    }
  }
  for (const a of open) {
    for (const b of open) {
      const d = distance(a, b);
      if (d < minD || d > maxD) continue;
      if (!hasLineOfSight(map, a, b)) return { a, b };
    }
  }
  throw new Error('no wall-blocked cell pair found');
}

export function firstOpenCell(map: GameMap): Vec2 {
  for (let y = 1; y < map.height - 1; y += 1) {
    for (let x = 1; x < map.width - 1; x += 1) {
      if (!isWall(map, x, y)) return cellToWorld(x, y);
    }
  }
  throw new Error('map has no open cell');
}

export { CELL };
