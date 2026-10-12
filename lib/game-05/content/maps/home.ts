import type { MapDef } from "../../contract";

/**
 * Wren's house (12×10): the start. One cosy room: Wren's bed and the clothes chest in the
 * north-west corner, Grandpa Oren by the hearth, the family table, Oren's old sword rack.
 * Rows 0–1 are the back wall (windows, shelf, hearth), the bottom wall has the door at x 6.
 */
export const HOME: MapDef = {
  id: "home",
  name: "Wren's house",
  kind: "interior",
  ground: [
    "############", // 0  back wall
    "############", // 1  back wall face (windows, shelf, hearth)
    "#ffffffffff#", // 2
    "#ffffffffff#", // 3
    "#ffffffffff#", // 4
    "#ffffffffff#", // 5
    "#ffffffffff#", // 6
    "#ffffffffff#", // 7
    "#ffffffffff#", // 8
    "######f#####", // 9  door at x 6
  ],
  props: [
    // back wall
    { kind: "window", x: 2.5, y: 1.85 },
    { kind: "shelf", x: 5, y: 2.35 },
    { kind: "window", x: 6.5, y: 1.85 },
    { kind: "hearth", x: 8.5, y: 2.9375 },
    { kind: "barrel", x: 10.4, y: 2.8 },
    { kind: "pot", x: 10.55, y: 3.75, id: "home_p1" },
    // Wren's corner: bed, rug
    { kind: "bed", x: 2.5, y: 3.9375 },
    { kind: "rug", x: 3.6, y: 6.2 },
    // Oren's chair by the fire and his old sword rack
    { kind: "chair", x: 6.9, y: 3.55 },
    { kind: "weaponRack", x: 10.25, y: 5.4 },
    // the family table
    { kind: "table", x: 8.5, y: 6.6 },
    { kind: "chair", x: 8.5, y: 5.75 },
    { kind: "chair", x: 7.35, y: 6.75 },
    { kind: "chair", x: 9.65, y: 6.75, flip: true },
    // by the door
    { kind: "crate", x: 1.6, y: 8.45, id: "home_c1" },
    { kind: "pot", x: 2.55, y: 8.7, id: "home_p2" },
    { kind: "barrel", x: 10.4, y: 8.45 },
    { kind: "pot", x: 9.55, y: 8.75, id: "home_p3" },
  ],
  entities: [
    { type: "npc", id: "oren", x: 6.55, y: 4.15, facing: "down" },
    { type: "chest", id: "c_home_bed", x: 3.6, y: 2.95, loot: { kind: "item", item: "clothTunic" } },
    { type: "exit", x: 6, y: 9, w: 1, h: 1, to: "larkmoor", at: { x: 8.5, y: 15.5, facing: "down" }, kind: "door" },
    // window light and the table candle (the hearth carries its own light)
    { type: "shaft", x: 2, y: 2, w: 1, h: 2.4, kind: "window" },
    { type: "shaft", x: 6, y: 2, w: 1, h: 3.2, kind: "window" },
    { type: "light", x: 8.5, y: 6, radius: 44, color: "#ffcf8a", flicker: true },
    { type: "light", x: 3.4, y: 3.3, radius: 40, color: "#ffd9a0", flicker: true },
  ],
  music: "interior",
  light: "interior",
  spawn: { x: 3.6, y: 4.3, facing: "down" },
};
