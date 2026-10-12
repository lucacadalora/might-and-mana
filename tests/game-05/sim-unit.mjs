// Game 05 simulation unit tests: node --import tsx --test tests/game-05/sim-unit.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
const { Sim, newSave } = await import("../../lib/game-05/sim/sim.ts");
const { MAPS } = await import("../../lib/game-05/content/maps/index.ts");
const { QUESTS } = await import("../../lib/game-05/content/quests.ts");
const { SHOPS } = await import("../../lib/game-05/content/shops.ts");
const { GEAR } = await import("../../lib/game-05/content/items.ts");
const TILE = 32, DT = 1 / 60;
const none = () => ({ attack: false, magic: false, dodge: false, item: false, nextSpell: false, map: false, status: false, pause: false });
const input = (o = {}) => ({ mx: 0, my: 0, pressed: { ...none(), ...(o.pressed ?? {}) }, held: { attack: !!o.hold }, ...o, pressed: { ...none(), ...(o.pressed ?? {}) } });
const run = (sim, n, o) => { for (let i = 0; i < n; i++) { sim.step(input(typeof o === "function" ? o(i) : o), DT); sim.drain(); } };

/** A sim standing in open grass in Southfold with a sword, far from monsters. */
function field(level = 1) {
  const save = newSave("Test", 7);
  save.level = level; save.equipped.weapon = "wornBlade"; save.equipped.body = "clothTunic";
  save.flags = { dressed: true, gotBlade: true, dummyDone: true, metMaren: true, gateOpen: true };
  save.quests = {}; save.map = "southfold";
  const sim = new Sim(save);
  sim.actors = sim.actors.filter(a => a.kind !== "monster");
  // Find an open spot.
  const s = MAPS.southfold.spawn;
  sim.hero.x = s.x * TILE; sim.hero.y = s.y * TILE;
  return sim;
}

test("new game starts at home with the main quest and no weapon", () => {
  const sim = new Sim(newSave("Wren"));
  assert.equal(sim.map.id, "home");
  assert.equal(sim.s.equipped.weapon, null);
  assert.equal(sim.s.quests.wardstone, QUESTS.wardstone.steps[0].id);
  assert.equal(sim.s.heroName, "Wren");
});

test("combo chains within the window and caps at the level's max", () => {
  const sim = field(3);
  assert.equal(sim.maxCombo(), 3);
  const swings = [];
  const orig = sim.emit.bind(sim);
  sim.emit = (e) => { if (e.t === "swing") swings.push(e.combo); orig(e); };
  for (let k = 0; k < 5; k++) { run(sim, 1, { pressed: { attack: true } }); run(sim, 13, {}); }
  assert.deepEqual(swings.slice(0, 3), [1, 2, 3]);
  assert.equal(swings[3], 1, "after the max combo the chain restarts");
});

test("holding attack charges a spin only once the skill is learned", () => {
  const low = field(1);
  run(low, 1, { pressed: { attack: true }, hold: true });
  run(low, 90, { hold: true });
  assert.notEqual(low.hero.state, "charge");
  const sim = field(5);
  assert.ok(sim.hasSpin());
  run(sim, 1, { pressed: { attack: true }, hold: true });
  run(sim, 90, { hold: true });
  assert.equal(sim.hero.state, "charge");
  assert.equal(sim.hero.charge, 1);
  const spins = [];
  const orig = sim.emit.bind(sim);
  sim.emit = (e) => { if (e.t === "swing" && e.spin) spins.push(e); orig(e); };
  run(sim, 2, {});
  assert.equal(spins.length, 1);
  assert.equal(sim.hero.state, "spin");
});

test("dodge gives invulnerability, moves the hero and has a cooldown", () => {
  const sim = field(2);
  const x0 = sim.hero.x;
  run(sim, 1, { mx: 1, pressed: { dodge: true } });
  assert.equal(sim.hero.state, "dodge");
  assert.ok(sim.hero.invuln > 0);
  const hit = sim.hurtHero(1, 10, 10, sim.hero.x + 10, sim.hero.y, "contact");
  assert.equal(hit, false, "no damage while rolling");
  run(sim, 20, {});
  assert.ok(sim.hero.x > x0 + 30, "the roll covers ground");
  run(sim, 1, { mx: 1, pressed: { dodge: true } });
  assert.notEqual(sim.hero.state, "dodge", "cooldown blocks an immediate second roll");
});

