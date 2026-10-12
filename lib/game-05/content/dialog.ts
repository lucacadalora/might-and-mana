import type { DialogChoice, DialogDef, DialogLine, Effect } from "../contract";

/**
 * All Chapter One dialogue. Original text; tone warm, sincere, a little wry.
 *
 * Rules the check enforces (tests/game-05/content-check.mjs):
 *  - a DialogLine's text wraps to at most 3 lines of 38 characters (and never exceeds 120);
 *  - every dialog is reachable: from an NPC talk rule (npcs.ts), a choice `next`, a `dialog`
 *    effect, a map trigger, or a prop the sim reads by id (`sign.<propId>`, `inspect.<propId>`).
 *
 * `{hero}` in a speaker or text stands for the hero's name; call `fillHero` before display.
 * Effects run after the last line and before choices (contract). `startQuest` starts the quest
 * at once and shows the card, so offers are only reachable when no other side quest is active.
 */
export const HERO_TOKEN = "{hero}";
export function fillHero(text: string, heroName: string): string {
  return text.split(HERO_TOKEN).join(heroName || "Wren");
}

/** Display names, matching NpcDef.name (npcs.ts). */
export const SPEAKERS = {
  oren: "Grandpa Oren", maren: "Elder Maren", bram: "Bram", tilda: "Tilda", hask: "Hask", rosa: "Rosa",
  pell: "Pell", dunn: "Dunn", lottie: "Lottie", cato: "Cato", nessa: "Old Nessa", wellSpirit: "The Well Spirit",
  pip: "Pip", villagerA: "Villager", villagerB: "Villager", villagerC: "Villager", lamb: "Lamb",
  hooded: "Hooded Figure", sheepA: "Sheep", sheepB: "Sheep", sheepC: "Sheep",
} as const;
type Who = keyof typeof SPEAKERS | "hero" | "narrator" | "board" | "signpost";

function L(who: Who, text: string): DialogLine {
  if (who === "narrator") return { speaker: "", text };
  if (who === "board") return { speaker: "Notice Board", text };
  if (who === "signpost") return { speaker: "Signpost", text };
  if (who === "hero") return { speaker: HERO_TOKEN, text, portrait: "portrait.hero" };
  return { speaker: SPEAKERS[who], text, portrait: `portrait.${who}` };
}
/** Several lines from one speaker. */
const by = (who: Who, ...texts: string[]) => texts.map(t => L(who, t));

export const DIALOG: Record<string, DialogDef> = {};
function d(id: string, lines: DialogLine[], opts: { effects?: Effect[]; choices?: DialogChoice[] } = {}) {
  if (DIALOG[id]) throw new Error(`duplicate dialog id ${id}`);
  DIALOG[id] = { id, lines, ...(opts.effects ? { effects: opts.effects } : {}), ...(opts.choices ? { choices: opts.choices } : {}) };
}
const shop = (id: string): Effect => ({ t: "shop", shop: id });
const flag = (f: string): Effect => ({ t: "flag", flag: f });
const give = (item: string, count = 1): Effect => ({ t: "give", item, count });
const take = (item: string, count = 1): Effect => ({ t: "take", item, count });
const start = (quest: string): Effect => ({ t: "startQuest", quest });
const complete = (quest: string): Effect => ({ t: "completeQuest", quest });
const next = (dialog: string): Effect => ({ t: "dialog", dialog });

// ─── Grandpa Oren (home) ─────────────────────────────────────────────────────────────────────────
d("oren_dress", by("oren", "Morning, {hero}. Clothes first, heroics after. The chest by your bed."));
d("oren_blade", [
  L("oren", "There you are. You felt the floor go last night? That's the third time this week."),
  L("oren", "You know the old story. Three wardstones keep the Hollow King asleep under this valley."),
  L("oren", "It isn't a story any more. The first stone is cracking, down in the Barrow."),
  L("oren", "I'd go myself, but this leg has other plans. So..."),
  L("oren", "This was my blade. Now it's yours. Hold it like you mean it."),
], { effects: [give("wornBlade"), flag("gotBlade"), next("oren_blade2")] });
d("oren_blade2", [
  L("hero", "I'll bring it back in one piece. Probably."),
  L("oren", "Ha! Try it on the dummy in the yard first. Tap, tap. Rhythm, not panic."),
]);
d("oren_dummy", by("oren", "The dummy's out in the yard. Two quick cuts in rhythm. Let each swing finish."));
d("oren_maren", by("oren",
  "Good hands. Your grandmother's hands.",
  "Now go up to the hall and see Elder Maren. She'll know what to do with you.",
));
d("oren_night", by("oren",
  "Can't sleep? Me neither. The ground keeps grumbling.",
  "Bram keeps a warm bed at the inn, if my snoring is the problem.",
));
d("oren_out", by("oren",
  "Mind the meadow. Mosslings bite worse than they look.",
  "And eat something. Heroes faint too, you know.",
));
d("oren_after", by("oren",
  "The tremors stopped. I felt it in my knee before I heard it.",
  "Go and tell Maren. Then come home and tell me everything. Slowly.",
));
d("oren_clear", by("oren",
  "Two more stones, and someone else wants them. Well.",
  "You'll need a better blade than mine. And a proper breakfast.",
));

