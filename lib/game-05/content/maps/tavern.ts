import type { MapDef } from "../../contract";

/**
 * The Reed & Barrel (12×9), the tavern. Rosa's bar on the left with the taps and bottle shelf
 * behind her (a keg stack closes the bar's end), the hearth and a window on the back wall,
 * two drinking tables on a rug, kegs in the corner. Door at x 6 on the bottom wall.
 */
export const TAVERN: MapDef = {
  id: "tavern",
  name: "The Reed & Barrel",
  kind: "interior",
  ground: [
    "############", // 0  back wall
    "############", // 1  back wall face
    "#ffffffffff#", // 2  behind the bar
    "#ffffffffff#", // 3  bar (x 1–4)
    "#ffffffffff#", // 4
    "#ffffffffff#", // 5
    "#ffffffffff#", // 6
    "#ffffffffff#", // 7
    "######f#####", // 8  door at x 6
  ],
  props: [
    // behind the bar: taps (barrels), bottle shelf, keg stack closing the bar's end
    { kind: "barrel", x: 1.45, y: 2.6, v: 1 },
    { kind: "shelf", x: 3, y: 2.35, v: 1 },
    { kind: "barrel", x: 5.3, y: 2.53 },
    { kind: "barrel", x: 5.3, y: 3.28, v: 1 },
    { kind: "counter", x: 3, y: 3.9375, v: 3 },
    // back wall
    { kind: "window", x: 6.6, y: 1.85 },
    { kind: "hearth", x: 8.7, y: 2.9375 },
    { kind: "banner", x: 10.4, y: 1.95 },
    // tables
    { kind: "rug", x: 8, y: 6.3 },
    { kind: "table", x: 7.4, y: 5.1 },
    { kind: "chair", x: 6.25, y: 5.2 },
    { kind: "chair", x: 8.55, y: 5.2, flip: true },
    { kind: "table", x: 9.1, y: 7.1 },
    { kind: "chair", x: 7.95, y: 7.2 },
    { kind: "chair", x: 10.25, y: 7.2, flip: true },
    { kind: "table", x: 2.6, y: 6.6 },
    { kind: "chair", x: 1.5, y: 6.7 },
    { kind: "chair", x: 3.7, y: 6.7, flip: true },
    // kegs and pots
    { kind: "barrel", x: 10.45, y: 4.3 },
    { kind: "barrel", x: 10.5, y: 5.1, v: 1 },
    { kind: "crate", x: 1.55, y: 7.7, id: "tavern_c1" },
    { kind: "pot", x: 4.4, y: 7.75, id: "tavern_p1" },
  ],
  entities: [
    { type: "npc", id: "rosa", x: 3, y: 3.02, facing: "down" },
    { type: "exit", x: 6, y: 8, w: 1, h: 1, to: "larkmoor", at: { x: 47.5, y: 41.5, facing: "down" }, kind: "door" },
    { type: "shaft", x: 6.1, y: 2, w: 1, h: 2.8, kind: "window" },
    { type: "light", x: 7.4, y: 4.5, radius: 50, color: "#ffc978", flicker: true },
    { type: "light", x: 9.1, y: 6.5, radius: 50, color: "#ffc978", flicker: true },
    { type: "light", x: 2.6, y: 6, radius: 50, color: "#ffc978", flicker: true },
    { type: "light", x: 3, y: 3.3, radius: 60, color: "#ffb866", flicker: true },
  ],
  music: "interior",
  light: "interior",
  spawn: { x: 6.5, y: 7.5, facing: "up" },
};
