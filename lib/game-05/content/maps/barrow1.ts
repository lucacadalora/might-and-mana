import type { EntityPlacement, MapDef, PropPlacement } from "../../contract";

// The Barrow, upper (48x40), authored by the maps-wild lane. Generated from
// ~/game-05-v2-research/lanes/maps-wild/gen/barrow1.mjs. Entry hall (stairs up, south) -> spider nest (W),
// crypt (NW, silver ring), guard hall (NE, barrowKey), lever room split by an underground stream (E):
// lever leverB1 opens g_b1_lever on the ember vault. The iron gate g_barrow (barrowKey) guards the stairs down (N).

const BARROW1_STAIRS_UP: PropPlacement[] = [
  { kind: "stairsUp", x: 23.5, y: 11 },
  { kind: "stairsUp", x: 24.5, y: 11 },
  { kind: "stairsUp", x: 25.5, y: 11 },
  { kind: "stairsUp", x: 24.5, y: 38 },
];

const BARROW1_STAIRS_DOWN: PropPlacement[] = [
  { kind: "stairsDown", x: 24.5, y: 4 },
];

const BARROW1_LEVER: PropPlacement[] = [
  { kind: "lever", x: 44.625, y: 34.625, id: "leverB1" },
];

const BARROW1_TORCH: PropPlacement[] = [
  { kind: "torch", x: 17.5, y: 8.25 },
  { kind: "torch", x: 21.5, y: 8.25 },
  { kind: "torch", x: 27.5, y: 8.25 },
  { kind: "torch", x: 31.5, y: 8.25 },
  { kind: "torch", x: 36.5, y: 8.25 },
  { kind: "torch", x: 44.5, y: 8.25 },
  { kind: "torch", x: 4.5, y: 5.25 },
  { kind: "torch", x: 12.5, y: 5.25 },
  { kind: "torch", x: 18.5, y: 29.25 },
  { kind: "torch", x: 33.5, y: 27.25 },
  { kind: "torch", x: 36.5, y: 27.25 },
  { kind: "torch", x: 41.5, y: 23.25 },
  { kind: "torch", x: 45.5, y: 23.25 },
  { kind: "torch", x: 20.5, y: 19.25 },
  { kind: "torch", x: 26.5, y: 18.25 },
  { kind: "torch", x: 32.5, y: 18.25 },
];

const BARROW1_BRAZIER: PropPlacement[] = [
  { kind: "brazier", x: 21.5, y: 12.125 },
  { kind: "brazier", x: 27.5, y: 12.125 },
  { kind: "brazier", x: 38.25, y: 9 },
  { kind: "brazier", x: 42.75, y: 9 },
  { kind: "brazier", x: 20.375, y: 35.375 },
  { kind: "brazier", x: 28.625, y: 35.375 },
  { kind: "brazier", x: 46.5, y: 14.875 },
  { kind: "brazier", x: 34.5, y: 14.875 },
];

const BARROW1_STATUE: PropPlacement[] = [
  { kind: "statue", x: 21.75, y: 2.25 },
  { kind: "statue", x: 27.25, y: 2.25, flip: true },
  { kind: "statue", x: 20.875, y: 7.875 },
  { kind: "statue", x: 28.125, y: 7.875, flip: true },
];

const BARROW1_GRAVESTONE: PropPlacement[] = [
  { kind: "gravestone", x: 2.5, y: 10.875 },
  { kind: "gravestone", x: 14.5, y: 10.875, flip: true },
  { kind: "gravestone", x: 4.5, y: 10 },
  { kind: "gravestone", x: 4.5, y: 14, v: 1 },
  { kind: "gravestone", x: 6.75, y: 10 },
  { kind: "gravestone", x: 6.75, y: 14, v: 1 },
  { kind: "gravestone", x: 9.25, y: 10 },
  { kind: "gravestone", x: 9.25, y: 14, v: 1 },
  { kind: "gravestone", x: 11.5, y: 10 },
  { kind: "gravestone", x: 11.5, y: 14, v: 1, flip: true },
  { kind: "gravestone", x: 17.375, y: 14.75 },
  { kind: "gravestone", x: 31.625, y: 14.75, flip: true },
];

