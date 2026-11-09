import { mulberry32, randInt } from './rng';
import type { Vec2 } from './types';

export const CELL = 3;
export const MAP_W = 41;
export const MAP_H = 41;
export const WALL_HEIGHT = 3.7;

export interface Room {
  id: number;
  x: number;
  y: number;
  w: number;
  h: number;
  cx: number;
  cy: number;
}

export interface GameMap {
  width: number;
  height: number;
  walls: Uint8Array;
  rooms: Room[];
  start: Vec2;
  /** Cell indices of floorboards that creak under careless feet. */
  creaky: Set<number>;
  seed: number;
}

export function cellIndex(map: { width: number }, x: number, y: number): number {
  return y * map.width + x;
}

export function isWall(map: GameMap, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= map.width || y >= map.height) return true;
  return map.walls[y * map.width + x] === 1;
}

export function cellToWorld(x: number, y: number): Vec2 {
  return { x: (x + 0.5) * CELL, y: (y + 0.5) * CELL };
}

export function worldToCell(p: Vec2): Vec2 {
  return { x: Math.floor(p.x / CELL), y: Math.floor(p.y / CELL) };
}

export function isWalkableWorld(map: GameMap, p: Vec2): boolean {
  const c = worldToCell(p);
  return !isWall(map, c.x, c.y);
}

export function roomCenterWorld(room: Room): Vec2 {
  return cellToWorld(room.cx, room.cy);
}

/**
 * Carves a room-and-corridor asylum floor plan. Every room is reachable from
 * the entrance because corridors are carved between consecutive rooms.
 */
export function generateMap(seed: number, roomCount: number, creakChance = 0.05): GameMap {
  const rng = mulberry32(seed);
  const width = MAP_W;
  const height = MAP_H;
  const walls = new Uint8Array(width * height).fill(1);

  const carve = (x: number, y: number) => {
    if (x <= 0 || y <= 0 || x >= width - 1 || y >= height - 1) return;
    walls[y * width + x] = 0;
  };

  const rooms: Room[] = [];
  const target = Math.max(6, roomCount);
  let attempts = 0;

  while (rooms.length < target && attempts < 900) {
    attempts += 1;
    const w = randInt(rng, 4, 8);
    const h = randInt(rng, 4, 8);
    const x = randInt(rng, 2, width - w - 3);
    const y = randInt(rng, 2, height - h - 3);
    const overlaps = rooms.some(
      (r) => x <= r.x + r.w + 1 && x + w + 1 >= r.x && y <= r.y + r.h + 1 && y + h + 1 >= r.y,
    );
    if (overlaps) continue;

    const room: Room = {
      id: rooms.length,
      x,
      y,
      w,
      h,
      cx: Math.floor(x + w / 2),
      cy: Math.floor(y + h / 2),
    };
    rooms.push(room);
    for (let yy = y; yy < y + h; yy += 1) {
      for (let xx = x; xx < x + w; xx += 1) carve(xx, yy);
    }
  }

  const carveH = (x1: number, x2: number, y: number) => {
    for (let x = Math.min(x1, x2); x <= Math.max(x1, x2); x += 1) carve(x, y);
  };
  const carveV = (y1: number, y2: number, x: number) => {
    for (let y = Math.min(y1, y2); y <= Math.max(y1, y2); y += 1) carve(x, y);
  };

  for (let i = 1; i < rooms.length; i += 1) {
    const a = rooms[i - 1];
    const b = rooms[i];
    carveH(a.cx, b.cx, a.cy);
    carveV(a.cy, b.cy, b.cx);
  }

  // A couple of loops so the player can break line of sight and escape a chase.
  for (let i = 0; i + 3 < rooms.length; i += 3) {
    const a = rooms[i];
    const b = rooms[i + 3];
    carveH(a.cx, b.cx, b.cy);
    carveV(a.cy, b.cy, a.cx);
  }

  const startRoom = rooms[0];
  const start = roomCenterWorld(startRoom);

  const creaky = new Set<number>();
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      if (walls[y * width + x] === 1) continue;
      const inStartRoom =
        x >= startRoom.x && x < startRoom.x + startRoom.w && y >= startRoom.y && y < startRoom.y + startRoom.h;
      if (inStartRoom) continue;
      if (rng() < creakChance) creaky.add(y * width + x);
    }
  }

  return { width, height, walls, rooms, start, creaky, seed };
}

/** Every walkable cell, useful for spawns and tests. */
export function walkableCells(map: GameMap): Vec2[] {
  const cells: Vec2[] = [];
  for (let y = 1; y < map.height - 1; y += 1) {
    for (let x = 1; x < map.width - 1; x += 1) {
      if (!isWall(map, x, y)) cells.push({ x, y });
    }
  }
  return cells;
}

export function roomCells(room: Room): Vec2[] {
  const cells: Vec2[] = [];
  for (let y = room.y; y < room.y + room.h; y += 1) {
    for (let x = room.x; x < room.x + room.w; x += 1) cells.push({ x, y });
  }
  return cells;
}
