import { runState } from "./game/runState";
import * as leveling from "./game/leveling";
import { audio } from "./audio/AudioEngine";

// Arsandi Code now boots straight into the Three.js HD-2D game. A scene can be
// jumped to for testing via ?scene=town|world|stage-1 (or the legacy ?3d=...).
const params = new URLSearchParams(location.search);
const sceneId = params.get("scene") || params.get("3d") || "title";

const mount = document.createElement("div");
mount.style.cssText = "position:fixed;inset:0;background:#08060f";
document.body.appendChild(mount);

import("./three/scenes3d").then(async ({ Game3D }) => {
  const g = new Game3D(mount);
  await g.startAt(sceneId);
  (window as unknown as { __game3d: unknown; __world3d: unknown }).__game3d = g;
  (window as unknown as { __world3d: unknown }).__world3d = g.engine;
});

// Browsers require a user gesture before audio can play; resume on first input.
const unlock = () => audio.unlock();
window.addEventListener("pointerdown", unlock);
window.addEventListener("keydown", unlock);

// Dev-only console handles; stripped from prod builds.
if (import.meta.env.DEV) {
  const w = window as unknown as { runState: typeof runState; leveling: typeof leveling; audio: typeof audio };
  w.runState = runState;
  w.leveling = leveling;
  w.audio = audio;
}
