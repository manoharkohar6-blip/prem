import { describe, expect, it } from 'vitest';
import { LEVELS, MAX_DAYS } from '../src/game/levels';
import { MAP_H, MAP_W, generateMap, isWall, worldToCell } from '../src/game/mapgen';
import { GameSession } from '../src/game/session';
import type { ItemId, Vec2 } from '../src/game/types';

function goTo(session: GameSession, pos: Vec2): void {
  session.player.pos = { ...pos };
}

function take(session: GameSession, item: ItemId) {
  const worldItem = session.worldItems.find((entry) => entry.item === item && !entry.taken);
  if (!worldItem) throw new Error(`no ${item} left in level ${session.levelIndex}`);
  goTo(session, worldItem.pos);
  return session.interact();
}

function use(session: GameSession, objectiveId: string) {
  const objective = session.layout.objectives.find((entry) => entry.spec.id === objectiveId);
  if (!objective) throw new Error(`objective ${objectiveId} is not in level ${session.levelIndex}`);
  goTo(session, objective.pos);
  return session.interact();
}

function dropAll(session: GameSession): void {
  const slots = session.inventory.snapshot();
  for (let slot = 0; slot < slots.length; slot += 1) {
    if (slots[slot]) expect(session.dropItem(slot).ok).toBe(true);
  }
}

function catchOnce(session: GameSession): void {
  const granny = session.hunters.get('granny');
  if (!granny) throw new Error('level has no granny');
  granny.pos = { ...session.player.pos };
  session.update(0.016);
}

describe('day cycle', () => {
  it('starts on day 1 with security 1 and five days left', () => {
    const session = new GameSession(4242);
    expect(session.day).toBe(1);
    expect(session.security).toBe(1);
    expect(session.daysLeft).toBe(MAX_DAYS);
    expect(session.status).toBe('playing');
  });

  it('advances the day, raises security and shuffles the items when caught', () => {
    const session = new GameSession(777);
    const itemsBefore = session.worldItems.map((item) => `${item.item}:${item.pos.x},${item.pos.y}`);
    const fixturesBefore = session.layout.objectives.map(
      (objective) => `${objective.spec.id}:${objective.pos.x},${objective.pos.y}`,
    );

    catchOnce(session);

    expect(session.day).toBe(2);
    expect(session.security).toBe(2);
    expect(session.daysLeft).toBe(MAX_DAYS - 1);

    const itemsAfter = session.worldItems.map((item) => `${item.item}:${item.pos.x},${item.pos.y}`);
    expect(itemsAfter).not.toEqual(itemsBefore);

    // Fixtures stay put; only the loose items move.
    const fixturesAfter = session.layout.objectives.map(
      (objective) => `${objective.spec.id}:${objective.pos.x},${objective.pos.y}`,
    );
    expect(fixturesAfter).toEqual(fixturesBefore);
    expect(session.drainEvents().some((event) => event.type === 'caught')).toBe(true);
  });

  it('keeps items the player already took out of the shuffle', () => {
    const session = new GameSession(99);
    expect(take(session, 'rustedKey').ok).toBe(true);
    expect(session.inventory.has('rustedKey')).toBe(true);

    catchOnce(session);

    const key = session.worldItems.find((item) => item.item === 'rustedKey');
    expect(key?.taken).toBe(true);
    expect(session.inventory.has('rustedKey')).toBe(true);
  });

  it('ends the run on the fifth catch', () => {
    const session = new GameSession(31337);
    for (let day = 1; day <= 4; day += 1) {
      catchOnce(session);
      expect(session.day).toBe(day + 1);
      expect(session.status).toBe('playing');
    }
    expect(session.day).toBe(MAX_DAYS);
    expect(session.security).toBe(MAX_DAYS);

    catchOnce(session);
    expect(session.status).toBe('lost');
    expect(session.drainEvents().some((event) => event.type === 'lost')).toBe(true);
  });
});

describe('inventory and pickups in play', () => {
  it('collects the flashlight without using a satchel slot', () => {
    const session = new GameSession(1234);
    expect(take(session, 'flashlight').ok).toBe(true);
    expect(session.player.hasFlashlight).toBe(true);
    expect(session.player.lightOn).toBe(true);
    expect(session.inventory.size).toBe(0);
    expect(session.objectives.flashlight).toBe('done');
  });

  it('blocks a fourth item once three are carried', () => {
    const session = new GameSession(5150);
    expect(take(session, 'rustedKey').ok).toBe(true);
    expect(take(session, 'wireCutters').ok).toBe(true);
    expect(take(session, 'bearTrap').ok).toBe(true);
    expect(session.inventory.size).toBe(3);

    const blocked = take(session, 'bearTrap');
    expect(blocked.ok).toBe(false);
    expect(blocked.kind).toBe('blocked');
    expect(blocked.message).toContain('3/3');
  });

  it('lets the player free a slot by dropping an item', () => {
    const session = new GameSession(6060);
    take(session, 'rustedKey');
    take(session, 'wireCutters');
    take(session, 'bearTrap');

    const dropped = session.dropItem(0);
    expect(dropped.ok).toBe(true);
    expect(session.inventory.size).toBe(2);
    expect(session.worldItems.some((item) => item.item === 'rustedKey' && !item.taken)).toBe(true);
  });
});