const BARROW1_BANNER: PropPlacement[] = [
  { kind: "banner", x: 17.5, y: 8.25 },
  { kind: "banner", x: 30.5, y: 8.25 },
  { kind: "banner", x: 35.625, y: 12.375, v: 1 },
  { kind: "banner", x: 45.375, y: 12.375, v: 1 },
  { kind: "banner", x: 38.5, y: 8.25, v: 1 },
  { kind: "banner", x: 42.5, y: 8.25, v: 1 },
];

const BARROW1_WEB: PropPlacement[] = [
  { kind: "web", x: 3.875, y: 6 },
  { kind: "web", x: 12.25, y: 14.625, flip: true },
  { kind: "web", x: 5, y: 26.625 },
  { kind: "web", x: 11, y: 25.5 },
  { kind: "web", x: 4.25, y: 30.625, flip: true },
  { kind: "web", x: 12.625, y: 30.25 },
  { kind: "web", x: 8.375, y: 23.375, flip: true },
  { kind: "web", x: 9.25, y: 33 },
  { kind: "web", x: 14.25, y: 33.375 },
  { kind: "web", x: 7.25, y: 20.25 },
  { kind: "web", x: 18.75, y: 34.625 },
  { kind: "web", x: 28.75, y: 30.25, flip: true },
  { kind: "web", x: 24.5, y: 25.75 },
  { kind: "web", x: 32.625, y: 36.625 },
  { kind: "web", x: 45.625, y: 25.625, flip: true },
  { kind: "web", x: 41.375, y: 36.5 },
];

const BARROW1_BONES: PropPlacement[] = [
  { kind: "bones", x: 6.375, y: 12.375 },
  { kind: "bones", x: 10.375, y: 7.25, flip: true },
  { kind: "bones", x: 6.25, y: 29.375 },
  { kind: "bones", x: 10.625, y: 27.25 },
  { kind: "bones", x: 3.625, y: 27.75, flip: true },
  { kind: "bones", x: 8, y: 31.875 },
  { kind: "bones", x: 12, y: 23.75 },
  { kind: "bones", x: 26.75, y: 33.75 },
  { kind: "bones", x: 23.375, y: 20.625 },
  { kind: "bones", x: 29.625, y: 18.875, flip: true },
  { kind: "bones", x: 38.625, y: 13.75 },
  { kind: "bones", x: 42.375, y: 17.75, flip: true },
  { kind: "bones", x: 20.75, y: 14.25 },
  { kind: "bones", x: 28.25, y: 13.75, flip: true },
  { kind: "bones", x: 42.25, y: 32.375 },
  { kind: "bones", x: 34.625, y: 31.25, flip: true },
  { kind: "bones", x: 22.625, y: 4.625 },
  { kind: "bones", x: 26.375, y: 4.375, flip: true },
];

const BARROW1_POT: PropPlacement[] = [
  { kind: "pot", x: 3.625, y: 15.375, id: "b1_pot01" },
  { kind: "pot", x: 12.5, y: 5.625, id: "b1_pot02" },
  { kind: "pot", x: 3.5, y: 7.75, id: "b1_pot03" },
  { kind: "pot", x: 29.25, y: 31.125, id: "b1_pot04" },
  { kind: "pot", x: 30, y: 30.625, id: "b1_pot05" },
  { kind: "pot", x: 19.375, y: 22.625, id: "b1_pot06" },
  { kind: "pot", x: 22.375, y: 22.625, id: "b1_pot07" },
  { kind: "pot", x: 21.375, y: 19.625, id: "b1_pot08" },
  { kind: "pot", x: 35.5, y: 19.625, id: "b1_pot09" },
  { kind: "pot", x: 44.625, y: 19.75, id: "b1_pot10" },
  { kind: "pot", x: 45.25, y: 18.75, id: "b1_pot11" },
  { kind: "pot", x: 16.625, y: 11.625, id: "b1_pot12" },
  { kind: "pot", x: 32.25, y: 11.75, id: "b1_pot13" },
  { kind: "pot", x: 33.25, y: 36.25, id: "b1_pot14" },
  { kind: "pot", x: 45.625, y: 30.75, id: "b1_pot15" },
  { kind: "pot", x: 32.625, y: 23.625, id: "b1_pot16" },
  { kind: "pot", x: 37.25, y: 23.75, id: "b1_pot17" },
];

