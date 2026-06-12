import { World3D, type PlaceKind, type CutsceneActor } from "./World3D";
import { Ui3D, type MenuItem, type DialogPage } from "./Ui3D";
import { Battle3D, type BattleResult } from "./Battle3D";
import { runState, type PendingBattle } from "../game/runState";
import { stages, enemies, getItem, characters } from "../data";
import { LORE, type LoreEntry } from "../data/lore";
import type { EquipSlot, Stats, ItemData, StageData } from "../types/game";
import { cutscenePages, prologuePages } from "../game/story";
import { saveToSlot, loadFromSlot, slotInfo, SLOT_COUNT } from "../game/saves";
import { audio } from "../audio/AudioEngine";

// Orchestrates the 3D exploration scenes (World Map, Town, chapter Field) on top
// of the World3D engine + Ui3D DOM layer — the 3D-rewrite equivalent of the
// Phaser WorldMap/Town/Overworld scenes. Battle is still Phaser and is reached
// in a later rewrite pass.

type Stock = { id: string; price: number }[];
const SHOP_STOCK: Stock = [
  { id: "repair-kit", price: 50 },
  { id: "energy-cell", price: 40 },
  { id: "old-battery-pack", price: 25 },
];
// Weapon / armor / accessory stock for the gear shops.
const GEAR_STOCK: Stock = [
  { id: "scrap-vest", price: 90 },
  { id: "alloy-mail", price: 240 },
  { id: "aegis-core", price: 620 },
  { id: "power-chip", price: 160 },
  { id: "guard-chip", price: 160 },
  { id: "swift-chip", price: 160 },
  { id: "vitae-chip", price: 280 },
  { id: "pulse-saber", price: 260 },
  { id: "oracle-rod", price: 260 },
  { id: "siege-maul", price: 280 },
];

function statBonusText(bonus: Partial<Stats>): string {
  return (Object.keys(bonus) as (keyof Stats)[])
    .map((k) => `${k.toUpperCase()}+${bonus[k]}`).join(" ");
}

// World-map node tile positions — MUST match WORLD_LAYOUT in tools/build-world.mjs
// so each marker sits on the generated road.
const WORLD_LAYOUT = {
  home: [6, 15] as [number, number],
  chapters: [[10, 20], [14, 12], [18, 19], [22, 11], [26, 18], [30, 12], [34, 19], [37, 11]] as [number, number][],
};

// Optional side dungeons reachable from the world map. "Loot" dungeons (cave,
// vault) clear once for a treasure chest; "leveling" dungeons (repeatable: true)
// keep their mob waves so the party can grind XP/gold. Neither advances the story.
interface DungeonDef {
  id: string;
  title: string;
  short: string;
  kind: PlaceKind;
  color: string;
  node: [number, number];
  guide: string;
  lore: DialogPage[];
  encounters: string[][];
  bgStage: string;
  repeatable?: boolean;           // mob waves respawn — for grinding
  gold?: number;                  // one-time chest reward (loot dungeons)
  loot?: string[];
  lootText?: string;
}
const DUNGEONS: DungeonDef[] = [
  {
    id: "cave",
    title: "FORGOTTEN CACHE",
    short: "Cache",
    kind: "cave",
    color: "#7fe3ff",
    node: [12, 6],
    guide: "Echo",
    lore: [
      { speaker: "Echo", text: "These caverns predate the corruption. Old miners cached supplies down here." },
      { speaker: "Echo", text: "Clear the crawlers and the cache is yours — but mind the dark." },
    ],
    encounters: [["rail-crawler", "drill-bug"], ["corrupted-beast", "data-leech"], ["scrap-serpent", "sapper-bot"]],
    gold: 120,
    loot: ["repair-kit"],
    lootText: "Found 120 gold and a Repair Kit!",
    bgStage: "stage-2",
  },
  {
    id: "vault",
    title: "SEALED VAULT",
    short: "Vault",
    kind: "vault",
    color: "#7fe3ff",
    node: [28, 25],
    guide: "Cipher",
    lore: [
      { speaker: "Cipher", text: "A pre-collapse data vault. Its sentries still guard whatever's inside." },
      { speaker: "Cipher", text: "Break the lock-guards and we recover lost archives — and a fat purse." },
    ],
    encounters: [["sentry-bot", "fortress-sentry"], ["iron-legionnaire", "control-unit"], ["siege-golem", "static-shade"]],
    gold: 200,
    loot: ["energy-cell"],
    lootText: "Found 200 gold and an Energy Cell!",
    bgStage: "stage-4",
  },
  {
    id: "training",
    title: "TRAINING GROUNDS",
    short: "Training",
    kind: "arena",
    color: "#8fff9e",
    node: [5, 7],
    guide: "Drill Sergeant",
    lore: [
      { speaker: "Drill Sergeant", text: "Sparring yard. The corrupted drones here are weak — perfect for green recruits." },
      { speaker: "Drill Sergeant", text: "They keep reassembling, so train as long as you like. Come back any time." },
    ],
    encounters: [["scout-drone", "spark-drone"], ["packet-wisp", "data-eel"], ["husk-unit", "scout-drone"], ["rust-hound", "sapper-bot"]],
    gold: 100,
    loot: ["swift-chip"],
    lootText: "The drill cache yields 100 gold and a Swift Chip!",
    bgStage: "stage-1",
    repeatable: true,
  },
  {
    id: "spire",
    title: "NULL SPIRE",
    short: "Spire",
    kind: "spire",
    color: "#c090ff",
    node: [37, 24],
    guide: "Warden",
    lore: [
      { speaker: "Warden", text: "The Spire endlessly spawns the strongest husks the corruption can forge." },
      { speaker: "Warden", text: "Only the seasoned survive here — but the experience is unmatched. It never empties." },
    ],
    encounters: [["iron-legionnaire", "control-unit"], ["ai-knight", "data-guardian"], ["corrupted-android", "glitch-angel"], ["siege-golem", "echo-stalker", "sorrow-spirit"]],
    gold: 320,
    loot: ["aegis-core"],
    lootText: "Atop the Spire: 320 gold and an Aegis Core!",
    bgStage: "stage-finale",
    repeatable: true,
  },
  {
    id: "frost",
    title: "FROSTBYTE CAVERN",
    short: "Frost",
    kind: "cave",
    color: "#bfe8ff",
    node: [16, 3],
    guide: "Frostwarden",
    lore: [
      { speaker: "Frostwarden", text: "The cold here freezes code itself. Glacier husks guard a buried cache." },
      { speaker: "Frostwarden", text: "Burn through the rime-drakes and the treasure is yours." },
    ],
    encounters: [["frost-wisp", "rime-drake"], ["glacier-husk", "frost-wisp"], ["ice-golem", "rime-wisp"]],
    gold: 180,
    loot: ["alloy-mail"],
    lootText: "Found 180 gold and Alloy Mail!",
    bgStage: "stage-3",
  },
  {
    id: "forge",
    title: "EMBER FORGE",
    short: "Forge",
    kind: "arena",
    color: "#ff9a5a",
    node: [3, 24],
    guide: "Forgemaster",
    lore: [
      { speaker: "Forgemaster", text: "The old forge still burns. Its molten sentinels reforge endlessly." },
      { speaker: "Forgemaster", text: "Temper your party in the heat — they respawn, so train as you like." },
    ],
    encounters: [["cinder-imp", "magma-core"], ["forge-sentinel", "cinder-imp"], ["magma-core", "forge-sentinel"], ["ember-drake", "lava-imp"]],
    gold: 220,
    loot: ["siege-maul"],
    lootText: "The forge cools to reveal 220 gold and a Siege Maul!",
    bgStage: "stage-2",
    repeatable: true,
  },
  {
    id: "archive",
    title: "SUNKEN ARCHIVE",
    short: "Archive",
    kind: "vault",
    color: "#5fe0c0",
    node: [21, 27],
    guide: "Archivist",
    lore: [
      { speaker: "Archivist", text: "A flooded data-vault. Drowned units drag the unwary into the deep." },
      { speaker: "Archivist", text: "Slay the Bog Leviath and recover what the tide swallowed." },
    ],
    encounters: [["drowned-unit", "tide-wraith"], ["tide-wraith", "drowned-unit"], ["bog-leviath", "drowned-unit"], ["abyss-drake", "drowned-wisp"]],
    gold: 260,
    loot: ["vitae-chip"],
    lootText: "Found 260 gold and a Vitae Chip!",
    bgStage: "stage-4",
  },
];

