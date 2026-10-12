import type { MapDef } from "../../contract";

/**
 * Hask's Smithy (10×8), the armourer. Hask works behind a wall-to-wall counter with the forge
 * and anvil at his back and weapon racks on the wall; the floor is stone throughout (a forge room);
 * quench barrels and ore crates stand by the walls. The door is left of centre (x 3), matching the
 * building's off-centre doorway.
 */
export const SMITHY: MapDef = {
  id: "smithy",
  name: "Hask's Smithy",
  kind: "interior",
  ground: [
    "##########", // 0  back wall
    "##########", // 1  back wall face (racks, forge chimney, window)
    "#tttttttt#", // 2  forge floor behind the counter
    "#tttttttt#", // 3  counter, wall to wall
    "#tttttttt#", // 4
    "#tttttttt#", // 5
    "#tttttttt#", // 6
    "###t######", // 7  door at x 3
  ],
  props: [
    // back wall: racks, forge, window
    { kind: "weaponRack", x: 1.95, y: 2.4 },
    { kind: "hearth", x: 4.6, y: 2.9375, v: 1 },
    { kind: "anvil", x: 6.3, y: 2.95 },
    { kind: "window", x: 6.95, y: 1.85 },
    { kind: "weaponRack", x: 8.3, y: 2.4, v: 1 },
    // the counter, two sections from wall to wall
    { kind: "counter", x: 3, y: 3.9375, v: 2 },
    { kind: "counter", x: 7, y: 3.9375, v: 2 },
    // shop floor: quench barrels, ore crates, a display rack
    { kind: "barrel", x: 1.45, y: 4.85, v: 1 },
    { kind: "barrel", x: 1.5, y: 5.6 },
    { kind: "crate", x: 8.45, y: 4.9, id: "smithy_c1" },
    { kind: "crate", x: 8.5, y: 5.8, id: "smithy_c2" },
    { kind: "weaponRack", x: 6.8, y: 6.75, v: 1 },
    { kind: "pot", x: 1.5, y: 6.75, id: "smithy_p1" },
  ],
  entities: [
    { type: "npc", id: "hask", x: 3.2, y: 3.02, facing: "down" },
    { type: "exit", x: 3, y: 7, w: 1, h: 1, to: "larkmoor", at: { x: 38.5, y: 34.5, facing: "down" }, kind: "door" },
    { type: "shaft", x: 6.45, y: 2, w: 1, h: 3, kind: "window" },
    // forge glow spills over the counter (the hearth carries its own flame light)
    { type: "light", x: 4.6, y: 3.4, radius: 110, color: "#ff8a3a", flicker: true },
    { type: "light", x: 6.3, y: 2.6, radius: 40, color: "#ffb45a", flicker: true },
  ],
  music: "interior",
  light: "interior",
  spawn: { x: 3.5, y: 6.5, facing: "up" },
};
