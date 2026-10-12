import type { EntityPlacement, MapDef, PropPlacement } from "../../contract";

// Heart of the Barrow (32x28), authored by the maps-wild lane. Generated from
// ~/game-05-v2-research/lanes/maps-wild/gen/barrow2.mjs. Round root-choked arena, the wardstone on a raised
// dais (north), the Thornmother spawn (once) in the centre, braziers, stairs up (south) to barrow1.

const BARROW2_STAIRS_UP: PropPlacement[] = [
  { kind: "stairsUp", x: 15.5, y: 8 },
  { kind: "stairsUp", x: 16.5, y: 8 },
  { kind: "stairsUp", x: 17.5, y: 8 },
  { kind: "stairsUp", x: 16.5, y: 27 },
];

const BARROW2_WARDSTONE: PropPlacement[] = [
  { kind: "wardstone", x: 16.5, y: 5.25 },
];

const BARROW2_TORCH: PropPlacement[] = [
  { kind: "torch", x: 11.625, y: 3.25 },
  { kind: "torch", x: 20.375, y: 3.25 },
];

const BARROW2_BRAZIER: PropPlacement[] = [
  { kind: "brazier", x: 12.375, y: 6.625 },
  { kind: "brazier", x: 20.625, y: 6.625 },
  { kind: "brazier", x: 6.375, y: 10.25 },
  { kind: "brazier", x: 25.625, y: 10.25 },
  { kind: "brazier", x: 5.25, y: 16 },
  { kind: "brazier", x: 26.75, y: 16 },
  { kind: "brazier", x: 7.625, y: 21.375 },
  { kind: "brazier", x: 24.375, y: 21.375 },
];

const BARROW2_DEAD_TREE: PropPlacement[] = [
  { kind: "deadTree", x: 5.625, y: 8.625 },
  { kind: "deadTree", x: 26.375, y: 8.625, flip: true },
  { kind: "deadTree", x: 4.375, y: 13.25 },
  { kind: "deadTree", x: 27.625, y: 13.375, flip: true },
  { kind: "deadTree", x: 5, y: 19.375 },
  { kind: "deadTree", x: 27, y: 19.25, flip: true },
  { kind: "deadTree", x: 10, y: 23.375 },
  { kind: "deadTree", x: 22, y: 23.375, flip: true },
];

const BARROW2_LOG: PropPlacement[] = [
  { kind: "log", x: 8.625, y: 7.625 },
  { kind: "log", x: 23.375, y: 7.625, flip: true },
  { kind: "log", x: 3.75, y: 17.625 },
  { kind: "log", x: 28.25, y: 17.375, flip: true },
  { kind: "log", x: 12.375, y: 23.75, flip: true },
  { kind: "log", x: 19.625, y: 23.75 },
];

const BARROW2_WEB: PropPlacement[] = [
  { kind: "web", x: 7.625, y: 12.625 },
  { kind: "web", x: 24.375, y: 12.75, flip: true },
  { kind: "web", x: 9.25, y: 20.25 },
  { kind: "web", x: 22.75, y: 20.375, flip: true },
  { kind: "web", x: 11.25, y: 9, flip: true },
  { kind: "web", x: 20.75, y: 9.25, flip: true },
  { kind: "web", x: 6.75, y: 18.25, flip: true },
  { kind: "web", x: 25.25, y: 18, flip: true },
];

const BARROW2_BONES: PropPlacement[] = [
  { kind: "bones", x: 9.375, y: 16.375, flip: true },
  { kind: "bones", x: 22.625, y: 14.375, flip: true },
  { kind: "bones", x: 13.25, y: 21.625 },
  { kind: "bones", x: 19.375, y: 21, flip: true },
  { kind: "bones", x: 8.375, y: 11.625 },
  { kind: "bones", x: 23.625, y: 17.625, flip: true },
  { kind: "bones", x: 14, y: 9.625 },
  { kind: "bones", x: 18.75, y: 10.25 },
];

const BARROW2_MUSHROOM: PropPlacement[] = [
  { kind: "mushroom", x: 6.25, y: 15.625, v: 1 },
  { kind: "mushroom", x: 6.375, y: 14.75, v: 1 },
  { kind: "mushroom", x: 8.5, y: 15.75, v: 1 },
  { kind: "mushroom", x: 7.375, y: 14.625, v: 1 },
  { kind: "mushroom", x: 7.375, y: 13.875, v: 1 },
  { kind: "mushroom", x: 24.5, y: 13.75, v: 1 },
  { kind: "mushroom", x: 25.25, y: 17, v: 1 },
  { kind: "mushroom", x: 25.5, y: 15.75, v: 1 },
  { kind: "mushroom", x: 23.25, y: 16.625, v: 1 },
  { kind: "mushroom", x: 25.375, y: 14, v: 1 },
];

