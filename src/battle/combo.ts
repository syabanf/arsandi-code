// Legend-of-Legaia-style combo scoring for summons. Pure and Three-free so it
// can be unit-tested in isolation. The player taps a short directional sequence
// into a fixed number of slots while a summon is being unleashed; contiguous
// runs that match a summon's known "arts" chain together and amplify the
// ultimate's power. This module turns the raw input into a power multiplier.

import type { ComboArt, ComboDir } from "../types/game";

export type ComboRank = "MISS" | "GOOD" | "GREAT" | "SUPERB" | "PERFECT";

export interface ComboResult {
  mult: number; // power multiplier applied to the ultimate (>= 1)
  filled: number; // how many slots the player actually used
  matched: string[]; // names of arts that landed, in chain order
  rank: ComboRank; // headline label derived from the multiplier
}

// Tuning knobs. A clean unleash with no input is exactly 1x (MISS = no bonus,
// no penalty). Each committed slot adds a little; matched arts add their bonus
// on top. The ceiling keeps even a flawless chain from trivialising fights.
export const MAX_MULT = 2.5;
const PER_SLOT = 0.05;

const RANKS: { min: number; rank: ComboRank }[] = [
  { min: 2.2, rank: "PERFECT" },
  { min: 1.7, rank: "SUPERB" },
  { min: 1.35, rank: "GREAT" },
  { min: 0, rank: "GOOD" },
];

function rankFor(mult: number, filled: number): ComboRank {
  if (filled === 0) return "MISS";
  for (const r of RANKS) if (mult >= r.min) return r.rank;
  return "GOOD";
}

const round2 = (n: number) => Math.round(n * 100) / 100;

// Score a directional input against a summon's arts.
//
// Matching is greedy and non-overlapping, longest-art-first: scanning left to
// right, at each position we take the longest art whose pattern starts there,
// bank its bonus, and skip past it. This lets short arts chain across the slots
// while a full-length signature (which equals its component arts tiled
// together) wins as a single, bigger hit when input cleanly.
export function scoreCombo(arts: ComboArt[], input: ComboDir[], slots: number): ComboResult {
  const cap = Math.max(0, Math.floor(slots));
  const seq = input.slice(0, cap);
  const filled = seq.length;

  const byLen = [...arts].sort((a, b) => b.seq.length - a.seq.length);
  const matched: string[] = [];
  let bonus = 0;

  for (let i = 0; i < seq.length; ) {
    let hit: ComboArt | undefined;
    for (const art of byLen) {
      const len = art.seq.length;
      if (len === 0 || len > seq.length - i) continue;
      let ok = true;
      for (let k = 0; k < len; k++) {
        if (seq[i + k] !== art.seq[k]) {
          ok = false;
          break;
        }
      }
      if (ok) {
        hit = art;
        break;
      }
    }
    if (hit) {
      matched.push(hit.name);
      bonus += hit.bonus;
      i += hit.seq.length;
    } else {
      i += 1;
    }
  }

  const raw = 1 + PER_SLOT * filled + bonus;
  const mult = Math.min(MAX_MULT, Math.max(1, round2(raw)));
  return { mult, filled, matched, rank: rankFor(mult, filled) };
}

// A combo distilled into what the engine needs to resolve a multi-hit attack:
// the overall damage multiplier, how many jab hits to spread it across (one per
// committed slot), and whether a matched art earns an emphasised finisher hit.
export interface ComboStrike {
  mult: number; // total damage multiplier (>= 1)
  jabs: number; // number of base hits (>= 1)
  finisher: boolean; // append a big finishing blow (true when an art landed)
}

export function comboToStrike(res: ComboResult): ComboStrike {
  return { mult: res.mult, jabs: Math.max(1, res.filled), finisher: res.matched.length > 0 };
}

// Spread a total damage value across `jabs` near-even hits, optionally appending
// a larger finisher (~40% of the total). Every entry is a positive integer and
// the finisher — when present — is always the biggest hit (a matched art needs
// at least two inputs, so there are always >= 2 jabs to share the remainder).
// Pure so the multi-hit split can be unit-reasoned in isolation.
export function splitHits(total: number, jabs: number, finisher: boolean): number[] {
  const n = Math.max(1, Math.floor(jabs));
  const t = Math.max(1, Math.round(total));
  if (!finisher || n === 1) {
    if (n === 1) return [t];
    const each = Math.max(1, Math.floor(t / n));
    const arr = Array.from({ length: n }, () => each);
    arr[n - 1] = Math.max(1, t - each * (n - 1));
    return arr;
  }
  const fin = Math.max(1, Math.round(t * 0.4));
  const rest = Math.max(n, t - fin); // keep every jab >= 1
  const each = Math.max(1, Math.floor(rest / n));
  const arr = Array.from({ length: n }, () => each);
  arr[n - 1] = Math.max(1, rest - each * (n - 1));
  arr.push(fin);
  return arr;
}
