// Quest and dialogue flows through the real sim (no rendering):
//   node --import tsx tests/game-05/quest-flows.mjs
// Written by the content lane on 24-25 Sep; bounty flows added by the owner.
const S = await import("../../lib/game-05/sim/sim.ts");
const { NPCS, QUESTS, DIALOG } = await import("../../lib/game-05/content/index.ts");
const sim = new S.Sim(S.newSave("Wren"));
const log = [];
function talk(npc) {
  const rule = NPCS[npc].talk.find(r => sim.cond(r.when));
  sim.startDialog(rule.dialog, npc);
  const seen = [rule.dialog + (rule.marker ? ` [${rule.marker}]` : "")];
  let guard = 0;
  while (sim.modal.kind !== "none" && guard++ < 50) {
    if (sim.modal.kind === "dialog") { const d = sim.dialog; if (d && d.index === 0) seen.push(`  ${d.id}`); sim.menu("ok"); }
    else if (sim.modal.kind === "questCard") { seen.push(`  card:${sim.modal.card.mode}:${sim.modal.card.quest}`); sim.menu("ok"); }
    else if (sim.modal.kind === "shop") { seen.push(`  shop:${sim.modal.shop}`); sim.closeModal(); }
    else if (sim.modal.kind === "clear") { seen.push("  CHAPTER CLEAR"); sim.menu("ok"); }
    else { seen.push(`  modal:${sim.modal.kind}`); sim.closeModal(); }
  }
  log.push(`${npc}: ${seen.join(" ")} | quests=${JSON.stringify(sim.s.quests)} gold=${sim.s.gold} bag=${JSON.stringify(sim.s.bag)}`);
}
const expect = (ok, msg) => { if (!ok) { console.log("FAIL", msg); process.exitCode = 1; } else console.log("ok  ", msg); };
talk("oren");                                  // dress step
expect(sim.s.quests.wardstone === "dress", "Oren before dressing keeps step dress");
sim.s.flags.dressed = true; sim.checkQuests();
expect(sim.s.quests.wardstone === "oren", "dressed → step oren");
talk("oren");                                  // blade
expect(sim.count("wornBlade") === 1 && sim.s.flags.gotBlade && sim.s.quests.wardstone === "dummy", "Oren gives the blade, step dummy");
talk("tilda");                                 // offer intro with choices: first choice "What for?"
expect(sim.s.quests.feverroot === "gather", "Tilda: feverroot started via choice");
talk("pell");                                  // busy
expect(!("bakersRound" in sim.s.quests), "Pell refuses while feverroot active");
sim.s.bag.feverroot = 10; sim.checkQuests();
expect(sim.s.quests.feverroot === "return", "10 feverroot → return step");
talk("tilda");
expect(sim.s.done.includes("feverroot") && !sim.s.bag.feverroot && sim.s.bag.manaDraught === 2, "Tilda turn-in: done, roots taken, 2 draughts");
talk("pell");
expect(sim.s.quests.bakersRound === "bram" && sim.s.bag.loaves === 3, "Pell offer: quest + 3 loaves (chained dialog)");
talk("hask");
expect(sim.s.flags.loaf_hask && sim.s.bag.loaves === 2 && sim.s.quests.bakersRound === "bram", "Hask first: flag set, still waiting on Bram");
talk("bram");
expect(sim.s.quests.bakersRound === "cato", "Bram delivery skips the done Hask step → cato");
talk("cato");
expect(sim.s.quests.bakersRound === "return" && !sim.s.bag.loaves, "Cato delivery → return, no loaves left");
talk("pell");
expect(sim.s.done.includes("bakersRound") && sim.s.bag.elixir === 1, "Pell turn-in: elixir");
sim.s.flags.dummyDone = true; sim.checkQuests();
talk("maren");
expect(sim.s.flags.metMaren && sim.s.flags.gateOpen && sim.s.quests.wardstone === "southfold" && sim.s.bag.herb === 4, "Maren briefing: flags, herbs, step southfold");
const g0 = sim.s.gold; talk("rosa");
expect(sim.s.gold === g0 - 5 && sim.s.flags.drankRosa, "Rosa: drink costs 5 g and sets drankRosa");
sim.s.bag.fishingRod = 1; talk("dunn");
expect(sim.s.done.includes("fishersRod") && !sim.s.bag.fishingRod, "Dunn with rod already found: start + complete in one talk");
talk("lottie");
expect(sim.s.quests.lostLamb === "find", "Lottie offers the lamb");
sim.s.quests.lostLamb = "lead"; talk("lamb"); sim.s.flags.lambHome = true; sim.checkQuests();
expect(sim.s.quests.lostLamb === "thank", "lambHome → thank");
talk("lottie");
expect(sim.s.done.includes("lostLamb") && sim.count("lambsBell") === 1, "Lottie turn-in: bell");
sim.s.night = true; talk("wellSpirit");
expect(sim.s.quests.wellSpirit === "ring", "Well Spirit offer at night");
sim.s.bag.silverRing = 1; sim.checkQuests(); talk("wellSpirit");
expect(sim.s.done.includes("wellSpirit") && sim.s.spells.includes("thornbreak") && sim.count("travelersKnot") === 1, "Well Spirit turn-in: Thornbreak + knot");
talk("bram");
expect(sim.s.night === false, "Bram rest at night (Yes) → morning");
sim.s.flags.bossDown = true; sim.checkQuests();
for (const q of ["barrow", "grove", "southfold"]) {}
sim.s.quests.wardstone = "return";
talk("maren");
expect(sim.s.done.includes("wardstone") && sim.s.flags.chapterClear, "Maren ending: chapter clear");
talk("hooded");