const BARROW2_ROCK: PropPlacement[] = [
  { kind: "rock", x: 4.625, y: 11.25 },
  { kind: "rock", x: 27.25, y: 11.375, v: 1, flip: true },
  { kind: "rock", x: 9, y: 22.625, v: 1 },
  { kind: "rock", x: 23, y: 22.625 },
];

const BARROW2_GRAVESTONE: PropPlacement[] = [
  { kind: "gravestone", x: 13, y: 4.25 },
  { kind: "gravestone", x: 20, y: 4.25, flip: true },
];

const BARROW2_ENTITIES: EntityPlacement[] = [
  // npc
  { type: "npc", id: "hooded", x: 17.6, y: 5.8, facing: "left" },
  // spawn
  { type: "spawn", id: "b2_thornmother", monster: "thornmother", x: 16, y: 15, count: 1, once: true, when: { notFlag: "bossDown" } },
  // exit
  { type: "exit", x: 16, y: 26, w: 1, h: 1, to: "barrow1", at: { x: 24.5, y: 5.2, facing: "down" }, kind: "stairs" },
  // light
  { type: "light", x: 16.5, y: 3.2, radius: 120, color: "#8fe8ff" },
  { type: "light", x: 16, y: 15, radius: 150, color: "#9d7ad8" },
  // fog
  { type: "fog", x: 5, y: 16, w: 22, h: 9 },
];

export const BARROW2: MapDef = {
  id: "barrow2",
  name: "Heart of the Barrow",
  kind: "dungeon",
  // prettier-ignore
  ground: [
    "################################", // 0
    "################################", // 1
    "############ttttttttt###########", // 2
    "###########ttttttttttt##########", // 3
    "###########ttttttttttt##########", // 4
    "###########ttttttttttt##########", // 5
    "###########ttttttttttt##########", // 6
    "#########kktttttttttttk#########", // 7
    "########kkkkkkkkkkkkkkkk########", // 8
    "#######kkkkkkkkkkkkkkkkkkk######", // 9
    "######kkkkkkkkkkkkkkkkkkkk######", // 10
    "#####kkkkkkkkkkkkkkkkkkkkkk#####", // 11
    "#####kkkkkkkkttttttkkkkkkkk#####", // 12
    "#####kkkkkkkttttttttkkkkkkkk####", // 13
    "####kkkkkkkttttttttttkkkkkkk####", // 14
    "####kkkkkkkttttttttttkkkkkk#####", // 15
    "#####kkkkkkttttttttttkkkkkk#####", // 16
    "#####kkkkkkkttttttttkkkkkkk#####", // 17
    "#####kkkkkkkkttttttkkkkkkkk#####", // 18
    "######kkkkkkkkkkkkkkkkkkkk######", // 19
    "#######kkkkkkkkkkkkkkkkkkk######", // 20
    "#######kkkkkkkkkkkkkkkkkk#######", // 21
    "##########kkkkkkkkkkkkk#########", // 22
    "###########kkkkkkkkkk###########", // 23
    "##############kkkkk#############", // 24
    "###############ttt##############", // 25
    "###############ttt##############", // 26
    "################################", // 27
  ],
  // prettier-ignore
  height: [
    "00000000000111111111110000000000", // 0
    "00000000000111111111110000000000", // 1
    "00000000000111111111110000000000", // 2
    "00000000000111111111110000000000", // 3
    "00000000000111111111110000000000", // 4
    "00000000000111111111110000000000", // 5
    "00000000000111111111110000000000", // 6
    "00000000000111111111110000000000", // 7
    "00000000000000000000000000000000", // 8
    "00000000000000000000000000000000", // 9
    "00000000000000000000000000000000", // 10
    "00000000000000000000000000000000", // 11
    "00000000000000000000000000000000", // 12
    "00000000000000000000000000000000", // 13
    "00000000000000000000000000000000", // 14
    "00000000000000000000000000000000", // 15
    "00000000000000000000000000000000", // 16
    "00000000000000000000000000000000", // 17
    "00000000000000000000000000000000", // 18
    "00000000000000000000000000000000", // 19
    "00000000000000000000000000000000", // 20
    "00000000000000000000000000000000", // 21
    "00000000000000000000000000000000", // 22
    "00000000000000000000000000000000", // 23
    "00000000000000000000000000000000", // 24
    "00000000000000000000000000000000", // 25
    "00000000000000000000000000000000", // 26
    "00000000000000000000000000000000", // 27
  ],
  props: [
    ...BARROW2_STAIRS_UP,
    ...BARROW2_WARDSTONE,
    ...BARROW2_TORCH,
    ...BARROW2_BRAZIER,
    ...BARROW2_DEAD_TREE,
    ...BARROW2_LOG,
    ...BARROW2_WEB,
    ...BARROW2_BONES,
    ...BARROW2_MUSHROOM,
    ...BARROW2_ROCK,
    ...BARROW2_GRAVESTONE,
  ],
  entities: BARROW2_ENTITIES,
  music: "boss",
  light: "cave",
  spawn: { x: 16.5, y: 25.3, facing: "up" },
  level: 9,
};
