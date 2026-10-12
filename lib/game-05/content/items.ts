import type { ConsumableDef, GearDef, KeyItemDef, Slot } from "../contract";

/**
 * Items for Chapter One. Ids are binding (docs/game-05/CONTENT.md). Icons are `icon.<itemId>`.
 *
 * Gear ladder (DIRECTION.md "Gear and items"): Cloth (start) → Leather I/II/III → Boarhide I/II/III
 * → Bronze I. Head is mostly ATK, body DEF, boots SPD, the weapon ATK, charms trade off.
 * Prices: tier III ≈ 2.5 × tier I inside a line; boar ≈ 1.8 × the matching leather grade; bronze
 * above boar III. Gear adds roughly 20–40 % on top of the level table, so levels still dominate.
 *
 *            head (ATK)          body (DEF)            boots (SPD)          price I / II / III
 *   cloth    +1                  +1                    +1                   start, not sold
 *   leather  +2 / +3 / +4 (+1D)  +2 / +3 / +5          +2 / +3 / +4 (+1D)   80/135/200 · 110/185/275 · 70/120/175
 *   boar     +5 / +6 / +8        +6 / +7 / +9 (−1 SPD) +5 / +6 / +7         145/245/360 · 200/335/495 · 125/215/315
 *   bronze   +9 (+2 DEF)         +11 (−1 SPD)          +7 (+3 DEF)          480 · 650 · 420
 *   weapon   Worn Blade +2 (Oren) → Iron Sword +5 (400 g) → Ember Blade +8, burn (Barrow chest)
 *
 * `price` is the item's value: shops sell only what their stock lists (shops.ts), and selling pays
 * SELL_RATE of it. `price: null` marks unique gear (start, quest or chest) that is never bought or
 * sold. Boar II/III are drop-only in Chapter One but keep a value so they can be sold back.
 */

const gear = (
  id: string, name: string, slot: Slot, tier: number, price: number | null,
  mods: GearDef["mods"], desc: string, extra: Partial<GearDef> = {},
): GearDef => ({ id, name, slot, tier, price, mods, icon: `icon.${id}`, desc, ...extra });

