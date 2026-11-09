import { createHunters, HunterSystem } from './hunters';
import { Inventory } from './inventory';
import { ITEMS, itemName, itemNames } from './items';
import { layoutLevel, type LevelLayout, type PlacedObjective, type WorldItem } from './layout';
import { LEVELS, MAX_DAYS } from './levels';
import { generateMap, worldToCell, type GameMap } from './mapgen';
import { canStandAt } from './nav';
import { hashSeed, mulberry32, type Rng } from './rng';
import type { HunterId, ItemId, LevelSpec, ObjectiveKind, RunStatus, Vec2 } from './types';
import { clamp, distance } from './vec';

export const PLAYER_RADIUS = 0.45;
export const INTERACT_RANGE = 2.7;
export const PICKUP_RANGE = 2.3;

export interface PlayerState {
  pos: Vec2;
  yaw: number;
  stamina: number;
  crouching: boolean;
  sprinting: boolean;
  moving: boolean;
  hasFlashlight: boolean;
  lightOn: boolean;
}

export interface Trap {
  id: string;
  pos: Vec2;
  armed: boolean;
}

export interface ObjectiveView {
  id: string;
  label: string;
  hint: string;
  kind: ObjectiveKind;
  done: boolean;
}

export type GameEvent =
  | { type: 'pickup'; item: ItemId }
  | { type: 'objective'; id: string; label: string }
  | { type: 'granted'; item: ItemId }
  | { type: 'blocked'; message: string }
  | { type: 'message'; message: string }
  | { type: 'caught'; day: number; hunter: HunterId }
  | { type: 'trap'; hunter: HunterId }
  | { type: 'creak' }
  | { type: 'bell' }
  | { type: 'footstep'; intensity: number }
  | { type: 'won' }
  | { type: 'lost' }
  | { type: 'level'; index: number }
  | { type: 'threat'; intensity: number };

export interface InteractionResult {
  ok: boolean;
  kind: 'pickup' | 'objective' | 'exit' | 'blocked' | 'none';
  message: string;
  objectiveId?: string;
}

export interface MoveOptions {
  sprint?: boolean;
  crouch?: boolean;
}

/**
 * Owns the whole survival loop: five days, the three-slot satchel, the four
 * levels, both hunters, and every interaction. It has no DOM or WebGL
 * dependencies so the rules can be tested directly.
 */
export class GameSession {
  readonly seed: number;
  day = 1;
  security = 1;
  status: RunStatus = 'playing';
  levelIndex = 0;
  level!: LevelSpec;
  map!: GameMap;
  layout!: LevelLayout;
  inventory = new Inventory();
  objectives: Record<string, 'pending' | 'done'> = {};
  worldItems: WorldItem[] = [];
  traps: Trap[] = [];
  hunters!: HunterSystem;
  threat = 0;
  events: GameEvent[] = [];
  player: PlayerState = {
    pos: { x: 0, y: 0 },
    yaw: 0,
    stamina: 1,
    crouching: false,
    sprinting: false,
    moving: false,
    hasFlashlight: false,
    lightOn: false,
  };

  private readonly rng: Rng;
  private noiseTimer = 0;
  private creakTimer = 0;
  private bellTimer = 22;
  private threatTimer = 0;
  private trapCounter = 0;
  private dropCounter = 0;
  private takenItemIds = new Set<string>();

  constructor(seed = 20260101) {
    this.seed = seed;
    this.rng = mulberry32(hashSeed(seed, 999));
    this.loadLevel(0);
  }

  get levelCount(): number {
    return LEVELS.length;
  }

  get daysLeft(): number {
    return Math.max(0, MAX_DAYS - this.day + 1);
  }

  get exitObjective(): PlacedObjective | undefined {
    return this.layout.objectives.find((objective) => objective.spec.kind === 'exit');
  }

  get objectiveList(): ObjectiveView[] {
    return this.layout.objectives.map((objective) => ({
      id: objective.spec.id,
      label: objective.spec.label,
      hint: objective.spec.hint,
      kind: objective.spec.kind,
      done: this.objectives[objective.spec.id] === 'done',
    }));
  }

