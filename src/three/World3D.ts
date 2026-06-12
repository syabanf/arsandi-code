import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { BokehPass } from "three/examples/jsm/postprocessing/BokehPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";

// ----------------------------------------------------------------------------
// World3D — the Three.js HD-2D exploration engine (foundation of the 3D rewrite).
// Renders any chapter/town/world Tiled map as a lit 3D voxel diorama with a
// billboarded pixel-sprite party, a 3/4 follow camera, dynamic lights + shadows,
// fog, a painted parallax backdrop, and a bloom + depth-of-field post stack.
// Hosts a marker system (NPCs / nodes / chests) with proximity interaction.
// ----------------------------------------------------------------------------

const BLOCKED = new Set([4, 5, 6]); // wall, water, rubble

// Shared vertical profile per tile gid (1..10): ground/path/floor are low slabs,
// walls rise, water sinks, rubble/crystal mid; sand sits flat, snow a soft layer.
// Only COLOURS change per theme.
const HEIGHTS: [number, number][] = [
  [-0.5, 0],     // 1 ground
  [-0.5, 0],     // 2 ground-alt
  [-0.45, 0.02], // 3 path
  [0, 1.45],     // 4 wall
  [-0.55, -0.18],// 5 water
  [0, 0.7],      // 6 rubble
  [-0.5, 0],     // 7 floor
  [0, 0.95],     // 8 crystal
  [-0.5, 0],     // 9 sand (desert flats)
  [-0.5, 0.03],  // 10 snow (a soft dusting layer)
];

interface Theme {
  c: number[];        // colours for gid 1..8 (world also defines 9 sand / 10 snow)
  fog: number; fogD: number;
  sky: [number, number, number];
  hemiSky: number; hemiGround: number; key: number;
  foliage?: boolean;  // render RUBBLE decor as tree billboards (overworld/town)
}

// A scripted actor handle the cutscene director uses to stage in-world motion.
// `walkTo`/`hop` return promises that resolve when the tween finishes.
export interface CutsceneActor {
  walkTo(tileX: number, tileY: number, ms: number): Promise<void>;
  setPos(tileX: number, tileY: number): void;
  hop(): Promise<void>;
  face(dir: "l" | "r"): void;
  remove(): void;
}

// Per-map environment theme — the world map reads as a green twilight overworld,
// town as warm stone, each dungeon with its own mood (rust rail, blue ocean,
// gold cathedral, crimson fortress, void finale, etc.).
const THEMES: Record<string, Theme> = {
  default: { c: [0x6f6aa0, 0x7d76b4, 0x9d8ad8, 0x8474c4, 0x4a86e0, 0x6f62a0, 0x5d5494, 0x9af0ff], fog: 0x171232, fogD: 0.011, sky: [0x1a1438, 0x120e26, 0x08060f], hemiSky: 0x8c84d0, hemiGround: 0x1a1530, key: 0xfff0d6 },
  world: { c: [0x4e7a52, 0x5c8a5e, 0x9a7a4a, 0x2e5a34, 0x3a72c8, 0x3e6a40, 0x4e7a52, 0x9af0ff, 0xd8bd7e, 0xe6f0f8], fog: 0x14241c, fogD: 0.009, sky: [0x2a3e3a, 0x16242a, 0x0a1014], hemiSky: 0xa6c08c, hemiGround: 0x18281c, key: 0xfff0d0, foliage: true },
  town: { c: [0x6a6488, 0x7a7498, 0xb0a070, 0x8a7a6a, 0x4a86c8, 0x6a6080, 0x5a5478, 0x9af0ff], fog: 0x18142e, fogD: 0.01, sky: [0x241c40, 0x16122a, 0x0a0814], hemiSky: 0x9a8cc0, hemiGround: 0x1c1630, key: 0xffe8c0, foliage: true },
  town2: { c: [0x86746a, 0x9a8470, 0xb89a6a, 0x8a7464, 0x4a86c8, 0x8a7460, 0x6a5a4a, 0xffd07a], fog: 0x20160e, fogD: 0.01, sky: [0x2e2014, 0x1c140c, 0x0e0a06], hemiSky: 0xd0b088, hemiGround: 0x221810, key: 0xffe0b0, foliage: true },
  "stage-1": { c: [0x6a5a72, 0x7a6a82, 0x8a7458, 0x7a5a6a, 0x4a70a0, 0x6a5560, 0x5a4a64, 0xff9a6a], fog: 0x1a1422, fogD: 0.012, sky: [0x241838, 0x160e24, 0x08060f], hemiSky: 0x9a86b0, hemiGround: 0x1a1320, key: 0xffe0c0 },
  "stage-2": { c: [0x4a4642, 0x5a544c, 0x6a5a4a, 0x6a5a50, 0x3a4a4a, 0x5a4a40, 0x3e3a36, 0xff5a5a], fog: 0x14120e, fogD: 0.014, sky: [0x2a221c, 0x161210, 0x080606], hemiSky: 0xb0a080, hemiGround: 0x181410, key: 0xffd0a0 },
  "stage-3": { c: [0x3a5a64, 0x46707a, 0x5a8a92, 0x4a7a84, 0x3aa0c0, 0x3a606a, 0x32545c, 0x80f0e0], fog: 0x0e1c20, fogD: 0.011, sky: [0x16343a, 0x0e2024, 0x061014], hemiSky: 0x84d0c8, hemiGround: 0x0e2024, key: 0xd0fff0 },
  "stage-4": { c: [0x2e4a8a, 0x3a5aa0, 0x4a6ab0, 0x3a5aa8, 0x3a90f0, 0x2e4a86, 0x26407a, 0x90d0ff], fog: 0x0a1430, fogD: 0.012, sky: [0x14245a, 0x0c1838, 0x060a1c], hemiSky: 0x88a8e0, hemiGround: 0x0c1838, key: 0xc8e4ff },
  "stage-5": { c: [0x5a4e7e, 0x6a5c90, 0xb09a5a, 0x9a7a4a, 0x6a86c0, 0x6a5a86, 0x4e4270, 0xfff0c0], fog: 0x1c1830, fogD: 0.01, sky: [0x2e2848, 0x1c1830, 0x0c0a18], hemiSky: 0xc0b0e0, hemiGround: 0x1c1830, key: 0xfff0d0 },
  "stage-6": { c: [0x5a3a5e, 0x6e4872, 0x8a5a80, 0x8a4a7a, 0x6a5ac0, 0x5a3a5a, 0x4a324e, 0xff80d0], fog: 0x1c1024, fogD: 0.012, sky: [0x301a36, 0x1c1024, 0x0c0814], hemiSky: 0xc88cd0, hemiGround: 0x1c1024, key: 0xffd0f0 },
  "stage-7": { c: [0x3a2e3a, 0x4a3a44, 0x5a4450, 0x6a3a44, 0x4a3050, 0x4a3640, 0x2e242e, 0xff5a6a], fog: 0x140a10, fogD: 0.014, sky: [0x281018, 0x160a10, 0x080406], hemiSky: 0xc08890, hemiGround: 0x180a10, key: 0xffc0c0 },
  "stage-finale": { c: [0x3a2e5e, 0x4a3a72, 0x6a4a9a, 0x5a3a8a, 0x6a5ad0, 0x4a3a72, 0x2e2450, 0xc090ff], fog: 0x10081e, fogD: 0.013, sky: [0x241046, 0x160a2c, 0x0a0518], hemiSky: 0xb088e0, hemiGround: 0x160a2c, key: 0xe0c0ff },
  cave: { c: [0x4a4640, 0x5a564c, 0x6a6258, 0x5a5248, 0x3a6a8a, 0x4a4238, 0x3a362e, 0x9af0ff], fog: 0x100c0e, fogD: 0.015, sky: [0x1e1814, 0x12100e, 0x060504], hemiSky: 0xb0a088, hemiGround: 0x141008, key: 0xffe0b0 },
  vault: { c: [0x2e3a5a, 0x3a4a70, 0x4a5e8a, 0x3a4a7a, 0x3a90c0, 0x2e3a56, 0x26304a, 0x80f0ff], fog: 0x0a0e1c, fogD: 0.012, sky: [0x142040, 0x0c1428, 0x060a16], hemiSky: 0x88b0e0, hemiGround: 0x0c1428, key: 0xc8f0ff },
  training: { c: [0x3e6a3e, 0x4e7a4a, 0x9ac060, 0x3a5a34, 0x3a72c8, 0x4e7a40, 0x4a6a44, 0x9aff9e], fog: 0x142410, fogD: 0.009, sky: [0x2a3e2a, 0x162410, 0x0a1408], hemiSky: 0xa6d08c, hemiGround: 0x182810, key: 0xfff0d0, foliage: true },
  spire: { c: [0x342c52, 0x423a66, 0x6a5a9a, 0x3e3266, 0x4a5ac0, 0x40345e, 0x2a2448, 0xb088ff], fog: 0x0a0818, fogD: 0.014, sky: [0x1e1640, 0x120c28, 0x070414], hemiSky: 0xa088e0, hemiGround: 0x140c2c, key: 0xd8c0ff },
  frost: { c: [0x7890a8, 0x90a4bc, 0xb4c8dc, 0x7088aa, 0x6eaadc, 0x8296b0, 0x6278a0, 0xc8f4ff], fog: 0x12202c, fogD: 0.012, sky: [0x223644, 0x142430, 0x0a141c], hemiSky: 0xbcd8ec, hemiGround: 0x16242e, key: 0xe6f4ff },
  forge: { c: [0x60382c, 0x784632, 0xa06038, 0x6e3c2e, 0xc85a32, 0x6e4030, 0x4a2c26, 0xff964a], fog: 0x1c0c08, fogD: 0.014, sky: [0x3a160c, 0x200c08, 0x0e0604], hemiSky: 0xe0a070, hemiGround: 0x1c0e08, key: 0xffb060 },
  archive: { c: [0x285054, 0x326260, 0x467874, 0x305c5c, 0x289ca0, 0x346060, 0x224044, 0x60f0dc], fog: 0x081c1e, fogD: 0.013, sky: [0x123034, 0x0c2024, 0x061214], hemiSky: 0x84d8d0, hemiGround: 0x0c2024, key: 0xc8fff4 },
};

// Filmic colour grade — contrast curve, richer saturation, warm highlight lift.
// Gives the deep, painterly Octopath-style look.
export const GRADE = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    contrast: { value: 1.1 },
    saturation: { value: 1.16 },
    tint: { value: new THREE.Vector3(1.04, 1.0, 0.94) },
    lift: { value: 0.018 },
  },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float contrast; uniform float saturation; uniform vec3 tint; uniform float lift;
    varying vec2 vUv;
    void main(){
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      c = (c - 0.5) * contrast + 0.5 + lift;          // contrast + shadow lift
      float l = dot(c, vec3(0.299, 0.587, 0.114));
      c = mix(vec3(l), c, saturation);                 // saturation
      c *= tint;                                       // warm tint
      gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
    }`,
};

// Cinematic edge-darkening pass — subtle, keeps focus on the party centre.
export const VIGNETTE = {
  uniforms: { tDiffuse: { value: null as THREE.Texture | null }, offset: { value: 1.1 }, darkness: { value: 1.0 } },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float offset; uniform float darkness; varying vec2 vUv;
    void main(){
      vec4 c = texture2D(tDiffuse, vUv);
      vec2 uv = (vUv - 0.5) * offset;
      float v = clamp(1.0 - dot(uv, uv) * darkness, 0.0, 1.0);
      c.rgb *= mix(1.0, smoothstep(0.0, 1.0, v), 0.55);
      gl_FragColor = c;
    }`,
};

export type PlaceKind = "town" | "gate" | "cave" | "vault" | "boss" | "back" | "arena" | "spire";
export type PropKind = "crate" | "barrel" | "banner" | "bones" | "debris";

// Liberated Pixel Cup (CC-BY-SA) character sheet layout: 64px frames, 13x21
// grid; walk animation is rows 8-11 (up/left/down/right), 9 frames each.
export const LPC = { frame: 64, cols: 13, rows: 21, walkDownRow: 10, walkFrames: 8 };
export const LPC_IDS = new Set(["saka", "kara", "zell", "npc-merchant", "npc-elder", "npc-villager", "npc-guard"]);
export const lpcOffset = (col: number, row: number): [number, number] => [col / LPC.cols, 1 - (row + 1) / LPC.rows];

// Project-owned hero sheets (Saka / Kara / Zell, AI-generated by the project
// author). Sliced into per-state strips by tools/heroes.mjs. Each idle/walk
// strip has the same per-character height (so swapping textures on the same
// mesh doesn't cause the figure to grow/shrink) and 9 frames horizontally.
export const HERO_IDS = new Set(["saka", "kara", "zell"]);
export const HERO_FRAMES = 9;

