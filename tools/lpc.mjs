// Composes real animated character sprite sheets from Liberated Pixel Cup (LPC)
// layers (body + clothing + hair), giving the party and NPCs genuine hand-drawn
// walk/idle animation instead of procedural billboards.
//
// LPC art is licensed CC-BY-SA 3.0 / GPL 3.0 — see CREDITS.txt for attribution.
// Source: github.com/jrconway3/Universal-LPC-spritesheet
//
// Output: public/assets/sprites/lpc/<id>.png  (832x1344, 64px frames, 13x21 grid)
// Run with: npm run lpc

import sharp from "sharp";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(root, "public", "assets", "sprites", "lpc");
const BASE = "https://raw.githubusercontent.com/jrconway3/Universal-LPC-spritesheet/master/";

// Layer stacks (bottom -> top). Missing layers are skipped gracefully.
const CHARS = {
  // party
  saka: ["body/male/light.png", "legs/pants/male/teal_pants_male.png", "feet/shoes/male/brown_shoes_male.png", "torso/leather/chest_male.png", "torso/leather/shoulders_male.png", "hair/male/messy1/brown.png"],
  zell: ["body/male/tanned.png", "legs/armor/male/metal_pants_male.png", "feet/armor/male/metal_boots_male.png", "torso/plate/chest_male.png", "torso/plate/arms_male.png", "hair/male/messy2/black.png"],
  kara: ["body/female/light.png", "feet/shoes/female/maroon_shoes_female.png", "torso/robes_female_no_th-sh/blue.png", "hair/female/long/redhead.png"],
  // townsfolk NPC archetypes
  "npc-merchant": ["body/male/tanned.png", "legs/pants/male/white_pants_male.png", "feet/shoes/male/black_shoes_male.png", "torso/leather/chest_male.png", "hair/male/messy2/brown.png"],
  "npc-elder": ["body/male/light.png", "legs/pants/male/white_pants_male.png", "feet/shoes/male/brown_shoes_male.png", "torso/leather/chest_male.png", "hair/male/long/gray.png"],
  "npc-villager": ["body/female/light.png", "feet/shoes/female/brown_shoes_female.png", "torso/dress_female/dress_w_sash_female.png", "hair/female/loose/brown.png"],
  "npc-guard": ["body/male/light.png", "legs/armor/male/metal_pants_male.png", "feet/armor/male/metal_boots_male.png", "torso/chain/mail_male.png", "hair/male/messy1/black.png"],
};

const cache = new Map();
async function fetchLayer(path) {
  if (cache.has(path)) return cache.get(path);
  const res = await fetch(BASE + path);
  if (!res.ok) { console.warn(`  ! missing ${path} (${res.status})`); cache.set(path, null); return null; }
  const buf = Buffer.from(await res.arrayBuffer());
  cache.set(path, buf); return buf;
}

async function main() {
  await mkdir(OUT, { recursive: true });
  for (const [id, layers] of Object.entries(CHARS)) {
    const bufs = [];
    for (const l of layers) { const b = await fetchLayer(l); if (b) bufs.push(b); }
    if (!bufs.length) { console.warn(`skip ${id} — no layers`); continue; }
    const base = sharp(bufs[0]);
    const overlays = bufs.slice(1).map((input) => ({ input }));
    const png = await base.composite(overlays).png().toBuffer();
    await writeFile(join(OUT, `${id}.png`), png);
    console.log(`lpc -> lpc/${id}.png  (${bufs.length} layers)`);
  }
  console.log("Done.");
}

main().catch((e) => { console.error(e); process.exit(1); });
