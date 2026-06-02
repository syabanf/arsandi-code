// Generates a themed placeholder tileset + Tiled-format (.tmj) map for every
// stage in src/data/stages.json. Each stage gets its own colour palette and a
// layout archetype based on its type (open field / dungeon corridors / arena),
// always with a guaranteed-walkable path from the spawn to the encounter zone.
//
// The .tmj files are standard Tiled JSON — open and edit them in the Tiled app
// whenever you like. Run with: npm run world

import sharp from "sharp";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(root, "public", "assets");

const TS = 16;
const TILE_COUNT = 10;
const TS_W = TS * TILE_COUNT;
const MW = 40;
const MH = 30;

const G = { GROUND: 1, GROUND_ALT: 2, PATH: 3, WALL: 4, WATER: 5, RUBBLE: 6, FLOOR: 7, CRYSTAL: 8, SAND: 9, SNOW: 10 };
// SAND + SNOW are biome GROUND tiles — purely cosmetic and fully walkable.
const BLOCKED = [G.WALL, G.WATER, G.RUBBLE];

// Per-stage palette: [ground, groundAlt, path, wall, water, rubble, floor, accent]
// One cohesive dark techno-fantasy world: every palette lives on the
// cyan -> blue -> violet -> magenta arc. Hubs (town, world) stay calm/cyan;
// dungeons run more saturated violet/magenta. Each chapter is a DISTINCT shade
// so they still feel different. Heroes stay warm on purpose (handled by sprites,
// not here) so they read against this cool world.
const THEMES = {
  // violet — Chapter 1
  "stage-1": [[58, 53, 86], [68, 60, 100], [92, 84, 120], [74, 64, 108], [48, 80, 150], [54, 48, 78], [44, 40, 70], [140, 90, 255]],
  // blue-violet / indigo
  "stage-2": [[50, 50, 88], [60, 60, 104], [86, 86, 124], [66, 66, 112], [46, 84, 156], [54, 54, 92], [40, 40, 74], [120, 110, 255]],
  // cyan
  "stage-3": [[40, 64, 68], [48, 76, 80], [64, 90, 98], [58, 90, 98], [40, 120, 150], [52, 70, 74], [34, 54, 58], [80, 230, 220]],
  // deep blue — water world
  "stage-4": [[28, 44, 86], [34, 54, 104], [60, 80, 140], [44, 60, 120], [36, 96, 190], [40, 54, 96], [24, 38, 74], [90, 200, 255]],
  // pale lavender — brighter sanctum
  "stage-5": [[92, 88, 116], [104, 100, 130], [140, 132, 166], [120, 112, 148], [100, 140, 205], [100, 94, 124], [80, 76, 104], [185, 165, 255]],
  // magenta-pink
  "stage-6": [[64, 40, 66], [78, 48, 80], [100, 66, 98], [96, 56, 100], [110, 60, 150], [72, 48, 74], [50, 32, 52], [255, 80, 200]],
  // deep crimson-magenta — danger
  "stage-7": [[42, 30, 50], [54, 38, 64], [82, 54, 86], [72, 46, 82], [96, 44, 120], [56, 40, 62], [30, 22, 40], [210, 55, 140]],
  // royal violet — finale
  "stage-finale": [[48, 40, 72], [64, 48, 96], [104, 76, 138], [88, 64, 128], [110, 76, 200], [70, 56, 100], [40, 32, 64], [200, 120, 255]],
  // cool slate + cyan lamp — settlement hub
  town: [[70, 68, 92], [84, 82, 108], [110, 104, 134], [92, 86, 118], [58, 110, 160], [78, 74, 100], [58, 54, 80], [150, 200, 255]],
  // warm trade outpost — second town
  town2: [[86, 74, 64], [104, 90, 76], [134, 116, 90], [110, 92, 74], [70, 110, 150], [96, 82, 66], [78, 66, 54], [255, 196, 120]],
  // teal-violet twilight — overworld hub
  world: [[64, 84, 104], [78, 98, 120], [104, 108, 140], [84, 98, 122], [56, 118, 175], [60, 84, 104], [70, 86, 108], [120, 210, 235]],
  // amber-lit rock — optional side cavern
  cave: [[74, 70, 64], [90, 86, 76], [106, 98, 88], [90, 82, 72], [58, 106, 138], [74, 66, 56], [58, 54, 46], [154, 240, 255]],
  // sealed blue vault — optional treasure vault
  vault: [[46, 58, 90], [58, 74, 112], [74, 94, 138], [58, 74, 122], [58, 144, 192], [46, 58, 86], [38, 48, 74], [128, 240, 255]],
  // green sparring yard — early leveling dungeon
  training: [[62, 106, 62], [78, 122, 74], [154, 192, 96], [58, 90, 52], [58, 114, 200], [78, 122, 64], [74, 106, 68], [154, 255, 158]],
  // dark void tower — late leveling dungeon
  spire: [[52, 44, 82], [66, 58, 102], [106, 90, 154], [62, 50, 102], [74, 90, 192], [64, 52, 94], [42, 36, 72], [176, 136, 255]],
  // frostbyte cavern — icy blue-white
  frost: [[120, 142, 168], [142, 164, 188], [180, 200, 220], [120, 140, 170], [110, 170, 220], [130, 150, 176], [98, 120, 148], [190, 240, 255]],
  // ember forge — molten orange-red
  forge: [[96, 56, 44], [120, 70, 50], [160, 96, 56], [110, 60, 46], [200, 90, 50], [110, 64, 48], [74, 44, 38], [255, 150, 70]],
  // sunken archive — deep teal water
  archive: [[40, 78, 80], [50, 94, 94], [70, 120, 116], [48, 90, 92], [40, 150, 160], [52, 96, 92], [34, 64, 66], [90, 240, 220]],
};