export class Game3D {
  private world: World3D;
  private ui: Ui3D;
  private mount: HTMLElement;
  private currentStage = "stage-1";
  private currentDungeonId: string | null = null;
  private optionalReward: { quest: string; clearKey: string; gold: number; loot: string[]; lootText: string } | null = null;
  private battle?: Battle3D;
  private musicVol = 0.55;
  private sfxVol = 0.7;
  private sheetHeroId = characters[0]?.id ?? "saka";

  constructor(mount: HTMLElement) {
    this.mount = mount;
    this.world = new World3D(mount);
    this.ui = new Ui3D();
    this.world.onInteractHint = (label) => this.ui.setPrompt(label);
    this.world.onMenuKey = () => this.openPause();
    this.ui.onModalChange = (open) => this.world.setLocked(open);
    // Floating party/status button (and the [P] shortcut) open the character sheet.
    this.ui.onCharButton = () => this.openCharSheet();
    this.ui.onCharKey = () => this.openCharSheet();
    // On-screen touch controls (mobile) drive the same World3D actions as the keyboard.
    this.ui.onTouchMove = (x, z) => this.world.setMoveVector(x, z);
    this.ui.onTouchInteract = () => this.world.pressInteract();
    this.ui.onTouchMenu = () => this.openPause();
    this.ui.onTouchMount = () => this.world.toggleMount();
  }

  // exposed for headless verification (frame-pumping)
  get engine(): World3D { return this.world; }
  get battle3d(): Battle3D | undefined { return this.battle; }

  async startAt(sceneId: string): Promise<void> {
    if (sceneId === "title" || sceneId === "3d" || !sceneId) { this.showTitle(); return; }
    if (sceneId === "town") await this.goToTown();
    else if (sceneId === "world") await this.goToWorld();
    else await this.goToField(sceneId);
  }

  // ---- Title ------------------------------------------------------------

  private showTitle(): void {
    audio.playMusic("title");
    this.ui.setVisible(true);
    this.ui.setCharButtonEnabled(false);
    this.ui.setLocation(""); this.ui.setHint(""); this.ui.setPrompt(null); this.ui.setGold(runState.gold);
    this.ui.showTitleBg("assets/ui/title.png");
    this.titleMenu();
  }
  private titleMenu(): void {
    this.ui.openMenu("ARSANDI  CODE", () => [
      { label: "START", onPick: () => { runState.reset(); this.leaveTitle(() => this.goToWorld()); } },
      { label: "CONTINUE", onPick: () => this.titleContinue() },
      { label: "CHAPTER SELECT", onPick: () => this.titleChapters() },
      { label: "OPTIONS", onPick: () => this.openOptions(() => this.titleMenu()) },
    ]);
  }
  private leaveTitle(go: () => Promise<void>): void {
    this.ui.closeMenu(); this.ui.hideTitleBg();
    this.transition(() => go());
  }
  private titleContinue(): void {
    this.ui.openMenu("CONTINUE", () =>
      [...Array.from({ length: SLOT_COUNT }, (_, i) => {
        const info = slotInfo(i);
        return { label: `Slot ${i + 1}`, sub: info.exists ? `Ch ${info.chapter} · Lv ${info.partyLevel}` : "empty", disabled: !info.exists, onPick: () => { if (loadFromSlot(i)) this.leaveTitle(() => this.goToWorld()); } } as MenuItem;
      }), { label: "← Back", onPick: () => this.titleMenu() } as MenuItem], () => this.titleMenu());
  }
  private titleChapters(): void {
    this.ui.openMenu("CHAPTER SELECT", () =>
      [...stages.map((s, i) => ({ label: `${i + 1}. ${s.name}`, onPick: () => { runState.reset(); runState.stageIndex = i; this.leaveTitle(() => this.goToWorld()); } } as MenuItem)),
      { label: "← Back", onPick: () => this.titleMenu() } as MenuItem], () => this.titleMenu());
  }

  private transition(fn: () => Promise<void>): void {
    this.ui.setCharButtonEnabled(false); // hidden during the fade; target scene re-enables
    this.ui.fadeOut(async () => {
      await fn();
      this.ui.fadeIn();
    });
  }

  private syncGold(): void { this.ui.setGold(runState.gold); }

  // Build the live party HP strip from runState — same effective-max-HP math as
  // the character sheet (base stat HP + equipment bonus) — and push it to the HUD.
  private refreshPartyHud(): void {
    const members = characters
      .filter((c) => runState.party[c.id])
      .map((c) => {
        const p = runState.party[c.id];
        const hpMax = Math.round(p.stats.hp) + (runState.equipBonus(c.id).hp ?? 0);
        return { id: c.id, name: c.name, level: p.level, hpCur: Math.min(Math.round(p.hp), hpMax), hpMax };
      });
    this.ui.setPartyHud(members);
  }

  // ---- World Map --------------------------------------------------------

