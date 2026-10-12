import type { MonsterDef, Stats } from "../contract";
import { statsAt } from "./levels";

/**
 * Chapter One monsters (CONTENT.md "Monsters"). Stats are the shared level table at the monster's
 * level × `mult` (× 1.5 for elites), exactly as the sim builds them (`monsterStats` below).
 *
 * ── Balance reasoning ─────────────────────────────────────────────────────────────────────────
 * 25 Sep (after bot runs): Thornmother mult.hp 29.3 → 24 (~1080 HP) and every gold range ×1.6; greywolf HP ×0.85,
 * barrowGuard ×0.9 (back inside the 2–4.2 swing band), so a
 * main-path player (no side quests) can afford one upgrade before the Barrow and the boss is
 * about 65 Iron Sword swings.
 * 25 Sep: the sim now uses damage = max(1, round(power × ATK² / (ATK + DEF) × U(0.9, 1.1))),
 * so hits grow with level (about 7 at L1, 15 at the boss). Every mult.hp below was scaled by the
 * expected hero ATK / 2 and every `power` = old MONSTER_POWER × 2 / monster ATK, which keeps the
 * swings-to-kill and hit-% targets of the table unchanged. The notes that follow describe the
 * original derivation.
 * Damage (then): max(1, round(power × ATK × 2 / (ATK + DEF) × U(0.9, 1.1))), crit ×2. The
 * ratio 2·ATK/(ATK+DEF) never exceeds 2, so a hit is worth about `power` no matter the level.
 * The sim swings at power 1 / 1 / 1.2 / 1.5 along the combo (spin 1.6), so hero hits are 1–3
 * (crits 2–6) all chapter long and monster HP stays small: HP multipliers FALL with level while
 * the table's HP rises 12 % a level. Monster hits in the sim use fixed powers of 0.55–1.4, which
 * cap them at 1–3 damage while hero HP grows from 18 to 45; from level 5 on every common monster
 * would hit for exactly 1 (2–3 % of max HP). `MONSTER_POWER` below is the per-species attack
 * multiplier that restores the 6–12 % target; it needs the sim to multiply every move power of a
 * monster by it (requested as `MonsterDef.power`). Until then, only the "now" column applies.
 *
 * Expected hero (level from the XP path in tests/game-05/content-check.mjs, gear affordable then):
 * L1–2 cloth + Worn Blade · L3 + Leather Cap · L4–5 Leather Cap II (Southfold chest), Vest, Boots ·
 * L6 Leather II · L7–9 Iron Sword + Boar I set. Rows: swings to kill (mean, p10–p90, Monte Carlo
 * with the sim's miss/crit rolls) and the main attack's damage as % of max HP, now → with power.
 *
 *   monster      hero                 HP/ATK/DEF/SPD  swings        hit taken (% max HP)
 *   mossling     L1 A9 D6 S9 HP18     6/6/2/6         3.0 (2–4)     lunge 6 → 8 %
 *   duskbat      L2 A10 D7 S10 HP20   6/7/2/11        3.1 (3–4)     swoop 5 → 8 %
 *   bristleboar  L3 A11 D7 S10 HP23   6/8/3/8         3.4 (3–4)     charge 6 → 9 %  (stuns on walls)
 *   sporecap     L4 A13 D9 S11 HP25   6/8/4/7         3.5 (3–4)     spore tick 4 → 8 %, ≤ 2 ticks
 *   Old Tusk     L5 A14 D9 S13 HP28   14/15/6/15      10.4 (9–12)   charge 7 → 11 %  (elite ×1.5)
 *   greywolf     L5 A14 D9 S13 HP28   7/10/3/12       4.0 (3–5)     lunge 4 → 11 %
 *   greywolf     L6 A15 D11 S14 HP32  7/10/3/12       3.9 (3–4)     lunge 3 → 9 %
 *   webspinner   L7 A21 D15 S18 HP36  6/13/5/11       3.0 (2–4)     web 3 → 6 % + slow, bite 3 → 8 %
 *   barrowGuard  L8 A22 D16 S19 HP40  7/13/9/10       4.2 (3–5)     swing 3 → 8 %  (blocks from the front)
 *   thornling    L9 A23 D17 S20 HP45  4/10/4/12       1.9 (1–2)     lunge 2 → 4 %  (brood chip damage)
 *   Thornmother  L9 A23 D17 S20 HP45  115/16/13/12    74            charge 2 → 13 %, thorns 2 → 11 %, webs 2 → 8 %
 *
 * Thornmother at L9 with Iron Sword + Boar I: 74 landed swings plus 8 Ember Bolts (~16 damage)
 * → 87 / 73 / 60 s at 0.75 / 0.9 / 1.1 swings per second of fight (dodging and brood included).
 * The Ember Blade (Barrow chest) and Thornbreak (Well Spirit) shorten it, as rewards should.
 * Grove wave, 5 greywolves at L6: ~19 swings over ~23 s; trading half the lunges costs ~26 of 32
 * HP with MONSTER_POWER (a real fight: one or two herbs), ~9 HP with the sim's powers today.
 * XP per kill (≈ 3 same-level kills per level at L1 rising to ≈ 9 at L7) gives L4 in the first
 * ten minutes, L6 at the grove, L9 at the Thornmother and L10 at chapter clear (check output).
 * A real-sim run (40 fights each) matched the model: mossling 3.5 swings incl. whiffs at L1,
 * webspinner 3.1 at L7.
 */
const m = (hp: number, atk: number, def: number, spd: number): Stats => ({ hp, mp: 0, atk, def, spd });

