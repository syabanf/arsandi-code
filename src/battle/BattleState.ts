import type { CharacterData, EnemyData, SkillData } from "../types/game";
import { getSkill, getSummon } from "../data";
import { runState } from "../game/runState";
import { roundedStats, knownSkills } from "../game/leveling";
import type { ActionOutcome, BattleEvent, BattleUnit, Team } from "./types";
import {
  BASIC_ATTACK,
  rollDamage,
  rollHeal,
  rollSummonDamage,
  skillEffect,
} from "./combat";
import {
  addStatus,
  consumeParalysis,
  isParalyzed,
  STATUS_DEFS,
  tickStatuses,
} from "./status";
import { splitHits, type ComboStrike } from "./combo";

let uidCounter = 0;
const nextUid = (prefix: string) => `${prefix}-${uidCounter++}`;

const startEnergy = (max: number) => Math.floor(max * 0.25);
const regenEnergy = (max: number) => Math.max(3, Math.floor(max * 0.12));

// Summon limit gauge: heroes start with a FULL gauge so a summon is available
// from turn one; it refills through combat after each use. SUMMON_MAX is the
// threshold to unleash; SUMMON_TURN_GAIN is a small trickle granted at the start
// of each of a hero's turns so a summon is reachable again even in slow fights.
const SUMMON_MAX = 100;
const SUMMON_TURN_GAIN = 7;

export function createPartyUnit(c: CharacterData, x: number, y: number): BattleUnit {
  const prog = runState.party[c.id];
  const base = prog ? roundedStats(prog) : { ...c.baseStats };
  const eq = runState.equipBonus(c.id);
  const s = { ...base } as typeof base;
  for (const k of ["hp", "energy", "atk", "def", "mag", "res", "spd", "move"] as (keyof typeof s)[]) {
    s[k] = base[k] + ((eq as Record<string, number>)[k] ?? 0);
  }
  const skills = prog ? knownSkills(prog) : [...c.skills];
  const startHp = prog ? Math.max(1, Math.min(prog.hp, s.hp)) : s.hp;
  return {
    uid: nextUid(c.id),
    dataId: c.id,
    name: c.name,
    team: "player",
    isBoss: false,
    themeColor: c.themeColor,
    spriteKey: c.sprite,
    maxHp: s.hp,
    hp: startHp,
    maxEnergy: s.energy,
    energy: startEnergy(s.energy),
    energyRegen: regenEnergy(s.energy),
    atk: s.atk,
    def: s.def,
    mag: s.mag,
    res: s.res,
    spd: s.spd,
    move: s.move,
    x,
    y,
    skillIds: skills,
    statuses: [],
    shield: 0,
    alive: true,
    summonId: c.summon ?? "",
    summonCharge: SUMMON_MAX, // start full — summon available from turn one
    summonMax: SUMMON_MAX,
    phaseIndex: 0,
    phaseCount: 0,
    phaseNames: [],
  };
}

export function createEnemyUnit(e: EnemyData, x: number, y: number): BattleUnit {
  const s = e.baseStats;
  runState.markSeen(e.id); // bestiary
  return {
    uid: nextUid(e.id),
    dataId: e.id,
    name: e.name,
    team: "enemy",
    isBoss: e.kind === "boss",
    themeColor: e.kind === "boss" ? "#ff4d6d" : "#ff8a5c",
    spriteKey: e.kind === "boss" ? `boss-${e.id}` : `minion-${e.id}`,
    maxHp: s.hp,
    hp: s.hp,
    maxEnergy: s.energy,
    energy: startEnergy(s.energy),
    energyRegen: regenEnergy(s.energy),
    atk: s.atk,
    def: s.def,
    mag: s.mag,
    res: s.res,
    spd: s.spd,
    move: s.move,
    x,
    y,
    skillIds: e.skills ? [...e.skills] : [],
    statuses: [],
    shield: 0,
    alive: true,
    summonId: "",
    summonCharge: 0,
    summonMax: 0,
    phaseIndex: 0,
    phaseCount: e.phases?.length ?? 0,
    phaseNames: e.phases?.map((p) => p.name) ?? [],
  };
}

export interface TurnInfo {
  unit: BattleUnit;
  skipped: boolean;
}

