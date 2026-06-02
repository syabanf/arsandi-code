# Arsandi Code

A retro **techno-fantasy tactical JRPG** for the web — built from scratch in **Three.js + TypeScript + Vite** with an **HD‑2D** look (pixel sprites on lit 3D dioramas, tilt‑shift depth‑of‑field, bloom, and color grading).

In a world being slowly rewritten by the rogue AI **Archive Zero**, three Code Seekers — **Saka**, **Kara**, and **Zell** — cut a path across eight chapters to reach the source of the corruption.

---

## Features

- **HD‑2D 3D world** — explorable fields, towns, side dungeons, and a walkable world map, all rendered as billboard sprites on 3D terrain with atmospheric lighting, particles, and parallax backdrops.
- **Front‑view turn‑based battle** — FF‑style combat with a Legaia‑style **attack‑combo** input, **summons** (each hero has a signature ultimate), statuses, and phased bosses.
- **8‑chapter campaign** — each chapter is a field road of **mob encounters** (static *and* roaming monsters that wander and give chase) leading to a phased chapter boss.
- **Cinematic cutscenes** — a directive‑driven cutscene system: opening prologue, chapter intro, a mid‑field story beat, a pre‑boss confrontation, the chapter outro, and a "to be continued" epilogue card — letterbox, typewriter text, portraits, emotes, and music stings.
- **Progression** — per‑hero leveling with class promotion, an equipment system (weapon/armor/accessory), consumable items, gold, and a shop.
- **Content & lore** — a **bestiary**, a **lore codex**, multiple towns with story NPCs, an optional superboss sidequest, repeatable leveling dungeons, and a chocobo‑style mount.
- **Chiptune audio** — a small Web Audio engine for music and SFX.
- **Saves** — 3 save slots.

All game content (characters, classes, skills, enemies, stages, items, summons, cutscenes) is authored as **JSON** under `src/data/` and validated against the types in `src/types/game.ts` — adding content is a data edit, not a code change.

---

## Getting started

```bash
npm install
npm run dev        # start the Vite dev server
```

Open the printed local URL in a browser.

```bash
npm run build      # typecheck (tsc --noEmit) + production build to dist/
npm run preview    # preview the production build
npm run typecheck  # type-check only
```

### Tooling scripts

Asset and balance tooling (Node scripts under `tools/`):

| Script | What it does |
| --- | --- |
| `npm run assets` | Pixelize source concept art in `Assets/` into game sprites |
| `npm run world` | Generate the world‑map terrain + tileset |
| `npm run minions` | Procedurally generate minion sprites (by archetype/element) |
| `npm run monsters` | Composite organic monster sprites from the LPC Monsters pack |
| `npm run heroes` | Slice the hero sheets into per‑state strips |
| `npm run lpc` | Composite LPC townsfolk/NPC sprites |
| `npm run sim [trials]` | Headless battle‑balance simulator — reports per‑chapter difficulty (win rates, gauntlet clears, end‑HP) |

---

## Project structure

```
src/
  battle/   pure combat logic (combat math, statuses, AI, BattleState, combos)
  three/    Three.js engine — World3D (exploration), Battle3D, Ui3D (DOM overlay), scene routing
  game/     run state, leveling/progression, saves, story
  data/     JSON content: characters, classes, skills, enemies, stages, items, summons, cutscenes
  audio/    Web Audio chiptune engine
  types/    data-layer type definitions
tools/      asset pipeline + balance sim (Node + sharp)
Assets/     source-of-truth lore & concept art (consumed by the asset pipeline)
public/     generated game assets (sprites, maps, tiles, backgrounds, portraits)
```

---

## License & credits

- **Source code** is released under the **MIT License** (see [`LICENSE`](LICENSE)).
- **Assets are licensed separately** — see [`CREDITS.txt`](CREDITS.txt) for full attribution. In particular, sprites derived from the **Universal LPC Spritesheet** and the **LPC Monsters** pack are licensed under **CC‑BY‑SA 3.0** (and GPL 3.0); the derived sheets and any modifications are distributed under the same terms. The three hero sheets and the procedurally generated art are project‑owned.

If you reuse the art, keep the CC‑BY‑SA attribution and share‑alike intact.

---

*Built with [Claude Code](https://claude.com/claude-code).*