// ─── Elder Maren (hall) ──────────────────────────────────────────────────────────────────────────
d("maren_early", by("maren", "Oren's grandchild! Tell that stubborn man the hall kettle misses him."));
d("maren_brief", [
  L("maren", "{hero}. Oren said you'd come. Good. I've run out of people to ask."),
  L("maren", "Creatures are climbing out of the ground in Southfold. That means the Barrow is open."),
  L("maren", "The first wardstone sits in its heart, past Mossgloam Wood. Something down there is choking it."),
  L("maren", "Find it. Cut it loose. The stone will do the rest, if it still can."),
  L("maren", "Cato will open the south gate for you. Take these herbs. And {hero}? Come back."),
], { effects: [flag("metMaren"), flag("gateOpen"), give("herb", 3)] });
d("maren_southfold", by("maren", "South gate, then east across the meadow. Mossgloam begins where the fences end."));
d("maren_grove", by("maren", "A wall of blue flame in the grove? Old warden work. It holds until the wolves are driven off."));
d("maren_barrow", by("maren", "The Barrow's inner gate takes a key. The old wardens kept it in their east hall, under guard."));
d("maren_thorn", by("maren", "Whatever is choking the stone is feeding on it. Cut it loose, {hero}."));
d("maren_end", [
  L("maren", "You're back, and the ground is quiet. I haven't slept this well in a month."),
  L("hero", "Someone was down there. Hooded. They took a sliver of the stone and said, 'One of three.'"),
  L("maren", "One of three... Then they know about the other two."),
  L("maren", "The second stone lies under the sea cliffs at Saltmere. The third sleeps in the Cinderfell mines."),
  L("maren", "Whoever wears that hood will go there next. So will you. But not tonight."),
  L("maren", "Tonight Larkmoor eats well and sleeps soundly. You did that, {hero}."),
], { effects: [complete("wardstone"), { t: "chapterClear" }] });
d("maren_clear", by("maren", "Rest while you can. The next stone won't wait long, and neither will that hood."));

// ─── Hooded figure (barrow2, the sim plays this after the boss falls) ───────────────────────────
d("hooded_one", [
  L("narrator", "The thorns wither and fall away. Light runs back into the stone's cracks like water."),
  L("narrator", "Someone kneels by the wardstone: a hooded figure, a glowing sliver of stone in one hand."),
  L("hooded", "One of three."),
  L("narrator", "A breath of cold air, and the figure is gone. So is the sliver."),
], { effects: [flag("sawHooded")] });

// ─── Bram (inn): free rest flips day and night; Baker's Round stop ──────────────────────────────
const rest: DialogChoice[] = [{ label: "Yes", effects: [{ t: "rest" }] }, { label: "No" }];
d("bram_loaf", by("bram",
  "Pell's bread! The whole inn smells like a home again.",
  "Tell her I'll send the soup pot back. Clean, this time.",
), { effects: [take("loaves"), flag("loaf_bram")] });
d("bram_rest_night", by("bram", "Late one? A bed, a bowl and no charge. Sleep till morning?"), { choices: rest });
d("bram_rest_clear", by("bram", "The hero of Larkmoor! Your bed's always made. Sleep till nightfall?"), { choices: rest });
d("bram_rest_day", by("bram", "Tired? A bed, a bowl and no charge. Sleep till nightfall?"), { choices: rest });

