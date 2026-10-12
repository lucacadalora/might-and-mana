import type { SpellDef, SpellId } from "../contract";

/**
 * Spells (DIRECTION "Unlocks"): Ember Bolt at L2, Frost Ring at L7, Thornbreak from the Well Spirit
 * quest (planned around L9). One Magic button casts the selected spell; Next Spell cycles.
 *
 * `power` goes into the DIRECTION damage formula with the sim's magic attack
 * (round(ATK × 0.8 + 2 × level)); magic never misses and never crits. A plain sword swing is
 * power 1.0, so Ember Bolt trades 3 MP for a slightly stronger hit at range, Frost Ring hits
 * everything around you and slows it, and each of Thornbreak's three thorns pierces.
 * `desc` is shown on the unlock banner followed by "Costs N MP.", so it is one short sentence.
 */
export const SPELLS: Record<SpellId, SpellDef> = {
  emberBolt: {
    id: "emberBolt",
    name: "Ember Bolt",
    mp: 3,
    level: 2,
    kind: "bolt",
    power: 1.3,
    icon: "icon.spell.emberBolt",
    desc: "Press Magic to throw a fast bolt of fire where you face.",
  },
  frostRing: {
    id: "frostRing",
    name: "Frost Ring",
    mp: 8,
    level: 7,
    kind: "ring",
    power: 1.1,
    icon: "icon.spell.frostRing",
    desc: "A ring of frost bursts out around you and slows what it touches.",
  },
  thornbreak: {
    id: "thornbreak",
    name: "Thornbreak",
    mp: 12,
    level: null,
    kind: "spread",
    power: 1.4,
    icon: "icon.spell.thornbreak",
    desc: "Three piercing thorns fly out in a fan. Brambles fear this word.",
  },
};

/** Spells in the order the Next Spell button cycles them. */
export const SPELL_ORDER: SpellId[] = ["emberBolt", "frostRing", "thornbreak"];