  get nearestHunterDistance(): number {
    let best = Number.POSITIVE_INFINITY;
    for (const hunter of this.hunters.hunters) best = Math.min(best, distance(hunter.pos, this.player.pos));
    return best;
  }

  /** Loads a level fresh. Inventory, day and security carry over. */
  loadLevel(index: number): void {
    this.levelIndex = Math.max(0, Math.min(LEVELS.length - 1, index));
    this.level = LEVELS[this.levelIndex];
    const mapSeed = hashSeed(this.seed, 101, this.levelIndex);
    this.map = generateMap(mapSeed, this.level.roomCount, this.level.creakChance);
    this.layout = layoutLevel(this.level, this.map, hashSeed(this.seed, 202, this.levelIndex, this.day));

    this.objectives = {};
    for (const spec of this.level.objectives) this.objectives[spec.id] = 'pending';

    this.takenItemIds = new Set<string>();
    this.worldItems = this.layout.items.map((item) => ({ ...item }));
    this.traps = this.layout.traps.map((pos, i) => ({ id: `trap-${this.levelIndex}-${i}`, pos, armed: true }));

    this.player.pos = { ...this.layout.startPos };
    this.player.yaw = 0;
    this.player.stamina = 1;
    this.player.moving = false;
    this.player.crouching = false;
    this.player.sprinting = false;

    this.noiseTimer = 0;
    this.creakTimer = 0;
    this.bellTimer = 22;
    this.threat = 0;

    this.hunters = new HunterSystem(
      createHunters(this.level.hunters, this.layout.hunterSpawns),
      mulberry32(hashSeed(this.seed, 303, this.levelIndex, this.day)),
    );
  }

  /** Noise: sprinting, dropped items, forced doors and chapel bells. */
  emitNoise(pos: Vec2, radius: number): void {
    this.hunters.alert(pos, radius);
  }

  drainEvents(): GameEvent[] {
    const events = this.events;
    this.events = [];
    return events;
  }

  /** Context-sensitive use key: picks up the closest item, else uses a fixture. */
  interact(): InteractionResult {
    if (this.status !== 'playing') return { ok: false, kind: 'none', message: '' };
    const objective = this.nearestObjective(INTERACT_RANGE);
    const item = this.nearestItem(PICKUP_RANGE);

    if (item && (!objective || distance(item.pos, this.player.pos) <= distance(objective.pos, this.player.pos))) {
      return this.takeItem(item);
    }
    if (!objective) return { ok: false, kind: 'none', message: '' };
    return this.useObjective(objective);
  }

  pickupNearest(range = PICKUP_RANGE): InteractionResult {
    const item = this.nearestItem(range);
    if (!item) return { ok: false, kind: 'none', message: '' };
    return this.takeItem(item);
  }

  dropItem(slot: number): InteractionResult {
    const item = this.inventory.removeAt(slot);
    if (!item) return { ok: false, kind: 'none', message: 'That slot is empty.' };
    this.dropCounter += 1;
    this.worldItems.push({
      id: `dropped-${this.dropCounter}-${item}`,
      item,
      pos: { ...this.player.pos },
      roomId: -1,
      taken: false,
    });
    this.emitNoise(this.player.pos, 14);
    this.events.push({ type: 'message', message: `Dropped ${itemName(item)}. The clatter carries.` });
    return { ok: true, kind: 'pickup', message: `Dropped ${itemName(item)}.` };
  }

  placeTrap(): InteractionResult {
    if (!this.inventory.has('bearTrap')) {
      return { ok: false, kind: 'none', message: 'No bear trap to set.' };
    }
    this.inventory.remove('bearTrap');
    this.trapCounter += 1;
    this.traps.push({ id: `placed-${this.trapCounter}`, pos: { ...this.player.pos }, armed: true });
    this.events.push({ type: 'message', message: 'Bear trap armed. Granny will feel that.' });
    return { ok: true, kind: 'objective', message: 'Bear trap armed.' };
  }