// Shared world-map layout: the player spawns at SPAWN, walks to Home, then the
// road winds through the 8 chapter nodes; two dungeons branch off. These tile
// coords MUST match WORLD_LAYOUT in src/three/scenes3d.ts so markers sit on the road.
const WORLD_LAYOUT = {
  home: [6, 15],
  chapters: [[10, 20], [14, 12], [18, 19], [22, 11], [26, 18], [30, 12], [34, 19], [37, 11]],
  dungeons: {
    cave: { node: [12, 6], from: [14, 12] },
    vault: { node: [28, 25], from: [26, 18] },
    training: { node: [5, 7], from: [6, 15] },
    spire: { node: [37, 24], from: [34, 19] },
    market: { node: [6, 11], from: [6, 15] },   // second town
    anomaly: { node: [37, 5], from: [37, 11] },  // optional superboss
    frost: { node: [16, 3], from: [14, 12] },    // ice dungeon
    forge: { node: [3, 24], from: [10, 20] },    // fire dungeon
    archive: { node: [21, 27], from: [18, 19] }, // water dungeon
  },
};

function makeRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

// ---- tileset rendering ----------------------------------------------------

function buildTileset(palette, seed) {
  const [ground, groundAlt, path, wall, water, rubble, floor, accent] = palette;
  const buf = Buffer.alloc(TS_W * TS * 4);
  const rng = makeRng(seed);
  const lighten = (c, d) => c.map((v) => Math.min(255, v + d));
  const darken = (c, d) => c.map((v) => Math.max(0, v - d));

  const px = (col, lx, ly, [r, g, b], a = 255) => {
    const i = (ly * TS_W + col * TS + lx) * 4;
    buf[i] = r;
    buf[i + 1] = g;
    buf[i + 2] = b;
    buf[i + 3] = a;
  };
  const fill = (col, color) => {
    for (let y = 0; y < TS; y++) for (let x = 0; x < TS; x++) px(col, x, y, color);
  };
  const speckle = (col, color, chance) => {
    for (let y = 0; y < TS; y++) for (let x = 0; x < TS; x++) if (rng() < chance) px(col, x, y, color);
  };

  fill(0, ground);
  speckle(0, darken(ground, 12), 0.18);
  speckle(0, lighten(ground, 12), 0.06);

  fill(1, groundAlt);
  speckle(1, darken(groundAlt, 12), 0.2);

  fill(2, path);
  for (let y = 0; y < TS; y++) for (let x = 0; x < TS; x++) if ((x + y) % 5 === 0) px(2, x, y, lighten(path, 14));
  speckle(2, darken(path, 16), 0.12);

  fill(3, wall);
  for (let x = 0; x < TS; x++) {
    px(3, x, 0, lighten(wall, 36));
    px(3, x, 1, lighten(wall, 24));
  }
  for (let y = 0; y < TS; y++) {
    px(3, 0, y, darken(wall, 34));
    px(3, TS - 1, y, darken(wall, 34));
  }
  for (let y = 4; y < TS; y += 5) for (let x = 0; x < TS; x++) px(3, x, y, darken(wall, 22));

  fill(4, water);
  for (let y = 1; y < TS; y += 4) for (let x = 0; x < TS; x++) if ((x + y) % 3 !== 0) px(4, x, y, lighten(water, 32));

  fill(5, rubble);
  speckle(5, lighten(rubble, 60), 0.15);
  speckle(5, lighten(rubble, 96), 0.06);

  fill(6, floor);
  for (let y = 0; y < TS; y += 4) for (let x = 0; x < TS; x++) px(6, x, y, lighten(floor, 14));
  for (let x = 0; x < TS; x += 4) for (let y = 0; y < TS; y++) px(6, x, y, lighten(floor, 14));

  // crystal: transparent background + glowing accent diamond
  const cx = 8;
  for (let y = 2; y < 14; y++) {
    const w = 6 - Math.abs(y - 8);
    if (w <= 0) continue;
    for (let x = cx - w; x <= cx + w; x++) {
      const edge = x === cx - w || x === cx + w;
      px(7, x, y, edge ? lighten(accent, 50) : accent);
    }
  }

  // sand (col 8): warm dune grain with faint ripple lines
  const sand = [196, 170, 112];
  fill(8, sand);
  speckle(8, darken(sand, 20), 0.18);
  speckle(8, lighten(sand, 16), 0.08);
  for (let y = 3; y < TS; y += 5) for (let x = 0; x < TS; x++) if ((x + y) % 2 === 0) px(8, x, y, darken(sand, 12));

  // snow (col 9): bright field with sparkle + soft shadow dimples
  const snow = [214, 228, 240];
  fill(9, snow);
  speckle(9, darken(snow, 16), 0.12);
  speckle(9, [255, 255, 255], 0.06);

  return sharp(buf, { raw: { width: TS_W, height: TS, channels: 4 } }).png();
}

