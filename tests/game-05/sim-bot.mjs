// Headless bot that plays Chapter One through the real simulation.
//   node --import tsx tests/game-05/sim-bot.mjs [--seeds 1,2,3] [--minutes 90] [--verbose] [--sides]
// It walks with A* over the collision map, talks, opens chests, fights (with dodges and herbs),
// grinds when the next fight is above its level, and follows the main quest to the chapter clear.
// Prints a timeline per seed and exits 1 if any seed fails to clear the chapter.
const { Sim, newSave } = await import("../../lib/game-05/sim/sim.ts");
const { MAPS } = await import("../../lib/game-05/content/maps/index.ts");
const { QUESTS } = await import("../../lib/game-05/content/quests.ts");
const { MONSTERS } = await import("../../lib/game-05/content/monsters.ts");
const { CONSUMABLES, GEAR } = await import("../../lib/game-05/content/items.ts");
const { SHOPS, SHOP_UNLOCKS } = await import("../../lib/game-05/content/shops.ts");
const TILE = 32, DT = 1 / 60;
const args = process.argv.slice(2);
const seeds = (args.includes("--seeds") ? args[args.indexOf("--seeds") + 1] : "1,2,3").split(",").map(Number);
const minutes = args.includes("--minutes") ? Number(args[args.indexOf("--minutes") + 1]) : 90;
const verbose = args.includes("--verbose");
const doSides = args.includes("--sides");

const none = () => ({ attack: false, magic: false, dodge: false, item: false, nextSpell: false, map: false, status: false, pause: false });

// Navigation grid at 8 px: a cell is open when a hero-sized circle fits at its centre at the
// cell's own ground height. Moves between cells of different heights need a stairs cell.
const CELL = 8;
const navCache = new Map();
function navGrid(sim) {
  const col = sim.col;
  const key = `${sim.map.id}:${sim.gatesOpen.size}:${sim.removed.size}`;
  const hit = navCache.get(sim.map.id);
  if (hit && hit.key === key) return hit;
  const W = col.width * TILE / CELL, H = col.height * TILE / CELL;
  const open = new Uint8Array(W * H), lvl = new Uint8Array(W * H), stairs = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const px = (x + 0.5) * CELL, py = (y + 0.5) * CELL;
    const t = col.tileAt(px, py);
    const st = col.isStairs(t.x, t.y);
    const lv = col.heightAt(px, py);
    const b = { x: px, y: py, level: lv };
    col.resolve(b, 6.5);
    const i = y * W + x;
    open[i] = Math.hypot(b.x - px, b.y - py) < 0.75 && !col.tileBlocked(t.x, t.y, lv, st) ? 1 : 0;
    lvl[i] = lv; stairs[i] = st ? 1 : 0;
  }
  const grid = { key, W, H, open, lvl, stairs };
  navCache.set(sim.map.id, grid);
  return grid;
}

/** A* from world px to world px; returns a list of world-px waypoints or null. */
function astarPx(sim, ax, ay, bx, by) {
  const g = navGrid(sim);
  const { W, H, open, lvl, stairs } = g;
  const cx = v => Math.max(0, Math.min(W - 1, Math.floor(v / CELL))), cy = v => Math.max(0, Math.min(H - 1, Math.floor(v / CELL)));
  let s = cy(ay) * W + cx(ax), goal = cy(by) * W + cx(bx);
  // Snap start/goal to the nearest open cell.
  const snap = (i) => {
    if (open[i]) return i;
    const x0 = i % W, y0 = Math.floor(i / W);
    for (let r = 1; r < 6; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const x = x0 + dx, y = y0 + dy;
      if (x >= 0 && y >= 0 && x < W && y < H && open[y * W + x]) return y * W + x;
    }
    return i;
  };
  s = snap(s); goal = snap(goal);
  const gs = new Float64Array(W * H).fill(Infinity), came = new Int32Array(W * H).fill(-1);
  const heap = [[0, s]]; gs[s] = 0;
  const gx = goal % W, gy = Math.floor(goal / W);
  const push = (f, i) => { heap.push([f, i]); let k = heap.length - 1; while (k > 0) { const p = (k - 1) >> 1; if (heap[p][0] <= heap[k][0]) break; [heap[p], heap[k]] = [heap[k], heap[p]]; k = p; } };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let k = 0; for (;;) { const l = 2 * k + 1, r = l + 1; let m = k; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === k) break; [heap[m], heap[k]] = [heap[k], heap[m]]; k = m; } } return top; };
  let n = 0;
  while (heap.length && n++ < 400000) {
    const [, cur] = pop();
    if (cur === goal) break;
    const x = cur % W, y = Math.floor(cur / W);
    for (const [dx, dy, c] of [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.414], [1, -1, 1.414], [-1, 1, 1.414], [-1, -1, 1.414]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const ni = ny * W + nx;
      if (!open[ni]) continue;
      if (dx && dy && (!open[y * W + nx] || !open[ny * W + x])) continue;
      if (lvl[ni] !== lvl[cur] && !stairs[ni] && !stairs[cur]) continue;
      const ng = gs[cur] + c;
      if (ng < gs[ni]) { gs[ni] = ng; came[ni] = cur; push(ng + Math.hypot(nx - gx, ny - gy), ni); }
    }
  }
  if (gs[goal] === Infinity) return null;
  const path = [];
  for (let k = goal; k !== s && k >= 0; k = came[k]) path.push([(k % W + 0.5) * CELL, (Math.floor(k / W) + 0.5) * CELL]);
  path.reverse();
  return path;
}