export interface PhaseTransition {
  bossUid: string;
  bannerText: string;
  events: BattleEvent[];
  defeated: string[];
  log: string[];
}

export class BattleState {
  readonly units: BattleUnit[];
  round = 0;
  private queue: string[] = [];
  private queueIndex = -1;

  constructor(
    units: BattleUnit[],
    private readonly rng: () => number = Math.random,
  ) {
    this.units = units;
  }

  byUid(uid: string): BattleUnit | undefined {
    return this.units.find((u) => u.uid === uid);
  }

  alive(team?: Team): BattleUnit[] {
    return this.units.filter((u) => u.alive && (team ? u.team === team : true));
  }

  enemiesOf(unit: BattleUnit): BattleUnit[] {
    return this.alive().filter((u) => u.team !== unit.team);
  }

  alliesOf(unit: BattleUnit): BattleUnit[] {
    return this.alive().filter((u) => u.team === unit.team);
  }

  // ---- turn order -------------------------------------------------------

  start(): TurnInfo | null {
    this.round = 1;
    this.buildQueue();
    this.queueIndex = -1;
    return this.advance();
  }

  private buildQueue(): void {
    this.queue = this.alive()
      .sort((a, b) => {
        if (b.spd !== a.spd) return b.spd - a.spd;
        if (a.team !== b.team) return a.team === "player" ? -1 : 1;
        return a.uid.localeCompare(b.uid);
      })
      .map((u) => u.uid);
  }

  advance(): TurnInfo | null {
    for (let guard = 0; guard < 1000; guard++) {
      this.queueIndex++;
      if (this.queueIndex >= this.queue.length) {
        this.round++;
        this.buildQueue();
        this.queueIndex = 0;
      }
      if (this.queue.length === 0) return null;
      const unit = this.byUid(this.queue[this.queueIndex]);
      if (!unit || !unit.alive) continue;

      unit.energy = Math.min(unit.maxEnergy, unit.energy + unit.energyRegen);
      this.gainCharge(unit, SUMMON_TURN_GAIN);
      if (isParalyzed(unit)) {
        consumeParalysis(unit);
        tickStatuses(unit);
        return { unit, skipped: true };
      }
      return { unit, skipped: false };
    }
    return null;
  }

  endTurn(unit: BattleUnit): void {
    tickStatuses(unit);
  }

  victor(): Team | null {
    if (this.alive("enemy").length === 0) return "player";
    if (this.alive("player").length === 0) return "enemy";
    return null;
  }

  // ---- targeting (front-view: no grid, target by uid) -------------------

  // Skill ids currently usable. Phased bosses unlock more of their kit
  // (ordered weak -> strong) as their phase advances.
  availableSkillIds(unit: BattleUnit): string[] {
    if (unit.phaseCount > 1 && unit.skillIds.length > 0) {
      const unlocked = Math.ceil((unit.skillIds.length * (unit.phaseIndex + 1)) / unit.phaseCount);
      return unit.skillIds.slice(0, Math.max(1, unlocked));
    }
    return unit.skillIds;
  }

  skillsFor(unit: BattleUnit): SkillData[] {
    const list = [BASIC_ATTACK];
    for (const id of this.availableSkillIds(unit)) {
      const s = getSkill(id);
      if (s) list.push(s);
    }
    return list;
  }

  canAfford(unit: BattleUnit, skill: SkillData): boolean {
    return unit.energy >= skill.cost;
  }

  // Does the player need to pick a specific target for this skill, or does it
  // resolve automatically (self / whole team / all enemies)?
  needsTarget(skill: SkillData): boolean {
    return skill.targeting === "single" || skill.targeting === "ally";
  }

  // The units a skill will affect. For single/ally the caller passes the chosen
  // target's uid; everything else is derived from the team. "area" is treated as
  // hit-all-enemies in the front-view layout.
  targetsFor(unit: BattleUnit, skill: SkillData, targetUid?: string): BattleUnit[] {
    switch (skill.targeting) {
      case "self":
        return [unit];
      case "all-enemies":
      case "area":
        return this.enemiesOf(unit);
      case "all-allies":
        return this.alliesOf(unit);
      case "ally": {
        const t = targetUid ? this.byUid(targetUid) : undefined;
        if (t && t.alive && t.team === unit.team) return [t];
        return this.alliesOf(unit).slice(0, 1);
      }
      case "single":
      default: {
        const t = targetUid ? this.byUid(targetUid) : undefined;
        if (t && t.alive && t.team !== unit.team) return [t];
        return this.enemiesOf(unit).slice(0, 1);
      }
    }
  }