// ─── Tilda (item shop): Feverroot ────────────────────────────────────────────────────────────────
d("tilda_feverroot_done", by("tilda",
  "Ten roots, barely bruised! Half the street can stop coughing now.",
  "Two Mana Draughts and some coin. You're hired, if the warden job goes badly.",
), { effects: [take("feverroot", 10), complete("feverroot")] });
d("tilda_feverroot_remind", by("tilda", "Cut the long grass. Feverroot hides at the bottom, like good gossip."), {
  choices: [{ label: "Browse", effects: [shop("tildaShop")] }, { label: "Later" }],
});
d("tilda_offer", by("tilda", "{hero}! You've got a blade now. Could I borrow you, and it, for an hour?"), {
  choices: [{ label: "What for?", next: "tilda_feverroot_offer" }, { label: "Just shopping", effects: [shop("tildaShop")] }],
});
d("tilda_feverroot_offer", by("tilda",
  "Feverroot grows at the roots of the long grass. Cut the grass and they pop loose.",
  "Ten make one good fever tonic, and the dust has half the street coughing.",
), { effects: [start("feverroot")] });
d("tilda_shop_night", by("tilda", "Late shopping? I'm open until I fall asleep on the counter."), { effects: [shop("tildaShop")] });
d("tilda_shop_clear", by("tilda", "Our warden! First herb is... full price. Sorry. Margins."), { effects: [shop("tildaShop")] });
d("tilda_shop", by("tilda", "Herbs, tonics, and a little luck in a bottle. Have a look."), { effects: [shop("tildaShop")] });

// ─── Hask (smithy): arms shop; Baker's Round stop ───────────────────────────────────────────────
d("hask_loaf", by("hask",
  "Bread? For me? ...Tell Pell her oven hinge is fixed. No charge.",
  "Don't tell anyone I'm nice. Bad for business.",
), { effects: [take("loaves"), flag("loaf_hask")] });
d("hask_shop_night", by("hask", "The forge never really sleeps. Neither do I. What'll it be?"), { effects: [shop("haskShop")] });
d("hask_shop_after", by("hask", "Into the Barrow and back in one piece. My armour's doing, I assume."), { effects: [shop("haskShop")] });
d("hask_shop_bronze", by("hask", "Bronze came in at last. Heavy, loud, and it keeps your ribs where they are."), { effects: [shop("haskShop")] });
d("hask_shop_out", by("hask", "Maren's sending you out? Buy the boarhide. Pretty doesn't stop teeth."), { effects: [shop("haskShop")] });
d("hask_shop_early", by("hask", "No blade and no coin? Look, don't touch. Kidding. Mostly."), { effects: [shop("haskShop")] });
d("hask_shop", by("hask", "Iron, leather, a little boar. Buy it, then wear it. Wearing it is the important part."), { effects: [shop("haskShop")] });

// ─── Rosa (tavern): a 5 g drink buys a tip; the tip follows your current errand ──────────────────
/** Rosa's tip keys in priority order; npcs.ts pairs each with its condition. */
export const ROSA_TIPS: Array<{ key: string; greet: string; tip: string[] }> = [
  { key: "lamb", greet: "What'll it be? Five gold for a drink, and the drink comes with a tip.",
    tip: ["Lambs wander downhill and upwind. In Southfold that means the fenced pasture to the east."] },
  { key: "lambLead", greet: "Walking a lamb home? Sit a moment. Five gold, tip included.",
    tip: ["Keep her out of fights. She can't take a bite the way you can."] },
  { key: "rod", greet: "What'll it be? Five gold for a drink, and the drink comes with a tip.",
    tip: ["Thorns grew over the bridge wreck in Mossgloam.", "A lever across the river pulls them back. Look for a fallen log to cross."] },
  { key: "ring", greet: "What'll it be? Five gold for a drink, and the drink comes with a tip.",
    tip: ["Silver in the Barrow? The old dead kept theirs in the crypts. Try the far north-west chamber."] },
  { key: "spirit", greet: "What'll it be? Five gold for a drink, and the drink comes with a tip.",
    tip: ["The well spirit only rises after dark. Sleep at Bram's till nightfall, then go to the well."] },
  { key: "tusk", greet: "Hunting the Old Tusk? Brave. Drink first. Five gold, tip included.",
    tip: ["He beds down in the thicket at the north-west corner of Southfold.", "He charges in straight lines. Stand before a tree, step aside, and he'll knock himself silly."] },
  { key: "root", greet: "What'll it be? Five gold for a drink, and the drink comes with a tip.",
    tip: ["Feverroot hides under bushes too, not just grass. Cut everything. Tilda won't mind."] },
  { key: "bread", greet: "Is that Pell's bread I smell? Five gold for a drink, and a tip.",
    tip: ["Bram's at the inn, Hask at the forge, Cato at the south gate. Any order will do."] },
  { key: "moss", greet: "What'll it be? Five gold for a drink, and the drink comes with a tip.",
    tip: ["Mosslings crouch before they hop. Step aside on the hop, then cut twice."] },
  { key: "thorn", greet: "You smell of cellar and cobweb. Sit. Five gold, and I'll tell you what the songs say.",
    tip: ["When the ground glows under you in the Barrow's heart, move. The thorns come up a breath later."] },
  { key: "barrow", greet: "The Barrow! My gran wouldn't even say the word. Drink, and I'll tell you what she did say.",
    tip: ["Barrow guards block anything from the front.", "Get round the side, or wait until they swing and miss."] },
  { key: "grove", greet: "Folk say wolves came down from Mossgloam. Drink, and I'll tell you how to handle them.",
    tip: ["Wolves circle before they lunge. When one crouches, roll through it.", "Nothing can bite you mid-roll."] },
  { key: "southfold", greet: "Cato let you out, did he? A drink before the meadow? Five gold, tip included.",
    tip: ["Cut the long grass as you go. Coins, herbs, the odd surprise. Grass is honest money."] },
  { key: "after", greet: "The ground stopped shaking and my bottles stayed put. Drinks are still five gold.",
    tip: ["Done the big thing? Now the small ones. Nessa's well at night, Dunn's rod, Lottie's lamb."] },
  { key: "early", greet: "Tremors knocked half my bottles off the shelf. Drink? The tip comes free with it.",
    tip: ["Folk here need a hand. Tilda wants roots cut, Pell wants bread carried.", "And the bounty board by the fountain always wants someone."] },
];
for (const t of ROSA_TIPS) {
  d(`rosa_${t.key}`, by("rosa", t.greet), {
    choices: [
      { label: "A drink (5 g)", effects: [{ t: "gold", amount: -5 }, flag("drankRosa")], next: `rosa_tip_${t.key}` },
      { label: "Not now" },
    ],
  });
  d(`rosa_tip_${t.key}`, by("rosa", ...t.tip));
}

