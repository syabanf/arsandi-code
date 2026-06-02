import type { SkillData } from "../types/game";
import type { BattleUnit, StatusKind } from "./types";
import { effAtk, effDef, effRes, evadeChance } from "./status";

export type Rng = () => number;

// The implicit basic attack every unit can perform.
export const BASIC_ATTACK: SkillData = {
  id: "basic",
  name: "Attack",
  owner: "",
  kind: "physical",
  element: "physical",
  cost: 0,
  power: 14,
  range: 1,
  targeting: "single",
  description: "A basic weapon strike.",
};

export const isMagical = (skill: SkillData): boolean => skill.kind === "magical";

const BASE_CRIT = 0.06;

// Saka's "Code Sense" passive: crit chance spikes while badly hurt.
function critChance(actor: BattleUnit): number {
  let c = BASE_CRIT;
  if (actor.dataId === "saka" && actor.hp <= actor.maxHp * 0.3) c += 0.4;
  return c;
}

export interface DamageRoll {
  amount: number;
  crit: boolean;
  missed: boolean;
}

export function rollDamage(
  actor: BattleUnit,
  target: BattleUnit,
  skill: SkillData,
  rng: Rng = Math.random,
): DamageRoll {
  if (rng() < evadeChance(target)) return { amount: 0, crit: false, missed: true };

  const atkStat = isMagical(skill) ? actor.mag : effAtk(actor);
  const defStat = isMagical(skill) ? effRes(target) : effDef(target);
  const base = Math.max(1, skill.power + atkStat - defStat);
  const crit = rng() < critChance(actor);
  const variance = 0.9 + rng() * 0.2;
  const amount = Math.max(1, Math.round(base * (crit ? 1.5 : 1) * variance));
  return { amount, crit, missed: false };
}

// Deterministic expected damage, used by the AI to score actions.
export function estimateDamage(actor: BattleUnit, target: BattleUnit, skill: SkillData): number {
  const atkStat = isMagical(skill) ? actor.mag : effAtk(actor);
  const defStat = isMagical(skill) ? effRes(target) : effDef(target);
  return Math.max(1, skill.power + atkStat - defStat);
}

export function rollHeal(actor: BattleUnit, skill: SkillData, rng: Rng = Math.random): number {
  const base = skill.power + Math.floor(actor.mag * 0.5);
  return Math.max(1, Math.round(base * (0.9 + rng() * 0.2)));
}

// Summon ultimates are big, flashy, and reliable: they never miss and only
// partially respect the target's resistance. Scales off the summoner's mag/atk.
export function rollSummonDamage(
  actor: BattleUnit,
  target: BattleUnit,
  power: number,
  rng: Rng = Math.random,
): number {
  const base = power + Math.round(actor.mag * 0.6 + actor.atk * 0.3) - Math.round(effRes(target) * 0.35);
  const variance = 0.92 + rng() * 0.16;
  return Math.max(1, Math.round(Math.max(1, base) * variance));
}

export interface SkillEffect {
  dealsDamage: boolean;
  heals: boolean;
  shield: number; // flat absorb applied to each affected ally (0 = none)
  targetStatuses: StatusKind[];
  selfStatuses: StatusKind[];
}

// Maps a skill to the concrete effects it applies. Driven by id for the handful
// of special skills, falling back to sensible behaviour by kind.
export function skillEffect(skill: SkillData): SkillEffect {
  const e: SkillEffect = {
    dealsDamage: false,
    heals: false,
    shield: 0,
    targetStatuses: [],
    selfStatuses: [],
  };

  switch (skill.id) {
    case "overwrite":
    case "glitch-field":
    case "corrupt-strike":
      e.dealsDamage = true;
      e.targetStatuses = ["def-down"];
      return e;
    case "data-paralysis":
      e.targetStatuses = ["paralysis"];
      return e;
    case "shock-bolt":
      e.dealsDamage = true;
      e.targetStatuses = ["paralysis"];
      return e;
    case "enrage":
      e.selfStatuses = ["atk-up"];
      return e;
    case "glitch-step":
      e.selfStatuses = ["evasion-up"];
      return e;
    case "overdrive":
      e.selfStatuses = ["atk-up", "def-up"];
      return e;
    case "code-shield":
      e.shield = 25;
      return e;
  }

  switch (skill.kind) {
    case "heal":
      e.heals = true;
      break;
    case "buff":
    case "support":
      // Generic buffs with no special mapping do nothing harmful; leave inert.
      break;
    default:
      // physical / magical / debuff with power deal damage.
      e.dealsDamage = skill.power > 0 || skill.id === "basic";
  }
  return e;
}