const BARROW1_ROCK: PropPlacement[] = [
  { kind: "rock", x: 3.375, y: 32.375 },
  { kind: "rock", x: 13.375, y: 28.875, v: 1 },
  { kind: "rock", x: 17.625, y: 35.25 },
  { kind: "rock", x: 29.75, y: 35.625, v: 1, flip: true },
  { kind: "rock", x: 41.25, y: 27.375, v: 1 },
  { kind: "rock", x: 36.625, y: 33.75 },
];

const BARROW1_BOULDER: PropPlacement[] = [
  { kind: "boulder", x: 12.625, y: 22.75 },
  { kind: "boulder", x: 17.375, y: 29.875 },
  { kind: "boulder", x: 45.25, y: 36.375 },
];

const BARROW1_MUSHROOM: PropPlacement[] = [
  { kind: "mushroom", x: 11.5, y: 32.75, v: 1 },
  { kind: "mushroom", x: 8.25, y: 31, v: 1 },
  { kind: "mushroom", x: 10.5, y: 30.625 },
  { kind: "mushroom", x: 11.75, y: 31.875 },
  { kind: "mushroom", x: 18.375, y: 36.75, v: 1 },
  { kind: "mushroom", x: 19.5, y: 37, v: 1 },
  { kind: "mushroom", x: 19.5, y: 35.625, v: 1 },
];

const BARROW1_CRATE: PropPlacement[] = [
  { kind: "crate", x: 18.625, y: 31.25, id: "b1_crate01" },
  { kind: "crate", x: 19.5, y: 32.125, id: "b1_crate02" },
  { kind: "crate", x: 32.75, y: 29.625, id: "b1_crate03" },
];

const BARROW1_WEAPON_RACK: PropPlacement[] = [
  { kind: "weaponRack", x: 40.5, y: 20.875 },
];

const BARROW1_ENTITIES: EntityPlacement[] = [
  // gate
  { type: "gate", id: "g_barrow", x: 23, y: 7, w: 3, h: 1, kind: "iron", open: { any: [{ has: "barrowKey" }, { flag: "barrowGateOpen" }] } },
  { type: "gate", id: "g_b1_lever", x: 34, y: 26, w: 2, h: 1, kind: "iron", open: { flag: "leverB1" } },
  // chest
  { type: "chest", id: "c_b1_key", x: 40.5, y: 7.8, loot: { kind: "item", item: "barrowKey" } },
  { type: "chest", id: "c_b1_ring", x: 8, y: 6.4, loot: { kind: "item", item: "silverRing" } },
  { type: "chest", id: "c_b1_ember", x: 34.9, y: 24.3, loot: { kind: "item", item: "emberBlade" } },
  { type: "chest", id: "c_b1_side", x: 20, y: 20.4, loot: { kind: "item", item: "fury" } },
  { type: "chest", id: "c_b1_gold", x: 4.6, y: 24.9, loot: { kind: "gold", amount: 200 } },
  // exit
  { type: "exit", x: 24, y: 37, w: 1, h: 1, to: "mossgloam", at: { x: 52.5, y: 10.2, facing: "down" }, kind: "stairs" },
  { type: "exit", x: 24, y: 3, w: 1, h: 1, to: "barrow2", at: { x: 16.5, y: 25.3, facing: "up" }, kind: "stairs" },
  // spawn
  { type: "spawn", id: "b1_bat_entry", monster: "duskbat", x: 27.5, y: 31.5, count: 2, radius: 1.5 },
  { type: "spawn", id: "b1_web_nest", monster: "webspinner", x: 8.5, y: 28.5, count: 2, radius: 2.2 },
  { type: "spawn", id: "b1_web_corr", monster: "webspinner", x: 24.5, y: 23.5, count: 1, radius: 1 },
  { type: "spawn", id: "b1_bat_crypt", monster: "duskbat", x: 8, y: 10, count: 2, radius: 1.5 },
  { type: "spawn", id: "b1_guard_crypt", monster: "barrowGuard", x: 8.5, y: 13.5, count: 1, radius: 1 },
  { type: "spawn", id: "b1_guard_hall", monster: "barrowGuard", x: 40.5, y: 14, count: 3, radius: 2.2 },
  { type: "spawn", id: "b1_web_east", monster: "webspinner", x: 43.5, y: 29.5, count: 2, radius: 1.8 },
  { type: "spawn", id: "b1_guard_gate", monster: "barrowGuard", x: 24.5, y: 13.8, count: 2, radius: 1.8 },
  // light
  { type: "light", x: 8, y: 9, radius: 110, color: "#7fb4ff" },
  { type: "light", x: 34.9, y: 24, radius: 90, color: "#ff8a3c", flicker: true },
  { type: "light", x: 38.9, y: 30, radius: 100, color: "#5fc8ff" },
  { type: "light", x: 24.5, y: 3.2, radius: 80, color: "#8fe8ff" },
  { type: "light", x: 24.5, y: 36.5, radius: 90, color: "#cfe6ff" },
  // fog
  { type: "fog", x: 2, y: 22, w: 13, h: 12 },
  { type: "fog", x: 31, y: 22, w: 16, h: 16 },
];

