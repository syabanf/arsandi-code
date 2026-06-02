import { getCutscene, type CutsceneKind, type CutsceneLine } from "../data";
import type { DialogPage } from "../three/Ui3D";

// Re-export the presentable cutscene page so callers can pull it from either the
// story layer or the UI layer. The canonical shape lives in Ui3D (presentation).
export type { DialogPage };

// Maps story speakers to their portrait textures so cutscenes show a face.
const PORTRAIT_BY_NAME: Record<string, string> = {
  Saka: "portrait-saka",
  Kara: "portrait-kara",
  Zell: "portrait-zell",
};

function toPage(l: CutsceneLine): DialogPage {
  return {
    speaker: l.speaker ?? null,
    text: l.text,
    portrait: l.speaker ? PORTRAIT_BY_NAME[l.speaker] : undefined,
    emote: l.emote,
    fx: l.fx,
    sfx: l.sfx,
    music: l.music,
    shot: l.shot,
    zoom: l.zoom,
    hold: l.hold,
  };
}

// Returns the dialogue pages for a chapter beat (intro/outro/preboss/midfield/
// epilogue), or null if that chapter has no such scene.
export function cutscenePages(stageId: string, kind: CutsceneKind): DialogPage[] | null {
  const lines = getCutscene(stageId, kind);
  if (!lines || lines.length === 0) return null;
  return lines.map(toPage);
}

// The one-time opening prologue, played before the very first chapter.
export function prologuePages(): DialogPage[] | null {
  return cutscenePages("prologue", "intro");
}