export const GEAR: Record<string, GearDef> = {
  // ── Head: mostly ATK ──
  clothHood: gear("clothHood", "Cloth Hood", "head", 0, null, { atk: 1 }, "Keeps the rain off. Mostly."),
  leatherCap1: gear("leatherCap1", "Leather Cap", "head", 1, 80, { atk: 2 }, "Stiff cowhide that sits snug over the brow.", { dropLevels: [1, 3] }),
  leatherCap2: gear("leatherCap2", "Leather Cap II", "head", 2, 135, { atk: 3 }, "Double-stitched, with a brim to shade the eyes.", { dropLevels: [2, 5] }),
  leatherCap3: gear("leatherCap3", "Leather Cap III", "head", 3, 200, { atk: 4, def: 1 }, "Boiled leather with a riveted crown band.", { dropLevels: [4, 6] }),
  boarhideHelm: gear("boarhideHelm", "Boarhide Helm", "head", 4, null, { atk: 5, def: 2, hp: 4 }, "Cut from the Old Tusk's hide. Smells of victory.", { special: "none" }),
  boarCap1: gear("boarCap1", "Boar Cap", "head", 5, 145, { atk: 5 }, "Bristly boar hide over a felt lining.", { dropLevels: [5, 7] }),
  boarCap2: gear("boarCap2", "Boar Cap II", "head", 6, 245, { atk: 6, def: 1 }, "Tusk studs at the temples. Rude, but effective.", { dropLevels: [6, 8] }),
  boarCap3: gear("boarCap3", "Boar Cap III", "head", 7, 360, { atk: 8, def: 1 }, "A hunter's cap, cured in smoke for a month.", { dropLevels: [7, 9] }),
  bronzeHelm1: gear("bronzeHelm1", "Bronze Helm", "head", 8, 480, { atk: 9, def: 2 }, "Cast bronze with a nose guard. Rings when struck.", { dropLevels: [8, 10] }),

  // ── Body: DEF ──
  clothTunic: gear("clothTunic", "Cloth Tunic", "body", 0, null, { def: 1 }, "Grandma's stitching. Warm, not armour."),
  leatherVest1: gear("leatherVest1", "Leather Vest", "body", 1, 110, { def: 2 }, "A plain vest of tanned hide.", { dropLevels: [1, 3] }),
  leatherVest2: gear("leatherVest2", "Leather Vest II", "body", 2, 185, { def: 3 }, "Layered hide over the ribs and shoulders.", { dropLevels: [2, 5] }),
  leatherVest3: gear("leatherVest3", "Leather Vest III", "body", 3, 275, { def: 5 }, "Hardened plates laced over thick hide.", { dropLevels: [4, 6] }),
  boarVest1: gear("boarVest1", "Boar Vest", "body", 4, 200, { def: 6 }, "Tough boar hide. Turns a wolf's tooth.", { dropLevels: [5, 7] }),
  boarVest2: gear("boarVest2", "Boar Vest II", "body", 5, 335, { def: 7, hp: 4 }, "Doubled hide with a quilted lining.", { dropLevels: [6, 8] }),
  boarVest3: gear("boarVest3", "Boar Vest III", "body", 6, 495, { def: 9, spd: -1 }, "Heavy, bristled, nearly a wall.", { dropLevels: [7, 9] }),
  bronzeMail1: gear("bronzeMail1", "Bronze Mail", "body", 7, 650, { def: 11, spd: -1 }, "Bronze scales on stout leather. Loud, sure.", { dropLevels: [8, 10] }),

  // ── Boots: SPD ──
  clothShoes: gear("clothShoes", "Cloth Shoes", "boots", 0, null, { spd: 1 }, "Soft soles for village lanes."),
  leatherBoots1: gear("leatherBoots1", "Leather Boots", "boots", 1, 70, { spd: 2 }, "Light boots with a good grip.", { dropLevels: [1, 3] }),
  leatherBoots2: gear("leatherBoots2", "Leather Boots II", "boots", 2, 120, { spd: 3 }, "Laced high. Made for long roads.", { dropLevels: [2, 5] }),
  leatherBoots3: gear("leatherBoots3", "Leather Boots III", "boots", 3, 175, { spd: 4, def: 1 }, "Oiled, reinforced, quiet on stone.", { dropLevels: [4, 6] }),
  boarBoots1: gear("boarBoots1", "Boar Boots", "boots", 4, 125, { spd: 5 }, "Boar hide with springy cork soles.", { dropLevels: [5, 7] }),
  boarBoots2: gear("boarBoots2", "Boar Boots II", "boots", 5, 215, { spd: 6, def: 1 }, "Shin guards of hide. Kick like a boar.", { dropLevels: [6, 8] }),
  boarBoots3: gear("boarBoots3", "Boar Boots III", "boots", 6, 315, { spd: 7, def: 1 }, "A tracker's boots. You barely hear yourself.", { dropLevels: [7, 9] }),
  bronzeGreaves1: gear("bronzeGreaves1", "Bronze Greaves", "boots", 7, 420, { spd: 7, def: 3 }, "Bronze shin plates on quick boots.", { dropLevels: [8, 10] }),

  // ── Weapons: ATK (never drop) ──
  wornBlade: gear("wornBlade", "Worn Blade", "weapon", 0, null, { atk: 2 }, "Grandpa's old blade. Nicked, honest, sharp enough."),
  ironSword: gear("ironSword", "Iron Sword", "weapon", 1, 400, { atk: 5 }, "Hask's work: balanced, plain and very sharp."),
  emberBlade: gear("emberBlade", "Ember Blade", "weapon", 2, null, { atk: 8, spd: 1 }, "A warden's sword that runs hot. Hits may burn.", { special: "burn" }),

  // ── Charms: trade-offs (never drop) ──
  travelersKnot: gear("travelersKnot", "Traveler's Knot", "charm", 1, null, { hp: 8, mp: 8, spd: 1 }, "River-reed knot from the well. Steadies breath and step."),
  wolfFang: gear("wolfFang", "Wolf Fang", "charm", 2, null, { atk: 4, def: -3 }, "A pack leader's fang. Bite harder, guard less."),
  lambsBell: gear("lambsBell", "Lamb's Bell", "charm", 3, null, { spd: 2 }, "A little brass bell. Coins seem to follow it.", { special: "goldFind" }),
};

/** Gold-find charm multiplier on coin drops (Lamb's Bell); Fortune (×2) stacks with it.
 *  Mirrors the sim (sim.ts goldFind); the sim should import this instead of a literal. */
export const GOLD_FIND = 1.25;
/** Burn from the Ember Blade (mirrors ai.ts): chance per landed slash, seconds, tick interval,
 *  damage per tick as a share of the hero's ATK. */
export const BURN = { chance: 0.25, seconds: 3, interval: 0.5, atkShare: 0.15 } as const;

const consumable = (
  id: string, name: string, price: number, carry: number, effect: ConsumableDef["effect"], dropWeight: number, desc: string,
): ConsumableDef => ({ id, name, price, carry, effect, dropWeight, icon: `icon.${id}`, desc });

/** Buff seconds for the four draughts (DIRECTION: 30-second draughts). */
export const BUFF_SECONDS = 30;
/** Buff multipliers (DIRECTION): Stoneskin damage taken ×0.5, Fury ATK ×2 and DEF ×0.5,
 *  Fortune gold ×2, Quickstep SPD ×1.6. */
export const BUFFS = {
  stoneskin: { damageTaken: 0.5 },
  fury: { atk: 2, def: 0.5 },
  fortune: { gold: 2 },
  quickstep: { spd: 1.6 },
} as const;

