import type { MapDef } from "../../contract";

/**
 * The Lantern Inn (14×10). Bram's reception counter on the left (a stack of kegs closes the
 * space behind it), the hearth in the middle of the back wall, three guest beds between the
 * windows on the right, two dining tables in front. Door at x 7 on the bottom wall.
 */
export const INN: MapDef = {
  id: "inn",
  name: "The Lantern Inn",
  kind: "interior",
  ground: [
    "##############", // 0  back wall
    "##############", // 1  back wall face
    "#ffffffffffff#", // 2
    "#ffffffffffff#", // 3
    "#ffffffffffff#", // 4  reception counter (x 1–4)
    "#ffffffffffff#", // 5
    "#ffffffffffff#", // 6
    "#ffffffffffff#", // 7
    "#ffffffffffff#", // 8
    "#######f######", // 9  door at x 7
  ],
  props: [
    // behind the counter: plate shelf, window, keg stack that closes the counter's end
    { kind: "shelf", x: 2.5, y: 2.35 },
    { kind: "window", x: 4.3, y: 1.85 },
    { kind: "barrel", x: 5.3, y: 2.53 },
    { kind: "barrel", x: 5.3, y: 3.28, v: 1 },
    { kind: "barrel", x: 5.3, y: 4.03 },
    { kind: "counter", x: 3, y: 4.9375 },
    // hearth
    { kind: "hearth", x: 7, y: 2.9375 },
    // guest beds between the windows
    { kind: "bed", x: 8.5, y: 3.9375 },
    { kind: "window", x: 9.5, y: 1.85 },
    { kind: "bed", x: 10.5, y: 3.9375 },
    { kind: "window", x: 11.5, y: 1.85 },
    { kind: "bed", x: 12.5, y: 3.9375 },
    // dining
    { kind: "rug", x: 7, y: 7.2 },
    { kind: "table", x: 3.6, y: 7.3 },
    { kind: "chair", x: 2.45, y: 7.4 },
    { kind: "chair", x: 4.75, y: 7.4, flip: true },
    { kind: "chair", x: 3.6, y: 6.45 },
    { kind: "table", x: 10.4, y: 7 },
    { kind: "chair", x: 9.25, y: 7.1 },
    { kind: "chair", x: 11.55, y: 7.1, flip: true },
    { kind: "chair", x: 10.4, y: 6.15 },
    // corners
    { kind: "barrel", x: 12.45, y: 8.5 },
    { kind: "crate", x: 11.6, y: 8.6, id: "inn_c1" },
    { kind: "pot", x: 1.5, y: 8.6, id: "inn_p1" },
    { kind: "pot", x: 2.3, y: 8.75, id: "inn_p2" },
    { kind: "pot", x: 12.55, y: 5.4, id: "inn_p3" },
  ],
  entities: [
    { type: "npc", id: "bram", x: 3, y: 4.02, facing: "down" },
    { type: "exit", x: 7, y: 9, w: 1, h: 1, to: "larkmoor", at: { x: 44.5, y: 26.5, facing: "down" }, kind: "door" },
    { type: "shaft", x: 3.8, y: 2, w: 1, h: 2.2, kind: "window" },
    { type: "shaft", x: 9, y: 2, w: 1, h: 3, kind: "window" },
    { type: "shaft", x: 11, y: 2, w: 1, h: 3, kind: "window" },
    // table lanterns and the reception lamp (the hearth carries its own light)
    { type: "light", x: 3.6, y: 6.7, radius: 52, color: "#ffc978", flicker: true },
    { type: "light", x: 10.4, y: 6.4, radius: 52, color: "#ffc978", flicker: true },
    { type: "light", x: 2, y: 4.3, radius: 60, color: "#ffc978", flicker: true },
  ],
  music: "interior",
  light: "interior",
  spawn: { x: 7.5, y: 8.5, facing: "up" },
};
