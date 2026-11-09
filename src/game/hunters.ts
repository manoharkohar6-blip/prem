import { cellToWorld, type GameMap } from './mapgen';
import { findPath, hasLineOfSight, moveWithCollision } from './nav';
import { mulberry32, type Rng } from './rng';
import { distance } from './vec';
import type { HunterId, Vec2 } from './types';

export type HunterStateName = 'patrol' | 'investigate' | 'chase' | 'stunned';

export interface HunterConfig {
  speed: number;
  chaseSpeed: number;
  sightRange: number;
  /** Cosine of the half field of view. -1 means it does not rely on a cone. */
  fovCos: number;
  hearRange: number;
  memory: number;
  catchRadius: number;
  /** Mundiya ignores walls entirely. */
  phases: boolean;
  label: string;
}

export const HUNTER_CONFIG: Record<HunterId, HunterConfig> = {
  granny: {
    speed: 1.9,
    chaseSpeed: 3.2,
    sightRange: 13,
    fovCos: 0.3,
    hearRange: 12,
    memory: 5,
    catchRadius: 1.25,
    phases: false,
    label: 'Granny',
  },
  mundiya: {
    speed: 1.75,
    chaseSpeed: 3.0,
    sightRange: 17,
    fovCos: -1,
    hearRange: 0,
    memory: 7,
    catchRadius: 1.25,
    phases: true,
    label: 'Mundiya',
  },
};

export interface Hunter {
  id: HunterId;
  pos: Vec2;
  facing: number;
  state: HunterStateName;
  target: Vec2 | null;
  lastKnown: Vec2 | null;
  path: Vec2[];
  repathTimer: number;
  memoryTimer: number;
  stunTimer: number;
  home: Vec2;
}

export interface HunterContext {
  map: GameMap;
  player: Vec2;
  /** A lit flashlight lets Mundiya find you through the dark. */
  playerLight: boolean;
  security: number;
}

export interface HunterUpdate {
  caughtBy: HunterId | null;
  nearestDistance: number;
}

export function createHunters(ids: HunterId[], spawns: Record<HunterId, Vec2>): Hunter[] {
  return ids.map((id) => ({
    id,
    pos: { ...spawns[id] },
    facing: 0,
    state: 'patrol',
    target: null,
    lastKnown: null,
    path: [],
    repathTimer: 0,
    memoryTimer: 0,
    stunTimer: 0,
    home: { ...spawns[id] },
  }));
}

/** Granny hunts by sound; Mundiya by sight and the flicker of your light. */
export class HunterSystem {
  readonly hunters: Hunter[];
  private rng: Rng;

  constructor(hunters: Hunter[], rng: Rng = mulberry32(7)) {
    this.hunters = hunters;
    this.rng = rng;
  }

  get(id: HunterId): Hunter | undefined {
    return this.hunters.find((hunter) => hunter.id === id);
  }

  reset(spawns: Record<HunterId, Vec2>): void {
    for (const hunter of this.hunters) {
      hunter.pos = { ...spawns[hunter.id] };
      hunter.state = 'patrol';
      hunter.target = null;
      hunter.lastKnown = null;
      hunter.path = [];
      hunter.repathTimer = 0;
      hunter.memoryTimer = 0;
      hunter.stunTimer = 0;
      hunter.facing = 0;
    }
  }

  /** Noise event: running, dropped objects, careless doors, bells. */
  alert(pos: Vec2, radius: number): void {
    for (const hunter of this.hunters) {
      if (hunter.state === 'chase' || hunter.state === 'stunned') continue;
      const config = HUNTER_CONFIG[hunter.id];
      if (config.hearRange <= 0) continue;
      if (distance(hunter.pos, pos) <= Math.min(radius, config.hearRange)) {
        hunter.state = 'investigate';
        hunter.target = { ...pos };
        hunter.lastKnown = { ...pos };
        hunter.path = [];
        hunter.repathTimer = 0;
      }
    }
  }