  // ---- resolution -------------------------------------------------------

  // combo (optional): a Legaia-style chain the player tapped while attacking. It
  // scales the hit (mult) and, on a single target, fractures it into several
  // visible strikes (jabs) plus an emphasised finisher. Absent for enemies and
  // for utility skills, in which case this resolves exactly as before.
  resolve(unit: BattleUnit, skill: SkillData, targetUid?: string, combo?: ComboStrike): ActionOutcome {
    unit.energy = Math.max(0, unit.energy - skill.cost);
    const eff = skillEffect(skill);
    const events: BattleEvent[] = [];
    const defeated: string[] = [];
    const log: string[] = [];

    for (const s of eff.selfStatuses) {
      addStatus(unit, s);
      events.push({ uid: unit.uid, kind: "buff", text: STATUS_DEFS[s].label });
    }
    if (eff.selfStatuses.length > 0) {
      log.push(`${unit.name} uses ${skill.name}.`);
    }

    const targets = this.targetsFor(unit, skill, targetUid);
    // A combo flurry only fractures into multiple hits for a single-target action
    // (the basic attack or a single-target damaging skill); an area/all-enemies
    // skill just scales each enemy's single hit — even when only one enemy is
    // alive, so the engine's split matches the renderer's cascade-vs-AoE choice
    // (Battle3D keys its staggered cascade on this same `targeting === "single"`).
    const multiHit = !!combo && skill.targeting === "single";
    const mult = combo ? combo.mult : 1;
    for (const t of targets) {
      if (eff.dealsDamage) {
        const roll = rollDamage(unit, t, skill, this.rng);
        if (roll.missed) {
          events.push({ uid: t.uid, kind: "miss", text: "MISS" });
          log.push(`${unit.name}'s ${skill.name} missed ${t.name}.`);
        } else if (multiHit) {
          // Legaia-style flurry: split the combo-scaled hit into several visible
          // strikes plus an emphasised finisher when an art landed. Stop early if
          // a strike fells the target so we never pummel a corpse.
          const total = Math.round(roll.amount * mult);
          const parts = splitHits(total, combo!.jabs, combo!.finisher);
          let dealt = 0;
          let landed = 0;
          for (let h = 0; h < parts.length; h++) {
            if (!t.alive) break;
            const applied = this.applyDamage(t, parts[h]);
            const isFin = combo!.finisher && h === parts.length - 1;
            if (applied.blocked) {
              events.push({ uid: t.uid, kind: "blocked", text: "BLOCK" });
            } else {
              events.push({ uid: t.uid, kind: "damage", amount: applied.dmg, crit: isFin || roll.crit });
              dealt += applied.dmg;
              landed++;
            }
          }
          if (unit.team === "player" && dealt > 0) this.gainCharge(unit, Math.round(dealt / 4) + 1);
          log.push(`${unit.name} chains ${landed} hit${landed === 1 ? "" : "s"} on ${t.name} for ${dealt}!`);
          if (!t.alive) defeated.push(t.uid);
        } else {
          const applied = this.applyDamage(t, Math.round(roll.amount * mult));
          if (applied.blocked) {
            events.push({ uid: t.uid, kind: "blocked", text: "BLOCK" });
          } else {
            events.push({ uid: t.uid, kind: "damage", amount: applied.dmg, crit: roll.crit });
            log.push(`${unit.name} hits ${t.name} for ${applied.dmg}${roll.crit ? " (crit!)" : ""}.`);
          }
          // dealing damage builds the attacker's own summon gauge (heroes only)
          if (unit.team === "player" && applied.dmg > 0) this.gainCharge(unit, Math.round(applied.dmg / 4) + 1);
          if (!t.alive) defeated.push(t.uid);
        }
      }
      if (eff.heals) {
        const amt = rollHeal(unit, skill, this.rng);
        t.hp = Math.min(t.maxHp, t.hp + amt);
        events.push({ uid: t.uid, kind: "heal", amount: amt });
        log.push(`${unit.name} restores ${amt} HP to ${t.name}.`);
      }
      if (eff.shield > 0) {
        t.shield += eff.shield;
        events.push({ uid: t.uid, kind: "buff", text: "SHIELD" });
        log.push(`${unit.name} shields ${t.name}.`);
      }
      for (const s of eff.targetStatuses) {
        if (t.alive) {
          addStatus(t, s);
          events.push({ uid: t.uid, kind: "status", text: STATUS_DEFS[s].label });
        }
      }
    }

    if (log.length === 0) log.push(`${unit.name} uses ${skill.name}.`);
    return { actorUid: unit.uid, skillId: skill.id, skillName: skill.name, events, defeated, log };
  }

