import type { MapDef } from "../../contract";

/**
 * Elder's Hall (12×10), stone floored and symmetric about x 6. Elder Maren stands before her
 * table at the head of a rug runner, braziers either side, bookcases and banners on the back
 * wall under two tall windows, council seats along the sides, statues by the double door
 * (x 5–6 on the bottom wall).
 */
export const HALL: MapDef = {
  id: "hall",
  name: "Elder's Hall",
  kind: "interior",
  ground: [
    "############", // 0  back wall
    "############", // 1  back wall face (bookcases, banners, windows)
    "#tttttttttt#", // 2
    "#tttttttttt#", // 3  Maren's table
    "#tttttttttt#", // 4
    "#tttttttttt#", // 5
    "#tttttttttt#", // 6
    "#tttttttttt#", // 7
    "#tttttttttt#", // 8
    "#####tt#####", // 9  double door at x 5–6
  ],
  props: [
    // back wall
    { kind: "bookcase", x: 2, y: 2.4 },
    { kind: "window", x: 3.9, y: 1.85 },
    { kind: "banner", x: 5.05, y: 1.95 },
    { kind: "banner", x: 6.95, y: 1.95, flip: true },
    { kind: "window", x: 8.1, y: 1.85 },
    { kind: "bookcase", x: 10, y: 2.4, v: 1 },
    // the elder's table and seat
    { kind: "chair", x: 6, y: 3.05 },
    { kind: "table", x: 6, y: 3.9 },
    { kind: "brazier", x: 3.9, y: 4.35 },
    { kind: "brazier", x: 8.1, y: 4.35 },
    // rug runner from the door to the elder
    { kind: "rug", x: 6, y: 6.95, v: 1 },
    { kind: "rug", x: 6, y: 8.95, v: 1 },
    // council seats along the sides
    { kind: "table", x: 2.3, y: 6.4 },
    { kind: "chair", x: 2.3, y: 5.55 },
    { kind: "chair", x: 2.3, y: 7.25 },
    { kind: "table", x: 9.7, y: 6.4 },
    { kind: "chair", x: 9.7, y: 5.55 },
    { kind: "chair", x: 9.7, y: 7.25 },
    // statues by the door, pots in the corners
    { kind: "statue", x: 3.6, y: 8.75 },
    { kind: "statue", x: 8.4, y: 8.75, flip: true },
    { kind: "pot", x: 1.5, y: 8.6, id: "hall_p1" },
    { kind: "pot", x: 10.5, y: 8.6, id: "hall_p2" },
    { kind: "pot", x: 1.5, y: 3.6, id: "hall_p3" },
    { kind: "pot", x: 10.5, y: 3.6, id: "hall_p4" },
  ],
  entities: [
    { type: "npc", id: "maren", x: 6, y: 4.65, facing: "down" },
    { type: "exit", x: 5, y: 9, w: 2, h: 1, to: "larkmoor", at: { x: 32, y: 14.5, facing: "down" }, kind: "door" },
    { type: "shaft", x: 3.4, y: 2, w: 1, h: 3.4, kind: "window" },
    { type: "shaft", x: 7.6, y: 2, w: 1, h: 3.4, kind: "window" },
    { type: "light", x: 6, y: 3.4, radius: 56, color: "#ffd9a0", flicker: true },
  ],
  music: "interior",
  light: "interior",
  spawn: { x: 6, y: 8.5, facing: "up" },
};
