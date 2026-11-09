import type { ItemDef, ItemId } from './types';

export const ITEMS: Record<ItemId, ItemDef> = {
  rustedKey: {
    id: 'rustedKey',
    name: 'Rusted Iron Key',
    kind: 'key',
    description: 'Flakes of rust come away on your fingers. It fits the heavy iron door.',
    color: 0xb08a4a,
  },
  wireCutters: {
    id: 'wireCutters',
    name: 'Wire Cutters',
    kind: 'tool',
    description: 'Insulated handles, pitted jaws. Enough to bite through shock-wire.',
    color: 0x9aa7b0,
  },
  flashlight: {
    id: 'flashlight',
    name: 'Cracked Flashlight',
    kind: 'tool',
    description: 'The beam stutters, but it cuts the dark. Light draws Mundiya.',
    color: 0xffe6a8,
  },
  crowbar: {
    id: 'crowbar',
    name: 'Bent Crowbar',
    kind: 'tool',
    description: 'Pried from a mortuary drawer. Good for stubborn ventilation grates.',
    color: 0xa8563a,
  },
  fuseRed: {
    id: 'fuseRed',
    name: 'Red Fuse',
    kind: 'fuse',
    description: 'A ceramic fuse wound with red wire. One third of the elevator circuit.',
    color: 0xd63b3b,
  },
  fuseGreen: {
    id: 'fuseGreen',
    name: 'Green Fuse',
    kind: 'fuse',
    description: 'A ceramic fuse wound with green wire. One third of the elevator circuit.',
    color: 0x3bd66a,
  },
  fuseBlue: {
    id: 'fuseBlue',
    name: 'Blue Fuse',
    kind: 'fuse',
    description: 'A ceramic fuse wound with blue wire. One third of the elevator circuit.',
    color: 0x3b7ad6,
  },
  relicAsh: {
    id: 'relicAsh',
    name: 'Relic of Ash',
    kind: 'relic',
    description: 'A sealed jar of grey ash that is always warm.',
    color: 0xb9b4ac,
  },
  relicBone: {
    id: 'relicBone',
    name: 'Relic of Bone',
    kind: 'relic',
    description: 'A finger bone bound in copper wire, humming faintly.',
    color: 0xe4dcc4,
  },
  relicSalt: {
    id: 'relicSalt',
    name: 'Relic of Salt',
    kind: 'relic',
    description: 'A black salt-cake carved with a closed eye.',
    color: 0xd9d3e6,
  },
  relicNail: {
    id: 'relicNail',
    name: 'Relic of Nail',
    kind: 'relic',
    description: 'A bent iron nail pulled from the chapel door.',
    color: 0x8a7f72,
  },
  masterWrench: {
    id: 'masterWrench',
    name: 'Master Wrench',
    kind: 'tool',
    description: 'Heavy, brass-handled, sized for the clocktower gear train.',
    color: 0xc9a227,
  },
  gateKey: {
    id: 'gateKey',
    name: 'Perimeter Gate Key',
    kind: 'key',
    description: 'Cold and impossibly heavy. The storm outside is one turn away.',
    color: 0xd9e2ea,
  },
  bearTrap: {
    id: 'bearTrap',
    name: 'Rusted Bear Trap',
    kind: 'trap',
    description: 'Arm it on the floor and let Granny find it first.',
    color: 0x8d6a4a,
  },
};

export function itemName(id: ItemId): string {
  return ITEMS[id].name;
}

export function itemNames(ids: ItemId[]): string {
  return ids.map(itemName).join(', ');
}