export const BARROW1: MapDef = {
  id: "barrow1",
  name: "The Barrow",
  kind: "dungeon",
  // prettier-ignore
  ground: [
    "################################################", // 0
    "#####################ttttttt####################", // 1
    "#####################ttttttt####################", // 2
    "#####################ttttttt####################", // 3
    "#####################ttttttt####################", // 4
    "####ttttttttt#########ttttt#####################", // 5
    "###ttttttttttt#########ttt######################", // 6
    "###ttttttttttt######tt#ttt#tt##########ttt######", // 7
    "###tt#ttttt#tt##ttttttttttttttttt##tttttttttt###", // 8
    "##ttttttttttttt#ttttttttttttttttt##ttttttttttt##", // 9
    "##ttttttttttttt#ttttttttttttttttt##ttttttttttt##", // 10
    "###ttttttttttt##ttttttttttttttttt##tt#ttttt#tt##", // 11
    "###tt#ttttt#tt##ttt#ttttttttt#ttt##ttttttttttt##", // 12
    "###ttttttttttt##ttttttttttttttttt#ttttttttttttt#", // 13
    "###ttttttttttt##ttttttttttttttttt#ttttttttttttt#", // 14
    "####ttttttttt####ttttttttttttttt###ttttttttttt##", // 15
    "#######kk##############ttt#########tt#ttttt#tt##", // 16
    "#######kk##############ttt#########ttttttttttt##", // 17
    "#######kk##############ttttttttttttttttttttttt##", // 18
    "#######kk##########ttttttttttttttttttttttttttt##", // 19
    "#######kk##########ttttttt##########ttttttttt###", // 20
    "#######kk##########ttttttt#################tt###", // 21
    "#######kk#k########ttttttt#################tt###", // 22
    "######kkkkk############ttt#######tttttWWkkkkkk##", // 23
    "####kkkkkkkk###########ttt######ttttttWWwkkkkkk#", // 24
    "###kkkkkkkkkkk#########ttt######ttttttWWwkkkkkk#", // 25
    "###kkkkkkkkkkk#########ttt########tt##WWwkkkkkk#", // 26
    "###kkkkkkkkkkk#########ttt######ttttttWWwkkkkkk#", // 27
    "##kkkkkkkkkkkkk######kkkkk#k####ttttttWWkkkkkkk#", // 28
    "##kkkkkkkkkkkkk###kkkkkkkkkkk###ttttttWWkkkkkkk#", // 29
    "###kkkkkkkkkk####kkkkkkkkkkkkk##ttttttWWwkkkkkk#", // 30
    "####kkkkkkkkk###kkkkkkkkkkkkkk##ttttttWWwkkkkkk#", // 31
    "#####kkkkkkkkkkkkkkkkkkkkkkkkkttttttttWWwkkkkkk#", // 32
    "#########k##kkkkkkkkkkkkkkkkkkttttttttWWwkkkkkk#", // 33
    "#############kkkkkkkkkkkkkkkkkttttttttWWkkkkkkk#", // 34
    "#################kkkkkkkkkkkkkk#ttttttWWkkkkkkk#", // 35
    "##################kkkkktttkkk###ttttttWWwkkkkkk#", // 36
    "###################kkkktttkk#####tttttWWwkkkkk##", // 37
    "######################k#########################", // 38
    "################################################", // 39
  ],
  // prettier-ignore
  height: [
    "000000000000000011111111111111111000000000000000", // 0
    "000000000000000011111111111111111000000000000000", // 1
    "000000000000000011111111111111111000000000000000", // 2
    "000000000000000011111111111111111000000000000000", // 3
    "000000000000000011111111111111111000000000000000", // 4
    "000000000000000011111111111111111000000000000000", // 5
    "000000000000000011111111111111111000000000000000", // 6
    "000000000000000011111111111111111000000000000000", // 7
    "000000000000000011111111111111111000000000000000", // 8
    "000000000000000011111111111111111000000000000000", // 9
    "000000000000000011111111111111111000000000000000", // 10
    "000000000000000000000000000000000000000000000000", // 11
    "000000000000000000000000000000000000000000000000", // 12
    "000000000000000000000000000000000000000000000000", // 13
    "000000000000000000000000000000000000000000000000", // 14
    "000000000000000000000000000000000000000000000000", // 15
    "000000000000000000000000000000000000000000000000", // 16
    "000000000000000000000000000000000000000000000000", // 17
    "000000000000000000000000000000000000000000000000", // 18
    "000000000000000000000000000000000000000000000000", // 19
    "000000000000000000000000000000000000000000000000", // 20
    "000000000000000000000000000000000000000000000000", // 21
    "000000000000000000000000000000000000000000000000", // 22
    "000000000000000000000000000000000000000000000000", // 23
    "000000000000000000000000000000000000000000000000", // 24
    "000000000000000000000000000000000000000000000000", // 25
    "000000000000000000000000000000000000000000000000", // 26
    "000000000000000000000000000000000000000000000000", // 27
    "000000000000000000000000000000000000000000000000", // 28
    "000000000000000000000000000000000000000000000000", // 29
    "000000000000000000000000000000000000000000000000", // 30
    "000000000000000000000000000000000000000000000000", // 31
    "000000000000000000000000000000000000000000000000", // 32
    "000000000000000000000000000000000000000000000000", // 33
    "000000000000000000000000000000000000000000000000", // 34
    "000000000000000000000000000000000000000000000000", // 35
    "000000000000000000000000000000000000000000000000", // 36
    "000000000000000000000000000000000000000000000000", // 37
    "000000000000000000000000000000000000000000000000", // 38
    "000000000000000000000000000000000000000000000000", // 39
  ],
  props: [
    ...BARROW1_STAIRS_UP,
    ...BARROW1_STAIRS_DOWN,
    ...BARROW1_LEVER,
    ...BARROW1_TORCH,
    ...BARROW1_BRAZIER,
    ...BARROW1_STATUE,
    ...BARROW1_GRAVESTONE,
    ...BARROW1_BANNER,
    ...BARROW1_WEB,
    ...BARROW1_BONES,
    ...BARROW1_POT,
    ...BARROW1_ROCK,
    ...BARROW1_BOULDER,
    ...BARROW1_MUSHROOM,
    ...BARROW1_CRATE,
    ...BARROW1_WEAPON_RACK,
  ],
  entities: BARROW1_ENTITIES,
  music: "dungeon",
  light: "cave",
  spawn: { x: 24.5, y: 36.4, facing: "up" },
  level: 7,
};
