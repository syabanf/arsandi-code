import { characters, getClass, getSkill } from "../data";
import type { ClassData, EnemyData, Stats } from "../types/game";
import { runState, type CharProgress } from "./runState";

const STAT_KEYS: (keyof Stats)[] = ["hp", "energy", "atk", "def", "mag", "res", "spd", "move"];

// XP required to advance from `level` to the next.
export function xpToNext(level: number): number {
  return 20 + level * 20 + level * level * 5;
}

// XP a defeated enemy is worth, derived from its stats; bosses are worth more.
export function enemyXp(e: EnemyData): number {
  const s = e.baseStats;
  const base = Math.round(s.hp / 6 + s.atk + s.mag + s.def / 2);
  return e.kind === "boss" ? base * 3 : base;
}

export function baseClassOf(p: CharProgress): ClassData {
  return getClass(p.classId);
}

export function currentClass(p: CharProgress): ClassData {
  const base = baseClassOf(p);
  if (p.promoted && base.promotesTo) {
    const prom = getClass(base.promotesTo);
    if (prom) return prom;
  }
  return base;
}

// Skills known at the current level: base learnset (always) + promoted learnset
// once promoted, each gated by learn-level.
export function knownSkills(p: CharProgress): string[] {
  const base = baseClassOf(p);
  const ids = base.learnset.filter((l) => l.level <= p.level).map((l) => l.skill);
  if (p.promoted && base.promotesTo) {
    const prom = getClass(base.promotesTo);
    if (prom) ids.push(...prom.learnset.filter((l) => l.level <= p.level).map((l) => l.skill));
  }
  return ids;
}

export function roundedStats(p: CharProgress): Stats {
  const out = {} as Stats;
  for (const k of STAT_KEYS) out[k] = Math.round(p.stats[k]);
  return out;
}

export function xpProgress(p: CharProgress): { cur: number; next: number } {
  return { cur: p.xp, next: xpToNext(p.level) };
}

function applyStats(p: CharProgress, delta: Partial<Stats>): void {
  for (const k of STAT_KEYS) p.stats[k] += delta[k] ?? 0;
}

export interface LevelUpEvent {
  charId: string;
  name: string;
  fromLevel: number;
  toLevel: number;
  learned: string[]; // skill display names
  promotedTo?: string; // promoted class name, if promotion happened
}

// Awards XP to every party member, processing level-ups (stat growth + skills)
// and auto-promotion. Returns a summary for the victory screen.
export function awardXp(total: number): LevelUpEvent[] {
  const events: LevelUpEvent[] = [];

  for (const c of characters) {
    const p = runState.party[c.id];
    if (!p) continue;
    const fromLevel = p.level;
    const before = new Set(knownSkills(p));
    let promotedTo: string | undefined;

    p.xp += total;
    while (p.xp >= xpToNext(p.level)) {
      p.xp -= xpToNext(p.level);
      p.level += 1;
      applyStats(p, currentClass(p).growth);

      const base = baseClassOf(p);
      if (!p.promoted && base.promoteLevel && p.level >= base.promoteLevel && base.promotesTo) {
        p.promoted = true;
        const prom = getClass(base.promotesTo);
        if (prom?.promotionBonus) applyStats(p, prom.promotionBonus);
        promotedTo = prom?.name;
      }
    }

    if (p.level > fromLevel) {
      const learned = knownSkills(p)
        .filter((id) => !before.has(id))
        .map((id) => getSkill(id)?.name ?? id);
      events.push({ charId: c.id, name: c.name, fromLevel, toLevel: p.level, learned, promotedTo });
    }
  }

  return events;
}