// ─── Pell (bakery stall): The Baker's Round ─────────────────────────────────────────────────────
d("pell_done", by("pell",
  "All three, and not a crumb missing? You're hired. Well, thanked.",
  "Here: my emergency jar, and an elixir. Every baker keeps one for burns.",
), { effects: [complete("bakersRound")] });
d("pell_remind", by("pell", "Bram at the inn, Hask at the forge, Cato at the south gate. Warm bread waits for no one!"));
d("pell_night", by("pell", "Up late? The dough's resting. So should you."));
d("pell_after", by("pell", "Business is booming since you ran my round. Half the town thinks you're my apprentice."));
d("pell_busy", by("pell", "You've got your hands full already. Come back when they're empty. Bread needs two."));
d("pell_pyjamas", by("pell", "Out in your nightshirt? Brave. Get dressed, then come see me about a job."));
d("pell_offer", by("pell",
  "Oven's full and my legs are empty. Could you run the morning bread for me?",
  "One loaf each: Bram at the inn, Hask at the forge and Cato at the gate.",
), { effects: [start("bakersRound"), next("pell_hand")] });
d("pell_hand", by("pell", "Here, still warm. If one goes missing, I'll know. Bakers always know."), { effects: [give("loaves", 3)] });

// ─── Dunn (dock): The Fisher's Rod ───────────────────────────────────────────────────────────────
d("dunn_done", by("dunn", "My rod! Cork grip and all. I could kiss you. I won't. Here, for your trouble."),
  { effects: [take("fishingRod"), complete("fishersRod")] });
d("dunn_remind", by("dunn", "By the old bridge in the wood. It went in the river along with half my pride."));
d("dunn_night", by("dunn", "Fish bite best at night. So do the midges."));
d("dunn_after", by("dunn", "Caught a pike this morning. Named it after you. It bit me, so it fits."));
d("dunn_busy", by("dunn", "You look busy. I'll be here. I'm always here. It's a dock."));
d("dunn_offer_has", [
  L("dunn", "Hang on. That's my rod on your back! You found it before I even asked?"),
  L("dunn", "Where was it? No, don't tell me, I'll only cry. Here, for your trouble."),
], { effects: [start("fishersRod"), take("fishingRod"), complete("fishersRod")] });
d("dunn_offer", by("dunn",
  "My good rod went into the river when the old Mossgloam bridge gave way. I ran. It didn't.",
  "If you pass the wreck, look for it? I'll pay well, and in coin, not fish.",
), { effects: [start("fishersRod")] });
d("dunn_early", by("dunn", "Lake's calm today. Too calm. The fish know something."));

