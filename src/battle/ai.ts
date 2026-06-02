import type { SkillData } from "../types/game";
import { BASIC_ATTACK, estimateDamage, skillEffect } from "./combat";
import type { BattleState } from "./BattleState";
import type { BattleUnit } from "./types";

export interface AiPlan {
  skill: SkillData;
  targetUid: string | null; // chosen target for single/ally; null for self / all-*
}

// Front-view AI: no movement. Score every affordable action — damage (prefer
// finishing blows), heals (when an ally is hurt), and self-buffs — and pick the
// best. Falls back to a basic attack on the weakest foe.
export function planFrontTurn(state: BattleState, unit: BattleUnit): AiPlan {
  const foes = state.enemiesOf(unit);
  const allies = state.alliesOf(unit);
  const skills = state.skillsFor(unit).filter((s) => state.canAfford(unit, s));

  const candidates: { score: number; skill: SkillData; targetUid: string | null }[] = [];
  const consider = (score: number, skill: SkillData, targetUid: string | null) => {
    candidates.push({ score, skill, targetUid });
  };

  for (const skill of skills) {
    const eff = skillEffect(skill);

    if (eff.heals) {
      const hurt = allies.filter((a) => a.hp < a.maxHp);
      if (hurt.length > 0) {
        const t = hurt.reduce((a, b) => (a.maxHp - a.hp >= b.maxHp - b.hp ? a : b));
        const healEst = skill.power + Math.floor(unit.mag * 0.5);
        const missing = t.maxHp - t.hp;
        const urgency = t.hp < t.maxHp * 0.5 ? 1.5 : 0.7;
        consider(Math.min(missing, healEst) * urgency, skill, t.uid);
      }
      continue;
    }

    if (eff.dealsDamage) {
      if (foes.length === 0) continue;
      if (skill.targeting === "all-enemies" || skill.targeting === "area") {
        const score = foes.reduce((a, f) => a + Math.min(estimateDamage(unit, f, skill), f.hp), 0) * 1.05;
        consider(score, skill, null);
      } else {
        for (const foe of foes) {
          let score = estimateDamage(unit, foe, skill);
          if (score >= foe.hp) score += 1000; // finishing blow
          consider(score, skill, foe.uid);
        }
      }
      continue;
    }

    // Self buffs / shields: worthwhile, but not if already active.
    if (eff.selfStatuses.length > 0 || eff.shield > 0) {
      const already = eff.selfStatuses.some((s) => unit.statuses.some((st) => st.kind === s));
      consider(already ? 2 : 26, skill, null);
    }

    // Pure debuffs (e.g. paralysis): hit a foe that doesn't already have it.
    if (eff.targetStatuses.length > 0 && !eff.dealsDamage && foes.length > 0) {
      const fresh = foes.find((f) => !f.statuses.some((st) => eff.targetStatuses.includes(st.kind))) ?? foes[0];
      consider(16, skill, fresh.uid);
    }
  }

  if (candidates.length > 0) {
    const best = candidates.reduce((a, b) => (b.score > a.score ? b : a));
    return { skill: best.skill, targetUid: best.targetUid };
  }

  const weakest = foes.length > 0 ? foes.reduce((a, b) => (a.hp <= b.hp ? a : b)) : null;
  return { skill: BASIC_ATTACK, targetUid: weakest ? weakest.uid : null };
}