  // GUARD command: brace for the next hits — a defence buff plus a small shield.
  guard(unit: BattleUnit): ActionOutcome {
    addStatus(unit, "def-up");
    const shield = Math.max(8, Math.round(unit.maxHp * 0.08));
    unit.shield += shield;
    return {
      actorUid: unit.uid,
      skillId: "guard",
      skillName: "Guard",
      events: [{ uid: unit.uid, kind: "buff", text: "GUARD" }],
      defeated: [],
      log: [`${unit.name} guards.`],
    };
  }

  // ---- summon -----------------------------------------------------------

  // A hero may unleash their summon only when their gauge is full and they own
  // a valid summon. Enemies have summonMax 0 and can never summon.
  canSummon(unit: BattleUnit): boolean {
    return (
      unit.team === "player" &&
      unit.alive &&
      unit.summonMax > 0 &&
      unit.summonCharge >= unit.summonMax &&
      !!getSummon(unit.summonId)
    );
  }

  // Unleash a hero's summon. Spends the whole gauge and applies the summon's
  // signature compound effect (damage and/or party heal/cleanse/shield/buff) in
  // a single ActionOutcome — animate() iterates every event kind it carries.
  // powerMul scales the ultimate's potency (>1) when the player nails the
  // Legaia-style combo input on summon; 1 = a clean unleash with no combo bonus.
  summon(unit: BattleUnit, powerMul = 1): ActionOutcome {
    const data = getSummon(unit.summonId);
    unit.summonCharge = 0;
    const mul = Math.max(1, powerMul);
    const events: BattleEvent[] = [];
    const defeated: string[] = [];
    const shortName = data ? data.name.split(",")[0] : "summon";
    const log: string[] = [`${unit.name} calls upon ${shortName}!`];
    if (!data) {
      return { actorUid: unit.uid, skillId: "summon", skillName: "Summon", events, defeated, log };
    }
    log.push(`${shortName} unleashes ${data.ultimate}!`);
    const eff = data.effect;

    if (eff.damageAll || eff.damageSingle) {
      const foes = this.enemiesOf(unit);
      const targets = eff.damageSingle
        ? [...foes].sort((a, b) => b.maxHp - a.maxHp).slice(0, 1)
        : foes;
      for (const t of targets) {
        const dmg = Math.round(rollSummonDamage(unit, t, data.power, this.rng) * mul);
        const applied = this.applyDamage(t, dmg);
        if (applied.blocked) {
          events.push({ uid: t.uid, kind: "blocked", text: "BLOCK" });
        } else {
          events.push({ uid: t.uid, kind: "damage", amount: applied.dmg, crit: true });
          log.push(`${data.ultimate} hits ${t.name} for ${applied.dmg}!`);
        }
        if (eff.defBreak && t.alive) {
          addStatus(t, "def-down");
          events.push({ uid: t.uid, kind: "status", text: STATUS_DEFS["def-down"].label });
        }
        if (!t.alive) defeated.push(t.uid);
      }
    }

    const allies = this.alliesOf(unit);
    if (eff.healParty) {
      const power = Math.round((eff.healParty + Math.floor(unit.mag * 0.4)) * mul);
      for (const a of allies) {
        const amt = Math.min(power, a.maxHp - a.hp);
        if (amt > 0) {
          a.hp += amt;
          events.push({ uid: a.uid, kind: "heal", amount: amt });
        }
      }
      log.push(`${shortName} mends the party.`);
    }
    if (eff.cleanse) {
      for (const a of allies) {
        const had = a.statuses.some((s) => s.kind === "def-down" || s.kind === "paralysis");
        a.statuses = a.statuses.filter((s) => s.kind !== "def-down" && s.kind !== "paralysis");
        if (had) events.push({ uid: a.uid, kind: "buff", text: "CLEANSED" });
      }
    }
    if (eff.shieldParty) {
      const shield = Math.round(eff.shieldParty * mul);
      for (const a of allies) {
        a.shield += shield;
        events.push({ uid: a.uid, kind: "buff", text: "SHIELD" });
      }
    }
    if (eff.partyBuff) {
      for (const a of allies) {
        for (const b of eff.partyBuff) {
          addStatus(a, b);
          events.push({ uid: a.uid, kind: "buff", text: STATUS_DEFS[b].label });
        }
      }
    }

    return { actorUid: unit.uid, skillId: "summon", skillName: data.ultimate, events, defeated, log };
  }

