// Runtime types for the tactical battle engine. These are deliberately free of
// any Phaser dependency so the engine can be reasoned about (and tested) on its
// own; the BattleScene is just a renderer/controller on top.

export type Team = "player" | "enemy";

export type StatusKind =
  | "def-down"
  | "atk-up"
  | "def-up"
  | "paralysis"
  | "evasion-up";

export interface Status {
  kind: StatusKind;
  turns: number; // remaining turns; paralysis is consumed on the unit's turn
  magnitude: number; // fraction for stat mods / evade chance
}

export interface BattleUnit {
  uid: string; // unique per battle instance
  dataId: string; // character or enemy id
  name: string;
  team: Team;
  isBoss: boolean;
  themeColor: string;
  spriteKey?: string; // party members render a sprite; enemies render a token

  maxHp: number;
  hp: number;
  maxEnergy: number;
  energy: number;
  energyRegen: number;

  atk: number;
  def: number;
  mag: number;
  res: number;
  spd: number;
  move: number;

  x: number;
  y: number;

  skillIds: string[]; // usable skills (basic attack is implicit)
  statuses: Status[];
  shield: number; // remaining damage-absorb pool
  alive: boolean;

  // summon limit gauge (per-battle): charge builds from damage dealt and taken;
  // at summonCharge >= summonMax the unit may unleash its summon. summonMax 0
  // means the unit can never summon (all enemies).
  summonId: string; // summon data id, "" = none
  summonCharge: number;
  summonMax: number;

  // boss phases (phaseCount 0 = not a phased boss)
  phaseIndex: number;
  phaseCount: number;
  phaseNames: string[];
}

export type EventKind = "damage" | "heal" | "miss" | "blocked" | "status" | "buff";

export interface BattleEvent {
  uid: string;
  kind: EventKind;
  amount?: number;
  crit?: boolean;
  text?: string; // floating popup text override
}

export interface ActionOutcome {
  actorUid: string;
  skillId: string; // "basic" for the basic attack
  skillName: string;
  events: BattleEvent[];
  defeated: string[]; // uids that died as a result
  log: string[];
}

export type Targeting =
  | "single"
  | "ally"
  | "self"
  | "area"
  | "all-enemies"
  | "all-allies";
