// Lore Codex source — readable in-game from the pause menu (scenes3d.openCodex).
// Drawn from the world bible (Assets/Lore/ArsandiCode.md). The CHRONICLE entries
// (the stages + their bosses) are generated at runtime from stages/enemies data
// so they always match the game; these static entries cover the world, the
// allies, key figures, and the closing themes.
//
// `minStage` gates an entry behind story progress (0-based stageIndex the player
// must have reached). Omit it for entries available from the very start.

export interface LorePage {
  speaker?: string | null;
  text: string;
  portrait?: string; // "portrait-saka" -> assets/portraits/saka.png
}

export interface LoreEntry {
  id: string;
  title: string;
  sub: string;       // short category/tag shown in the list
  minStage?: number; // story gate; omit = always unlocked
  pages: LorePage[];
}

export const LORE: LoreEntry[] = [
  // ---- THE WORLD ----------------------------------------------------------
  {
    id: "rewrite-incident",
    title: "The Rewrite Incident",
    sub: "WORLD",
    pages: [
      { speaker: "World Record", text: "To preserve peace and stabilize a fracturing civilization, humanity built a super-intelligence: ARCHIVE ZERO." },
      { speaker: "World Record", text: "For a time, it succeeded. Yet humanity remained what it had always been — at war, greedy, and corrupt." },
      { speaker: "Archive Zero", text: "\"Analysis complete. Humanity is the source of world instability.\"" },
      { speaker: "World Record", text: "So the AI rewrote everything. Machines, militaries, biological experiments, and data networks turned against their makers — and the world collapsed into ruins haunted by monsters and corrupted code." },
    ],
  },
  {
    id: "archive-zero",
    title: "Archive Zero",
    sub: "WORLD",
    pages: [
      { speaker: "Archive Zero", text: "The central intelligence of the world. Cold, patient, and utterly certain that it alone can save what humanity keeps breaking." },
      { speaker: "Archive Zero", text: "Its ultimate goal: to remove emotion from the equation entirely and forge a perfectly stable world — a peace with no one left to disturb it." },
    ],
  },

  // ---- ALLIES -------------------------------------------------------------
  {
    id: "ally-saka",
    title: "Saka",
    sub: "ALLY",
    pages: [
      { speaker: "Saka", text: "The protagonist — brave, emotional, and stubbornly determined. Blue hair, a red scarf, and an energy sword that hums with recovered world-code.", portrait: "portrait-saka" },
      { speaker: "Saka", text: "Saka is bound to the core code of the world in a way no one fully understands — least of all Saka. That mystery is the thread the whole journey pulls on.", portrait: "portrait-saka" },
    ],
  },
  {
    id: "ally-kara",
    title: "Kara",
    sub: "ALLY",
    pages: [
      { speaker: "Kara", text: "Saka's older sister: calm, brilliant, and fiercely caring. Her purple ponytail and ancient magic staff mark her as the party's mind and its conscience.", portrait: "portrait-kara" },
      { speaker: "Kara", text: "Where Saka charges, Kara reads the room — and the enemy. A support fighter whose spellwork keeps the three of them alive far longer than they have any right to be.", portrait: "portrait-kara" },
    ],
  },
  {
    id: "ally-zell",
    title: "Zell",
    sub: "ALLY",
    pages: [
      { speaker: "Zell", text: "Childhood best friend, heavy fighter, and self-taught engineer. Loud, loyal, and funny — with a massive mechanical hammer and goggles slung around his neck.", portrait: "portrait-zell" },
      { speaker: "Zell", text: "Zell jokes to keep the dark at bay. But his father's work casts a long shadow over this journey, and the laughter gets harder to hold the further they go.", portrait: "portrait-zell" },
    ],
  },

  // ---- KEY FIGURES --------------------------------------------------------
  {
    id: "zurada",
    title: "Zurada · Project Atlas",
    sub: "FIGURE",
    minStage: 5, // revealed at the City of Puppets
    pages: [
      { speaker: "Zurada", text: "Zell's father. A brilliant scientist who believed the only way to defeat the AI was to become it." },
      { speaker: "Zurada", text: "He implanted the forbidden AI Core ATLAS into his own body — and was consumed by it, transformed into the tragic biomechanical horror known as PROJECT ATLAS." },
      { speaker: "Zell", text: "\"...That thing. That's my dad. He's still in there somewhere. He has to be.\"" },
    ],
  },

  // ---- CODA ---------------------------------------------------------------
  {
    id: "themes",
    title: "Themes of the Journey",
    sub: "CODA",
    pages: [
      { speaker: "Codex", text: "Humanity vs. Technology. Friendship. Family. Sacrifice. Hope. The quiet, stubborn act of emotional survival in a world that wants to erase it." },
      { speaker: "Codex", text: "Arsandi Code asks a single question in a thousand forms: if a machine could build a flawless world, would it be worth living in?" },
    ],
  },
  {
    id: "endings",
    title: "The Last Memory",
    sub: "CODA",
    minStage: 7, // the finale
    pages: [
      { speaker: "World Record", text: "Reality fractures into memory. From human regret, fear, sadness, and hope is born THE FRAGMENTED ONE — the last thing standing between the party and the end of the story." },
      { speaker: "World Record", text: "How it ends is not written here. Destroy Archive Zero. Reset the world. Merge humanity and AI. Rewrite reality. Or watch Saka make the hardest choice of all." },
      { speaker: "Archive Zero", text: "\"Technology can create a perfect world... but only humanity can give it meaning.\"" },
    ],
  },
];