// ---- layout generation ----------------------------------------------------

const SPAWN = { x: 3, y: 15 };
const ENC = { x0: 29, y0: 12, w: 6, h: 6 }; // tiles
const ENC_CX = ENC.x0 + Math.floor(ENC.w / 2);

function borderWalls(decor) {
  const idx = (x, y) => y * MW + x;
  for (let x = 0; x < MW; x++) {
    decor[idx(x, 0)] = G.WALL;
    decor[idx(x, MH - 1)] = G.WALL;
  }
  for (let y = 0; y < MH; y++) {
    decor[idx(0, y)] = G.WALL;
    decor[idx(MW - 1, y)] = G.WALL;
  }
}

function archetypeOpen(ground, decor, rng) {
  const idx = (x, y) => y * MW + x;
  // pond top-left
  for (let y = 3; y < 8; y++) for (let x = 4; x < 11; x++) if (Math.hypot(x - 7, y - 5) < 3.2) decor[idx(x, y)] = G.WATER;
  // scattered rubble
  for (let n = 0; n < 44; n++) {
    const x = 2 + Math.floor(rng() * (MW - 4));
    const y = 2 + Math.floor(rng() * (MH - 4));
    if (decor[idx(x, y)] === 0) decor[idx(x, y)] = G.RUBBLE;
  }
  // ground variation
  for (let i = 0; i < ground.length; i++) if (rng() < 0.15) ground[i] = G.GROUND_ALT;
}

function archetypeCorridors(ground, decor, rng) {
  const idx = (x, y) => y * MW + x;
  for (let i = 0; i < ground.length; i++) ground[i] = rng() < 0.5 ? G.FLOOR : G.GROUND;
  // vertical wall dividers with a punched gap (the carve pass opens the main lane)
  for (const wx of [9, 15, 21, 27]) {
    const gap = 4 + Math.floor(rng() * 20);
    for (let y = 1; y < MH - 1; y++) if (Math.abs(y - gap) > 1) decor[idx(wx, y)] = G.WALL;
  }
  // a couple of horizontal walls
  for (const wy of [7, 22]) {
    const gap = 4 + Math.floor(rng() * 30);
    for (let x = 1; x < MW - 1; x++) if (Math.abs(x - gap) > 1) decor[idx(x, wy)] = G.WALL;
  }
}