  private async goToWorld(): Promise<void> {
    this.currentDungeonId = null;
    await this.world.loadMap("world");
    this.resetSceneUi();
    this.world.start();
    this.ui.setCharButtonEnabled(true);
    audio.playMusic("field");
    this.ui.setLocation(`WORLD MAP · Ch ${runState.chapterNumber}: ${runState.chapter.name}`);
    this.ui.setHint("Arrows/WASD move · [E] enter · [Esc] menu");
    this.syncGold();
    this.refreshPartyHud();

    this.world.setCanMount(true); this.ui.setMountButton(true);
    this.ui.setHint("Arrows/WASD move · [E] enter · [C] chocobo · [Esc] menu");

    const [hx, hy] = WORLD_LAYOUT.home;
    this.world.addPlaceMarker(hx, hy, "town", "#ffd166", "Home Base", () => this.transition(() => this.goToTown()));
    // a second town: trade outpost (gear shop + inn + traders)
    this.world.addPlaceMarker(6, 11, "town", "#ffce8c", "Market", () => this.transition(() => this.goToTradeTown()));

    // optional superboss node ("Anomaly") — a tough fight with a gear reward
    const anomalyDone = runState.isChestOpened("anomaly:cleared");
    this.world.addPlaceMarker(37, 5, "boss", anomalyDone ? "#6a5f88" : "#ff4d6d", "Anomaly", () => {
      if (anomalyDone) { this.ui.showDialog([{ speaker: "Anomaly", text: "The rift here is silent now. You already broke it." }]); return; }
      this.ui.showDialog([
        { speaker: "Rift Anomaly", text: "A monstrous corrupted mass writhes in the rift — an optional superboss." },
        { speaker: "Rift Anomaly", text: "Defeat it for a powerful reward. Press on?" },
      ], () => this.startOptionalBoss("the-fragmented-one", "stage-finale",
        { quest: "anomaly", clearKey: "anomaly:cleared", gold: 400, loot: ["aegis-core"], lootText: "Rift broken! +400 gold and an Aegis Core!" }));
    }, anomalyDone ? { badge: "check" } : {});

    stages.forEach((s, i) => {
      const [nx, ny] = WORLD_LAYOUT.chapters[i] ?? [10 + i * 4, 15];
      const cleared = i < runState.stageIndex;
      const current = i === runState.stageIndex;
      const isFinale = s.type === "Finale" || i === stages.length - 1;
      const kind: PlaceKind = isFinale ? "boss" : "gate";
      const color = cleared ? "#4dff9e" : current ? "#ff6b8a" : "#6a5f88";
      const badge = cleared ? "check" : !current ? "lock" : undefined;
      this.world.addPlaceMarker(nx, ny, kind, color, `Ch ${i + 1}`, () => {
        if (cleared) { this.ui.showDialog([{ speaker: "World Map", text: `${s.name} is already cleared.` }]); return; }
        if (!current) { this.ui.showDialog([{ speaker: "World Map", text: `Sealed. Clear Chapter ${runState.chapterNumber} first.` }]); return; }
        this.transition(() => this.goToField(s.id));
      }, { badge });
    });

    // Optional side dungeons branching off the main road (loot + leveling).
    DUNGEONS.forEach((d) => {
      this.world.addPlaceMarker(d.node[0], d.node[1], d.kind, d.color, d.short,
        () => this.transition(() => this.goToDungeon(d.id)));
    });
  }

  // ---- side Dungeon -----------------------------------------------------

  /**
   * Choose `count` walkable tiles fanned out across the current map's open
   * floor, so encounter markers scatter in 2D instead of lining up in a single
   * row. Tiles in `reserved` (guide NPC, chest, props, boss gate) and anything
   * left of `minX` (keeps the spawn lane clear) are skipped. A string-seeded
   * PRNG makes each map's layout varied but stable across reloads. Greedy
   * farthest-spacing, relaxing the minimum gap until enough tiles are picked.
   */
  private scatterTiles(seed: string, count: number, reserved: Set<string>, minX = 7): [number, number][] {
    if (count <= 0) return [];
    const pool = this.world.reachableSpots().filter(([x, y]) => x >= minX && !reserved.has(`${x},${y}`));
    if (pool.length === 0) return [];
    // FNV-1a hash of the seed -> mulberry32 PRNG: deterministic per seed.
    let h = 2166136261 >>> 0;
    for (let i = 0; i < seed.length; i++) { h ^= seed.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    const rand = () => {
      h = (h + 0x6d2b79f5) >>> 0;
      let t = h;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); const t = pool[i]; pool[i] = pool[j]; pool[j] = t; }
    const picked: [number, number][] = [];
    const taken = new Set<string>();
    for (let gap = 8; picked.length < count && gap >= 0; gap--) {
      for (const p of pool) {
        if (picked.length >= count) break;
        const key = `${p[0]},${p[1]}`;
        if (taken.has(key)) continue;
        if (picked.every(([qx, qy]) => Math.hypot(qx - p[0], qy - p[1]) >= gap)) { picked.push(p); taken.add(key); }
      }
    }
    return picked;
  }

  private async goToDungeon(dungeonId: string): Promise<void> {
    const d = DUNGEONS.find((x) => x.id === dungeonId);
    if (!d) { await this.goToWorld(); return; }
    this.currentDungeonId = d.id;
    this.world.setCanMount(false); this.ui.setMountButton(false);
    await this.world.loadMap(d.id);
    this.resetSceneUi();
    this.world.start();
    this.ui.setCharButtonEnabled(true);
    audio.playMusic("field");
    this.ui.setLocation(d.title);
    this.ui.setHint("Arrows/WASD move · [E] interact · [Esc] menu");
    this.syncGold();
    this.refreshPartyHud();

    this.world.addNpcMarker(4, 15, "#9fe0ff", d.guide, () => this.ui.showDialog(d.lore), 1.7, "npc-guard");

    // Loot dungeons have a one-time treasure chest; leveling dungeons don't.
    if (d.loot && d.gold != null) {
      const chestKey = `${d.id}:c1`;
      const chest = this.world.addChest(15, 13, runState.isChestOpened(chestKey), () => {
        if (runState.isChestOpened(chestKey)) { this.ui.showDialog([{ text: "The cache is empty." }]); return; }
        runState.openChest(chestKey); runState.addGold(d.gold!); runState.addItems(d.loot!);
        this.syncGold(); audio.playSfx("chest");
        chest.setOpened();
        this.ui.showDialog([{ text: d.lootText ?? "Found treasure!" }]);
      });
    }

    // Encounters fan out across the dungeon's open floor instead of standing in
    // a row. Reserve the guide/back-portal/chest and the clutter-prop tiles so a
    // monster never spawns on top of them. Repeatable (leveling) dungeons never
    // clear — their waves always respawn.
    const reserved = new Set<string>(["3,15", "4,15", "8,13", "11,17", "20,17", "22,13", "25,17"]);
    if (d.loot && d.gold != null) reserved.add("15,13");
    const visible = d.encounters
      .map((wave, i) => ({ wave, key: runState.encounterKey(d.id, i) }))
      .filter(({ key }) => d.repeatable || !runState.isEncounterCleared(key));
    const spots = this.scatterTiles(`dungeon:${d.id}`, visible.length, reserved);
    visible.forEach(({ wave, key }, idx) => {
      const [tx, ty] = spots[idx] ?? [18, 15];
      const lead = enemies.find((e) => e.id === wave[0]);
      void this.world.addSpriteMarker(tx, ty, `assets/sprites/minion-${wave[0]}.png`, "#ff5d7a", lead?.name ?? "Enemy",
        () => this.startBattle({ kind: "mob", enemyIds: wave, key: d.repeatable ? undefined : key }, d.bgStage), 1.5);
    });

    // dungeon clutter — bones, broken crates, machine debris
    for (const [px, py, kind] of [[8, 13, "bones"], [11, 17, "debris"], [20, 17, "crate"], [22, 13, "bones"], [25, 17, "debris"]] as [number, number, "bones" | "debris" | "crate"][]) this.world.addProp(px, py, kind);

    this.world.addMarker(3, 15, "#8fb8ff", "◀", "World Map", () => this.transition(() => this.goToWorld()));
  }

