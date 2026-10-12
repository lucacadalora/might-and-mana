import type { Cond, EntityPlacement, MapId, QuestDef, QuestStep } from "../contract";
import { MAPS } from "./maps";

/**
 * Quests for Chapter One (docs/game-05/CONTENT.md). How the sim runs them (lib/game-05/sim):
 *  - A step whose goal is met advances on its own; meeting the last step completes the quest and
 *    shows the reward card. Collect goals count what is already in the bag (so an item found early
 *    completes its step the moment the quest starts). Key items named by collect goals are handed
 *    over when the quest completes.
 *  - A talk goal is met when any dialog with that NPC ends while the step is active. Turn-in
 *    dialogs also carry `completeQuest` explicitly; both paths are idempotent.
 *  - `startQuest` starts at once and shows the quest card; there is no decline. The sim refuses a
 *    second side/bounty quest, so NPC offers are gated on `SIDE_BUSY` (see npcs.ts).
 *  - The engine appends " n / N" to the ticker of kill and multi-count collect steps, so those
 *    tickers are the bare noun ("Feverroot" → "Feverroot 3 / 10").
 *  - The bounty board (sim) shows "<title>: <summary>" in one dialog box, so bounty summaries
 *    are short enough for that to wrap to three lines.
 *  - Arrow: `target` if given, else the talk goal's NPC, else a reach goal's point. Targets in
 *    another map are routed through exits by the engine.
 *
 * Coordinates come from the live maps (chests, spawns, exits, the lamb follower) so they always
 * match what the map lane placed. When an entity is missing (maps are stubs early on) the
 * CONTENT.md estimate is used and recorded in TARGET_FALLBACKS; tests/game-05/content-check.mjs
 * warns about each one.
 */

// ─── Shared conditions (used by npcs.ts and the check) ──────────────────────────────────────────
export const MAIN_QUEST = "wardstone";
export const SIDE_QUESTS = ["feverroot", "lostLamb", "wellSpirit", "fishersRod", "bakersRound"] as const;
export const BOUNTY_QUESTS = ["bountyMoss", "bountyTusk"] as const;
/** True while any side or bounty quest is active (only one may be). */
export const SIDE_BUSY: Cond = { any: [...SIDE_QUESTS, ...BOUNTY_QUESTS].map(q => ({ questActive: q })) };
/** Condition helpers for talk rules: at a quest step, all of, any of. */
export const atStep = (quest: string, s: string): Cond => ({ quest, step: s });
export const allOf = (...c: Cond[]): Cond => ({ all: c });
export const anyOf = (...c: Cond[]): Cond => ({ any: c });

// ─── Map-derived coordinates ─────────────────────────────────────────────────────────────────────
type Point = { x: number; y: number };
export const TARGET_FALLBACKS: string[] = [];

function find(map: MapId, label: string, pred: (e: EntityPlacement) => boolean, pick: (e: EntityPlacement) => Point, fallback: Point): Point {
  const e = MAPS[map]?.entities.find(pred);
  if (e) return pick(e);
  TARGET_FALLBACKS.push(`${map}: ${label} not placed yet (using ${fallback.x}, ${fallback.y})`);
  return fallback;
}
const center = (e: EntityPlacement): Point =>
  "w" in e && "h" in e ? { x: e.x + e.w / 2, y: e.y + e.h / 2 } : { x: e.x, y: e.y };
const chest = (map: MapId, id: string, fb: Point) => {
  const p = find(map, `chest ${id}`, e => e.type === "chest" && e.id === id, center, fb);
  return { map, x: p.x, y: p.y };
};
const spawnOf = (map: MapId, label: string, pred: (e: Extract<EntityPlacement, { type: "spawn" }>) => boolean, fb: Point) => {
  const p = find(map, label, e => e.type === "spawn" && pred(e), center, fb);
  return { map, x: p.x, y: p.y };
};
/** Where the hero arrives in `to` when leaving `from` through its exit. */
const arrival = (from: MapId, to: MapId, fb: Point) =>
  find(from, `exit to ${to}`, e => e.type === "exit" && e.to === to, e => (e.type === "exit" ? e.at : center(e)), fb);