// Smooth ease for cinematic camera/actor tweens (cubic in-out).
function easeInOut(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

export interface Marker {
  x: number;
  y: number;
  radius: number;
  label: string;
  onInteract: () => void;
  sprite: THREE.Object3D;
}

// A field encounter that moves: it wanders near its spawn point and, when the
// player comes within aggro range, gives chase — starting its battle the moment
// it makes contact. Its marker is also registered for normal [E] interaction.
// Roamers freeze during cutscenes and while the world is locked.
interface Roamer {
  mk: Marker;             // billboard marker (also pushed into `markers`)
  label: THREE.Sprite;    // floating name label (tracks x/z; y handled by float)
  shadow: THREE.Object3D; // blob shadow
  baseW: number;          // sprite width, for left/right facing flip
  spawnX: number;
  spawnZ: number;
  x: number; // continuous position (the marker's x/y are synced from these)
  z: number;
  tx: number; // current wander target
  tz: number;
  wait: number; // countdown to pick a new wander target
  flipL: boolean;
  phase: number; // walk-bob phase offset
  fired: boolean;
  trigger: () => void; // idempotent battle start
}

interface TileLayer { name: string; data: number[]; width: number; height: number; }

export class World3D {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  private composer!: EffectComposer;
  private bokeh!: BokehPass;

  private worldGroup = new THREE.Group();
  private markers: Marker[] = [];
  private W = 0;
  private H = 0;
  private decor: number[] = [];

  private player!: THREE.Mesh;
  private playerGlow!: THREE.Sprite;
  private shadow!: THREE.Mesh;
  private playerLight!: THREE.PointLight;
  private hemi!: THREE.HemisphereLight;
  private keyLight!: THREE.DirectionalLight;
  private playerTex?: THREE.Texture;
  private texCache = new Map<string, Promise<THREE.Texture>>();

  // atmosphere + living-glow polish
  private motes?: THREE.Points;
  private moteSpeeds!: Float32Array;
  private crystalMat?: THREE.MeshStandardMaterial;
  private crystalLights: THREE.PointLight[] = [];

  // character animation + props + effects
  private walkT = 0;
  private playerLpc = false;
  private playerHero = false;            // using project-owned hero sheets (saka/kara/zell)
  private heroIdleTex?: THREE.Texture;   // multi-frame strip (9 frames @ HERO_FRAMES)
  private heroWalkTex?: THREE.Texture;   // multi-frame strip (9 frames @ HERO_FRAMES)
  private heroPlayerFlipL = false;       // mirror horizontally when facing left
  private mounted = false;
  private canMount = false;
  private mountSprite?: THREE.Sprite;
  private _chocoboTex?: THREE.Texture;
  private dust: { spr: THREE.Sprite; t: number }[] = [];
  private dustClock = 0;
  private buildingLights: { light: THREE.PointLight; base: number; phase: number }[] = [];
  private propBlocked = new Set<string>();
  private _blobTex?: THREE.Texture;
  private _treeTex: THREE.Texture[] = [];
  private _dustTex?: THREE.Texture;
  private sheetTex = new Set<THREE.Texture>(); // 2-frame idle sheets to animate

  private px = 3;
  private pz = 15;
  private keys = new Set<string>();
  private locked = false;
  private clockT = 0;
  private last = 0;
  private running = false;

  // cinematic staging: when on, the follow camera is suspended and the camera /
  // actors are driven by scripted tweens from the cutscene director.
  private cinematic = false;
  private camLook = new THREE.Vector3(3, 0.6, 14); // current look target (kept synced)
  private cinePrevPx = 3;
  private cinePrevPz = 15;
  private shakeT = 0;
  private shakeDur = 0;
  private shakeMag = 0;
  private tweens: { t: number; dur: number; step: (k: number) => void; done: () => void }[] = [];
  private actors: THREE.Sprite[] = [];
  private triggers: { x: number; z: number; r: number; fired: boolean; onEnter: () => void }[] = [];
  private roamers: Roamer[] = [];
  // Bumped on every map load (clearWorld). A fire-and-forget cutscene coroutine
  // captures this at start and bails if it changes, so a scene change can never
  // leave a cutscene playing over the wrong scene.
  sceneToken = 0;
  // Analog movement from the on-screen joystick (touch). Folded into the same
  // movement path as the keyboard each frame; magnitude scales walk speed.
  private touchVec = { x: 0, z: 0 };

  // hooks set by the orchestrator
  onInteractHint: (label: string | null) => void = () => {};
  onMenuKey: () => void = () => {};

  constructor(private mount: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    this.renderer.setSize(mount.clientWidth || window.innerWidth, mount.clientHeight || window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.5;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    mount.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(46, this.aspect(), 0.1, 400);
    this.scene.background = this.makeSky(THEMES.default.sky);
    this.scene.fog = new THREE.FogExp2(THEMES.default.fog, THEMES.default.fogD);
    this.scene.add(this.worldGroup);

    this.buildStaticLights();
    this.buildAtmosphere();
    this.buildPostFX();
    this.bindInput();
  }

  private aspect(): number {
    const s = this.renderer.getSize(new THREE.Vector2());
    return s.x / s.y;
  }

  // ---- scene-level (persistent) lights + player ------------------------

  private buildStaticLights(): void {
    this.hemi = new THREE.HemisphereLight(0x8c84d0, 0x1a1530, 1.5);
    this.scene.add(this.hemi);
    this.scene.add(new THREE.AmbientLight(0x46426a, 0.7));
    this.keyLight = new THREE.DirectionalLight(0xfff0d6, 1.9);
    this.keyLight.position.set(40, 50, 26);
    this.keyLight.castShadow = true;
    this.keyLight.shadow.mapSize.set(2048, 2048);
    const c = this.keyLight.shadow.camera as THREE.OrthographicCamera;
    c.left = -60; c.right = 60; c.top = 60; c.bottom = -60; c.near = 1; c.far = 180;
    this.keyLight.shadow.bias = -0.0006;
    this.scene.add(this.keyLight, this.keyLight.target);
    this.playerLight = new THREE.PointLight(0xffce8c, 9, 16, 2);
    this.scene.add(this.playerLight);
  }

  // A persistent cloud of slow-drifting motes (dust / embers / data fireflies)
  // that fills the diorama with depth. Theme-tinted via applyTheme.
  private buildAtmosphere(): void {
    const N = 240;
    const pos = new Float32Array(N * 3);
    this.moteSpeeds = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      pos[i * 3] = Math.random() * 42 - 1;
      pos[i * 3 + 1] = 0.4 + Math.random() * 8.5;
      pos[i * 3 + 2] = Math.random() * 32 - 1;
      this.moteSpeeds[i] = 0.12 + Math.random() * 0.4;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({
      map: this.makeMote(), color: 0x9af0ff, size: 0.18, sizeAttenuation: true,
      transparent: true, opacity: 0.45, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.motes = new THREE.Points(geo, mat);
    this.motes.frustumCulled = false;
    this.scene.add(this.motes);
  }

  private applyTheme(mapId: string): Theme {
    const th = THEMES[mapId] ?? THEMES.default;
    this.scene.background = this.makeSky(th.sky);
    (this.scene.fog as THREE.FogExp2).color.setHex(th.fog);
    (this.scene.fog as THREE.FogExp2).density = th.fogD;
    this.hemi.color.setHex(th.hemiSky);
    this.hemi.groundColor.setHex(th.hemiGround);
    this.keyLight.color.setHex(th.key);
    if (this.motes) (this.motes.material as THREE.PointsMaterial).color.setHex(th.c[7]);
    return th;
  }

  loadTex(url: string): Promise<THREE.Texture> {
    let p = this.texCache.get(url);
    if (!p) {
      p = new THREE.TextureLoader().loadAsync(url).then((t) => {
        t.magFilter = THREE.NearestFilter;
        t.minFilter = THREE.NearestFilter;
        t.colorSpace = THREE.SRGBColorSpace;
        return t;
      });
      this.texCache.set(url, p);
    }
    return p;
  }

  private async ensurePlayer(): Promise<void> {
    if (this.player) return;
    // Tries the project-owned hero sheets first (Saka idle/walk strips, 9 frames each),
    // falls back to the LPC humanoid, then to the procedural sprite as a last resort.
    let h = 2.0;
    let aspect = 1;
    try {
      this.heroIdleTex = await this.loadTex("assets/sprites/heroes/saka/idle.png");
      this.heroWalkTex = await this.loadTex("assets/sprites/heroes/saka/walk.png");
      this.heroIdleTex.repeat.set(1 / HERO_FRAMES, 1);
      this.heroIdleTex.offset.set(0, 0);
      this.heroWalkTex.repeat.set(1 / HERO_FRAMES, 1);
      this.heroWalkTex.offset.set(0, 0);
      this.playerTex = this.heroIdleTex;
      this.playerHero = true;
      h = 2.2; // hero sheets are crisper at a slightly larger height
      const img = this.heroIdleTex.image as HTMLImageElement;
      // per-frame aspect = (stripW / frames) / stripH
      aspect = (img.width / HERO_FRAMES) / img.height;
    } catch {
      try {
        this.playerTex = await this.loadTex("assets/sprites/lpc/saka.png");
        this.playerLpc = true;
        this.playerTex.repeat.set(1 / LPC.cols, 1 / LPC.rows);
        this.playerTex.offset.set(...lpcOffset(0, LPC.walkDownRow));
        aspect = 1;
      } catch {
        this.playerTex = await this.loadTex("assets/sprites/saka.png");
        this.playerLpc = false;
        h = 1.7;
        const img = this.playerTex.image as HTMLImageElement;
        aspect = img.width / img.height;
      }
    }
    const geo = new THREE.PlaneGeometry(h * aspect, h);
    // bottom-anchor (LPC has ~6% ground padding inside its frame; hero strips are already tight)
    geo.translate(0, h / 2 - (this.playerLpc ? h * 0.06 : 0), 0);
    this.player = new THREE.Mesh(
      geo,
      // A vertical billboard lit by lights above/around it goes nearly black in
      // the dim dungeon/night themes, swallowing the painted detail. Give it a
      // self-lit floor via an emissive map (the sprite's own art) so the hero
      // stays readable everywhere, while scene lights still add modeling on top.
      new THREE.MeshStandardMaterial({
        map: this.playerTex, emissive: 0xffffff, emissiveMap: this.playerTex, emissiveIntensity: 0.55,
        transparent: true, alphaTest: 0.4, roughness: 1, side: THREE.DoubleSide,
      }),
    );
    this.player.castShadow = true;
    this.scene.add(this.player);
    // soft rim/back glow so the hero pops off the diorama
    this.playerGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glowTex(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, color: 0xffe2a8, opacity: 0.4 }));
    this.playerGlow.center.set(0.5, 0);
    this.playerGlow.scale.set(h * 1.5, h * 1.2, 1);
    this.scene.add(this.playerGlow);
    this.shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(1.4, 1.4),
      new THREE.MeshBasicMaterial({ map: this.makeBlob(), transparent: true, depthWrite: false, opacity: 0.5 }),
    );
    this.shadow.rotation.x = -Math.PI / 2;
    this.scene.add(this.shadow);
    // chocobo mount (hidden until summoned on the world map)
    const ctex = this.chocoboTex();
    const cimg = ctex.image as HTMLImageElement;
    this.mountSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: ctex, transparent: true, depthWrite: false }));
    this.mountSprite.scale.set(1.5 * (cimg.width / cimg.height), 1.5, 1);
    this.mountSprite.center.set(0.5, 0);
    this.mountSprite.visible = false;
    this.scene.add(this.mountSprite);
  }

  // ---- chocobo mount ----------------------------------------------------
  setCanMount(v: boolean): void { this.canMount = v; if (!v) this.setMounted(false); }
  isMounted(): boolean { return this.mounted; }
  private setMounted(v: boolean): void {
    this.mounted = v;
    if (this.mountSprite) this.mountSprite.visible = v;
  }

  // ---- map loading ------------------------------------------------------

  async loadMap(mapId: string): Promise<void> {
    await this.ensurePlayer();
    this.clearWorld();
    const map = await (await fetch(`assets/maps/${mapId}.tmj`)).json();
    const layers: TileLayer[] = map.layers.filter((l: { type: string }) => l.type === "tilelayer");
    const ground = layers.find((l) => l.name === "ground")!;
    const decor = layers.find((l) => l.name === "decor")!;
    this.W = map.width; this.H = map.height; this.decor = decor.data;
    const spawn = (map.layers.find((l: { type: string }) => l.type === "objectgroup")?.objects ?? [])
      .find((o: { name: string }) => o.name === "spawn") as { x: number; y: number } | undefined;
    const ts = map.tilewidth || 16;
    this.px = spawn ? spawn.x / ts : 3;
    this.pz = spawn ? spawn.y / ts : 15;
    const th = this.applyTheme(mapId);
    this.buildTiles(ground.data, decor.data, th);
    this.buildParallax(th);
    this.placePlayer();
    await this.buildBackdrop(mapId);
  }

  private buildParallax(th: Theme): void {
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(200, 56),
      new THREE.MeshBasicMaterial({ map: this.ridgeTex(th), transparent: true, depthWrite: false, fog: false }),
    );
    mesh.name = "parallax";
    this.worldGroup.add(mesh);
  }

  spawnAt(tileX: number, tileY: number): void {
    this.px = tileX; this.pz = tileY; this.placePlayer();
  }

  private clearWorld(): void {
    this.markers = [];
    this.roamers = [];
    // Drop any in-flight cinematic state so a fresh map starts clean. Resetting
    // `locked` guarantees a newly loaded scene is never stuck locked by an
    // interrupted cutscene; bumping sceneToken lets any in-flight cutscene
    // coroutine notice its scene is gone and abort.
    this.cinematic = false;
    this.locked = false;
    this.sceneToken++;
    this.tweens.length = 0;
    this.actors.length = 0;
    this.triggers.length = 0;
    this.shakeT = 0;
    this.crystalMat = undefined;
    this.crystalLights = [];
    this.buildingLights = [];
    this.dust = [];
    this.propBlocked.clear();
    this.sheetTex.clear();
    this.worldGroup.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      const mat = (mesh as unknown as { material?: THREE.Material | THREE.Material[] }).material;
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
      else if (mat) mat.dispose();
    });
    this.worldGroup.clear();
  }

  private buildTiles(ground: number[], decor: number[], th: Theme): void {
    const box = new THREE.BoxGeometry(1, 1, 1);
    const emis = new THREE.MeshStandardMaterial({ roughness: 0.4, emissive: th.c[7], emissiveIntensity: 1.5 });
    this.crystalMat = emis;

    // Bucket every tile by gid so each surface type gets its own pixel-art texture
    // (grass / path / brick / water / rubble / floor), tinted by the map theme.
    const groundByGid = new Map<number, [number, number][]>();
    const decorByGid = new Map<number, [number, number][]>();
    const push = (mp: Map<number, [number, number][]>, gid: number, x: number, z: number) => {
      let a = mp.get(gid); if (!a) { a = []; mp.set(gid, a); } a.push([x, z]);
    };
    for (let z = 0; z < this.H; z++) for (let x = 0; x < this.W; x++) push(groundByGid, ground[z * this.W + x] || 1, x, z);

    const crystalCells: number[] = [];
    const treeCells: number[] = [];
    for (let i = 0; i < decor.length; i++) {
      const g = decor[i]; if (!g) continue;
      if (g === 8) crystalCells.push(i);
      else if (th.foliage && g === 6) treeCells.push(i); // rubble -> tree on overworld/town
      else push(decorByGid, g, i % this.W, Math.floor(i / this.W));
    }
    // Ground: split each kind into VAR texture variants (by deterministic tile
    // hash) so neighbouring tiles differ; tiles butt seamlessly edge-to-edge.
    const VAR = 3;
    for (const [gid, cells] of groundByGid) {
      const buckets: [number, number][][] = [[], [], []];
      for (const [x, z] of cells) buckets[(x * 7 + z * 13) % VAR].push([x, z]);
      buckets.forEach((bk, v) => this.buildGidMesh(box, gid, bk, th, false, v, true));
    }
    for (const [gid, cells] of decorByGid) this.buildGidMesh(box, gid, cells, th, true);

    if (treeCells.length) this.buildTrees(treeCells);
    if (th.foliage) this.buildTerrainProps(ground, decor);

    const m = new THREE.Matrix4();
    if (crystalCells.length) {
      const cm = new THREE.InstancedMesh(box, emis, crystalCells.length);
      crystalCells.forEach((i, k) => {
        m.compose(new THREE.Vector3(i % this.W, 0.45, Math.floor(i / this.W)), new THREE.Quaternion(), new THREE.Vector3(0.5, 0.9, 0.5));
        cm.setMatrixAt(k, m);
      });
      cm.instanceMatrix.needsUpdate = true;
      this.worldGroup.add(cm);
      const step = Math.max(1, Math.floor(crystalCells.length / 4));
      for (let k = 0; k < crystalCells.length; k += step) {
        const i = crystalCells[k];
        const light = new THREE.PointLight(th.c[7], 5, 8, 2);
        light.position.set(i % this.W, 0.8, Math.floor(i / this.W));
        this.worldGroup.add(light);
        this.crystalLights.push(light);
      }
    }
  }

  // One textured InstancedMesh for all tiles of a given gid (+ texture variant).
  // `seamless` ground tiles butt edge-to-edge (scale 1.0); raised decor keeps a
  // small gap (0.98) so individual blocks still read.
  private buildGidMesh(box: THREE.BoxGeometry, gid: number, cells: [number, number][], th: Theme, castShadow: boolean, variant = 0, seamless = false): void {
    if (!cells.length) return;
    const [b, t] = HEIGHTS[gid - 1] ?? HEIGHTS[0];
    const water = gid === 5;
    const mat = new THREE.MeshStandardMaterial({
      map: this.surfaceTex(gid, variant),
      color: new THREE.Color(th.c[gid - 1] ?? th.c[0]),
      roughness: water ? 0.35 : 0.92,
      metalness: water ? 0.4 : 0.04,
    });
    const mesh = new THREE.InstancedMesh(box, mat, cells.length);
    mesh.receiveShadow = true; mesh.castShadow = castShadow;
    const sc = seamless ? 1.0 : 0.98;
    const m = new THREE.Matrix4(); const q = new THREE.Quaternion(); const s = new THREE.Vector3(sc, t - b, sc);
    const p = new THREE.Vector3();
    cells.forEach(([x, z], k) => { p.set(x, (b + t) / 2, z); m.compose(p, q, s); mesh.setMatrixAt(k, m); });
    mesh.instanceMatrix.needsUpdate = true;
    this.worldGroup.add(mesh);
  }

  // Cached pixel-art surface texture per tile kind + variant (grayscale; tinted
  // by theme). Variants give neighbouring tiles of the same kind subtly different
  // detail, so large fields stop reading as one repeated tile.
  private _surf = new Map<number, THREE.Texture>();
  private surfaceTex(gid: number, variant = 0): THREE.Texture {
    const key = gid * 16 + variant;
    const cached = this._surf.get(key); if (cached) return cached;
    const S = 64, c = document.createElement("canvas"); c.width = S; c.height = S;
    const x = c.getContext("2d")!; x.imageSmoothingEnabled = false;
    const g = (v: number) => `rgb(${v | 0},${v | 0},${v | 0})`;
    const px = (lx: number, ly: number, w: number, h: number, v: number) => { x.fillStyle = g(v); x.fillRect(lx | 0, ly | 0, w, h); };
    const disc = (cx: number, cy: number, r: number, v: number) => { x.fillStyle = g(v); x.beginPath(); x.arc(cx, cy, r, 0, Math.PI * 2); x.fill(); };
    const rnd = (() => { let s = gid * 9871 + 13 + variant * 7919; return () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; }; })();
    const ph = variant * 2.1; // per-variant phase offset for wave patterns
    if (gid === 4) { // brick wall — courses of bricks with mortar + grime
      px(0, 0, S, S, 188);
      for (let row = 0; row < S; row += 16) { px(0, row, S, 2, 120); const off = (row / 16) % 2 ? 16 : 0; for (let bx = off; bx < S; bx += 32) px(bx, row, 2, 16, 120); }
      for (let i = 0; i < 80; i++) px((rnd() * S) | 0, (rnd() * S) | 0, 1, 1, 150 + ((rnd() * 60) | 0));
    } else if (gid === 5) { // water — depth gradient, layered ripples, specular band + foam glints
      const wg = x.createLinearGradient(0, 0, 0, S); wg.addColorStop(0, "#9498ac"); wg.addColorStop(1, "#e2e8f4");
      x.fillStyle = wg; x.fillRect(0, 0, S, S);
      for (let row = 0; row < S; row += 8) for (let bx = 0; bx < S; bx++) { const yy = row + Math.sin(bx * 0.4 + ph) * 2 + Math.sin(bx * 0.13 + ph * 2) * 3; px(bx, yy, 1, 2, 236); }
      for (let row = 4; row < S; row += 12) for (let bx = 0; bx < S; bx += 2) { const yy = row + Math.sin(bx * 0.22 + ph + 1.5) * 2.5; px(bx, yy, 1, 1, 176); }
      for (let bx = 0; bx < S; bx++) { const yy = 17 + Math.sin(bx * 0.16 + ph) * 5; px(bx, yy, 1, 1, 255); } // bright specular band
      for (let i = 0; i < 26; i++) px((rnd() * S) | 0, (rnd() * S) | 0, 1, 1, 255);
    } else if (gid === 6) { // rock / rubble — angular facets with lit edges + cracks
      px(0, 0, S, S, 150);
      for (let i = 0; i < 22; i++) { const bx = (rnd() * (S - 16)) | 0, by = (rnd() * (S - 16)) | 0, w = 8 + ((rnd() * 12) | 0), h = 8 + ((rnd() * 10) | 0); px(bx, by, w, h, 110 + ((rnd() * 40) | 0)); px(bx, by, w, 2, 205); px(bx, by, 2, h, 195); px(bx, by + h - 2, w, 2, 92); }
      for (let i = 0; i < 8; i++) px((rnd() * S) | 0, (rnd() * S) | 0, 1 + ((rnd() * 10) | 0), 1, 90);
    } else if (gid === 7) { // tech floor panels — recessed seams w/ glow edge + inset panels + rivets
      px(0, 0, S, S, 200);
      for (let q = 0; q <= S; q += S / 2) { px(0, q, S, 2, 110); px(0, q + 2, S, 1, 248); px(q, 0, 2, S, 110); px(q + 2, 0, 1, S, 248); }
      for (const [ox, oy] of [[0, 0], [S / 2, 0], [0, S / 2], [S / 2, S / 2]] as [number, number][]) { x.strokeStyle = g(168); x.lineWidth = 1; x.strokeRect(ox + 5.5, oy + 5.5, S / 2 - 11, S / 2 - 11); }
      for (const [rx, ry] of [[3, 3], [S - 6, 3], [3, S - 6], [S - 6, S - 6], [S / 2 - 2, S / 2 - 2]] as [number, number][]) { px(rx, ry, 3, 3, 110); px(rx, ry, 2, 2, 250); }
    } else if (gid === 3) { // path — packed cobbles with contact shadows + lit crowns
      px(0, 0, S, S, 150);
      for (let gy = 3; gy < S; gy += 11) for (let gx = 3 + ((gy / 11) % 2 ? 5 : 0); gx < S; gx += 11) { const r = 4 + ((rnd() * 2) | 0); disc(gx, gy + 1, r, 120); disc(gx, gy, r, 206 + ((rnd() * 18) | 0)); disc(gx - 1, gy - 1, r * 0.55, 250); }
      for (let i = 0; i < 40; i++) px((rnd() * S) | 0, (rnd() * S) | 0, 1, 1, 150 + ((rnd() * 60) | 0));
    } else if (gid === 9) { // sand — twin dune ripples + scattered pebbles
      px(0, 0, S, S, 210);
      for (let row = 6; row < S; row += 11) for (let bx = 0; bx < S; bx++) { const yy = row + Math.sin((bx + ph * 8) * 0.18) * 3 + Math.sin(bx * 0.5 + ph) * 1.2; px(bx, yy, 1, 2, 184); px(bx, yy + 2, 1, 1, 226); }
      for (let i = 0; i < 120; i++) px((rnd() * S) | 0, (rnd() * S) | 0, 1, 1, rnd() < 0.5 ? 168 : 242);
      for (let i = 0; i < 6; i++) disc((rnd() * S) | 0, (rnd() * S) | 0, 1 + ((rnd() * 2) | 0), rnd() < 0.5 ? 158 : 236);
    } else if (gid === 10) { // snow — soft drifts + sparkle + faint dimples
      px(0, 0, S, S, 236);
      for (let i = 0; i < 10; i++) disc((rnd() * S) | 0, (rnd() * S) | 0, 6 + ((rnd() * 10) | 0), 246);
      for (let i = 0; i < 14; i++) disc((rnd() * S) | 0, (rnd() * S) | 0, 2 + ((rnd() * 4) | 0), 210);
      for (let i = 0; i < 70; i++) px((rnd() * S) | 0, (rnd() * S) | 0, 1, 1, 255);
    } else { // grass (gid 1/2) — dirt clearings, dense blade clusters, sunlit tips, pebbles
      px(0, 0, S, S, 202);
      for (let i = 0; i < 4; i++) disc((rnd() * S) | 0, (rnd() * S) | 0, 6 + ((rnd() * 8) | 0), 168);
      for (let i = 0; i < 5; i++) disc((rnd() * S) | 0, (rnd() * S) | 0, 3 + ((rnd() * 4) | 0), 178);
      for (let i = 0; i < 240; i++) { const bx = (rnd() * S) | 0, by = (rnd() * S) | 0; const v = rnd() < 0.5 ? 150 : 246; px(bx, by, 1, rnd() < 0.4 ? 3 : 2, v); }
      for (let i = 0; i < 18; i++) { const bx = (rnd() * S) | 0, by = (rnd() * S) | 0; px(bx, by, 1, 1, 255); px(bx, by + 1, 1, 1, 230); }
      for (let i = 0; i < 10; i++) disc((rnd() * S) | 0, (rnd() * S) | 0, 1 + ((rnd() * 2) | 0), 226);
    }
    if (gid === 4 || gid === 6) { // solid block: bevel highlight/shadow + corner ambient occlusion
      x.fillStyle = "rgba(255,255,255,0.16)"; x.fillRect(0, 0, S, 3); x.fillRect(0, 0, 3, S);
      x.fillStyle = "rgba(0,0,0,0.30)"; x.fillRect(0, S - 3, S, 3); x.fillRect(S - 3, 0, 3, S);
      const ao = x.createRadialGradient(S / 2, S / 2, S * 0.18, S / 2, S / 2, S * 0.74); ao.addColorStop(0, "rgba(0,0,0,0)"); ao.addColorStop(1, "rgba(0,0,0,0.34)"); x.fillStyle = ao; x.fillRect(0, 0, S, S);
    } else if (gid === 5) { // water: gentle edge darkening only (no bevel — would seam)
      const ao = x.createRadialGradient(S / 2, S / 2, S * 0.25, S / 2, S / 2, S * 0.78); ao.addColorStop(0, "rgba(0,0,0,0)"); ao.addColorStop(1, "rgba(0,0,0,0.22)"); x.fillStyle = ao; x.fillRect(0, 0, S, S);
    } else { // seamless ground: radially-symmetric pooled light (equal at all 4 edges → no seam)
      const pool = x.createRadialGradient(S / 2, S / 2, S * 0.08, S / 2, S / 2, S * 0.66); pool.addColorStop(0, "rgba(255,255,255,0.12)"); pool.addColorStop(0.6, "rgba(255,255,255,0.03)"); pool.addColorStop(1, "rgba(0,0,0,0.10)"); x.fillStyle = pool; x.fillRect(0, 0, S, S);
    }
    const tex = new THREE.CanvasTexture(c);
    tex.magFilter = THREE.NearestFilter; tex.minFilter = THREE.NearestMipmapNearestFilter;
    tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
    this._surf.set(key, tex);
    return tex;
  }

  // Tree billboards (HD-2D) standing on each foliage cell, with a blob shadow.
  private buildTrees(cells: number[]): void {
    const shadowMat = new THREE.MeshBasicMaterial({ map: this.blob(), transparent: true, depthWrite: false, opacity: 0.4 });
    const shGeo = new THREE.PlaneGeometry(0.95, 0.95);
    for (const i of cells) {
      const x = i % this.W, z = Math.floor(i / this.W);
      const v = (x * 7 + z * 13) % 5;
      const tex = this.treeTex(v);
      const img = tex.image as HTMLImageElement;
      const h = 1.55 + ((x + z) % 5) * 0.13;
      const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
      spr.scale.set(h * (img.width / img.height), h, 1);
      spr.center.set(0.5, 0);
      spr.position.set(x, 0.02, z);
      this.worldGroup.add(spr);
      const sh = new THREE.Mesh(shGeo, shadowMat);
      sh.rotation.x = -Math.PI / 2; sh.position.set(x, 0.02, z);
      this.worldGroup.add(sh);
    }
  }

  // ---- biome-aware terrain props ---------------------------------------
  // Scatters small colored billboards (flowers, shrubs, cacti, ice shards…)
  // across open ground, keyed to the biome of each ground tile. Deterministic
  // per-tile hashing keeps placement stable across rebuilds. Foliage themes only.
  private _propTerrainTex = new Map<string, THREE.Texture>();
  private buildTerrainProps(ground: number[], decor: number[]): void {
    const shadowMat = new THREE.MeshBasicMaterial({ map: this.blob(), transparent: true, depthWrite: false, opacity: 0.3 });
    const shGeo = new THREE.PlaneGeometry(0.4, 0.4);
    const kinds: Record<string, string[]> = {
      temperate: ["flowers", "tuft", "tuft", "mushroom", "stone", "bush", "fern", "flowers"],
      desert: ["shrub", "pebbles", "cactus", "pebbles", "tumbleweed"],
      frost: ["iceshard", "snowrock", "deadbush", "icecluster"],
    };
    const density: Record<string, number> = { temperate: 0.12, desert: 0.06, frost: 0.06 };
    let placed = 0;
    for (let i = 0; i < ground.length && placed < 240; i++) {
      const gid = ground[i];
      if (gid === 3) continue;            // keep the road clear
      if (decor[i]) continue;             // tile already has tree/rock/water/wall/crystal
      const x = i % this.W, z = Math.floor(i / this.W);
      const h = ((x * 73856093) ^ (z * 19349663)) >>> 0;
      const biome = gid === 10 ? "frost" : gid === 9 ? "desert" : "temperate";
      if ((h % 1000) / 1000 >= density[biome]) continue;
      const list = kinds[biome];
      const kind = list[(h >> 10) % list.length];
      const tex = this.propTexTerrain(kind);
      const img = tex.image as HTMLCanvasElement;
      const ph = 0.34 + (((h >> 4) % 5) * 0.05);
      const ox = (((h >> 6) % 7) - 3) * 0.07, oz = (((h >> 9) % 7) - 3) * 0.07;
      const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
      spr.scale.set(ph * (img.width / img.height), ph, 1);
      spr.center.set(0.5, 0);
      spr.position.set(x + ox, 0.02, z + oz);
      this.worldGroup.add(spr);
      const sh = new THREE.Mesh(shGeo, shadowMat);
      sh.rotation.x = -Math.PI / 2; sh.position.set(x + ox, 0.015, z + oz);
      this.worldGroup.add(sh);
      placed++;
    }
  }

  // Tiny 32x32 colored pixel-art billboard for a terrain prop, cached by kind.
  private propTexTerrain(kind: string): THREE.Texture {
    const cached = this._propTerrainTex.get(kind);
    if (cached) return cached;
    const S = 32, c = document.createElement("canvas"); c.width = S; c.height = S;
    const x = c.getContext("2d")!; x.imageSmoothingEnabled = false;
    const r = (lx: number, ly: number, w: number, h: number, col: string) => { x.fillStyle = col; x.fillRect(lx, ly, w, h); };
    const dot = (dx: number, dy: number, rad: number, col: string) => { x.fillStyle = col; x.beginPath(); x.arc(dx, dy, rad, 0, Math.PI * 2); x.fill(); };
    const tri = (ax: number, ay: number, bx: number, by: number, dx: number, dy: number, col: string) => { x.fillStyle = col; x.beginPath(); x.moveTo(ax, ay); x.lineTo(bx, by); x.lineTo(dx, dy); x.closePath(); x.fill(); };
    const cx = S / 2, base = S - 1;
    if (kind === "flowers") {
      r(cx - 6, base - 1, 12, 2, "#2f6b34");                            // contact shadow
      r(cx - 6, base - 6, 12, 6, "#3f8a3a");
      for (let i = -5; i <= 5; i += 2) r(cx + i, base - 10, 1, 6, "#4ea049");
      r(cx - 5, base - 9, 1, 5, "#6cc266");                            // sunlit stem
      dot(cx - 5, base - 11, 2.4, "#e8506a"); dot(cx - 5, base - 11, 1, "#ffd86a");
      dot(cx + 4, base - 13, 2.4, "#f2c14b"); dot(cx + 4, base - 13, 1, "#fff3c0");
      dot(cx, base - 16, 2.4, "#e87ab0"); dot(cx, base - 16, 1, "#fff0f6");
    } else if (kind === "tuft") {
      r(cx - 5, base - 4, 10, 4, "#3f8a3a");
      for (let i = -4; i <= 4; i += 2) { const hh = 6 + ((i + 4) % 3) * 2; tri(cx + i, base - 4, cx + i + 1, base - 4 - hh, cx + i + 2, base - 4, "#52ad4b"); }
    } else if (kind === "mushroom") {
      r(cx - 2, base - 7, 4, 7, "#e9dcc2");
      dot(cx, base - 8, 5, "#c8413a"); r(cx - 5, base - 8, 10, 4, "#c8413a");
      dot(cx - 2, base - 9, 1, "#ffe3d0"); dot(cx + 2, base - 10, 1, "#ffe3d0");
    } else if (kind === "stone") {
      dot(cx, base - 4, 6, "#8a8f99"); r(cx - 6, base - 4, 12, 4, "#8a8f99");
      dot(cx - 2, base - 6, 3, "#a6abb5"); r(cx - 6, base - 1, 12, 2, "#6c7079");
    } else if (kind === "bush") {
      r(cx - 7, base - 1, 14, 2, "#1f5226");                           // contact shadow
      dot(cx - 4, base - 6, 5, "#2f7a3a"); dot(cx + 4, base - 6, 5, "#2f7a3a");
      dot(cx, base - 9, 6, "#3a9248"); r(cx - 8, base - 6, 16, 6, "#2f7a3a");
      dot(cx + 4, base - 5, 3, "#256b30");                             // dark pocket (right)
      dot(cx - 2, base - 10, 2, "#56b061"); dot(cx - 4, base - 8, 1.4, "#74c47a"); // highlights (upper-left)
    } else if (kind === "shrub") {
      for (let i = -4; i <= 4; i += 2) { const hh = 7 + ((i + 4) % 3) * 2; tri(cx + i, base - 2, cx + i + 1, base - 2 - hh, cx + i + 2, base - 2, "#9aa05a"); }
      r(cx - 5, base - 2, 10, 2, "#7c7b40");
    } else if (kind === "pebbles") {
      dot(cx - 4, base - 2, 2.6, "#b59a6a"); dot(cx + 3, base - 2, 3, "#c8ae7e");
      dot(cx, base - 3, 2, "#a98e60"); dot(cx + 5, base - 1, 1.6, "#9c8358");
    } else if (kind === "cactus") {
      r(cx - 2, base - 18, 4, 18, "#3d8a4a");
      r(cx - 2, base - 18, 1, 18, "#5fb168");                          // lit left edge
      r(cx + 1, base - 18, 1, 18, "#2c6a38");                          // shaded right edge
      r(cx - 7, base - 9, 5, 3, "#3d8a4a"); r(cx - 7, base - 13, 3, 7, "#3d8a4a");
      r(cx - 7, base - 13, 1, 7, "#5fb168");                           // lit arm edge
      r(cx + 2, base - 12, 5, 3, "#3d8a4a"); r(cx + 4, base - 16, 3, 7, "#3d8a4a");
      for (let i = 0; i < 6; i++) dot(cx - 1 + (i % 2) * 2, base - 3 - i * 2.5, 0.6, "#bfe3a0");
    } else if (kind === "fern") {
      r(cx - 4, base - 3, 8, 3, "#2f6b34");
      for (const ang of [-0.95, -0.45, 0, 0.45, 0.95]) {
        const tipX = cx + Math.sin(ang) * 13, tipY = base - 4 - Math.cos(ang) * 15;
        tri(cx - 1, base - 3, cx + 1, base - 3, tipX, tipY, "#3f8a3a");
        if (ang <= 0) tri(cx - 1, base - 3, cx, base - 3, (cx + tipX) / 2, (base - 3 + tipY) / 2, "#52ad4b");
      }
      dot(cx, base - 14, 1.4, "#74c47a"); dot(cx - 5, base - 11, 1, "#74c47a");
    } else if (kind === "tumbleweed") {
      x.strokeStyle = "#8a6a3a"; x.lineWidth = 1;
      for (let a = 0; a < Math.PI * 2; a += 0.5) { x.beginPath(); x.moveTo(cx + Math.cos(a) * 2, base - 7 + Math.sin(a) * 2); x.lineTo(cx + Math.cos(a) * 7, base - 7 + Math.sin(a) * 7); x.stroke(); }
      x.strokeStyle = "#b59a5e"; for (let a = 0.25; a < Math.PI * 2; a += 0.7) { x.beginPath(); x.moveTo(cx, base - 7); x.lineTo(cx + Math.cos(a) * 6, base - 7 + Math.sin(a) * 6); x.stroke(); }
      dot(cx - 2, base - 9, 1, "#cdb574");
    } else if (kind === "icecluster") {
      tri(cx, base - 18, cx - 4, base, cx + 1, base, "#cdeeff");
      tri(cx, base - 18, cx + 1, base, cx + 5, base, "#9ad4f0");
      tri(cx - 7, base - 11, cx - 10, base, cx - 4, base, "#bfeaff");
      tri(cx + 6, base - 13, cx + 3, base, cx + 9, base, "#aee0f7");
      r(cx - 9, base - 1, 18, 2, "#e6f7ff");
      dot(cx - 1, base - 15, 1, "#ffffff"); dot(cx + 5, base - 10, 0.8, "#ffffff");
    } else if (kind === "iceshard") {
      tri(cx, base - 16, cx - 4, base, cx + 4, base, "#bfeaff");
      tri(cx, base - 16, cx, base, cx + 4, base, "#9ad4f0");
      r(cx - 6, base - 1, 12, 2, "#d8f4ff");
    } else if (kind === "snowrock") {
      dot(cx, base - 4, 6, "#7f848d"); r(cx - 6, base - 4, 12, 4, "#7f848d");
      dot(cx, base - 7, 5.5, "#f2f7ff"); r(cx - 6, base - 7, 12, 3, "#f2f7ff");
    } else { // deadbush
      r(cx - 1, base - 12, 2, 12, "#7a5a38");
      x.strokeStyle = "#8a6a42"; x.lineWidth = 1;
      for (const [bx, by] of [[-5, -10], [5, -11], [-3, -14], [4, -15], [0, -16]] as [number, number][]) {
        x.beginPath(); x.moveTo(cx, base - 8); x.lineTo(cx + bx, base + by); x.stroke();
      }
    }
    const t = new THREE.CanvasTexture(c);
    t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.colorSpace = THREE.SRGBColorSpace;
    this._propTerrainTex.set(kind, t);
    return t;
  }

  // A 3D building: box body + pyramid roof + glowing window + flickering lantern.
  // Its footprint is marked blocked so the player walks around it.
  addBuilding(tileX: number, tileY: number, opts: { w?: number; d?: number; bodyH?: number; color?: number; roof?: number } = {}): void {
    const w = opts.w ?? 3, d = opts.d ?? 3, bodyH = opts.bodyH ?? 2.4, roofH = 1.4;
    const grp = new THREE.Group();
    grp.position.set(tileX, 0, tileY);
    const body = new THREE.Mesh(new THREE.BoxGeometry(w, bodyH, d), new THREE.MeshStandardMaterial({ color: opts.color ?? 0x6a5f86, roughness: 0.92 }));
    body.position.y = bodyH / 2; body.castShadow = true; body.receiveShadow = true;
    grp.add(body);
    const roof = new THREE.Mesh(new THREE.ConeGeometry(Math.max(w, d) * 0.86, roofH, 4), new THREE.MeshStandardMaterial({ color: opts.roof ?? 0x8a4a44, roughness: 0.8 }));
    roof.rotation.y = Math.PI / 4; roof.position.y = bodyH + roofH / 2; roof.castShadow = true;
    grp.add(roof);
    const win = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.74), new THREE.MeshBasicMaterial({ color: 0xffd98a }));
    win.position.set(0, 1.05, d / 2 + 0.02); grp.add(win);
    const light = new THREE.PointLight(0xffba6a, 4.5, 10, 2);
    light.position.set(0, 1.7, d / 2 + 0.7); grp.add(light);
    this.buildingLights.push({ light, base: 4.5, phase: tileX * 1.3 + tileY });
    this.worldGroup.add(grp);
    const hw = Math.floor(w / 2), hd = Math.floor(d / 2);
    for (let dz = -hd; dz <= hd; dz++) for (let dx = -hw; dx <= hw; dx++) this.propBlocked.add(`${tileX + dx},${tileY + dz}`);
  }

  // A lamp post: pole + glowing lantern box + a flickering warm light. Blocks 1 tile.
  addLantern(tileX: number, tileY: number): void {
    const grp = new THREE.Group(); grp.position.set(tileX, 0, tileY);
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.08, 1.5, 6), new THREE.MeshStandardMaterial({ color: 0x2a2438, roughness: 0.8, metalness: 0.3 }));
    post.position.y = 0.75; post.castShadow = true; grp.add(post);
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.36, 0.3), new THREE.MeshStandardMaterial({ color: 0xffe0a0, emissive: 0xffb24a, emissiveIntensity: 1.8, roughness: 0.4 }));
    lamp.position.y = 1.62; grp.add(lamp);
    const light = new THREE.PointLight(0xffba6a, 3.5, 7, 2); light.position.y = 1.62; grp.add(light);
    this.buildingLights.push({ light, base: 3.5, phase: tileX * 1.7 + tileY });
    this.worldGroup.add(grp);
    this.propBlocked.add(`${tileX},${tileY}`);
  }

  // ---- procedural prop textures (cached) -------------------------------
  private blob(): THREE.Texture { return (this._blobTex ??= this.makeBlob()); }

  // A chunky yellow chocobo-style mount bird (pixel-art billboard).
  private chocoboTex(): THREE.Texture {
    if (this._chocoboTex) return this._chocoboTex;
    const W = 48, H = 56, c = document.createElement("canvas"); c.width = W; c.height = H;
    const x = c.getContext("2d")!; x.imageSmoothingEnabled = false;
    const body = "#f4d35a", shade = "#d8a93a", beak = "#ff9a3a", leg = "#caa24a";
    const ell = (cx: number, cy: number, rx: number, ry: number, col: string) => { x.fillStyle = col; x.beginPath(); x.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2); x.fill(); };
    // legs
    x.fillStyle = leg; x.fillRect(W / 2 - 6, H - 12, 3, 12); x.fillRect(W / 2 + 3, H - 12, 3, 12);
    x.fillRect(W / 2 - 9, H - 2, 7, 2); x.fillRect(W / 2 + 2, H - 2, 7, 2);
    // body
    ell(W / 2, H - 22, 15, 16, body); ell(W / 2 + 5, H - 18, 11, 12, shade);
    // tail plume
    x.fillStyle = body; x.beginPath(); x.moveTo(W / 2 - 12, H - 30); x.lineTo(W / 2 - 22, H - 40); x.lineTo(W / 2 - 8, H - 24); x.closePath(); x.fill();
    // neck + head (upper-left)
    ell(W / 2 - 6, H - 38, 6, 9, body);
    ell(W / 2 - 8, H - 44, 6, 6, body);
    // beak + eye
    x.fillStyle = beak; x.fillRect(W / 2 - 16, H - 45, 6, 3);
    x.fillStyle = "#2a2018"; x.fillRect(W / 2 - 9, H - 46, 2, 2);
    const t = new THREE.CanvasTexture(c); t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.colorSpace = THREE.SRGBColorSpace;
    this._chocoboTex = t; return t;
  }

  private dustTex(): THREE.Texture {
    if (this._dustTex) return this._dustTex;
    const s = 32, c = document.createElement("canvas"); c.width = s; c.height = s;
    const x = c.getContext("2d")!;
    const g = x.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    g.addColorStop(0, "rgba(200,190,170,0.9)"); g.addColorStop(1, "rgba(200,190,170,0)");
    x.fillStyle = g; x.fillRect(0, 0, s, s);
    this._dustTex = new THREE.CanvasTexture(c);
    return this._dustTex;
  }

  private _glowTex?: THREE.Texture;
  glowTex(): THREE.Texture {
    if (this._glowTex) return this._glowTex;
    const s = 96, c = document.createElement("canvas"); c.width = s; c.height = s;
    const x = c.getContext("2d")!;
    const g = x.createRadialGradient(s / 2, s * 0.55, 0, s / 2, s * 0.55, s / 2);
    g.addColorStop(0, "rgba(255,255,255,0.85)"); g.addColorStop(0.45, "rgba(255,255,255,0.3)"); g.addColorStop(1, "rgba(255,255,255,0)");
    x.fillStyle = g; x.fillRect(0, 0, s, s);
    this._glowTex = new THREE.CanvasTexture(c);
    return this._glowTex;
  }

  // Distant ridge silhouette for parallax depth, tinted toward the theme fog.
  private ridgeTex(th: Theme): THREE.Texture {
    const W = 512, H = 160, c = document.createElement("canvas"); c.width = W; c.height = H;
    const x = c.getContext("2d")!;
    const hex = (n: number) => "#" + (n & 0xffffff).toString(16).padStart(6, "0");
    const rgba = (n: number, a: number) => `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
    const rnd = (() => { let s = (0x9e3779b9 ^ th.fog) & 0x7fffffff; return () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; }; })();
    // soft celestial glow (sun/moon halo), tinted by sky — upper-left, fades to transparent
    const glow = x.createRadialGradient(W * 0.30, H * 0.28, 0, W * 0.30, H * 0.28, H * 0.55);
    glow.addColorStop(0, rgba(th.hemiSky, 0.5)); glow.addColorStop(0.32, rgba(th.hemiSky, 0.16)); glow.addColorStop(1, rgba(th.hemiSky, 0));
    x.fillStyle = glow; x.fillRect(0, 0, W, H);
    // faint stars / atmosphere specks (upper band only — barely visible against bright skies)
    for (let i = 0; i < 34; i++) { const sx = (rnd() * W) | 0, sy = (rnd() * H * 0.5) | 0; x.fillStyle = `rgba(255,255,255,${(0.1 + rnd() * 0.28).toFixed(2)})`; x.fillRect(sx, sy, 1, 1); }
    // horizon haze band fading upward (sits behind the ridges)
    const haze = x.createLinearGradient(0, H * 0.30, 0, H * 0.62);
    haze.addColorStop(0, rgba(th.fog, 0)); haze.addColorStop(1, rgba(th.fog, 0.45));
    x.fillStyle = haze; x.fillRect(0, H * 0.30, W, H * 0.40);
    const ridge = (baseY: number, amp: number, color: string, seed: number) => {
      x.fillStyle = color; x.beginPath(); x.moveTo(0, H);
      for (let i = 0; i <= W; i += 8) {
        const y = baseY + Math.sin(i * 0.013 + seed) * amp + Math.sin(i * 0.041 + seed * 2) * amp * 0.4;
        x.lineTo(i, y);
      }
      x.lineTo(W, H); x.closePath(); x.fill();
    };
    ridge(H * 0.44, 12, rgba(th.hemiGround, 0.55), 4.1); // farthest, palest (blends with haze)
    ridge(H * 0.52, 16, hex(th.hemiGround), 0.6);        // far range
    ridge(H * 0.66, 22, hex(th.fog), 2.3);               // near range (fog-coloured)
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  }

  private treeTex(v: number): THREE.Texture {
    if (this._treeTex[v]) return this._treeTex[v];
    const W = 64, H = 80, c = document.createElement("canvas"); c.width = W; c.height = H;
    const x = c.getContext("2d")!; x.imageSmoothingEnabled = false;
    // [shadow, mid, base, highlight] — light comes from the upper-left
    const palettes = [
      ["#1f3a22", "#2c5230", "#3d7340", "#6cb866"], // round broadleaf — green
      ["#243f29", "#345a3a", "#46834e", "#74c47a"], // tall oval — lush green
      ["#1b2f2c", "#26433d", "#315a4f", "#4e8a78"], // conifer — dark pine
      ["#5a3417", "#8a4f1e", "#c0792c", "#f0b454"], // round broadleaf — autumn
      ["#21413b", "#2f5750", "#3c7567", "#a6dccf"], // conifer — frost-tipped
    ];
    const g = palettes[v % palettes.length];
    const shape = v === 2 || v === 4 ? "cone" : v === 1 ? "oval" : "round";
    const cx = W / 2;
    const blob = (bx: number, by: number, r: number, col: string) => { x.fillStyle = col; x.beginPath(); x.arc(bx, by, r, 0, Math.PI * 2); x.fill(); };
    const tri = (ax: number, ay: number, bx: number, by: number, dx: number, dy: number, col: string) => { x.fillStyle = col; x.beginPath(); x.moveTo(ax, ay); x.lineTo(bx, by); x.lineTo(dx, dy); x.closePath(); x.fill(); };
    // ground contact shadow
    x.fillStyle = "rgba(0,0,0,0.25)"; x.beginPath(); x.ellipse(cx, H - 2, 12, 3, 0, 0, Math.PI * 2); x.fill();
    // trunk + root flare + bark shading
    const trunkH = shape === "cone" ? 14 : 22, trunkW = shape === "cone" ? 6 : 8, ty = H - trunkH;
    x.fillStyle = "#4a3422"; x.fillRect(cx - trunkW / 2, ty, trunkW, trunkH);
    x.fillStyle = "#5e4530"; x.fillRect(cx - trunkW / 2, ty, Math.ceil(trunkW * 0.4), trunkH);    // lit left edge
    x.fillStyle = "rgba(40,28,18,0.55)"; x.fillRect(cx + trunkW / 2 - 2, ty, 2, trunkH);          // shaded right edge
    x.fillStyle = "#3a2818"; for (let by = ty + 4; by < H - 2; by += 6) x.fillRect(cx - trunkW / 2 + 1, by, trunkW - 2, 1); // bark
    tri(cx - trunkW / 2 - 3, H, cx - trunkW / 2, H - 7, cx - trunkW / 2, H, "#4a3422");            // left root flare
    tri(cx + trunkW / 2 + 3, H, cx + trunkW / 2, H - 7, cx + trunkW / 2, H, "#3a2818");            // right root flare
    if (shape === "round") {
      blob(cx, H - 36, 19, g[0]); blob(cx - 12, H - 30, 13, g[0]); blob(cx + 12, H - 30, 13, g[0]);
      blob(cx, H - 30, 17, g[1]); blob(cx - 9, H - 34, 11, g[1]); blob(cx + 9, H - 34, 11, g[1]);
      blob(cx + 11, H - 33, 3, g[0]);                                                               // single shadow pocket (off-center → no "eyes")
      blob(cx - 3, H - 42, 13, g[2]); blob(cx - 10, H - 40, 8, g[2]); blob(cx + 6, H - 38, 8, g[2]);
      blob(cx - 8, H - 46, 6, g[3]); blob(cx - 2, H - 44, 4, g[3]); blob(cx - 13, H - 38, 4, g[3]); blob(cx - 6, H - 50, 3, g[3]);
    } else if (shape === "oval") {
      blob(cx, H - 30, 14, g[0]); blob(cx, H - 42, 14, g[0]); blob(cx, H - 52, 11, g[0]);
      blob(cx - 1, H - 32, 12, g[1]); blob(cx - 1, H - 44, 11, g[1]); blob(cx, H - 54, 8, g[1]);
      blob(cx + 7, H - 34, 4, g[0]); blob(cx + 6, H - 46, 3, g[0]);                                // dark pockets
      blob(cx - 3, H - 36, 9, g[2]); blob(cx - 3, H - 48, 8, g[2]); blob(cx - 2, H - 56, 5, g[2]);
      blob(cx - 6, H - 50, 4, g[3]); blob(cx - 4, H - 58, 3, g[3]); blob(cx - 7, H - 40, 3, g[3]);
    } else { // cone — stacked tiers, lit left / shaded right
      const tiers: [number, number, number][] = [[H - 56, H - 20, 17], [H - 65, H - 35, 13], [H - 74, H - 50, 9]];
      for (const [tipY, baseY, hw] of tiers) {
        tri(cx + 2, tipY, cx - hw + 2, baseY, cx + hw + 2, baseY, g[0]);                           // drop shadow
        tri(cx, tipY, cx - hw, baseY, cx + hw, baseY, g[1]);                                       // mid
        tri(cx - 1, tipY + 1, cx - hw + 1, baseY - 1, cx - 1, baseY - 1, g[2]);                    // lit left
        tri(cx + 3, tipY + 1, cx + hw - 1, baseY - 1, cx + 1, baseY - 1, g[0]);                    // shaded right
      }
      if (v === 4) for (const [tipY] of tiers) { blob(cx, tipY + 3, 3, "#eaf6ff"); blob(cx - 4, tipY + 6, 1.5, "#d6ecff"); }
      blob(cx - 5, H - 54, 2, g[3]); blob(cx - 7, H - 40, 2, g[3]);                                // highlight specks
    }
    const t = new THREE.CanvasTexture(c); t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.colorSpace = THREE.SRGBColorSpace;
    this._treeTex[v] = t; return t;
  }

  private async buildBackdrop(mapId: string): Promise<void> {
    try {
      const tex = await new THREE.TextureLoader().loadAsync(`assets/bg/${mapId}.png`);
      tex.colorSpace = THREE.SRGBColorSpace;
      const bd = new THREE.Mesh(new THREE.PlaneGeometry(120, 67), new THREE.MeshBasicMaterial({ map: tex, fog: true, depthWrite: false }));
      bd.name = "backdrop";
      this.worldGroup.add(bd);
    } catch { /* no backdrop for this map */ }
  }

  private placePlayer(): void {
    this.player.position.set(this.px, 0.04, this.pz);
    this.shadow.position.set(this.px, 0.03, this.pz);
    this.playerLight.position.set(this.px, 2.4, this.pz);
    const desired = new THREE.Vector3(this.px, 10.5, this.pz + 9.5);
    this.camera.position.copy(desired);
    this.camera.lookAt(this.px, 0.6, this.pz - 1);
  }

  // ---- markers + interaction -------------------------------------------

  addMarker(tileX: number, tileY: number, color: string, letter: string, label: string, onInteract: () => void, radius = 1.7): Marker {
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.makeMarkerTex(color, letter, label), transparent: true, depthWrite: false }));
    sprite.scale.set(2.4, 2.4, 1);
    sprite.position.set(tileX, 1.4, tileY);
    sprite.center.set(0.5, 0);
    sprite.userData.float = true;
    sprite.userData.baseY = 1.4;
    sprite.userData.phase = tileX * 0.7 + tileY * 0.3;
    this.worldGroup.add(sprite);
    const mk: Marker = { x: tileX, y: tileY, radius, label, onInteract, sprite };
    this.markers.push(mk);
    return mk;
  }

  // A themed location emblem (town / dungeon gate / cave / vault / boss) for the
  // world map — a glowing disc with a drawn icon + a state badge, instead of a
  // bare letter token.
  addPlaceMarker(
    tileX: number, tileY: number, kind: PlaceKind, color: string, label: string,
    onInteract: () => void, opts: { badge?: "check" | "lock"; radius?: number; scale?: number } = {},
  ): Marker {
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.makeIconTex(kind, color, label, opts.badge), transparent: true, depthWrite: false }));
    const sc = opts.scale ?? 2.8;
    sprite.scale.set(sc, sc, 1);
    sprite.position.set(tileX, 1.4, tileY);
    sprite.center.set(0.5, 0);
    sprite.userData.float = true;
    sprite.userData.baseY = 1.4;
    sprite.userData.phase = tileX * 0.7 + tileY * 0.3;
    this.worldGroup.add(sprite);
    const mk: Marker = { x: tileX, y: tileY, radius: opts.radius ?? 1.9, label, onInteract, sprite };
    this.markers.push(mk);
    return mk;
  }

  // A billboard using a real pixel sprite (NPCs / enemies), with a floating
  // label + blob shadow, standing on the ground like the party.
  async addSpriteMarker(tileX: number, tileY: number, texUrl: string, color: string, label: string, onInteract: () => void, height = 1.6, radius = 1.7): Promise<Marker> {
    const tex = await this.loadTex(texUrl);
    const img = tex.image as HTMLImageElement;
    // 2-frame idle sheet (width == 2*height) → show one frame + register for animation
    const sheet = Math.abs(img.width - img.height * 2) < 2;
    const aspect = sheet ? (img.width / 2) / img.height : img.width / img.height;
    if (sheet) { tex.repeat.set(0.5, 1); tex.offset.set(0, 0); this.sheetTex.add(tex); }
    const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
    spr.scale.set(height * aspect, height, 1);
    spr.center.set(0.5, 0);
    spr.position.set(tileX, 0.05, tileY);
    this.worldGroup.add(spr);

    const lab = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.makeLabelTex(label, color), transparent: true, depthWrite: false }));
    lab.scale.set(2.4, 0.8, 1);
    lab.center.set(0.5, 0);
    lab.position.set(tileX, height + 0.25, tileY);
    lab.userData.float = true;
    lab.userData.baseY = height + 0.25;
    lab.userData.phase = tileX * 0.7 + tileY * 0.3;
    this.worldGroup.add(lab);

    const sh = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 1.1), new THREE.MeshBasicMaterial({ map: this.makeBlob(), transparent: true, depthWrite: false, opacity: 0.45 }));
    sh.rotation.x = -Math.PI / 2;
    sh.position.set(tileX, 0.02, tileY);
    this.worldGroup.add(sh);

    const mk: Marker = { x: tileX, y: tileY, radius, label, onInteract, sprite: spr };
    this.markers.push(mk);
    return mk;
  }

  // A roaming enemy billboard: same look as addSpriteMarker, but it wanders near
  // its spawn and chases the player, firing `onInteract` (its battle) on contact.
  // The update loop drives its motion; here we just build the visuals + register.
  async addRoamer(tileX: number, tileY: number, texUrl: string, color: string, label: string, onInteract: () => void, height = 1.55, radius = 1.6): Promise<Marker> {
    const tex = await this.loadTex(texUrl);
    const img = tex.image as HTMLImageElement;
    const sheet = Math.abs(img.width - img.height * 2) < 2;
    const aspect = sheet ? (img.width / 2) / img.height : img.width / img.height;
    if (sheet) { tex.repeat.set(0.5, 1); tex.offset.set(0, 0); this.sheetTex.add(tex); }
    const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
    const baseW = height * aspect;
    spr.scale.set(baseW, height, 1);
    spr.center.set(0.5, 0);
    spr.position.set(tileX, 0.05, tileY);
    this.worldGroup.add(spr);

    const lab = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.makeLabelTex(label, color), transparent: true, depthWrite: false }));
    lab.scale.set(2.4, 0.8, 1);
    lab.center.set(0.5, 0);
    lab.position.set(tileX, height + 0.25, tileY);
    lab.userData.float = true;
    lab.userData.baseY = height + 0.25;
    lab.userData.phase = tileX * 0.7 + tileY * 0.3;
    this.worldGroup.add(lab);

    const sh = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 1.1), new THREE.MeshBasicMaterial({ map: this.makeBlob(), transparent: true, depthWrite: false, opacity: 0.45 }));
    sh.rotation.x = -Math.PI / 2;
    sh.position.set(tileX, 0.02, tileY);
    this.worldGroup.add(sh);

    const r: Roamer = {
      mk: undefined as unknown as Marker, label: lab, shadow: sh, baseW,
      spawnX: tileX, spawnZ: tileY, x: tileX, z: tileY, tx: tileX, tz: tileY,
      wait: 0, flipL: false, phase: (tileX * 7 + tileY * 13) % 6.28, fired: false,
      trigger: () => { if (r.fired) return; r.fired = true; onInteract(); },
    };
    const mk: Marker = { x: tileX, y: tileY, radius, label, onInteract: r.trigger, sprite: spr };
    r.mk = mk;
    this.markers.push(mk);
    this.roamers.push(r);
    return mk;
  }

  // A procedural townsfolk NPC billboard (robe tinted by `color`) with a floating
  // label + shadow — for shopkeepers, elders, quest-givers, etc.
  addNpcMarker(tileX: number, tileY: number, color: string, label: string, onInteract: () => void, radius = 1.7, lpcId?: string): Marker {
    const tex = this.npcTex(color, Math.floor(tileX * 7 + tileY * 13));
    const img = tex.image as HTMLImageElement;
    const height = 1.55;
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
    const spr = new THREE.Sprite(mat);
    spr.scale.set(height * (img.width / img.height), height, 1);
    spr.center.set(0.5, 0);
    spr.position.set(tileX, 0.05, tileY);
    this.worldGroup.add(spr);
    // upgrade to a real character sheet (single front-facing frame) when
    // available. Hero ids (saka/kara/zell) prefer the project-owned hero front
    // frame; otherwise fall back to LPC standing/idle frame.
    if (lpcId && HERO_IDS.has(lpcId)) {
      this.loadTex(`assets/sprites/heroes/${lpcId}/front.png`).then((ht) => {
        const hi = ht.image as HTMLImageElement;
        const lh = 1.9;
        mat.map = ht; mat.needsUpdate = true;
        spr.scale.set(lh * (hi.width / hi.height), lh, 1);
      }).catch(() => { /* keep procedural */ });
    } else if (lpcId && LPC_IDS.has(lpcId)) {
      this.loadTex(`assets/sprites/lpc/${lpcId}.png`).then((lt) => {
        lt.repeat.set(1 / LPC.cols, 1 / LPC.rows);
        lt.offset.set(...lpcOffset(0, LPC.walkDownRow));
        const lh = 1.9;
        mat.map = lt; mat.needsUpdate = true;
        spr.scale.set(lh, lh, 1);
      }).catch(() => { /* keep procedural */ });
    }

    const lab = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.makeLabelTex(label, color), transparent: true, depthWrite: false }));
    lab.scale.set(2.4, 0.8, 1); lab.center.set(0.5, 0);
    lab.position.set(tileX, height + 0.25, tileY);
    lab.userData.float = true; lab.userData.baseY = height + 0.25; lab.userData.phase = tileX * 0.7 + tileY * 0.3;
    this.worldGroup.add(lab);

    const sh = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 1.0), new THREE.MeshBasicMaterial({ map: this.makeBlob(), transparent: true, depthWrite: false, opacity: 0.45 }));
    sh.rotation.x = -Math.PI / 2; sh.position.set(tileX, 0.02, tileY);
    this.worldGroup.add(sh);

    const mk: Marker = { x: tileX, y: tileY, radius, label, onInteract, sprite: spr };
    this.markers.push(mk);
    return mk;
  }

  private _npcTex = new Map<string, THREE.Texture>();
  // A detailed HD-2D townsperson billboard: shaded layered garments, defined
  // head/face, hair/hat/hood variants, a colored outline and an upper-left rim.
  private npcTex(color: string, seed: number): THREE.Texture {
    const key = `${color}|${seed % 4}`;
    const cached = this._npcTex.get(key); if (cached) return cached;
    const W = 40, H = 56, cx = 20;
    const c = document.createElement("canvas"); c.width = W; c.height = H;
    const x = c.getContext("2d")!; x.imageSmoothingEnabled = false;
    const hexN = (h: string) => parseInt(h.replace("#", ""), 16);
    const r = (hexN(color) >> 16) & 255, g = (hexN(color) >> 8) & 255, b = hexN(color) & 255;
    const cl = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
    const sh = (t: number) => `rgb(${cl(r * t)},${cl(g * t)},${cl(b * t)})`;
    const garmentD = sh(0.5), garment = sh(0.74), garmentL = sh(1.0), garmentH = sh(1.22);
    const variant = seed % 4;
    const skin = ["#eccaa2", "#d8a878", "#b98a64", "#cdb0c8"][seed % 4];
    const skinSh = ["#caa07e", "#b88a60", "#946a4a", "#a98aa6"][seed % 4];
    const hair = ["#3a2c22", "#6a4a30", "#caa24a", "#2a2a36", "#8a3a3a"][seed % 5];
    const fr = (lx: number, ly: number, w: number, h: number, col: string) => { x.fillStyle = col; x.fillRect(lx, ly, w, h); };
    // ---- boots ----
    fr(15, 50, 4, 5, "#2a2230"); fr(21, 50, 4, 5, "#2a2230"); fr(15, 50, 4, 1, "#46404e");
    // ---- robe / tunic (trapezoid, shaded by column) ----
    for (let yy = 26; yy < 51; yy++) {
      const w = 6 + Math.round((yy - 26) * 0.42);
      fr(cx - w, yy, w * 2, 1, garment);
      fr(cx - w, yy, 2, 1, garmentD);          // left shade
      fr(cx + w - 2, yy, 2, 1, garmentD);       // right shade
      fr(cx - 1, yy, 2, 1, garmentL);           // center sheen
    }
    fr(cx - 2, 26, 4, 24, garmentL);            // front seam light
    fr(13, 36, 14, 2, garmentD); fr(13, 36, 14, 1, garmentH); // belt
    fr(cx - 1, 38, 2, 2, "#e6c060");            // buckle
    // role-specific overlay
    if (variant === 1) { fr(11, 30, 18, 12, garmentD); fr(11, 30, 18, 1, garmentH); }  // apron (merchant)
    else if (variant === 0) { fr(8, 24, 5, 22, garmentD); fr(27, 24, 5, 22, garmentD); fr(8, 24, 2, 22, garment); fr(30, 24, 2, 22, garment); } // open cloak
    // ---- arms + hands ----
    fr(8, 28, 4, 12, garment); fr(28, 28, 4, 12, garment);
    fr(8, 28, 1, 12, garmentL); fr(31, 28, 1, 12, garmentD);
    fr(8, 39, 4, 3, skin); fr(28, 39, 4, 3, skin);   // hands
    // ---- neck + head ----
    fr(17, 22, 6, 3, skinSh);
    x.fillStyle = skin; x.beginPath(); x.arc(cx, 15, 7, 0, Math.PI * 2); x.fill();
    x.fillStyle = skinSh; x.beginPath(); x.arc(cx + 2, 16, 6, -0.4, 1.6); x.fill();   // cheek shadow
    // face
    fr(16, 14, 2, 2, "#2a2230"); fr(22, 14, 2, 2, "#2a2230");   // eyes
    fr(19, 16, 2, 1, skinSh);                                    // nose
    fr(18, 19, 4, 1, "#9a6a58");                                 // mouth
    // hair / hat / hood
    if (variant === 0) {                                         // hood (mystic)
      x.fillStyle = garmentD; x.beginPath(); x.arc(cx, 12, 9, Math.PI, 0); x.fill(); fr(11, 12, 18, 4, garmentD); fr(11, 12, 18, 1, garmentH);
    } else if (variant === 1) {                                  // brimmed hat (merchant)
      fr(11, 10, 18, 2, "#4a3a2a"); fr(13, 5, 14, 6, "#5a4632"); fr(13, 5, 14, 1, "#6e5840");
    } else if (variant === 2) {                                  // short hair + cap
      x.fillStyle = hair; x.beginPath(); x.arc(cx, 11, 7, Math.PI, 0.2); x.fill(); fr(13, 8, 14, 4, hair);
    } else {                                                     // long hair (scholar)
      x.fillStyle = hair; x.beginPath(); x.arc(cx, 11, 7.5, Math.PI, 0.3); x.fill();
      fr(12, 11, 3, 12, hair); fr(25, 11, 3, 12, hair); fr(12, 11, 16, 3, hair);
    }
    // ---- colored outline + upper-left rim highlight ----
    const data = x.getImageData(0, 0, W, H), px = data.data;
    const A = (lx: number, ly: number) => (lx < 0 || ly < 0 || lx >= W || ly >= H) ? 0 : px[(ly * W + lx) * 4 + 3];
    const outline = new Set<number>(); const rim: number[] = [];
    for (let yy = 0; yy < H; yy++) for (let xx = 0; xx < W; xx++) {
      const i = (yy * W + xx) * 4;
      if (px[i + 3] === 0) { if (A(xx - 1, yy) || A(xx + 1, yy) || A(xx, yy - 1) || A(xx, yy + 1)) outline.add(i); }
      else if (A(xx - 1, yy) === 0 || A(xx, yy - 1) === 0) rim.push(i);   // lit edge
    }
    for (const i of outline) { px[i] = 18; px[i + 1] = 14; px[i + 2] = 26; px[i + 3] = 255; }
    for (const i of rim) { if ((i / 4) % 7 < 5) { px[i] = cl(px[i] + 60); px[i + 1] = cl(px[i + 1] + 60); px[i + 2] = cl(px[i + 2] + 60); } }
    x.putImageData(data, 0, 0);
    const t = new THREE.CanvasTexture(c); t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.colorSpace = THREE.SRGBColorSpace;
    this._npcTex.set(key, t); return t;
  }

  // Non-interactive decorative prop billboard (crate / barrel / banner / bones /
  // debris) to dress chapter fields and dungeons with sprites.
  addProp(tileX: number, tileY: number, kind: PropKind, height = 0.95): void {
    const tex = this.propTex(kind);
    const img = tex.image as HTMLImageElement;
    const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
    spr.scale.set(height * (img.width / img.height), height, 1);
    spr.center.set(0.5, 0);
    spr.position.set(tileX, 0.04, tileY);
    this.worldGroup.add(spr);
    const sh = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.8), new THREE.MeshBasicMaterial({ map: this.blob(), transparent: true, depthWrite: false, opacity: 0.4 }));
    sh.rotation.x = -Math.PI / 2; sh.position.set(tileX, 0.02, tileY);
    this.worldGroup.add(sh);
  }

  private _propTex = new Map<string, THREE.Texture>();
  private propTex(kind: PropKind): THREE.Texture {
    const cached = this._propTex.get(kind); if (cached) return cached;
    const W = 32, H = 36, c = document.createElement("canvas"); c.width = W; c.height = H;
    const x = c.getContext("2d")!; x.imageSmoothingEnabled = false;
    const fr = (lx: number, ly: number, w: number, h: number, col: string) => { x.fillStyle = col; x.fillRect(lx, ly, w, h); };
    const dot = (dx: number, dy: number, rad: number, col: string) => { x.fillStyle = col; x.beginPath(); x.arc(dx, dy, rad, 0, Math.PI * 2); x.fill(); };
    const ell = (dx: number, dy: number, rx: number, ry: number, col: string) => { x.fillStyle = col; x.beginPath(); x.ellipse(dx, dy, rx, ry, 0, 0, Math.PI * 2); x.fill(); };
    ell(16, 34, 9, 2.2, "rgba(0,0,0,0.22)");                                                       // base contact shadow (all kinds)
    if (kind === "crate") {
      fr(7, 14, 18, 18, "#7a5230");                                                                // body
      fr(7, 14, 9, 18, "#866039"); fr(16, 14, 9, 18, "#674426");                                    // lit-left / shaded-right faces
      fr(7, 14, 18, 3, "#a87a4a"); fr(7, 29, 18, 3, "#46301a");                                      // top highlight / bottom shadow
      fr(7, 14, 2, 18, "#5a3c22"); fr(23, 14, 2, 18, "#3e2812");                                      // L/R frame
      fr(7, 22, 18, 2, "#46301a"); fr(15, 14, 2, 18, "#46301a"); fr(15, 14, 1, 18, "#8a6238");        // cross braces + brace highlight
      fr(8, 15, 2, 2, "#c49a5e"); fr(22, 15, 2, 2, "#9a7444"); fr(8, 29, 2, 2, "#7a5836"); fr(22, 29, 2, 2, "#54381e"); // corner studs
    } else if (kind === "barrel") {
      const staves = ["#5a3c24", "#6e4c30", "#805c3a", "#6e4c30", "#5a3c24"];
      for (let i = 0; i < 5; i++) fr(9 + i * 3, 12, 3, 22, staves[i]);                               // staves (curvature shading)
      fr(11, 13, 1, 20, "#946e44");                                                                  // center highlight streak
      ell(16, 12, 7, 2.2, "#5a3c24"); ell(16, 12, 5, 1.4, "#7e5a38");                                 // top lid
      fr(8, 17, 16, 2, "#caa05a"); fr(8, 27, 16, 2, "#caa05a");                                        // metal rings
      fr(8, 17, 16, 1, "#e8c878"); fr(8, 28, 16, 1, "#8a6a3a");                                        // ring highlight / shadow
      fr(8, 32, 16, 2, "#43301c");                                                                     // base shadow band
    } else if (kind === "banner") {
      fr(15, 5, 2, 29, "#4a4030"); fr(15, 5, 1, 29, "#6a5e48"); dot(16, 5, 2, "#caa860");             // pole + lit edge + finial
      fr(8, 7, 14, 18, "#7a3a5a"); fr(8, 7, 14, 3, "#9a4a6e");                                         // cloth + lit top band
      fr(9, 9, 1, 15, "#8e466a"); fr(13, 9, 2, 15, "#6a3050"); fr(19, 9, 1, 15, "#6a3050");            // fold highlight + shadows
      fr(8, 25, 4, 4, "#6a3050"); fr(18, 25, 4, 4, "#6a3050");                                          // swallowtails
      dot(15.5, 15, 3, "#e6c060"); dot(14.5, 14, 1, "#fff0b0");                                         // emblem + highlight
    } else if (kind === "bones") {
      for (const ang of [0.5, -0.5]) { x.save(); x.translate(20, 24); x.rotate(ang); fr(-1.5, -9, 3, 18, "#cfc8b4"); dot(0, -9, 2.2, "#dcd6c4"); dot(0, 9, 2.2, "#dcd6c4"); dot(0, -9, 1, "#aaa491"); x.restore(); } // crossed bones w/ knobbed ends
      dot(13, 25, 6.5, "#d2ccba"); ell(13, 29, 6, 2, "#b2ac9a"); dot(11, 23, 1.6, "#efebdd");          // skull + lower shade + highlight
      fr(9, 25, 2, 3, "#2a2620"); fr(15, 25, 2, 3, "#2a2620"); fr(12, 29, 2, 2, "#2a2620"); fr(10, 31, 6, 2, "#cfc8b4"); // eyes + nasal + jaw
    } else { // debris — broken machinery chunk with a glowing crack
      x.fillStyle = "#3a3a4a"; x.beginPath(); x.moveTo(7, 33); x.lineTo(11, 15); x.lineTo(20, 12); x.lineTo(26, 23); x.lineTo(23, 33); x.closePath(); x.fill();
      x.fillStyle = "#52526a"; x.beginPath(); x.moveTo(11, 15); x.lineTo(20, 12); x.lineTo(22, 18); x.lineTo(13, 20); x.closePath(); x.fill();           // lit top facet
      x.fillStyle = "#2c2c3a"; x.beginPath(); x.moveTo(22, 18); x.lineTo(26, 23); x.lineTo(23, 33); x.lineTo(18, 30); x.closePath(); x.fill();           // shaded lower facet
      x.fillStyle = "#32323e"; x.beginPath(); x.moveTo(5, 33); x.lineTo(7, 26); x.lineTo(11, 28); x.lineTo(10, 33); x.closePath(); x.fill();             // secondary chunk
      x.strokeStyle = "rgba(127,227,255,0.35)"; x.lineWidth = 3; x.beginPath(); x.moveTo(15, 17); x.lineTo(18, 25); x.lineTo(16, 31); x.stroke();         // crack glow halo
      x.strokeStyle = "#aef0ff"; x.lineWidth = 1; x.beginPath(); x.moveTo(15, 17); x.lineTo(18, 25); x.lineTo(16, 31); x.stroke();                        // crack core
      dot(15, 17, 1, "#dffaff"); dot(18, 25, 0.9, "#dffaff");                                                                                             // crack sparks
    }
    const t = new THREE.CanvasTexture(c); t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.colorSpace = THREE.SRGBColorSpace;
    this._propTex.set(kind, t); return t;
  }

  // A 3D treasure chest (base + lid) with an opened state.
  addChest(tileX: number, tileY: number, opened: boolean, onInteract: () => void, radius = 1.4): { setOpened: () => void; marker: Marker } {
    const grp = new THREE.Group();
    grp.position.set(tileX, 0, tileY);
    const baseMat = new THREE.MeshStandardMaterial({ color: 0x8a5a2a, roughness: 0.7, metalness: 0.1 });
    const lidMat = new THREE.MeshStandardMaterial({ color: 0xd8a24a, roughness: 0.55, metalness: 0.15, emissive: 0x4a3410, emissiveIntensity: 0.5 });
    const base = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.44, 0.52), baseMat);
    base.position.y = 0.22; base.castShadow = true;
    const lid = new THREE.Mesh(new THREE.BoxGeometry(0.76, 0.2, 0.56), lidMat);
    lid.position.y = 0.54; lid.castShadow = true;
    grp.add(base, lid);
    // twinkling "loot here" sparkle floating over an unopened chest
    const sparkle = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glowTex(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, color: 0xfff0b0, opacity: 0.85 }));
    sparkle.scale.set(0.7, 0.7, 1);
    sparkle.position.set(0, 1.1, 0);
    sparkle.userData.float = true; sparkle.userData.baseY = 1.1; sparkle.userData.phase = tileX + tileY;
    grp.add(sparkle);
    this.worldGroup.add(grp);
    const setOpened = () => { lid.rotation.x = -1.2; lid.position.set(0, 0.5, -0.28); lidMat.color.set(0x6a5430); lidMat.emissiveIntensity = 0; sparkle.visible = false; };
    if (opened) setOpened();
    const mk: Marker = { x: tileX, y: tileY, radius, label: "Chest", onInteract, sprite: grp };
    this.markers.push(mk);
    return { setOpened, marker: mk };
  }

  stop(): void { this.running = false; }

  private nearest(): Marker | null {
    let best: Marker | null = null;
    let bd = Infinity;
    for (const m of this.markers) {
      const d = Math.hypot(m.x - this.px, m.y - this.pz);
      if (d <= m.radius && d < bd) { best = m; bd = d; }
    }
    return best;
  }

  setLocked(v: boolean): void { this.locked = v; }

  // ---- touch input (on-screen controls drive these) --------------------
  // Analog move vector from the joystick; components in roughly [-1, 1].
  setMoveVector(x: number, z: number): void { this.touchVec.x = x; this.touchVec.z = z; }
  // The on-screen "A" button: interact with the nearest marker (same as [E]).
  pressInteract(): void { if (!this.locked) this.nearest()?.onInteract(); }
  // The on-screen mount button: whistle for / dismiss the chocobo when allowed.
  toggleMount(): void { if (this.canMount && !this.locked) this.setMounted(!this.mounted); }
  canRide(): boolean { return this.canMount; }

  // Current player tile position (used by the cutscene director to frame shots).
  playerPos(): [number, number] { return [this.px, this.pz]; }

  // ---- cinematics: scripted camera + staged actors ----------------------

  // Generic eased tween, ticked from update(). `step(k)` receives an eased 0..1.
  private tween(ms: number, step: (k: number) => void): Promise<void> {
    return new Promise<void>((resolve) => {
      if (ms <= 0) { step(1); resolve(); return; }
      this.tweens.push({ t: 0, dur: ms / 1000, step, done: resolve });
    });
  }

  // Suspends the follow camera so cameraFocus/actor tweens fully own the frame.
  // Also locks player input and seeds the look target from the live framing.
  enterCinematic(): void {
    this.cinematic = true;
    this.locked = true;
    this.keys.clear();
    this.camLook.set(this.px, 0.6, this.pz - 1);
    this.cinePrevPx = this.px;
    this.cinePrevPz = this.pz;
  }

  // Eases the camera back onto the player, then hands control back to follow.
  async exitCinematic(): Promise<void> {
    const fromPos = this.camera.position.clone();
    const fromLook = this.camLook.clone();
    const toPos = new THREE.Vector3(this.px, 10.5, this.pz + 9.5);
    const toLook = new THREE.Vector3(this.px, 0.6, this.pz - 1);
    await this.tween(700, (k) => {
      this.camera.position.lerpVectors(fromPos, toPos, k);
      this.camLook.lerpVectors(fromLook, toLook, k);
      this.camera.lookAt(this.camLook);
    });
    this.cinematic = false;
    this.locked = false;
  }

  // Eases the camera to frame a world point. `dist`/`height` set the 3/4 offset;
  // `side` shifts laterally (for two-shots); negative `dist` pushes in close.
  cameraFocus(
    targetX: number,
    targetZ: number,
    opts: { dist?: number; height?: number; side?: number; ms?: number } = {},
  ): Promise<void> {
    const dist = opts.dist ?? 9.5;
    const height = opts.height ?? 10.5;
    const side = opts.side ?? 0;
    const fromPos = this.camera.position.clone();
    const fromLook = this.camLook.clone();
    const toPos = new THREE.Vector3(targetX + side, height, targetZ + dist);
    const toLook = new THREE.Vector3(targetX, 0.6, targetZ - 1);
    return this.tween(opts.ms ?? 900, (k) => {
      this.camera.position.lerpVectors(fromPos, toPos, k);
      this.camLook.lerpVectors(fromLook, toLook, k);
      this.camera.lookAt(this.camLook);
    });
  }

  // A decaying camera shake (rumble/impact beat).
  shake(mag = 0.5, ms = 480): void {
    this.shakeMag = mag;
    this.shakeDur = this.shakeT = ms / 1000;
  }

  // Spawns a billboard actor the director can walk around the stage.
  addCutsceneActor(tileX: number, tileY: number, texUrl: string, height = 1.7): CutsceneActor {
    const mat = new THREE.SpriteMaterial({ transparent: true, depthWrite: false });
    this.loadTex(texUrl).then((t) => { mat.map = t; mat.needsUpdate = true; });
    const spr = new THREE.Sprite(mat);
    const baseY = height / 2 + 0.04;
    spr.scale.set(height * 0.72, height, 1);
    spr.position.set(tileX, baseY, tileY);
    this.worldGroup.add(spr);
    this.actors.push(spr);
    const st = { x: tileX, z: tileY };
    const setFace = (dx: number) => {
      if (dx < -0.01) spr.scale.x = -Math.abs(spr.scale.x);
      else if (dx > 0.01) spr.scale.x = Math.abs(spr.scale.x);
    };
    return {
      walkTo: (tx, ty, ms) => {
        const fx = st.x, fz = st.z;
        setFace(tx - fx);
        const steps = Math.max(1, Math.hypot(tx - fx, ty - fz) * 1.6);
        return this.tween(ms, (k) => {
          st.x = fx + (tx - fx) * k; st.z = fz + (ty - fz) * k;
          const hop = Math.abs(Math.sin(k * Math.PI * steps)) * 0.1;
          spr.position.set(st.x, baseY + hop, st.z);
        });
      },
      setPos: (tx, ty) => { st.x = tx; st.z = ty; spr.position.set(tx, baseY, ty); },
      hop: () => this.tween(360, (k) => { spr.position.y = baseY + Math.sin(k * Math.PI) * 0.5; }),
      face: (dir) => { spr.scale.x = (dir === "l" ? -1 : 1) * Math.abs(spr.scale.x); },
      remove: () => {
        this.worldGroup.remove(spr); mat.dispose();
        const i = this.actors.indexOf(spr); if (i >= 0) this.actors.splice(i, 1);
      },
    };
  }

  // A pseudo-actor that drives the real hero sprite by tweening px/pz, so the
  // player walks on script (the walk-cycle animation triggers off the motion).
  cutscenePlayer(): CutsceneActor {
    return {
      walkTo: (tx, ty, ms) => {
        const fx = this.px, fz = this.pz;
        return this.tween(ms, (k) => { this.px = fx + (tx - fx) * k; this.pz = fz + (ty - fz) * k; });
      },
      setPos: (tx, ty) => { this.px = tx; this.pz = ty; },
      hop: () => this.tween(360, () => {}),
      face: (dir) => { this.heroPlayerFlipL = dir === "l"; },
      remove: () => {},
    };
  }

  // A one-shot proximity trigger (used to fire a mid-field story beat).
  addTrigger(tileX: number, tileY: number, radius: number, onEnter: () => void): void {
    this.triggers.push({ x: tileX, z: tileY, r: radius, fired: false, onEnter });
  }
  clearTriggers(): void { this.triggers.length = 0; }

  // ---- input + loop -----------------------------------------------------

  private bindInput(): void {
    window.addEventListener("keydown", (e) => {
      const k = e.key.toLowerCase();
      if (this.locked) return;
      if (k === "e" || k === " " || k === "enter") { this.nearest()?.onInteract(); return; }
      if (k === "escape" || k === "m") { this.onMenuKey(); return; }
      if (k === "c" && this.canMount) { this.setMounted(!this.mounted); return; } // whistle/dismount chocobo
      this.keys.add(k);
    });
    window.addEventListener("keyup", (e) => this.keys.delete(e.key.toLowerCase()));
    window.addEventListener("resize", () => this.resize());
  }

  private blocked(x: number, z: number): boolean {
    const tx = Math.round(x), tz = Math.round(z);
    if (tx < 0 || tz < 0 || tx >= this.W || tz >= this.H) return true;
    if (this.propBlocked.has(`${tx},${tz}`)) return true;
    const gid = this.decor[tz * this.W + tx] ?? 0;
    if (this.mounted && gid === 5) return false; // chocobo wades across water
    return BLOCKED.has(gid);
  }

  /**
   * Every floor tile the player can actually walk to from the current spawn,
   * found by a 4-neighbour flood fill over non-blocked tiles. Scenes use this to
   * scatter encounter markers across a map's open space (instead of a single
   * row) while guaranteeing each one is reachable. Call after loadMap().
   */
  reachableSpots(): [number, number][] {
    const sx = Math.round(this.px), sz = Math.round(this.pz);
    const out: [number, number][] = [];
    const seen = new Set<string>([`${sx},${sz}`]);
    const q: [number, number][] = [[sx, sz]];
    for (let head = 0; head < q.length; head++) {
      const [x, z] = q[head];
      out.push([x, z]);
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as [number, number][]) {
        const nx = x + dx, nz = z + dz, key = `${nx},${nz}`;
        if (seen.has(key)) continue;
        seen.add(key);
        if (!this.blocked(nx, nz)) q.push([nx, nz]);
      }
    }
    return out;
  }

  update(dt: number): void {
    this.clockT += dt;
    // advance scripted cinematic tweens first so px/pz + camera reflect this frame
    for (let i = this.tweens.length - 1; i >= 0; i--) {
      const tw = this.tweens[i];
      tw.t += dt;
      const k = Math.min(1, tw.t / tw.dur);
      tw.step(easeInOut(k));
      if (k >= 1) { this.tweens.splice(i, 1); tw.done(); }
    }
    let vx = 0, vz = 0;
    if (!this.locked) {
      const k = this.keys;
      if (k.has("arrowleft") || k.has("a")) vx -= 1;
      if (k.has("arrowright") || k.has("d")) vx += 1;
      if (k.has("arrowup") || k.has("w")) vz -= 1;
      if (k.has("arrowdown") || k.has("s")) vz += 1;
      vx += this.touchVec.x; vz += this.touchVec.z; // on-screen joystick (touch)
    }
    const mag = Math.hypot(vx, vz);
    const keyMoving = mag > 0.001;
    if (keyMoving) {
      const f = Math.min(1, mag); // analog: a partial joystick push walks slower
      const ux = vx / mag, uz = vz / mag;
      const sp = (this.mounted ? 8.6 : 5) * f, nx = this.px + ux * sp * dt, nz = this.pz + uz * sp * dt;
      if (!this.blocked(nx, this.pz)) this.px = nx;
      if (!this.blocked(this.px, nz)) this.pz = nz;
    }
    // During a cinematic the hero is walked by a scripted tween (px/pz move with
    // no key input) — detect that motion so the walk cycle + facing still play.
    let moving = keyMoving;
    if (this.cinematic) {
      const dpx = this.px - this.cinePrevPx;
      if (Math.hypot(dpx, this.pz - this.cinePrevPz) > 1e-4) {
        moving = true;
        if (dpx < -1e-3) this.heroPlayerFlipL = true;
        else if (dpx > 1e-3) this.heroPlayerFlipL = false;
      }
    }
    this.cinePrevPx = this.px; this.cinePrevPz = this.pz;
    if (this.player) {
      this.walkT += dt * (moving ? 11 : 2.4);
      const ride = this.mounted ? 0.95 : 0; // sit atop the chocobo when riding
      const faceY = Math.atan2(this.camera.position.x - this.px, this.camera.position.z - this.pz);
      if (this.playerHero && this.heroIdleTex && this.heroWalkTex) {
        // Project-owned hero sheet: 9-frame strip per state. Swap the mesh's
        // texture map between idle (slow breathe) and walk (faster cycle), and
        // advance offset.x to play the active frame.
        const fps = moving ? 9 : 4;
        const f = Math.floor(this.clockT * fps) % HERO_FRAMES;
        const tex = moving ? this.heroWalkTex : this.heroIdleTex;
        const mat = this.player.material as THREE.MeshStandardMaterial;
        // Keep map and emissiveMap pointed at the SAME texture object so the
        // emissive self-lit floor animates in lockstep with the diffuse frame
        // (advancing tex.offset.x below moves both).
        if (mat.map !== tex) { mat.map = tex; mat.emissiveMap = tex; mat.needsUpdate = true; }
        tex.offset.x = f / HERO_FRAMES;
        if (moving) this.emitDust(dt);
        this.player.position.set(this.px, 0.04 + ride, this.pz);
        // hero side-walk sheet faces RIGHT by default; mirror when moving left.
        // We pick the screen-space sign of motion (the camera looks down -z, so
        // world +x is screen-right). vx already gives this.
        if (vx < -0.1) this.heroPlayerFlipL = true;
        else if (vx > 0.1) this.heroPlayerFlipL = false;
        const flip = this.heroPlayerFlipL ? -1 : 1;
        this.player.scale.set(flip, 1, 1);
        // hero is a billboard-style plane facing camera (no faceY rotation —
        // the mirror handles direction)
        this.player.rotation.set(0, 0, 0);
      } else if (this.playerLpc && this.playerTex) {
        // real LPC walk cycle: idle = frame 0, walking = frames 1..8 of the down row
        const wf = moving ? 1 + (Math.floor(this.clockT * 9) % LPC.walkFrames) : 0;
        this.playerTex.offset.set(...lpcOffset(wf, LPC.walkDownRow));
        if (moving) this.emitDust(dt);
        this.player.position.set(this.px, 0.04 + ride, this.pz);
        this.player.scale.set(1, 1, 1);
        this.player.rotation.set(0, faceY, 0);
      } else {
        let sx = 1, sy = 1, bob = 0, lean = 0;
        if (moving) {
          bob = Math.abs(Math.sin(this.walkT)) * 0.16;
          const sq = Math.sin(this.walkT * 2) * 0.06;
          sx = 1 - sq; sy = 1 + sq;
          lean = Math.sin(this.walkT) * 0.07;
          this.emitDust(dt);
        } else {
          const breathe = Math.sin(this.walkT) * 0.022;
          sy = 1 + breathe; sx = 1 - breathe * 0.5;
          bob = (Math.sin(this.walkT) + 1) * 0.012;
        }
        this.player.position.set(this.px, 0.04 + ride + bob, this.pz);
        this.player.scale.set(sx, sy, 1);
        this.player.rotation.y = faceY;
        this.player.rotation.z = lean;
      }
      if (this.mountSprite && this.mounted) {
        const hop = moving ? Math.abs(Math.sin(this.walkT)) * 0.12 : Math.sin(this.clockT * 3) * 0.03;
        this.mountSprite.position.set(this.px, 0.02 + hop, this.pz);
      }
      this.playerGlow.position.set(this.px, 0.02 + ride, this.pz - 0.05);
      (this.playerGlow.material as THREE.SpriteMaterial).opacity = 0.34 + Math.sin(this.clockT * 2.5) * 0.06;
      this.shadow.position.set(this.px, 0.03, this.pz);
      const shs = moving ? 1 - Math.abs(Math.sin(this.walkT)) * 0.14 : 1;
      this.shadow.scale.set(shs, shs, 1);
      this.playerLight.position.set(this.px, 2.4, this.pz);
    }
    if (!this.cinematic) {
      const drift = Math.sin(this.clockT * 0.25) * 1.1;
      this.camera.position.lerp(new THREE.Vector3(this.px + drift, 10.5, this.pz + 9.5), 1 - Math.pow(0.0016, dt));
      this.camLook.set(this.px, 0.6, this.pz - 1);
      this.camera.lookAt(this.camLook);
    }
    this.applyShake(dt);
    // Backdrop/parallax/bokeh track the framed point (the player, or the look
    // target during a cutscene so distant layers stay anchored to the shot).
    const fxp = this.cinematic ? this.camLook.x : this.px;
    const fzp = this.cinematic ? this.camLook.z : this.pz;
    const bd = this.worldGroup.getObjectByName("backdrop");
    if (bd) { bd.position.set(fxp, 16, fzp - 46); bd.quaternion.copy(this.camera.quaternion); }
    const px2 = this.worldGroup.getObjectByName("parallax");
    if (px2) { px2.position.set(fxp * 0.35, 15, fzp - 64); px2.quaternion.copy(this.camera.quaternion); }
    (this.bokeh.uniforms as Record<string, { value: number }>).focus.value = this.camera.position.distanceTo(new THREE.Vector3(fxp, 0.6, fzp));

    // living atmosphere: drifting motes, pulsing crystals, hovering markers
    if (this.motes) {
      const attr = this.motes.geometry.getAttribute("position") as THREE.BufferAttribute;
      const arr = attr.array as Float32Array;
      for (let i = 0; i < this.moteSpeeds.length; i++) {
        let y = arr[i * 3 + 1] + this.moteSpeeds[i] * dt;
        if (y > 9) y = 0.4;
        arr[i * 3 + 1] = y;
        arr[i * 3] += Math.sin(this.clockT * 0.6 + i) * dt * 0.22;
      }
      attr.needsUpdate = true;
    }
    const pulse = 0.72 + Math.sin(this.clockT * 2.2) * 0.28;
    if (this.crystalMat) this.crystalMat.emissiveIntensity = 1.5 * pulse;
    for (const l of this.crystalLights) l.intensity = 5 * pulse;
    this.worldGroup.traverse((c) => {
      const ud = c.userData;
      if (ud && ud.float) c.position.y = ud.baseY + Math.sin(this.clockT * 2 + ud.phase) * 0.12;
    });
    // 2-frame idle animation for enemy/creature sheets (gentle breathe)
    if (this.sheetTex.size) { const fx = (Math.floor(this.clockT * 2.6) % 2) * 0.5; for (const t of this.sheetTex) t.offset.x = fx; }
    // flickering lantern lights on buildings
    for (const b of this.buildingLights) {
      b.light.intensity = b.base * (0.82 + Math.sin(this.clockT * 9 + b.phase) * 0.1 + Math.random() * 0.08);
    }
    // age + fade step-dust puffs
    for (let i = this.dust.length - 1; i >= 0; i--) {
      const d = this.dust[i]; d.t += dt;
      d.spr.position.y += dt * 0.5;
      (d.spr.material as THREE.SpriteMaterial).opacity = Math.max(0, 0.5 - d.t);
      const s = 0.5 + d.t * 1.2; d.spr.scale.set(s, s, 1);
      if (d.t > 0.5) { this.worldGroup.remove(d.spr); this.dust.splice(i, 1); }
    }

    // one-shot proximity triggers (mid-field story beat); paused during cutscenes
    if (!this.cinematic && this.triggers.length) {
      for (const tr of this.triggers) {
        if (tr.fired) continue;
        if (Math.hypot(this.px - tr.x, this.pz - tr.z) <= tr.r) { tr.fired = true; tr.onEnter(); }
      }
    }

    // roaming encounters: wander near spawn, chase the player within aggro range,
    // and start their battle on contact. Frozen during cutscenes / while locked.
    if (!this.cinematic && !this.locked && this.roamers.length) {
      const AGGRO = 4.8, CONTACT = 0.72, LEASH = 3.4, CHASE = 3.5, WANDER = 1.7;
      for (const r of this.roamers) {
        if (r.fired) continue;
        const distP = Math.hypot(this.px - r.x, this.pz - r.z);
        if (distP <= CONTACT) { r.trigger(); break; } // caught the player → fight
        let goalX: number, goalZ: number, speed: number;
        if (distP <= AGGRO) {
          goalX = this.px; goalZ = this.pz; speed = CHASE; // give chase
        } else {
          r.wait -= dt; // wander: retarget when the timer lapses or we arrive
          if (r.wait <= 0 || Math.hypot(r.tx - r.x, r.tz - r.z) < 0.4) {
            let found = false;
            for (let a = 0; a < 6 && !found; a++) {
              const ang = Math.random() * Math.PI * 2, rad = 0.8 + Math.random() * LEASH;
              const cx = r.spawnX + Math.cos(ang) * rad, cz = r.spawnZ + Math.sin(ang) * rad;
              if (!this.blocked(cx, cz)) { r.tx = cx; r.tz = cz; found = true; }
            }
            if (!found) { r.tx = r.spawnX; r.tz = r.spawnZ; }
            r.wait = 1.4 + Math.random() * 2.2;
          }
          goalX = r.tx; goalZ = r.tz; speed = WANDER;
        }
        const dx = goalX - r.x, dz = goalZ - r.z, L = Math.hypot(dx, dz);
        let movingR = false;
        if (L > 0.06) {
          const ux = dx / L, uz = dz / L;
          const nx = r.x + ux * speed * dt, nz = r.z + uz * speed * dt;
          if (!this.blocked(nx, r.z)) { r.x = nx; movingR = true; }
          if (!this.blocked(r.x, nz)) { r.z = nz; movingR = true; }
          if (ux < -0.05) r.flipL = true; else if (ux > 0.05) r.flipL = false;
        }
        // sync the marker (drives [E] interaction + hint) and the visuals
        r.mk.x = r.x; r.mk.y = r.z;
        const bob = movingR ? Math.abs(Math.sin(this.clockT * 8 + r.phase)) * 0.07 : 0;
        r.mk.sprite.position.set(r.x, 0.05 + bob, r.z);
        r.mk.sprite.scale.x = (r.flipL ? -1 : 1) * r.baseW;
        r.label.position.x = r.x; r.label.position.z = r.z;
        r.shadow.position.set(r.x, 0.02, r.z);
      }
    }

    this.onInteractHint(this.cinematic ? null : this.nearest()?.label ?? null);
  }

  private applyShake(dt: number): void {
    if (this.shakeT <= 0) return;
    this.shakeT -= dt;
    const m = this.shakeMag * Math.max(0, this.shakeT / this.shakeDur);
    this.camera.position.x += (Math.random() - 0.5) * m;
    this.camera.position.y += (Math.random() - 0.5) * m;
    this.camera.lookAt(this.camLook);
  }

  private emitDust(dt: number): void {
    this.dustClock += dt;
    if (this.dustClock < 0.16) return;
    this.dustClock = 0;
    const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.dustTex(), transparent: true, depthWrite: false, opacity: 0.5 }));
    spr.scale.set(0.5, 0.5, 1);
    spr.position.set(this.px + (Math.random() - 0.5) * 0.3, 0.12, this.pz + 0.2);
    this.worldGroup.add(spr);
    this.dust.push({ spr, t: 0 });
  }

  render(): void { this.composer.render(); }
  renderOnce(dt = 1 / 60): void { this.update(dt); this.render(); }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    const loop = (t: number) => {
      if (!this.running) return;
      const dt = Math.min(0.05, (t - this.last) / 1000);
      this.last = t;
      this.update(dt); this.render();
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  private buildPostFX(): void {
    this.composer = new EffectComposer(this.renderer);
    // Match the composer's pixel ratio to the renderer's; otherwise on retina
    // displays the composer renders into a (W×H) target while the canvas is
    // (W*DPR × H*DPR) and the post-processed image ends up in the upper-left
    // quadrant of the canvas.
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    const s = this.renderer.getSize(new THREE.Vector2());
    this.composer.addPass(new UnrealBloomPass(new THREE.Vector2(s.x, s.y), 0.8, 0.6, 0.85));
    this.bokeh = new BokehPass(this.scene, this.camera, { focus: 18, aperture: 0.0014, maxblur: 0.009 });
    this.composer.addPass(this.bokeh);
    this.composer.addPass(new ShaderPass(VIGNETTE));
    this.composer.addPass(new ShaderPass(GRADE));
    this.composer.addPass(new OutputPass());
  }

  private resize(): void {
    const w = this.mount.clientWidth || window.innerWidth, h = this.mount.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h);
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // ---- generated textures ----------------------------------------------

  private makeSky(sky: [number, number, number]): THREE.Texture {
    const hex = (n: number) => "#" + (n & 0xffffff).toString(16).padStart(6, "0");
    const c = document.createElement("canvas"); c.width = 4; c.height = 256;
    const x = c.getContext("2d")!;
    const g = x.createLinearGradient(0, 0, 0, 256);
    g.addColorStop(0, hex(sky[0])); g.addColorStop(0.5, hex(sky[1])); g.addColorStop(1, hex(sky[2]));
    x.fillStyle = g; x.fillRect(0, 0, 4, 256);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  }

  private makeBlob(): THREE.Texture {
    const s = 64, c = document.createElement("canvas"); c.width = s; c.height = s;
    const x = c.getContext("2d")!;
    const g = x.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    g.addColorStop(0, "rgba(0,0,0,0.7)"); g.addColorStop(1, "rgba(0,0,0,0)");
    x.fillStyle = g; x.fillRect(0, 0, s, s);
    return new THREE.CanvasTexture(c);
  }

  private makeMote(): THREE.Texture {
    const s = 32, h = s / 2, c = document.createElement("canvas"); c.width = s; c.height = s;
    const x = c.getContext("2d")!;
    // soft core
    const g = x.createRadialGradient(h, h, 0, h, h, h);
    g.addColorStop(0, "rgba(255,255,255,1)"); g.addColorStop(0.35, "rgba(255,255,255,0.5)"); g.addColorStop(1, "rgba(255,255,255,0)");
    x.fillStyle = g; x.fillRect(0, 0, s, s);
    // 4-point twinkle (sparkle) for a more magical ambient mote
    const sp = x.createLinearGradient(0, h, s, h);
    sp.addColorStop(0, "rgba(255,255,255,0)"); sp.addColorStop(0.5, "rgba(255,255,255,0.9)"); sp.addColorStop(1, "rgba(255,255,255,0)");
    x.fillStyle = sp; x.fillRect(0, h - 0.6, s, 1.2);
    const sv = x.createLinearGradient(h, 0, h, s);
    sv.addColorStop(0, "rgba(255,255,255,0)"); sv.addColorStop(0.5, "rgba(255,255,255,0.9)"); sv.addColorStop(1, "rgba(255,255,255,0)");
    x.fillStyle = sv; x.fillRect(h - 0.6, 0, 1.2, s);
    return new THREE.CanvasTexture(c);
  }

  private makeMarkerTex(color: string, letter: string, label: string): THREE.Texture {
    const W = 128, H = 128, c = document.createElement("canvas"); c.width = W; c.height = H;
    const x = c.getContext("2d")!;
    // token box
    x.fillStyle = "rgba(20,16,40,0.92)";
    x.strokeStyle = color; x.lineWidth = 4;
    x.beginPath(); x.roundRect(40, 30, 48, 52, 6); x.fill(); x.stroke();
    x.fillStyle = color; x.font = "bold 30px monospace"; x.textAlign = "center"; x.textBaseline = "middle";
    x.fillText(letter, 64, 56);
    // label
    x.font = "bold 16px monospace"; x.fillStyle = "#e8e2ff";
    x.strokeStyle = "#05030d"; x.lineWidth = 4; x.strokeText(label, 64, 100); x.fillText(label, 64, 100);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  }

  private makeIconTex(kind: PlaceKind, color: string, label: string, badge?: "check" | "lock"): THREE.Texture {
    const W = 128, H = 128, c = document.createElement("canvas"); c.width = W; c.height = H;
    const x = c.getContext("2d")!;
    const cx = 64, cy = 48, R = 27;
    // soft glow halo
    x.globalAlpha = 0.3; x.fillStyle = color;
    x.beginPath(); x.arc(cx, cy, R + 7, 0, Math.PI * 2); x.fill(); x.globalAlpha = 1;
    // emblem disc
    x.fillStyle = "rgba(18,14,38,0.95)"; x.strokeStyle = color; x.lineWidth = 4;
    x.beginPath(); x.arc(cx, cy, R, 0, Math.PI * 2); x.fill(); x.stroke();
    // icon
    x.save(); x.translate(cx, cy); x.strokeStyle = color; x.fillStyle = color;
    x.lineWidth = 3; x.lineJoin = "round"; x.lineCap = "round";
    this.drawIcon(x, kind);
    x.restore();
    if (badge) this.drawBadge(x, cx + R - 3, cy - R + 3, badge);
    // label
    x.font = "bold 16px monospace"; x.textAlign = "center"; x.textBaseline = "middle";
    x.lineWidth = 4; x.strokeStyle = "#05030d"; x.strokeText(label, 64, 102);
    x.fillStyle = "#e8e2ff"; x.fillText(label, 64, 102);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  }

  // Draws a 32-ish px icon centred at the current origin.
  private drawIcon(x: CanvasRenderingContext2D, kind: PlaceKind): void {
    const dark = "#0a0814";
    switch (kind) {
      case "town": // house
        x.beginPath(); x.moveTo(-13, -2); x.lineTo(0, -15); x.lineTo(13, -2); x.closePath(); x.fill();
        x.fillRect(-10, -2, 20, 15);
        x.fillStyle = dark; x.fillRect(-3, 5, 6, 8);
        break;
      case "gate": // archway
        x.lineWidth = 4;
        x.beginPath(); x.moveTo(-12, 14); x.lineTo(-12, -3); x.arc(0, -3, 12, Math.PI, 0); x.lineTo(12, 14); x.stroke();
        x.fillRect(-15, 13, 30, 4);
        break;
      case "cave": // hill with a dark mouth
        x.beginPath(); x.moveTo(-17, 14); x.quadraticCurveTo(0, -17, 17, 14); x.closePath(); x.fill();
        x.fillStyle = dark; x.beginPath(); x.moveTo(-7, 14); x.quadraticCurveTo(0, 0, 7, 14); x.closePath(); x.fill();
        break;
      case "vault": // vault door
        x.beginPath(); x.arc(0, 0, 13, 0, Math.PI * 2); x.stroke();
        x.beginPath(); x.arc(0, 0, 5, 0, Math.PI * 2); x.stroke();
        for (let a = 0; a < 8; a++) { const g = a * Math.PI / 4; x.beginPath(); x.arc(Math.cos(g) * 13, Math.sin(g) * 13, 1.7, 0, Math.PI * 2); x.fill(); }
        break;
      case "boss": // skull
        x.beginPath(); x.arc(0, -3, 12, 0, Math.PI * 2); x.fill(); x.fillRect(-6, 7, 12, 6);
        x.fillStyle = dark; x.beginPath(); x.arc(-5, -4, 3.2, 0, Math.PI * 2); x.arc(5, -4, 3.2, 0, Math.PI * 2); x.fill();
        x.fillRect(-1.6, 1, 3.2, 5);
        break;
      case "back": // left arrow
        x.lineWidth = 5; x.beginPath(); x.moveTo(9, -10); x.lineTo(-8, 0); x.lineTo(9, 10); x.stroke();
        break;
      case "arena": // crossed swords (training)
        x.lineWidth = 3.4; x.lineCap = "round";
        x.beginPath(); x.moveTo(-12, 12); x.lineTo(12, -12); x.moveTo(12, 12); x.lineTo(-12, -12); x.stroke();
        x.lineWidth = 5; // guards
        x.beginPath(); x.moveTo(-15, 9); x.lineTo(-9, 15); x.moveTo(15, 9); x.lineTo(9, 15); x.stroke();
        break;
      case "spire": // tower with a pointed roof
        x.beginPath(); x.moveTo(-8, 14); x.lineTo(-8, -4); x.lineTo(8, -4); x.lineTo(8, 14); x.closePath(); x.fill();
        x.beginPath(); x.moveTo(-11, -4); x.lineTo(0, -16); x.lineTo(11, -4); x.closePath(); x.fill(); // roof
        x.fillStyle = dark; x.fillRect(-3, 5, 6, 9); // door
        break;
    }
  }

  private drawBadge(x: CanvasRenderingContext2D, bx: number, by: number, badge: "check" | "lock"): void {
    x.fillStyle = badge === "check" ? "#4dff9e" : "#7a6f98";
    x.beginPath(); x.arc(bx, by, 10, 0, Math.PI * 2); x.fill();
    x.strokeStyle = "#05030d"; x.lineWidth = 2; x.stroke();
    x.strokeStyle = "#05030d"; x.lineWidth = 2.5; x.lineCap = "round";
    if (badge === "check") { x.beginPath(); x.moveTo(bx - 4, by); x.lineTo(bx - 1, by + 4); x.lineTo(bx + 5, by - 4); x.stroke(); }
    else { x.lineWidth = 2; x.strokeRect(bx - 3.5, by - 1, 7, 6); x.beginPath(); x.arc(bx, by - 1, 3, Math.PI, 0); x.stroke(); }
  }

  private makeLabelTex(label: string, color: string): THREE.Texture {
    const W = 192, H = 64, c = document.createElement("canvas"); c.width = W; c.height = H;
    const x = c.getContext("2d")!;
    x.font = "bold 22px monospace"; x.textAlign = "center"; x.textBaseline = "middle";
    x.lineWidth = 5; x.strokeStyle = "#05030d"; x.strokeText(label, W / 2, H / 2);
    x.fillStyle = color; x.fillText(label, W / 2, H / 2);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  }
}
