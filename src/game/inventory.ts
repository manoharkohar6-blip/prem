import { itemName } from './items';
import type { ItemId } from './types';

export const MAX_INVENTORY = 3;

/** Three-slot satchel. Tools and keys share the same space as fuses and relics. */
export class Inventory {
  readonly capacity: number;
  private slots: (ItemId | null)[];

  constructor(capacity = MAX_INVENTORY) {
    this.capacity = capacity;
    this.slots = new Array(capacity).fill(null);
  }

  get size(): number {
    return this.slots.filter((s): s is ItemId => s !== null).length;
  }

  get isFull(): boolean {
    return this.size >= this.capacity;
  }

  get items(): ItemId[] {
    return this.slots.filter((s): s is ItemId => s !== null);
  }

  get freeSlots(): number {
    return this.capacity - this.size;
  }

  has(item: ItemId): boolean {
    return this.slots.includes(item);
  }

  count(item: ItemId): number {
    return this.slots.filter((s) => s === item).length;
  }

  /** Returns false when the satchel is full. */
  add(item: ItemId): boolean {
    if (this.isFull) return false;
    const index = this.slots.indexOf(null);
    this.slots[index] = item;
    return true;
  }

  remove(item: ItemId): boolean {
    const index = this.slots.indexOf(item);
    if (index === -1) return false;
    this.slots[index] = null;
    return true;
  }

  removeAt(index: number): ItemId | null {
    if (index < 0 || index >= this.capacity) return null;
    const item = this.slots[index];
    this.slots[index] = null;
    return item;
  }

  at(index: number): ItemId | null {
    return this.slots[index] ?? null;
  }

  clear(): void {
    this.slots.fill(null);
  }

  snapshot(): (ItemId | null)[] {
    return this.slots.slice();
  }

  describe(): string {
    if (this.size === 0) return 'empty';
    return this.items.map(itemName).join(', ');
  }
}