  // ---- Town -------------------------------------------------------------

  private async goToTown(): Promise<void> {
    this.currentDungeonId = null;
    this.world.setCanMount(false); this.ui.setMountButton(false);
    await this.world.loadMap("town");
    this.resetSceneUi();
    this.world.start();
    this.ui.setCharButtonEnabled(true);
    audio.playMusic("town");
    this.ui.setLocation("HOME BASE");
    this.ui.setHint("Arrows/WASD move · [E] interact · [Esc] menu");
    this.syncGold();
    this.refreshPartyHud();

    this.world.addNpcMarker(8, 15, "#b9a9ff", "Elder", () =>
      this.ui.showDialog([
        { speaker: "Village Elder", text: "The corruption spreads, but Code Seekers like you give us hope." },
        { speaker: "Village Elder", text: "Before the Rewrite, one machine was built to keep us safe — Archive Zero. Now it would see us all stilled into the 'peace' of an empty world." },
        { speaker: "Village Elder", text: "Rest here, gather supplies, then press on. And mind that blade of yours, Saka. It hums like the old world's heart — that is no accident." },
      ]), 1.7, "npc-elder");
    this.world.addNpcMarker(14, 16, "#ffd166", "Shop", () => this.openShop("HOME SUPPLY", [...SHOP_STOCK, { id: "scrap-vest", price: 90 }, { id: "power-chip", price: 160 }]), 1.7, "npc-merchant");
    this.world.addNpcMarker(18, 16, "#4dff9e", "Inn", () => {
      runState.restParty();
      this.refreshPartyHud();
      audio.playSfx("heal");
      this.ui.showDialog([{ speaker: "Innkeeper", text: "Rest well, Seekers. The whole party is fully restored." }]);
    }, 1.7, "npc-villager");
    // Quartermaster — sidequest giver for the optional superboss
    this.world.addNpcMarker(24, 16, "#ffae6a", "Quartermaster", () => {
      const q = runState.questStatus("anomaly");
      if (q === "done") { this.ui.showDialog([{ speaker: "Quartermaster", text: "The Anomaly's gone? Outstanding work, Seeker." }]); return; }
      runState.startQuest("anomaly");
      this.ui.showDialog([
        { speaker: "Quartermaster", text: "A rift Anomaly festers in the far wastes — a monster beyond the chapters." },
        { speaker: "Quartermaster", text: "QUEST: Slay the Anomaly (marked ✦ on the map). Bring it down and the reward is yours." },
      ]);
    }, 1.7, "npc-guard");
    this.world.addNpcMarker(11, 15, "#b45cff", "Kara", () =>
      this.ui.showDialog([
        { speaker: "Kara", text: "Knowledge without empathy is just another kind of control. That was Archive Zero's first mistake — and it cost the world everything." },
        { speaker: "Kara", text: "Stay sharp out there, little brother. I'll keep us standing. That's what an older sister is for.", portrait: "portrait-kara" },
      ]), 1.7, "kara");
    this.world.addNpcMarker(16, 14, "#4dff9e", "Zell", () =>
      this.ui.showDialog([
        { speaker: "Zell", text: "Patched up the gear! Machines break — but WE choose how we use them. That's the whole difference, right there." },
        { speaker: "Zell", text: "...My old man used to say tech is just a tool. I keep telling myself he was right. Anyway — hammer's tuned. Let's move.", portrait: "portrait-zell" },
      ]), 1.7, "zell");
    this.world.addMarker(20, 13, "#8fb8ff", "◀", "World Map", () => this.transition(() => this.goToWorld()));

    // 3D buildings framing the plaza (their footprints are auto-blocked).
    this.world.addBuilding(7, 9, { w: 4, d: 3, bodyH: 3.0, color: 0x6a5f86, roof: 0x6a4a8c });  // Elder's Hall
    this.world.addBuilding(15, 8, { w: 3, d: 3, color: 0x6e6048, roof: 0x8a5a3a });
    this.world.addBuilding(21, 9, { w: 3, d: 3, color: 0x5f6a86, roof: 0x8a4a44 });
    this.world.addBuilding(28, 9, { w: 3, d: 3, color: 0x6a5f7e, roof: 0x4a6a8c });
    this.world.addBuilding(9, 21, { w: 3, d: 3, color: 0x6e6450, roof: 0x8a4a44 });
    this.world.addBuilding(25, 21, { w: 3, d: 3, color: 0x60607e, roof: 0x6a4a8c });

    // lantern posts lighting the plaza
    for (const [lx, ly] of [[6, 13], [22, 13], [10, 18], [24, 18]] as [number, number][]) this.world.addLantern(lx, ly);
  }

  // ---- Trade Outpost (second town: gear shop + inn + traders) -----------

  private async goToTradeTown(): Promise<void> {
    this.currentDungeonId = null;
    this.world.setCanMount(false); this.ui.setMountButton(false);
    await this.world.loadMap("town2");
    this.resetSceneUi();
    this.world.start();
    this.ui.setCharButtonEnabled(true);
    audio.playMusic("town");
    this.ui.setLocation("RIVET MARKET");
    this.ui.setHint("Arrows/WASD move · [E] interact · [Esc] menu");
    this.syncGold();
    this.refreshPartyHud();

    this.world.addNpcMarker(14, 16, "#ffd166", "Smith", () => this.openShop("RIVET ARMORY", [...GEAR_STOCK, ...SHOP_STOCK]), 1.7, "npc-merchant");
    this.world.addNpcMarker(18, 16, "#4dff9e", "Inn", () => {
      if (!runState.spendGold(15)) { this.ui.showDialog([{ speaker: "Innkeeper", text: "A night's rest is 15 ◆ — come back when you can pay." }]); return; }
      runState.restParty(); this.syncGold(); this.refreshPartyHud(); audio.playSfx("heal");
      this.ui.showDialog([{ speaker: "Innkeeper", text: "Paid in full. Sleep easy — the party is fully restored." }]);
    }, 1.7, "npc-villager");
    this.world.addNpcMarker(9, 15, "#9fe0ff", "Scholar", () =>
      this.ui.showDialog([
        { speaker: "Codex Scholar", text: `I catalog every corrupted form we meet — ${runState.seenCount} so far. Each one was something, before the Rewrite twisted it.` },
        { speaker: "Codex Scholar", text: "Two records wait in your pause menu: the BESTIARY for what you've fought, and the LORE CODEX for the story of this dying world." },
        { speaker: "Codex Scholar", text: "Read them both. In a world a machine is trying to erase, memory is its own kind of resistance." },
      ]), 1.7, "npc-elder");
    this.world.addNpcMarker(24, 15, "#cdbcff", "Trader", () =>
      this.ui.showDialog([
        { speaker: "Wandering Trader", text: "Rivet Market trades in salvaged steel. Good gear keeps a Seeker breathing." },
        { speaker: "Wandering Trader", text: "I've walked every road from here to the Black Fortress's shadow. The world's dying, friend — but folk still barter, still hope. That counts for something." },
      ]), 1.7, "npc-merchant");
    this.world.addMarker(20, 13, "#8fb8ff", "◀", "World Map", () => this.transition(() => this.goToWorld()));

    this.world.addBuilding(7, 9, { w: 4, d: 3, bodyH: 3.0, color: 0x6e6048, roof: 0x8a5a3a });   // armory
    this.world.addBuilding(15, 8, { w: 3, d: 3, color: 0x5f6a86, roof: 0x8a4a44 });
    this.world.addBuilding(21, 9, { w: 3, d: 3, color: 0x6a5f7e, roof: 0x6a4a8c });
    this.world.addBuilding(9, 21, { w: 3, d: 3, color: 0x6e6450, roof: 0x8a4a44 });
    this.world.addBuilding(25, 21, { w: 3, d: 3, color: 0x60607e, roof: 0x4a6a8c });
    for (const [lx, ly] of [[6, 13], [22, 13], [10, 18], [24, 18]] as [number, number][]) this.world.addLantern(lx, ly);
  }