function routeExit(from, to) {
  const prev = new Map(), seen = new Set([from]), q = [from];
  while (q.length) {
    const m = q.shift();
    if (m === to) break;
    for (const e of MAPS[m].entities) if (e.type === "exit" && !seen.has(e.to)) { seen.add(e.to); prev.set(e.to, { m, e }); q.push(e.to); }
  }
  if (!prev.has(to)) return null;
  let cur = to;
  for (;;) { const p = prev.get(cur); if (p.m === from) return p.e; cur = p.m; }
}

function npcMap(id) {
  for (const m of Object.values(MAPS)) { const e = m.entities.find(x => x.type === "npc" && x.id === id); if (e) return { map: m.id, x: e.x, y: e.y }; }
  return null;
}
function chestMap(id) {
  for (const m of Object.values(MAPS)) { const e = m.entities.find(x => x.type === "chest" && x.id === id); if (e) return { map: m.id, x: e.x, y: e.y }; }
  return null;
}
function spawnOf(id) {
  for (const m of Object.values(MAPS)) { const e = m.entities.find(x => x.type === "spawn" && x.id === id); if (e) return { map: m.id, x: e.x, y: e.y }; }
  return null;
}
function monsterSpawnMap(monster) {
  for (const m of Object.values(MAPS)) { const e = m.entities.find(x => x.type === "spawn" && x.monster === monster && !x.once); if (e) return { map: m.id, x: e.x, y: e.y }; }
  return null;
}

