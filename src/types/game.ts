// Data-layer types for Arsandi Code. All game content (characters, skills,
// enemies, stages, items) is authored as JSON and validated against these
// shapes, so adding content is a data edit rather than a code change.

export type Element = "code-energy" | "code-tech" | "ai-core" | "physical" | "neutral";

export type CharacterRole =
  | "physical-balanced"
  | "magic-support"
  | "physical-tank"
  | "boss";

export interface Stats {
  hp: number;
  energy: number; // MP equivalent — "Code Energy"
  atk: number;
  def: number;
  mag: number;
  res: number;
  spd: number;
  move: number; // tactical-grid movement range, in tiles
}

export type SkillKind =
  | "physical"
  | "magical"
  | "support"
  | "buff"
  | "debuff"
  | "heal";

export type SkillTargeting =
  | "single"
  | "all-enemies"
  | "ally"
  | "all-allies"
  | "self"
  | "area";

export interface SkillData {
  id: string;
  name: string;
  owner: string; // character id
  kind: SkillKind;
  element: Element;
  cost: number; // energy cost
  power: number; // base power (0 for pure utility)
  range: number; // reach in tiles
  targeting: SkillTargeting;
  description: string;
}

// What a summon's ultimate does when unleashed in battle. Effects compose — a
// summon may damage enemies AND heal/shield/buff the party in a single cast.
export interface SummonEffect {
  damageAll?: boolean; // strike every enemy
  damageSingle?: boolean; // strike the single toughest enemy (one big hit)
  defBreak?: boolean; // damaged enemies also suffer def-down
  healParty?: number; // heal power applied to the whole party
  cleanse?: boolean; // clear negative statuses from the party
  shieldParty?: number; // flat damage-absorb shield granted to the whole party
  partyBuff?: ("atk-up" | "def-up" | "evasion-up")[]; // buffs for the whole party
}

// Legend-of-Legaia-style directional combo input performed while a summon is
// being unleashed. The player taps a short sequence of arrows into limited
// slots; contiguous runs that match a known "art" pattern chain together and
// amplify the ultimate's power.
export type ComboDir = "up" | "down" | "left" | "right";

export interface ComboArt {
  name: string; // displayed art name (flavour, Legaia-style)
  seq: ComboDir[]; // directional pattern that triggers this art
  bonus: number; // power multiplier added to the ultimate when this art lands
}

export interface SummonData {
  id: string;
  name: string;
  owner: string; // character id
  ultimate: string; // ultimate move name
  description: string;
  element: Element; // drives the cinematic FX colour
  color: string; // hex accent for the summon sigil / banner
  power: number; // base damage power of the ultimate
  effect: SummonEffect; // signature behaviour when unleashed
  silhouette?: string; // creature shape drawn in the cutscene (dragon|oracle|colossus)
  arts?: ComboArt[]; // directional arts that can chain during the summon combo
  comboSlots?: number; // number of directional inputs allowed (default 5)
}

export interface PassiveData {
  id: string;
  name: string;
  description: string;
}

export interface CharacterData {
  id: string;
  name: string;
  title: string;
  role: CharacterRole;
  classId: string; // base class id
  weapon: string;
  affinity: Element;
  age: number;
  heightCm: number;
  themeColor: string;
  bio: string;
  baseStats: Stats;
  skills: string[]; // skill ids
  passives: PassiveData[];
  summon: string; // summon id
  sprite: string; // texture key
  portrait: string; // texture key
  // Legend-of-Legaia-style battle arts chained during the ATTACK / damaging-skill
  // combo. The number of input slots grows with the hero's level; contiguous runs
  // that match an art add their bonus and trigger an emphasised finisher hit.
  arts?: ComboArt[];
}

export interface BossPhase {
  name: string;
  description: string;
}

export interface EnemyData {
  id: string;
  name: string;
  kind: "boss" | "minion";
  stageId: string | null;
  description: string;
  baseStats: Stats;
  attacks: string[]; // flavour names for the codex
  skills?: string[]; // skill ids the engine can actually use in battle
  phases?: BossPhase[];
  drops?: string[];
  sprite?: string;
}

export interface StageData {
  id: string;
  index: number;
  name: string;
  type: string;
  description: string;
  bossId: string;
  background: string; // texture key
  unlocks?: string[];
  // Mob waves fought on the way to the boss; each entry is a group of minion
  // enemy ids that make up one field encounter. The boss is separate (bossId).
  encounters?: string[][];
  // How many of the early encounter waves (by index) spawn as roaming monsters
  // that wander the field and chase the player, triggering their fight on
  // contact — instead of standing as static interact-to-fight markers. The
  // remaining waves stay static. Defaults to 0 (all static).
  roamers?: number;
  // Field gimmicks for the dungeon (each placed at its type's home spot on the
  // road): "hazard" (drains HP), "gate" (barrier opened by interacting),
  // "warp" (glitch teleport pads), "sanctuary" (heals HP).
  gimmicks?: ("hazard" | "gate" | "warp" | "sanctuary")[];
}

export interface ClassData {
  id: string;
  name: string;
  characterId: string; // which hero this class belongs to
  tier: "base" | "promoted";
  growth: Partial<Stats>; // per-level stat growth
  promotionBonus?: Partial<Stats>; // one-time bonus applied on promotion
  learnset: { level: number; skill: string }[];
  promotesTo?: string; // base class -> promoted class id
  promoteLevel?: number; // level at which a base class promotes
}

export type ItemKind = "material" | "consumable" | "key" | "weapon" | "armor" | "accessory";
export type EquipSlot = "weapon" | "armor" | "accessory";

export interface ItemData {
  id: string;
  name: string;
  kind: ItemKind;
  description: string;
  // Equippable gear: which slot it fills, the stat bonus it grants, and an
  // optional character restriction (undefined = anyone can equip it).
  equip?: { slot: EquipSlot; bonus: Partial<Stats>; user?: string };
}