  // ---- chapter Field ----------------------------------------------------

  private async goToField(stageId: string): Promise<void> {
    this.currentStage = stageId;
    this.currentDungeonId = null;
    this.world.setCanMount(false); this.ui.setMountButton(false);
    await this.world.loadMap(stageId);
    this.resetSceneUi();
    this.world.start();
    this.ui.setCharButtonEnabled(true);
    audio.playMusic("field");
    const stage = stages.find((s) => s.id === stageId) ?? runState.chapter;
    this.ui.setLocation(`CHAPTER ${stage.index} · ${stage.name}`);
    this.ui.setHint("Arrows/WASD move · [E] interact · [Esc] menu");
    this.syncGold();
    this.refreshPartyHud();

    // Prologue + intro play on first visit only. They're queued at the END of
    // setup (see playFieldIntro call) so they stage over the revealed field
    // rather than behind the transition's fade-to-black.
    const firstVisit = !runState.hasVisited(stage.id);
    if (firstVisit) runState.markVisited(stage.id);

    this.world.addNpcMarker(4, 15, "#4dff9e", "Scout", () =>
      this.ui.showDialog([
        { speaker: "Field Scout", text: `This is ${stage.name}.` },
        { speaker: "Field Scout", text: "Cut through the corrupted along the road, then face the boss at the gate." },
        { speaker: "Field Scout", text: "Whatever it's become, it was something once — a guardian, a machine, a person. Archive Zero rewrote them all. Don't let it rewrite you." },
      ]), 1.7, "npc-guard");

    const chestKey = `${stageId}:c1`;
    const chest = this.world.addChest(15, 13, runState.isChestOpened(chestKey), () => {
      if (runState.isChestOpened(chestKey)) { this.ui.showDialog([{ text: "The chest is empty." }]); return; }
      runState.openChest(chestKey); runState.addGold(60); this.syncGold(); audio.playSfx("chest");
      chest.setOpened();
      this.ui.showDialog([{ text: "Found 60 gold!" }]);
    });

    // Enemy encounters from the stage's mob waves, fanned out across the field's
    // open ground instead of a single row (cleared ones don't respawn). The boss
    // gate stays fixed at the end of the road; reserve the scout/back-portal/
    // chest, the boss tile + its neighbours and the roadside props.
    const reserved = new Set<string>([
      "3,15", "4,15", "15,13", "30,15", "29,15", "31,15", "30,14", "30,16",
      "8,13", "12,17", "20,13", "24,17", "27,17", "28,13",
    ]);
    // The first `stage.roamers` waves (by original index) spawn as roaming
    // monsters that wander and chase the player; the rest are static markers.
    // Designating by original index keeps which waves roam stable as others clear.
    const encs = stage.encounters ?? [];
    const roamerCount = stage.roamers ?? 0;
    const visible = encs
      .map((wave, i) => ({ wave, i, key: runState.encounterKey(stage.id, i) }))
      .filter(({ key }) => !runState.isEncounterCleared(key));
    const spots = this.scatterTiles(`stage:${stage.id}`, visible.length, reserved);
    visible.forEach(({ wave, i, key }, idx) => {
      const [tx, ty] = spots[idx] ?? [18, 15];
      const lead = enemies.find((e) => e.id === wave[0]);
      const tex = `assets/sprites/minion-${wave[0]}.png`;
      const name = lead?.name ?? "Enemy";
      const start = () => this.startBattle({ kind: "mob", enemyIds: wave, key });
      if (i < roamerCount) void this.world.addRoamer(tx, ty, tex, "#ff5d7a", name, start, 1.5);
      else void this.world.addSpriteMarker(tx, ty, tex, "#ff5d7a", name, start, 1.5);
    });

    // Boss gate (the chapter boss) — interacting plays the one-time pre-boss
    // confrontation before the fight.
    void this.world.addSpriteMarker(30, 15, `assets/sprites/boss-${stage.bossId}.png`, "#ff6b8a", "BOSS",
      () => void this.enterBossGate(stage), 2.7, 2.2);
    this.world.addMarker(3, 15, "#8fb8ff", "◀", "World Map", () => this.transition(() => this.goToWorld()));

    // Mid-field story beat: a proximity trigger partway down the road, once only.
    if (cutscenePages(stage.id, "midfield") && !runState.hasSeenScene(`midfield:${stage.id}`)) {
      this.world.addTrigger(17, 15, 1.7, () => void this.playMidfield(stage));
    }

    // decorative roadside props — a traveled, lived-in route
    for (const [px, py, kind] of [[8, 13, "crate"], [12, 17, "barrel"], [20, 13, "banner"], [24, 17, "crate"], [27, 17, "barrel"], [28, 13, "banner"]] as [number, number, "crate" | "barrel" | "banner"][]) this.world.addProp(px, py, kind);

    // Queue the opening prologue (once) + chapter intro, after the field is set
    // up and the fade-in has revealed it.
    if (firstVisit) void this.playFieldIntro(stage);
  }

  // ---- cutscene director ------------------------------------------------

  // Clear any lingering cutscene presentation (letterbox + dialogue) so a stale
  // cinematic overlay from an interrupted scene can never bleed onto a freshly
  // loaded scene. Idempotent — safe to call when no cutscene is active.
  private resetSceneUi(): void {
    this.ui.hideCine();
    this.ui.setLetterbox(false);
  }

  private delay(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }

  // Resolves a line's `shot`/`zoom` directive into an eased camera move. Frames
  // the player by default; "boss"/"ally"/explicit tiles retarget, "wide" pulls
  // back, "two-shot" sits between the player and the other subject.
  private cineShot(
    shot: DialogPage["shot"],
    zoom: number | undefined,
    ctx: { player: [number, number]; boss?: [number, number]; ally?: [number, number] },
    ms = 850,
  ): Promise<void> {
    let z = zoom ?? 1;
    let tx = ctx.player[0], tz = ctx.player[1], side = 0;
    if (Array.isArray(shot)) { tx = shot[0]; tz = shot[1]; }
    else if (shot === "boss" && ctx.boss) { [tx, tz] = ctx.boss; }
    else if (shot === "ally" && ctx.ally) { [tx, tz] = ctx.ally; }
    else if (shot === "two-shot") {
      const b = ctx.ally ?? ctx.boss ?? ctx.player;
      tx = (ctx.player[0] + b[0]) / 2; tz = (ctx.player[1] + b[1]) / 2; side = 1.6;
    } else if (shot === "wide") {
      z = Math.max(z, 1.5);
    }
    return this.world.cameraFocus(tx, tz, { dist: Math.max(5, 9.5 * z), height: 6 + 4.6 * z, side, ms });
  }