export const CONSUMABLES: Record<string, ConsumableDef> = {
  herb: consumable("herb", "Herb", 40, 9, { kind: "heal", hp: 40 }, 50, "A bitter leaf that knits small wounds. +40 HP."),
  tonic: consumable("tonic", "Tonic", 300, 9, { kind: "heal", hp: 150 }, 14, "Thick, red and awful. +150 HP."),
  manaDraught: consumable("manaDraught", "Mana Draught", 400, 9, { kind: "mana", mp: 40 }, 10, "Tastes like cold starlight. +40 MP."),
  elixir: consumable("elixir", "Elixir", 1500, 1, { kind: "full" }, 1, "Restores all HP and MP. You may carry only one."),
  stoneskin: consumable("stoneskin", "Stoneskin Draught", 500, 9, { kind: "buff", buff: "stoneskin", seconds: BUFF_SECONDS }, 3, "Skin like slate: half damage for 30 s."),
  fury: consumable("fury", "Fury Draught", 450, 9, { kind: "buff", buff: "fury", seconds: BUFF_SECONDS }, 3, "Double ATK, half DEF for 30 s. Choose wisely."),
  fortune: consumable("fortune", "Fortune Draught", 600, 9, { kind: "buff", buff: "fortune", seconds: BUFF_SECONDS }, 3, "Monsters drop double gold for 30 s."),
  quickstep: consumable("quickstep", "Quickstep Draught", 350, 9, { kind: "buff", buff: "quickstep", seconds: BUFF_SECONDS }, 3, "SPD ×1.6 for 30 s. Hit truer, dodge more."),
};

const key = (id: string, name: string, desc: string): KeyItemDef => ({ id, name, icon: `icon.${id}`, desc });

export const KEY_ITEMS: Record<string, KeyItemDef> = {
  feverroot: key("feverroot", "Feverroot", "A knobbly root from the long grass. Tilda wants ten."),
  barrowKey: key("barrowKey", "Barrow Key", "Black iron, cold as a cellar. Opens the Barrow's inner gate."),
  silverRing: key("silverRing", "Silver Ring", "Tarnished silver with a river pattern. It hums near water."),
  fishingRod: key("fishingRod", "Dunn's Rod", "A well-loved rod with a cork grip. Smells of lake."),
  loaves: key("loaves", "Warm Loaves", "Pell's morning bread. Deliver before it cools."),
};

/** Selling pays one quarter of the price (DIRECTION). Unique gear (price null) cannot be sold. */
export const SELL_RATE = 0.25;
export function sellPrice(itemId: string): number {
  const p = GEAR[itemId]?.price ?? CONSUMABLES[itemId]?.price ?? null;
  return p == null ? 0 : Math.floor(p * SELL_RATE);
}

export type ItemKind = "gear" | "consumable" | "key";
export function itemKind(itemId: string): ItemKind | null {
  if (GEAR[itemId]) return "gear";
  if (CONSUMABLES[itemId]) return "consumable";
  if (KEY_ITEMS[itemId]) return "key";
  return null;
}
export function itemName(itemId: string): string {
  return GEAR[itemId]?.name ?? CONSUMABLES[itemId]?.name ?? KEY_ITEMS[itemId]?.name ?? itemId;
}
export function itemIcon(itemId: string): string {
  return GEAR[itemId]?.icon ?? CONSUMABLES[itemId]?.icon ?? KEY_ITEMS[itemId]?.icon ?? `icon.${itemId}`;
}

/**
 * Loot rolls for cut and broken props (DIRECTION "Loot"; mirrors sim.ts cutProp). Entries are
 * checked in order and at most one fires: feverroot first (only while the `feverroot` quest is
 * active), then gold, then a herb. Coin totals are split into coins.
 */
export const PROP_LOOT = {
  grass: { feverroot: 0.35, gold: 0.18, coins: [1, 3] as [number, number], herb: 0.04 },
  reeds: { feverroot: 0.35, gold: 0.18, coins: [1, 3] as [number, number], herb: 0.04 },
  bush: { feverroot: 0.35, gold: 0.25, coins: [2, 4] as [number, number], herb: 0.05 },
  pot: { feverroot: 0, gold: 0.45, coins: [2, 6] as [number, number], herb: 0.08 },
  crate: { feverroot: 0, gold: 0.45, coins: [2, 6] as [number, number], herb: 0.08 },
} as const;

/** Default monster drop roll (DIRECTION): 70 % gold, 12 % consumable, 4 % gear in the level band. */
export const MONSTER_DROPS = { gold: 0.7, consumable: 0.12, gear: 0.04 } as const;

/** Fresh game loadout (mirrors sim.ts newSave). The bedside chest gives the tunic (and sets
 *  `dressed`); Oren gives the blade. The main quest starts at new game on its first step. */
export const START = {
  gold: 20,
  equipped: { head: "clothHood", body: null, boots: "clothShoes", weapon: null, charm: null } as Record<Slot, string | null>,
  bag: { herb: 1 } as Record<string, number>,
  quest: { id: "wardstone", step: "dress" },
} as const;
