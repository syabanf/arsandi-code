// Generates procedural creature sprites for every minion enemy (no source art
// exists for them). Each minion is drawn from one of a few monster archetypes
// — mechanical drone, ethereal wisp, serpent, or bulky brute — chosen by its
// id, then tinted by a hash of the id and given an outline + simple shading.
//
// Output: sprites/minion-<id>.png   ·   Run with: npm run minions

import sharp from "sharp";
import { mkdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(root, "public", "assets", "sprites");
const S = 48;

function makeRng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}
function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
function hsl(h, s, l) {
  const a = s * Math.min(l, 1 - l);
  const f = (n) => {
    const k = (n + h * 12) % 12;
    return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
  };
  return [f(0), f(8), f(4)];
}

function archetypeOf(id) {
  if (/golem|husk|sentinel|guardian|legionnaire|seraph|knight|fortress|iron|stone/.test(id)) return "construct";
  if (/eel|squid|leech|drake|leviath|crawler|serpent|snake/.test(id)) return "serpent";
  if (/drone|sentry|bot|unit|android|spark|packet/.test(id)) return "drone";
  if (/wisp|shade|wraith|angel|jelly|acolyte|priest|core|ghost|spirit/.test(id)) return "wisp";
  return "brute";
}

// Elemental palette: ice/fire/water tint the new themed monsters; everything
// else falls back to the game's cool cyan->violet arc keyed by the id hash.
function elementOf(id) {
  if (/frost|ice|glacier|rime|snow/.test(id)) return { h: 0.55, s: 0.42, eye: [200, 240, 255] };
  if (/magma|cinder|forge|ember|flame|fire|burn|lava/.test(id)) return { h: 0.04, s: 0.72, eye: [255, 214, 120] };
  if (/drown|tide|bog|abyss|eel|squid|water|leviath|aqua/.test(id)) return { h: 0.47, s: 0.55, eye: [150, 255, 230] };
  return null;
}

function minionPixels(id) {
  const rng = makeRng(hash(id));
  const el = elementOf(id);
  const hue = el ? el.h : 0.5 + rng() * 0.33;
  const sat = el ? el.s : 0.5;
  const arche = archetypeOf(id);

  const shadow = hsl(hue, Math.min(1, sat + 0.12), 0.24);
  const dark = hsl(hue, Math.min(1, sat + 0.05), 0.35);
  const base = hsl(hue, sat, 0.5);
  const light = hsl(hue, Math.max(0.1, sat - 0.05), 0.66);
  const hi = hsl(hue, Math.max(0.08, sat - 0.2), 0.84);
  const outline = hsl(hue, Math.min(1, sat + 0.1), 0.12);
  const eye = el ? el.eye : (rng() < 0.5 ? [130, 235, 255] : [255, 95, 115]);

  const col = new Array(S * S).fill(null);
  const set = (x, y, c) => { x = Math.round(x); y = Math.round(y); if (x >= 0 && y >= 0 && x < S && y < S && c) col[y * S + x] = c; };
  const filled = (x, y) => x >= 0 && y >= 0 && x < S && y < S && col[y * S + x] !== null;
  const ellipse = (cx, cy, rx, ry, c) => {
    for (let y = Math.floor(cy - ry); y <= cy + ry; y++)
      for (let x = Math.floor(cx - rx); x <= cx + rx; x++) {
        const dx = (x - cx) / rx, dy = (y - cy) / ry;
        if (dx * dx + dy * dy <= 1) set(x, y, c);
      }
  };
  const rect = (x0, y0, w, h, c) => { for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) set(x, y, c); };

  if (arche === "drone") {
    rect(10, 34, 5, 4, shadow); rect(33, 34, 5, 4, shadow);   // thrusters
    set(12, 38, eye); set(36, 38, eye);
    ellipse(7, 24, 5, 8, dark); ellipse(41, 24, 5, 8, dark);  // side fins
    ellipse(7, 22, 3, 5, base); ellipse(41, 22, 3, 5, base);
    ellipse(24, 24, 13, 11, base);                            // chassis
    ellipse(24, 19, 11, 5, light);                            // top sheen
    ellipse(22, 16, 5, 2, hi);                                // highlight
    rect(13, 28, 22, 1, dark);                                // panel seam
    rect(24, 6, 1, 6, dark); ellipse(24, 5, 1.6, 1.6, eye);   // antenna
    ellipse(24, 25, 6, 6, shadow); ellipse(24, 25, 4, 4, dark);
    ellipse(24, 25, 2.4, 2.4, eye); set(23, 24, hi);          // lens eye
  } else if (arche === "wisp") {
    for (let y = 26; y < 46; y++) {                           // flowing tail
      const w = Math.max(0, 6 - Math.floor((y - 26) / 2.2));
      const sway = Math.round(Math.sin(y * 0.5) * 2);
      rect(24 - w + sway, y, w * 2 + 1, 1, y % 2 ? base : dark);
    }
    ellipse(24, 20, 11, 12, dark);                            // orb
    ellipse(24, 19, 9, 10, base);
    ellipse(24, 16, 6, 6, light);
    ellipse(22, 13, 3, 3, hi);
    ellipse(24, 19, 3.6, 3.6, eye); set(24, 18, hi);          // core
    for (let n = 0; n < 7; n++) set(8 + Math.floor(rng() * 32), 6 + Math.floor(rng() * 34), n % 2 ? light : eye);
  } else if (arche === "serpent") {
    for (let t = 9; t >= 0; t--) {                            // wavy body
      const cx = 24 + Math.sin(t * 0.7) * 9, cy = 6 + t * 4, r = t === 0 ? 6 : 4.4;
      ellipse(cx, cy, r, r, t % 2 ? base : dark);
      if (t > 0) ellipse(cx - 1, cy - 1, r * 0.5, r * 0.5, light);
    }
    const hx = 24;
    ellipse(hx, 6, 6, 6, base); ellipse(hx - 1, 4, 4, 2.5, light);
    set(hx - 6, 6, dark); set(hx + 6, 6, dark);               // fins
    set(hx - 2, 7, eye); set(hx + 2, 7, eye);                 // eyes
  } else if (arche === "construct") {
    rect(15, 36, 6, 9, shadow); rect(27, 36, 6, 9, shadow);   // legs
    rect(6, 22, 5, 12, dark); rect(37, 22, 5, 12, dark);      // arms
    ellipse(13, 20, 3, 3, dark); ellipse(35, 20, 3, 3, dark); // shoulder studs
    rect(13, 18, 22, 20, base);                               // torso block
    rect(13, 18, 22, 4, light); rect(13, 18, 3, 20, shadow); rect(32, 18, 3, 20, shadow);
    rect(24, 20, 1, 16, eye); rect(16, 28, 16, 1, eye);       // glowing seams
    rect(18, 8, 12, 10, base); rect(18, 8, 12, 3, light);     // head block
    rect(20, 12, 3, 3, eye); rect(25, 12, 3, 3, eye);         // eyes
  } else {
    rect(16, 36, 5, 8, shadow); rect(27, 36, 5, 8, shadow);   // legs
    rect(16, 42, 5, 2, dark); rect(27, 42, 5, 2, dark);       // feet
    ellipse(8, 26, 4, 9, dark); ellipse(40, 26, 4, 9, dark);  // arms
    rect(5, 32, 3, 2, hi); rect(40, 32, 3, 2, hi);            // claws
    ellipse(24, 28, 12, 11, base);                            // torso
    ellipse(24, 24, 10, 5, light);
    ellipse(24, 28, 4, 4, shadow); ellipse(24, 28, 2.4, 2.4, eye); // chest core
    ellipse(24, 13, 7, 7, base); ellipse(24, 10, 5, 3, light);     // head
    rect(16, 6, 2, 5, dark); rect(30, 6, 2, 5, dark);         // horns
    set(16, 5, shadow); set(31, 5, shadow);
    rect(20, 13, 2, 2, eye); rect(26, 13, 2, 2, eye);         // eyes
  }

  // dark outline around the silhouette + a soft upper-left rim highlight
  const out = col.slice();
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      if (col[y * S + x] !== null) continue;
      if (filled(x - 1, y) || filled(x + 1, y) || filled(x, y - 1) || filled(x, y + 1)) out[y * S + x] = outline;
    }
  // ambient occlusion: darken the lower edge of the silhouette (bottom shading)
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      if (col[y * S + x] === null) continue;
      if (!filled(x, y + 1) || !filled(x + 1, y)) out[y * S + x] = shadow;
    }
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      if (col[y * S + x] === null) continue;                  // rim: lit edge facing upper-left
      if (!filled(x - 1, y) || !filled(x, y - 1)) { if (rng() < 0.72) out[y * S + x] = hi; }
    }

  return out; // S*S array of [r,g,b] | null
}