  // Plays a run of cinematic lines: suspends the follow camera, frames the
  // letterbox, then per line applies music/sfx/fx/shot directives and shows a
  // typewriter dialogue the player advances. Restores the field at the end.
  private async playCutscene(
    pages: DialogPage[],
    opts: { boss?: [number, number]; ally?: [number, number]; onStart?: () => Promise<void> } = {},
  ): Promise<void> {
    const ctx = { player: this.world.playerPos(), boss: opts.boss, ally: opts.ally };
    this.world.enterCinematic();
    this.ui.setLetterbox(true);
    let music = "";
    try {
      if (opts.onStart) await opts.onStart();
      for (const page of pages) {
        ctx.player = this.world.playerPos();
        if (page.music && page.music !== music) { audio.playMusic(page.music); music = page.music; }
        if (page.sfx) audio.playSfx(page.sfx);
        if (page.fx === "flash") this.ui.flashScreen();
        else if (page.fx === "shake") this.world.shake(0.35, 420);
        else if (page.fx === "rumble") this.world.shake(0.6, 720);
        else if (page.fx === "to-black") this.ui.fadeOut();
        else if (page.fx === "from-black") this.ui.fadeIn();
        if (page.shot !== undefined || page.zoom !== undefined) void this.cineShot(page.shot, page.zoom, ctx);
        if ((page.hold ?? 0) > 0 && !page.text) await this.delay(page.hold!);
        else await this.ui.cineLine(page);
      }
    } finally {
      this.ui.hideCine();
      this.ui.setLetterbox(false);
      this.ui.fadeIn(); // clear any lingering to-black from the sequence
      await this.world.exitCinematic();
    }
  }

  // First-visit opening: settle the fade-in, play the one-time prologue, show
  // the chapter title card, then the chapter intro exchange.
  private async playFieldIntro(stage: StageData): Promise<void> {
    // Hold the field still for the whole opening (fade-settle → prologue → title
    // card → intro) so the player can't walk, trip an encounter, or get caught by
    // a roaming monster mid-opening. `token` lets us bail if the player has left
    // this field by the time a delay resolves (stale fire-and-forget coroutine).
    const token = this.world.sceneToken;
    const stillHere = () => this.world.sceneToken === token;
    this.world.setLocked(true);
    await this.delay(650);
    if (!stillHere()) return;
    if (!runState.hasSeenScene("prologue")) {
      runState.markScene("prologue");
      const pro = prologuePages();
      if (pro) await this.playPrologue(pro);
      if (!stillHere()) return;
    }
    this.world.setLocked(true); // playCutscene unlocks on exit — re-assert for the card
    this.ui.showCard(`CHAPTER ${stage.index}`, stage.name, 1500);
    await this.delay(1500);
    if (!stillHere()) return;
    const intro = cutscenePages(stage.id, "intro");
    if (intro) await this.playCutscene(intro, { boss: [30, 15] });
    if (!stillHere()) return;
    this.world.setLocked(false); // hand control back (also covers a missing-intro chapter)
  }

  // The opening prologue — the three Seekers stand together at the ruins as the
  // narration plays (Kara + Zell staged beside Saka, the live hero).
  private async playPrologue(pages: DialogPage[]): Promise<void> {
    const [px, pz] = this.world.playerPos();
    let kara: CutsceneActor | undefined;
    let zell: CutsceneActor | undefined;
    await this.playCutscene(pages, {
      boss: [30, 15],
      ally: [px + 1.2, pz + 0.3],
      onStart: async () => {
        kara = this.world.addCutsceneActor(px + 1.2, pz + 0.3, "assets/sprites/heroes/kara/front.png");
        zell = this.world.addCutsceneActor(px + 2.4, pz + 0.1, "assets/sprites/heroes/zell/front.png");
        await this.world.cameraFocus(px + 1, pz, { dist: 8, height: 8.6, ms: 850 });
        await kara.hop();
      },
    });
    kara?.remove();
    zell?.remove();
  }

  private async playMidfield(stage: StageData): Promise<void> {
    const key = `midfield:${stage.id}`;
    if (runState.hasSeenScene(key)) return;
    runState.markScene(key);
    const pages = cutscenePages(stage.id, "midfield");
    if (pages) await this.playCutscene(pages, { boss: [30, 15] });
  }

  // Boss-gate interaction: the one-time pre-boss confrontation (camera pushes in
  // on the warden), then the fight begins.
  private async enterBossGate(stage: StageData): Promise<void> {
    const key = `preboss:${stage.id}`;
    if (!runState.hasSeenScene(key)) {
      const pages = cutscenePages(stage.id, "preboss");
      if (pages) {
        runState.markScene(key);
        await this.playCutscene(pages, {
          boss: [30, 15],
          onStart: async () => { await this.world.cameraFocus(30, 15, { dist: 7, height: 7.8, ms: 700 }); },
        });
      }
    }
    this.startBattle({ kind: "boss", enemyIds: [] });
  }

  // Chapter victory: the reflective outro exchange, then a "to be continued"
  // epilogue card, then advance to the next chapter on the world map.
  private async playOutro(stageId: string): Promise<void> {
    const stage = stages.find((s) => s.id === stageId) ?? runState.chapter;
    const outro = cutscenePages(stageId, "outro");
    if (outro) await this.playCutscene(outro, { boss: [30, 15] });
    const epi = cutscenePages(stageId, "epilogue");
    if (epi && !runState.hasSeenScene(`epilogue:${stageId}`)) {
      runState.markScene(`epilogue:${stageId}`);
      await this.ui.showEpilogue(`CHAPTER ${stage.index} · ${stage.name}`, epi.map((p) => p.text));
    }
    runState.advance();
    this.transition(() => this.goToWorld());
  }

  // ---- battle launch + return ------------------------------------------

  // Launches an optional superboss fight (a boss-type enemy as a one-off battle).
  private startOptionalBoss(enemyId: string, bgStage: string, reward: { quest: string; clearKey: string; gold: number; loot: string[]; lootText: string }): void {
    this.optionalReward = reward;
    this.startBattle({ kind: "mob", enemyIds: [enemyId] }, bgStage);
  }

  private startBattle(pending: PendingBattle, bgStageId?: string): void {
    runState.pendingBattle = pending;
    this.world.stop();
    this.world.setLocked(true);
    this.ui.setPrompt(null);
    this.ui.setCharButtonEnabled(false);
    this.ui.setVisible(false);
    this.battle = new Battle3D(this.world.renderer, this.mount, (r) => this.endBattle(r));
    void this.battle.begin(pending, bgStageId ?? this.currentStage);
  }