// ─── Lottie (sheep pen) and the lamb: The Lost Lamb ─────────────────────────────────────────────
d("lottie_done", by("lottie",
  "Clover! You silly, woolly thing. Thank you, {hero}. Truly.",
  "Take Mum's old bell. Tie it on and luck follows you, the way Clover does.",
), { effects: [complete("lostLamb")] });
d("lottie_lead", by("lottie", "You found her! Bring her through the gate and over to the pen. Slowly, she's small."));
d("lottie_find", by("lottie", "She always wanders east, to the fenced pasture at the far end of Southfold."));
d("lottie_night", by("lottie", "Shh. They're all asleep. Even Clover. Especially Clover."));
d("lottie_after", by("lottie", "Clover hasn't left the pen since. She follows me everywhere now. Everywhere."));
d("lottie_busy", by("lottie", "You've got an errand already. Clover will keep. I hope."));
d("lottie_early", by("lottie",
  "One, two, three... four is missing. Clover's gone again, and Cato won't let me out.",
  "Nobody leaves till the Elder says so. Maybe she'll say so to you?",
));
d("lottie_offer", by("lottie",
  "Three... four... no, three. Clover's wandered off again!",
  "She always heads for the fenced pasture at the east end of Southfold. Could you walk her home?",
  "She'll follow anyone who smells like the pen. Which is you now. Sorry.",
), { effects: [start("lostLamb")] });
d("lamb_find", [L("lamb", "Baa?"), L("narrator", "The lamb looks at you, then at the grass, then at you again.")]);
d("lamb_follow", [L("lamb", "Baa!"), L("narrator", "She presses against your leg and trots after you.")]);
d("lamb_home", [L("lamb", "Baa.")]);

// ─── Cato (south gate): gate, bounty pay, Baker's Round stop ────────────────────────────────────
d("cato_bounty_moss", by("cato", "Eight mosslings? The turnips thank you. The watch pays in coin, not turnips."),
  { effects: [complete("bountyMoss")] });
d("cato_bounty_tusk", by("cato",
  "You felled the Old Tusk? He tossed my cart once. Personally.",
  "Here, from the watch. And his hide: Hask made a helm of it while you were out.",
), { effects: [complete("bountyTusk")] });
d("cato_loaf", by("cato", "Warm bread on gate duty. Pell's a saint. Don't tell her I said that."),
  { effects: [take("loaves"), flag("loaf_cato")] });
d("cato_closed", by("cato", "Gate's shut, {hero}. Elder's orders. Go up to the hall and see Maren."));
d("cato_open", by("cato", "Elder says you're our warden now. Gate's open. Mind the mosslings; they hop."));
d("cato_after", by("cato", "The ground's stopped shaking. First good night's watch in weeks."));
d("cato_night", by("cato", "Quiet night. Too quiet. I'm told that's a good thing."));
d("cato_out", by("cato", "Southfold's crawling. See a boar the size of a cart? That's the Old Tusk. Run."));

// ─── Old Nessa (by the well, daytime) ────────────────────────────────────────────────────────────
d("nessa_done", by("nessa", "The well sings in the mornings now. Did you do that? You did, didn't you."));
d("nessa_active", by("nessa", "A silver ring? My mother told that tale. Taken below, she said, to the Barrow."));
d("nessa_lights", by("nessa",
  "Lights in the old well at night, I tell you. Blue ones. Nobody believes an old woman.",
  "Sleep at Bram's till dark and see for yourself. Then come and tell me I'm not mad.",
));
d("nessa_early", by("nessa", "Oren's grandchild, look at you. You've got his chin. Poor thing."));

// ─── The Well Spirit (the old well, night only) ─────────────────────────────────────────────────
d("spirit_done", by("wellSpirit",
  "My ring... You carried it all the way up out of the dark. Thank you.",
  "Take this knot of river-reed, and a word the thorns will listen to.",
), { effects: [take("silverRing"), complete("wellSpirit")] });
d("spirit_remind", by("wellSpirit", "The Barrow keeps my ring, in the crypt far to the west, where the old dead keep their silver."));
d("spirit_after", by("wellSpirit", "Walk well, warden's child. The water remembers you now."));
d("spirit_busy", by("wellSpirit", "You carry someone else's errand. Finish it, then come back to the water."));
d("spirit_offer_has", [
  L("narrator", "The water in the well glows. A pale shape rises, shy as a moth."),
  L("wellSpirit", "You can see me? And you carry... my ring. My silver ring!"),
  L("wellSpirit", "It was taken from me when this valley was young. Here: a knot of river-reed, and a word the thorns fear."),
], { effects: [start("wellSpirit"), take("silverRing"), complete("wellSpirit")] });
d("spirit_offer", [
  L("narrator", "The water in the well glows. A pale shape rises, shy as a moth."),
  L("wellSpirit", "You can see me? Oh... it's been so long since anyone could."),
  L("wellSpirit", "A warden gave me a silver ring when this valley was young. It was taken below, into the Barrow."),
  L("wellSpirit", "Bring it back to me some night, and I'll give you something of mine."),
], { effects: [start("wellSpirit")] });