export const MONSTERS: Record<string, MonsterDef> = {
  mossling: {
    id: "mossling", name: "Mossling", level: 1, behaviour: "hopper", mult: m(1.485, 1.0, 0.4, 0.8),
    radius: 9, speed: 42, sprite: "mon.mossling", xp: 9, gold: [2, 5],
    drops: { gold: 0.7, consumable: 0.12, gear: 0.04 }, weight: 1.3, contact: 0.6, power: 0.5,
  },
  duskbat: {
    id: "duskbat", name: "Duskbat", level: 2, behaviour: "swooper", mult: m(1.5, 1.0, 0.4, 1.2),
    radius: 8, speed: 62, sprite: "mon.duskbat", xp: 14, gold: [2, 6],
    drops: { gold: 0.6, consumable: 0.1, gear: 0.03 }, weight: 1.5, contact: 0, power: 0.49,
  },
  bristleboar: {
    id: "bristleboar", name: "Bristleboar", level: 3, behaviour: "charger", mult: m(1.54, 1.1, 0.5, 0.9),
    radius: 14, speed: 52, sprite: "mon.bristleboar", xp: 22, gold: [5, 10],
    drops: { gold: 0.7, consumable: 0.12, gear: 0.05 }, weight: 0.7, contact: 0.6, power: 0.375,
  },
  sporecap: {
    id: "sporecap", name: "Sporecap", level: 4, behaviour: "spore", mult: m(1.625, 1.0, 0.5, 0.7),
    radius: 11, speed: 26, sprite: "mon.sporecap", xp: 28, gold: [5, 11],
    drops: { gold: 0.7, consumable: 0.16, gear: 0.04 }, weight: 0.9, contact: 0.5, power: 0.8,
  },
  greywolf: {
    id: "greywolf", name: "Greywolf", level: 5, behaviour: "packWolf", mult: m(1.54, 1.1, 0.45, 1.1),
    radius: 13, speed: 88, sprite: "mon.greywolf", xp: 34, gold: [6, 13],
    drops: { gold: 0.7, consumable: 0.12, gear: 0.05 }, weight: 1.0, contact: 0, power: 0.56,
  },
  webspinner: {
    id: "webspinner", name: "Webspinner", level: 6, behaviour: "spitter", mult: m(1.89, 1.3, 0.6, 0.9),
    radius: 14, speed: 54, sprite: "mon.webspinner", xp: 44, gold: [8, 16],
    drops: { gold: 0.7, consumable: 0.12, gear: 0.05 }, weight: 0.9, contact: 0, power: 0.54,
  },
  barrowGuard: {
    id: "barrowGuard", name: "Barrow Guard", level: 7, behaviour: "shieldGuard", mult: m(1.98, 1.2, 1.0, 0.8),
    radius: 12, speed: 40, sprite: "mon.barrowGuard", xp: 58, gold: [11, 21],
    drops: { gold: 0.75, consumable: 0.12, gear: 0.06 }, weight: 0.5, contact: 0, power: 0.43,
  },
  thornling: {
    id: "thornling", name: "Thornling", level: 6, behaviour: "hopper", mult: m(1.38, 1.0, 0.5, 1.0),
    radius: 8, speed: 58, sprite: "mon.thornling", xp: 4, gold: [2, 3],
    drops: { gold: 0.25, consumable: 0.1, gear: 0 }, weight: 1.4, contact: 0.5, power: 0.6,
  },
  oldTusk: {
    id: "oldTusk", name: "The Old Tusk", level: 5, behaviour: "charger", mult: m(2.31, 1.1, 0.6, 0.9),
    radius: 16, speed: 60, sprite: "mon.bristleboar", xp: 80, gold: [64, 96],
    drops: { gold: 1, consumable: 1, gear: 0.5 }, elite: true, weight: 0.4, contact: 0.8, power: 0.21,
  },
  thornmother: {
    id: "thornmother", name: "The Thornmother", level: 9, behaviour: "boss", mult: m(24, 1.2, 1.2, 0.8),
    radius: 34, speed: 46, sprite: "mon.thornmother", xp: 420, gold: [240, 320],
    drops: { gold: 1, consumable: 1, gear: 0 }, weight: 0.08, contact: 0.8, power: 0.56, boss: { phases: 3 },
  },
  dummy: {
    id: "dummy", name: "Training Dummy", level: 1, behaviour: "dummy", mult: m(1, 1, 1, 1),
    radius: 10, speed: 0, sprite: "mon.dummy", xp: 0, gold: [0, 0],
    drops: { gold: 0, consumable: 0, gear: 0 }, weight: 0, contact: 0, power: 1,
  },
};

/**
 * Attack power multiplier per species (proposed `MonsterDef.power`, default 1): the sim should
 * multiply every move power of that monster (contact, lunge, charge, strike, spit, spore, boss
 * moves) by it. Tuned so a common monster's main attack takes 6–12 % of the expected hero's max
 * HP and the boss and the elite 11–13 %. The dummy never attacks.
 */
export const MONSTER_POWER: Record<string, number> = Object.fromEntries(
  Object.entries(MONSTERS).map(([id, def]) => [id, def.power ?? 1]),
);

/** Effective stats of a monster, exactly as the sim builds them (level table × mult × elite 1.5). */
export function monsterStats(def: MonsterDef): Stats {
  const base = statsAt(def.level);
  const e = def.elite ? 1.5 : 1;
  return {
    hp: Math.max(1, Math.round(base.hp * def.mult.hp * e)),
    mp: Math.max(0, Math.round(base.mp * def.mult.mp)),
    atk: Math.max(1, Math.round(base.atk * def.mult.atk * e)),
    def: Math.max(1, Math.round(base.def * def.mult.def * e)),
    spd: Math.max(1, Math.round(base.spd * def.mult.spd * e)),
  };
}