// Bounties: read the board, take the job, kill the targets, get paid by Cato.
function readBoard(accept = true) {
  sim.interact({ kind: "sign", label: "Read", x: 0, y: 0, id: "bountyBoard", prop: { kind: "sign", x: 0, y: 0, id: "bountyBoard" } });
  let guard = 0;
  while (sim.modal.kind !== "none" && guard++ < 20) {
    if (sim.modal.kind === "dialog") { const d = sim.dialogView(); if (d?.choices && !accept) sim.menu("down"); sim.menu("ok"); }
    else sim.menu("ok");
  }
}
function kill(monster, n) {
  for (let i = 0; i < n; i++) {
    const a = sim.spawnMonster(monster, sim.hero.x + 200, sim.hero.y);
    a.hp = 0; a.dead = true; sim.onMonsterKilled(a);
  }
  sim.checkQuests();
  while (sim.modal.kind !== "none") sim.menu("ok");
}
sim.s.level = 3;
readBoard();
expect(sim.s.quests.bountyMoss !== undefined, "board: Mossling bounty taken");
kill("mossling", 8);
const moss = QUESTS.bountyMoss;
const mossLast = moss.steps[moss.steps.length - 1];
if (mossLast.goal.kind === "talk") talk(mossLast.goal.npc);
expect(sim.s.done.includes("bountyMoss"), "Mossling bounty paid");
sim.s.level = 3; sim.s.xp = 0;
readBoard();
expect(!("bountyTusk" in sim.s.quests), "Old Tusk waits for level 4");
sim.s.level = 5;
readBoard();
expect(sim.s.quests.bountyTusk !== undefined, "board: Old Tusk bounty taken at level 5");
kill("oldTusk", 1);
const tusk = QUESTS.bountyTusk;
const tuskLast = tusk.steps[tusk.steps.length - 1];
if (tuskLast.goal.kind === "talk") talk(tuskLast.goal.npc);
expect(sim.s.done.includes("bountyTusk") && sim.count("boarhideHelm") >= 1, "Old Tusk bounty paid with the helm");
readBoard();
expect(Object.keys(sim.s.quests).length === 0, "board empty once both bounties are done");
if (process.argv.includes("--verbose")) console.log("\n" + log.join("\n"));
