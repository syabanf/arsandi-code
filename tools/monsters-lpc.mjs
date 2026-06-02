// Composes real animated creature sprites from the "[LPC] Monsters" pack for
// the game's ORGANIC enemies (serpents, wisps/wraiths, slime, eyeball, plant,
// bat). Machine/construct enemies keep their procedural sprites (tools/minions.mjs)
// because no free fantasy pack matches the techno-fantasy theme — this is the
// deliberate "hybrid" the project chose.
//
// LPC Monsters are CC-BY-SA 3.0+ / GPL 3.0+ — see CREDITS.txt for attribution
// (Charles Sanchez/CharlesGabriel, bagzie, bluecarrot16).
// Source: https://opengameart.org/content/lpc-monsters
//
// Each creature sheet is 64px frames (man-eater 128px), 4 rows = up/left/down/right.
// Row index 2 = front-facing (toward the camera) — exactly what a front-view
// battle + billboard field wants. We take 2 frames from that row and lay them
// side-by-side into the engine's 2-frame idle format (sheet width == 2*height),
// which World3D/Battle3D already auto-detect and animate.
//
// Output: public/assets/sprites/minion-<id>.png   (overwrites the procedural
// sprite for mapped ids only; originals are backed up to tools/.cache/minion-backup
// and remain regenerable via `npm run minions`, which skips existing files).
// Run with: npm run monsters

