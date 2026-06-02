// Asset pipeline: converts the high-res concept renders in /Assets into
// pixel-style game assets under /public/assets.
//
// Approach: nearest-neighbour downscale (the blocky "8-bit" look) plus PNG
// palette quantization. Character renders get a near-white background keyed
// out to transparency so units can sit on the tactical grid.
//
// Run with: npm run assets

import sharp from "sharp";
import { mkdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(root, "Assets");
const OUT = join(root, "public", "assets");

// Internal render resolution (matches src/constants.ts).
const GAME_WIDTH = 480;
const GAME_HEIGHT = 270;

async function ensureDirs() {
  for (const d of ["sprites", "portraits", "ui", "bg"]) {
    await mkdir(join(OUT, d), { recursive: true });
  }
}

// Key near-white background pixels to transparent when the source render has
// no usable alpha channel of its own.
async function keyWhiteIfOpaque(input) {
  const { data, info } = await sharp(input)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  let hasTransparent = false;
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] < 8) {
      hasTransparent = true;
      break;
    }
  }
  if (!hasTransparent) {
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] > 235 && data[i + 1] > 235 && data[i + 2] > 235) {
        data[i + 3] = 0;
      }
    }
  }
  return { data, info };
}

// Character render -> trimmed, transparent, pixelized sprite at a target height.
async function makeSprite(srcFile, outFile, height, colours) {
  const { data, info } = await keyWhiteIfOpaque(join(SRC, srcFile));
  await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } })
    .trim()
    .resize({ height, fit: "inside", kernel: "nearest" })
    .png({ palette: true, colours })
    .toFile(join(OUT, outFile));
  console.log("  sprite ->", outFile);
}

// Full-frame art -> pixelized image at a target width (optionally cropped first).
async function makeBackground(srcFile, outFile, { width, crop, fitTo, fitMode } = {}) {
  let img = sharp(join(SRC, srcFile));
  if (crop) img = img.extract(crop);
  if (fitTo) {
    img = img.resize(fitTo.w, fitTo.h, {
      fit: fitMode ?? "cover",
      kernel: "nearest",
      background: { r: 5, g: 3, b: 13, alpha: 1 },
    });
  } else {
    img = img.resize({ width, kernel: "nearest" });
  }
  await img.png({ palette: true, colours: 128 }).toFile(join(OUT, outFile));
  console.log("  bg ->", outFile);
}

// Boss art panel -> pixelized sprite. The stage sheets share a layout, so the
// same crop box captures the boss illustration on each. The boss art is dark
// and detailed, so we keep the rectangular panel (no chroma key) and use a
// generous palette; it blends with the dark battlefield.
async function makeBossSprite(srcFile, outFile, crop, height) {
  // Crop the boss panel, then feather its outer border to transparent so the
  // rectangular panel melts into the dark battlefield instead of reading as a
  // hard-edged box. (Non-indexed PNG keeps the alpha gradient smooth.)
  const { data, info } = await sharp(join(SRC, srcFile))
    .extract(crop)
    .resize({ height, kernel: "nearest" })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const W = info.width;
  const H = info.height;
  const feather = Math.max(3, Math.round(Math.min(W, H) * 0.14));
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const edge = Math.min(Math.min(x, W - 1 - x), Math.min(y, H - 1 - y));
      const f = Math.min(1, edge / feather);
      data[i + 3] = Math.round(data[i + 3] * f);
    }
  }

  await sharp(data, { raw: { width: W, height: H, channels: 4 } })
    .png({ compressionLevel: 9 })
    .toFile(join(OUT, outFile));
  console.log("  boss ->", outFile);
}

async function main() {
  await ensureDirs();

  console.log("Party sprites + portraits:");
  for (const c of ["Saka", "Kara", "Zell"]) {
    const id = c.toLowerCase();
    await makeSprite(`Character/${c}_Char8Bit.png`, `sprites/${id}.png`, 64, 48);
    await makeSprite(`Character/${c}_Char8Bit.png`, `portraits/${id}.png`, 160, 64);
  }

  console.log("Boss sprites (cropped from stage sheets):");
  const stageRows = JSON.parse(await readFile(join(root, "src", "data", "stages.json"), "utf8"));
  const BOSS_CROP = { left: 915, top: 55, width: 305, height: 225 };
  for (const stage of stageRows) {
    const sheet = stage.index === 8 ? "Stage/Stage_Finale.png" : `Stage/Stage_${stage.index}.png`;
    await makeBossSprite(sheet, `sprites/boss-${stage.bossId}.png`, BOSS_CROP, 80);
  }

  console.log("Title key art (cover with top nav cropped, letterboxed):");
  // Cover_Game.png is 1672x941 (a landing-page mock). Drop only the top nav
  // strip and letterbox the rest so the logo + heroes are never clipped.
  await makeBackground("Stage/Cover_Game.png", "ui/title.png", {
    crop: { left: 0, top: 72, width: 1672, height: 869 },
    fitTo: { w: 240, h: 135 },
    fitMode: "contain",
  });

  console.log("Stage battle backdrops (environment scene cropped from each sheet):");
  // Each 1536x1024 design sheet shares a layout: title text on the left, the
  // boss panel from x~915, and the main environment painting in the top-centre
  // band between them. Crop that scene (≈16:9) and cover-fit to the full game
  // resolution so battles get a detailed painted backdrop instead of a squished
  // thumbnail of the whole busy sheet.
  const ENV_CROP = { left: 300, top: 60, width: 612, height: 344 };
  const stages = ["1", "2", "3", "4", "5", "6", "7", "Finale"];
  for (const s of stages) {
    const key = s === "Finale" ? "stage-finale" : `stage-${s}`;
    await makeBackground(`Stage/Stage_${s}.png`, `bg/${key}.png`, {
      crop: ENV_CROP,
      fitTo: { w: GAME_WIDTH, h: GAME_HEIGHT },
      fitMode: "cover",
    });
  }

  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
