import type { Cond, NpcDef } from "../contract";
import { ROSA_TIPS } from "./dialog";
import { SIDE_BUSY, allOf, anyOf, atStep } from "./quests";

/**
 * Chapter One NPCs (CONTENT.md "NPCs"). Talk rules: first match wins (contract). Order inside each
 * NPC: quest turn-ins ("?"), step reminders, night lines, progress lines, then offers ("!") gated
 * so they only show when no other side quest is active (the sim allows one at a time and
 * `startQuest` cannot be declined). The last rule of every NPC has no condition.
 *
 * Sprites are `npc.<id>`, portraits `portrait.<id>` (villagers and sheep may share art through
 * the atlas, but each keeps its own key).
 */
const NIGHT: Cond = { night: true };
const EARLY: Cond = { notFlag: "metMaren" };
const AFTER: Cond = { flag: "bossDown" };
const CLEAR: Cond = { flag: "chapterClear" };
const done = (q: string): Cond => ({ questDone: q });
const active = (q: string): Cond => ({ questActive: q });

type Rule = NpcDef["talk"][number];
const npc = (id: string, name: string, talk: Rule[]): NpcDef => ({ id, name, sprite: `npc.${id}`, portrait: `portrait.${id}`, talk });

/** Rosa's tip conditions, aligned with ROSA_TIPS keys (dialog.ts); order = priority. */
const ROSA_WHEN: Record<string, Cond | undefined> = {
  lamb: atStep("lostLamb", "find"),
  lambLead: atStep("lostLamb", "lead"),
  rod: atStep("fishersRod", "rod"),
  ring: atStep("wellSpirit", "ring"),
  spirit: atStep("wellSpirit", "give"),
  tusk: atStep("bountyTusk", "hunt"),
  root: atStep("feverroot", "gather"),
  bread: active("bakersRound"),
  moss: atStep("bountyMoss", "hunt"),
  thorn: atStep("wardstone", "thorn"),
  barrow: atStep("wardstone", "barrow"),
  grove: atStep("wardstone", "grove"),
  southfold: atStep("wardstone", "southfold"),
  after: AFTER,
  early: undefined,
};