  toggleLight(): boolean {
    if (!this.player.hasFlashlight) return false;
    this.player.lightOn = !this.player.lightOn;
    this.events.push({
      type: 'message',
      message: this.player.lightOn ? 'Flashlight on. The dark notices.' : 'Flashlight off. Something still sees.',
    });
    return this.player.lightOn;
  }

  /**
   * Moves the player with wall sliding, spends stamina, and turns footsteps
   * into noise the hunters can hear.
   */
  movePlayer(direction: Vec2, dt: number, options: MoveOptions = {}): Vec2 {
    if (this.status !== 'playing') return { ...this.player.pos };
    const step = Math.min(dt, 0.1);
    const crouch = Boolean(options.crouch);
    const wantsSprint = Boolean(options.sprint) && !crouch;
    const sprint = wantsSprint && this.player.stamina > 0.02;
    this.player.crouching = crouch;
    this.player.sprinting = sprint;

    const speed = crouch ? 1.5 : sprint ? 5.2 : 2.7;
    const len = Math.hypot(direction.x, direction.y);
    const before = { ...this.player.pos };

    if (len > 1e-6) {
      const nx = direction.x / len;
      const ny = direction.y / len;
      const delta = { x: nx * speed * step, y: ny * speed * step };
      const target = {
        x: this.player.pos.x + delta.x,
        y: this.player.pos.y + delta.y,
      };
      this.player.pos = this.slide(delta, target);
      const movedDistance = distance(this.player.pos, before);
      this.player.moving = movedDistance > 1e-4;
      this.player.stamina = clamp(this.player.stamina + (sprint ? -0.3 : 0.14) * step, 0, 1);

      this.noiseTimer += step;
      const interval = crouch ? 0.95 : sprint ? 0.32 : 0.55;
      if (this.player.moving && this.noiseTimer >= interval) {
        this.noiseTimer = 0;
        const loudness = crouch ? 2.5 : sprint ? 13 : 6;
        this.emitNoise(this.player.pos, loudness);
        this.events.push({ type: 'footstep', intensity: crouch ? 0.15 : sprint ? 1 : 0.5 });
      }

      if (!crouch && this.creakTimer <= 0) {
        const cell = worldToCell(this.player.pos);
        if (this.map.creaky.has(cell.y * this.map.width + cell.x)) {
          this.creakTimer = 1.3;
          this.emitNoise(this.player.pos, 19);
          this.events.push({ type: 'creak' });
        }
      }
    } else {
      this.player.moving = false;
      this.player.stamina = clamp(this.player.stamina + 0.2 * step, 0, 1);
    }

    this.creakTimer = Math.max(0, this.creakTimer - step);
    return { ...this.player.pos };
  }

  update(dt: number): void {
    if (this.status !== 'playing') return;
    const step = Math.min(dt, 0.1);

    const hunterUpdate = this.hunters.update(step, {
      map: this.map,
      player: this.player.pos,
      playerLight: this.player.hasFlashlight && this.player.lightOn,
      security: this.security,
    });

    // Floor traps: Granny is the only one with feet to break.
    for (const trap of this.traps) {
      if (!trap.armed) continue;
      const granny = this.hunters.get('granny');
      if (!granny || granny.stunTimer > 0) continue;
      if (distance(granny.pos, trap.pos) < 1.1) {
        trap.armed = false;
        granny.stunTimer = 6;
        granny.state = 'stunned';
        granny.path = [];
        this.events.push({ type: 'trap', hunter: 'granny' });
      }
    }

    if (hunterUpdate.caughtBy) {
      this.handleCaught(hunterUpdate.caughtBy);
      return;
    }

    if (this.level.chapelBells) {
      this.bellTimer -= step;
      if (this.bellTimer <= 0) {
        this.bellTimer = 18 + this.rng() * 14;
        this.emitNoise(this.player.pos, 26);
        this.events.push({ type: 'bell' });
      }
    }

    this.threatTimer -= step;
    if (this.threatTimer <= 0) {
      this.threatTimer = 0.5;
      this.threat = clamp(1 - hunterUpdate.nearestDistance / 18, 0, 1);
      this.events.push({ type: 'threat', intensity: this.threat });
    }
  }

