// Headless battle-balance simulator for the chapter mob gauntlets.
//
// Mirrors the real combat model (src/battle/{combat,status,ai,BattleState}.ts +
// src/game/leveling.ts) in plain JS so we can run thousands of fights and read
// the difficulty curve. Run with:  node tools/sim.mjs  [trials]
//
// MODELING NOTES:
//  - Auto-battle: every unit (party + enemy) uses the game's planFrontTurn AI.
//  - Two passes are reported, bracketing real difficulty:
//      FLOOR     = no summons, no attack-combos. The hardest realistic case
//                  (an unskilled player who never summons). Good for spotting
//                  over-attrition.
//      TACTICAL  = heroes summon reactively (Kara heals when an ally is low;
//                  Saka/Zell burst on 3+ foe waves or when the party is hurt).
//                  Combos still NOT modeled, so real play with combos is a bit
//                  easier still. Closer to how the game actually plays.
//  - Per the real engine, each wave is a fresh battle: HP persists between
//    waves, but energy + summon gauge reset (gauges start FULL every fight).
//  - Party levels derive from cumulative XP earned clearing prior chapters'
//    (new) content, so the party scales with the added monsters.
//  - GAUNTLET = a chapter's mob waves fought back-to-back to the boss gate.
//    Items (3 starting repair-kits, etc.) are NOT modeled — extra headroom.

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const load = async (f) => JSON.parse(await readFile(join(root, "src", "data", f), "utf8"));
const [enemies, stages, classes, characters, skills, items, summons] = await Promise.all(
  ["enemies.json", "stages.json", "classes.json", "characters.json", "skills.json", "items.json", "summons.json"].map(load),
);
const enemyById = new Map(enemies.map((e) => [e.id, e]));
const skillById = new Map(skills.map((s) => [s.id, s]));
const classById = new Map(classes.map((c) => [c.id, c]));
const itemById = new Map(items.map((i) => [i.id, i]));
const summonById = new Map(summons.map((s) => [s.id, s]));

const STAT_KEYS = ["hp", "energy", "atk", "def", "mag", "res", "spd", "move"];
const BASIC_ATTACK = { id: "basic", name: "Attack", kind: "physical", element: "physical", cost: 0, power: 14, range: 1, targeting: "single" };
const STATUS_DEFS = {
  "def-down": { turns: 2, magnitude: 0.3 }, "atk-up": { turns: 3, magnitude: 0.4 },
  "def-up": { turns: 3, magnitude: 0.4 }, paralysis: { turns: 1, magnitude: 1 },
  "evasion-up": { turns: 1, magnitude: 0.4 },
};
const SUMMON_MAX = 100, SUMMON_TURN_GAIN = 7;

