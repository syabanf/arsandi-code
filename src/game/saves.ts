import { runState, type SaveData } from "./runState";

export const SLOT_COUNT = 3;
const key = (slot: number) => `arsandi-save-${slot}`;

interface StoredSave extends SaveData {
  savedAt: number;
  chapter: number;
  partyLevel: number;
}

export interface SlotInfo {
  exists: boolean;
  chapter: number;
  partyLevel: number;
  savedAt: number;
}

export function saveToSlot(slot: number): void {
  const stored: StoredSave = {
    ...runState.serialize(),
    savedAt: Date.now(),
    chapter: runState.chapterNumber,
    partyLevel: runState.party["saka"]?.level ?? 1,
  };
  try {
    localStorage.setItem(key(slot), JSON.stringify(stored));
  } catch {
    // storage unavailable / full — saving is best-effort
  }
}

export function loadFromSlot(slot: number): boolean {
  const raw = localStorage.getItem(key(slot));
  if (!raw) return false;
  try {
    runState.load(JSON.parse(raw) as SaveData);
    return true;
  } catch {
    return false;
  }
}

export function slotInfo(slot: number): SlotInfo {
  const raw = localStorage.getItem(key(slot));
  if (!raw) return { exists: false, chapter: 0, partyLevel: 0, savedAt: 0 };
  try {
    const d = JSON.parse(raw) as StoredSave;
    return { exists: true, chapter: d.chapter ?? 1, partyLevel: d.partyLevel ?? 1, savedAt: d.savedAt ?? 0 };
  } catch {
    return { exists: false, chapter: 0, partyLevel: 0, savedAt: 0 };
  }
}
