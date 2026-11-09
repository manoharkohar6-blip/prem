import { describe, expect, it } from 'vitest';
import { Inventory, MAX_INVENTORY } from '../src/game/inventory';

describe('three-slot inventory', () => {
  it('caps the satchel at three items', () => {
    const inventory = new Inventory();
    expect(inventory.capacity).toBe(3);
    expect(MAX_INVENTORY).toBe(3);

    expect(inventory.add('rustedKey')).toBe(true);
    expect(inventory.add('wireCutters')).toBe(true);
    expect(inventory.add('crowbar')).toBe(true);
    expect(inventory.isFull).toBe(true);

    expect(inventory.add('fuseRed')).toBe(false);
    expect(inventory.size).toBe(3);
    expect(inventory.has('fuseRed')).toBe(false);
  });

  it('keeps insertion order and reports the items it holds', () => {
    const inventory = new Inventory();
    inventory.add('fuseRed');
    inventory.add('crowbar');
    inventory.add('fuseGreen');

    expect(inventory.items).toEqual(['fuseRed', 'crowbar', 'fuseGreen']);
    expect(inventory.count('fuseRed')).toBe(1);
    expect(inventory.has('crowbar')).toBe(true);
    expect(inventory.has('masterWrench')).toBe(false);
  });

  it('frees a slot when an item is used or dropped', () => {
    const inventory = new Inventory();
    inventory.add('rustedKey');
    inventory.add('wireCutters');
    inventory.add('crowbar');

    expect(inventory.remove('rustedKey')).toBe(true);
    expect(inventory.size).toBe(2);
    expect(inventory.add('fuseBlue')).toBe(true);

    expect(inventory.removeAt(1)).toBe('wireCutters');
    expect(inventory.size).toBe(2);
    expect(inventory.removeAt(9)).toBeNull();
    expect(inventory.snapshot()).toHaveLength(3);
    expect(inventory.snapshot()).toContain(null);
  });

  it('clears between runs', () => {
    const inventory = new Inventory();
    inventory.add('gateKey');
    inventory.add('masterWrench');
    inventory.clear();
    expect(inventory.size).toBe(0);
    expect(inventory.isFull).toBe(false);
    expect(inventory.items).toEqual([]);
  });
});
