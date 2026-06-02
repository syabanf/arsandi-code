import type { BattleUnit, StatusKind } from "./types";

// Default magnitudes/durations for each status, applied when a skill inflicts it.
export const STATUS_DEFS: Record<StatusKind, { turns: number; magnitude: number; label: string }> = {
  "def-down": { turns: 2, magnitude: 0.3, label: "DEF-" },
  "atk-up": { turns: 3, magnitude: 0.4, label: "ATK+" },
  "def-up": { turns: 3, magnitude: 0.4, label: "DEF+" },
  paralysis: { turns: 1, magnitude: 1, label: "PARALYZED" },
  "evasion-up": { turns: 1, magnitude: 0.4, label: "EVA+" },
};

export function addStatus(unit: BattleUnit, kind: StatusKind): void {
  const def = STATUS_DEFS[kind];
  const existing = unit.statuses.find((s) => s.kind === kind);
  if (existing) {
    existing.turns = Math.max(existing.turns, def.turns);
    existing.magnitude = def.magnitude;
  } else {
    unit.statuses.push({ kind, turns: def.turns, magnitude: def.magnitude });
  }
}

const sumMagnitude = (unit: BattleUnit, kind: StatusKind): number =>
  unit.statuses.filter((s) => s.kind === kind).reduce((a, s) => a + s.magnitude, 0);

export const effAtk = (u: BattleUnit): number =>
  Math.round(u.atk * (1 + sumMagnitude(u, "atk-up")));

export const effDef = (u: BattleUnit): number =>
  Math.max(0, Math.round(u.def * (1 + sumMagnitude(u, "def-up") - sumMagnitude(u, "def-down"))));

export const effRes = (u: BattleUnit): number =>
  Math.max(0, Math.round(u.res * (1 + sumMagnitude(u, "def-up") - sumMagnitude(u, "def-down"))));

export const evadeChance = (u: BattleUnit): number => sumMagnitude(u, "evasion-up");

export const isParalyzed = (u: BattleUnit): boolean =>
  u.statuses.some((s) => s.kind === "paralysis");

// Consume one paralysis stack (called when the unit's turn would begin).
export function consumeParalysis(u: BattleUnit): void {
  const i = u.statuses.findIndex((s) => s.kind === "paralysis");
  if (i >= 0) u.statuses.splice(i, 1);
}

// Tick down durations at the end of a unit's turn; drop expired statuses.
// Paralysis is consumed separately at turn start, so it is left untouched here.
export function tickStatuses(u: BattleUnit): void {
  u.statuses = u.statuses.filter((s) => {
    if (s.kind === "paralysis") return true;
    s.turns -= 1;
    return s.turns > 0;
  });
}

export const statusLabels = (u: BattleUnit): string[] =>
  u.statuses.map((s) => STATUS_DEFS[s.kind].label);