export const NPCS: Record<string, NpcDef> = {
  oren: npc("oren", "Grandpa Oren", [
    { when: atStep("wardstone", "dress"), dialog: "oren_dress" },
    { when: atStep("wardstone", "oren"), dialog: "oren_blade", marker: "?" },
    { when: atStep("wardstone", "dummy"), dialog: "oren_dummy" },
    { when: atStep("wardstone", "maren"), dialog: "oren_maren" },
    { when: CLEAR, dialog: "oren_clear" },
    { when: AFTER, dialog: "oren_after" },
    { when: NIGHT, dialog: "oren_night" },
    { dialog: "oren_out" },
  ]),

  maren: npc("maren", "Elder Maren", [
    { when: atStep("wardstone", "return"), dialog: "maren_end", marker: "?" },
    { when: atStep("wardstone", "maren"), dialog: "maren_brief", marker: "?" },
    { when: CLEAR, dialog: "maren_clear" },
    { when: atStep("wardstone", "southfold"), dialog: "maren_southfold" },
    { when: atStep("wardstone", "grove"), dialog: "maren_grove" },
    { when: atStep("wardstone", "barrow"), dialog: "maren_barrow" },
    { when: atStep("wardstone", "thorn"), dialog: "maren_thorn" },
    { dialog: "maren_early" },
  ]),

  bram: npc("bram", "Bram", [
    { when: allOf(active("bakersRound"), { notFlag: "loaf_bram" }), dialog: "bram_loaf", marker: "?" },
    { when: NIGHT, dialog: "bram_rest_night" },
    { when: CLEAR, dialog: "bram_rest_clear" },
    { dialog: "bram_rest_day" },
  ]),

  tilda: npc("tilda", "Tilda", [
    { when: atStep("feverroot", "return"), dialog: "tilda_feverroot_done", marker: "?" },
    { when: atStep("feverroot", "gather"), dialog: "tilda_feverroot_remind" },
    { when: allOf(anyOf(done("feverroot"), { notFlag: "gotBlade" }, SIDE_BUSY), NIGHT), dialog: "tilda_shop_night" },
    { when: allOf(anyOf(done("feverroot"), { notFlag: "gotBlade" }, SIDE_BUSY), AFTER), dialog: "tilda_shop_clear" },
    { when: anyOf(done("feverroot"), { notFlag: "gotBlade" }, SIDE_BUSY), dialog: "tilda_shop" },
    { dialog: "tilda_offer", marker: "!" },
  ]),

  hask: npc("hask", "Hask", [
    { when: allOf(active("bakersRound"), { notFlag: "loaf_hask" }), dialog: "hask_loaf", marker: "?" },
    { when: NIGHT, dialog: "hask_shop_night" },
    { when: AFTER, dialog: "hask_shop_after" },
    { when: { flag: "wolvesCleared" }, dialog: "hask_shop_bronze" },
    { when: { flag: "metMaren" }, dialog: "hask_shop_out" },
    { when: { notFlag: "gotBlade" }, dialog: "hask_shop_early" },
    { dialog: "hask_shop" },
  ]),

  rosa: npc("rosa", "Rosa", ROSA_TIPS.map(t => {
    const when = ROSA_WHEN[t.key];
    return when ? { when, dialog: `rosa_${t.key}` } : { dialog: `rosa_${t.key}` };
  })),

  pell: npc("pell", "Pell", [
    { when: atStep("bakersRound", "return"), dialog: "pell_done", marker: "?" },
    { when: active("bakersRound"), dialog: "pell_remind" },
    { when: allOf(done("bakersRound"), NIGHT), dialog: "pell_night" },
    { when: done("bakersRound"), dialog: "pell_after" },
    { when: SIDE_BUSY, dialog: "pell_busy" },
    { when: { notFlag: "dressed" }, dialog: "pell_pyjamas" },
    { dialog: "pell_offer", marker: "!" },
  ]),

  dunn: npc("dunn", "Dunn", [
    { when: atStep("fishersRod", "return"), dialog: "dunn_done", marker: "?" },
    { when: atStep("fishersRod", "rod"), dialog: "dunn_remind" },
    { when: allOf(done("fishersRod"), NIGHT), dialog: "dunn_night" },
    { when: done("fishersRod"), dialog: "dunn_after" },
    { when: allOf(SIDE_BUSY, { flag: "metMaren" }), dialog: "dunn_busy" },
    { when: { has: "fishingRod" }, dialog: "dunn_offer_has", marker: "!" },
    { when: { flag: "metMaren" }, dialog: "dunn_offer", marker: "!" },
    { dialog: "dunn_early" },
  ]),

  lottie: npc("lottie", "Lottie", [
    { when: atStep("lostLamb", "thank"), dialog: "lottie_done", marker: "?" },
    { when: atStep("lostLamb", "lead"), dialog: "lottie_lead" },
    { when: atStep("lostLamb", "find"), dialog: "lottie_find" },
    { when: allOf(done("lostLamb"), NIGHT), dialog: "lottie_night" },
    { when: done("lostLamb"), dialog: "lottie_after" },
    { when: EARLY, dialog: "lottie_early" },
    { when: SIDE_BUSY, dialog: "lottie_busy" },
    { dialog: "lottie_offer", marker: "!" },
  ]),

  lamb: npc("lamb", "Lamb", [
    { when: atStep("lostLamb", "find"), dialog: "lamb_find" },
    { when: atStep("lostLamb", "lead"), dialog: "lamb_follow" },
    { dialog: "lamb_home" },
  ]),

  cato: npc("cato", "Cato", [
    { when: atStep("bountyMoss", "claim"), dialog: "cato_bounty_moss", marker: "?" },
    { when: atStep("bountyTusk", "claim"), dialog: "cato_bounty_tusk", marker: "?" },
    { when: allOf(active("bakersRound"), { notFlag: "loaf_cato" }), dialog: "cato_loaf", marker: "?" },
    { when: EARLY, dialog: "cato_closed" },
    { when: atStep("wardstone", "southfold"), dialog: "cato_open" },
    { when: AFTER, dialog: "cato_after" },
    { when: NIGHT, dialog: "cato_night" },
    { dialog: "cato_out" },
  ]),

  nessa: npc("nessa", "Old Nessa", [
    { when: done("wellSpirit"), dialog: "nessa_done" },
    { when: active("wellSpirit"), dialog: "nessa_active" },
    { when: { flag: "metMaren" }, dialog: "nessa_lights" },
    { dialog: "nessa_early" },
  ]),

  wellSpirit: npc("wellSpirit", "The Well Spirit", [
    { when: atStep("wellSpirit", "give"), dialog: "spirit_done", marker: "?" },
    { when: atStep("wellSpirit", "ring"), dialog: "spirit_remind" },
    { when: done("wellSpirit"), dialog: "spirit_after" },
    { when: SIDE_BUSY, dialog: "spirit_busy" },
    { when: { has: "silverRing" }, dialog: "spirit_offer_has", marker: "!" },
    { dialog: "spirit_offer", marker: "!" },
  ]),

  pip: npc("pip", "Pip", [
    { when: NIGHT, dialog: "pip_night" },
    { when: CLEAR, dialog: "pip_clear" },
    { when: AFTER, dialog: "pip_after" },
    { when: { flag: "metMaren" }, dialog: "pip_out" },
    { when: { flag: "gotBlade" }, dialog: "pip_blade" },
    { dialog: "pip_early" },
  ]),

  villagerA: npc("villagerA", "Villager", [
    { when: NIGHT, dialog: "villagerA_night" },
    { when: AFTER, dialog: "villagerA_after" },
    { when: { flag: "metMaren" }, dialog: "villagerA_out" },
    { dialog: "villagerA_early" },
  ]),
  villagerB: npc("villagerB", "Villager", [
    { when: NIGHT, dialog: "villagerB_night" },
    { when: AFTER, dialog: "villagerB_after" },
    { when: { flag: "metMaren" }, dialog: "villagerB_out" },
    { dialog: "villagerB_early" },
  ]),
  villagerC: npc("villagerC", "Villager", [
    { when: NIGHT, dialog: "villagerC_night" },
    { when: AFTER, dialog: "villagerC_after" },
    { when: { flag: "metMaren" }, dialog: "villagerC_out" },
    { dialog: "villagerC_early" },
  ]),

  hooded: npc("hooded", "Hooded Figure", [
    { dialog: "hooded_one" },
  ]),

  sheepA: npc("sheepA", "Sheep", [{ when: NIGHT, dialog: "sheep_sleep" }, { dialog: "sheep_baa" }]),
  sheepB: npc("sheepB", "Sheep", [{ when: NIGHT, dialog: "sheep_sleep" }, { dialog: "sheep_baa" }]),
  sheepC: npc("sheepC", "Sheep", [{ when: NIGHT, dialog: "sheep_sleep" }, { dialog: "sheep_baa_q" }]),
};