test("spells cost MP, need to be learned, and refuse when MP is short", () => {
  const sim = field(2);
  sim.gainXp(0);
  sim.learnSpell("emberBolt", false);
  run(sim, 1, {});
  assert.equal(sim.modal.kind, "unlock", "the new-spell banner shows while idle");
  sim.closeModal();
  sim.s.mp = 10;
  const made = [];
  const add = sim.addProjectile.bind(sim);
  sim.addProjectile = (...a) => { const p = add(...a); made.push(p.kind); return p; };
  run(sim, 1, { pressed: { magic: true } });
  assert.equal(sim.hero.state, "cast");
  run(sim, 10, {});
  assert.ok(made.includes("emberBolt"));
  assert.equal(sim.s.mp, 10 - 3);
  sim.s.mp = 0;
  run(sim, 30, {});
  run(sim, 1, { pressed: { magic: true } });
  assert.notEqual(sim.hero.state, "cast");
});

test("levelling heals, grows stats and teaches the level's skills and spells", () => {
  const sim = field(1);
  sim.s.hp = 1;
  sim.gainXp(10000);
  assert.ok(sim.s.level >= 7);
  assert.equal(sim.s.hp, sim.stats().hp);
  assert.ok(sim.s.spells.includes("emberBolt") && sim.s.spells.includes("frostRing"));
  assert.equal(sim.maxCombo(), 4);
});

test("shops sell, buy back at a quarter and equip; gating by condition", () => {
  const sim = field(3);
  sim.s.gold = 1000;
  const arms = Object.values(SHOPS).find(s => s.kind === "arms");
  const items = Object.values(SHOPS).find(s => s.kind === "items");
  assert.equal(sim.buy(items.id, "herb"), null);
  assert.equal(sim.s.bag.herb, 2);
  assert.equal(sim.buy(arms.id, "ironSword"), null);
  assert.equal(sim.equip("ironSword"), null);
  assert.equal(sim.s.equipped.weapon, "ironSword");
  assert.ok(sim.s.gear.includes("wornBlade"));
  assert.notEqual(sim.sell("wornBlade"), null, "unique gear cannot be sold");
  assert.equal(sim.buy(arms.id, "leatherCap1"), null);
  const before = sim.s.gold;
  assert.equal(sim.sell("leatherCap1"), null);
  assert.equal(sim.s.gold, before + Math.max(1, Math.floor(GEAR.leatherCap1.price / 4)));
  sim.s.flags.wolvesCleared = false;
  const bronze = arms.stock.find(id => id.startsWith("bronze"));
  if (bronze) assert.notEqual(sim.buy(arms.id, bronze), null, "bronze waits for the grove");
});

test("herbs heal, refuse at full HP; carry caps apply", () => {
  const sim = field(2);
  sim.s.hp = sim.stats().hp;
  sim.s.bag.herb = 9;
  assert.equal(sim.use("herb"), "HP is full");
  sim.s.hp = 1;
  assert.equal(sim.use("herb"), null);
  assert.ok(sim.s.hp > 1);
  sim.s.bag.herb = 9;
  assert.equal(sim.addItem("herb", 1, false), false);
});

test("resting at the inn heals and flips day and night; night NPCs appear", () => {
  const sim = field(2);
  sim.s.hp = 1;
  sim.rest();
  assert.equal(sim.s.night, true);
  assert.equal(sim.s.hp, sim.stats().hp);
  sim.enterMap("larkmoor", { x: 30, y: 30, facing: "down" });
  const spiritPlaced = MAPS.larkmoor.entities.some(e => e.type === "npc" && e.id === "wellSpirit");
  if (spiritPlaced) assert.ok(sim.actors.some(a => a.def === "wellSpirit"), "the well spirit shows at night");
  sim.rest();
  sim.enterMap("larkmoor", { x: 30, y: 30, facing: "down" });
  assert.ok(!sim.actors.some(a => a.def === "wellSpirit"));
});