  restart(): void {
    this.day = 1;
    this.security = 1;
    this.status = 'playing';
    this.inventory.clear();
    this.player.hasFlashlight = false;
    this.player.lightOn = false;
    this.events = [];
    this.trapCounter = 0;
    this.dropCounter = 0;
    this.loadLevel(0);
  }

  // ---------------------------------------------------------------- internals

  private slide(delta: Vec2, target: Vec2): Vec2 {
    let x = this.player.pos.x;
    let y = this.player.pos.y;
    if (canStandAt(this.map, { x: target.x, y: this.player.pos.y }, PLAYER_RADIUS)) x = target.x;
    if (canStandAt(this.map, { x, y: this.player.pos.y + delta.y }, PLAYER_RADIUS)) y = this.player.pos.y + delta.y;
    return { x, y };
  }

  private nearestItem(range: number): WorldItem | null {
    let best: WorldItem | null = null;
    let bestDistance = range;
    for (const item of this.worldItems) {
      if (item.taken) continue;
      const d = distance(item.pos, this.player.pos);
      if (d <= bestDistance) {
        best = item;
        bestDistance = d;
      }
    }
    return best;
  }

  private nearestObjective(range: number): PlacedObjective | null {
    let best: PlacedObjective | null = null;
    let bestDistance = range;
    for (const objective of this.layout.objectives) {
      if (this.objectives[objective.spec.id] === 'done') continue;
      const d = distance(objective.pos, this.player.pos);
      if (d <= bestDistance) {
        best = objective;
        bestDistance = d;
      }
    }
    return best;
  }

  private takeItem(item: WorldItem): InteractionResult {
    if (item.item === 'flashlight') {
      item.taken = true;
      this.takenItemIds.add(item.id);
      this.player.hasFlashlight = true;
      this.player.lightOn = true;
      this.events.push({ type: 'pickup', item: item.item });
      this.completePickupObjectives(item.item);
      return { ok: true, kind: 'pickup', message: 'Cracked flashlight taken. F toggles the beam.' };
    }

    if (!this.inventory.add(item.item)) {
      return this.blocked(`Your hands are full (3/3). Drop something to take the ${itemName(item.item)}.`);
    }

    item.taken = true;
    this.takenItemIds.add(item.id);
    this.events.push({ type: 'pickup', item: item.item });
    this.completePickupObjectives(item.item);
    return { ok: true, kind: 'pickup', message: `Took ${itemName(item.item)}.` };
  }

  private completePickupObjectives(item: ItemId): void {
    for (const spec of this.level.objectives) {
      if (spec.kind !== 'pickup' || spec.pickupItem !== item) continue;
      if (this.objectives[spec.id] === 'done') continue;
      this.objectives[spec.id] = 'done';
      this.events.push({ type: 'objective', id: spec.id, label: spec.label });
    }
  }