// ─── Pip (a child in the plaza) ──────────────────────────────────────────────────────────────────
d("pip_night", by("pip", "I'm not supposed to be up. Don't tell Mum. I'm looking for the well lights."));
d("pip_clear", by("pip", "When I'm big I'm going to be a warden. Or a baker. Or a warden who bakes."));
d("pip_after", by("pip", "The shaking stopped! Mum says you did it. Did you do it? Did you?"));
d("pip_out", by("pip", "I'm guarding the fountain. If wolves come, I'll splash them."));
d("pip_blade", by("pip", "Is that a real sword? Can I hold it? ...Can I hold it later?"));
d("pip_early", by("pip", "Is it true your grandpa fought a giant? He says it was 'mostly a big goat'."));

// ─── Villagers ───────────────────────────────────────────────────────────────────────────────────
d("villagerA_night", by("villagerA", "Lovely night. The lake's full of stars."));
d("villagerA_after", by("villagerA", "Not one tremor all day. I almost miss them. No, I don't."));
d("villagerA_out", by("villagerA", "Mosslings in my turnips again. Slimy little thieves."));
d("villagerA_early", by("villagerA", "Last night's tremor cracked my water trough. And my favourite mug. Mostly the mug."));
d("villagerB_night", by("villagerB", "Out late? Mind the lake path. It's slippery after dark."));
d("villagerB_after", by("villagerB", "Word is you went into the Barrow. Word is also you're mad. Both, I think."));
d("villagerB_out", by("villagerB", "You're the warden now? Well. You've got the hair for it."));
d("villagerB_early", by("villagerB", "Maren's had the hall lamps lit three nights running. That's never good."));
d("villagerC_night", by("villagerC", "Somewhere under us, the Hollow King is dreaming. Let him."));
d("villagerC_after", by("villagerC", "My knee's stopped aching. Coincidence? I think not."));
d("villagerC_out", by("villagerC", "Grass is long this year. Cut some for me? You might find a coin or two in it."));
d("villagerC_early", by("villagerC", "In my day, wardstones didn't crack. In my day we didn't have wardstones. Hm."));

// ─── Sheep ───────────────────────────────────────────────────────────────────────────────────────
// Shared by three sheep: no explicit portrait, so the sim uses the talking NPC's own portrait.
d("sheep_baa", [{ speaker: "Sheep", text: "Baa." }]);
d("sheep_baa_q", [{ speaker: "Sheep", text: "Baa?" }]);
d("sheep_sleep", [L("narrator", "The sheep is asleep standing up. Impressive.")]);

// ─── Signs the sim reads by prop id (`sign.<propId>`), matching the ids placed in the maps ───────
d("sign.gateSign", [
  L("signpost", "SOUTH GATE. Southfold meadow beyond, and Mossgloam Wood past that."),
  L("signpost", "Travellers, please report to Cato. Cato, please stop napping."),
]);
d("sign.sign_sf_gate", [L("signpost", "NORTH: Larkmoor. Mind the long grass; the mosslings nest in it.")]);
d("sign.sign_sf_cross", [
  L("signpost", "EAST: Mossgloam Wood. NORTH-WEST: the old thicket."),
  L("signpost", "Someone has carved under it: 'BIG BOAR. DON'T.'"),
]);
d("sign.sign_sf_east", [L("signpost", "MOSSGLOAM WOOD. Wolves about. Travel in daylight, or at least in a hurry.")]);
d("sign.sign_mg_west", [L("signpost", "WEST: Southfold, and home. EAST: the grove, and the Barrow beyond. Keep to the path.")]);
d("sign.sign_mg_grove", [L("signpost", "THE GROVE. The wardens' flame bars the way while beasts roam here.")]);
d("sign.sign_mg_barrow", [L("signpost", "THE BARROW. KEEP OUT. Someone has crossed out 'OUT'.")]);
