import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { VIGNETTE, GRADE, LPC, LPC_IDS, lpcOffset, HERO_IDS } from "./World3D";
import { BattleState, createPartyUnit, createEnemyUnit } from "../battle/BattleState";
import { BASIC_ATTACK, skillEffect } from "../battle/combat";
import { planFrontTurn } from "../battle/ai";
import { scoreCombo, comboToStrike, type ComboResult } from "../battle/combo";
import type { ActionOutcome, BattleUnit } from "../battle/types";
import type { ComboArt, ComboDir, SkillData, SummonData } from "../types/game";
import { characters, enemies, getCharacter, getEnemy, getItem, getSummon } from "../data";
import { runState, type PendingBattle } from "../game/runState";
import { enemyXp, awardXp, type LevelUpEvent } from "../game/leveling";
import { audio } from "../audio/AudioEngine";

// Battle3D — the FF front-view battle rebuilt in Three.js: party + enemy pixel
// billboards in a 3D arena over a painted backdrop, with a DOM command UI. The
// pure-TS engine (BattleState + combat/ai/status/leveling) does all the rules.

export interface BattleResult { win: boolean; isBoss: boolean; runComplete: boolean; }

type Phase = "idle" | "command" | "skill" | "item" | "target" | "combo" | "enemy" | "anim" | "over";

// Arrow glyphs for the Legaia-style summon combo (input + arts reference).
const DIR_GLYPH: Record<ComboDir, string> = { up: "▲", down: "▼", left: "◀", right: "▶" };
const KEY_DIR: Record<string, ComboDir> = {
  arrowup: "up", w: "up", arrowdown: "down", s: "down",
  arrowleft: "left", a: "left", arrowright: "right", d: "right",
};
const RANK_COLOR: Record<string, string> = {
  MISS: "#9d8fd0", GOOD: "#9fe0ff", GREAT: "#7dffc0", SUPERB: "#ffe9a8", PERFECT: "#ffd166",
};
const ITEM_FX: Record<string, { hp?: number; en?: number }> = {
  "repair-kit": { hp: 140 }, "energy-cell": { en: 80 }, "old-battery-pack": { en: 50 },
};

// Attack/skill combo: how many directional slots a hero gets, rising with level
// (3 at Lv1 → 6 at Lv16+). Mirrors Legaia's AP bar growing as you train.
const attackComboSlots = (level: number): number => Math.min(6, 3 + Math.floor((Math.max(1, level) - 1) / 5));

// Per-stage battle environment mood (lighting / fog / floor tint / particle hue),
// loosely matching the field themes so combat feels like it's in that place.
interface BattleEnv { fog: number; hemiSky: number; hemiGround: number; key: number; ground: number; particle: number; }
const BATTLE_ENV: Record<string, BattleEnv> = {
  default: { fog: 0x0c0a1c, hemiSky: 0x9088d0, hemiGround: 0x1a1530, key: 0xfff0d6, ground: 0x2a2450, particle: 0x9af0ff },
  "stage-1": { fog: 0x120a22, hemiSky: 0x9a86b0, hemiGround: 0x1a1320, key: 0xffe0c0, ground: 0x2e2348, particle: 0xff9a6a },
  "stage-2": { fog: 0x14120e, hemiSky: 0xb0a080, hemiGround: 0x181410, key: 0xffd0a0, ground: 0x342c22, particle: 0xff7a4a },
  "stage-3": { fog: 0x0e1c20, hemiSky: 0x84d0c8, hemiGround: 0x0e2024, key: 0xd0fff0, ground: 0x1e3a3e, particle: 0x80f0e0 },
  "stage-4": { fog: 0x0a1430, hemiSky: 0x88a8e0, hemiGround: 0x0c1838, key: 0xc8e4ff, ground: 0x1e2e5a, particle: 0x90d0ff },
  "stage-5": { fog: 0x1c1830, hemiSky: 0xc0b0e0, hemiGround: 0x1c1830, key: 0xfff0d0, ground: 0x342e50, particle: 0xfff0c0 },
  "stage-6": { fog: 0x1c1024, hemiSky: 0xc88cd0, hemiGround: 0x1c1024, key: 0xffd0f0, ground: 0x3a2440, particle: 0xff80d0 },
  "stage-7": { fog: 0x140a10, hemiSky: 0xc08890, hemiGround: 0x180a10, key: 0xffc0c0, ground: 0x342030, particle: 0xff5a6a },
  "stage-finale": { fog: 0x10081e, hemiSky: 0xb088e0, hemiGround: 0x160a2c, key: 0xe0c0ff, ground: 0x2e2450, particle: 0xc090ff },
  cave: { fog: 0x100c0e, hemiSky: 0xb0a088, hemiGround: 0x141008, key: 0xffe0b0, ground: 0x342c22, particle: 0xffcf8a },
  vault: { fog: 0x0a0e1c, hemiSky: 0x88b0e0, hemiGround: 0x0c1428, key: 0xc8f0ff, ground: 0x223050, particle: 0x9af0ff },
  frost: { fog: 0x12202c, hemiSky: 0xbcd8ec, hemiGround: 0x16242e, key: 0xe6f4ff, ground: 0x2c3a48, particle: 0xc8f4ff },
  forge: { fog: 0x1c0c08, hemiSky: 0xe0a070, hemiGround: 0x1c0e08, key: 0xffb060, ground: 0x3a2018, particle: 0xff964a },
  archive: { fog: 0x081c1e, hemiSky: 0x84d8d0, hemiGround: 0x0c2024, key: 0xc8fff4, ground: 0x1c3a3a, particle: 0x60f0dc },
};

interface View {
  sprite: THREE.Sprite;
  base: THREE.Vector3;
  hp?: THREE.Sprite;
  h: number;
  // hero-only: rest = back.png facing enemies; attack = attack.png strip the
  // engine swaps to during physical/magical actions. Each strip's per-frame
  // aspect ratio differs from the back-pose aspect (attack frames are wider
  // because the character extends arms/weapon), so we also remember the
  // sprite's resting scale.x and the attack-frame scale.x to swap cleanly.
  restTex?: THREE.Texture;
  attackTex?: THREE.Texture;
  attackFrames?: number;
  restScaleX?: number;
  attackScaleX?: number;
}