import sharp from "sharp";
import { mkdir, writeFile, copyFile, access, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const CACHE = join(root, "tools", ".cache");
const SRC = join(CACHE, "lpc-monsters", "lpc-monsters");
const OUT = join(root, "public", "assets", "sprites");
const BACKUP = join(CACHE, "minion-backup");
const ZIP_URL = "https://opengameart.org/sites/default/files/lpc-monsters.zip";

const DOWN_ROW = 2; // up=0, left=1, down=2, right=3

// enemy id -> creature recipe. hue is a degrees rotation (sharp modulate),
// float lifts hovering creatures off the floor, scale pads the cell so big
// monsters read larger than small ones.
const MAP = {
  // serpents
  "data-eel":    { mon: "snake", fs: 64,  hue: 40,  sat: 1.1 },          // ocean-data serpent (teal)
  "bog-leviath": { mon: "snake", fs: 64,  hue: 250, sat: 1.0, bright: 0.85, scale: 1.25 }, // colossal sunken serpent (violet, big)
  // blob / plant / eye
  "digital-jelly": { mon: "slime", fs: 64, hue: 60,  sat: 1.15 },        // data blob (cyan)
  "code-squid":  { mon: "man_eater_flower", fs: 128, hue: 175, sat: 1.0, scale: 1.15 }, // tentacled maw (violet)
  "dream-stalker": { mon: "eyeball", fs: 64, hue: 250, sat: 1.05, float: true }, // nightmare eye (deep red/violet)
  // ghosts / wisps / wraiths / shades — the ghost base is low-saturation, so we
  // colorize by luminance (sharp.tint) instead of hue-rotating: each variant
  // ends up a genuinely distinct color instead of all reading as "pale white".
  "packet-wisp": { mon: "ghost", fs: 64, tint: { r: 110, g: 220, b: 255 }, float: true }, // cyan
  "frost-wisp":  { mon: "ghost", fs: 64, tint: { r: 150, g: 210, b: 255 }, float: true }, // ice blue
  "memory-shade":{ mon: "ghost", fs: 64, tint: { r: 180, g: 200, b: 255 }, float: true }, // pale blue
  "data-wraith": { mon: "ghost", fs: 64, tint: { r: 130, g: 255, b: 150 }, float: true }, // green (base)
  "tide-wraith": { mon: "ghost", fs: 64, tint: { r: 110, g: 255, b: 210 }, float: true }, // teal
  "regret-wisp": { mon: "ghost", fs: 64, tint: { r: 200, g: 150, b: 255 }, float: true }, // violet
};

async function ensureSource() {
  if (existsSync(SRC)) return;
  console.log("source not cached — downloading lpc-monsters.zip …");
  await mkdir(CACHE, { recursive: true });
  const zip = join(CACHE, "lpc-monsters.zip");
  const res = await fetch(ZIP_URL);
  if (!res.ok) throw new Error(`download failed: ${res.status}`);
  await writeFile(zip, Buffer.from(await res.arrayBuffer()));
  execSync(`unzip -o -q "${zip}" -d "${join(CACHE, "lpc-monsters")}"`);
}

// Extract the two front-facing frames, hue-shift, trim to a common bounding box,
// and lay them into a square 2-frame idle sheet.
async function buildSheet(id, r) {
  const file = join(SRC, `${r.mon}.png`);
  const fs = r.fs;

  // raw front frames (col 0 and col 1 of the down row), recolored per recipe:
  //   • tint  -> sharp.tint (luminance-preserving colorize; for low-sat ghosts)
  //   • else  -> modulate hue/sat/brightness (rotation; for the strongly coloured creatures)
  const recolor = (img) => r.tint
    ? img.tint(r.tint)
    : img.modulate({ saturation: r.sat ?? 1, brightness: r.bright ?? 1, hue: r.hue ?? 0 });
  const raw = [];
  for (const col of [0, 1]) {
    raw.push(await recolor(sharp(file)
      .extract({ left: col * fs, top: DOWN_ROW * fs, width: fs, height: fs }))
      .png().toBuffer());
  }

  // common bounding box = trim of the union of both frames (keeps them aligned)
  const union = await sharp(raw[0]).composite([{ input: raw[1] }]).png().toBuffer();
  const trimmed = await sharp(union).trim({ threshold: 6 }).png().toBuffer({ resolveWithObject: true });
  const cropW = trimmed.info.width, cropH = trimmed.info.height;
  const left = -(trimmed.info.trimOffsetLeft ?? 0);
  const top = -(trimmed.info.trimOffsetTop ?? 0);

  // square cell sized to the creature (+padding); floaters get extra bottom lift
  const pad = Math.round(Math.max(cropW, cropH) * 0.12);
  const lift = r.float ? Math.round(cropH * 0.28) : 0;
  const base = Math.ceil(Math.max(cropW, cropH) * (r.scale ?? 1)) + pad * 2;
  const cell = base + lift;
  const cx = Math.round((cell - cropW) / 2);
  const cyBottom = cell - pad - lift - cropH; // bottom-aligned, then lifted

  const frames = [];
  for (const buf of raw) {
    const crop = await sharp(buf).extract({ left, top, width: cropW, height: cropH }).png().toBuffer();
    frames.push(await sharp({ create: { width: cell, height: cell, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .composite([{ input: crop, left: cx, top: cyBottom }]).png().toBuffer());
  }

  // 2-frame idle sheet: [frame0 | frame1], width == 2*height (engine auto-detects)
  const sheet = await sharp({ create: { width: cell * 2, height: cell, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: frames[0], left: 0, top: 0 }, { input: frames[1], left: cell, top: 0 }])
    .png().toBuffer();

  // back up the procedural original (once), then overwrite
  const dest = join(OUT, `minion-${id}.png`);
  const bak = join(BACKUP, `minion-${id}.png`);
  if (existsSync(dest) && !existsSync(bak)) { await mkdir(BACKUP, { recursive: true }); await copyFile(dest, bak); }
  await writeFile(dest, sheet);
  console.log(`monster -> minion-${id}.png  (${r.mon}, cell ${cell}px, hue ${r.hue ?? 0})`);
}

async function main() {
  await ensureSource();
  await mkdir(OUT, { recursive: true });
  for (const [id, r] of Object.entries(MAP)) {
    try { await buildSheet(id, r); }
    catch (e) { console.warn(`  ! ${id} failed: ${e.message}`); }
  }
  console.log(`Done. ${Object.keys(MAP).length} organic enemies now use real LPC creature art.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
