// Game 05 content checker.
//   node --import tsx tests/game-05/content-check.mjs [--balance] [--quiet]
// Verifies the content tables (lib/game-05/content/**) against docs/game-05/CONTENT.md and
// DIRECTION.md: every id referenced anywhere exists (dialog effects and conditions, quest goals
// and rewards, NPC talk rules, shops, chest loot, NPC and monster ids placed in MAPS), naming of
// sprites, icons and portraits, dialog length and reachability, markers, the level table, and the
// balance targets (computed with the sim's own combat math). Map-dependent checks only warn while
// the maps are stubs. Exit code 1 on any error.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const C = await import("../../lib/game-05/content/index.ts");
const {
  MAPS, PROPS, SOLID_GROUND, LEVELS, LEVEL_CAP, statsAt, XP_TO_NEXT, xpTotalTo,
  GEAR, CONSUMABLES, KEY_ITEMS, SPELLS, SKILLS, comboAt, MONSTERS, MONSTER_POWER, monsterStats,
  QUESTS, FLAGS, SIDE_QUESTS, BOUNTY_QUESTS, TARGET_FALLBACKS, SHOPS, SHOP_UNLOCKS, DIALOG, NPCS,
  HERO_TOKEN, SPEAKERS, sellPrice,
} = C;

const args = process.argv.slice(2);
const SHOW_BALANCE = args.includes("--balance");
const QUIET = args.includes("--quiet");
let errors = 0, warnings = 0;
const err = (area, msg) => { errors++; console.log(`ERROR ${area}: ${msg}`); };
const warn = (area, msg) => { warnings++; if (!QUIET) console.log(`warn  ${area}: ${msg}`); };
const info = (msg) => { if (!QUIET) console.log(msg); };