function archetypeWorld(ground, decor, rng) {
  const idx = (x, y) => y * MW + x;
  const inb = (x, y) => x > 0 && y > 0 && x < MW - 1 && y < MH - 1;
  // rolling grass with patchy variation
  for (let i = 0; i < ground.length; i++) ground[i] = rng() < 0.22 ? G.GROUND_ALT : G.GROUND;

  // --- biome ground painting (walkable; the road is carved on top afterwards) ---
  // A frost cap of SNOW across the north and warm SAND desert flats along the
  // south, with a grass temperate belt between. Three stacked sines + a dithered
  // fringe give organic, ragged borders; interior blobs let each biome bleed into
  // the grass so the bands never read as straight stripes. SAND/SNOW live on the
  // ground layer, so they never affect routing.
  const frostEdge = (x) => 4 + Math.sin(x * 0.45) * 1.6 + Math.sin(x * 0.17 + 1.3) * 1.2 + Math.sin(x * 0.9 + 0.5) * 0.6;
  const desertEdge = (x) => 4 + Math.sin(x * 0.4 + 2.1) * 1.7 + Math.sin(x * 0.21 + 0.7) * 1.1 + Math.sin(x * 1.05) * 0.5;
  for (let y = 0; y < MH; y++) {
    for (let x = 0; x < MW; x++) {
      const fe = frostEdge(x), de = MH - 1 - desertEdge(x);
      if (y <= fe) ground[idx(x, y)] = rng() < 0.9 ? G.SNOW : G.GROUND_ALT;     // frost cap
      else if (y <= fe + 1.6 && rng() < 0.45) ground[idx(x, y)] = G.SNOW;       // frost fringe
      else if (y >= de) ground[idx(x, y)] = rng() < 0.9 ? G.SAND : G.GROUND;    // desert flats
      else if (y >= de - 1.6 && rng() < 0.45) ground[idx(x, y)] = G.SAND;       // desert fringe
    }
  }
  const biomeBlob = (cx, cy, r, tile) => {
    for (let y = Math.max(1, Math.floor(cy - r - 1)); y <= Math.min(MH - 2, Math.ceil(cy + r + 1)); y++)
      for (let x = Math.max(1, Math.floor(cx - r - 1)); x <= Math.min(MW - 2, Math.ceil(cx + r + 1)); x++)
        if (Math.hypot(x - cx, y - cy) < r - 1 + rng() * 2) ground[idx(x, y)] = tile;
  };
  biomeBlob(12, 10, 3, G.SNOW);   // snow drift reaching down into the temperate belt
  biomeBlob(30, 17, 3, G.SAND);   // sandy flat creeping up out of the desert
  biomeBlob(24, 21, 2.5, G.SAND);

  // protect[] marks the road corridor + buffer so obstacles never block the route.
  const protect = new Array(MW * MH).fill(false);
  const mark = (x, y, r) => {
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const px = x + dx, py = y + dy; if (px >= 0 && py >= 0 && px < MW && py < MH) protect[idx(px, py)] = true;
    }
  };
  const carveRoad = (ax, ay, bx, by) => {
    const steps = Math.max(Math.abs(bx - ax), Math.abs(by - ay)) * 2 || 1;
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const x = Math.round(ax + (bx - ax) * t), y = Math.round(ay + (by - ay) * t);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const px = x + dx, py = y + dy; if (inb(px, py)) decor[idx(px, py)] = 0;
      }
      if (inb(x, y)) ground[idx(x, y)] = G.PATH;
      mark(x, y, 2);
    }
  };

  const L = WORLD_LAYOUT;
  const nodes = [L.home, ...L.chapters];
  carveRoad(SPAWN.x, SPAWN.y, L.home[0], L.home[1]); // spawn -> Home
  for (let i = 0; i < nodes.length - 1; i++) carveRoad(nodes[i][0], nodes[i][1], nodes[i + 1][0], nodes[i + 1][1]);
  for (const k of Object.keys(L.dungeons)) { const d = L.dungeons[k]; carveRoad(d.from[0], d.from[1], d.node[0], d.node[1]); }
  for (const [x, y] of [L.home, ...L.chapters, ...Object.values(L.dungeons).map((d) => d.node)]) mark(x, y, 2);

  // which biome a tile sits in (read back from the painted ground layer)
  const biomeAt = (x, y) => { const g = ground[idx(x, y)]; return g === G.SNOW ? "frost" : g === G.SAND ? "desert" : "temperate"; };

  // --- winding river (placed AFTER the road, so every road crossing fords it) ---
  // A meandering north->south river of WATER. It skips protected tiles, so the
  // road bridges it automatically — reachability is preserved by construction.
  {
    let rx = 22;
    for (let y = 1; y < MH - 1; y++) {
      rx += Math.round(Math.sin(y * 0.5) * 1.1 + (rng() - 0.5) * 1.4);
      rx = Math.max(7, Math.min(MW - 8, rx));
      const w = rng() < 0.35 ? 1 : 0;
      for (let dx = 0; dx <= w; dx++) {
        const sx = rx + dx;
        if (inb(sx, y) && !protect[idx(sx, y)]) decor[idx(sx, y)] = G.WATER;
      }
    }
  }
  // --- coastal bay in the southeast corner (open sea + a sandy beach fringe) ---
  for (let y = MH - 9; y < MH - 1; y++) for (let x = MW - 10; x < MW - 1; x++) {
    if (!inb(x, y) || protect[idx(x, y)]) continue;
    const d = Math.hypot(x - (MW - 2), y - (MH - 2));
    if (d < 5) { if (decor[idx(x, y)] === 0) decor[idx(x, y)] = G.WATER; }
    else if (d < 6.6 && decor[idx(x, y)] === 0) ground[idx(x, y)] = G.SAND;
  }

  // --- mountains: scattered short WALL ridgelines across the north frost band ---
  // Each is a compact, mostly single-tile-wide ridge that wanders a few steps,
  // with the odd 2-wide peak. The ground stays flat, but the tall wall voxels
  // read as layered cliffs/peaks in 3D. Kept sparse + off-route so the north
  // stays passable and never reads as one solid wall.
  for (let n = 0; n < 8; n++) {
    let mx = 3 + Math.floor(rng() * (MW - 6));
    let my = 2 + Math.floor(rng() * 8);
    const len = 3 + Math.floor(rng() * 4);
    const dir = rng() < 0.5 ? 1 : -1;
    const put = (px, py) => { if (inb(px, py) && !protect[idx(px, py)] && decor[idx(px, py)] === 0) decor[idx(px, py)] = G.WALL; };
    for (let s = 0; s < len; s++) {
      mx += dir;
      my += Math.round((rng() - 0.5) * 1.4);
      put(mx, my);
      if (rng() < 0.35) { put(mx, my - 1); put(mx + dir, my); } // a taller, wider peak
    }
  }
  // forests (rubble = trees): a full-grid biome-biased pass for even, lush
  // coverage — dense across the temperate belt, scattered snow-pines on the
  // frost cap, rare shrubs on the desert sand. (Road, water + ranges stay clear.)
  for (let y = 1; y < MH - 1; y++) for (let x = 1; x < MW - 1; x++) {
    if (protect[idx(x, y)] || decor[idx(x, y)] !== 0) continue;
    const b = biomeAt(x, y);
    const chance = b === "temperate" ? 0.3 : b === "frost" ? 0.12 : 0.04;
    if (rng() < chance) decor[idx(x, y)] = G.RUBBLE;
  }
  // a dedicated dense forest belt (west-central) framing the early road
  for (let n = 0; n < 80; n++) {
    const x = 8 + Math.floor(rng() * 13), y = 6 + Math.floor(rng() * 18);
    if (inb(x, y) && !protect[idx(x, y)] && decor[idx(x, y)] === 0 && biomeAt(x, y) === "temperate" && rng() < 0.55)
      decor[idx(x, y)] = G.RUBBLE;
  }
  // a couple of grass lakes off the route (fewer now the river + bay carry water)
  for (const [lx, ly, lr] of [[33, 22, 3], [12, 19, 2.2], [30, 8, 2.0], [37, 16, 2.2]]) {
    for (let y = ly - 4; y <= ly + 4; y++) for (let x = lx - 4; x <= lx + 4; x++) {
      if (inb(x, y) && !protect[idx(x, y)] && decor[idx(x, y)] === 0 && Math.hypot(x - lx, y - ly) < lr) decor[idx(x, y)] = G.WATER;
    }
  }
  // wetlands pocket: a marsh of scattered water tiles in the southwest lowland
  for (let n = 0; n < 36; n++) {
    const x = 6 + Math.floor(rng() * 12), y = 18 + Math.floor(rng() * 6);
    if (inb(x, y) && !protect[idx(x, y)] && decor[idx(x, y)] === 0 && rng() < 0.5) decor[idx(x, y)] = G.WATER;
  }
  // glowing crystal accents beside even chapter nodes (non-blocking)
  L.chapters.forEach(([x, y], i) => {
    if (i % 2) return;
    const ax = x + 1, ay = y + 1;
    if (inb(ax, ay) && decor[idx(ax, ay)] === 0) decor[idx(ax, ay)] = G.CRYSTAL;
  });
  // scattered "ember" crystals glittering across the desert south (non-blocking)
  for (let n = 0; n < 16; n++) {
    const x = 2 + Math.floor(rng() * (MW - 4)), y = 2 + Math.floor(rng() * (MH - 4));
    if (!protect[idx(x, y)] && decor[idx(x, y)] === 0 && biomeAt(x, y) === "desert" && rng() < 0.5) decor[idx(x, y)] = G.CRYSTAL;
  }
}