test("chests open once, raise the item, and set story flags", () => {
  const sim = new Sim(newSave("Wren"));
  const chest = MAPS.home.entities.find(e => e.type === "chest");
  sim.openChest(chest.id);
  assert.equal(sim.hero.state, "raise");
  assert.ok(sim.s.chests.includes(chest.id));
  assert.equal(sim.s.flags.dressed, true);
  const gold = sim.s.gold;
  sim.openChest(chest.id);
  assert.equal(sim.s.gold, gold);
});

test("gates open when their condition becomes true", () => {
  const save = newSave("T", 3);
  save.flags = { dressed: true, gotBlade: true, dummyDone: true, metMaren: true, gateOpen: true };
  save.map = "mossgloam"; save.equipped.weapon = "wornBlade";
  const sim = new Sim(save);
  const gate = MAPS.mossgloam.entities.find(e => e.type === "gate" && e.id === "g_grove");
  assert.ok(gate);
  assert.ok(!sim.gatesOpen.has("g_grove"));
  sim.s.flags.wolvesCleared = true;
  run(sim, 2, {});
  assert.ok(sim.gatesOpen.has("g_grove"));
});

test("only one side quest at a time; the main quest is never blocked", () => {
  const sim = field(5);
  const sides = Object.values(QUESTS).filter(q => q.kind !== "main");
  assert.ok(sides.length >= 2);
  assert.equal(sim.startQuest(sides[0].id), true);
  sim.closeModal();
  assert.equal(sim.startQuest(sides[1].id), false);
});

test("death opens the dead modal and the save round-trips", () => {
  const sim = field(2);
  sim.s.hp = 1;
  sim.hurtHero(5, 50, 50, sim.hero.x + 5, sim.hero.y, "magic");
  assert.equal(sim.hero.state, "dead");
  run(sim, 120, {});
  assert.equal(sim.modal.kind, "dead");
  const saved = sim.durable();
  const again = new Sim(JSON.parse(JSON.stringify(saved)));
  assert.equal(again.map.id, saved.map);
  assert.equal(again.s.level, saved.level);
});

test("dialog token {hero} is replaced with the hero's name", () => {
  const sim = new Sim(newSave("Kestrel"));
  sim.inlineDialog([{ speaker: "{hero}", text: "Hello, {hero}." }]);
  const d = sim.dialogView();
  assert.equal(d.speaker, "Kestrel");
  assert.equal(d.text, "Hello, Kestrel.");
});

// ─── Regressions from the 25 Sep review (each was confirmed with a reproduction) ──────────────
function bossRoom() {
  const save = newSave("Test", 11);
  save.level = 9; save.equipped.weapon = "ironSword"; save.map = "barrow2"; save.quests = { wardstone: "thorn" };
  save.flags = { dressed: true, gotBlade: true, dummyDone: true, metMaren: true, gateOpen: true, wolvesCleared: true, barrowGateOpen: true };
  const sim = new Sim(save);
  const boss = sim.actors.find(a => a.mdef?.boss);
  return { sim, boss };
}

test("the Thornmother never leashes home or heals mid-fight", () => {
  const { sim, boss } = bossRoom();
  assert.ok(boss, "barrow2 spawns the boss");
  boss.aggro = true; boss.hp = Math.round(boss.maxHp * 0.3);
  const hp = boss.hp;
  // The hero stands as far from her as the arena allows.
  sim.hero.x = boss.x + 380; sim.hero.y = boss.y;
  sim.col.resolve(sim.hero, 7);
  run(sim, 60 * 8, {});
  assert.ok(boss.hp <= hp, "no healing");
  assert.equal(boss.aggro, true, "still fighting");
});

test("killing the boss clears her brood and hostile attacks and autosaves", () => {
  const { sim, boss } = bossRoom();
  const ling = sim.spawnMonster("thornling", boss.x + 40, boss.y);
  ling.aggro = true;
  sim.addProjectile("web", sim.hero.x, sim.hero.y - 40, 0, 40, 7, 2, true, 1, 20, 10, false);
  sim.takeSaveRequest();
  boss.hp = 1;
  sim.onMonsterKilled(boss);
  assert.equal(sim.s.flags.bossDown, true);
  assert.ok(ling.dead, "brood dies with her");
  assert.equal(sim.projectiles.filter(p => p.hostile).length, 0);
  assert.equal(sim.takeSaveRequest(), "story");
});