  private endBattle(r: BattleResult): void {
    this.battle?.dispose();
    this.battle = undefined;
    runState.pendingBattle = null;
    this.ui.setVisible(true);
    this.world.setLocked(false);
    this.world.start();
    this.ui.setCharButtonEnabled(true);
    // Optional superboss resolves to the world map (with a reward on victory).
    const opt = this.optionalReward;
    if (opt) {
      this.optionalReward = null;
      if (r.win) {
        runState.openChest(opt.clearKey); runState.completeQuest(opt.quest);
        runState.addGold(opt.gold); runState.addItems(opt.loot); this.syncGold();
        this.world.setLocked(true);
        this.ui.showDialog([{ text: opt.lootText }], () => { this.world.setLocked(false); this.transition(() => this.goToWorld()); });
      } else {
        this.transition(() => this.goToWorld());
      }
      return;
    }
    if (!r.win) { this.currentDungeonId = null; this.transition(() => this.goToWorld()); return; }
    if (this.currentDungeonId) {
      const id = this.currentDungeonId; // side-dungeon mob cleared — back to the dungeon
      this.transition(() => this.goToDungeon(id));
      return;
    }
    if (r.isBoss) {
      void this.playOutro(this.currentStage);
      return;
    }
    this.transition(() => this.goToField(this.currentStage)); // mob cleared — back to the dungeon
  }

  // ---- shop / pause / save / options -----------------------------------

  private openShop(title = "MERCHANT", stock: Stock = SHOP_STOCK): void {
    const items = (): MenuItem[] => {
      const rows: MenuItem[] = stock.map((s) => {
        const item = getItem(s.id);
        const gear = item?.equip ? statBonusText(item.equip.bonus) : "";
        return {
          label: item?.name ?? s.id,
          sub: `${gear ? gear + "  " : ""}${s.price} ◆`,
          disabled: runState.gold < s.price,
          onPick: () => {
            if (runState.spendGold(s.price)) {
              runState.addItems([s.id]);
              audio.playSfx("buy");
              this.syncGold();
            }
          },
        };
      });
      rows.push({ label: "Leave", onPick: () => this.ui.closeMenu() });
      return rows;
    };
    this.ui.openMenu(`${title} · ◆ ${runState.gold}`, items, () => this.ui.closeMenu());
  }

  // ---- floating character sheet (status + inline equip) -----------------

  // The always-available party sheet: full stats with gear contribution shown,
  // editable equip slots inline, and the hero's bio. Reached from the floating
  // button, the [P] key, or the pause menu's "Status & Equip".
  private openCharSheet(): void {
    if (this.ui.isModalOpen()) return;
    if (!characters.some((c) => c.id === this.sheetHeroId)) this.sheetHeroId = characters[0].id;
    this.ui.openSheet(this.charSheetHtml(), (root) => this.wireCharSheet(root), () => this.ui.closeSheet());
  }
  private refreshCharSheet(): void {
    this.ui.updateSheet(this.charSheetHtml(), (root) => this.wireCharSheet(root), () => this.ui.closeSheet());
  }

  private charSheetHtml(): string {
    const id = this.sheetHeroId;
    const c = characters.find((x) => x.id === id)!;
    const p = runState.party[id];
    const bonus = runState.equipBonus(id);
    const lvl = p?.level ?? 1;
    const className = cap(p?.classId ?? c.classId) + (p?.promoted ? " ★" : "");

    const tabs = characters.map((h) =>
      `<div class="tab ${h.id === id ? "on" : ""}" data-hero="${h.id}" style="--th:${h.themeColor}">${h.name}</div>`).join("");

    const cell = (key: keyof Stats, label: string): string => {
      const base = Math.round(p?.stats[key] ?? c.baseStats[key]);
      const b = bonus[key] ?? 0;
      const badge = b ? `<span class="bn ${b > 0 ? "up" : "dn"}">${b > 0 ? "+" : ""}${b}</span>` : "";
      return `<div class="st"><span class="k">${label}</span><span class="v">${base + b}${badge}</span></div>`;
    };

    const hpBase = Math.round(p?.stats.hp ?? c.baseStats.hp);
    const hpMax = hpBase + (bonus.hp ?? 0);
    const hpCur = Math.min(Math.round(p?.hp ?? hpMax), hpMax);
    const enMax = Math.round(p?.stats.energy ?? c.baseStats.energy) + (bonus.energy ?? 0);
    const vital =
      `<div class="st"><span class="k">HP</span><span class="v">${hpCur}<span class="slash">/</span>${hpMax}${bonus.hp ? `<span class="bn up">+${bonus.hp}</span>` : ""}</span></div>` +
      `<div class="st"><span class="k">EN</span><span class="v">${enMax}${bonus.energy ? `<span class="bn up">+${bonus.energy}</span>` : ""}</span></div>`;

    const grid = [cell("atk", "ATK"), cell("def", "DEF"), cell("mag", "MAG"), cell("res", "RES"), cell("spd", "SPD"), cell("move", "MOV")].join("");

    const slots: EquipSlot[] = ["weapon", "armor", "accessory"];
    const slotRows = slots.map((slot) => {
      const itId = runState.equippedId(id, slot);
      const it = itId ? getItem(itId) : undefined;
      const b = it?.equip ? statBonusText(it.equip.bonus) : "";
      return `<div class="slot" data-slot="${slot}"><span class="sl-k">${cap(slot)}</span>` +
        `<span class="sl-n">${it?.name ?? "— empty —"}</span><span class="sl-b">${b}</span><span class="sl-go">▸</span></div>`;
    }).join("");

    return `<div class="tabs">${tabs}</div>` +
      `<div class="hd"><img class="por" src="assets/portraits/${id}.png" alt="">` +
      `<div class="id"><div class="nm">${c.name}</div><div class="ti">${c.title}</div>` +
      `<div class="cl">Lv ${lvl} · ${className}</div><div class="af">Affinity · ${affinityLabel(c.affinity)}</div></div></div>` +
      `<div class="vit">${vital}</div><div class="grid">${grid}</div>` +
      `<div class="seclbl">EQUIPMENT</div><div class="slots">${slotRows}</div>` +
      `<div class="bio">${c.bio}</div>` +
      `<div class="ft">click a tab to switch hero · click a slot to change gear · [Esc] close</div>`;
  }

  private wireCharSheet(root: HTMLElement): void {
    const por = root.querySelector(".por") as HTMLImageElement | null;
    if (por) por.addEventListener("error", () => { por.style.visibility = "hidden"; });
    root.querySelectorAll(".tab").forEach((t) =>
      t.addEventListener("pointerdown", () => {
        const hero = (t as HTMLElement).dataset.hero;
        if (hero && hero !== this.sheetHeroId) { this.sheetHeroId = hero; audio.playSfx("move"); this.refreshCharSheet(); }
      }));
    root.querySelectorAll(".slot").forEach((s) =>
      s.addEventListener("pointerdown", () => this.openSheetPicker((s as HTMLElement).dataset.slot as EquipSlot)));
  }