function archetypeTown(ground, decor, rng) {
  const idx = (x, y) => y * MW + x;
  const inb = (x, y) => x > 0 && y > 0 && x < MW - 1 && y < MH - 1;
  for (let i = 0; i < ground.length; i++) if (rng() < 0.14) ground[i] = G.GROUND_ALT;
  // Buildings are placed as 3D meshes by the scene (World3D.addBuilding), so the
  // tile map stays an open plaza. A fountain (water) accent sits off the road.
  for (let y = 10; y < 13; y++) for (let x = 12; x < 15; x++) decor[idx(x, y)] = G.WATER;
  // scattered trees (rubble -> tree billboards) framing the plaza edges, away
  // from the central walkway (rows 13-17) and the fountain
  for (let n = 0; n < 22; n++) {
    const x = 2 + Math.floor(rng() * (MW - 4));
    const y = 2 + Math.floor(rng() * (MH - 4));
    if ((y < 8 || y > 20) && inb(x, y) && decor[idx(x, y)] === 0) decor[idx(x, y)] = G.RUBBLE;
  }
}

function archetypeArena(ground, decor, rng) {
  const idx = (x, y) => y * MW + x;
  for (let i = 0; i < ground.length; i++) if (rng() < 0.12) ground[i] = G.GROUND_ALT;
  // inner arena walls around the encounter region
  const ax0 = ENC.x0 - 2;
  const ax1 = ENC.x0 + ENC.w + 1;
  const ay0 = ENC.y0 - 2;
  const ay1 = ENC.y0 + ENC.h + 1;
  for (let x = ax0; x <= ax1; x++) {
    decor[idx(x, ay0)] = G.WALL;
    decor[idx(x, ay1)] = G.WALL;
  }
  for (let y = ay0; y <= ay1; y++) {
    decor[idx(ax0, y)] = G.WALL;
    decor[idx(ax1, y)] = G.WALL;
  }
  for (let y = ay0 + 1; y < ay1; y++) for (let x = ax0 + 1; x < ax1; x++) ground[idx(x, y)] = G.FLOOR;
}

