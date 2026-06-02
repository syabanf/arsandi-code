import type {
  CharacterData,
  SkillData,
  SummonData,
  EnemyData,
  StageData,
  ItemData,
  ClassData,
} from "../types/game";

import charactersJson from "./characters.json";
import skillsJson from "./skills.json";
import summonsJson from "./summons.json";
import enemiesJson from "./enemies.json";
import stagesJson from "./stages.json";
import itemsJson from "./items.json";
import classesJson from "./classes.json";
import cutscenesJson from "./cutscenes.json";

export const characters = charactersJson as CharacterData[];
export const skills = skillsJson as SkillData[];
export const summons = summonsJson as SummonData[];
export const enemies = enemiesJson as EnemyData[];
export const stages = (stagesJson as StageData[]).sort((a, b) => a.index - b.index);
export const items = itemsJson as ItemData[];
export const classes = classesJson as ClassData[];

function index<T extends { id: string }>(rows: T[]): Record<string, T> {
  return Object.fromEntries(rows.map((r) => [r.id, r]));
}

export const charactersById = index(characters);
export const skillsById = index(skills);
export const summonsById = index(summons);
export const enemiesById = index(enemies);
export const stagesById = index(stages);
export const itemsById = index(items);
export const classesById = index(classes);

export const getCharacter = (id: string) => charactersById[id];
export const getSkill = (id: string) => skillsById[id];
export const getSummon = (id: string) => summonsById[id];
export const getEnemy = (id: string) => enemiesById[id];
export const getStage = (id: string) => stagesById[id];
export const getItem = (id: string) => itemsById[id];
export const getClass = (id: string) => classesById[id];

export const getCharacterSkills = (c: CharacterData): SkillData[] =>
  c.skills.map(getSkill).filter(Boolean);

// A single scripted beat in a cutscene. `text`/`speaker` are the dialogue;
// the rest are optional cinematic directives consumed by the cutscene director
// (Ui3D presentation + World3D staging). Unknown sfx/music keys safely no-op.
export interface CutsceneLine {
  speaker?: string | null;
  text: string;
  // Ui3D presentation
  emote?: "shake" | "bob" | "nod" | "flash" | "rise"; // animates the speaker's portrait
  fx?: "flash" | "shake" | "rumble" | "to-black" | "from-black"; // screen-level beat
  sfx?: string;   // one-shot sound keyed to the line
  music?: string; // swap the music bed at this line
  // World3D staging (the director maps these onto an eased camera move)
  shot?: "player" | "boss" | "ally" | "wide" | "two-shot" | [number, number];
  zoom?: number;  // 1 = default framing; <1 pushes in, >1 pulls wide
  hold?: number;  // ms to auto-advance a wordless action beat (text may be "")
}

export type CutsceneKind = "intro" | "outro" | "preboss" | "midfield" | "epilogue";
type CutsceneBeats = Partial<Record<CutsceneKind, CutsceneLine[]>>;
// Keyed by stage id (e.g. "stage-1".."stage-finale"), plus a reserved
// "prologue" entry whose `intro` plays once before the very first chapter.
type CutsceneMap = Record<string, CutsceneBeats>;
export const cutscenes = cutscenesJson as CutsceneMap;
export const getCutscene = (stageId: string, kind: CutsceneKind): CutsceneLine[] | undefined =>
  cutscenes[stageId]?.[kind];