function run(seed) {
  const sim = new Sim(newSave("Bot", seed));
  const log = [];
  const say = (msg) => { const line = `${fmt(sim.s.playSeconds)} L${sim.s.level} hp${sim.s.hp} ${sim.map.id}: ${msg}`; log.push(line); if (verbose) console.log(`  [${seed}] ${line}`); };
  const ignore = new Map(), chase = new Map(), dmgLog = [];
  const origDrain = sim.drain.bind(sim);
  sim.drain = () => { const ev = origDrain(); for (const e of ev) if (e.t === "hit" && e.target === "hero") dmgLog.push(e.amount); return ev; };
  let bounce = false, path = null, pathFor = "", stuck = 0, lastPos = [0, 0], lastStep = "", grindUntil = 0, deaths = 0, ticks = 0, retryWalk = 0;
  const maxTicks = minutes * 60 * 60;
  let autosave = sim.durable();

  const goal = () => {
    const main = sim.s.quests.wardstone;
    if (!main) return null;
    const step = QUESTS.wardstone.steps.find(s => s.id === main);
    return step;
  };

  // What the bot is trying to reach now: {map, x, y, act:'talk'|'chest'|'reach'|'fight'|'dummy', id}
  const objective = () => {
    const step = goal();
    if (!step) return null;
    const g = step.goal;
    const lvlNeed = { grove: 5, barrow: 6, thorn: 8 }[step.id] ?? 0;
    if (sim.s.level < lvlNeed && grindUntil === 0) grindUntil = lvlNeed;
    if (grindUntil && sim.s.level >= grindUntil) grindUntil = 0;
    if (grindUntil) {
      const grindMap = sim.s.level < 4 ? "southfold" : "mossgloam";
      if (bounce && sim.map.id !== grindMap) { bounce = false; }
      if (!bounce && sim.map.id === grindMap) {
        const live = sim.actors.filter(a => a.kind === "monster" && !a.dead && !a.once && a.def !== "dummy" && a.mdef.level <= sim.s.level + 2 && !(ignore.get(a.id) > ticks));
        live.sort((a, b) => Math.hypot(a.x - sim.hero.x, a.y - sim.hero.y) - Math.hypot(b.x - sim.hero.x, b.y - sim.hero.y));
        if (live[0]) return { map: grindMap, x: live[0].x / TILE, y: live[0].y / TILE, act: "fight", id: "grind", actor: live[0].id };
        bounce = true;
      }
      if (bounce) {
        // Step out to a neighbouring map and come back so the spawns refill.
        const out = MAPS[grindMap].entities.find(e => e.type === "exit");
        return { map: out.to, x: out.at.x, y: out.at.y, act: "reach", id: "bounce" };
      }
      return { map: grindMap, x: MAPS[grindMap].spawn.x, y: MAPS[grindMap].spawn.y, act: "reach", id: "grindmap" };
    }
    // Shopping trips: an affordable upgrade at Hask, or low on herbs with gold to spare.
    if (!grindUntil && sim.s.equipped.weapon && step.id !== "dummy") {
      const want = upgradeWanted(sim);
      if (want) { const n = npcMap("hask"); if (n) return { ...n, act: "talk", id: "hask" }; }
      if ((sim.s.bag.herb ?? 0) < 3 && sim.s.gold >= 200) { const n = npcMap("tilda"); if (n) return { ...n, act: "talk", id: "tilda" }; }
    }
    if (step.id === "dress") return { ...chestMap("c_home_bed"), act: "chest", id: "c_home_bed" };
    if (step.id === "dummy") { for (const m of Object.values(MAPS)) { const e = m.entities.find(x => x.type === "spawn" && x.monster === "dummy"); if (e) return { map: m.id, x: e.x, y: e.y, act: "dummy", id: "dummy" }; } }
    if (step.id === "grove") { const s = spawnOf("groveWolves"); if (s) return { ...s, act: "fight", id: "groveWolves" }; }
    if (step.id === "barrow") return { ...chestMap("c_b1_key"), act: "chest", id: "c_b1_key" };
    if (step.id === "thorn") { for (const m of Object.values(MAPS)) { const e = m.entities.find(x => x.type === "spawn" && x.monster === "thornmother"); if (e) return { map: m.id, x: e.x, y: e.y, act: "fight", id: "boss" }; } }
    if (g.kind === "talk") { const n = npcMap(g.npc); if (n) return { ...n, act: "talk", id: g.npc }; }
    if (g.kind === "reach") return { map: g.map, x: g.x, y: g.y, act: "reach", id: "reach" };
    if (g.kind === "flag" && step.target && "map" in step.target) return { ...step.target, act: "reach", id: g.flag };
    return null;
  };

  while (ticks++ < maxTicks) {
    const input = { mx: 0, my: 0, pressed: none(), held: { attack: false } };
    const m = sim.modal.kind;
    if (m !== "none") {
      if (m === "dialog") {
        const d = sim.dialogView();
        if (d?.choices) { const i = d.choices.findIndex(c => /^(yes|take|accept|sure|rest|ok|i will|i'll|let)/i.test(c)); if (i > 0) for (let k = 0; k < i; k++) sim.menu("down"); }
        sim.menu("ok");
      } else if (m === "dead") {
        deaths++;
        { const b = sim.actors.find(a => a.mdef?.boss); const st = sim.stats(); const lings = sim.actors.filter(a => a.def === "thornling" && !a.dead).length;
          say(`died (${deaths}) gear ${Object.values(sim.s.equipped).join("/")} A${st.atk} D${st.def} S${st.spd} HP${st.hp} herbs ${sim.s.bag.herb ?? 0} tonic ${sim.s.bag.tonic ?? 0}` + (b ? ` boss ${b.hp}/${b.maxHp} ph${b.phase} A${b.st.atk} D${b.st.def} lings ${lings} hits ${JSON.stringify(dmgLog.slice(-12))}` : ` hits ${JSON.stringify(dmgLog.slice(-8))}`)); dmgLog.length = 0; }
        const restored = structuredClone(autosave); restored.stats.deaths = sim.s.stats.deaths;
        const fresh = new Sim(restored);
        Object.assign(sim, fresh); // swap state in place
        fresh.hero; sim.s.hp = Math.max(sim.s.hp, Math.ceil(sim.stats().hp * 0.5));
        path = null;
        if (deaths > 25) break;
      } else if (m === "clear") { say("CHAPTER CLEAR"); return { seed, ok: true, log, deaths, sim }; }
      else if (m === "shop") {
        // Buy the best affordable gear and a few herbs.
        shopping(sim, sim.modal.shop);
        sim.closeModal();
      } else sim.closeModal();
      sim.step(input, DT); sim.drain();
      const req = sim.takeSaveRequest(); if (req && req !== "clear") autosave = sim.durable();
      continue;
    }
    if (process.env.BOTDEBUG && ticks % 600 === 0) { const o = objective(); const hh = sim.hero; const near = sim.actors.filter(a => a.kind === "monster" && !a.dead && Math.hypot(a.x - hh.x, a.y - hh.y) < 200).map(a => `${a.def}:${a.state}:${a.aggro ? "A" : "-"}:${Math.round(Math.hypot(a.x - hh.x, a.y - hh.y))}`); say(`STATUS pos ${(hh.x / TILE).toFixed(1)},${(hh.y / TILE).toFixed(1)} st ${hh.state} obj ${o ? `${o.map}:${o.x?.toFixed?.(1)},${o.y?.toFixed?.(1)} ${o.act} ${o.id}` : "none"} grind ${grindUntil} bounce ${bounce} near ${near.join(" ")}`); }
    const step = goal();
    if (step && step.id !== lastStep) { say(`step ${step.id}`); lastStep = step.id; path = null; }
    if (!step) { say("no main quest?"); break; }
    const h = sim.hero;
    const st = sim.stats();
    // Heal.
    if (sim.s.hp < st.hp * 0.35 && (sim.s.bag.herb || sim.s.bag.tonic || sim.s.bag.elixir)) {
      sim.use(sim.s.bag.tonic ? "tonic" : sim.s.bag.herb ? "herb" : "elixir");
    }
    // Fight anything close and hostile.
    const foes = sim.actors.filter(a => a.kind === "monster" && !a.dead && a.def !== "dummy" && !(ignore.get(a.id) > ticks) && (a.aggro || Math.hypot(a.x - h.x, a.y - h.y) < 70));
    foes.sort((a, b) => Math.hypot(a.x - h.x, a.y - h.y) - Math.hypot(b.x - h.x, b.y - h.y));
    const foe = foes[0];
    const obj = objective();
    if (foe && Math.hypot(foe.x - h.x, foe.y - h.y) < (obj?.act === "fight" ? 400 : 110)) {
      const dx = foe.x - h.x, dy = foe.y - h.y, d = Math.hypot(dx, dy);
      const danger = ["windup", "attack"].includes(foe.state) && d < 70;
      if (danger && h.dodgeCd <= 0 && sim.rng.next() < 0.5) { input.mx = -dy / d; input.my = dx / d; input.pressed.dodge = true; }
      else if (d > 20 + foe.radius) {
        // Approach; if we make no progress, path around, and give up on foes we cannot reach.
        const fk = foe.id;
        chase.set(fk, (chase.get(fk) ?? 0) + 1);
        if ((chase.get(fk) ?? 0) > 60 * 8 && d > 30 + foe.radius) { ignore.set(fk, ticks + 60 * 20); chase.delete(fk); }
        if (Math.hypot(h.x - lastPos[0], h.y - lastPos[1]) < 0.3 && d > 40) {
          const fp = astarPx(sim, h.x, h.y, foe.x, foe.y);
          if (fp && fp[0]) { const wx = fp[0][0] - h.x, wy = fp[0][1] - h.y, wd = Math.hypot(wx, wy) || 1; input.mx = wx / wd; input.my = wy / wd; }
          else { ignore.set(fk, ticks + 60 * 20); }
        } else { input.mx = dx / d; input.my = dy / d; }
        lastPos = [h.x, h.y];
      }
      else {
        // Face and swing.
        input.mx = dx / d * 0.2; input.my = dy / d * 0.2;
        if (ticks % 9 === 0) input.pressed.attack = true;
        if (sim.s.spell && sim.s.mp >= 8 && foe.mdef?.boss && ticks % 60 === 0) input.pressed.magic = true;
      }
      sim.step(input, DT); sim.drain();
      const req = sim.takeSaveRequest(); if (req && req !== "clear") autosave = sim.durable();
      continue;
    }
    if (!obj) { say(`no objective for ${step.id}`); break; }
    // Map routing.
    let tx = obj.x, ty = obj.y, finalHere = obj.map === sim.map.id;
    if (!finalHere) {
      const exit = routeExit(sim.map.id, obj.map);
      if (!exit) { say(`no route ${sim.map.id} -> ${obj.map}`); break; }
      tx = exit.x + exit.w / 2; ty = exit.y + exit.h / 2;
    }
    // Arrived?
    const hx = h.x / TILE, hy = h.y / TILE;
    const dist = Math.hypot(tx - hx, ty - hy);
    if (finalHere) {
      if (obj.act === "talk" || obj.act === "chest") {
        const it = sim.interactable();
        if (it && ((obj.act === "talk" && it.kind === "npc" && it.id === obj.id) || (obj.act === "chest" && it.kind === "chest" && it.id === obj.id))) {
          input.pressed.attack = true; sim.step(input, DT); sim.drain(); path = null; continue;
        }
        if (obj.act === "talk") { const a = sim.actors.find(x => x.def === obj.id); if (a) { tx = a.x / TILE; ty = a.y / TILE; } }
        if (dist < 1.2) {
          const ax = tx * TILE - h.x, ay = ty * TILE - h.y, ad = Math.hypot(ax, ay) || 1;
          input.mx = ax / ad; input.my = ay / ad;
          if (++retryWalk % 40 === 0) { input.mx = (sim.rng.next() - 0.5) * 2; input.my = (sim.rng.next() - 0.5) * 2; }
          sim.step(input, DT); sim.drain(); continue;
        }
      } else if (obj.act === "dummy") {
        const a = sim.actors.find(x => x.def === "dummy");
        if (a) {
          const dx = a.x - h.x, dy = a.y - h.y, d = Math.hypot(dx, dy);
          if (d < 26) { input.mx = dx / d * 0.2; input.my = dy / d * 0.2; if (ticks % 12 === 0) input.pressed.attack = true; sim.step(input, DT); sim.drain(); continue; }
          tx = a.x / TILE; ty = a.y / TILE;
        }
      } else if (obj.act === "reach" && dist < 0.8) { if (obj.id === "bounce") bounce = false; sim.step(input, DT); sim.drain(); continue; }
      else if (obj.act === "fight" && obj.id !== "grind" && dist < 1.5) {
        // Wander the spot to find monsters.
        input.mx = Math.cos(ticks / 90); input.my = Math.sin(ticks / 70);
        sim.step(input, DT); sim.drain(); continue;
      }
    }
    // Path.
    const key = `${sim.map.id}:${Math.floor(tx * 4)},${Math.floor(ty * 4)}`;
    if (!path || pathFor !== key || ticks % 120 === 0) {
      path = astarPx(sim, h.x, h.y, tx * TILE, ty * TILE);
      // Talk and chest targets behind counters or props: walk to a reachable spot in reach.
      if (!path && finalHere && (obj.act === "talk" || obj.act === "chest")) {
        for (const [ox, oy] of [[0, 1.3], [0, 1.8], [-1, 1.3], [1, 1.3], [0, -1.3], [-1.3, 0], [1.3, 0], [0, 2.3]]) {
          path = astarPx(sim, h.x, h.y, (tx + ox) * TILE, (ty + oy) * TILE);
          if (path) { tx += ox; ty += oy; break; }
        }
      }
      pathFor = key;
      if (!path) {
        if (obj.act === "fight" && obj.actor) { ignore.set(obj.actor, ticks + 60 * 60); say(`skip unreachable ${obj.id} at ${key}`); sim.step(input, DT); sim.drain(); continue; }
        say(`no path to ${key} from ${hx.toFixed(1)},${hy.toFixed(1)}`); break;
      }
    }
    while (path.length && Math.hypot(path[0][0] - h.x, path[0][1] - h.y) < 5) path.shift();
    if (process.env.BOTDEBUG && ticks % 600 === 0) say(`at ${hx.toFixed(1)},${hy.toFixed(1)} lvl ${h.level} target ${tx.toFixed(1)},${ty.toFixed(1)} path ${path.length} next ${JSON.stringify(path[0])} stuck ${stuck}`);
    // Last stretch into an exit: steer straight at the exit centre (doors are narrower than a tile).
    if (!finalHere && path.length <= 2 && Math.hypot(tx - hx, ty - hy) < 2.2) { const ax = tx * TILE - h.x, ay = ty * TILE - h.y, ad = Math.hypot(ax, ay) || 1; input.mx = ax / ad; input.my = ay / ad; sim.step(input, DT); sim.drain(); const rq = sim.takeSaveRequest(); if (rq && rq !== "clear") autosave = sim.durable(); continue; }
    const wp = path[0] ?? [tx * TILE, ty * TILE];
    const wx = wp[0] - h.x, wy = wp[1] - h.y, wd = Math.hypot(wx, wy) || 1;
    input.mx = wx / wd; input.my = wy / wd;
    if (Math.hypot(h.x - lastPos[0], h.y - lastPos[1]) < 0.2) stuck++; else stuck = 0;
    lastPos = [h.x, h.y];
    if (stuck > 90) { input.mx = (sim.rng.next() - 0.5) * 2; input.my = (sim.rng.next() - 0.5) * 2; if (stuck > 180) { path = null; stuck = 0; } }
    // Cut grass on the way now and then (loot and feverroot).
    if (ticks % 40 === 0) input.pressed.attack = sim.s.equipped.weapon ? sim.interactable() == null : false;
    sim.step(input, DT); sim.drain();
    const req = sim.takeSaveRequest(); if (req && req !== "clear") { autosave = sim.durable(); if (sim.map.id === "larkmoor" && sim.s.gold > 150) visitSmith(sim); }
  }
  say("TIMEOUT or stopped");
  return { seed, ok: false, log, deaths, sim };
}

function shopping(sim, shopId) {
  const shop = SHOPS[shopId];
  if (!shop) return;
  if (shop.kind === "arms") {
    // Best affordable upgrade per slot, most valuable slot first.
    for (const slot of ["weapon", "body", "head", "boots"]) {
      const cur = sim.s.equipped[slot] ? GEAR[sim.s.equipped[slot]] : null;
      const score = g => (g.mods.atk ?? 0) * 2 + (g.mods.def ?? 0) * 2 + (g.mods.spd ?? 0) + (g.mods.hp ?? 0) * 0.3;
      const options = shop.stock.map(id => GEAR[id]).filter(g => g && g.slot === slot && g.price != null && g.price <= sim.s.gold - 40 && score(g) > (cur ? score(cur) : -1) && (!SHOP_UNLOCKS[g.id] || sim.cond(SHOP_UNLOCKS[g.id])));
      options.sort((a, b) => score(b) - score(a));
      if (options[0] && !sim.buy(shopId, options[0].id)) sim.equip(options[0].id);
    }
  } else {
    for (let i = 0; i < 6 && (sim.s.bag.herb ?? 0) < 6 && sim.s.gold >= 60; i++) sim.buy(shopId, "herb");
    if (sim.s.gold > 600 && (sim.s.bag.tonic ?? 0) < 2) sim.buy(shopId, "tonic");
  }
}

/** An upgrade at Hask's worth a trip to town (affordable with 40 g to spare). */
function upgradeWanted(sim) {
  const shop = SHOPS.haskShop;
  if (!shop) return null;
  const score = g => (g.mods.atk ?? 0) * 2 + (g.mods.def ?? 0) * 2 + (g.mods.spd ?? 0) + (g.mods.hp ?? 0) * 0.3;
  for (const slot of ["weapon", "body", "head", "boots"]) {
    const cur = sim.s.equipped[slot] ? GEAR[sim.s.equipped[slot]] : null;
    const opt = shop.stock.map(id => GEAR[id]).find(g => g && g.slot === slot && g.price != null && g.price <= sim.s.gold - 40 && score(g) > (cur ? score(cur) + 1 : -1) && (!SHOP_UNLOCKS[g.id] || sim.cond(SHOP_UNLOCKS[g.id])));
    if (opt) return opt.id;
  }
  return null;
}

/** Buy the best armour and weapon the bot can afford (a visit to the smithy and the shop). */
function visitSmith(sim) {
  for (const id of Object.keys(SHOPS)) shopping(sim, id);
}

function fmt(s) { return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`; }

let failed = 0;
for (const seed of seeds) {
  const t0 = Date.now();
  const r = run(seed);
  const s = r.sim.s;
  console.log(`seed ${seed}: ${r.ok ? "CLEAR" : "FAILED"} in ${fmt(s.playSeconds)} play, L${s.level}, ${s.gold} g, deaths ${r.deaths}, kills ${s.stats.kills}, grass ${s.stats.grass} (${((Date.now() - t0) / 1000).toFixed(1)} s real)`);
  if (!r.ok) { failed++; console.log(r.log.slice(-25).map(l => "   " + l).join("\n")); }
  else if (!verbose) console.log(r.log.filter(l => l.includes("step")).map(l => "   " + l).join("\n"));
}
process.exit(failed ? 1 : 0);