  // Add to a unit's summon gauge (clamped). No-op for units that can't summon
  // (summonMax 0) or that are already down.
  private gainCharge(unit: BattleUnit, amount: number): void {
    if (unit.summonMax <= 0 || !unit.alive || amount <= 0) return;
    unit.summonCharge = Math.min(unit.summonMax, unit.summonCharge + amount);
  }

  private applyDamage(t: BattleUnit, amount: number): { dmg: number; blocked: boolean } {
    let dmg = amount;
    if (t.shield > 0) {
      const absorbed = Math.min(t.shield, dmg);
      t.shield -= absorbed;
      dmg -= absorbed;
    }
    t.hp = Math.max(0, t.hp - dmg);
    if (t.hp <= 0) t.alive = false;
    // taking a hit builds the victim's summon gauge (heroes only; the early
    // t.alive=false above means a killing blow grants nothing)
    if (t.team === "player" && dmg > 0) this.gainCharge(t, Math.round(dmg / 3) + 1);
    return { dmg, blocked: dmg === 0 };
  }

  // ---- boss phases ------------------------------------------------------

  // Advances any phased boss whose HP has crossed a phase threshold. Call after
  // each action resolves; returns the transitions to animate (banner + AoE).
  checkPhaseTransitions(): PhaseTransition[] {
    const out: PhaseTransition[] = [];
    for (const boss of this.units) {
      if (!boss.alive || boss.phaseCount <= 1) continue;
      const hpFrac = boss.hp / boss.maxHp;
      const desired = Math.min(boss.phaseCount - 1, Math.floor((1 - hpFrac) * boss.phaseCount));
      while (boss.phaseIndex < desired) {
        out.push(this.advancePhase(boss));
      }
    }
    return out;
  }

  private advancePhase(boss: BattleUnit): PhaseTransition {
    boss.phaseIndex += 1;
    boss.atk = Math.round(boss.atk * 1.18);
    boss.mag = Math.round(boss.mag * 1.18);
    boss.def += 4;
    boss.res += 2;
    boss.shield += Math.round(boss.maxHp * 0.1);

    const name = boss.phaseNames[boss.phaseIndex] ?? `Phase ${boss.phaseIndex + 1}`;
    const events: BattleEvent[] = [{ uid: boss.uid, kind: "buff", text: "SHIELD" }];
    const defeated: string[] = [];
    const log: string[] = [`${boss.name} shifts — ${name}!`];

    const aoe = Math.round(boss.mag * 0.45) + 6;
    for (const t of this.enemiesOf(boss)) {
      const applied = this.applyDamage(t, aoe);
      if (applied.blocked) {
        events.push({ uid: t.uid, kind: "blocked", text: "BLOCK" });
      } else {
        events.push({ uid: t.uid, kind: "damage", amount: applied.dmg });
        log.push(`${boss.name}'s surge hits ${t.name} for ${applied.dmg}.`);
      }
      if (!t.alive) defeated.push(t.uid);
    }

    return { bossUid: boss.uid, bannerText: name.toUpperCase(), events, defeated, log };
  }
}