// Compose a 2-frame horizontal idle sheet (frame 1 = gentle 1px breathe-bob) so
// monsters subtly hover/breathe in the field and battle — Octopath-style life.
function drawMinion(id) {
  const f0 = minionPixels(id);
  const f1 = new Array(S * S).fill(null);
  for (let y = 1; y < S; y++) for (let x = 0; x < S; x++) f1[(y - 1) * S + x] = f0[y * S + x];
  const W = S * 2, buf = Buffer.alloc(W * S * 4);
  const put = (frame, ox) => {
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const cc = frame[y * S + x]; if (!cc) continue;
      const i = (y * W + ox + x) * 4;
      buf[i] = cc[0]; buf[i + 1] = cc[1]; buf[i + 2] = cc[2]; buf[i + 3] = 255;
    }
  };
  put(f0, 0); put(f1, S);
  return sharp(buf, { raw: { width: W, height: S, channels: 4 } }).png({ palette: true, colours: 48 });
}

// Organic enemies whose sprites are sourced from the real LPC Monsters pack
// (see tools/monsters-lpc.mjs). Never regenerate procedural art over these —
// even with --force — or we'd clobber the hand-drawn creature art.
const LPC_OVERRIDE = new Set([
  "data-eel", "bog-leviath", "digital-jelly", "code-squid", "dream-stalker",
  "packet-wisp", "frost-wisp", "memory-shade", "data-wraith",
  "tide-wraith", "regret-wisp",
]);

async function main() {
  await mkdir(OUT, { recursive: true });
  const enemies = JSON.parse(await readFile(join(root, "src", "data", "enemies.json"), "utf8"));
  const minions = enemies.filter((e) => e.kind === "minion");
  const force = process.argv.includes("--force");
  let made = 0;
  for (const m of minions) {
    const outFile = join(OUT, `minion-${m.id}.png`);
    if (LPC_OVERRIDE.has(m.id)) {
      console.log(`skip  minion-${m.id}.png (LPC creature art — run npm run monsters)`);
      continue;
    }
    if (existsSync(outFile) && !force) {
      console.log(`skip  minion-${m.id}.png (exists)`);
      continue;
    }
    await drawMinion(m.id).toFile(outFile);
    made += 1;
    console.log(`minion -> minion-${m.id}.png  [${archetypeOf(m.id)}]`);
  }
  console.log(`Done. ${made} new minion sprites (${minions.length} total).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
