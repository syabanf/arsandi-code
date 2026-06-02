import { stages, characters, getItem } from "../data";
import type { EquipSlot, StageData, Stats } from "../types/game";

export interface EquippedGear { weapon?: string; armor?: string; accessory?: string }
const STAT_KEYS: (keyof Stats)[] = ["hp", "energy", "atk", "def", "mag", "res", "spd", "move"];

// Per-hero progression. classId is always the BASE class; `promoted` flags
// whether the advanced class is active. Stats are kept as floats (fractional
// per-level growth) and rounded at the point of use.
export interface CharProgress {
  level: number;
  xp: number;
  promoted: boolean;
  classId: string;
  stats: Stats;
  hp: number; // current HP, persists across battles (energy stays per-battle)
}

export interface SaveData {
  stageIndex: number;
  gold: number;
  inventory: Record<string, number>;
  openedChests: string[];
  party: Record<string, CharProgress>;
  clearedEncounters?: string[];
  visitedStages?: string[];
  seenScenes?: string[];
  equipped?: Record<string, EquippedGear>;
  seenEnemies?: string[];
  quests?: Record<string, "active" | "done">;
}

// The battle the player is about to enter, set by the field before starting the
// Battle scene. "mob" = a journey encounter (minions only); "boss" = the chapter
// boss (boss + escorts).
export interface PendingBattle {
  kind: "mob" | "boss";
  enemyIds: string[];
  key?: string; // for mob fights: the encounter key to mark cleared on win
}

// Tracks progress through a single playthrough. Stages are presented to the
// player as chapters; they are ordered by index.
class RunState {
  stageIndex = 0;
  inventory: Record<string, number> = {};
  gold = 0;
  party: Record<string, CharProgress> = {};
  // The next battle to start, and where to drop the player back in the field
  // after a won mob fight. Both transient (not persisted).
  pendingBattle: PendingBattle | null = null;
  fieldReturn: { stageId: string; x: number; y: number } | null = null;
  equipped: Record<string, EquippedGear> = {};
  quests: Record<string, "active" | "done"> = {};
  private openedChests = new Set<string>();
  private clearedEncounters = new Set<string>();
  private visitedStages = new Set<string>();
  private seenScenes = new Set<string>();
  private seenEnemies = new Set<string>();

  constructor() {
    this.reset();
  }

  get stage(): StageData {
    return stages[this.stageIndex];
  }

  // Chapter aliases.
  get chapter(): StageData {
    return this.stage;
  }
  get chapterNumber(): number {
    return this.stageIndex + 1;
  }
  get totalChapters(): number {
    return stages.length;
  }

  addGold(n: number): void {
    this.gold += n;
  }

  spendGold(n: number): boolean {
    if (this.gold < n) return false;
    this.gold -= n;
    return true;
  }

  isChestOpened(key: string): boolean {
    return this.openedChests.has(key);
  }

  openChest(key: string): void {
    this.openedChests.add(key);
  }

  // ---- journey encounters ----------------------------------------------

  encounterKey(stageId: string, index: number): string {
    return `${stageId}#${index}`;
  }
  isEncounterCleared(key: string): boolean {
    return this.clearedEncounters.has(key);
  }
  clearEncounter(key: string): void {
    this.clearedEncounters.add(key);
  }
  hasVisited(stageId: string): boolean {
    return this.visitedStages.has(stageId);
  }
  markVisited(stageId: string): void {
    this.visitedStages.add(stageId);
  }

  // ---- one-time cutscene beats (prologue / preboss / midfield / epilogue) ---
  // Keyed e.g. "prologue", "preboss:stage-1", "midfield:stage-1", "epilogue:stage-1".
  hasSeenScene(key: string): boolean {
    return this.seenScenes.has(key);
  }
  markScene(key: string): void {
    this.seenScenes.add(key);
  }

  addItems(ids: string[]): void {
    for (const id of ids) this.inventory[id] = (this.inventory[id] ?? 0) + 1;
  }

  // Consume one of an item (e.g. using a battle consumable). Returns false if
  // none were held.
  consumeItem(id: string): boolean {
    if ((this.inventory[id] ?? 0) <= 0) return false;
    this.inventory[id] -= 1;
    if (this.inventory[id] <= 0) delete this.inventory[id];
    return true;
  }

  // Item ids the party currently holds, in descending quantity.
  inventoryEntries(): { id: string; count: number }[] {
    return Object.entries(this.inventory)
      .filter(([, n]) => n > 0)
      .map(([id, count]) => ({ id, count }))
      .sort((a, b) => b.count - a.count);
  }

  // ---- equipment --------------------------------------------------------

