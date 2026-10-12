import type { Cond, ShopDef } from "../contract";

/**
 * Town shops (CONTENT.md "Shops"). Stock order is the carousel order. Prices come from items.ts;
 * the sim refuses items whose SHOP_UNLOCKS condition is not met ("Not in stock yet"), so the
 * carousel can show them greyed out as a promise of what comes later.
 */
export const SHOPS: Record<string, ShopDef> = {
  tildaShop: {
    id: "tildaShop",
    name: "Tilda's Goods",
    keeper: "tilda",
    kind: "items",
    stock: ["herb", "tonic", "manaDraught", "elixir", "stoneskin", "fury", "fortune", "quickstep"],
  },
  haskShop: {
    id: "haskShop",
    name: "Hask's Smithy",
    keeper: "hask",
    kind: "arms",
    stock: [
      "ironSword",
      "leatherCap1", "leatherCap2", "leatherCap3",
      "leatherVest1", "leatherVest2", "leatherVest3",
      "leatherBoots1", "leatherBoots2", "leatherBoots3",
      "boarCap1", "boarVest1", "boarBoots1",
      "bronzeHelm1", "bronzeMail1", "bronzeGreaves1",
    ],
  },
};

/** Stock gating: the boar tier after the Elder's briefing, bronze after the grove is cleared. */
export const SHOP_UNLOCKS: Record<string, Cond> = {
  boarCap1: { flag: "metMaren" },
  boarVest1: { flag: "metMaren" },
  boarBoots1: { flag: "metMaren" },
  bronzeHelm1: { flag: "wolvesCleared" },
  bronzeMail1: { flag: "wolvesCleared" },
  bronzeGreaves1: { flag: "wolvesCleared" },
};