/** Exit rectangle centre in `from` that leads to `to`. */
const exitIn = (from: MapId, to: MapId, fb: Point) => {
  const p = find(from, `exit to ${to}`, e => e.type === "exit" && e.to === to, center, fb);
  return { map: from, x: p.x, y: p.y };
};
const lambPos = find(
  "southfold", "lamb follower",
  e => (e.type === "follower" && e.npc === "lamb") || (e.type === "npc" && e.id === "lamb"),
  center, { x: 64, y: 30 },
);
const mossArrival = arrival("southfold", "mossgloam", { x: 1.5, y: 31.5 });

// ─── Quests ─────────────────────────────────────────────────────────────────────────────────────
const s = (id: string, ticker: string, goal: QuestStep["goal"], target?: QuestStep["target"]): QuestStep =>
  target ? { id, ticker, goal, target } : { id, ticker, goal };

export const QUESTS: Record<string, QuestDef> = {
  wardstone: {
    id: "wardstone",
    kind: "main",
    title: "The First Wardstone",
    summary: "The first of the three wardstones is cracking under the Barrow. Find what is choking it and cut it loose.",
    giver: "oren",
    steps: [
      s("dress", "Open the chest by your bed", { kind: "flag", flag: "dressed" }, chest("home", "c_home_bed", { x: 2.5, y: 3 })),
      s("oren", "Talk to Grandpa Oren", { kind: "talk", npc: "oren" }, { npc: "oren" }),
      s("dummy", "Practise at the dummy", { kind: "flag", flag: "dummyDone" },
        spawnOf("larkmoor", "training dummy", e => e.monster === "dummy", { x: 12, y: 14 })),
      s("maren", "See Elder Maren at the hall", { kind: "talk", npc: "maren" }, { npc: "maren" }),
      s("southfold", "Cross Southfold to the wood",
        { kind: "reach", map: "mossgloam", x: mossArrival.x, y: mossArrival.y, r: 3 },
        exitIn("southfold", "mossgloam", { x: 71.5, y: 23.5 })),
      s("grove", "Drive the wolves from the grove", { kind: "flag", flag: "wolvesCleared" },
        spawnOf("mossgloam", "spawn groveWolves", e => e.id === "groveWolves", { x: 30, y: 30 })),
      s("barrow", "Find the Barrow key", { kind: "collect", item: "barrowKey", count: 1 },
        chest("barrow1", "c_b1_key", { x: 40, y: 12 })),
      s("thorn", "Defeat the Thornmother", { kind: "flag", flag: "bossDown" },
        spawnOf("barrow2", "Thornmother spawn", e => e.monster === "thornmother", { x: 16, y: 11 })),
      s("return", "Return to Elder Maren", { kind: "talk", npc: "maren" }, { npc: "maren" }),
    ],
    reward: { gold: 300, xp: 250 },
  },

  feverroot: {
    id: "feverroot",
    kind: "side",
    title: "Feverroot",
    summary: "Tilda needs ten feverroots for her fever tonic. They hide at the roots of the long grass.",
    giver: "tilda",
    steps: [
      s("gather", "Feverroot", { kind: "collect", item: "feverroot", count: 10 }),
      s("return", "Bring the roots to Tilda", { kind: "talk", npc: "tilda" }, { npc: "tilda" }),
    ],
    reward: { gold: 60, xp: 30, items: ["manaDraught", "manaDraught"] },
    hint: "Cut long grass and bushes. The roots only turn up while you are looking for them.",
  },

  lostLamb: {
    id: "lostLamb",
    kind: "side",
    title: "The Lost Lamb",
    summary: "Lottie's lamb Clover has wandered off to the far pasture in Southfold. Find her and walk her home.",
    giver: "lottie",
    steps: [
      s("find", "Find Clover in Southfold", { kind: "reach", map: "southfold", x: lambPos.x, y: lambPos.y, r: 2.5 },
        { map: "southfold", x: lambPos.x, y: lambPos.y }),
      s("lead", "Lead Clover home to the pen", { kind: "flag", flag: "lambHome" }, { npc: "lottie" }),
      s("thank", "Tell Lottie", { kind: "talk", npc: "lottie" }, { npc: "lottie" }),
    ],
    reward: { gold: 40, xp: 50, items: ["lambsBell"] },
    hint: "Clover stays close behind you. Keep her out of fights: she cannot take a bite.",
  },

  bountyMoss: {
    id: "bountyMoss",
    kind: "bounty",
    title: "Bounty: Mosslings",
    summary: "Mosslings are eating the turnips. Thin out eight, then see Cato at the gate for pay.",
    steps: [
      s("hunt", "Mosslings", { kind: "kill", monster: "mossling", count: 8 },
        spawnOf("southfold", "mossling spawn", e => e.monster === "mossling", { x: 34, y: 10 })),
      s("claim", "Claim your pay from Cato", { kind: "talk", npc: "cato" }, { npc: "cato" }),
    ],
    reward: { gold: 80, xp: 40 },
    hint: "Mosslings crouch before they hop. Step aside, then cut.",
  },

  bountyTusk: {
    id: "bountyTusk",
    kind: "bounty",
    title: "Bounty: The Old Tusk",
    summary: "A boar the size of a cart haunts the north-west thicket. Cato pays the bounty.",
    minLevel: 4,
    steps: [
      s("hunt", "The Old Tusk", { kind: "kill", monster: "oldTusk", count: 1 },
        spawnOf("southfold", "oldTusk spawn", e => e.monster === "oldTusk", { x: 8, y: 8 })),
      s("claim", "Claim your pay from Cato", { kind: "talk", npc: "cato" }, { npc: "cato" }),
    ],
    reward: { gold: 150, xp: 80, items: ["boarhideHelm"] },
    hint: "He charges in straight lines. Stand before a wall, step aside, and he stuns himself.",
  },

  wellSpirit: {
    id: "wellSpirit",
    kind: "side",
    title: "The Well Spirit",
    summary: "A spirit in the old well lost her silver ring to the Barrow long ago. Find it and bring it to her at night.",
    giver: "wellSpirit",
    steps: [
      s("ring", "Find the silver ring", { kind: "collect", item: "silverRing", count: 1 },
        chest("barrow1", "c_b1_ring", { x: 8, y: 12 })),
      s("give", "Return the ring at night", { kind: "talk", npc: "wellSpirit" }, { npc: "wellSpirit" }),
    ],
    reward: { xp: 120, items: ["travelersKnot"], spell: "thornbreak" },
    hint: "The spirit only rises after dark. Rest at Bram's inn until night falls.",
  },

  fishersRod: {
    id: "fishersRod",
    kind: "side",
    title: "The Fisher's Rod",
    summary: "Dunn lost his favourite rod when the old bridge in Mossgloam Wood collapsed. It must be near the wreck.",
    giver: "dunn",
    steps: [
      s("rod", "Find Dunn's rod", { kind: "collect", item: "fishingRod", count: 1 },
        chest("mossgloam", "c_mg_bridge", { x: 40, y: 22 })),
      s("return", "Bring the rod to Dunn", { kind: "talk", npc: "dunn" }, { npc: "dunn" }),
    ],
    reward: { gold: 120, xp: 80, items: ["tonic", "tonic"] },
    hint: "Thorns block the wreck. A lever across the river pulls them back; a fallen log gets you there.",
  },

  bakersRound: {
    id: "bakersRound",
    kind: "side",
    title: "The Baker's Round",
    summary: "Pell's oven is full and her legs are tired. Take a warm loaf each to Bram, Hask and Cato, then come back.",
    giver: "pell",
    steps: [
      s("bram", "Bread for Bram at the inn", { kind: "flag", flag: "loaf_bram" }, { npc: "bram" }),
      s("hask", "Bread for Hask at the forge", { kind: "flag", flag: "loaf_hask" }, { npc: "hask" }),
      s("cato", "Bread for Cato at the gate", { kind: "flag", flag: "loaf_cato" }, { npc: "cato" }),
      s("return", "Back to Pell", { kind: "talk", npc: "pell" }, { npc: "pell" }),
    ],
    reward: { gold: 100, xp: 40, items: ["elixir"] },
    hint: "Any order works: each stop counts the moment you hand over a loaf.",
  },
};

/** Every flag the content may set or test (CONTENT.md list). The check rejects anything else. */
export const FLAGS = [
  "dressed", "gotBlade", "dummyDone", "metMaren", "gateOpen", "wolvesCleared", "bridgeLever", "barrowGateOpen",
  "leverB1", "bossDown", "wardstoneLit", "sawHooded", "chapterClear", "lambHome", "ringFound", "rodFound",
  "loaf_bram", "loaf_hask", "loaf_cato", "drankRosa",
] as const;
