import type { PropKind, Rect } from "../contract";

/**
 * Prop catalog shared by maps, the simulation (collision, cutting), the renderer and the art
 * pipeline (target sprite sizes). Sizes are in art pixels. `solid` is relative to the prop's
 * FOOT anchor (x centred, y = ground contact line): a rect or a circle radius. `door` is where a
 * building's doorway is, relative to the anchor, so maps can place the exit on it.
 */
export interface PropDef {
  /** Target sprite size in art px (art may differ by a few px). */
  w: number;
  h: number;
  solid: Rect | { r: number } | null;
  /** Cut by a sword swing: drops loot and disappears for this map visit. */
  cut?: boolean;
  /** Broken by a swing (pots, crates): drops loot, disappears for this map visit. */
  breaks?: boolean;
  /** Pixels above the anchor that form a canopy/roof and fade when the hero is behind it. */
  canopyAbove?: number;
  /** Interaction offered when the hero faces it within reach. */
  interact?: "read" | "lever" | "inspect";
  /** Emits light (renderer). */
  light?: { radius: number; color: string; flicker?: boolean; dy: number };
  door?: { x: number; y: number };
  /** Drawn flat under actors (rugs, lily pads). */
  flat?: boolean;
}

const r = (x: number, y: number, w: number, h: number): Rect => ({ x, y, w, h });

export const PROPS: Record<PropKind, PropDef> = {
  tree: { w: 88, h: 104, solid: r(-12, -10, 24, 12), canopyAbove: 40 },
  pine: { w: 60, h: 104, solid: r(-9, -9, 18, 10), canopyAbove: 36 },
  deadTree: { w: 72, h: 88, solid: r(-9, -9, 18, 10), canopyAbove: 40 },
  bush: { w: 34, h: 30, solid: { r: 12 }, cut: true },
  grass: { w: 28, h: 26, solid: null, cut: true },
  flowers: { w: 28, h: 20, solid: null, flat: true },
  rock: { w: 38, h: 32, solid: r(-17, -12, 34, 14) },
  boulder: { w: 70, h: 60, solid: r(-32, -22, 64, 24) },
  stump: { w: 30, h: 22, solid: { r: 12 } },
  log: { w: 64, h: 26, solid: r(-30, -12, 60, 14) },
  pot: { w: 20, h: 22, solid: { r: 8 }, breaks: true },
  barrel: { w: 24, h: 30, solid: { r: 10 } },
  crate: { w: 28, h: 28, solid: r(-13, -12, 26, 14), breaks: true },
  sign: { w: 26, h: 32, solid: r(-8, -6, 16, 7), interact: "read" },
  fence: { w: 32, h: 26, solid: r(-16, -6, 32, 7) },
  fenceV: { w: 10, h: 40, solid: r(-4, -30, 8, 32) },
  lamp: { w: 16, h: 52, solid: { r: 5 }, light: { radius: 72, color: "#ffc978", flicker: true, dy: -44 } },
  torch: { w: 14, h: 28, solid: null, light: { radius: 84, color: "#ffb45a", flicker: true, dy: -20 } },
  brazier: { w: 26, h: 34, solid: { r: 10 }, light: { radius: 96, color: "#ff9d4a", flicker: true, dy: -24 } },
  well: { w: 52, h: 56, solid: r(-24, -26, 48, 28), interact: "inspect" },
  fountain: { w: 104, h: 88, solid: r(-46, -40, 92, 42), canopyAbove: 60 },
  statue: { w: 44, h: 80, solid: r(-18, -16, 36, 18), canopyAbove: 40 },
  house: { w: 136, h: 136, solid: r(-64, -64, 128, 66), canopyAbove: 64, door: { x: 0, y: 0 } },
  inn: { w: 200, h: 168, solid: r(-96, -80, 192, 82), canopyAbove: 80, door: { x: 0, y: 0 } },
  shopHouse: { w: 136, h: 136, solid: r(-64, -64, 128, 66), canopyAbove: 64, door: { x: 0, y: 0 } },
  smithyHouse: { w: 168, h: 136, solid: r(-80, -64, 160, 66), canopyAbove: 64, door: { x: -24, y: 0 } },
  tavernHouse: { w: 168, h: 152, solid: r(-80, -72, 160, 74), canopyAbove: 72, door: { x: 0, y: 0 } },
  hall: { w: 232, h: 184, solid: r(-112, -88, 224, 90), canopyAbove: 88, door: { x: 0, y: 0 } },
  bed: { w: 36, h: 60, solid: r(-16, -48, 32, 50) },
  table: { w: 60, h: 40, solid: r(-28, -20, 56, 22) },
  chair: { w: 20, h: 28, solid: null },
  counter: { w: 128, h: 40, solid: r(-64, -22, 128, 24) },
  shelf: { w: 64, h: 64, solid: r(-32, -12, 64, 14) },
  hearth: { w: 64, h: 72, solid: r(-30, -14, 60, 16), light: { radius: 120, color: "#ff9a4a", flicker: true, dy: -20 } },
  rug: { w: 96, h: 64, solid: null, flat: true },
  stairsUp: { w: 32, h: 40, solid: null },
  stairsDown: { w: 32, h: 32, solid: null, flat: true },
  web: { w: 48, h: 40, solid: null, flat: true },
  bones: { w: 28, h: 16, solid: null, flat: true },
  mushroom: { w: 20, h: 20, solid: null },
  reeds: { w: 26, h: 30, solid: null, cut: true },
  lilypad: { w: 20, h: 12, solid: null, flat: true },
  dock: { w: 32, h: 32, solid: null, flat: true },
  boat: { w: 72, h: 36, solid: r(-34, -16, 68, 18) },
  wardstone: { w: 64, h: 104, solid: r(-26, -18, 52, 20), canopyAbove: 60, light: { radius: 160, color: "#8fe8ff", dy: -60 } },
  lever: { w: 20, h: 30, solid: { r: 7 }, interact: "lever" },
  cart: { w: 72, h: 52, solid: r(-34, -22, 68, 24) },
  hay: { w: 40, h: 32, solid: r(-18, -12, 36, 14) },
  anvil: { w: 36, h: 26, solid: r(-16, -10, 32, 12) },
  weaponRack: { w: 48, h: 48, solid: r(-22, -10, 44, 12) },
  bookcase: { w: 64, h: 72, solid: r(-32, -12, 64, 14) },
  window: { w: 32, h: 40, solid: null },
  banner: { w: 24, h: 56, solid: null },
  gravestone: { w: 26, h: 32, solid: r(-11, -8, 22, 10) },
};

/** Ground materials that block movement. */
export const SOLID_GROUND = new Set(["W", "#", "H", "x"]);
/** Ground materials that slow movement to 60%. */
export const SLOW_GROUND = new Set(["w", "m"]);