function rngFor(seed) { let s = seed >>> 0; return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

const sumMag = (u, k) => u.statuses.filter((s) => s.kind === k).reduce((a, s) => a + s.magnitude, 0);
const effAtk = (u) => Math.round(u.atk * (1 + sumMag(u, "atk-up")));
const effDef = (u) => Math.max(0, Math.round(u.def * (1 + sumMag(u, "def-up") - sumMag(u, "def-down"))));
const effRes = (u) => Math.max(0, Math.round(u.res * (1 + sumMag(u, "def-up") - sumMag(u, "def-down"))));
const evadeChance = (u) => sumMag(u, "evasion-up");
const isParalyzed = (u) => u.statuses.some((s) => s.kind === "paralysis");
function addStatus(u, kind) { const def = STATUS_DEFS[kind]; const ex = u.statuses.find((s) => s.kind === kind); if (ex) { ex.turns = Math.max(ex.turns, def.turns); ex.magnitude = def.magnitude; } else u.statuses.push({ kind, turns: def.turns, magnitude: def.magnitude }); }
function consumeParalysis(u) { const i = u.statuses.findIndex((s) => s.kind === "paralysis"); if (i >= 0) u.statuses.splice(i, 1); }
function tickStatuses(u) { u.statuses = u.statuses.filter((s) => { if (s.kind === "paralysis") return true; s.turns -= 1; return s.turns > 0; }); }

const isMagical = (sk) => sk.kind === "magical";
function critChance(a) { let c = 0.06; if (a.dataId === "saka" && a.hp <= a.maxHp * 0.3) c += 0.4; return c; }
function rollDamage(a, t, sk, rng) {
  if (rng() < evadeChance(t)) return { amount: 0, missed: true };
  const atk = isMagical(sk) ? a.mag : effAtk(a), def = isMagical(sk) ? effRes(t) : effDef(t);
  const base = Math.max(1, sk.power + atk - def), crit = rng() < critChance(a), variance = 0.9 + rng() * 0.2;
  return { amount: Math.max(1, Math.round(base * (crit ? 1.5 : 1) * variance)), missed: false };
}
const estimateDamage = (a, t, sk) => Math.max(1, sk.power + (isMagical(sk) ? a.mag : effAtk(a)) - (isMagical(sk) ? effRes(t) : effDef(t)));
const rollHeal = (a, sk, rng) => Math.max(1, Math.round((sk.power + Math.floor(a.mag * 0.5)) * (0.9 + rng() * 0.2)));
const rollSummonDamage = (a, t, power, rng) => { const base = power + Math.round(a.mag * 0.6 + a.atk * 0.3) - Math.round(effRes(t) * 0.35); return Math.max(1, Math.round(Math.max(1, base) * (0.92 + rng() * 0.16))); };
function skillEffect(sk) {
  const e = { dealsDamage: false, heals: false, shield: 0, targetStatuses: [], selfStatuses: [] };
  switch (sk.id) {
    case "overwrite": case "glitch-field": case "corrupt-strike": e.dealsDamage = true; e.targetStatuses = ["def-down"]; return e;
    case "data-paralysis": e.targetStatuses = ["paralysis"]; return e;
    case "shock-bolt": e.dealsDamage = true; e.targetStatuses = ["paralysis"]; return e;
    case "enrage": e.selfStatuses = ["atk-up"]; return e;
    case "glitch-step": e.selfStatuses = ["evasion-up"]; return e;
    case "overdrive": e.selfStatuses = ["atk-up", "def-up"]; return e;
    case "code-shield": e.shield = 25; return e;
  }
  if (sk.kind === "heal") e.heals = true;
  else if (sk.kind !== "buff" && sk.kind !== "support") e.dealsDamage = sk.power > 0 || sk.id === "basic";
  return e;
}

const xpToNext = (lvl) => 20 + lvl * 20 + lvl * lvl * 5;
const enemyXp = (e) => { const s = e.baseStats; const b = Math.round(s.hp / 6 + s.atk + s.mag + s.def / 2); return e.kind === "boss" ? b * 3 : b; };
function levelFromXp(total) { let lvl = 1, xp = total; while (xp >= xpToNext(lvl)) { xp -= xpToNext(lvl); lvl += 1; } return lvl; }

function partyStatsAtLevel(charId, level) {
  const ch = characters.find((c) => c.id === charId);
  const base = classById.get(ch.classId), prom = base.promotesTo ? classById.get(base.promotesTo) : null;
  const stats = { ...ch.baseStats };
  let promoted = false;
  for (let lvl = 2; lvl <= level; lvl++) {
    const growth = (promoted && prom ? prom : base).growth;
    for (const k of STAT_KEYS) stats[k] += growth[k] ?? 0;
    if (!promoted && base.promoteLevel && lvl >= base.promoteLevel && prom) { promoted = true; const pb = prom.promotionBonus ?? {}; for (const k of STAT_KEYS) stats[k] += pb[k] ?? 0; }
  }
  const ids = base.learnset.filter((l) => l.level <= level).map((l) => l.skill);
  if (promoted && prom) ids.push(...prom.learnset.filter((l) => l.level <= level).map((l) => l.skill));
  const weap = { saka: "code-blade", kara: "code-staff", zell: "code-hammer" }[charId];
  const bonus = itemById.get(weap)?.equip?.bonus ?? {};
  for (const k of STAT_KEYS) stats[k] += bonus[k] ?? 0;
  for (const k of STAT_KEYS) stats[k] = Math.round(stats[k]);
  return { stats, skillIds: ids };
}

let uid = 0;
const startEnergy = (m) => Math.floor(m * 0.25);
const regenEnergy = (m) => Math.max(3, Math.floor(m * 0.12));
function mkUnit(o) { return { uid: `${o.dataId}-${uid++}`, statuses: [], shield: 0, alive: true, summonId: "", summonCharge: 0, summonMax: 0, ...o }; }
function partyUnit(charId, level) {
  const { stats, skillIds } = partyStatsAtLevel(charId, level);
  const ch = characters.find((c) => c.id === charId);
  return mkUnit({ dataId: charId, name: charId, team: "player", maxHp: stats.hp, hp: stats.hp, maxEnergy: stats.energy, energy: startEnergy(stats.energy), energyRegen: regenEnergy(stats.energy), atk: stats.atk, def: stats.def, mag: stats.mag, res: stats.res, spd: stats.spd, skillIds, isBoss: false, summonId: ch.summon ?? "", summonCharge: SUMMON_MAX, summonMax: SUMMON_MAX });
}
function enemyUnit(id) {
  const e = enemyById.get(id), s = e.baseStats;
  return mkUnit({ dataId: id, name: e.name, team: "enemy", maxHp: s.hp, hp: s.hp, maxEnergy: s.energy, energy: startEnergy(s.energy), energyRegen: regenEnergy(s.energy), atk: s.atk, def: s.def, mag: s.mag, res: s.res, spd: s.spd, skillIds: e.skills ? [...e.skills] : [], isBoss: e.kind === "boss" });
}

const getSkill = (id) => skillById.get(id);
const skillsFor = (u) => { const list = [BASIC_ATTACK]; for (const id of u.skillIds) { const s = getSkill(id); if (s) list.push(s); } return list; };
const canAfford = (u, sk) => u.energy >= sk.cost;

function planFrontTurn(units, unit) {
  const alive = (team) => units.filter((u) => u.alive && (team ? u.team === team : true));
  const foes = alive().filter((u) => u.team !== unit.team), allies = alive().filter((u) => u.team === unit.team);
  const avail = skillsFor(unit).filter((s) => canAfford(unit, s));
  const cands = [];
  const consider = (score, skill, targetUid) => cands.push({ score, skill, targetUid });
  for (const skill of avail) {
    const eff = skillEffect(skill);
    if (eff.heals) { const hurt = allies.filter((a) => a.hp < a.maxHp); if (hurt.length) { const t = hurt.reduce((a, b) => (a.maxHp - a.hp >= b.maxHp - b.hp ? a : b)); const healEst = skill.power + Math.floor(unit.mag * 0.5); const urgency = t.hp < t.maxHp * 0.5 ? 1.5 : 0.7; consider(Math.min(t.maxHp - t.hp, healEst) * urgency, skill, t.uid); } continue; }
    if (eff.dealsDamage) { if (!foes.length) continue; if (skill.targeting === "all-enemies" || skill.targeting === "area") consider(foes.reduce((a, f) => a + Math.min(estimateDamage(unit, f, skill), f.hp), 0) * 1.05, skill, null); else for (const foe of foes) { let s = estimateDamage(unit, foe, skill); if (s >= foe.hp) s += 1000; consider(s, skill, foe.uid); } continue; }
    if (eff.selfStatuses.length || eff.shield > 0) { const already = eff.selfStatuses.some((s) => unit.statuses.some((st) => st.kind === s)); consider(already ? 2 : 26, skill, null); }
    if (eff.targetStatuses.length && !eff.dealsDamage && foes.length) { const fresh = foes.find((f) => !f.statuses.some((st) => eff.targetStatuses.includes(st.kind))) ?? foes[0]; consider(16, skill, fresh.uid); }
  }
  if (cands.length) { const best = cands.reduce((a, b) => (b.score > a.score ? b : a)); return { skill: best.skill, targetUid: best.targetUid }; }
  const weakest = foes.length ? foes.reduce((a, b) => (a.hp <= b.hp ? a : b)) : null;
  return { skill: BASIC_ATTACK, targetUid: weakest ? weakest.uid : null };
}

function targetsFor(units, unit, skill, targetUid) {
  const alive = units.filter((u) => u.alive), en = alive.filter((u) => u.team !== unit.team), al = alive.filter((u) => u.team === unit.team);
  switch (skill.targeting) {
    case "self": return [unit];
    case "all-enemies": case "area": return en;
    case "all-allies": return al;
    case "ally": { const t = units.find((u) => u.uid === targetUid); return t && t.alive && t.team === unit.team ? [t] : al.slice(0, 1); }
    default: { const t = units.find((u) => u.uid === targetUid); return t && t.alive && t.team !== unit.team ? [t] : en.slice(0, 1); }
  }
}
function gainCharge(u, amt) { if (u.summonMax <= 0 || !u.alive || amt <= 0) return; u.summonCharge = Math.min(u.summonMax, u.summonCharge + amt); }
function applyDamage(t, amt) { let dmg = amt; if (t.shield > 0) { const ab = Math.min(t.shield, dmg); t.shield -= ab; dmg -= ab; } t.hp = Math.max(0, t.hp - dmg); if (t.hp <= 0) t.alive = false; if (t.team === "player" && dmg > 0) gainCharge(t, Math.round(dmg / 3) + 1); return dmg; }
function resolve(units, unit, skill, targetUid, rng) {
  unit.energy = Math.max(0, unit.energy - skill.cost);
  const eff = skillEffect(skill);
  for (const s of eff.selfStatuses) addStatus(unit, s);
  for (const t of targetsFor(units, unit, skill, targetUid)) {
    if (eff.dealsDamage) { const r = rollDamage(unit, t, skill, rng); if (!r.missed) { const d = applyDamage(t, r.amount); if (unit.team === "player" && d > 0) gainCharge(unit, Math.round(d / 4) + 1); } }
    if (eff.heals) t.hp = Math.min(t.maxHp, t.hp + rollHeal(unit, skill, rng));
    if (eff.shield > 0) t.shield += eff.shield;
    for (const s of eff.targetStatuses) if (t.alive) addStatus(t, s);
  }
}

const canSummon = (u) => u.team === "player" && u.alive && u.summonMax > 0 && u.summonCharge >= u.summonMax && summonById.has(u.summonId);
// Tactical policy: summon reactively, not on every fight.
function wantSummon(units, unit) {
  const foes = units.filter((u) => u.alive && u.team !== unit.team), allies = units.filter((u) => u.alive && u.team === unit.team);
  if (!foes.length) return false;
  const low = (frac) => allies.some((a) => a.hp < frac * a.maxHp);
  if (unit.dataId === "kara") return low(0.5);          // heal/cleanse when someone's hurt
  if (unit.dataId === "zell") return foes.length >= 3 || low(0.45); // shield+burst on big waves / danger
  if (unit.dataId === "saka") return foes.length >= 3 || low(0.4);  // AoE burst on big waves
  return false;
}
function doSummon(units, unit, rng) {
  const data = summonById.get(unit.summonId); unit.summonCharge = 0; if (!data) return;
  const eff = data.effect, foes = units.filter((u) => u.alive && u.team !== unit.team), allies = units.filter((u) => u.alive && u.team === unit.team);
  if (eff.damageAll || eff.damageSingle) {
    const targets = eff.damageSingle ? [...foes].sort((a, b) => b.maxHp - a.maxHp).slice(0, 1) : foes;
    for (const t of targets) { applyDamage(t, rollSummonDamage(unit, t, data.power, rng)); if (eff.defBreak && t.alive) addStatus(t, "def-down"); }
  }
  if (eff.healParty) { const p = Math.round(eff.healParty + Math.floor(unit.mag * 0.4)); for (const a of allies) a.hp = Math.min(a.maxHp, a.hp + Math.min(p, a.maxHp - a.hp)); }
  if (eff.cleanse) for (const a of allies) a.statuses = a.statuses.filter((s) => s.kind !== "def-down" && s.kind !== "paralysis");
  if (eff.shieldParty) for (const a of allies) a.shield += Math.round(eff.shieldParty);
  if (eff.partyBuff) for (const a of allies) for (const b of eff.partyBuff) addStatus(a, b);
}

function runBattle(units, rng, useSummons) {
  const cmp = (a, b) => (b.spd !== a.spd ? b.spd - a.spd : a.team !== b.team ? (a.team === "player" ? -1 : 1) : a.uid.localeCompare(b.uid));
  let queue = [], qi = -1, round = 0;
  const build = () => { queue = units.filter((u) => u.alive).sort(cmp).map((u) => u.uid); };
  const victor = () => { const p = units.filter((u) => u.alive && u.team === "player").length, e = units.filter((u) => u.alive && u.team === "enemy").length; return e === 0 ? "player" : p === 0 ? "enemy" : null; };
  build(); round = 1;
  for (let steps = 0; steps < 40000; steps++) {
    qi++;
    if (qi >= queue.length) { round++; build(); qi = 0; if (round > 300) return "draw"; }
    if (!queue.length) return "draw";
    const unit = units.find((u) => u.uid === queue[qi]);
    if (!unit || !unit.alive) continue;
    unit.energy = Math.min(unit.maxEnergy, unit.energy + unit.energyRegen);
    gainCharge(unit, SUMMON_TURN_GAIN);
    if (isParalyzed(unit)) { consumeParalysis(unit); tickStatuses(unit); continue; }
    if (useSummons && canSummon(unit) && wantSummon(units, unit)) doSummon(units, unit, rng);
    else { const plan = planFrontTurn(units, unit); resolve(units, unit, plan.skill, plan.targetUid, rng); }
    tickStatuses(unit);
    const v = victor(); if (v) return v;
  }
  return "draw";
}

// reset a hero between waves the way createPartyUnit does each battle: energy +
// summon gauge reset, statuses/shield cleared, HP persists.
function freshWave(p) { p.statuses = []; p.shield = 0; p.energy = startEnergy(p.maxEnergy); p.summonCharge = p.summonMax; }

const chapterMobXp = (stage) => (stage.encounters ?? []).reduce((a, w) => a + w.reduce((b, id) => b + enemyXp(enemyById.get(id)), 0), 0);
const bossXp = (stage) => { const b = enemyById.get(stage.bossId); return b ? enemyXp(b) : 0; };
function levelEnteringChapter(i) { let xp = 0; for (let c = 0; c < i; c++) xp += chapterMobXp(stages[c]) + bossXp(stages[c]); return levelFromXp(xp); }

const TRIALS = Number(process.argv[2]) || 400;
const pct = (n) => (100 * n / TRIALS).toFixed(0);

function gauntlet(level, waves, seedBase, useSummons) {
  let wins = 0, endHpSum = 0;
  for (let t = 0; t < TRIALS; t++) {
    uid = 0;
    const rng = rngFor(seedBase ^ (t * 2654435761));
    const party = [partyUnit("saka", level), partyUnit("kara", level), partyUnit("zell", level)];
    let ok = true;
    for (const wave of waves) { for (const p of party) freshWave(p); if (runBattle([...party, ...wave.map(enemyUnit)], rng, useSummons) !== "player") { ok = false; break; } }
    if (ok) { wins++; const hp = party.reduce((a, p) => a + Math.max(0, p.hp), 0), mh = party.reduce((a, p) => a + p.maxHp, 0); endHpSum += hp / mh; }
  }
  return { clear: wins / TRIALS, endHp: wins ? Math.round(100 * endHpSum / wins) : 0 };
}

console.log(`\nArsandi Code — chapter mob-gauntlet balance sim  (${TRIALS} trials)\n`);
console.log("FLOOR = no summons/combos (worst case) · TACTICAL = reactive summons, no combos (typical play)");
console.log("level = party level entering the chapter; gauntlet = clear all mob waves back-to-back to the boss gate\n");
console.log("CH  Lv  Wv  Roam   Per-wave win% (full HP)            FLOOR clear/endHP   TACTICAL clear/endHP");
console.log("─".repeat(104));

const flags = [];
for (let i = 0; i < stages.length; i++) {
  const stage = stages[i], level = levelEnteringChapter(i), waves = stage.encounters ?? [];
  const waveWin = waves.map((wave, wi) => {
    let wins = 0;
    for (let t = 0; t < TRIALS; t++) { uid = 0; const rng = rngFor((i * 131 + wi * 17 + t * 99991) >>> 0); const party = [partyUnit("saka", level), partyUnit("kara", level), partyUnit("zell", level)]; if (runBattle([...party, ...wave.map(enemyUnit)], rng, false) === "player") wins++; }
    return wins / TRIALS;
  });
  const floor = gauntlet(level, waves, 0x85ebca6b ^ (i * 911), false);
  const tact = gauntlet(level, waves, 0x27d4eb2f ^ (i * 911), true);
  const ww = waveWin.map((w) => String(pct(w * TRIALS)).padStart(3)).join(" ");
  console.log(`${String(stage.index).padStart(2)}  ${String(level).padStart(2)}  ${String(waves.length).padStart(2)}  ${String(stage.roamers ?? 0).padStart(4)}   ${ww.padEnd(30)}   ${(pct(floor.clear * TRIALS) + "% / " + floor.endHp + "%").padStart(13)}      ${(pct(tact.clear * TRIALS) + "% / " + tact.endHp + "%").padStart(13)}`);

  waveWin.forEach((w, wi) => { if (w < 0.5) flags.push(`Ch${stage.index} wave ${wi} [${waves[wi].join("+")}]: only ${pct(w * TRIALS)}% solo win — spike.`); });
  if (tact.clear < 0.75) flags.push(`Ch${stage.index} (${stage.name}): tactical gauntlet clear ${pct(tact.clear * TRIALS)}% at Lv${level} — too punishing even with summons.`);
  else if (floor.clear < 0.4) flags.push(`Ch${stage.index} (${stage.name}): floor gauntlet ${pct(floor.clear * TRIALS)}% — leans hard on summons/items (tactical ${pct(tact.clear * TRIALS)}%).`);
}
console.log("─".repeat(104));
console.log("\nNOTES:");
if (!flags.length) console.log("  All waves win solo; both gauntlet passes clear comfortably. New waves are in range.");
else for (const f of flags) console.log("  ⚠ " + f);
console.log("  (Combos and the 3 starting repair-kits are NOT modeled — both add further headroom on top of TACTICAL.)\n");