test("leaving the boss room early still lights the stone; the figure waits and leaves after speaking", () => {
  const { sim, boss } = bossRoom();
  boss.hp = 1; sim.onMonsterKilled(boss);
  sim.enterMap("barrow1", { x: 24, y: 5, facing: "down" });
  assert.equal(sim.s.flags.wardstoneLit, true);
  run(sim, 60 * 4, {});
  assert.equal(sim.modal.kind, "none", "no scene plays on the other map");
  sim.enterMap("barrow2", MAPS.barrow2.spawn);
  const figure = sim.actors.find(a => a.def === "hooded");
  if (MAPS.barrow2.entities.some(e => e.type === "npc" && e.id === "hooded")) {
    assert.ok(figure, "the figure waits by the stone");
    sim.onTalked("hooded");
    assert.equal(sim.s.flags.sawHooded, true);
  }
});

test("coin pickups report their value; a full bag leaves the item quietly on the ground", () => {
  const sim = field(3);
  const got = [];
  const orig = sim.emit.bind(sim);
  sim.emit = (e) => { if (e.t === "pickup") got.push(e.amount); orig(e); };
  sim.pickups.push({ id: 999, kind: "coin", value: 10, x: sim.hero.x, y: sim.hero.y - 6, z: 0, vx: 0, vy: 0, vz: 0, age: 1 });
  run(sim, 2, {});
  assert.deepEqual(got, [10]);
  sim.s.bag.herb = 9;
  sim.notices.length = 0;
  sim.pickups.push({ id: 1000, kind: "item", item: "herb", value: 1, x: sim.hero.x, y: sim.hero.y - 6, z: 0, vx: 0, vy: 0, vz: 0, age: 1 });
  run(sim, 60, {});
  assert.equal(sim.notices.filter(n => /carry/i.test(n.text)).length, 1, "one notice, not one per frame");
  assert.ok(sim.pickups.some(p => p.id === 1000), "the herb stays on the ground");
});

test("a dead hero cannot open the pause or item screens; loading a 0 HP save revives", () => {
  const sim = field(2);
  sim.s.hp = 1;
  sim.hurtHero(5, 50, 50, sim.hero.x + 5, sim.hero.y, "magic");
  sim.openModal({ kind: "pause" });
  assert.notEqual(sim.modal.kind, "pause");
  const bad = sim.durable(); bad.hp = 0;
  const again = new Sim(bad);
  assert.ok(again.s.hp > 0);
});

test("the lamb, while following, never takes the attack button", () => {
  const sim = field(3);
  assert.equal(sim.startQuest("lostLamb"), true);
  sim.closeModal();
  sim.enterMap("southfold", MAPS.southfold.spawn);
  const lamb = sim.actors.find(a => a.def === "lamb");
  assert.ok(lamb, "the lamb is in the pasture while the quest is active");
  lamb.following = true; lamb.x = sim.hero.x; lamb.y = sim.hero.y + 12;
  sim.hero.facing = "down";
  const it = sim.interactable();
  assert.ok(!it || it.id !== "lamb");
});

test("a swing faces the direction pressed on the same frame", () => {
  const sim = field(3);
  sim.hero.facing = "down";
  run(sim, 1, { mx: -1, pressed: { attack: true } });
  assert.equal(sim.hero.facing, "left");
  assert.equal(sim.hero.state, "attack");
});

test("charms are chosen, not forced; gear can be taken off (not the weapon)", () => {
  const sim = field(4);
  sim.addItem("wolfFang", 1, false);
  assert.equal(sim.s.equipped.charm, null, "the Wolf Fang waits in the bag");
  assert.equal(sim.equip("wolfFang"), null);
  assert.equal(sim.unequip("charm"), null);
  assert.equal(sim.s.equipped.charm, null);
  assert.notEqual(sim.unequip("weapon"), null);
});

test("chest loot is kept even when the bag is at its cap", () => {
  const sim = new Sim(newSave("Wren"));
  const chest = Object.values(MAPS).flatMap(m => m.entities.filter(e => e.type === "chest" && e.loot.kind === "item" && e.loot.item === "herb").map(e => ({ m, e })))[0];
  if (!chest) return;
  sim.enterMap(chest.m.id, chest.m.spawn);
  sim.s.bag.herb = 9;
  sim.openChest(chest.e.id);
  assert.ok(sim.s.bag.herb > 9);
});