  private useObjective(objective: PlacedObjective): InteractionResult {
    const spec = objective.spec;
    if (this.objectives[spec.id] === 'done') {
      return this.blocked(`${spec.label} is already dealt with.`);
    }

    const missingObjectives = (spec.requiresObjectives ?? []).filter(
      (id) => this.objectives[id] !== 'done',
    );
    if (spec.kind === 'exit') {
      for (const other of this.level.objectives) {
        if (other.id === spec.id) continue;
        if (this.objectives[other.id] !== 'done' && !missingObjectives.includes(other.id)) {
          missingObjectives.push(other.id);
        }
      }
    }
    if (missingObjectives.length) {
      const labels = missingObjectives.map(
        (id) => this.level.objectives.find((o) => o.id === id)?.label ?? id,
      );
      return this.blocked(`${spec.label} — still need: ${labels.join(' + ')}.`);
    }

    if (spec.slotFor && !this.inventory.has(spec.slotFor)) {
      const heldRelic = this.inventory.items.find((item) => ITEMS[item].kind === 'relic');
      if (heldRelic) {
        this.emitNoise(this.player.pos, 22);
        this.events.push({ type: 'bell' });
        return this.blocked(
          `The ${spec.label} rejects the ${itemName(heldRelic)}. Bells scream through the chapel.`,
        );
      }
    }

    const required = [...(spec.requires ?? []), ...(spec.keepItems ?? [])];
    const missingItems = required.filter((item) => !this.inventory.has(item));
    if (missingItems.length) {
      return this.blocked(`${spec.label} — requires ${itemNames(missingItems)}.`);
    }

    for (const item of spec.requires ?? []) this.inventory.remove(item);
    this.objectives[spec.id] = 'done';
    this.events.push({ type: 'objective', id: spec.id, label: spec.label });

    if (spec.grants) this.grant(spec.grants);

    if (spec.kind === 'exit') {
      this.advanceLevel();
      return { ok: true, kind: 'exit', objectiveId: spec.id, message: `${spec.label} — through.` };
    }
    return { ok: true, kind: 'objective', objectiveId: spec.id, message: `${spec.label} — done.` };
  }

  private grant(item: ItemId): void {
    if (item === 'flashlight') {
      this.player.hasFlashlight = true;
      this.player.lightOn = true;
      this.events.push({ type: 'granted', item });
      this.completePickupObjectives(item);
      return;
    }
    if (this.inventory.add(item)) {
      this.events.push({ type: 'granted', item });
    } else {
      this.worldItems.push({
        id: `granted-${item}-${this.worldItems.length}`,
        item,
        pos: { ...this.player.pos },
        roomId: -1,
        taken: false,
      });
      this.events.push({
        type: 'message',
        message: `Hands full — the ${itemName(item)} clatters to the floor.`,
      });
    }
    this.completePickupObjectives(item);
  }

  private advanceLevel(): void {
    if (this.levelIndex >= LEVELS.length - 1) {
      this.status = 'won';
      this.events.push({ type: 'won' });
      return;
    }
    this.loadLevel(this.levelIndex + 1);
    this.events.push({ type: 'level', index: this.levelIndex });
    this.events.push({ type: 'message', message: `${this.level.name} — ${this.level.brief[0]}` });
  }

  private handleCaught(by: HunterId): void {
    this.events.push({ type: 'caught', day: this.day, hunter: by });
    if (this.day >= MAX_DAYS) {
      this.status = 'lost';
      this.events.push({ type: 'lost' });
      return;
    }
    this.day += 1;
    this.security += 1;
    this.reshuffle();
    this.respawn();
    this.events.push({
      type: 'message',
      message: `DAY ${this.day} — ${by === 'granny' ? 'Granny drags you back' : 'Mundiya folds you into the dark'}. The asylum has moved everything.`,
    });
  }

  private reshuffle(): void {
    this.layout = layoutLevel(this.level, this.map, hashSeed(this.seed, 202, this.levelIndex, this.day));
    this.worldItems = this.layout.items.map((item) => ({
      ...item,
      taken: this.takenItemIds.has(item.id),
    }));
    this.traps = this.layout.traps.map((pos, i) => ({
      id: `trap-${this.levelIndex}-${this.day}-${i}`,
      pos,
      armed: true,
    }));
  }

  private respawn(): void {
    this.player.pos = { ...this.layout.startPos };
    this.player.yaw = 0;
    this.player.stamina = 1;
    this.player.moving = false;
    this.player.crouching = false;
    this.player.sprinting = false;
    this.noiseTimer = 0;
    this.creakTimer = 0;
    this.bellTimer = 22;
    this.threat = 0;
    this.hunters.reset(this.layout.hunterSpawns);
  }

  private blocked(message: string): InteractionResult {
    this.events.push({ type: 'blocked', message });
    return { ok: false, kind: 'blocked', message };
  }
}
