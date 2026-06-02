// Core engine constants for Arsandi Code.

// Internal render resolution (16:9). The canvas is scaled up to fit the window
// with pixelArt enabled, so everything stays crisp at integer-ish zoom levels.
export const GAME_WIDTH = 480;
export const GAME_HEIGHT = 270;

// Tactical grid tile size in internal pixels.
export const TILE = 24;

// Scene keys — referenced by the scene stack and all transitions.
export const Scenes = {
  Boot: "Boot",
  Title: "Title",
  Overworld: "Overworld",
  Battle: "Battle",
  Menu: "Menu",
  Town: "Town",
  Shop: "Shop",
  Save: "Save",
  Options: "Options",
  WorldMap: "WorldMap",
} as const;

// Theme palette pulled from the lore bible's character/world colors.
export const Palette = {
  bg: "#05030d",
  ui: "#1b1430",
  uiBorder: "#5a4b8c",
  text: "#e8e2ff",
  saka: "#3d6bff", // blue
  sakaAccent: "#ff4d4d", // red scarf
  kara: "#b45cff", // purple
  zell: "#4dff9e", // green
  danger: "#ff4d6d",
} as const;
