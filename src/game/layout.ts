import { cellToWorld, roomCenterWorld, type GameMap, type Room } from './mapgen';
import { mulberry32 } from './rng';
import { distance } from './vec';
import type { HunterId, ItemId, LevelSpec, ObjectiveSpec, Vec2 } from './types';

export interface PlacedObjective {
  spec: ObjectiveSpec;
  pos: Vec2;
  roomId: number;
}

export interface WorldItem {
  id: string;
  item: ItemId;
  pos: Vec2;
  roomId: number;
  taken: boolean;
}

export interface LevelLayout {
  startPos: Vec2;
  objectives: PlacedObjective[];
  items: WorldItem[];
  hunterSpawns: Record<HunterId, Vec2>;
  traps: Vec2[];
  exitId: string;
}

function pointInRoom(rng: () => number, room: Room): Vec2 {
  const x = room.x + Math.floor(rng() * room.w);
  const y = room.y + Math.floor(rng() * room.h);
  return cellToWorld(x, y);
}

/**
 * Spreads the level's interactables and pickups across the asylum, farthest
 * rooms first, so the player must cross the level for every objective.
 * `daySeed` changes on every catch, which is what shuffles the items.
 */
export function layoutLevel(level: LevelSpec, map: GameMap, daySeed: number): LevelLayout {
  const rng = mulberry32(daySeed);
  const start = map.start;
  const candidates = map.rooms.filter((room) => room.id !== map.rooms[0].id);
  const pool = (candidates.length ? candidates : map.rooms.slice()).sort(
    (a, b) => distance(roomCenterWorld(b), start) - distance(roomCenterWorld(a), start),
  );

  let cursor = 0;
  const nextRoom = (): Room => pool[cursor++ % pool.length];

  const exitSpec = level.objectives.find((objective) => objective.kind === 'exit');
  if (!exitSpec) throw new Error(`Level ${level.index} has no exit objective`);

  const exitRoom = nextRoom();
  const objectives: PlacedObjective[] = [
    { spec: exitSpec, pos: roomCenterWorld(exitRoom), roomId: exitRoom.id },
  ];

  for (const spec of level.objectives) {
    if (spec.id === exitSpec.id) continue;
    const room = nextRoom();
    // Fixtures are anchored to room centres so they never move on a reshuffle.
    objectives.push({ spec, pos: roomCenterWorld(room), roomId: room.id });
  }

  const items: WorldItem[] = level.items.map((item, index) => {
    let room = pool[Math.floor(rng() * pool.length)] ?? map.rooms[0];
    let guard = 0;
    while (guard < 12 && distance(roomCenterWorld(room), start) < 9) {
      room = pool[Math.floor(rng() * pool.length)] ?? map.rooms[0];
      guard += 1;
    }
    return {
      id: `${level.index}-${item}-${index}`,
      item,
      pos: pointInRoom(rng, room),
      roomId: room.id,
      taken: false,
    };
  });

  const middle = (fraction: number): Vec2 => {
    const room = pool[Math.min(pool.length - 1, Math.floor(pool.length * fraction))] ?? map.rooms[0];
    return roomCenterWorld(room);
  };

  const traps: Vec2[] = [];
  for (let i = 0; i < level.hiddenTraps; i += 1) {
    const room = pool[Math.floor(rng() * pool.length)] ?? map.rooms[0];
    const point = pointInRoom(rng, room);
    if (distance(point, start) > 8) traps.push(point);
  }

  return {
    startPos: start,
    objectives,
    items,
    hunterSpawns: { granny: middle(0.35), mundiya: middle(0.75) },
    traps,
    exitId: exitSpec.id,
  };
}
