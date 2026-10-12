import type { MapDef } from "../../contract";

/**
 * Tilda's Goods (10×8), the item shop. A counter runs wall to wall with Tilda behind it and
 * stocked shelves on the back wall; jars, crates and a barrel of herbs on the shop floor.
 * Door at x 5 on the bottom wall.
 */
export const SHOP: MapDef = {
  id: "shop",
  name: "Tilda's Goods",
  kind: "interior",
  ground: [
    "##########", // 0  back wall
    "##########", // 1  back wall face (shelves, window)
    "#ffffffff#", // 2  behind the counter
    "#ffffffff#", // 3  counter, wall to wall
    "#ffffffff#", // 4
    "#ffffffff#", // 5
    "#ffffffff#", // 6
    "#####f####", // 7  door at x 5
  ],
  props: [
    // back wall
    { kind: "shelf", x: 2, y: 2.35 },
    { kind: "window", x: 4.5, y: 1.85 },
    { kind: "shelf", x: 7, y: 2.35, v: 1 },
    { kind: "pot", x: 5.7, y: 2.55, id: "shop_p1" },
    // the counter, two sections from wall to wall
    { kind: "counter", x: 3, y: 3.9375 },
    { kind: "counter", x: 7, y: 3.9375, v: 1 },
    // shop floor
    { kind: "rug", x: 5, y: 6.2 },
    { kind: "barrel", x: 1.45, y: 4.85 },
    { kind: "crate", x: 1.55, y: 5.85, id: "shop_c1" },
    { kind: "pot", x: 1.45, y: 6.7, id: "shop_p2" },
    { kind: "crate", x: 8.45, y: 4.9, id: "shop_c2" },
    { kind: "pot", x: 8.5, y: 5.75, id: "shop_p3" },
    { kind: "barrel", x: 8.5, y: 6.7, v: 1 },
  ],
  entities: [
    { type: "npc", id: "tilda", x: 4.5, y: 3.02, facing: "down" },
    { type: "exit", x: 5, y: 7, w: 1, h: 1, to: "larkmoor", at: { x: 25.5, y: 34.5, facing: "down" }, kind: "door" },
    { type: "shaft", x: 4, y: 2, w: 1, h: 3.2, kind: "window" },
    { type: "light", x: 5, y: 4.6, radius: 72, color: "#ffc978", flicker: true },
    { type: "light", x: 2, y: 3.2, radius: 44, color: "#ffd9a0" },
    { type: "light", x: 7.4, y: 3.2, radius: 44, color: "#ffd9a0" },
  ],
  music: "interior",
  light: "interior",
  spawn: { x: 5.5, y: 6.5, facing: "up" },
};