// Hero attack strips are re-packed by tools/heroes.mjs into ATTACK_FRAMES (3)
// uniform body-swing poses; keep HERO_ATTACK_FRAMES in sync with that constant.
// HERO_ATTACK_FPS (7) holds each of the 3 poses ~0.14s so the swing reads
// across the ~0.32s lunge before reverting to the back-facing rest pose.
const HERO_ATTACK_FPS = 7;
const HERO_ATTACK_FRAMES = 3;
interface Tween { obj: THREE.Object3D; key: "x" | "y" | "z"; from: number; to: number; t: number; dur: number; yoyo: boolean; }
interface MenuRow { label: string; disabled?: boolean; onPick: () => void; }

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Cinzel:wght@600;700&family=Spectral:wght@400;500;600&display=swap');
.b3d{position:fixed;inset:0;font-family:'Spectral',Georgia,serif;color:#ece6ff;pointer-events:none;z-index:11;text-shadow:0 1px 3px #05030d;}
.b3d .pnl{position:relative;background:linear-gradient(160deg,rgba(30,22,58,.95),rgba(12,9,28,.97));
  border:1px solid rgba(214,182,122,.75);border-radius:6px;
  box-shadow:0 10px 30px #000a, inset 0 0 0 3px rgba(26,20,60,.92), inset 0 0 24px rgba(122,104,210,.2);
  animation:b3dRise .3s cubic-bezier(.2,.8,.2,1);}
.b3d .pnl::before,.b3d .pnl::after{content:"\\2756";position:absolute;color:#e7c884;font-size:11px;text-shadow:0 0 6px rgba(231,200,132,.7);}
.b3d .pnl::before{top:3px;left:7px;} .b3d .pnl::after{bottom:1px;right:7px;}
@keyframes b3dRise{from{opacity:0;transform:translateY(12px);}to{opacity:1;transform:none;}}
.b3d .ban{position:absolute;top:0;left:0;right:0;text-align:center;font-family:'Cinzel',serif;font-size:17px;font-weight:700;
  color:#f4d58d;letter-spacing:3px;padding:14px 0 18px;text-shadow:0 0 14px rgba(244,213,141,.5),0 2px 4px #05030d;
  background:linear-gradient(180deg,#05030dcc,transparent);}
.b3d .log{position:absolute;top:46px;left:20px;font-size:14px;color:#cdbcff;line-height:1.55;max-width:46%;font-style:italic;}
.b3d .status{position:absolute;left:18px;bottom:18px;padding:12px 14px;min-width:256px;}
.b3d .prow{display:flex;align-items:center;gap:10px;font-size:13px;margin:6px 0;padding:3px 6px;border-radius:5px;}
.b3d .prow .nm{font-family:'Cinzel',serif;width:58px;font-weight:600;font-size:12px;color:#ece6ff;letter-spacing:.5px;}
.b3d .prow.act{background:linear-gradient(90deg,rgba(244,213,141,.2),transparent);}
.b3d .prow.act .nm{color:#f4d58d;}
.b3d .prow.act .nm::before{content:"\\25C8 ";color:#f4d58d;}
.b3d .bars{display:flex;flex-direction:column;gap:3px;}
.b3d .bar{width:104px;height:9px;background:#0a0814;border:1px solid rgba(214,182,122,.4);border-radius:4px;position:relative;overflow:hidden;}
.b3d .bar i{position:absolute;inset:0;width:0;background:linear-gradient(180deg,#7dffc0,#2fd47e);transition:width .25s;box-shadow:0 0 6px #2fd47e80;}
.b3d .bar.en{height:6px;} .b3d .bar.en i{background:linear-gradient(180deg,#7fd4ff,#3a9ce0);box-shadow:0 0 6px #3a9ce080;}
.b3d .num{font-family:'Cinzel',serif;font-size:11px;color:#c8badd;width:58px;text-align:right;}
.b3d .cmd{position:absolute;right:20px;bottom:20px;padding:8px;min-width:172px;}
.b3d .cmd .r{font-family:'Cinzel',serif;font-size:14px;padding:7px 14px;cursor:pointer;border-radius:5px;letter-spacing:1.5px;
  display:flex;align-items:center;gap:8px;transition:background .12s,color .12s;}
.b3d .cmd .r::before{content:"";width:8px;}
.b3d .cmd .r.sel{background:linear-gradient(90deg,rgba(244,213,141,.28),rgba(244,213,141,.04));color:#ffe9b0;
  box-shadow:inset 0 0 12px rgba(244,213,141,.22);}
.b3d .cmd .r.sel::before{content:"\\25C8";color:#f4d58d;}
.b3d .cmd .r.dis{color:#6a6088;}
.b3d .prompt{position:absolute;bottom:112px;left:0;right:0;text-align:center;font-size:14px;color:#9fe0ff;letter-spacing:.5px;}
.b3d .res{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;background:radial-gradient(ellipse at center,#0a0820dd,#05030df2);}
.b3d .res .t{font-family:'Cinzel',serif;font-size:42px;font-weight:700;letter-spacing:4px;text-shadow:0 0 24px #8f7fd6,0 3px 6px #05030d;}
.b3d .res .s{font-size:15px;margin-top:12px;color:#ece6ff;font-style:italic;}
.b3d .res .x{font-family:'Cinzel',serif;font-size:13px;margin-top:14px;color:#f4d58d;white-space:pre;text-align:center;line-height:1.7;}
.b3d .bar.sm{height:5px;} .b3d .bar.sm i{background:linear-gradient(180deg,#ffe9a8,#e7b94a);box-shadow:0 0 6px #e7b94a80;}
.b3d .bar.sm.rdy{border-color:#ffe9a8;box-shadow:0 0 9px rgba(255,233,168,.75);}
.b3d .bar.sm.rdy i{animation:smPulse .9s ease-in-out infinite;}
@keyframes smPulse{0%,100%{filter:brightness(1);}50%{filter:brightness(1.55);}}
.b3d .summon{position:fixed;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;z-index:14;pointer-events:none;opacity:0;transition:opacity .35s ease;background:radial-gradient(ellipse at center,rgba(8,6,20,.55),rgba(4,2,10,.93));}
.b3d .summon.on{opacity:1;} .b3d .summon.out{opacity:0;transition:opacity .3s ease;}
.b3d .summon .sigil{position:absolute;width:340px;height:340px;transform:scale(.2);opacity:0;}
.b3d .summon.on .sigil{animation:sgGrow 1.1s cubic-bezier(.2,.7,.2,1) forwards;}
@keyframes sgGrow{0%{transform:scale(.2);opacity:0;}45%{opacity:.95;}100%{transform:scale(1.45);opacity:.8;}}
.b3d .summon .sigil::before,.b3d .summon .sigil::after{content:"";position:absolute;inset:0;border-radius:50%;border:3px solid var(--c);box-shadow:0 0 50px var(--c),inset 0 0 50px var(--c);}
.b3d .summon .sigil::after{inset:34px;border-style:dashed;opacity:.7;animation:sgSpin 5s linear infinite;}
.b3d .summon.on .sigil::before{animation:sgSpinR 9s linear infinite;}
@keyframes sgSpin{to{transform:rotate(360deg);}} @keyframes sgSpinR{to{transform:rotate(-360deg);}}
.b3d .summon .sgroup{position:absolute;left:0;right:0;bottom:13%;text-align:center;transform:translateY(10px) scale(.9);opacity:0;}
.b3d .summon.on .sgroup{animation:sgIn .5s ease .25s forwards;} @keyframes sgIn{to{transform:none;opacity:1;}}
.b3d .summon .sname{font-family:'Cinzel',serif;font-size:52px;font-weight:700;letter-spacing:8px;color:#fff;text-shadow:0 0 24px var(--c),0 0 48px var(--c),0 3px 6px #05030d;}
.b3d .summon .sult{font-family:'Spectral',serif;font-style:italic;font-size:20px;letter-spacing:3px;margin-top:8px;color:#f4d58d;text-shadow:0 0 12px var(--c),0 2px 4px #05030d;}
.b3d .summon .creature{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:none;}
.b3d .summon .creature svg{width:336px;height:336px;margin-bottom:52px;fill:var(--c);opacity:0;transform:translateY(58px) scale(.82);filter:drop-shadow(0 0 16px var(--c)) drop-shadow(0 0 40px var(--c)) brightness(1);transition:filter .16s ease;}
.b3d .summon .creature svg .ring{fill:none;stroke:var(--c);stroke-width:3;}
.b3d .summon.on .creature svg{animation:sgRise .62s cubic-bezier(.2,.7,.2,1) .06s forwards,sgFloat 3.4s ease-in-out .7s infinite;}
.b3d .summon.cast .creature svg{filter:drop-shadow(0 0 30px var(--c)) drop-shadow(0 0 72px #fff) brightness(2.3);}
@keyframes sgRise{0%{opacity:0;transform:translateY(58px) scale(.82);}60%{opacity:1;}100%{opacity:.97;transform:translateY(0) scale(1);}}
@keyframes sgFloat{0%,100%{transform:translateY(0) scale(1);}50%{transform:translateY(-9px) scale(1.012);}}
.b3d .summon .sflash{position:absolute;top:20%;left:0;right:0;text-align:center;opacity:0;transform:scale(.6);pointer-events:none;}
.b3d .summon.cast .sflash{animation:sfPop .5s cubic-bezier(.2,.9,.3,1.4) forwards;}
@keyframes sfPop{0%{opacity:0;transform:scale(.6);}60%{opacity:1;transform:scale(1.12);}100%{opacity:1;transform:scale(1);}}
.b3d .summon .sflash .srank{display:block;font-family:'Cinzel',serif;font-size:46px;font-weight:700;letter-spacing:6px;color:var(--rc);text-shadow:0 0 24px var(--rc),0 0 52px var(--rc),0 3px 6px #05030d;}
.b3d .summon .sflash .smult{display:inline-block;font-family:'Cinzel',serif;font-size:22px;color:#fff;margin-top:2px;text-shadow:0 0 14px var(--rc);}
.b3d .summon .sflash .sarts{display:block;font-family:'Spectral',serif;font-style:italic;font-size:14px;letter-spacing:2px;color:#f4d58d;margin-top:4px;text-shadow:0 2px 4px #05030d;}
/* Legaia-style summon combo input panel */
.b3d .combo{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;z-index:13;background:radial-gradient(ellipse at center,rgba(8,6,20,.42),rgba(4,2,10,.84));}
.b3d .cmbox{min-width:300px;max-width:362px;padding:16px 18px 18px;text-align:center;border-radius:12px;
  background:linear-gradient(180deg,rgba(20,14,38,.96),rgba(10,7,22,.97));border:1px solid rgba(244,213,141,.45);
  box-shadow:0 0 0 1px rgba(0,0,0,.5),0 14px 50px rgba(0,0,0,.6),inset 0 0 28px rgba(120,90,200,.18);}
.b3d .cmttl{font-family:'Cinzel',serif;font-size:13px;letter-spacing:5px;color:#f4d58d;}
.b3d .cmsub{font-family:'Spectral',serif;font-style:italic;font-size:13px;color:#cdbef0;margin-top:2px;}
.b3d .cmslots{display:flex;gap:8px;justify-content:center;margin:12px 0 8px;}
.b3d .cmcell{width:38px;height:38px;display:flex;align-items:center;justify-content:center;font-size:20px;color:var(--c);
  border:1px solid rgba(244,213,141,.3);border-radius:7px;background:rgba(8,6,20,.6);box-shadow:inset 0 0 10px rgba(0,0,0,.5);}
.b3d .cmcell.f{border-color:var(--c);box-shadow:0 0 10px var(--c),inset 0 0 8px rgba(0,0,0,.4);text-shadow:0 0 8px var(--c);}
.b3d .cmcell.n{border-color:#f4d58d;animation:cmBlink .8s ease-in-out infinite;}
@keyframes cmBlink{0%,100%{box-shadow:0 0 4px rgba(244,213,141,.4);}50%{box-shadow:0 0 14px rgba(244,213,141,.9);}}
.b3d .cmrank{font-family:'Cinzel',serif;font-size:16px;font-weight:700;letter-spacing:2px;margin-bottom:8px;text-shadow:0 0 12px currentColor;}
.b3d .cmarts{display:flex;flex-direction:column;gap:3px;margin:0 0 12px;}
.b3d .cmart{display:flex;align-items:center;gap:8px;font-size:12px;padding:3px 8px;border-radius:5px;color:#9d93c0;background:rgba(255,255,255,.02);}
.b3d .cmart.hit{color:#ffe9b0;background:linear-gradient(90deg,rgba(244,213,141,.18),transparent);box-shadow:inset 0 0 10px rgba(244,213,141,.15);}
.b3d .cmart .an{font-family:'Cinzel',serif;flex:1;text-align:left;letter-spacing:.5px;}
.b3d .cmart .aseq{letter-spacing:2px;color:var(--c);}
.b3d .cmart .ab{width:46px;text-align:right;color:#9fe0ff;}
.b3d .cmpad{display:flex;flex-direction:column;align-items:center;gap:6px;margin-bottom:12px;}
.b3d .cmprow{display:flex;gap:6px;}
.b3d .cmd-btn{width:42px;height:38px;font-size:18px;color:#ece6ff;cursor:pointer;border-radius:7px;
  border:1px solid rgba(244,213,141,.4);background:linear-gradient(180deg,rgba(40,28,70,.9),rgba(20,14,38,.9));
  box-shadow:inset 0 0 10px rgba(120,90,200,.2);transition:transform .08s,box-shadow .12s;}
.b3d .cmd-btn:hover{box-shadow:0 0 12px var(--c),inset 0 0 10px rgba(120,90,200,.3);}
.b3d .cmd-btn:active{transform:scale(.92);}
.b3d .cmbtns{display:flex;gap:8px;justify-content:center;}
.b3d .cmbtns button{font-family:'Cinzel',serif;font-size:12px;letter-spacing:1.5px;padding:7px 12px;cursor:pointer;border-radius:6px;
  border:1px solid rgba(244,213,141,.4);color:#ece6ff;background:linear-gradient(180deg,rgba(40,28,70,.9),rgba(20,14,38,.9));transition:box-shadow .12s,color .12s;}
.b3d .cmbtns .cmgo{color:#ffe9b0;border-color:var(--c);box-shadow:0 0 12px rgba(244,213,141,.3);}
.b3d .cmbtns button:hover{box-shadow:0 0 14px var(--c);}
/* Compact rank readout that pops over a melee combo (not the full-screen summon flash) */
.b3d .cmbanner{position:absolute;top:21%;left:0;right:0;text-align:center;pointer-events:none;z-index:13;animation:cbPop .4s cubic-bezier(.2,.9,.3,1.4) forwards;}
@keyframes cbPop{0%{opacity:0;transform:scale(.7);}60%{opacity:1;transform:scale(1.1);}100%{opacity:1;transform:scale(1);}}
.b3d .cmbanner .cbr{font-family:'Cinzel',serif;font-size:30px;font-weight:700;letter-spacing:4px;color:var(--rc);text-shadow:0 0 18px var(--rc),0 2px 5px #05030d;}
.b3d .cmbanner .cbm{font-family:'Cinzel',serif;font-size:18px;color:#fff;margin-left:10px;text-shadow:0 0 12px var(--rc);}
.b3d .cmbanner .cba{display:block;font-family:'Spectral',serif;font-style:italic;font-size:13px;letter-spacing:2px;color:#f4d58d;margin-top:3px;}
`;

// Stylized vector silhouettes drawn in the summon cutscene (viewBox 0 0 120 120).
// Solid shapes inherit fill:var(--c); shapes with class="ring" render as glowing
// outlines. Keyed by SummonData.silhouette; unknown shapes fall back to a glyph.
const SUMMON_SILHOUETTES: Record<string, string> = {
  dragon:
    `<polygon points="56,22 49,8 58,20"/><polygon points="64,22 71,8 62,20"/>` +
    `<polygon points="54,30 60,18 66,30 60,40"/>` +
    `<polygon points="54,42 10,24 20,40 6,44 24,52 10,58 30,60 50,56 54,52"/>` +
    `<polygon points="66,42 110,24 100,40 114,44 96,52 110,58 90,60 70,56 66,52"/>` +
    `<path d="M55,40 Q60,36 65,40 L63,74 Q60,82 60,92 Q60,82 57,74 Z"/>` +
    `<polygon points="60,88 54,106 60,100 66,106"/>`,
  oracle:
    `<circle class="ring" cx="60" cy="20" r="14"/><circle cx="60" cy="28" r="7"/>` +
    `<path d="M52,36 Q60,32 68,36 L82,104 Q60,110 38,104 Z"/>` +
    `<path d="M54,42 L32,70 L40,74 L58,50 Z"/><path d="M66,42 L88,70 L80,74 L62,50 Z"/>` +
    `<circle class="ring" cx="60" cy="70" r="6"/>`,
  colossus:
    `<rect x="50" y="14" width="20" height="16" rx="3"/>` +
    `<path d="M38,34 L82,34 L88,48 L76,54 L76,84 L44,84 L44,54 L32,48 Z"/>` +
    `<path d="M32,42 L20,48 L18,84 L34,86 L34,54 Z"/><path d="M88,42 L100,48 L102,84 L86,86 L86,54 Z"/>` +
    `<rect x="14" y="82" width="22" height="18" rx="4"/><rect x="84" y="82" width="22" height="18" rx="4"/>` +
    `<rect x="46" y="84" width="12" height="24"/><rect x="62" y="84" width="12" height="24"/>` +
    `<circle class="ring" cx="60" cy="54" r="6"/>`,
  glyph:
    `<circle class="ring" cx="60" cy="60" r="30"/>` +
    `<polygon points="60,28 68,60 60,92 52,60"/><polygon points="28,60 60,52 92,60 60,68"/>`,
};
const summonSilhouette = (shape?: string): string =>
  `<svg viewBox="0 0 120 120" aria-hidden="true">${(shape && SUMMON_SILHOUETTES[shape]) || SUMMON_SILHOUETTES.glyph}</svg>`;

export class Battle3D {
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private composer!: EffectComposer;
  private state!: BattleState;
  private views = new Map<string, View>();
  private tweens: Tween[] = [];
  private popups: { spr: THREE.Sprite; t: number }[] = [];
  private shake = 0;
  private motes?: THREE.Points;
  private moteSpeeds!: Float32Array;
  private _blob?: THREE.Texture;
  // themed environment + skill FX
  private hemi!: THREE.HemisphereLight;
  private keyLight!: THREE.DirectionalLight;
  private groundMat!: THREE.MeshStandardMaterial;
  private fx: { t: number; dur: number; apply: (p: number) => void; done?: () => void }[] = [];
  private sheetTex = new Set<THREE.Texture>(); // 2-frame idle enemy sheets
  // Active hero-attack animations: per-view, plays the attack strip for `dur`
  // seconds, then restores the unit's back-facing rest texture.
  private heroAnims: { uid: string; t: number; dur: number }[] = [];
  private _ring?: THREE.Texture;
  private _slash?: THREE.Texture;
  private _spark?: THREE.Texture;
  private _arena?: THREE.Texture;

  private phase: Phase = "idle";
  private active: BattleUnit | null = null;
  private pending!: PendingBattle;
  private menu: MenuRow[] = [];
  private menuIdx = 0;
  private pendingSkill: SkillData | null = null;
  private pendingItem: string | null = null;
  private targets: BattleUnit[] = [];
  private targetIdx = 0;
  // Legaia-style combo input state (live while phase === "combo"). The same
  // panel drives both the summon ultimate and the on-attack/skill flurry; mode
  // selects which payoff comboUnleash routes to.
  private comboMode: "summon" | "attack" = "summon";
  private comboActor: BattleUnit | null = null;
  private comboData: SummonData | undefined;
  private comboSkill: SkillData | null = null;
  private comboTargetUid: string | null = null;
  private comboArts: ComboArt[] = [];
  private comboSlots = 5;
  private comboInput: ComboDir[] = [];
  private comboColor = "#ffe6b0";
  private comboTitle = "SUMMON ARTS";
  private comboSub = "";
  private log: string[] = [];
  private running = false;
  private last = 0;
  private keyHandler!: (e: KeyboardEvent) => void;
  private resizeHandler!: () => void;

  private root!: HTMLDivElement;

  constructor(renderer: THREE.WebGLRenderer, mount: HTMLElement, private onFinish: (r: BattleResult) => void) {
    const s = renderer.getSize(new THREE.Vector2());
    this.camera = new THREE.PerspectiveCamera(42, s.x / s.y, 0.1, 200);
    this.camera.position.set(0, 4.8, 13);
    this.camera.lookAt(0, 1.7, -3.5);
    this.scene.fog = new THREE.FogExp2(0x0c0a1c, 0.014);
    this.hemi = new THREE.HemisphereLight(0x9088d0, 0x1a1530, 1.4);
    this.scene.add(this.hemi);
    this.scene.add(new THREE.AmbientLight(0x4a4670, 0.7));
    this.keyLight = new THREE.DirectionalLight(0xfff0d6, 1.5);
    this.keyLight.position.set(6, 12, 8);
    this.scene.add(this.keyLight);
    // arena floor — a soft lit pool that fades to dark edges (tinted per stage)
    this.groundMat = new THREE.MeshStandardMaterial({ color: 0x2a2450, roughness: 0.8, metalness: 0.24, map: this.arenaTex() });
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(90, 56), this.groundMat);
    ground.rotation.x = -Math.PI / 2;
    this.scene.add(ground);

    this.buildAtmosphere();
    this.buildFraming();

    this.composer = new EffectComposer(renderer);
    // Match composer pixel ratio to renderer so retina displays render full-canvas
    // (otherwise the composed image ends up in the upper-left quadrant on resize).
    this.composer.setPixelRatio(renderer.getPixelRatio());
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.composer.addPass(new UnrealBloomPass(new THREE.Vector2(s.x, s.y), 0.82, 0.55, 0.84));
    this.composer.addPass(new ShaderPass(VIGNETTE));
    // gentler grade than the field — keeps the painted backdrop readable
    const grade = new ShaderPass(GRADE);
    grade.uniforms.contrast.value = 1.04;
    grade.uniforms.saturation.value = 1.13;
    grade.uniforms.lift.value = 0.05;
    this.composer.addPass(grade);
    this.composer.addPass(new OutputPass());

    const style = document.createElement("style"); style.textContent = CSS; document.head.appendChild(style);
    this.root = document.createElement("div"); this.root.className = "b3d";
    this.root.innerHTML = `<div class="ban"></div><div class="log"></div><div class="prompt"></div>
      <div class="status pnl"></div><div class="cmd pnl" style="display:none"></div>`;
    mount.appendChild(this.root);
    this.keyHandler = (e) => this.onKey(e);
    window.addEventListener("keydown", this.keyHandler);
    this.resizeHandler = () => this.fitViewport();
    window.addEventListener("resize", this.resizeHandler);
  }

  // Keep the camera aspect + composer in sync with the shared canvas. The
  // renderer is borrowed from World3D, so its size at construction time can be
  // stale (0×0) — recompute from the live canvas before the battle renders.
  private fitViewport(): void {
    const el = this.composer.renderer.domElement;
    const w = el.clientWidth || el.width || window.innerWidth;
    const h = el.clientHeight || el.height || window.innerHeight;
    if (!w || !h) return;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.composer.setPixelRatio(this.composer.renderer.getPixelRatio());
    this.composer.setSize(w, h);
  }

  private texLoader = new THREE.TextureLoader();
  private async tex(url: string): Promise<THREE.Texture> {
    const t = await this.texLoader.loadAsync(url);
    t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  async begin(pending: PendingBattle, stageId: string): Promise<void> {
    this.pending = pending;
    this.fitViewport();
    this.applyEnv(stageId);
    await this.buildBackdrop(stageId);
    await this.buildEncounter();
    audio.playMusic("battle");
    this.refreshStatus();
    this.startLoop();
    const first = this.state.start();
    if (first) this.handleTurn(first);
  }

  private async buildBackdrop(stageId: string): Promise<void> {
    try {
      const t = await this.tex(`assets/bg/${stageId}.png`);
      const bd = new THREE.Mesh(new THREE.PlaneGeometry(54, 30), new THREE.MeshBasicMaterial({ map: t, fog: true }));
      bd.position.set(0, 8, -15);
      this.scene.add(bd);
    } catch { /* none */ }
    // faint wash to seat sprites against the painted backdrop
    this.scene.add(new THREE.Mesh(new THREE.PlaneGeometry(54, 30), new THREE.MeshBasicMaterial({ color: 0x05030d, transparent: true, opacity: 0.1 })).translateZ(-14.5).translateY(8));
    // horizon haze — a fog-coloured gradient rising from the floor that hides the
    // hard seam where the painted backdrop meets the 3D floor.
    const haze = new THREE.Mesh(
      new THREE.PlaneGeometry(80, 11),
      new THREE.MeshBasicMaterial({ map: this.hazeTex(), transparent: true, depthWrite: false, fog: false }),
    );
    haze.position.set(0, 1.6, -12.8);
    this.scene.add(haze);
  }

  // Vertical gradient: dense fog colour at the bottom fading to transparent at the top.
  private hazeTex(): THREE.Texture {
    const w = 4, h = 128, c = document.createElement("canvas"); c.width = w; c.height = h;
    const x = c.getContext("2d")!;
    const g = x.createLinearGradient(0, h, 0, 0);
    g.addColorStop(0, "rgba(12,10,28,0.95)"); g.addColorStop(0.5, "rgba(12,10,28,0.5)"); g.addColorStop(1, "rgba(12,10,28,0)");
    x.fillStyle = g; x.fillRect(0, 0, w, h);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  }

  private async buildEncounter(): Promise<void> {
    const stage = runState.stage;
    const [a, k, z] = characters;
    const party = [createPartyUnit(a, 0, 0), createPartyUnit(k, 0, 0), createPartyUnit(z, 0, 0)];
    let boss: BattleUnit | null = null;
    const minions: BattleUnit[] = [];
    if (this.pending.kind === "boss") {
      boss = createEnemyUnit(getEnemy(stage.bossId), 0, 0);
      enemies.filter((e) => e.stageId === stage.id && e.kind === "minion").slice(0, 2).forEach((m) => minions.push(createEnemyUnit(m, 0, 0)));
    } else {
      for (const id of this.pending.enemyIds) { const e = getEnemy(id); if (e) minions.push(createEnemyUnit(e, 0, 0)); }
    }
    const units = [...party, ...(boss ? [boss, ...minions] : minions)];
    this.state = new BattleState(units);

    // Party reads large and close in the foreground; enemies array across the back.
    const px = [-3.8, 0, 3.8];
    party.forEach((u, i) => this.makeView(u, new THREE.Vector3(px[i] ?? 0, 0, 4.6), 2.5));
    const eList = boss ? [boss, ...minions] : minions;
    if (boss) {
      this.makeView(boss, new THREE.Vector3(0, 0, -4.5), 4.0);
      minions.forEach((u, i) => this.makeView(u, new THREE.Vector3(i === 0 ? -5 : 5, 0, -2.6), 2.2));
    } else {
      const n = eList.length;
      const span = n <= 1 ? 0 : n === 2 ? 3.4 : 4.8;
      eList.forEach((u, i) => {
        const x = n <= 1 ? 0 : -span + (2 * span * i) / (n - 1);
        const z = -3.6 - Math.abs(x) * 0.18; // gentle arc — outer enemies a touch deeper
        this.makeView(u, new THREE.Vector3(x, 0, z), 2.2);
      });
    }
  }

  private async makeView(u: BattleUnit, base: THREE.Vector3, h: number): Promise<void> {
    let sprite: THREE.Sprite;
    let visW = h * 0.7; // visible body width — glow/shadow track this, not the (padded) frame
    try {
      // Party uses the project-owned hero sheets (BACK frame, facing away from
      // the camera toward the enemies — classic JRPG front-view framing). Falls
      // back to LPC humanoid back-pose, then to procedural.
      const heroId = u.team === "player" && HERO_IDS.has(u.dataId) ? u.dataId : null;
      const lpcId = !heroId && u.team === "player" && LPC_IDS.has(u.dataId) ? u.dataId : null;
      if (heroId) {
        const t = await this.tex(`assets/sprites/heroes/${heroId}/back.png`);
        const img = t.image as HTMLImageElement;
        const aspect = img.width / img.height;
        sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthWrite: false }));
        sprite.scale.set(h * 1.05 * aspect, h * 1.05, 1);
        visW = h * 1.05 * aspect * 0.85;
        // Pre-load the attack strip so we can swap to it on this unit's turn.
        // Each strip's per-frame width differs from back.png's width (attack
        // poses are wider — weapon/cape extended), so we precompute the
        // attack-frame scale.x so the swap doesn't squish the figure.
        void this.tex(`assets/sprites/heroes/${heroId}/attack.png`).then((at) => {
          const v = this.views.get(u.uid);
          if (!v) return;
          at.repeat.set(1 / HERO_ATTACK_FRAMES, 1);
          at.offset.set(0, 0);
          v.attackTex = at;
          v.attackFrames = HERO_ATTACK_FRAMES;
          const ai = at.image as HTMLImageElement;
          const atkAspect = (ai.width / HERO_ATTACK_FRAMES) / ai.height;
          v.attackScaleX = h * 1.05 * atkAspect;
        }).catch(() => { /* keep back-only; falls back to existing hop */ });
      } else if (lpcId) {
        const t = await this.tex(`assets/sprites/lpc/${lpcId}.png`);
        t.repeat.set(1 / LPC.cols, 1 / LPC.rows);
        t.offset.set(...lpcOffset(0, LPC.walkDownRow - 2)); // walk-up row, frame 0 (standing, back to camera)
        sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthWrite: false }));
        sprite.scale.set(h * 1.15, h * 1.15, 1);
        visW = h * 1.15 * 0.42;
      } else {
        const url = u.spriteKey ? `assets/sprites/${u.spriteKey.replace("sprite-", "")}.png` : "";
        const t = await this.tex(url || `assets/sprites/${u.dataId}.png`);
        const img = t.image as HTMLImageElement;
        const sheet = Math.abs(img.width - img.height * 2) < 2;  // 2-frame idle sheet
        const aspect = sheet ? (img.width / 2) / img.height : img.width / img.height;
        if (sheet) { t.repeat.set(0.5, 1); t.offset.set(0, 0); this.sheetTex.add(t); }
        sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthWrite: false }));
        sprite.scale.set(h * aspect, h, 1);
        visW = h * aspect;
      }
    } catch {
      sprite = new THREE.Sprite(new THREE.SpriteMaterial({ color: new THREE.Color(u.themeColor) }));
      sprite.scale.set(h * 0.7, h, 1);
      visW = h * 0.7;
    }
    sprite.center.set(0.5, 0);
    sprite.position.copy(base);
    // rim/back glow so the pixel sprite pops off the diorama (Octopath-style)
    const glowCol = u.team === "player" ? 0xffe6b0 : new THREE.Color(u.themeColor).getHex();
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glowTex(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, color: glowCol, opacity: 0.34 }));
    glow.center.set(0.5, 0);
    glow.scale.set(visW * 1.34, sprite.scale.y * 1.04, 1);
    glow.position.set(base.x, base.y - 0.1, base.z - 0.02);
    this.scene.add(glow);
    this.scene.add(sprite);
    // contact shadow so the unit reads as standing on the floor (not floating)
    const shW = visW * 1.1;
    const sh = new THREE.Mesh(
      new THREE.PlaneGeometry(shW, shW * 0.46),
      new THREE.MeshBasicMaterial({ map: this.blobTex(), transparent: true, depthWrite: false, opacity: 0.55 }),
    );
    sh.rotation.x = -Math.PI / 2;
    sh.position.set(base.x, 0.02, base.z + 0.05);
    this.scene.add(sh);
    const v: View = { sprite, base: base.clone(), h };
    // For hero party we remember the resting (back-facing) texture AND the
    // sprite's resting scale.x so attack animations can revert cleanly even
    // though attack frames use a different per-frame aspect ratio.
    if (u.team === "player" && HERO_IDS.has(u.dataId)) {
      v.restTex = (sprite.material as THREE.SpriteMaterial).map ?? undefined;
      v.restScaleX = sprite.scale.x;
    }
    if (u.team === "enemy") { v.hp = this.makeHpSprite(u); v.hp.position.set(base.x, h + 0.4, base.z); this.scene.add(v.hp); }
    this.views.set(u.uid, v);
  }

  private blobTex(): THREE.Texture {
    if (this._blob) return this._blob;
    const s = 64, c = document.createElement("canvas"); c.width = s; c.height = s;
    const x = c.getContext("2d")!;
    const g = x.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    g.addColorStop(0, "rgba(0,0,0,0.75)"); g.addColorStop(0.7, "rgba(0,0,0,0.35)"); g.addColorStop(1, "rgba(0,0,0,0)");
    x.fillStyle = g; x.fillRect(0, 0, s, s);
    this._blob = new THREE.CanvasTexture(c);
    return this._blob;
  }

  private _glow?: THREE.Texture;
  private glowTex(): THREE.Texture {
    if (this._glow) return this._glow;
    const s = 96, c = document.createElement("canvas"); c.width = s; c.height = s;
    const x = c.getContext("2d")!;
    const g = x.createRadialGradient(s / 2, s * 0.55, 0, s / 2, s * 0.55, s / 2);
    g.addColorStop(0, "rgba(255,255,255,0.85)"); g.addColorStop(0.45, "rgba(255,255,255,0.32)"); g.addColorStop(1, "rgba(255,255,255,0)");
    x.fillStyle = g; x.fillRect(0, 0, s, s);
    this._glow = new THREE.CanvasTexture(c);
    return this._glow;
  }

  private makeHpSprite(u: BattleUnit): THREE.Sprite {
    const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.makeHpTex(u), transparent: true, depthWrite: false }));
    spr.scale.set(3, 0.8, 1);
    return spr;
  }
  private makeHpTex(u: BattleUnit): THREE.CanvasTexture {
    const W = 192, H = 56, c = document.createElement("canvas"); c.width = W; c.height = H;
    const x = c.getContext("2d")!;
    x.font = "bold 18px monospace"; x.textAlign = "center"; x.fillStyle = "#ffd9e2";
    x.lineWidth = 4; x.strokeStyle = "#05030d"; x.strokeText(u.name, W / 2, 16); x.fillText(u.name, W / 2, 16);
    x.fillStyle = "#000"; x.fillRect(30, 30, 132, 12);
    const f = Math.max(0, u.hp / u.maxHp);
    x.fillStyle = f > 0.5 ? "#4dff9e" : f > 0.25 ? "#ffd166" : "#ff5d7a";
    x.fillRect(32, 32, 128 * f, 8);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  }

  // ---- turn flow (mirrors the Phaser BattleScene controller) -----------

  private handleTurn(info: { unit: BattleUnit; skipped: boolean }): void {
    this.active = info.unit; this.banner();
    if (info.skipped) { this.popup(info.unit, "PARALYZED", "#ffd166"); this.time(700, () => this.nextTurn()); return; }
    if (info.unit.team === "enemy") this.runEnemy(info.unit);
    else this.enterCommand(info.unit);
  }
  private nextTurn(): void {
    const v = this.state.victor();
    if (v) { this.finish(v); return; }
    const info = this.state.advance(); if (info) this.handleTurn(info);
  }
  private endTurn(u: BattleUnit): void {
    this.phase = "idle"; this.hideCmd(); this.setPrompt("");
    this.state.endTurn(u); this.refreshStatus(); this.nextTurn();
  }

  private enterCommand(u: BattleUnit): void {
    this.phase = "command"; this.active = u; this.pendingSkill = null; this.pendingItem = null;
    const realSkills = this.state.skillsFor(u).filter((s) => s.id !== "basic");
    this.menu = [
      { label: "ATTACK", onPick: () => { this.pendingSkill = BASIC_ATTACK; this.enterTarget(u, "enemy"); } },
      { label: "SKILL", disabled: !realSkills.some((s) => this.state.canAfford(u, s)), onPick: () => this.enterSkill(u) },
      { label: "SUMMON", disabled: !this.state.canSummon(u), onPick: () => this.doSummon(u) },
      { label: "GUARD", onPick: () => this.doGuard(u) },
      { label: "ITEM", disabled: this.usableItems().length === 0, onPick: () => this.enterItem(u) },
      { label: "RUN", onPick: () => { this.pushLog(["Can't escape!"]); audio.playSfx("cancel"); } },
    ];
    this.menuIdx = 0; this.renderCmd(); this.refreshStatus();
    this.setPrompt(`${u.name}'s turn`);
  }
  private enterSkill(u: BattleUnit): void {
    this.phase = "skill";
    this.menu = this.state.skillsFor(u).filter((s) => s.id !== "basic").map((s) => ({
      label: s.cost > 0 ? `${s.name} (${s.cost})` : s.name,
      disabled: !this.state.canAfford(u, s),
      onPick: () => { this.pendingSkill = s; this.state.needsTarget(s) ? this.enterTarget(u, s.targeting === "ally" ? "ally" : "enemy") : this.beginSkill(u, s, undefined); },
    }));
    this.menu.push({ label: "← BACK", onPick: () => this.enterCommand(u) });
    this.menuIdx = 0; this.renderCmd(); this.setPrompt("Choose a skill");
  }
  private enterItem(u: BattleUnit): void {
    this.phase = "item";
    this.menu = this.usableItems().map(({ id, count }) => ({ label: `${getItem(id)?.name ?? id} x${count}`, onPick: () => { this.pendingItem = id; this.enterTarget(u, "ally"); } }));
    this.menu.push({ label: "← BACK", onPick: () => this.enterCommand(u) });
    this.menuIdx = 0; this.renderCmd(); this.setPrompt("Use an item");
  }
  private doGuard(u: BattleUnit): void { this.phase = "anim"; this.hideCmd(); this.animate(this.state.guard(u), () => this.endTurn(u)); }
  private doSummon(u: BattleUnit): void {
    // Don't resolve yet — first hand control to the Legaia-style combo input.
    // The gauge is spent and damage rolled only when the player unleashes.
    this.enterCombo(u);
  }

  // ---- summon combo (Legend-of-Legaia-style directional arts) -----------

  // Enter the combo phase: the player taps a short directional sequence into a
  // fixed number of slots. Contiguous runs that match the summon's arts chain
  // together (scoreCombo) and amplify the ultimate. Unleash anytime — even an
  // empty input is valid (×1, no bonus). Cancel returns to the command menu
  // without spending the gauge.
  private enterCombo(u: BattleUnit): void {
    const data = getSummon(u.summonId);
    this.phase = "combo"; this.active = u; this.hideCmd();
    this.comboMode = "summon";
    this.comboActor = u; this.comboData = data;
    this.comboSkill = null; this.comboTargetUid = null;
    this.comboArts = data?.arts ?? [];
    this.comboSlots = data?.comboSlots ?? 5;
    this.comboInput = [];
    this.comboColor = data?.color ?? "#ffe6b0";
    this.comboTitle = "SUMMON ARTS";
    this.comboSub = `${data ? data.name.split(",")[0] : "Summon"} · ${data?.ultimate ?? ""}`;
    audio.playSfx("summon");
    this.setPrompt("Chain the arts · [↑ ↓ ← →] input · [Enter] unleash · [Esc] cancel");
    this.renderCombo();
  }

  // Enter the combo phase for a basic attack or damaging skill. The hero's own
  // battle arts are the chainable patterns; the number of input slots scales
  // with their level. Cancel returns to the command menu having spent nothing.
  private enterAttackCombo(u: BattleUnit, skill: SkillData, targetUid: string | undefined): void {
    const ch = getCharacter(u.dataId);
    const level = runState.party[u.dataId]?.level ?? 1;
    this.phase = "combo"; this.active = u; this.hideCmd();
    this.comboMode = "attack";
    this.comboActor = u; this.comboData = undefined;
    this.comboSkill = skill; this.comboTargetUid = targetUid ?? null;
    this.comboArts = ch?.arts ?? [];
    this.comboSlots = attackComboSlots(level);
    this.comboInput = [];
    this.comboColor = ch?.themeColor ?? u.themeColor ?? "#ffe6b0";
    this.comboTitle = "BATTLE ARTS";
    this.comboSub = `${u.name} · ${skill.name}`;
    audio.playSfx("move");
    this.setPrompt("Chain your arts · [↑ ↓ ← →] strike · [Enter] attack · [Esc] cancel");
    this.renderCombo();
  }

  private comboScore(): ComboResult {
    return scoreCombo(this.comboArts, this.comboInput, this.comboSlots);
  }
  private comboPush(d: ComboDir): void {
    if (this.phase !== "combo" || this.comboInput.length >= this.comboSlots) return;
    this.comboInput.push(d); audio.playSfx("move"); this.renderCombo();
  }
  private comboUndo(): void {
    if (this.phase !== "combo" || this.comboInput.length === 0) return;
    this.comboInput.pop(); audio.playSfx("cancel"); this.renderCombo();
  }
  private comboCancel(): void {
    if (this.phase !== "combo") return;
    const u = this.comboActor; this.hideCombo(); audio.playSfx("cancel");
    if (u) this.enterCommand(u);
  }
  private comboUnleash(): void {
    if (this.phase !== "combo") return;
    if (this.comboMode === "attack") this.unleashAttackCombo();
    else this.unleashSummonCombo();
  }
  private unleashSummonCombo(): void {
    const u = this.comboActor; const data = this.comboData; if (!u) return;
    const combo = this.comboScore();
    this.hideCombo(); this.phase = "anim"; this.setPrompt(""); audio.playSfx("confirm");
    const out = this.state.summon(u, combo.mult);
    this.playSummonCinematic(u, data, out, combo, () => this.animate(out, () => this.processPhases(() => this.endTurn(u))));
  }
  // Unleash a melee/skill combo: resolve with the combo strike, then play the
  // staggered multi-hit cascade for a single target (or the standard scaled
  // animation when the action hits a whole group).
  private unleashAttackCombo(): void {
    const u = this.comboActor; const skill = this.comboSkill; if (!u || !skill) return;
    const res = this.comboScore();
    const strike = comboToStrike(res);
    const targetUid = this.comboTargetUid ?? undefined;
    this.hideCombo(); this.phase = "anim"; this.setPrompt(""); audio.playSfx("confirm");
    const out = this.state.resolve(u, skill, targetUid, strike);
    if (skill.targeting === "single" && targetUid) {
      this.animateCombo(u, skill, out, res, targetUid, () => this.processPhases(() => this.endTurn(u)));
    } else {
      if (skill.kind === "physical") this.lunge(u, targetUid ?? null); else this.castHop(u);
      this.playSkillFx(u, skill, out);
      this.showComboBanner(res);
      this.animate(out, () => this.processPhases(() => this.endTurn(u)));
    }
  }

  // Staggered multi-hit cascade for a single-target combo: each engine damage
  // event lands as its own visible strike ~130ms apart, with the crit-flagged
  // finisher getting extra punch (burst + shake). Distinct from animate(), which
  // pops every event at once (used for AoE / summon). Trailing non-damage events
  // (e.g. a def-down from the skill) surface as popups after the flurry.
  private animateCombo(u: BattleUnit, skill: SkillData, out: ActionOutcome, res: ComboResult, targetUid: string, done: () => void): void {
    this.pushLog(out.log);
    this.showComboBanner(res);
    const hits = out.events.filter((e) => e.uid === targetUid && (e.kind === "damage" || e.kind === "blocked"));
    const extras = out.events.filter((e) => e.kind !== "damage" && e.kind !== "blocked");
    const col = this.elementColor(skill.element);
    const hitPos = (uid: string) => { const v = this.views.get(uid); const b = v ? v.base : new THREE.Vector3(); return new THREE.Vector3(b.x, (v?.h ?? 2) * 0.5, b.z); };
    const castPos = () => { const v = this.views.get(u.uid); const b = v ? v.base : new THREE.Vector3(); return new THREE.Vector3(b.x, (v?.h ?? 2) * 0.6, b.z); };
    this.lunge(u, targetUid); // initial approach + attack pose
    let i = 0;
    const step = () => {
      if (i >= hits.length) {
        for (const ev of extras) { const t = this.state.byUid(ev.uid); if (t && ev.text) this.popup(t, ev.text, "#c9a0ff"); }
        for (const uid of out.defeated) { const v = this.views.get(uid); if (v) this.fadeOut(v); }
        this.refreshStatus();
        this.time(420, done);
        return;
      }
      const ev = hits[i++];
      const t = this.state.byUid(targetUid);
      if (t) {
        this.refreshUnit(t);
        const tp = hitPos(targetUid);
        if (ev.kind === "blocked") { this.popup(t, "BLOCK", "#4db8ff"); audio.playSfx("cancel"); }
        else {
          const fin = !!ev.crit;
          this.popup(t, `-${ev.amount}`, fin ? "#ffd166" : "#ffffff");
          this.flash(t);
          if (i % 2 === 1) this.playHeroAttack(u); // keep the swing alive through the flurry
          if (skill.kind === "magical") this.fxBolt(castPos(), tp, col, () => this.fxBurst(tp, col, fin ? 2.4 : 1.4));
          else this.fxSlash(tp, col);
          if (fin) { this.fxBurst(tp, col, 2.8); this.shake = 0.45; audio.playSfx("crit"); }
          else audio.playSfx("hit");
        }
      }
      this.refreshStatus();
      this.time(130, step);
    };
    this.time(160, step); // let the lunge connect before the first strike
  }

  // Compact rank/×mult readout that pops over a melee combo (vs the full-screen
  // summon flash). Skipped for a no-input attack — that's just a plain swing.
  private showComboBanner(res: ComboResult): void {
    if (res.filled === 0) return;
    const rc = RANK_COLOR[res.rank] ?? "#fff";
    const el = document.createElement("div"); el.className = "cmbanner"; el.style.setProperty("--rc", rc);
    el.innerHTML = `<span class="cbr">${res.rank}</span><span class="cbm">×${res.mult.toFixed(2)}</span>${res.matched.length ? `<span class="cba">${res.matched.join(" · ")}</span>` : ""}`;
    this.root.appendChild(el);
    this.time(1100, () => el.remove());
  }

  // Build/refresh the interactive combo panel: filled/empty input slots, a live
  // rank + multiplier readout, the summon's arts reference (lit when matched),
  // an on-screen D-pad and the unleash/undo/cancel controls.
  private renderCombo(): void {
    let el = this.root.querySelector(".combo") as HTMLDivElement | null;
    if (!el) { el = document.createElement("div"); el.className = "combo"; this.root.appendChild(el); }
    el.style.setProperty("--c", this.comboColor);
    const res = this.comboScore();
    const matched = new Set(res.matched);
    const cells = Array.from({ length: this.comboSlots }, (_, i) => {
      const d = this.comboInput[i];
      const cls = d ? "f" : i === this.comboInput.length ? "n" : "";
      return `<span class="cmcell ${cls}">${d ? DIR_GLYPH[d] : ""}</span>`;
    }).join("");
    const arts = this.comboArts.map((a) => {
      const seq = a.seq.map((d) => DIR_GLYPH[d]).join("");
      return `<div class="cmart ${matched.has(a.name) ? "hit" : ""}"><span class="an">${a.name}</span><span class="aseq">${seq}</span><span class="ab">+${Math.round(a.bonus * 100)}%</span></div>`;
    }).join("");
    const rc = RANK_COLOR[res.rank] ?? "#fff";
    el.innerHTML =
      `<div class="cmbox">` +
        `<div class="cmttl">${this.comboTitle}</div>` +
        `<div class="cmsub">${this.comboSub}</div>` +
        `<div class="cmslots">${cells}</div>` +
        `<div class="cmrank" style="color:${rc}">${res.rank} · ×${res.mult.toFixed(2)}</div>` +
        `<div class="cmarts">${arts}</div>` +
        `<div class="cmpad"><div class="cmprow"><button class="cmd-btn" data-d="up">▲</button></div>` +
        `<div class="cmprow"><button class="cmd-btn" data-d="left">◀</button><button class="cmd-btn" data-d="down">▼</button><button class="cmd-btn" data-d="right">▶</button></div></div>` +
        `<div class="cmbtns"><button class="cmgo">${this.comboMode === "attack" ? "STRIKE" : "UNLEASH"}</button><button class="cmundo">UNDO</button><button class="cmcancel">CANCEL</button></div>` +
      `</div>`;
    el.querySelectorAll(".cmd-btn").forEach((b) => {
      const d = (b as HTMLElement).dataset.d as ComboDir;
      b.addEventListener("pointerdown", (ev) => { ev.preventDefault(); this.comboPush(d); });
    });
    (el.querySelector(".cmgo") as HTMLElement | null)?.addEventListener("pointerdown", (ev) => { ev.preventDefault(); this.comboUnleash(); });
    (el.querySelector(".cmundo") as HTMLElement | null)?.addEventListener("pointerdown", (ev) => { ev.preventDefault(); this.comboUndo(); });
    (el.querySelector(".cmcancel") as HTMLElement | null)?.addEventListener("pointerdown", (ev) => { ev.preventDefault(); this.comboCancel(); });
  }
  private hideCombo(): void {
    const el = this.root.querySelector(".combo") as HTMLDivElement | null;
    if (el) el.remove();
  }
  // The summon cinematic: dim the arena under an ornate DOM overlay; a glowing
  // sigil grows while the summoned creature's silhouette rises into frame with
  // its name + ultimate banner, then it discharges signature elemental FX over
  // the struck enemies with a screen shake before the outcome's popups land
  // (animate() runs in `then`).
  private playSummonCinematic(actor: BattleUnit, data: SummonData | undefined, out: ActionOutcome, combo: ComboResult | null, then: () => void): void {
    const color = data?.color ?? "#ffe6b0";
    const elColor = this.elementColor(data?.element ?? "neutral");
    const shortName = data ? data.name.split(",")[0].toUpperCase() : "SUMMON";
    const ult = data?.ultimate ?? "";
    const creature = summonSilhouette(data?.silhouette);
    audio.playSfx("summon");
    // Combo payoff banner — only shown when the player actually chained input.
    const showFlash = !!combo && combo.rank !== "MISS";
    const flash = showFlash
      ? `<div class="sflash" style="--rc:${RANK_COLOR[combo!.rank] ?? "#fff"}"><span class="srank">${combo!.rank}</span><span class="smult">×${combo!.mult.toFixed(2)}</span>${combo!.matched.length ? `<span class="sarts">${combo!.matched.join(" · ")}</span>` : ""}</div>`
      : "";
    const ov = document.createElement("div"); ov.className = "summon"; ov.style.setProperty("--c", color);
    ov.innerHTML = `<div class="sigil"></div><div class="creature">${creature}</div>${flash}<div class="sgroup"><div class="sname">${shortName}</div><div class="sult">${ult}</div></div>`;
    this.root.appendChild(ov); void ov.offsetWidth; ov.classList.add("on");
    this.refreshStatus();
    // enemies actually struck (every foe for AoE summons, one for single-target)
    const hitUids = [...new Set(out.events.filter((e) => e.kind === "damage" || e.kind === "blocked").map((e) => e.uid))];
    this.time(700, () => {
      audio.playSfx("boom"); this.shake = 0.7; ov.classList.add("cast");
      const center = new THREE.Vector3(0, 1.4, -3.6);
      this.fxBurst(center, elColor, 6.5); this.fxAura(new THREE.Vector3(0, 0.1, -3.6), elColor);
      hitUids.forEach((uid, i) => {
        const v = this.views.get(uid); const b = v ? v.base : new THREE.Vector3();
        const p = new THREE.Vector3(b.x, (v?.h ?? 2) * 0.5, b.z);
        this.time(i * 70, () => { this.fxBurst(p, elColor, 3); this.fxSlash(p, elColor); });
      });
      const av = this.views.get(actor.uid); if (av) this.fxAura(new THREE.Vector3(av.base.x, 0.1, av.base.z), elColor);
    });
    this.time(1500, () => { ov.classList.add("out"); });
    this.time(1800, () => { ov.remove(); then(); });
  }

  private enterTarget(u: BattleUnit, side: "enemy" | "ally"): void {
    this.phase = "target"; this.hideCmd();
    this.targets = side === "ally" ? this.state.alliesOf(u) : this.state.enemiesOf(u);
    if (!this.targets.length) { this.enterCommand(u); return; }
    this.targetIdx = 0; this.setPrompt("Select target · [Enter] · [Esc] back");
  }
  private confirmTarget(): void {
    const u = this.active!, t = this.targets[this.targetIdx]; if (!t) return;
    if (this.pendingItem) this.applyItem(u, this.pendingItem, t);
    else if (this.pendingSkill) this.beginSkill(u, this.pendingSkill, t.uid);
  }
  // A chosen attack/skill either opens the Legaia-style combo (damaging actions)
  // or resolves immediately (pure utility — heals, buffs, cleanse).
  private beginSkill(u: BattleUnit, skill: SkillData, targetUid: string | undefined): void {
    if (skillEffect(skill).dealsDamage) this.enterAttackCombo(u, skill, targetUid);
    else this.resolve(u, skill, targetUid);
  }
  private resolve(u: BattleUnit, skill: SkillData, targetUid: string | undefined): void {
    this.phase = "anim"; this.hideCmd(); this.setPrompt("");
    const out = this.state.resolve(u, skill, targetUid);
    if (skill.kind === "physical") this.lunge(u, targetUid ?? null); else this.castHop(u);
    this.playSkillFx(u, skill, out);
    this.animate(out, () => this.processPhases(() => this.endTurn(u)));
  }
  private applyItem(u: BattleUnit, id: string, target: BattleUnit): void {
    this.phase = "anim"; this.hideCmd();
    runState.consumeItem(id); const fx = ITEM_FX[id] ?? {}; const name = getItem(id)?.name ?? id;
    const out: ActionOutcome = { actorUid: u.uid, skillId: id, skillName: name, events: [], defeated: [], log: [`${u.name} uses ${name}.`] };
    if (fx.hp) { const amt = Math.min(fx.hp, target.maxHp - target.hp); target.hp = Math.min(target.maxHp, target.hp + fx.hp); out.events.push({ uid: target.uid, kind: "heal", amount: amt }); }
    if (fx.en) { const amt = Math.min(fx.en, target.maxEnergy - target.energy); target.energy = Math.min(target.maxEnergy, target.energy + fx.en); out.events.push({ uid: target.uid, kind: "buff", amount: amt, text: `+${amt} EN` }); }
    this.animate(out, () => this.endTurn(u));
  }
  private runEnemy(u: BattleUnit): void {
    this.phase = "enemy"; this.setPrompt(`${u.name} acts…`);
    this.time(420, () => {
      const plan = planFrontTurn(this.state, u);
      const out = this.state.resolve(u, plan.skill, plan.targetUid ?? undefined);
      if (plan.skill.kind === "physical") this.lunge(u, plan.targetUid); else this.castHop(u);
      this.playSkillFx(u, plan.skill, out);
      this.animate(out, () => this.processPhases(() => this.endTurn(u)));
    });
  }

  private animate(out: ActionOutcome, done: () => void): void {
    this.pushLog(out.log);
    for (const ev of out.events) {
      const t = this.state.byUid(ev.uid); if (!t) continue;
      this.refreshUnit(t);
      if (ev.kind === "damage") { this.popup(t, `-${ev.amount}`, ev.crit ? "#ffd166" : "#ffffff"); this.flash(t); audio.playSfx(ev.crit ? "crit" : "hit"); if (ev.crit) this.shake = 0.25; }
      else if (ev.kind === "heal") { this.popup(t, `+${ev.amount}`, "#4dff9e"); audio.playSfx("heal"); }
      else if (ev.kind === "miss") this.popup(t, "MISS", "#9d8fd0");
      else if (ev.kind === "blocked") this.popup(t, "BLOCK", "#4db8ff");
      else if (ev.text) this.popup(t, ev.text, "#c9a0ff");
    }
    for (const uid of out.defeated) { const v = this.views.get(uid); if (v) this.fadeOut(v); }
    this.refreshStatus();
    this.time(640, done);
  }
  private processPhases(then: () => void): void {
    const outs = this.state.checkPhaseTransitions();
    if (!outs.length) { then(); return; }
    let i = 0;
    const next = () => {
      if (i >= outs.length) { then(); return; }
      const o = outs[i++]; this.pushLog(o.log); this.bannerText(o.bannerText, "#ff4d6d"); this.shake = 0.4; audio.playSfx("crit");
      for (const ev of o.events) { const t = this.state.byUid(ev.uid); if (t) { this.refreshUnit(t); if (ev.kind === "damage") this.popup(t, `-${ev.amount}`, "#ff9d5c"); } }
      for (const uid of o.defeated) { const v = this.views.get(uid); if (v) this.fadeOut(v); }
      this.refreshStatus(); this.time(1100, next);
    };
    next();
  }

  // ---- finish + results -------------------------------------------------

  private finish(victor: "player" | "enemy"): void {
    this.phase = "over"; this.hideCmd(); this.setPrompt("");
    for (const u of this.state.units) if (u.team === "player" && runState.party[u.dataId]) runState.party[u.dataId].hp = u.alive ? u.hp : 0;
    const isBoss = this.pending.kind === "boss";
    const win = victor === "player";
    let xp = 0, gold = 0, levels: LevelUpEvent[] = [];
    if (win) {
      const foes = this.state.units.filter((u) => u.team === "enemy");
      xp = foes.reduce((s, u) => s + enemyXp(getEnemy(u.dataId)), 0);
      if (isBoss) { const d = getEnemy(runState.stage.bossId).drops; if (d) runState.addItems(d); gold = 40 + runState.chapterNumber * 30 + Math.max(0, foes.length - 1) * 15; }
      else { gold = 12 + runState.chapterNumber * 6 + foes.length * 4; if (this.pending.key) runState.clearEncounter(this.pending.key); }
      runState.addGold(gold); levels = awardXp(xp);
    }
    const runComplete = win && isBoss && runState.isLastStage;
    this.showResults(win, isBoss, runComplete, xp, gold, levels);
  }
  private showResults(win: boolean, isBoss: boolean, runComplete: boolean, xp: number, gold: number, levels: LevelUpEvent[]): void {
    audio.playSfx(win ? "victory" : "defeat");
    const title = runComplete ? "RUN COMPLETE" : win ? "VICTORY" : "DEFEAT";
    const sub = !win ? "Defeated — press ENTER to regroup." : isBoss ? "Chapter cleared — press ENTER." : "Area clear — press ENTER.";
    const lines = win ? [`+${xp} XP   +${gold} ◆`, ...levels.map((e) => `${e.name} Lv ${e.fromLevel}→${e.toLevel}${e.promotedTo ? ` ★${e.promotedTo}` : ""}`)] : [];
    const res = document.createElement("div"); res.className = "res";
    res.innerHTML = `<div class="t" style="color:${win ? "#4dff9e" : "#ff4d6d"}">${title}</div><div class="s">${sub}</div><div class="x">${lines.join("\n")}</div>`;
    this.root.appendChild(res);
    const done = () => this.onFinish({ win, isBoss, runComplete });
    window.addEventListener("keydown", function once(e) { if (e.key === "Enter" || e.key === " ") { window.removeEventListener("keydown", once); done(); } });
    res.style.pointerEvents = "auto";
    res.addEventListener("pointerdown", done);
  }

  // ---- rendering helpers ------------------------------------------------

  private refreshUnit(u: BattleUnit): void {
    const v = this.views.get(u.uid); if (!v) return;
    if (v.hp) (v.hp.material as THREE.SpriteMaterial).map = this.makeHpTex(u);
    if (u.team === "player") this.refreshStatus();
  }
  private lunge(u: BattleUnit, targetUid: string | null): void {
    const v = this.views.get(u.uid); if (!v) return;
    const tp = targetUid ? this.views.get(targetUid)?.base : null;
    const dz = tp ? Math.sign(tp.z - v.base.z) * 0.9 : -0.5;
    this.tweens.push({ obj: v.sprite, key: "z", from: v.base.z, to: v.base.z + dz, t: 0, dur: 0.16, yoyo: true });
    this.playHeroAttack(u);
  }
  // a small upward hop for casters (magic / heal / buff) instead of a lunge
  private castHop(u: BattleUnit): void {
    const v = this.views.get(u.uid); if (!v) return;
    this.tweens.push({ obj: v.sprite, key: "y", from: v.base.y, to: v.base.y + 0.5, t: 0, dur: 0.18, yoyo: true });
    this.playHeroAttack(u);
  }
  // Hero units swap their back-facing rest texture for the attack strip for
  // the duration of HERO_ATTACK_FRAMES / HERO_ATTACK_FPS seconds, advancing
  // through the strip's frames. Reverts to restTex when done. No-op for any
  // unit that isn't a hero or whose attack strip hasn't loaded yet.
  private playHeroAttack(u: BattleUnit): void {
    if (u.team !== "player" || !HERO_IDS.has(u.dataId)) return;
    const v = this.views.get(u.uid); if (!v || !v.attackTex || !v.restTex) return;
    const mat = v.sprite.material as THREE.SpriteMaterial;
    v.attackTex.offset.x = 0;
    mat.map = v.attackTex; mat.needsUpdate = true;
    // Match the sprite's horizontal extent to the attack-frame aspect so the
    // figure doesn't squish (back.png is narrow; attack frames are wider).
    if (v.attackScaleX) v.sprite.scale.x = v.attackScaleX;
    // remove any prior pending revert for this unit (re-triggers mid-attack)
    this.heroAnims = this.heroAnims.filter((a) => a.uid !== u.uid);
    this.heroAnims.push({ uid: u.uid, t: 0, dur: (HERO_ATTACK_FRAMES - 1) / HERO_ATTACK_FPS + 0.05 });
  }
  private flash(u: BattleUnit): void {
    const v = this.views.get(u.uid); if (!v) return;
    const m = v.sprite.material as THREE.SpriteMaterial; m.opacity = 0.35;
    this.time(80, () => { m.opacity = 1; });
  }
  private fadeOut(v: View): void { this.time(250, () => { const m = v.sprite.material as THREE.SpriteMaterial; m.transparent = true; this.tweens.push({ obj: v.sprite, key: "y", from: 0, to: -0.5, t: 0, dur: 0.4, yoyo: false }); m.opacity = 0; if (v.hp) (v.hp.material as THREE.SpriteMaterial).opacity = 0; }); }
  private popup(u: BattleUnit, text: string, color: string): void {
    const v = this.views.get(u.uid); const base = v ? v.base : new THREE.Vector3();
    const c = document.createElement("canvas"); c.width = 128; c.height = 48;
    const x = c.getContext("2d")!; x.font = "bold 30px monospace"; x.textAlign = "center"; x.textBaseline = "middle";
    x.lineWidth = 5; x.strokeStyle = "#000"; x.strokeText(text, 64, 24); x.fillStyle = color; x.fillText(text, 64, 24);
    const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false, depthTest: false }));
    spr.scale.set(2, 0.75, 1); spr.position.set(base.x, (v?.h ?? 2) + 0.6, base.z);
    this.scene.add(spr); this.popups.push({ spr, t: 0 });
  }

  // ---- themed environment ----------------------------------------------
  private applyEnv(stageId: string): void {
    const e = BATTLE_ENV[stageId] ?? BATTLE_ENV.default;
    (this.scene.fog as THREE.FogExp2).color.setHex(e.fog);
    this.hemi.color.setHex(e.hemiSky); this.hemi.groundColor.setHex(e.hemiGround);
    this.keyLight.color.setHex(e.key);
    this.groundMat.color.setHex(e.ground);
    if (this.motes) (this.motes.material as THREE.PointsMaterial).color.setHex(e.particle);
  }
  // dark foreground foliage silhouettes framing the shot (depth, Octopath-style)
  private buildFraming(): void {
    const tex = this.framingTex();
    for (const sx of [-1, 1]) {
      const m = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, color: 0x05030d, opacity: 0.97 }));
      m.center.set(0.5, 0);
      m.scale.set(10 * sx, 14, 1);
      m.position.set(sx * 13, 0, 6);
      this.scene.add(m);
    }
  }

  // ---- skill animations -------------------------------------------------
  private fxSprite(tex: THREE.Texture, color: number): THREE.Sprite {
    return new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending, color }));
  }
  private elementColor(el: string): number { return el === "code-energy" ? 0xc488ff : el === "code-tech" ? 0x6fd6ff : 0xffd98a; }

  private playSkillFx(actor: BattleUnit, skill: SkillData, out: ActionOutcome): void {
    const av = this.views.get(actor.uid);
    const castPos = new THREE.Vector3(av ? av.base.x : 0, (av?.h ?? 2) * 0.6, av ? av.base.z : 0);
    const col = this.elementColor(skill.element);
    const tpos = (uid: string) => { const v = this.views.get(uid); const b = v ? v.base : new THREE.Vector3(); return new THREE.Vector3(b.x, (v?.h ?? 2) * 0.5, b.z); };
    const dmg = out.events.filter((e) => e.kind === "damage").map((e) => e.uid);
    const heals = out.events.filter((e) => e.kind === "heal").map((e) => e.uid);
    if (skill.kind === "heal" || heals.length) { for (const uid of (heals.length ? heals : dmg)) this.fxHeal(tpos(uid)); return; }
    if (skill.kind === "buff") { this.fxAura(new THREE.Vector3(castPos.x, 0.1, castPos.z), 0xffd98a); return; }
    if (skill.kind === "debuff" && !dmg.length) { for (const ev of out.events) this.fxDebuff(tpos(ev.uid)); return; }
    const tgts = dmg.length ? dmg : out.events.map((e) => e.uid);
    tgts.forEach((uid, i) => {
      const tp = tpos(uid);
      if (skill.kind === "magical") this.time(i * 60, () => this.fxBolt(castPos.clone(), tp, col, () => this.fxBurst(tp, col, 2)));
      else this.time(i * 50, () => this.fxSlash(tp, col));
    });
  }
  private fxBurst(p: THREE.Vector3, color: number, size = 2.2): void {
    const ring = this.fxSprite(this.ringTex(), color); ring.position.copy(p); this.scene.add(ring);
    const flash = this.fxSprite(this.glowTex(), color); flash.position.copy(p); flash.scale.set(size, size, 1); this.scene.add(flash);
    this.fx.push({ t: 0, dur: 0.4, apply: (pr) => { const sc = size * (0.4 + pr * 1.7); ring.scale.set(sc, sc, 1); (ring.material as THREE.SpriteMaterial).opacity = 1 - pr; (flash.material as THREE.SpriteMaterial).opacity = (1 - pr) * 0.9; }, done: () => { this.scene.remove(ring); this.scene.remove(flash); } });
  }
  private fxSlash(p: THREE.Vector3, color: number): void {
    const sl = this.fxSprite(this.slashTex(), color); sl.position.copy(p); sl.scale.set(2.8, 2.8, 1); this.scene.add(sl);
    this.fx.push({ t: 0, dur: 0.24, apply: (pr) => { (sl.material as THREE.SpriteMaterial).opacity = Math.sin(pr * Math.PI); (sl.material as THREE.SpriteMaterial).rotation = -0.5 + pr * 1.0; }, done: () => this.scene.remove(sl) });
    this.fxBurst(p, color, 1.4);
  }
  private fxBolt(from: THREE.Vector3, to: THREE.Vector3, color: number, onHit: () => void): void {
    const orb = this.fxSprite(this.glowTex(), color); orb.position.copy(from); orb.scale.set(1.2, 1.2, 1); this.scene.add(orb);
    this.fx.push({ t: 0, dur: 0.26, apply: (pr) => { orb.position.lerpVectors(from, to, pr); const s = 1.2 + Math.sin(pr * Math.PI) * 0.5; orb.scale.set(s, s, 1); }, done: () => { this.scene.remove(orb); onHit(); } });
  }
  private fxHeal(p: THREE.Vector3, color = 0x6affa0): void {
    const ring = this.fxSprite(this.ringTex(), color); ring.position.set(p.x, 0.1, p.z); this.scene.add(ring);
    this.fx.push({ t: 0, dur: 0.5, apply: (pr) => { const s = 1 + pr * 2.4; ring.scale.set(s, s, 1); (ring.material as THREE.SpriteMaterial).opacity = (1 - pr) * 0.85; }, done: () => this.scene.remove(ring) });
    for (let i = 0; i < 6; i++) {
      const sp = this.fxSprite(this.sparkTex(), color); const ox = (Math.random() - 0.5) * 1.5;
      sp.position.set(p.x + ox, 0.2, p.z); sp.scale.set(0.55, 0.55, 1); this.scene.add(sp);
      const sway = (Math.random() - 0.5) * 0.6;
      this.fx.push({ t: 0, dur: 0.6 + Math.random() * 0.2, apply: (pr) => { sp.position.y = 0.2 + pr * 2.6; sp.position.x = p.x + ox + Math.sin(pr * 6) * sway; (sp.material as THREE.SpriteMaterial).opacity = Math.sin(pr * Math.PI); }, done: () => this.scene.remove(sp) });
    }
  }
  private fxAura(p: THREE.Vector3, color: number): void {
    const ring = this.fxSprite(this.ringTex(), color); ring.position.copy(p); this.scene.add(ring);
    const col = this.fxSprite(this.glowTex(), color); col.center.set(0.5, 0); col.position.set(p.x, 0, p.z); col.scale.set(2.4, 3.4, 1); this.scene.add(col);
    this.fx.push({ t: 0, dur: 0.6, apply: (pr) => { const s = 0.6 + pr * 2.6; ring.scale.set(s, s, 1); (ring.material as THREE.SpriteMaterial).opacity = (1 - pr) * 0.9; (col.material as THREE.SpriteMaterial).opacity = Math.sin(pr * Math.PI) * 0.7; }, done: () => { this.scene.remove(ring); this.scene.remove(col); } });
  }
  private fxDebuff(p: THREE.Vector3, color = 0x9a5ad0): void {
    const ring = this.fxSprite(this.ringTex(), color); ring.position.copy(p); this.scene.add(ring);
    this.fx.push({ t: 0, dur: 0.5, apply: (pr) => { const s = 2.6 - pr * 2.0; ring.scale.set(s, s, 1); (ring.material as THREE.SpriteMaterial).opacity = pr < 0.2 ? pr * 4 : (1 - pr); (ring.material as THREE.SpriteMaterial).rotation = pr * 3; }, done: () => this.scene.remove(ring) });
    this.fxBurst(p, color, 1.2);
  }

  // ---- procedural FX / env textures (cached) ---------------------------
  private arenaTex(): THREE.Texture {
    if (this._arena) return this._arena;
    const s = 256, c = document.createElement("canvas"); c.width = s; c.height = s;
    const x = c.getContext("2d")!; x.imageSmoothingEnabled = false;
    const g = x.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    g.addColorStop(0, "#ffffff"); g.addColorStop(0.4, "#c2c2d2"); g.addColorStop(0.72, "#52526a"); g.addColorStop(1, "#0e0e18");
    x.fillStyle = g; x.fillRect(0, 0, s, s);
    // faint radial spokes (worn paving / energy seams)
    x.save(); x.translate(s / 2, s / 2); x.strokeStyle = "rgba(255,255,255,0.05)"; x.lineWidth = 2;
    for (let a = 0; a < 16; a++) { x.rotate(Math.PI / 8); x.beginPath(); x.moveTo(14, 0); x.lineTo(s / 2, 0); x.stroke(); }
    x.restore();
    // concentric rings + a brighter inner sigil ring where the combatants stand
    x.strokeStyle = "rgba(255,255,255,0.07)"; x.lineWidth = 1;
    for (let r = 28; r < s / 2; r += 32) { x.beginPath(); x.arc(s / 2, s / 2, r, 0, Math.PI * 2); x.stroke(); }
    x.strokeStyle = "rgba(222,222,236,0.16)"; x.lineWidth = 3; x.beginPath(); x.arc(s / 2, s / 2, 60, 0, Math.PI * 2); x.stroke();
    // luminance-only speckle grain (stone / tech texture), fading out toward the rim
    for (let i = 0; i < 2200; i++) {
      const px = (Math.random() * s) | 0, py = (Math.random() * s) | 0;
      const d = Math.hypot(px - s / 2, py - s / 2) / (s / 2);
      if (Math.random() < d * 0.5) continue;
      const v = Math.random() < 0.5 ? 0 : 255;
      x.fillStyle = `rgba(${v},${v},${v},0.05)`; x.fillRect(px, py, 1, 1);
    }
    this._arena = new THREE.CanvasTexture(c); this._arena.colorSpace = THREE.SRGBColorSpace; this._arena.anisotropy = 4; return this._arena;
  }
  private framingTex(): THREE.Texture {
    const W = 128, H = 192, c = document.createElement("canvas"); c.width = W; c.height = H;
    const x = c.getContext("2d")!; x.fillStyle = "#fff";
    const blob = (bx: number, by: number, r: number) => { x.beginPath(); x.arc(bx, by, r, 0, Math.PI * 2); x.fill(); };
    const leaf = (bx: number, by: number, tx: number, ty: number, w: number) => { x.beginPath(); x.moveTo(bx - w, by); x.lineTo(tx, ty); x.lineTo(bx + w, by); x.closePath(); x.fill(); };
    // stem cluster
    x.fillRect(W * 0.40, H * 0.45, W * 0.10, H * 0.55);
    x.fillRect(W * 0.55, H * 0.55, W * 0.07, H * 0.45);
    // main canopy mass (irregular outline)
    blob(W * 0.5, H * 0.30, W * 0.34); blob(W * 0.3, H * 0.42, W * 0.26); blob(W * 0.7, H * 0.42, W * 0.26);
    blob(W * 0.5, H * 0.16, W * 0.26); blob(W * 0.22, H * 0.30, W * 0.18); blob(W * 0.78, H * 0.32, W * 0.18);
    // drooping fronds hanging into frame (organic silhouette)
    for (let i = 0; i < 7; i++) { const fx = W * (0.16 + i * 0.11); leaf(fx, H * 0.5, fx + (i % 2 ? 10 : -10), H * (0.66 + (i % 3) * 0.05), 7); }
    // scattered clumps breaking the outline
    blob(W * 0.14, H * 0.5, W * 0.1); blob(W * 0.86, H * 0.52, W * 0.1); blob(W * 0.5, H * 0.5, W * 0.16);
    return new THREE.CanvasTexture(c);
  }
  private ringTex(): THREE.Texture {
    if (this._ring) return this._ring;
    const s = 128, c = document.createElement("canvas"); c.width = s; c.height = s;
    const x = c.getContext("2d")!; x.strokeStyle = "#fff";
    x.lineWidth = 9; x.beginPath(); x.arc(s / 2, s / 2, s / 2 - 12, 0, Math.PI * 2); x.stroke();
    x.globalAlpha = 0.45; x.lineWidth = 22; x.stroke();
    this._ring = new THREE.CanvasTexture(c); return this._ring;
  }
  private slashTex(): THREE.Texture {
    if (this._slash) return this._slash;
    const s = 128, c = document.createElement("canvas"); c.width = s; c.height = s;
    const x = c.getContext("2d")!; x.translate(s / 2, s / 2); x.rotate(-0.4); x.strokeStyle = "#fff"; x.lineCap = "round";
    x.lineWidth = 7; x.beginPath(); x.arc(0, 0, 46, -1.0, 1.0); x.stroke();
    x.globalAlpha = 0.5; x.lineWidth = 18; x.stroke();
    this._slash = new THREE.CanvasTexture(c); return this._slash;
  }
  private sparkTex(): THREE.Texture {
    if (this._spark) return this._spark;
    const s = 64, c = document.createElement("canvas"); c.width = s; c.height = s;
    const x = c.getContext("2d")!; x.translate(s / 2, s / 2);
    const g = x.createRadialGradient(0, 0, 0, 0, 0, 9); g.addColorStop(0, "#fff"); g.addColorStop(1, "rgba(255,255,255,0)");
    x.fillStyle = g; x.beginPath(); x.arc(0, 0, 9, 0, Math.PI * 2); x.fill();
    x.fillStyle = "rgba(255,255,255,0.9)"; x.fillRect(-1, -15, 2, 30); x.fillRect(-15, -1, 30, 2);
    this._spark = new THREE.CanvasTexture(c); return this._spark;
  }

  // ---- DOM UI -----------------------------------------------------------

  private banner(): void { const u = this.active; this.bannerText(`ROUND ${this.state.round}  ·  ${u ? (u.team === "player" ? "▶ " : "") + u.name : ""}`, "#ffd9e2"); }
  private bannerText(t: string, color: string): void { const b = this.root.querySelector(".ban") as HTMLDivElement; b.textContent = t; b.style.color = color; }
  private setPrompt(t: string): void { (this.root.querySelector(".prompt") as HTMLDivElement).textContent = t; }
  private pushLog(lines: string[]): void { this.log.push(...lines); this.log = this.log.slice(-2); (this.root.querySelector(".log") as HTMLDivElement).textContent = this.log.join("  ·  "); }
  private hideCmd(): void { (this.root.querySelector(".cmd") as HTMLDivElement).style.display = "none"; }
  private renderCmd(): void {
    const el = this.root.querySelector(".cmd") as HTMLDivElement; el.style.display = "block";
    el.innerHTML = this.menu.map((m, i) => `<div class="r ${i === this.menuIdx ? "sel" : ""} ${m.disabled ? "dis" : ""}" data-i="${i}">${m.label}</div>`).join("");
    el.querySelectorAll(".r").forEach((r) => {
      const i = Number((r as HTMLElement).dataset.i);
      r.addEventListener("pointerenter", () => { this.menuIdx = i; this.renderCmd(); });
      r.addEventListener("pointerdown", () => { this.menuIdx = i; this.pickMenu(); });
    });
  }
  private pickMenu(): void { const m = this.menu[this.menuIdx]; if (m && !m.disabled) { audio.playSfx("confirm"); m.onPick(); } }
  private refreshStatus(): void {
    const el = this.root.querySelector(".status") as HTMLDivElement;
    const party = this.state ? this.state.units.filter((u) => u.team === "player") : [];
    el.innerHTML = party.map((u) => {
      const max = u.maxHp, hpf = Math.max(0, u.hp / max) * 100, enf = u.maxEnergy ? Math.max(0, u.energy / u.maxEnergy) * 100 : 0;
      const smf = u.summonMax ? Math.max(0, u.summonCharge / u.summonMax) * 100 : 0;
      const rdy = u.summonMax > 0 && u.summonCharge >= u.summonMax;
      const act = this.active?.uid === u.uid && this.phase !== "anim" && this.phase !== "enemy" && this.phase !== "over";
      return `<div class="prow ${act ? "act" : ""}"><span class="nm">${u.name}</span>
        <span class="bars">
          <span class="bar"><i style="width:${hpf}%;background:${hpf > 50 ? "#4dff9e" : hpf > 25 ? "#ffd166" : "#ff5d7a"}"></i></span>
          <span class="bar en"><i style="width:${enf}%"></i></span>
          <span class="bar sm ${rdy ? "rdy" : ""}"><i style="width:${smf}%"></i></span>
        </span>
        <span class="num">${u.hp}/${max}<br>EN ${u.energy}${rdy ? ' <b style="color:#ffe9a8">◈</b>' : ""}</span></div>`;
    }).join("");
  }

  private usableItems(): { id: string; count: number }[] { return runState.inventoryEntries().filter((e) => e.count > 0 && ITEM_FX[e.id]); }

  private onKey(e: KeyboardEvent): void {
    const k = e.key.toLowerCase();
    if (this.phase === "command" || this.phase === "skill" || this.phase === "item") {
      if (k === "arrowup" || k === "w") { this.menuIdx = (this.menuIdx - 1 + this.menu.length) % this.menu.length; this.renderCmd(); audio.playSfx("move"); }
      else if (k === "arrowdown" || k === "s") { this.menuIdx = (this.menuIdx + 1) % this.menu.length; this.renderCmd(); audio.playSfx("move"); }
      else if (k === "enter" || k === " ") this.pickMenu();
      else if (k === "escape" || k === "x") { if (this.active && this.phase !== "command") this.enterCommand(this.active); }
    } else if (this.phase === "target") {
      if (k === "arrowleft" || k === "arrowup" || k === "a" || k === "w") { this.targetIdx = (this.targetIdx - 1 + this.targets.length) % this.targets.length; audio.playSfx("move"); }
      else if (k === "arrowright" || k === "arrowdown" || k === "d" || k === "s") { this.targetIdx = (this.targetIdx + 1) % this.targets.length; audio.playSfx("move"); }
      else if (k === "enter" || k === " ") { audio.playSfx("confirm"); this.confirmTarget(); }
      else if (k === "escape" || k === "x") { if (this.active) this.enterCommand(this.active); }
    } else if (this.phase === "combo") {
      if (KEY_DIR[k]) { e.preventDefault(); this.comboPush(KEY_DIR[k]); }
      else if (k === "enter" || k === " ") { e.preventDefault(); this.comboUnleash(); }
      else if (k === "backspace") { e.preventDefault(); this.comboUndo(); }
      else if (k === "escape" || k === "x") this.comboCancel();
    }
  }

  // ---- loop -------------------------------------------------------------

  private timers: { at: number; fn: () => void }[] = [];
  private now = 0;
  private time(ms: number, fn: () => void): void { this.timers.push({ at: this.now + ms / 1000, fn }); }

  update(dt: number): void {
    this.now += dt;
    // timers
    for (let i = this.timers.length - 1; i >= 0; i--) if (this.now >= this.timers[i].at) { const f = this.timers[i].fn; this.timers.splice(i, 1); f(); }
    // tweens
    for (let i = this.tweens.length - 1; i >= 0; i--) {
      const t = this.tweens[i]; t.t += dt; let p = Math.min(1, t.t / t.dur);
      const e = t.yoyo ? Math.sin(p * Math.PI) : p;
      (t.obj.position as unknown as Record<string, number>)[t.key] = t.from + (t.to - t.from) * (t.yoyo ? e : p);
      if (p >= 1) this.tweens.splice(i, 1);
    }
    // target cursor highlight (scale pulse)
    if (this.phase === "target") this.targets.forEach((u, i) => { const v = this.views.get(u.uid); if (v) v.sprite.material.opacity = i === this.targetIdx ? (0.6 + 0.4 * Math.abs(Math.sin(this.now * 6))) : 1; });
    else this.views.forEach((v) => { (v.sprite.material as THREE.SpriteMaterial).opacity = Math.max((v.sprite.material as THREE.SpriteMaterial).opacity, 1); });
    // popups float + fade
    for (let i = this.popups.length - 1; i >= 0; i--) {
      const p = this.popups[i]; p.t += dt; p.spr.position.y += dt * 1.2; (p.spr.material as THREE.SpriteMaterial).opacity = Math.max(0, 1 - p.t / 0.8);
      if (p.t > 0.8) { this.scene.remove(p.spr); this.popups.splice(i, 1); }
    }
    // camera shake
    if (this.shake > 0) { this.shake = Math.max(0, this.shake - dt); this.camera.position.x = (Math.random() - 0.5) * this.shake; }
    else this.camera.position.x = 0;
    // 2-frame idle animation for enemy sheets (gentle breathe)
    if (this.sheetTex.size) { const fr = (Math.floor(this.now * 2.4) % 2) * 0.5; for (const t of this.sheetTex) t.offset.x = fr; }
    // hero attack-strip animation: advance frame, revert to rest texture when done
    if (this.heroAnims.length) {
      for (let i = this.heroAnims.length - 1; i >= 0; i--) {
        const a = this.heroAnims[i]; a.t += dt;
        const v = this.views.get(a.uid);
        if (!v || !v.attackTex || !v.restTex) { this.heroAnims.splice(i, 1); continue; }
        if (a.t >= a.dur) {
          const mat = v.sprite.material as THREE.SpriteMaterial;
          mat.map = v.restTex; mat.needsUpdate = true;
          if (v.restScaleX) v.sprite.scale.x = v.restScaleX;
          this.heroAnims.splice(i, 1);
        } else {
          const frames = v.attackFrames ?? HERO_ATTACK_FRAMES;
          const f = Math.min(frames - 1, Math.floor(a.t * HERO_ATTACK_FPS));
          v.attackTex.offset.x = f / frames;
        }
      }
    }
    // skill FX (slashes, bolts, bursts, heals, auras)
    for (let i = this.fx.length - 1; i >= 0; i--) {
      const f = this.fx[i]; f.t += dt;
      if (f.t >= 0) f.apply(Math.min(1, Math.max(0, f.t / f.dur)));
      if (f.t >= f.dur) { f.done?.(); this.fx.splice(i, 1); }
    }
    // drifting atmosphere motes
    if (this.motes) {
      const attr = this.motes.geometry.getAttribute("position") as THREE.BufferAttribute;
      const arr = attr.array as Float32Array;
      for (let i = 0; i < this.moteSpeeds.length; i++) {
        let y = arr[i * 3 + 1] + this.moteSpeeds[i] * dt;
        if (y > 12) y = 0.3;
        arr[i * 3 + 1] = y;
        arr[i * 3] += Math.sin(this.now * 0.6 + i) * dt * 0.2;
      }
      attr.needsUpdate = true;
    }
  }

  // Soft drifting motes filling the arena with depth (matches the field look).
  private buildAtmosphere(): void {
    const N = 210;
    const pos = new Float32Array(N * 3);
    this.moteSpeeds = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 52;
      pos[i * 3 + 1] = 0.3 + Math.random() * 11.4;
      pos[i * 3 + 2] = -20 + Math.random() * 30;
      this.moteSpeeds[i] = 0.1 + Math.random() * 0.55;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    const c = document.createElement("canvas"); c.width = 32; c.height = 32;
    const x = c.getContext("2d")!;
    const g = x.createRadialGradient(16, 16, 0, 16, 16, 16);
    g.addColorStop(0, "rgba(255,255,255,1)"); g.addColorStop(0.4, "rgba(255,255,255,0.55)"); g.addColorStop(1, "rgba(255,255,255,0)");
    x.fillStyle = g; x.fillRect(0, 0, 32, 32);
    const mat = new THREE.PointsMaterial({
      map: new THREE.CanvasTexture(c), color: 0x9fb0ff, size: 0.2, sizeAttenuation: true,
      transparent: true, opacity: 0.46, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.motes = new THREE.Points(geo, mat);
    this.motes.frustumCulled = false;
    this.scene.add(this.motes);
  }

  render(): void { this.composer.render(); }
  renderOnce(dt = 1 / 60): void { this.update(dt); this.render(); }
  private startLoop(): void {
    this.running = true; this.last = performance.now();
    const loop = (t: number) => { if (!this.running) return; const dt = Math.min(0.05, (t - this.last) / 1000); this.last = t; this.update(dt); this.render(); requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  }

  dispose(): void {
    this.running = false;
    window.removeEventListener("keydown", this.keyHandler);
    window.removeEventListener("resize", this.resizeHandler);
    this.root.remove();
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh; if (m.geometry) m.geometry.dispose();
      const mat = (m as unknown as { material?: THREE.Material | THREE.Material[] }).material;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose()); else if (mat) mat.dispose();
    });
  }
}