  update(dt: number, ctx: HunterContext): HunterUpdate {
    let caughtBy: HunterId | null = null;
    let nearestDistance = Number.POSITIVE_INFINITY;
    const boost = 1 + 0.08 * (ctx.security - 1);

    for (const hunter of this.hunters) {
      const config = HUNTER_CONFIG[hunter.id];

      if (hunter.stunTimer > 0) {
        hunter.stunTimer = Math.max(0, hunter.stunTimer - dt);
        hunter.state = hunter.stunTimer > 0 ? 'stunned' : 'patrol';
        if (hunter.stunTimer === 0) {
          hunter.target = null;
          hunter.path = [];
        }
        nearestDistance = Math.min(nearestDistance, distance(hunter.pos, ctx.player));
        continue;
      }

      const range = distance(hunter.pos, ctx.player);
      const los = hasLineOfSight(ctx.map, hunter.pos, ctx.player);
      const canSee = config.phases
        ? range <= config.sightRange && (los || (ctx.playerLight && range <= config.sightRange * 0.85))
        : range <= config.sightRange &&
          los &&
          (this.inFieldOfView(hunter, ctx.player, config.fovCos) || range < 4.5);

      if (canSee) {
        hunter.state = 'chase';
        hunter.memoryTimer = config.memory;
        hunter.lastKnown = { ...ctx.player };
      } else if (hunter.state === 'chase') {
        hunter.memoryTimer -= dt;
        if (hunter.memoryTimer <= 0) {
          hunter.state = 'investigate';
          hunter.target = hunter.lastKnown ? { ...hunter.lastKnown } : null;
          hunter.path = [];
        }
      }

      let destination: Vec2 | null = null;
      let speed = config.speed;

      if (hunter.state === 'chase') {
        destination = ctx.player;
        speed = config.chaseSpeed;
      } else if (hunter.state === 'investigate') {
        destination = hunter.target ?? hunter.lastKnown;
        if (destination && distance(hunter.pos, destination) < 1.6) {
          hunter.state = 'patrol';
          hunter.target = null;
          hunter.path = [];
          destination = null;
        }
      }

      if (!destination) {
        if (!hunter.target || distance(hunter.pos, hunter.target) < 1.6) {
          hunter.target = this.randomPatrolPoint(ctx.map);
          hunter.path = [];
        }
        destination = hunter.target;
      }

      if (destination) this.step(hunter, destination, speed * boost, dt, ctx.map, config.phases);

      const after = distance(hunter.pos, ctx.player);
      nearestDistance = Math.min(nearestDistance, after);
      if (after <= config.catchRadius) caughtBy = caughtBy ?? hunter.id;
    }

    return { caughtBy, nearestDistance };
  }

  private inFieldOfView(hunter: Hunter, player: Vec2, fovCos: number): boolean {
    const dx = player.x - hunter.pos.x;
    const dy = player.y - hunter.pos.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-3) return true;
    const dot = (dx / len) * Math.cos(hunter.facing) + (dy / len) * Math.sin(hunter.facing);
    return dot >= fovCos;
  }

  private step(hunter: Hunter, destination: Vec2, speed: number, dt: number, map: GameMap, phases: boolean): void {
    const dx = destination.x - hunter.pos.x;
    const dy = destination.y - hunter.pos.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-4) return;
    hunter.facing = Math.atan2(dy, dx);

    if (phases) {
      const move = Math.min(len, speed * dt);
      hunter.pos = { x: hunter.pos.x + (dx / len) * move, y: hunter.pos.y + (dy / len) * move };
      return;
    }

    hunter.repathTimer -= dt;
    if (hunter.repathTimer <= 0 || hunter.path.length === 0) {
      hunter.path = findPath(map, hunter.pos, destination);
      hunter.repathTimer = 0.45;
    }

    let waypoint = hunter.path[0];
    while (waypoint && distance(hunter.pos, waypoint) < 0.8) {
      hunter.path.shift();
      waypoint = hunter.path[0];
    }

    const aim = waypoint ?? destination;
    const ax = aim.x - hunter.pos.x;
    const ay = aim.y - hunter.pos.y;
    const aimLength = Math.hypot(ax, ay);
    if (aimLength < 1e-4) return;
    const move = Math.min(aimLength, speed * dt);
    hunter.pos = moveWithCollision(
      map,
      hunter.pos,
      { x: (ax / aimLength) * move, y: (ay / aimLength) * move },
      0.42,
    );
  }

  private randomPatrolPoint(map: GameMap): Vec2 {
    const room = map.rooms[Math.floor(this.rng() * map.rooms.length)];
    const x = room.x + Math.floor(this.rng() * room.w);
    const y = room.y + Math.floor(this.rng() * room.h);
    return cellToWorld(x, y);
  }
}