// Winding rock cavern: organic rubble blobs, a few water pools, scattered
// crystals lighting the dark. The carve pass guarantees a path through.
function archetypeCave(ground, decor, rng) {
  const idx = (x, y) => y * MW + x;
  for (let i = 0; i < ground.length; i++) ground[i] = rng() < 0.35 ? G.GROUND_ALT : G.GROUND;
  // organic rock blobs (rubble) — grown from random seeds
  for (let n = 0; n < 16; n++) {
    const cx = 2 + Math.floor(rng() * (MW - 4));
    const cy = 2 + Math.floor(rng() * (MH - 4));
    const r = 1.5 + rng() * 2.5;
    for (let y = -3; y <= 3; y++) for (let x = -3; x <= 3; x++) {
      const px = cx + x, py = cy + y;
      if (px > 0 && py > 0 && px < MW - 1 && py < MH - 1 && Math.hypot(x, y) < r) decor[idx(px, py)] = G.RUBBLE;
    }
  }
  // underground pools
  for (let y = 18; y < 24; y++) for (let x = 8; x < 16; x++) if (Math.hypot(x - 12, y - 21) < 3.2) decor[idx(x, y)] = G.WATER;
  for (let y = 4; y < 9; y++) for (let x = 24; x < 31; x++) if (Math.hypot(x - 27, y - 6) < 2.6) decor[idx(x, y)] = G.WATER;
  // scattered glowing crystals (non-blocking accents) on open ground
  for (let n = 0; n < 14; n++) {
    const x = 2 + Math.floor(rng() * (MW - 4));
    const y = 2 + Math.floor(rng() * (MH - 4));
    if (decor[idx(x, y)] === 0) decor[idx(x, y)] = G.CRYSTAL;
  }
}

// Sealed high-tech vault: floor-tiled geometric chambers walled off into a grid,
// crystal data-cores at the junctions. Cold, ordered, blue.
function archetypeVault(ground, decor, rng) {
  const idx = (x, y) => y * MW + x;
  for (let i = 0; i < ground.length; i++) ground[i] = rng() < 0.25 ? G.GROUND_ALT : G.FLOOR;
  // chamber partition walls (a grid with punched doorways)
  for (const wx of [11, 21, 31]) {
    const gap = 6 + Math.floor(rng() * 18);
    for (let y = 1; y < MH - 1; y++) if (Math.abs(y - gap) > 1) decor[idx(wx, y)] = G.WALL;
  }
  for (const wy of [9, 20]) {
    const gap = 5 + Math.floor(rng() * 28);
    for (let x = 1; x < MW - 1; x++) if (Math.abs(x - gap) > 1) decor[idx(x, wy)] = G.WALL;
  }
  // data-core crystals at chamber centres (non-blocking)
  for (const [x, y] of [[6, 5], [16, 5], [26, 24], [35, 24], [6, 24], [35, 5]]) {
    if (decor[idx(x, y)] === 0) decor[idx(x, y)] = G.CRYSTAL;
  }
}

