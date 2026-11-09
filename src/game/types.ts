export interface Vec2 {
  x: number;
  y: number;
}

export type ItemId =
  | 'rustedKey'
  | 'wireCutters'
  | 'flashlight'
  | 'crowbar'
  | 'fuseRed'
  | 'fuseGreen'
  | 'fuseBlue'
  | 'relicAsh'
  | 'relicBone'
  | 'relicSalt'
  | 'relicNail'
  | 'masterWrench'
  | 'gateKey'
  | 'bearTrap';

export type ItemKind = 'key' | 'tool' | 'fuse' | 'relic' | 'trap';

export interface ItemDef {
  id: ItemId;
  name: string;
  kind: ItemKind;
  description: string;
  /** Colour used by the 3D view for the pickup glow. */
  color: number;
}

export type ThemeId = 'basement' | 'mortuary' | 'chapel' | 'clocktower';

export type HunterId = 'granny' | 'mundiya';

export type RunStatus = 'playing' | 'won' | 'lost';

export type ObjectiveKind = 'task' | 'exit' | 'pickup';

export interface ObjectiveSpec {
  id: string;
  label: string;
  kind: ObjectiveKind;
  hint: string;
  /** Items that are consumed when the objective is completed. */
  requires?: ItemId[];
  /** Items that must be carried but are kept afterwards. */
  keepItems?: ItemId[];
  /** Other objective ids that must be completed first. */
  requiresObjectives?: string[];
  /** Altar slots only accept this exact relic. */
  slotFor?: ItemId;
  /** Item handed to the player when this objective completes. */
  grants?: ItemId;
  /** Pickup objectives complete when this world item is collected. */
  pickupItem?: ItemId;
}

export interface LevelSpec {
  index: number;
  name: string;
  subtitle: string;
  theme: ThemeId;
  brief: string[];
  items: ItemId[];
  objectives: ObjectiveSpec[];
  hunters: HunterId[];
  roomCount: number;
  fogColor: number;
  fogDensity: number;
  ambient: number;
  creakChance: number;
  hiddenTraps: number;
  chapelBells: boolean;
}