// ─── Binding ids from CONTENT.md ─────────────────────────────────────────────────────────────────
const contentMd = readFileSync(join(ROOT, "docs/game-05/CONTENT.md"), "utf8");
function section(title) {
  const i = contentMd.indexOf(`## ${title}`);
  if (i < 0) throw new Error(`CONTENT.md has no section "${title}"`);
  const j = contentMd.indexOf("\n## ", i + 3);
  return contentMd.slice(i, j < 0 ? undefined : j);
}
/** Backticked ids in a text, expanding `name1..3` to name1, name2, name3. */
function ticks(text) {
  const out = [];
  for (const m of text.matchAll(/`([A-Za-z_][\w.]*)`/g)) {
    const r = m[1].match(/^(.*?)(\d+)\.\.(\d+)$/);
    if (r) for (let n = +r[2]; n <= +r[3]; n++) out.push(`${r[1]}${n}`);
    else out.push(m[1]);
  }
  return out;
}
const lineOf = (text, prefix) => text.split("\n").find(l => l.trim().startsWith(prefix)) ?? "";
const npcSection = section("NPCs");
const CONTENT_NPCS = npcSection.split("\n").filter(l => l.startsWith("| `")).flatMap(l => ticks(l.split("|")[1]));
const itemsSection = section("Items (ids)");
const CONTENT_CONSUMABLES = ticks(lineOf(itemsSection, "Consumables:"));
const CONTENT_KEYS = ticks(lineOf(itemsSection, "Key items:"));
const CONTENT_GEAR = {};
for (const slot of ["head", "body", "boots", "weapon", "charm"]) CONTENT_GEAR[slot] = ticks(lineOf(itemsSection, `- ${slot}:`)).filter(id => !["dressed"].includes(id));
const monsterSection = section("Monsters (ids)");
const CONTENT_MONSTERS = {};
for (const m of monsterSection.matchAll(/`(\w+)` (?:L(\d+)|\(training)/g)) CONTENT_MONSTERS[m[1]] = m[2] ? +m[2] : null;
const questSection = section("Quests");
const CONTENT_QUESTS = ["wardstone", ...[...questSection.matchAll(/^- `(\w+)`/gm)].map(m => m[1])];
const CONTENT_MAIN_STEPS = [...questSection.matchAll(/^\d+\. `(\w+)`/gm)].map(m => m[1]);
const CONTENT_FLAGS = ticks(section("Flags")).filter(id => !id.includes("."));
const chestSection = section("Chests (ids → loot)");
const CONTENT_CHESTS = {};
for (const l of chestSection.split("\n")) {
  const map = l.match(/^(\w+):/)?.[1];
  if (!map) continue;
  for (const m of l.matchAll(/`(c_\w+)`(?:\s*\([^)]*\))?\s*→\s*(?:`(\w+)`(?:\s*×(\d+))?|(\d+) g)/g)) {
    CONTENT_CHESTS[m[1]] = { map, loot: m[2] ? { kind: "item", item: m[2], count: m[3] ? +m[3] : 1 } : { kind: "gold", amount: +m[4] } };
  }
}
const CONTENT_GATES = [...section("Gates").matchAll(/`(g_\w+)` \((\w+), (\w+)/g)].map(m => ({ id: m[1], kind: m[2], map: m[3] }));
const shopSection = section("Shops");
const CONTENT_SHOPS = {};
for (const l of shopSection.split("\n")) {
  const m = l.match(/^- `(\w+)` \((\w+), keeper `(\w+)`\):(.*)$/);
  if (m) CONTENT_SHOPS[m[1]] = { kind: m[2], keeper: m[3], stock: ticks(m[4]).filter(id => !["metMaren", "wolvesCleared"].includes(id)) };
}

// ─── Lookups ────────────────────────────────────────────────────────────────────────────────────
const ITEM = id => GEAR[id] ?? CONSUMABLES[id] ?? KEY_ITEMS[id];
const FLAGSET = new Set(FLAGS);
const MAP_IDS = Object.keys(MAPS);
const allEntities = () => Object.values(MAPS).flatMap(m => m.entities.map(e => ({ map: m.id, e })));
const allProps = () => Object.values(MAPS).flatMap(m => m.props.map(p => ({ map: m.id, p })));
const isStub = m => m.ground.length <= 10 && m.ground[0].length <= 12 && m.props.length === 0 && m.entities.length === 0;
const STUB_MAPS = Object.values(MAPS).filter(isStub).map(m => m.id);
const mapWarnOrErr = (mapId) => (STUB_MAPS.includes(mapId) ? warn : err);

const WRAP = 38, MAX_LINES = 3, HARD_MAX = 120, NAME_LEN = 10;

// ─── Conditions and effects ─────────────────────────────────────────────────────────────────────
function checkCond(c, where) {
  if (!c) return;
  if ("flag" in c || "notFlag" in c) { const f = c.flag ?? c.notFlag; if (!FLAGSET.has(f)) err(where, `unknown flag "${f}"`); return; }
  if ("quest" in c) {
    const q = QUESTS[c.quest];
    if (!q) err(where, `unknown quest "${c.quest}"`);
    else if (!q.steps.some(s => s.id === c.step)) err(where, `quest ${c.quest} has no step "${c.step}"`);
    return;
  }
  if ("questActive" in c) { if (!QUESTS[c.questActive]) err(where, `unknown quest "${c.questActive}"`); return; }
  if ("questDone" in c) { if (!QUESTS[c.questDone]) err(where, `unknown quest "${c.questDone}"`); return; }
  if ("night" in c) { if (typeof c.night !== "boolean") err(where, "night must be boolean"); return; }
  if ("level" in c) { if (!(c.level >= 1 && c.level <= LEVEL_CAP)) err(where, `bad level ${c.level}`); return; }
  if ("has" in c) { if (!ITEM(c.has)) err(where, `unknown item "${c.has}"`); return; }
  if ("all" in c) { c.all.forEach((x, i) => checkCond(x, `${where}.all[${i}]`)); return; }
  if ("any" in c) { c.any.forEach((x, i) => checkCond(x, `${where}.any[${i}]`)); return; }
  err(where, `unknown condition ${JSON.stringify(c)}`);
}
const GATE_IDS = new Set(allEntities().filter(x => x.e.type === "gate").map(x => x.e.id));
function checkEffect(e, where) {
  switch (e.t) {
    case "flag": if (!FLAGSET.has(e.flag)) err(where, `unknown flag "${e.flag}"`); break;
    case "give": case "take":
      if (!ITEM(e.item)) err(where, `unknown item "${e.item}"`);
      if (e.count != null && !(Number.isInteger(e.count) && e.count > 0)) err(where, `bad count ${e.count}`);
      if (e.t === "give" && CONSUMABLES[e.item] && (e.count ?? 1) > CONSUMABLES[e.item].carry) err(where, `gives more ${e.item} than can be carried`);
      break;
    case "gold": case "xp": if (!Number.isFinite(e.amount) || e.amount === 0) err(where, `bad ${e.t} amount`); break;
    case "startQuest": case "completeQuest": if (!QUESTS[e.quest]) err(where, `unknown quest "${e.quest}"`); break;
    case "advance":
      if (!QUESTS[e.quest]) err(where, `unknown quest "${e.quest}"`);
      else if (!QUESTS[e.quest].steps.some(s => s.id === e.step)) err(where, `quest ${e.quest} has no step "${e.step}"`);
      break;
    case "teach": if (!SPELLS[e.spell]) err(where, `unknown spell "${e.spell}"`); break;
    case "shop": if (!SHOPS[e.shop]) err(where, `unknown shop "${e.shop}"`); break;
    case "dialog": if (!DIALOG[e.dialog]) err(where, `unknown dialog "${e.dialog}"`); break;
    case "open": if (!GATE_IDS.has(e.gate)) (STUB_MAPS.length ? warn : err)(where, `gate "${e.gate}" is not placed in any map`); break;
    case "shake": if (!(e.strength > 0)) err(where, "shake strength must be > 0"); break;
    case "rest": case "heal": case "chapterClear": break;
    default: err(where, `unknown effect ${JSON.stringify(e)}`);
  }
}
/** Effects reachable from a dialog (its effects, chained dialogs and choice branches). */
function effectsFrom(dialogId, seen = new Set()) {
  if (seen.has(dialogId) || !DIALOG[dialogId]) return [];
  seen.add(dialogId);
  const d = DIALOG[dialogId];
  const out = [...(d.effects ?? [])];
  for (const c of d.choices ?? []) { out.push(...(c.effects ?? [])); if (c.next) out.push(...effectsFrom(c.next, seen)); }
  for (const e of d.effects ?? []) if (e.t === "dialog") out.push(...effectsFrom(e.dialog, seen));
  return out;
}

// ─── 1. Level table ─────────────────────────────────────────────────────────────────────────────
for (let L = 1; L <= LEVEL_CAP; L++) {
  const want = {
    hp: Math.round(18 * 1.12 ** (L - 1)), mp: 6 + 2 * L, atk: Math.round(6 * 1.1 ** (L - 1)),
    def: Math.round(5 * 1.1 ** (L - 1)), spd: Math.round(8 * 1.08 ** (L - 1)),
  };
  const got = LEVELS[L];
  for (const k of Object.keys(want)) if (got?.[k] !== want[k]) err("levels", `L${L} ${k} ${got?.[k]} ≠ ${want[k]}`);
  if (JSON.stringify(statsAt(L)) !== JSON.stringify(got)) err("levels", `statsAt(${L}) differs from LEVELS[${L}]`);
  if (L < LEVEL_CAP && XP_TO_NEXT(L) !== 8 * L * L + 16 * L) err("levels", `XP_TO_NEXT(${L}) ≠ ${8 * L * L + 16 * L}`);
}
if (LEVELS.length !== LEVEL_CAP + 1) err("levels", `LEVELS must have ${LEVEL_CAP + 1} rows (index = level)`);

// ─── 2. Items ───────────────────────────────────────────────────────────────────────────────────
const seenItem = new Map();
for (const [table, rec] of [["GEAR", GEAR], ["CONSUMABLES", CONSUMABLES], ["KEY_ITEMS", KEY_ITEMS]]) {
  for (const [k, v] of Object.entries(rec)) {
    if (v.id !== k) err("items", `${table}.${k} has id "${v.id}"`);
    if (seenItem.has(k)) err("items", `item id ${k} is in both ${seenItem.get(k)} and ${table}`);
    seenItem.set(k, table);
    if (v.icon !== `icon.${k}`) err("items", `${k} icon "${v.icon}" should be "icon.${k}"`);
    if (!v.name || !v.desc) err("items", `${k} needs a name and a desc`);
    if (v.desc && v.desc.length > 64) err("items", `${k} desc is ${v.desc.length} chars (keep it to one short line, ≤ 64)`);
  }
}
for (const id of CONTENT_CONSUMABLES) if (!CONSUMABLES[id]) err("items", `CONTENT consumable "${id}" missing`);
for (const id of CONTENT_KEYS) if (!KEY_ITEMS[id]) err("items", `CONTENT key item "${id}" missing`);
for (const [slot, ids] of Object.entries(CONTENT_GEAR)) for (const id of ids) {
  if (!GEAR[id]) err("items", `CONTENT gear "${id}" missing`);
  else if (GEAR[id].slot !== slot) err("items", `${id} slot ${GEAR[id].slot} ≠ ${slot}`);
}
const contentGearIds = new Set(Object.values(CONTENT_GEAR).flat());
for (const id of Object.keys(GEAR)) if (!contentGearIds.has(id)) err("items", `gear "${id}" is not in CONTENT.md`);
for (const id of Object.keys(CONSUMABLES)) if (!CONTENT_CONSUMABLES.includes(id)) err("items", `consumable "${id}" is not in CONTENT.md`);
for (const id of Object.keys(KEY_ITEMS)) if (!CONTENT_KEYS.includes(id)) err("items", `key item "${id}" is not in CONTENT.md`);
// DIRECTION consumable numbers.
const WANT_CONS = {
  herb: [{ kind: "heal", hp: 40 }, 40, 9], tonic: [{ kind: "heal", hp: 150 }, 300, 9], manaDraught: [{ kind: "mana", mp: 40 }, 400, 9],
  elixir: [{ kind: "full" }, 1500, 1],
};
for (const [id, [effect, price, carry]] of Object.entries(WANT_CONS)) {
  const c = CONSUMABLES[id];
  if (!c) continue;
  if (JSON.stringify(c.effect) !== JSON.stringify(effect) || c.price !== price || c.carry !== carry) err("items", `${id} must be ${JSON.stringify(effect)}, ${price} g, carry ${carry} (DIRECTION)`);
}
for (const b of ["stoneskin", "fury", "fortune", "quickstep"]) {
  const c = CONSUMABLES[b];
  if (c && (c.effect.kind !== "buff" || c.effect.buff !== b || c.effect.seconds !== 30 || c.carry !== 9)) err("items", `${b} must be a 30 s buff, carry 9`);
}
// Gear ladder: unique tiers per slot, price shape.
for (const slot of ["head", "body", "boots", "weapon", "charm"]) {
  const tiers = Object.values(GEAR).filter(g => g.slot === slot).map(g => g.tier);
  if (new Set(tiers).size !== tiers.length) err("items", `${slot} tiers are not unique`);
}
const ratio = (a, b) => GEAR[a]?.price / GEAR[b]?.price;
for (const [line, lo, hi] of [["leatherCap", 2.3, 2.7], ["leatherVest", 2.3, 2.7], ["leatherBoots", 2.3, 2.7], ["boarCap", 2.3, 2.7], ["boarVest", 2.3, 2.7], ["boarBoots", 2.3, 2.7]]) {
  const r = ratio(`${line}3`, `${line}1`);
  if (!(r >= lo && r <= hi)) err("items", `${line}3 / ${line}1 price ratio ${r?.toFixed(2)} (want ≈ 2.5)`);
}
for (const [boar, leather] of [["boarCap", "leatherCap"], ["boarVest", "leatherVest"], ["boarBoots", "leatherBoots"]]) {
  for (const n of [1, 2, 3]) {
    const r = ratio(`${boar}${n}`, `${leather}${n}`);
    if (!(r >= 1.7 && r <= 1.9)) err("items", `${boar}${n} / ${leather}${n} price ratio ${r?.toFixed(2)} (want ≈ 1.8)`);
  }
}
for (const [bronze, boar] of [["bronzeHelm1", "boarCap3"], ["bronzeMail1", "boarVest3"], ["bronzeGreaves1", "boarBoots3"]]) {
  if (!(GEAR[bronze]?.price > GEAR[boar]?.price)) err("items", `${bronze} should cost more than ${boar}`);
}
for (const g of Object.values(GEAR)) {
  if ((g.slot === "weapon" || g.slot === "charm") && g.dropLevels) err("items", `${g.id}: weapons and charms never drop`);
  if (g.price == null && g.dropLevels) err("items", `${g.id}: unique gear (price null) must not drop`);
  if (g.dropLevels && !(g.dropLevels[0] >= 1 && g.dropLevels[0] <= g.dropLevels[1])) err("items", `${g.id}: bad dropLevels`);
  for (const k of Object.keys(g.mods)) if (!["hp", "mp", "atk", "def", "spd"].includes(k)) err("items", `${g.id}: bad mod ${k}`);
}
if (GEAR.emberBlade?.special !== "burn") err("items", "emberBlade must burn");
if (GEAR.lambsBell?.special !== "goldFind") err("items", "lambsBell must find gold");
if (!(GEAR.wolfFang?.mods.atk > 0 && GEAR.wolfFang?.mods.def < 0)) err("items", "wolfFang must be +ATK −DEF");

// ─── 3. Spells and skills ───────────────────────────────────────────────────────────────────────
const WANT_SPELLS = { emberBolt: [2, 3, "bolt"], frostRing: [7, 8, "ring"], thornbreak: [null, 12, "spread"] };
for (const [id, [level, mp, kind]] of Object.entries(WANT_SPELLS)) {
  const s = SPELLS[id];
  if (!s) { err("spells", `${id} missing`); continue; }
  if (s.id !== id || s.level !== level || s.mp !== mp || s.kind !== kind) err("spells", `${id} must be level ${level}, ${mp} MP, ${kind}`);
  if (s.icon !== `icon.spell.${id}`) err("spells", `${id} icon should be icon.spell.${id}`);
  if (!(s.power > 0)) err("spells", `${id} needs power > 0`);
}
const WANT_SKILLS = { combo2: 1, combo3: 3, spin: 5, combo4: 6 };
for (const [id, level] of Object.entries(WANT_SKILLS)) {
  const s = SKILLS.find(k => k.id === id);
  if (!s) err("skills", `${id} missing`);
  else {
    if (s.level !== level) err("skills", `${id} unlocks at L${level} (DIRECTION), not L${s.level}`);
    if (!s.name || !s.hint) err("skills", `${id} needs a banner name and a hint`);
    if (s.hint.length > 60) err("skills", `${id} hint is too long for the banner`);
  }
}

// ─── 4. Monsters ────────────────────────────────────────────────────────────────────────────────
const BEHAVIOURS = new Set(["hopper", "swooper", "charger", "spore", "packWolf", "spitter", "shieldGuard", "boss", "dummy"]);
for (const [id, lv] of Object.entries(CONTENT_MONSTERS)) {
  const m = MONSTERS[id];
  if (!m) { err("monsters", `CONTENT monster "${id}" missing`); continue; }
  if (lv != null && m.level !== lv) err("monsters", `${id} is L${m.level}, CONTENT says L${lv}`);
}
for (const [id, m] of Object.entries(MONSTERS)) {
  if (!(id in CONTENT_MONSTERS)) err("monsters", `monster "${id}" is not in CONTENT.md`);
  if (m.id !== id) err("monsters", `${id} has id "${m.id}"`);
  if (!BEHAVIOURS.has(m.behaviour)) err("monsters", `${id} behaviour "${m.behaviour}"`);
  const sprite = id === "oldTusk" ? "mon.bristleboar" : `mon.${id}`;
  if (m.sprite !== sprite) err("monsters", `${id} sprite "${m.sprite}" should be "${sprite}"`);
  if (!(m.gold[0] <= m.gold[1] && m.gold[0] >= 0)) err("monsters", `${id} gold range`);
  for (const k of ["gold", "consumable", "gear"]) if (!(m.drops[k] >= 0 && m.drops[k] <= 1)) err("monsters", `${id} drops.${k}`);
  for (const k of ["hp", "atk", "def", "spd"]) if (!(m.mult[k] > 0)) err("monsters", `${id} mult.${k} must be > 0`);
  if (!(MONSTER_POWER[id] >= 0)) err("monsters", `${id} has no MONSTER_POWER`);
  if (m.behaviour !== "dummy" && m.gold[1] > 0 && m.gold[0] < 1) err("monsters", `${id} min gold must be ≥ 1 (the sim drops at least 1 coin)`);
}
if (MONSTERS.thornmother?.boss?.phases !== 3) err("monsters", "thornmother needs boss.phases 3");
if (!MONSTERS.oldTusk?.elite || MONSTERS.oldTusk?.behaviour !== MONSTERS.bristleboar?.behaviour) err("monsters", "oldTusk must be an elite bristleboar");
if (MONSTERS.dummy?.xp !== 0 || MONSTERS.dummy?.behaviour !== "dummy") err("monsters", "dummy gives no XP and uses the dummy behaviour");
if (MONSTERS.thornling?.behaviour !== "hopper") err("monsters", "thornling is a hopper (CONTENT)");

// ─── 5. Quests ──────────────────────────────────────────────────────────────────────────────────
const NPC_PLACED = new Set(allEntities().filter(x => x.e.type === "npc").map(x => x.e.id));
for (const id of CONTENT_QUESTS) if (!QUESTS[id]) err("quests", `CONTENT quest "${id}" missing`);
for (const [id, q] of Object.entries(QUESTS)) {
  const where = `quests.${id}`;
  if (q.id !== id) err(where, `id "${q.id}"`);
  if (!CONTENT_QUESTS.includes(id)) err(where, "not in CONTENT.md");
  const wantKind = id === "wardstone" ? "main" : id.startsWith("bounty") ? "bounty" : "side";
  if (q.kind !== wantKind) err(where, `kind ${q.kind} ≠ ${wantKind}`);
  if (q.giver && !NPCS[q.giver]) err(where, `giver "${q.giver}" is not an NPC`);
  if (!q.steps.length) err(where, "no steps");
  if (new Set(q.steps.map(s => s.id)).size !== q.steps.length) err(where, "duplicate step ids");
  if (q.kind !== "main" && !q.hint) err(where, "side quests need a hint for the quest card");
  for (const s of q.steps) {
    const sw = `${where}.${s.id}`;
    if (!s.ticker || s.ticker.length > 34) err(sw, `ticker "${s.ticker}" must be 1–34 chars`);
    const g = s.goal;
    if ((g.kind === "kill" || (g.kind === "collect" && g.count > 1)) && /\d+\s*\/\s*\d+/.test(s.ticker)) err(sw, "the engine appends the counter; write the bare ticker");
    if (g.kind === "talk") { if (!NPCS[g.npc]) err(sw, `talk goal npc "${g.npc}" unknown`); }
    else if (g.kind === "reach") { if (!MAPS[g.map]) err(sw, `reach map "${g.map}" unknown`); }
    else if (g.kind === "kill") { if (!MONSTERS[g.monster]) err(sw, `kill monster "${g.monster}" unknown`); if (!(g.count >= 1)) err(sw, "kill count"); }
    else if (g.kind === "collect") { if (!ITEM(g.item)) err(sw, `collect item "${g.item}" unknown`); if (!(g.count >= 1)) err(sw, "collect count"); }
    else if (g.kind === "flag") { if (!FLAGSET.has(g.flag)) err(sw, `goal flag "${g.flag}" unknown`); }
    else err(sw, `unknown goal ${JSON.stringify(g)}`);
    const t = s.target;
    if (t && "npc" in t && !NPCS[t.npc]) err(sw, `target npc "${t.npc}" unknown`);
    if (t && "map" in t && !MAPS[t.map]) err(sw, `target map "${t.map}" unknown`);
    // Arrow needs something to point at: an explicit target, a talk goal or a reach goal.
    if (!t && g.kind !== "talk" && g.kind !== "reach" && !(q.kind !== "main" && g.kind === "collect")) err(sw, "no arrow target");
    const npcTarget = t && "npc" in t ? t.npc : g.kind === "talk" ? g.npc : null;
    if (npcTarget && !["hooded", "lamb"].includes(npcTarget) && !NPC_PLACED.has(npcTarget)) warn(sw, `arrow NPC "${npcTarget}" is not placed in any map yet`);
    for (const pt of [t && "map" in t ? t : null, g.kind === "reach" ? g : null]) {
      if (!pt) continue;
      const m = MAPS[pt.map];
      const W = m.ground[0].length, H = m.ground.length;
      if (!(pt.x >= 0 && pt.y >= 0 && pt.x <= W && pt.y <= H)) mapWarnOrErr(pt.map)(sw, `point (${pt.x}, ${pt.y}) is outside ${pt.map} (${W}×${H})`);
      else if (SOLID_GROUND.has(m.ground[Math.min(H - 1, Math.floor(pt.y))][Math.min(W - 1, Math.floor(pt.x))]) && !isStub(m)) warn(sw, `point (${pt.x}, ${pt.y}) sits on solid ground in ${pt.map}`);
    }
  }
  for (const i of q.reward.items ?? []) if (!ITEM(i)) err(where, `reward item "${i}" unknown`);
  if (q.reward.spell && !SPELLS[q.reward.spell]) err(where, `reward spell "${q.reward.spell}" unknown`);
}
if (QUESTS.wardstone && JSON.stringify(QUESTS.wardstone.steps.map(s => s.id)) !== JSON.stringify(CONTENT_MAIN_STEPS)) err("quests.wardstone", `steps ${QUESTS.wardstone.steps.map(s => s.id)} ≠ CONTENT ${CONTENT_MAIN_STEPS}`);
for (const [q, ids] of [["lostLamb", ["find", "lead"]], ["wellSpirit", ["ring", "give"]]]) {
  const got = QUESTS[q]?.steps.map(s => s.id) ?? [];
  for (const id of ids) if (!got.includes(id)) err(`quests.${q}`, `CONTENT step "${id}" missing`);
}
if (QUESTS.lostLamb?.steps.find(s => s.id === "lead")?.goal.flag !== "lambHome") err("quests.lostLamb", "lead must be flag lambHome (the sim sets it)");
if (QUESTS.bountyTusk?.minLevel !== 4) err("quests.bountyTusk", "minLevel must be 4");
// The sim's bounty board shows "<title>: <summary>" as one dialog line (sim.ts bountyBoard).
for (const q of Object.values(QUESTS).filter(q => q.kind === "bounty")) {
  const text = `${q.title}: ${q.summary}`;
  if (text.length > 120 || wrapCount(text) > 3) err(`quests.${q.id}`, `board text "${text}" wraps past 3 lines of 38`);
}
for (const q of [...SIDE_QUESTS, ...BOUNTY_QUESTS]) if (!QUESTS[q] || QUESTS[q].kind === "main") err("quests", `SIDE/BOUNTY list has "${q}"`);
for (const f of CONTENT_FLAGS) if (!FLAGSET.has(f)) err("flags", `CONTENT flag "${f}" missing from FLAGS`);
for (const f of FLAGS) if (!CONTENT_FLAGS.includes(f)) err("flags", `flag "${f}" is not in CONTENT.md`);
// The bounty board (sim) offers bounties in QUESTS order: Mosslings before the Old Tusk.
const bountyOrder = Object.values(QUESTS).filter(q => q.kind === "bounty").map(q => q.id);
if (bountyOrder.indexOf("bountyMoss") > bountyOrder.indexOf("bountyTusk")) err("quests", "bountyMoss must come before bountyTusk (board order)");
for (const f of TARGET_FALLBACKS) (STUB_MAPS.some(m => f.startsWith(`${m}:`)) ? warn : err)("quests.targets", f);

// ─── 6. Shops ───────────────────────────────────────────────────────────────────────────────────
for (const [id, want] of Object.entries(CONTENT_SHOPS)) {
  const s = SHOPS[id];
  if (!s) { err("shops", `CONTENT shop "${id}" missing`); continue; }
  if (s.kind !== want.kind || s.keeper !== want.keeper) err("shops", `${id} must be ${want.kind}, keeper ${want.keeper}`);
  if (JSON.stringify([...s.stock].sort()) !== JSON.stringify([...want.stock].sort())) err("shops", `${id} stock ${s.stock} ≠ CONTENT ${want.stock}`);
}
for (const [id, s] of Object.entries(SHOPS)) {
  if (s.id !== id) err("shops", `${id} has id ${s.id}`);
  if (!NPCS[s.keeper]) err("shops", `${id} keeper "${s.keeper}" unknown`);
  for (const i of s.stock) {
    if (!ITEM(i)) err("shops", `${id} sells unknown "${i}"`);
    else if ((GEAR[i]?.price ?? CONSUMABLES[i]?.price) == null) err("shops", `${id} sells "${i}" which has no price`);
    if (s.kind === "items" && !CONSUMABLES[i]) err("shops", `${id} (items) sells non-consumable ${i}`);
    if (s.kind === "arms" && !GEAR[i]) err("shops", `${id} (arms) sells non-gear ${i}`);
  }
  const opener = Object.values(DIALOG).some(d => [...(d.effects ?? []), ...(d.choices ?? []).flatMap(c => c.effects ?? [])].some(e => e.t === "shop" && e.shop === id));
  if (!opener) err("shops", `no dialog opens ${id}`);
}
for (const [item, cond] of Object.entries(SHOP_UNLOCKS)) {
  if (!Object.values(SHOPS).some(s => s.stock.includes(item))) err("shops", `SHOP_UNLOCKS.${item} is not stocked anywhere`);
  checkCond(cond, `SHOP_UNLOCKS.${item}`);
}
for (const i of ["boarCap1", "boarVest1", "boarBoots1"]) if (SHOP_UNLOCKS[i]?.flag !== "metMaren") err("shops", `${i} unlocks after metMaren`);
for (const i of ["bronzeHelm1", "bronzeMail1", "bronzeGreaves1"]) if (SHOP_UNLOCKS[i]?.flag !== "wolvesCleared") err("shops", `${i} unlocks after wolvesCleared`);

// ─── 7. NPCs ────────────────────────────────────────────────────────────────────────────────────
for (const id of CONTENT_NPCS) if (!NPCS[id]) err("npcs", `CONTENT NPC "${id}" missing`);
const NAMES = new Set(Object.values(NPCS).map(n => n.name));
for (const [id, n] of Object.entries(NPCS)) {
  const where = `npcs.${id}`;
  if (!CONTENT_NPCS.includes(id)) err(where, "not in CONTENT.md");
  if (n.id !== id) err(where, `id "${n.id}"`);
  if (n.sprite !== `npc.${id}`) err(where, `sprite "${n.sprite}" should be npc.${id}`);
  if (n.portrait !== `portrait.${id}`) err(where, `portrait "${n.portrait}" should be portrait.${id}`);
  if (!n.talk.length) err(where, "no talk rules");
  if (n.talk.length && n.talk[n.talk.length - 1].when) err(where, "the last talk rule must have no condition");
  n.talk.forEach((r, i) => {
    const rw = `${where}.talk[${i}]`;
    checkCond(r.when, rw);
    if (!DIALOG[r.dialog]) { err(rw, `dialog "${r.dialog}" missing`); return; }
    const fx = effectsFrom(r.dialog);
    if (r.marker === "!" && !fx.some(e => e.t === "startQuest")) err(rw, `"!" rule's dialog ${r.dialog} never starts a quest`);
    if (fx.some(e => e.t === "startQuest") && r.marker !== "!") err(rw, `dialog ${r.dialog} starts a quest but the rule has no "!" marker`);
    if (r.marker === "?") {
      const setsGoalFlag = fx.some(e => e.t === "flag" && Object.values(QUESTS).some(q => q.steps.some(s => s.goal.kind === "flag" && s.goal.flag === e.flag)));
      const talkStep = r.when && "quest" in r.when && QUESTS[r.when.quest]?.steps.find(s => s.id === r.when.step)?.goal;
      const isTalkGoal = talkStep?.kind === "talk" && talkStep.npc === id;
      if (!fx.some(e => e.t === "completeQuest") && !setsGoalFlag && !isTalkGoal) err(rw, `"?" rule's dialog ${r.dialog} neither completes a quest nor meets a step`);
    }
  });
}
// Every side quest has an offer ("!") somewhere, and every final talk step a turn-in.
for (const q of Object.values(QUESTS)) {
  if (q.kind === "side") {
    const offered = Object.values(NPCS).some(n => n.talk.some(r => r.marker === "!" && effectsFrom(r.dialog).some(e => e.t === "startQuest" && e.quest === q.id)));
    if (!offered) err(`quests.${q.id}`, "no NPC offers it");
    if (q.giver && !NPCS[q.giver]?.talk.some(r => effectsFrom(r.dialog).some(e => e.t === "startQuest" && e.quest === q.id))) err(`quests.${q.id}`, `giver ${q.giver} never offers it`);
  }
  const last = q.steps[q.steps.length - 1];
  if (last?.goal.kind === "talk") {
    const n = NPCS[last.goal.npc];
    const rule = n?.talk.find(r => r.when && "quest" in r.when && r.when.quest === q.id && r.when.step === last.id);
    if (!rule) err(`quests.${q.id}`, `${last.goal.npc} has no rule for the turn-in step "${last.id}"`);
    else if (!effectsFrom(rule.dialog).some(e => e.t === "completeQuest" && e.quest === q.id)) err(`quests.${q.id}`, `turn-in dialog ${rule.dialog} lacks completeQuest`);
  }
}
// A rule placed after an unconditional rule can never fire.
for (const [id, n] of Object.entries(NPCS)) {
  const k = n.talk.findIndex(r => !r.when);
  if (k >= 0 && k < n.talk.length - 1) err(`npcs.${id}`, `rules after talk[${k}] can never match`);
}

// ─── 8. Dialog: references, speakers, length, reachability ─────────────────────────────────────
function wrapCount(text) {
  const words = text.split(HERO_TOKEN).join("W".repeat(NAME_LEN)).split(/\s+/);
  let lines = 1, cur = 0;
  for (const w of words) {
    if (!cur) { cur = w.length; continue; }
    if (cur + 1 + w.length <= WRAP) cur += 1 + w.length;
    else { lines++; cur = w.length; }
  }
  return lines;
}
const OK_SPEAKERS = new Set(["", HERO_TOKEN, "Notice Board", "Signpost", ...NAMES]);
let heroTokens = 0, lineCount = 0;
for (const [id, d] of Object.entries(DIALOG)) {
  const where = `dialog.${id}`;
  if (d.id !== id) err(where, `id "${d.id}"`);
  if (!d.lines.length) err(where, "no lines");
  d.lines.forEach((l, i) => {
    lineCount++;
    if (!OK_SPEAKERS.has(l.speaker)) err(where, `line ${i} speaker "${l.speaker}" is not an NPC name`);
    if (l.text.length > HARD_MAX) err(where, `line ${i} is ${l.text.length} chars (> ${HARD_MAX})`);
    const n = wrapCount(l.text);
    if (n > MAX_LINES) err(where, `line ${i} wraps to ${n} lines at ${WRAP} cols: "${l.text}"`);
    if (l.portrait && l.portrait !== "portrait.hero" && !(l.portrait.startsWith("portrait.") && NPCS[l.portrait.slice(9)])) err(where, `line ${i} portrait "${l.portrait}"`);
    if (l.speaker && l.speaker !== HERO_TOKEN && l.portrait && NPCS[l.portrait.slice(9)]?.name !== l.speaker) err(where, `line ${i} portrait ${l.portrait} does not match speaker ${l.speaker}`);
    if ((l.text + l.speaker).includes(HERO_TOKEN)) heroTokens++;
    if (/[{}]/.test(l.text.split(HERO_TOKEN).join(""))) err(where, `line ${i} has a stray brace`);
  });
  (d.effects ?? []).forEach((e, i) => checkEffect(e, `${where}.effects[${i}]`));
  (d.choices ?? []).forEach((c, i) => {
    if (!c.label || c.label.length > 20) err(where, `choice ${i} label "${c.label}" must be 1–20 chars`);
    (c.effects ?? []).forEach((e, k) => checkEffect(e, `${where}.choices[${i}].effects[${k}]`));
    if (c.next && !DIALOG[c.next]) err(where, `choice ${i} next "${c.next}" missing`);
  });
  if (d.choices && d.choices.length > 4) err(where, "at most 4 choices");
  // Starting a quest must not be followed by a gift the player could keep after a refusal.
  const fx = d.effects ?? [];
  const si = fx.findIndex(e => e.t === "startQuest");
  if (si >= 0 && fx.slice(si + 1).some(e => e.t === "give") && !fx.some(e => e.t === "completeQuest")) err(where, "gives items after startQuest in the same list; chain a dialog instead");
}
// Reachability.
const roots = new Map();
for (const n of Object.values(NPCS)) for (const r of n.talk) roots.set(r.dialog, `npc ${n.id}`);
const propIds = new Map(allProps().filter(x => x.p.id).map(x => [x.p.id, x]));
for (const { map, e } of allEntities()) if (e.type === "trigger") {
  checkCond(e.when, `maps.${map}.trigger.${e.id}`);
  e.effects.forEach((fx, i) => { checkEffect(fx, `maps.${map}.trigger.${e.id}[${i}]`); if (fx.t === "dialog") roots.set(fx.dialog, `trigger ${e.id}`); });
}
const pendingProps = [];
for (const id of Object.keys(DIALOG)) {
  const m = id.match(/^(sign|inspect)\.(.+)$/);
  if (!m) continue;
  const p = propIds.get(m[2]);
  if (p) {
    const want = m[1] === "sign" ? "read" : "inspect";
    if (PROPS[p.p.kind]?.interact !== want) err(`dialog.${id}`, `prop ${m[2]} in ${p.map} is a ${p.p.kind}, which is not "${want}"-able`);
    roots.set(id, `prop ${m[2]}`);
  } else pendingProps.push(m[2]);
}
const reached = new Set();
const stack = [...roots.keys()];
while (stack.length) {
  const id = stack.pop();
  if (reached.has(id) || !DIALOG[id]) continue;
  reached.add(id);
  const d = DIALOG[id];
  for (const e of d.effects ?? []) if (e.t === "dialog") stack.push(e.dialog);
  for (const c of d.choices ?? []) { if (c.next) stack.push(c.next); for (const e of c.effects ?? []) if (e.t === "dialog") stack.push(e.dialog); }
}
for (const id of Object.keys(DIALOG)) if (!reached.has(id)) {
  const m = id.match(/^(sign|inspect)\.(.+)$/);
  if (m) warn(`dialog.${id}`, `waiting for a "${m[2]}" prop with interact in a map (the sim reads ${id} by prop id)`);
  else err(`dialog.${id}`, "unreachable (no talk rule, choice, dialog effect or trigger leads here)");
}

// ─── 9. Maps: ids placed there must exist (errors); CONTENT placements (warnings while stubs) ───
const placedChests = new Map(), placedSpawns = [], placedNpcs = new Map();
for (const { map, e } of allEntities()) {
  const where = `maps.${map}`;
  if (e.type === "npc") {
    if (!NPCS[e.id]) err(where, `npc "${e.id}" is not in NPCS`);
    placedNpcs.set(e.id, map);
    if (e.id === "wellSpirit" && e.night !== "only") err(where, "wellSpirit must be night: \"only\"");
    if (e.id === "nessa" && e.night !== "hide") warn(where, "nessa is a daytime NPC (night: \"hide\")");
    if (e.id === "lamb") err(where, "the lamb must be a follower entity, not an npc");
  } else if (e.type === "follower") {
    if (!NPCS[e.npc]) err(where, `follower npc "${e.npc}" is not in NPCS`);
    checkCond(e.when, `${where}.follower.${e.id}`);
  } else if (e.type === "spawn") {
    if (!MONSTERS[e.monster]) err(where, `spawn ${e.id}: monster "${e.monster}" unknown`);
    checkCond(e.when, `${where}.spawn.${e.id}`);
    placedSpawns.push({ map, e });
  } else if (e.type === "chest") {
    if (placedChests.has(e.id)) err(where, `chest id ${e.id} used twice`);
    placedChests.set(e.id, { map, e });
    if (e.loot.kind === "item") {
      if (!ITEM(e.loot.item)) err(where, `chest ${e.id}: loot item "${e.loot.item}" unknown`);
    } else if (!(e.loot.amount > 0)) err(where, `chest ${e.id}: gold amount`);
  } else if (e.type === "gate") {
    checkCond(e.open, `${where}.gate.${e.id}`);
  } else if (e.type === "exit") {
    if (!MAPS[e.to]) err(where, `exit to unknown map "${e.to}"`);
  }
}
for (const [id, want] of Object.entries(CONTENT_CHESTS)) {
  const got = placedChests.get(id);
  if (!got) { mapWarnOrErr(want.map)(`maps.${want.map}`, `chest ${id} not placed yet`); continue; }
  if (got.map !== want.map) err(`maps.${got.map}`, `chest ${id} belongs in ${want.map}`);
  const l = got.e.loot;
  const same = want.loot.kind === "gold" ? l.kind === "gold" && l.amount === want.loot.amount : l.kind === "item" && l.item === want.loot.item && (l.count ?? 1) === want.loot.count;
  if (!same) err(`maps.${got.map}`, `chest ${id} loot ${JSON.stringify(l)} ≠ CONTENT ${JSON.stringify(want.loot)}`);
}
for (const id of CONTENT_NPCS) {
  if (["hooded", "lamb"].includes(id)) continue; // the sim spawns the hooded figure; the lamb is a follower
  if (!placedNpcs.has(id)) warn("maps", `NPC ${id} is not placed in any map yet`);
}
if (!allEntities().some(x => x.e.type === "follower" && x.e.npc === "lamb")) warn("maps.southfold", "the lamb follower is not placed yet");
for (const g of CONTENT_GATES) if (!GATE_IDS.has(g.id)) mapWarnOrErr(g.map)(`maps.${g.map}`, `gate ${g.id} not placed yet`);
const grove = placedSpawns.find(x => x.e.id === "groveWolves");
if (!grove) mapWarnOrErr("mossgloam")("maps.mossgloam", "spawn groveWolves not placed yet");
else if (grove.e.monster !== "greywolf" || grove.e.count !== 5 || !grove.e.once) err("maps.mossgloam", "groveWolves must be 5 greywolves, once");
for (const [mon, map] of [["mossling", "southfold"], ["oldTusk", "southfold"], ["greywolf", "mossgloam"], ["barrowGuard", "barrow1"], ["thornmother", "barrow2"], ["dummy", "larkmoor"]]) {
  if (!placedSpawns.some(x => x.e.monster === mon && x.map === map)) mapWarnOrErr(map)(`maps.${map}`, `no ${mon} spawn yet`);
}
for (const [id, map] of [["bountyBoard", "larkmoor"], ["bridgeLever", "mossgloam"], ["leverB1", "barrow1"]]) {
  const p = propIds.get(id);
  if (!p) mapWarnOrErr(map)(`maps.${map}`, `prop "${id}" not placed yet (the sim keys it by id)`);
  else if (p.map !== map) err(`maps.${p.map}`, `prop ${id} belongs in ${map}`);
}
for (const m of Object.values(MAPS)) for (const p of m.props) if (!PROPS[p.kind]) err(`maps.${m.id}`, `unknown prop kind ${p.kind}`);
if (STUB_MAPS.length) warn("maps", `still stubs: ${STUB_MAPS.join(", ")}`);

// ─── 10. Balance (the sim's combat math: lib/game-05/sim) ───────────────────────────────────────
// damage = max(1, round(power × ATK² / (ATK + DEF) × U(0.9, 1.1))), ×2 on a crit.
// Hero: swing power 1, 1, 1.2, 1.5 along the combo (longest combo at the level), spin 1.6;
// spells use ATK' = round(ATK × 0.8 + 2L) and never miss or crit.
// Monster move powers (ai.ts): hopper 1.0, swooper 0.9, charger 1.4, spore 0.55 per tick,
// packWolf 1.0, spitter web 0.6 / bite 0.9, shieldGuard 1.3, boss 1.3 / 1.1 / 0.8.
let seed = 20260925;
const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const dmg = (p, atk, def) => Math.max(1, Math.round(p * atk * atk / Math.max(1, atk + def) * (0.9 + 0.2 * rnd())));
const MOVES = {
  hopper: [["lunge", 1.0]], swooper: [["swoop", 0.9]], charger: [["charge", 1.4]], spore: [["spore", 0.55]],
  packWolf: [["lunge", 1.0]], spitter: [["web", 0.6], ["bite", 0.9]], shieldGuard: [["swing", 1.3]],
  boss: [["charge", 1.3], ["thorns", 1.1], ["webs", 0.8]], dummy: [],
};
function heroAt(level, gear) {
  const s = { ...statsAt(level) };
  for (const g of gear) for (const [k, v] of Object.entries(GEAR[g].mods)) s[k] += v;
  return s;
}
const EARLY_KIT = ["clothHood", "clothTunic", "clothShoes", "wornBlade"];
const BOAR_KIT = ["boarCap1", "boarVest1", "boarBoots1", "ironSword"];
/** Expected hero at each matchup: level from the XP path below, gear the player can afford then. */
const PROFILES = [
  { mon: "mossling", level: 1, gear: EARLY_KIT, where: "Southfold" },
  { mon: "duskbat", level: 2, gear: EARLY_KIT, where: "Southfold" },
  { mon: "bristleboar", level: 3, gear: ["leatherCap1", "clothTunic", "clothShoes", "wornBlade"], where: "Southfold" },
  { mon: "sporecap", level: 4, gear: ["leatherCap2", "leatherVest1", "clothShoes", "wornBlade"], where: "Southfold east" },
  { mon: "oldTusk", level: 5, gear: ["leatherCap2", "leatherVest1", "leatherBoots1", "wornBlade"], where: "bounty", hits: [7, 13] },
  { mon: "greywolf", level: 5, gear: ["leatherCap2", "leatherVest1", "leatherBoots1", "wornBlade"], where: "Mossgloam" },
  { mon: "greywolf", level: 6, gear: ["leatherCap2", "leatherVest2", "leatherBoots1", "wornBlade"], where: "grove wave" },
  { mon: "webspinner", level: 7, gear: BOAR_KIT, where: "Mossgloam, Barrow" },
  { mon: "barrowGuard", level: 8, gear: BOAR_KIT, where: "Barrow (flanked)" },
  { mon: "thornling", level: 9, gear: BOAR_KIT, where: "boss brood", hits: [1, 3] },
  { mon: "thornmother", level: 9, gear: BOAR_KIT, where: "boss", hits: null },
];
function swingsToKill(h, level, m, N = 3000) {
  const ladder = [1, 1, 1.2, 1.5].slice(0, comboAt(level));
  const miss = clamp(0.04 + 0.1 * (m.spd - h.spd) / h.spd, 0, 0.45);
  const crit = clamp(0.05 + 0.1 * (h.spd - m.spd) / m.spd, 0.02, 0.35);
  const n = [];
  for (let t = 0; t < N; t++) {
    let hp = m.hp, k = 0;
    while (hp > 0 && k < 999) { const p = ladder[k % ladder.length]; k++; if (rnd() < miss) continue; hp -= dmg(p, h.atk, m.def) * (rnd() < crit ? 2 : 1); }
    n.push(k);
  }
  n.sort((a, b) => a - b);
  return { mean: n.reduce((a, b) => a + b, 0) / N, p10: n[Math.floor(N * 0.1)], p90: n[Math.floor(N * 0.9)], miss, crit };
}
const meanDmg = (p, atk, def, N = 3000) => { let s = 0; for (let i = 0; i < N; i++) s += dmg(p, atk, def); return s / N; };
const rows = [];
let bossRow = null;
for (const pr of PROFILES) {
  const def = MONSTERS[pr.mon];
  if (!def) continue;
  const m = monsterStats(def), h = heroAt(pr.level, pr.gear);
  const k = swingsToKill(h, pr.level, m);
  const heroMiss = clamp(0.04 + 0.1 * (h.spd - m.spd) / m.spd, 0, 0.45);
  const moves = MOVES[def.behaviour].map(([name, p]) => {
    const now = meanDmg(p, m.atk, h.def), withPower = meanDmg(p * (MONSTER_POWER[pr.mon] ?? 1), m.atk, h.def);
    return { name, now, nowPct: 100 * now / h.hp, withPower, pct: 100 * withPower / h.hp };
  });
  const row = { ...pr, h, m, k, heroMiss, moves };
  rows.push(row);
  if (pr.mon === "thornmother") bossRow = row;
  const band = pr.hits === undefined ? [2, 4.2] : pr.hits;
  if (band && !(k.mean >= band[0] && k.mean <= band[1])) err("balance", `${pr.mon} @L${pr.level}: ${k.mean.toFixed(1)} swings to kill (want ${band[0]}–${band[1]})`);
  const main = moves[0];
  const pctBand = def.boss ? [8, 16] : def.elite ? [8, 16] : pr.mon === "thornling" ? [3, 8] : [5.5, 12.5];
  if (main && !(main.pct >= pctBand[0] && main.pct <= pctBand[1])) err("balance", `${pr.mon} @L${pr.level}: ${main.name} takes ${main.pct.toFixed(1)}% of max HP with MONSTER_POWER (want ${pctBand[0]}–${pctBand[1]}%)`);
}
// Boss fight length: sustained swing rate while dodging and repositioning, plus the MP budget
// spent on Ember Bolts (L9 MP pool, no Traveler's Knot).
let bossTime = null;
if (bossRow) {
  const { h, m, k, level } = bossRow;
  const perSwing = m.hp / k.mean;
  const matk = Math.round(h.atk * 0.8 + level * 2);
  const bolt = meanDmg(SPELLS.emberBolt.power, matk, m.def);
  const bolts = Math.floor(h.mp / SPELLS.emberBolt.mp);
  const spellDmg = bolt * bolts;
  bossTime = [0.75, 0.9, 1.1].map(rate => Math.max(0, m.hp - spellDmg) / (perSwing * rate) + bolts * 0.3);
  if (!(bossTime[1] >= 45 && bossTime[1] <= 90)) err("balance", `Thornmother takes ${bossTime[1].toFixed(0)} s at 0.9 swings/s (want 45–90 s)`);
  bossRow.spell = { bolt, bolts, spellDmg };
}
// Grove wave: five greywolves at L6. Wolves circle out of sword reach and at most two lunge at
// once (ai.ts), so most hero swings are trades against a lunge: about one lunge per swing, half of
// them dodged or rolled through, two attackers per ~2.4 s cycle.
let groveEst = null;
const gw = rows.find(r => r.mon === "greywolf" && r.level === 6);
if (gw) {
  const swings = 5 * gw.k.mean;
  const seconds = swings * 1.2;
  const landed = swings * 0.5 * (1 - gw.heroMiss);
  groveEst = { swings, seconds, taken: landed * gw.moves[0].withPower, takenNow: landed * gw.moves[0].now, hp: gw.h.hp };
  const share = groveEst.taken / groveEst.hp;
  if (!(share >= 0.5 && share <= 1.6)) err("balance", `grove wave takes ${(100 * share).toFixed(0)}% of max HP (want a real fight: 50–160%, i.e. herbs)`);
}
// XP path: planned kills and quests along the chapter (see monsters.ts header).
const PATH = [
  { at: "Southfold, first 10 min", kills: { mossling: 10, duskbat: 4, bristleboar: 3 }, quests: ["feverroot", "bountyMoss"], want: [4, 4] },
  { at: "Southfold done", kills: { bristleboar: 4, sporecap: 4, duskbat: 3, mossling: 4 }, quests: ["lostLamb", "bountyTusk"], extra: { oldTusk: 1 }, want: [5, 6] },
  { at: "Mossgloam, reaching the grove", kills: { greywolf: 4, sporecap: 3, duskbat: 2 }, quests: [], want: [5, 6] },
  { at: "grove wave cleared", kills: { greywolf: 5 }, quests: [], want: [6, 7] },
  { at: "Mossgloam done", kills: { greywolf: 4, webspinner: 3, duskbat: 3 }, quests: ["fishersRod", "bakersRound"], want: [7, 8] },
  { at: "Barrow, before the boss", kills: { webspinner: 6, barrowGuard: 6, duskbat: 4 }, quests: [], want: [8, 9] },
  { at: "Chapter clear", kills: { thornmother: 1, thornling: 8 }, quests: ["wellSpirit", "wardstone"], want: [9, 10] },
];
let xp = 0;
const levelOf = x => { let L = 1; while (L < LEVEL_CAP && x >= xpTotalTo(L + 1)) L++; return L; };
const pathRows = [];
for (const p of PATH) {
  for (const [id, n] of Object.entries({ ...p.kills, ...(p.extra ?? {}) })) xp += (MONSTERS[id]?.xp ?? 0) * n;
  for (const q of p.quests) xp += QUESTS[q]?.reward.xp ?? 0;
  const L = levelOf(xp);
  pathRows.push({ at: p.at, xp, L });
  if (!(L >= p.want[0] && L <= p.want[1])) err("balance", `XP path: level ${L} at "${p.at}" (want ${p.want[0]}–${p.want[1]})`);
}

// ─── Output ─────────────────────────────────────────────────────────────────────────────────────
const pad = (s, n) => String(s).padEnd(n);
if (SHOW_BALANCE || !QUIET) {
  console.log("\nBalance (sim math; 'now' = the sim's move powers, 'pow' = with MONSTER_POWER):");
  console.log(pad("monster", 13) + pad("hero", 30) + pad("monster HP/A/D/S", 18) + pad("swings (p10-p90)", 18) + "hit taken now → pow (% max HP)");
  for (const r of rows) {
    const hero = `L${r.level} A${r.h.atk} D${r.h.def} S${r.h.spd} HP${r.h.hp}`;
    const mon = `${r.m.hp}/${r.m.atk}/${r.m.def}/${r.m.spd}`;
    const sw = `${r.k.mean.toFixed(1)} (${r.k.p10}-${r.k.p90})`;
    const t = r.moves.map(x => `${x.name} ${x.now.toFixed(1)}→${x.withPower.toFixed(1)} (${x.nowPct.toFixed(0)}→${x.pct.toFixed(0)}%)`).join(", ");
    console.log(pad(r.mon, 13) + pad(hero, 30) + pad(mon, 18) + pad(sw, 18) + t);
  }
  if (bossTime) console.log(`Thornmother: ${bossRow.m.hp} HP, ${bossRow.k.mean.toFixed(0)} swings; ${bossRow.spell.bolts} Ember Bolts ≈ ${bossRow.spell.spellDmg.toFixed(0)} dmg; fight ≈ ${bossTime.map(t => t.toFixed(0)).join(" / ")} s at 0.75 / 0.9 / 1.1 swings/s`);
  if (groveEst) console.log(`Grove wave (5 greywolves @L6): ~${groveEst.swings.toFixed(0)} swings, ~${groveEst.seconds.toFixed(0)} s, takes ~${groveEst.taken.toFixed(0)} HP with MONSTER_POWER (${groveEst.takenNow.toFixed(0)} now) of ${groveEst.hp}`);
  console.log("XP path: " + pathRows.map(p => `${p.at}: ${p.xp} XP → L${p.L}`).join(" · "));
  const cost = ids => ids.reduce((s, i) => s + (GEAR[i]?.price ?? 0), 0);
  console.log(`Gear cost: leather I set ${cost(["leatherCap1", "leatherVest1", "leatherBoots1"])} g, boar I set ${cost(["boarCap1", "boarVest1", "boarBoots1"])} g, Iron Sword ${GEAR.ironSword.price} g; side-quest gold ${Object.values(QUESTS).filter(q => q.kind !== "main").reduce((s, q) => s + (q.reward.gold ?? 0), 0)} g, chest gold ${Object.values(CONTENT_CHESTS).filter(c => c.loot.kind === "gold").reduce((s, c) => s + c.loot.amount, 0)} g, sell rate ${sellPrice("leatherVest1")}/${GEAR.leatherVest1.price}`);
}
const nDialog = Object.keys(DIALOG).length;
console.log(`\ncontent-check: ${Object.keys(NPCS).length} NPCs, ${nDialog} dialogs (${lineCount} lines, ${heroTokens} with ${HERO_TOKEN}, ${reached.size} reachable), ${Object.keys(QUESTS).length} quests, ${Object.keys(GEAR).length} gear, ${Object.keys(CONSUMABLES).length} consumables, ${Object.keys(KEY_ITEMS).length} key items, ${Object.keys(MONSTERS).length} monsters, ${Object.keys(SHOPS).length} shops; maps: ${MAP_IDS.length - STUB_MAPS.length}/${MAP_IDS.length} built`);
console.log(`${errors} error(s), ${warnings} warning(s)${pendingProps.length ? `; sign/inspect dialogs waiting for prop ids: ${pendingProps.join(", ")}` : ""}`);
process.exit(errors ? 1 : 0);