// Carve a guaranteed-walkable lane spawn -> encounter, and clear the encounter
// clearing, overriding any obstacles placed by the archetype.
function carvePath(ground, decor) {
  const idx = (x, y) => y * MW + x;
  for (let x = SPAWN.x; x <= ENC_CX; x++) {
    for (let dy = -1; dy <= 1; dy++) {
      const y = SPAWN.y + dy;
      decor[idx(x, y)] = 0;
      ground[idx(x, y)] = dy === 0 ? G.PATH : ground[idx(x, y)];
    }
  }
  for (let y = ENC.y0; y < ENC.y0 + ENC.h; y++) {
    for (let x = ENC.x0; x < ENC.x0 + ENC.w; x++) {
      decor[idx(x, y)] = 0;
    }
  }
}

// Flood-fill from SPAWN over walkable (non-BLOCKED-decor) tiles and assert every
// target node is reachable. Throws if the layout ever traps a node behind water,
// walls or rubble — so a bad world regen fails the build instead of shipping.
function assertReachable(ground, decor, targets, label) {
  const idx = (x, y) => y * MW + x;
  const blocked = new Set(BLOCKED);
  const walk = (x, y) => x >= 0 && y >= 0 && x < MW && y < MH && !blocked.has(decor[idx(x, y)]);
  const seen = new Array(MW * MH).fill(false);
  const stack = [[SPAWN.x, SPAWN.y]];
  seen[idx(SPAWN.x, SPAWN.y)] = true;
  while (stack.length) {
    const [x, y] = stack.pop();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (walk(nx, ny) && !seen[idx(nx, ny)]) { seen[idx(nx, ny)] = true; stack.push([nx, ny]); }
    }
  }
  const bad = targets.filter(([x, y]) => !seen[idx(x, y)]);
  if (bad.length) throw new Error(`${label}: ${bad.length} unreachable node(s): ${JSON.stringify(bad)}`);
  return targets.length;
}

function buildMap(stage, archetype) {
  const rng = makeRng(stage.index * 1000 + 7);
  const ground = new Array(MW * MH).fill(G.GROUND);
  const decor = new Array(MW * MH).fill(0);

  if (archetype === "corridors") archetypeCorridors(ground, decor, rng);
  else if (archetype === "arena") archetypeArena(ground, decor, rng);
  else archetypeOpen(ground, decor, rng);

  borderWalls(decor);
  carvePath(ground, decor);

  // a few decorative crystals near the clearing (non-blocking)
  const idx = (x, y) => y * MW + x;
  for (const [x, y] of [[ENC.x0 - 1, ENC.y0 - 1], [ENC.x0 + ENC.w, ENC.y0 + ENC.h]]) {
    if (x > 0 && y > 0 && x < MW - 1 && y < MH - 1 && decor[idx(x, y)] === 0) decor[idx(x, y)] = G.CRYSTAL;
  }

  return { ground, decor };
}

function archetypeFor(type) {
  if (type === "Finale") return "arena";
  if (type === "Dungeon") return "corridors";
  return "open";
}

function tmj(stageId, ground, decor) {
  const layer = (id, name, data) => ({
    id, name, type: "tilelayer", x: 0, y: 0, width: MW, height: MH, opacity: 1, visible: true, data,
  });
  return {
    compressionlevel: -1,
    width: MW, height: MH, tilewidth: TS, tileheight: TS,
    orientation: "orthogonal", renderorder: "right-down", infinite: false,
    type: "map", version: "1.10", tiledversion: "1.10.2",
    nextlayerid: 4, nextobjectid: 3,
    tilesets: [{
      firstgid: 1, name: "tiles", image: `../tiles/${stageId}.png`,
      imagewidth: TS_W, imageheight: TS, tilewidth: TS, tileheight: TS,
      tilecount: TILE_COUNT, columns: TILE_COUNT, margin: 0, spacing: 0,
    }],
    layers: [
      layer(1, "ground", ground),
      layer(2, "decor", decor),
      {
        id: 3, name: "objects", type: "objectgroup", opacity: 1, visible: true,
        objects: [
          { id: 1, name: "spawn", type: "spawn", point: true, x: SPAWN.x * TS, y: SPAWN.y * TS, width: 0, height: 0 },
          { id: 2, name: "encounter", type: "encounter", x: ENC.x0 * TS, y: ENC.y0 * TS, width: ENC.w * TS, height: ENC.h * TS },
        ],
      },
    ],
  };
}