  equippedId(charId: string, slot: EquipSlot): string | undefined {
    return this.equipped[charId]?.[slot];
  }

  // Equip a held item; returns any previously-equipped piece to the inventory.
  equip(charId: string, itemId: string): boolean {
    const item = getItem(itemId);
    if (!item?.equip) return false;
    if (item.equip.user && item.equip.user !== charId) return false;
    if ((this.inventory[itemId] ?? 0) <= 0) return false;
    const cur = (this.equipped[charId] ??= {});
    const prev = cur[item.equip.slot];
    this.consumeItem(itemId);
    if (prev) this.addItems([prev]);
    cur[item.equip.slot] = itemId;
    return true;
  }

  unequip(charId: string, slot: EquipSlot): void {
    const cur = this.equipped[charId];
    const id = cur?.[slot];
    if (!cur || !id) return;
    this.addItems([id]);
    cur[slot] = undefined;
  }

  // Summed stat bonus from a character's equipped gear.
  equipBonus(charId: string): Partial<Stats> {
    const out: Partial<Stats> = {};
    const cur = this.equipped[charId];
    if (!cur) return out;
    for (const slot of ["weapon", "armor", "accessory"] as EquipSlot[]) {
      const b = cur[slot] ? getItem(cur[slot]!)?.equip?.bonus : undefined;
      if (!b) continue;
      for (const k of STAT_KEYS) if (b[k]) out[k] = (out[k] ?? 0) + (b[k] ?? 0);
    }
    return out;
  }

  // ---- bestiary ---------------------------------------------------------
  markSeen(id: string): void { this.seenEnemies.add(id); }
  isSeen(id: string): boolean { return this.seenEnemies.has(id); }
  get seenCount(): number { return this.seenEnemies.size; }

  // ---- quests -----------------------------------------------------------
  questStatus(id: string): "none" | "active" | "done" { return this.quests[id] ?? "none"; }
  startQuest(id: string): void { if (!this.quests[id]) this.quests[id] = "active"; }
  completeQuest(id: string): void { this.quests[id] = "done"; }

  get stageNumber(): number {
    return this.stageIndex + 1;
  }

  get totalStages(): number {
    return stages.length;
  }

  get isLastStage(): boolean {
    return this.stageIndex >= stages.length - 1;
  }

  advance(): boolean {
    if (this.isLastStage) return false;
    this.stageIndex += 1;
    return true;
  }

  reset(): void {
    this.stageIndex = 0;
    this.inventory = { "repair-kit": 3, "energy-cell": 3, "code-fragment": 5 };
    this.gold = 120;
    this.openedChests.clear();
    this.clearedEncounters.clear();
    this.visitedStages.clear();
    this.seenScenes.clear();
    this.pendingBattle = null;
    this.fieldReturn = null;
    this.seenEnemies.clear();
    this.quests = {};
    this.party = {};
    for (const c of characters) {
      this.party[c.id] = {
        level: 1,
        xp: 0,
        promoted: false,
        classId: c.classId,
        stats: { ...c.baseStats },
        hp: c.baseStats.hp,
      };
    }
    // each hero starts with their signature weapon equipped
    this.equipped = {
      saka: { weapon: "code-blade" },
      kara: { weapon: "code-staff" },
      zell: { weapon: "code-hammer" },
    };
  }

  // Fully restore (and revive) the whole party — used by the town's free rest.
  restParty(): void {
    for (const p of Object.values(this.party)) p.hp = Math.round(p.stats.hp);
  }

  serialize(): SaveData {
    return {
      stageIndex: this.stageIndex,
      gold: this.gold,
      inventory: { ...this.inventory },
      openedChests: [...this.openedChests],
      party: structuredClone(this.party),
      clearedEncounters: [...this.clearedEncounters],
      visitedStages: [...this.visitedStages],
      seenScenes: [...this.seenScenes],
      equipped: structuredClone(this.equipped),
      seenEnemies: [...this.seenEnemies],
      quests: { ...this.quests },
    };
  }

  load(data: SaveData): void {
    this.stageIndex = data.stageIndex;
    this.gold = data.gold;
    this.inventory = { ...data.inventory };
    this.openedChests = new Set(data.openedChests);
    this.party = structuredClone(data.party);
    this.clearedEncounters = new Set(data.clearedEncounters ?? []);
    this.visitedStages = new Set(data.visitedStages ?? []);
    this.seenScenes = new Set(data.seenScenes ?? []);
    this.equipped = structuredClone(data.equipped ?? {});
    this.seenEnemies = new Set(data.seenEnemies ?? []);
    this.quests = { ...(data.quests ?? {}) };
    this.pendingBattle = null;
    this.fieldReturn = null;
  }
}

export const runState = new RunState();
