import { describe, expect, it } from 'vitest';
import { HUNTER_CONFIG, HunterSystem, createHunters } from '../src/game/hunters';
import { generateMap, isWall, worldToCell } from '../src/game/mapgen';
import { hasLineOfSight } from '../src/game/nav';
import { GameSession } from '../src/game/session';
import { distance } from '../src/game/vec';
import type { Vec2 } from '../src/game/types';
import { findBlockedPair, firstOpenCell } from './helpers';

const map = generateMap(101, 13, 0.1);
const spawn = firstOpenCell(map);

function systemWith(ids: ('granny' | 'mundiya')[], at: Vec2): HunterSystem {
  return new HunterSystem(
    createHunters(ids, { granny: at, mundiya: at }),
    () => 0.5,
  );
}

describe('Granny: patrols and reacts to sound', () => {
  it('investigates noise inside her hearing range', () => {
    const system = systemWith(['granny'], spawn);
    const noise = { x: spawn.x + 3, y: spawn.y };
    system.alert(noise, 8);

    const granny = system.get('granny')!;
    expect(granny.state).toBe('investigate');
    expect(granny.target).toEqual(noise);
    expect(granny.lastKnown).toEqual(noise);
  });

  it('ignores noise beyond her hearing range', () => {
    const system = systemWith(['granny'], spawn);
    system.alert({ x: spawn.x + 40, y: spawn.y }, 6);
    expect(system.get('granny')!.state).toBe('patrol');
    expect(HUNTER_CONFIG.granny.hearRange).toBeLessThan(40);
  });

  it('walks the corridors instead of through them', () => {
    const { a, b } = findBlockedPair(map);
    const system = systemWith(['granny'], a);
    const granny = system.get('granny')!;
    granny.pos = { ...a };

    for (let i = 0; i < 240; i += 1) {
      system.update(1 / 60, { map, player: b, playerLight: false, security: 1 });
    }

    const cell = worldToCell(granny.pos);
    expect(isWall(map, cell.x, cell.y)).toBe(false);
  });

  it('is stopped by a floor trap', () => {
    const session = new GameSession(555);
    const granny = session.hunters.get('granny')!;
    session.traps.push({ id: 'test-trap', pos: { ...granny.pos }, armed: true });
    session.player.pos = { ...session.layout.startPos };

    session.update(0.016);

    expect(granny.stunTimer).toBeGreaterThan(0);
    expect(granny.state).toBe('stunned');
    expect(session.traps[0].armed).toBe(false);
    expect(session.drainEvents().some((event) => event.type === 'trap')).toBe(true);

    const frozen = { ...granny.pos };
    session.update(0.016);
    expect(granny.pos).toEqual(frozen);
  });
});

describe('Mundiya: silent, sees through walls, hunts the light', () => {
  it('does not hear sound at all', () => {
    const system = systemWith(['mundiya'], spawn);
    system.alert({ x: spawn.x + 2, y: spawn.y }, 30);
    expect(system.get('mundiya')!.state).toBe('patrol');
    expect(HUNTER_CONFIG.mundiya.hearRange).toBe(0);
  });

  it('phases through walls towards a lit player', () => {
    const { a, b } = findBlockedPair(map);
    expect(hasLineOfSight(map, a, b)).toBe(false);

    const system = systemWith(['mundiya'], a);
    const mundiya = system.get('mundiya')!;
    mundiya.pos = { ...a };
    const startDistance = distance(mundiya.pos, b);

    const first = system.update(1 / 60, { map, player: b, playerLight: true, security: 1 });
    expect(mundiya.state).toBe('chase');
    expect(first.nearestDistance).toBeLessThanOrEqual(startDistance);

    for (let i = 0; i < 120; i += 1) {
      system.update(1 / 60, { map, player: b, playerLight: true, security: 1 });
    }

    // It closed the gap even though a wall stood in the way.
    expect(distance(mundiya.pos, b)).toBeLessThan(startDistance - 1.5);
  });

  it('loses an unlit player it cannot see', () => {
    const { a, b } = findBlockedPair(map);
    const system = systemWith(['mundiya'], a);
    const mundiya = system.get('mundiya')!;
    mundiya.pos = { ...a };

    system.update(1 / 60, { map, player: b, playerLight: false, security: 1 });
    expect(mundiya.state).not.toBe('chase');
  });

  it('gets faster as security rises', () => {
    const { a, b } = findBlockedPair(map);
    const travel = (security: number): number => {
      const system = systemWith(['mundiya'], a);
      const mundiya = system.get('mundiya')!;
      mundiya.pos = { ...a };
      for (let i = 0; i < 60; i += 1) {
        system.update(1 / 60, { map, player: b, playerLight: true, security });
      }
      return distance(mundiya.pos, a);
    };

    expect(travel(5)).toBeGreaterThan(travel(1) * 1.15);
  });
});

describe('hunter roster per level', () => {
  it('gives level 1 only Granny and later levels both hunters', () => {
    const session = new GameSession(9001);
    expect(session.hunters.hunters.map((hunter) => hunter.id)).toEqual(['granny']);

    session.loadLevel(1);
    expect(session.hunters.hunters.map((hunter) => hunter.id).sort()).toEqual(['granny', 'mundiya']);

    session.loadLevel(2);
    expect(session.hunters.hunters).toHaveLength(2);
    session.loadLevel(3);
    expect(session.hunters.hunters).toHaveLength(2);
  });
});