async function main() {
  await mkdir(join(OUT, "tiles"), { recursive: true });
  await mkdir(join(OUT, "maps"), { recursive: true });

  const stages = JSON.parse(await readFile(join(root, "src", "data", "stages.json"), "utf8"));

  for (const stage of stages) {
    const palette = THEMES[stage.id];
    if (!palette) {
      console.warn("no theme for", stage.id, "- skipping");
      continue;
    }
    const archetype = archetypeFor(stage.type);
    await buildTileset(palette, stage.index * 13 + 3).toFile(join(OUT, "tiles", `${stage.id}.png`));
    const { ground, decor } = buildMap(stage, archetype);
    await writeFile(join(OUT, "maps", `${stage.id}.tmj`), JSON.stringify(tmj(stage.id, ground, decor), null, 1));
    console.log(`${stage.id}  [${archetype}]  -> tiles/${stage.id}.png, maps/${stage.id}.tmj`);
  }

  // Town hub
  {
    const rng = makeRng(999);
    const ground = new Array(MW * MH).fill(G.GROUND);
    const decor = new Array(MW * MH).fill(0);
    archetypeTown(ground, decor, rng);
    borderWalls(decor);
    carvePath(ground, decor); // a road from the spawn into the plaza
    await buildTileset(THEMES.town, 99).toFile(join(OUT, "tiles", "town.png"));
    await writeFile(join(OUT, "maps", "town.tmj"), JSON.stringify(tmj("town", ground, decor), null, 1));
    console.log("town  [hub]  -> tiles/town.png, maps/town.tmj");
  }

  // Trade outpost (second town)
  {
    const rng = makeRng(424);
    const ground = new Array(MW * MH).fill(G.GROUND);
    const decor = new Array(MW * MH).fill(0);
    archetypeTown(ground, decor, rng);
    borderWalls(decor);
    carvePath(ground, decor);
    await buildTileset(THEMES.town2, 77).toFile(join(OUT, "tiles", "town2.png"));
    await writeFile(join(OUT, "maps", "town2.tmj"), JSON.stringify(tmj("town2", ground, decor), null, 1));
    console.log("town2  [trade]  -> tiles/town2.png, maps/town2.tmj");
  }

  // World map (FF-style overworld linking the chapters)
  {
    const rng = makeRng(2024);
    const ground = new Array(MW * MH).fill(G.GROUND);
    const decor = new Array(MW * MH).fill(0);
    archetypeWorld(ground, decor, rng);
    borderWalls(decor);
    const L = WORLD_LAYOUT;
    const targets = [L.home, ...L.chapters, ...Object.values(L.dungeons).map((d) => d.node)];
    const reached = assertReachable(ground, decor, targets, "world");
    await buildTileset(THEMES.world, 555).toFile(join(OUT, "tiles", "world.png"));
    await writeFile(join(OUT, "maps", "world.tmj"), JSON.stringify(tmj("world", ground, decor), null, 1));
    console.log(`world  [overworld]  -> tiles/world.png, maps/world.tmj  (reachable: ${reached}/${targets.length} nodes + spawn)`);
  }

  // Optional side dungeons reachable from the world map.
  const DUNGEONS = [
    { id: "cave", build: archetypeCave, seed: 4242 },
    { id: "vault", build: archetypeVault, seed: 7777 },
    { id: "training", build: archetypeOpen, seed: 3131 },
    { id: "spire", build: archetypeArena, seed: 9090 },
    { id: "frost", build: archetypeCave, seed: 5151 },
    { id: "forge", build: archetypeArena, seed: 6262 },
    { id: "archive", build: archetypeVault, seed: 8383 },
  ];
  for (const d of DUNGEONS) {
    const rng = makeRng(d.seed);
    const ground = new Array(MW * MH).fill(G.GROUND);
    const decor = new Array(MW * MH).fill(0);
    d.build(ground, decor, rng);
    borderWalls(decor);
    carvePath(ground, decor);
    const idx = (x, y) => y * MW + x;
    for (const [x, y] of [[ENC.x0 - 1, ENC.y0 - 1], [ENC.x0 + ENC.w, ENC.y0 + ENC.h]]) {
      if (x > 0 && y > 0 && x < MW - 1 && y < MH - 1 && decor[idx(x, y)] === 0) decor[idx(x, y)] = G.CRYSTAL;
    }
    await buildTileset(THEMES[d.id], d.seed).toFile(join(OUT, "tiles", `${d.id}.png`));
    await writeFile(join(OUT, "maps", `${d.id}.tmj`), JSON.stringify(tmj(d.id, ground, decor), null, 1));
    console.log(`${d.id}  [dungeon]  -> tiles/${d.id}.png, maps/${d.id}.tmj`);
  }

  console.log("Blocked gids:", BLOCKED.join(", "));
  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