describe('full four-level escape', () => {
  it('completes every level objective and wins', () => {
    const session = new GameSession(20260101);
    expect(session.levelCount).toBe(4);

    // Level 1 — basement and quarantine wards.
    expect(session.level.name).toBe(LEVELS[0].name);
    take(session, 'flashlight');
    take(session, 'rustedKey');
    take(session, 'wireCutters');

    const doorBlocked = use(session, 'ironDoor');
    expect(doorBlocked.ok).toBe(false);
    expect(doorBlocked.message).toContain('still need');

    expect(use(session, 'shockWire').ok).toBe(true);
    expect(session.inventory.has('wireCutters')).toBe(true);
    expect(use(session, 'ironDoor').ok).toBe(true);
    expect(session.levelIndex).toBe(1);

    // Level 2 — locked chambers, mortuary, fuses and the crowbar.
    expect(use(session, 'fusePanel').ok).toBe(false);
    expect(use(session, 'vent').ok).toBe(false);

    take(session, 'crowbar');
    expect(use(session, 'vent').ok).toBe(true);
    expect(session.inventory.has('crowbar')).toBe(true);

    // The satchel only holds three items, so the tools must go before the fuses.
    dropAll(session);
    expect(session.inventory.has('crowbar')).toBe(false);
    expect(session.inventory.size).toBe(0);
    expect(take(session, 'fuseRed').ok).toBe(true);
    expect(take(session, 'fuseGreen').ok).toBe(true);
    expect(take(session, 'fuseBlue').ok).toBe(true);
    expect(session.inventory.size).toBe(3);

    expect(use(session, 'fusePanel').ok).toBe(true);
    expect(session.inventory.size).toBe(0);
    expect(use(session, 'elevator').ok).toBe(true);
    expect(session.levelIndex).toBe(2);

    // Level 3 — four relics, three slots, one at a time.
    const relics: [ItemId, string][] = [
      ['relicAsh', 'slotAsh'],
      ['relicBone', 'slotBone'],
      ['relicSalt', 'slotSalt'],
      ['relicNail', 'slotNail'],
    ];
    for (const [relic, slot] of relics) {
      expect(take(session, relic).ok).toBe(true);
      expect(use(session, slot).ok).toBe(true);
      expect(session.objectives[slot]).toBe('done');
      expect(session.inventory.has(relic)).toBe(false);
    }
    expect(use(session, 'roofStairs').ok).toBe(true);
    expect(session.levelIndex).toBe(3);

    // Level 4 — clocktower, wrench, gate key and the final gate.
    const gateEarly = use(session, 'perimeterGate');
    expect(gateEarly.ok).toBe(false);

    take(session, 'masterWrench');
    expect(use(session, 'clockGears').ok).toBe(true);
    expect(session.inventory.has('masterWrench')).toBe(true);
    expect(use(session, 'clockFace').ok).toBe(true);
    expect(session.inventory.has('gateKey')).toBe(true);

    expect(use(session, 'perimeterGate').ok).toBe(true);
    expect(session.status).toBe('won');
    expect(session.drainEvents().some((event) => event.type === 'won')).toBe(true);
  });

  it('resets to day 1 and level 1 on restart', () => {
    const session = new GameSession(8080);
    catchOnce(session);
    catchOnce(session);
    session.inventory.add('gateKey');

    session.restart();

    expect(session.day).toBe(1);
    expect(session.security).toBe(1);
    expect(session.levelIndex).toBe(0);
    expect(session.status).toBe('playing');
    expect(session.inventory.size).toBe(0);
    expect(session.player.hasFlashlight).toBe(false);
  });
});

describe('asylum map', () => {
  it('is sealed, deterministic and has a walkable start', () => {
    const map = generateMap(42, 13, 0.1);
    expect(map.walls).toHaveLength(MAP_W * MAP_H);

    for (let x = 0; x < MAP_W; x += 1) {
      expect(isWall(map, x, 0)).toBe(true);
      expect(isWall(map, x, MAP_H - 1)).toBe(true);
    }
    for (let y = 0; y < MAP_H; y += 1) {
      expect(isWall(map, 0, y)).toBe(true);
      expect(isWall(map, MAP_W - 1, y)).toBe(true);
    }

    const startCell = worldToCell(map.start);
    expect(isWall(map, startCell.x, startCell.y)).toBe(false);
    expect(map.rooms.length).toBeGreaterThanOrEqual(8);

    const twin = generateMap(42, 13, 0.1);
    expect(Array.from(twin.walls)).toEqual(Array.from(map.walls));
    expect(twin.start).toEqual(map.start);
  });
});