  // Inline equip picker — a second "mode" of the same sheet panel (no new modal).
  private openSheetPicker(slot: EquipSlot): void {
    const id = this.sheetHeroId;
    this.ui.updateSheet(this.sheetPickerHtml(id, slot), (root) => {
      root.querySelectorAll(".pick").forEach((r) =>
        r.addEventListener("pointerdown", () => {
          const el = r as HTMLElement;
          if (el.classList.contains("dis")) return;
          const act = el.dataset.act;
          if (act === "back") { this.refreshCharSheet(); return; }
          if (act === "remove") { runState.unequip(id, slot); audio.playSfx("cancel"); this.refreshCharSheet(); return; }
          const itemId = el.dataset.item;
          if (itemId && runState.equip(id, itemId)) audio.playSfx("confirm");
          this.refreshCharSheet();
        }));
    }, () => this.refreshCharSheet()); // Esc / P backs out to the stats view
  }

  private sheetPickerHtml(id: string, slot: EquipSlot): string {
    const name = characters.find((c) => c.id === id)?.name ?? id;
    const curId = runState.equippedId(id, slot);
    const owned = runState.inventoryEntries()
      .map((e) => getItem(e.id))
      .filter((it): it is ItemData => !!it?.equip && it.equip.slot === slot && (!it.equip.user || it.equip.user === id));
    const rows = owned.map((it) => {
      const on = it.id === curId;
      return `<div class="pick${on ? " on" : ""}" data-item="${it.id}">` +
        `<span class="pk-n">${it.name}${on ? " ✓" : ""}</span><span class="pk-b">${statBonusText(it.equip!.bonus)}</span></div>`;
    }).join("");
    const removeRow = curId ? `<div class="pick" data-act="remove"><span class="pk-n">— Remove —</span><span class="pk-b">unequip</span></div>` : "";
    const empty = owned.length ? "" : `<div class="pick dis"><span class="pk-n">No ${slot} owned</span></div>`;
    const back = `<div class="pick" data-act="back"><span class="pk-n">← Back</span></div>`;
    return `<div class="tabs"><div class="tab on">${name} · ${cap(slot)}</div></div>` +
      `<div class="picklist">${removeRow}${rows}${empty}${back}</div>` +
      `<div class="ft">click to equip · [Esc] back</div>`;
  }

  // ---- bestiary ---------------------------------------------------------

  private openBestiary(onBack: () => void): void {
    this.ui.openMenu(`BESTIARY · ${runState.seenCount}/${enemies.length}`, () => [
      ...enemies.map((e) => runState.isSeen(e.id)
        ? {
          label: e.name, sub: e.kind === "boss" ? "BOSS" : `HP ${e.baseStats.hp}`,
          onPick: () => this.ui.showDialog([
            { speaker: e.name, text: e.description },
            { text: `HP ${e.baseStats.hp} · ATK ${e.baseStats.atk} · DEF ${e.baseStats.def} · MAG ${e.baseStats.mag} · RES ${e.baseStats.res} · SPD ${e.baseStats.spd}` },
          ]),
        } as MenuItem
        : { label: "???", sub: "unseen", disabled: true, onPick: () => {} } as MenuItem),
      { label: "← Back", onPick: onBack },
    ], onBack);
  }

  // ---- lore codex -------------------------------------------------------

  private openCodex(onBack: () => void): void {
    const reached = runState.stageIndex;
    // CHRONICLE entries are generated from stage + boss data so the codex always
    // matches the game; each chapter unlocks once the player has reached it.
    const chronicle: LoreEntry[] = stages.map((st, i) => {
      const boss = enemies.find((e) => e.id === st.bossId);
      return {
        id: `chronicle-${st.id}`,
        title: st.name,
        sub: `CH ${i + 1}`,
        minStage: i,
        pages: [
          { speaker: `Chapter ${i + 1}`, text: st.description },
          ...(boss ? [{ speaker: `Boss · ${boss.name}`, text: boss.description }] : []),
        ],
      };
    });
    // World + allies + figures first, then the chronicle, then the closing coda.
    const intro = LORE.filter((l) => l.sub !== "CODA");
    const coda = LORE.filter((l) => l.sub === "CODA");
    const all: LoreEntry[] = [...intro, ...chronicle, ...coda];
    const isOpen = (l: LoreEntry) => (l.minStage ?? 0) <= reached;
    const unlocked = all.filter(isOpen).length;
    this.ui.openMenu(`LORE CODEX · ${unlocked}/${all.length}`, () => [
      ...all.map((l) => isOpen(l)
        ? { label: l.title, sub: l.sub, onPick: () => this.ui.showDialog(l.pages) } as MenuItem
        : { label: "???", sub: "locked", disabled: true, onPick: () => {} } as MenuItem),
      { label: "← Back", onPick: onBack },
    ], onBack);
  }

  private openPause(): void {
    if (this.ui.isModalOpen()) return;
    this.ui.openMenu("PAUSE", () => [
      { label: "Status & Equip", onPick: () => { this.ui.closeMenu(); this.openCharSheet(); } },
      { label: "Lore Codex", onPick: () => this.openCodex(() => this.openPause()) },
      { label: "Bestiary", onPick: () => this.openBestiary(() => this.openPause()) },
      { label: "Save", onPick: () => this.openSave(() => this.openPause()) },
      { label: "Options", onPick: () => this.openOptions(() => this.openPause()) },
      { label: "Resume", onPick: () => this.ui.closeMenu() },
    ], () => this.ui.closeMenu());
  }

  private openSave(onBack: () => void): void {
    this.ui.openMenu("SAVE", () =>
      [...Array.from({ length: SLOT_COUNT }, (_, i) => {
        const info = slotInfo(i);
        return {
          label: `Slot ${i + 1}`,
          sub: info.exists ? `Ch ${info.chapter} · Lv ${info.partyLevel}` : "empty",
          onPick: () => { saveToSlot(i); audio.playSfx("confirm"); },
        } as MenuItem;
      }), { label: "← Back", onPick: onBack } as MenuItem], onBack);
  }

  private openOptions(onBack: () => void): void {
    const adj = (which: "m" | "s", d: number) => {
      if (which === "m") { this.musicVol = clamp01(this.musicVol + d); audio.setMusicVolume(this.musicVol); }
      else { this.sfxVol = clamp01(this.sfxVol + d); audio.setSfxVolume(this.sfxVol); audio.playSfx("move"); }
    };
    this.ui.openMenu("OPTIONS", () => [
      { label: "Music  −", sub: bar(this.musicVol), onPick: () => adj("m", -0.1) },
      { label: "Music  +", sub: bar(this.musicVol), onPick: () => adj("m", 0.1) },
      { label: "SFX  −", sub: bar(this.sfxVol), onPick: () => adj("s", -0.1) },
      { label: "SFX  +", sub: bar(this.sfxVol), onPick: () => adj("s", 0.1) },
      { label: "← Back", onPick: onBack },
    ], onBack);
  }
}

function clamp01(v: number): number { return Math.max(0, Math.min(1, Math.round(v * 10) / 10)); }
function bar(v: number): string { const n = Math.round(v * 10); return "█".repeat(n) + "░".repeat(10 - n); }
function cap(s: string): string { return s.split("-").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" "); }
function affinityLabel(e: string): string {
  return ({ "code-energy": "Code Energy", "code-tech": "Code Tech", "ai-core": "AI Core", physical: "Physical", neutral: "Neutral" } as Record<string, string>)[e] ?? cap(e);
}
