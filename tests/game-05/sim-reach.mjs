// Strict reachability using the sim's own CollisionMap (hero circle r=7, heights, stairs, doors).
// usage: node --import tsx reach.mjs <mapId...>
const { MAPS } = await import("../../lib/game-05/content/maps/index.ts");
const { CollisionMap } = await import("../../lib/game-05/sim/collision.ts");
const T = 32, STEP = 8, R = 7;
if (process.env.FIXSTAIRS) {
  // Proposed sim fix: a mover is "on stairs" while its circle overlaps any stairs tile, and its level
  // follows the ground after every sub-step that ends off the stairs.
  const P = CollisionMap.prototype;
  P.move = function (body, r, dx, dy, fly = false) {
    const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy) / 4));
    let hitWall = false;
    for (let s = 0; s < steps; s++) {
      body.x += dx / steps; if (this.resolve(body, r, fly)) hitWall = true;
      body.y += dy / steps; if (this.resolve(body, r, fly)) hitWall = true;
      const t = this.tileAt(body.x, body.y);
      if (!fly && !this.isStairs(t.x, t.y)) body.level = this.heightAt(body.x, body.y);
    }
    return { hitWall };
  };
  const pushOutRect = (body, r, rx, ry, rw, rh) => {
    const cx = Math.max(rx, Math.min(body.x, rx + rw)), cy = Math.max(ry, Math.min(body.y, ry + rh));
    const dx = body.x - cx, dy = body.y - cy, d2 = dx * dx + dy * dy;
    if (d2 >= r * r) return false;
    if (d2 > 1e-9) { const d = Math.sqrt(d2), push = r - d; body.x += dx / d * push; body.y += dy / d * push; return true; }
    const left = body.x - rx, right = rx + rw - body.x, up = body.y - ry, down = ry + rh - body.y, m = Math.min(left, right, up, down);
    if (m === left) body.x = rx - r; else if (m === right) body.x = rx + rw + r; else if (m === up) body.y = ry - r; else body.y = ry + rh + r;
    return true;
  };
  const pushOutCircle = (body, r, cx, cy, cr) => {
    const dx = body.x - cx, dy = body.y - cy, d = Math.hypot(dx, dy), min = r + cr;
    if (d >= min) return false;
    if (d < 1e-6) { body.y += min; return true; }
    body.x += dx / d * (min - d); body.y += dy / d * (min - d); return true;
  };
  P.resolve = function (body, r) {
    let touched = false;
    for (let pass = 0; pass < 3; pass++) {
      let moved = false;
      const x0 = Math.floor((body.x - r) / T), x1 = Math.floor((body.x + r) / T);
      const y0 = Math.floor((body.y - r) / T), y1 = Math.floor((body.y + r) / T);
      let onStairs = false;
      for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) if (this.isStairs(tx, ty)) onStairs = true;
      for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) {
        if (this.tileBlocked(tx, ty, body.level, onStairs) && pushOutRect(body, r, tx * T, ty * T, T, T)) { moved = true; touched = true; }
        const list = this.buckets.get(ty * 4096 + tx);
        if (list) for (const s of list) {
          if (s.kind === "rect" ? pushOutRect(body, r, s.x, s.y, s.w, s.h) : pushOutCircle(body, r, s.x, s.y, s.r)) { moved = true; touched = true; }
        }
      }
      if (!moved) break;
    }
    return touched;
  };
}
let bad = 0;
for (const id of process.argv.slice(2)) {
  const map = MAPS[id];
  const col = new CollisionMap(map);
  const W = map.ground[0].length * T, H = map.ground.length * T;
  const start = { x: map.spawn.x * T, y: map.spawn.y * T, level: col.heightAt(map.spawn.x * T, map.spawn.y * T) };
  col.resolve(start, R);
  const snap = v => Math.round(v / STEP) * STEP;
  const key = (x, y, l) => `${x},${y},${l}`;
  const seen = new Map();
  const q = [];
  const s0 = { x: snap(start.x), y: snap(start.y), level: start.level };
  { const b = { ...s0 }; col.resolve(b, R); if (Math.hypot(b.x - s0.x, b.y - s0.y) > 2) console.log(`WARN ${id}: spawn pushed`); }
  seen.set(key(s0.x, s0.y, s0.level), s0); q.push(s0);
  while (q.length) {
    const n = q.pop();
    for (const [dx, dy] of [[STEP, 0], [-STEP, 0], [0, STEP], [0, -STEP]]) {
      const b = { x: n.x, y: n.y, level: n.level };
      col.move(b, R, dx, dy);
      const tx = n.x + dx, ty = n.y + dy;
      if (Math.abs(b.x - tx) > 1.5 || Math.abs(b.y - ty) > 1.5) continue;
      if (tx < R || ty < R || tx > W - R || ty > H - R) continue;
      const k = key(tx, ty, b.level);
      if (seen.has(k)) continue;
      const nn = { x: tx, y: ty, level: b.level };
      seen.set(k, nn); q.push(nn);
    }
  }
  const nodes = [...seen.values()];
  const within = (x, y, r) => nodes.some(n => Math.hypot(n.x - x, n.y - y) <= r);
  const errs = [];
  for (const e of map.entities) {
    if (e.type === "npc") {
      const ok = within(e.x * T, e.y * T, 46 + (map.props.some(p => p.kind === "counter") ? 24 : 0) - 2);
      if (!ok) errs.push(`npc ${e.id} at ${e.x},${e.y} out of talk reach`);
    } else if (e.type === "chest") {
      // Interaction: front point (hero + facing*14/12 - 4) within 30 px of (chest.x, chest.y - 6)
      const ok = nodes.some(n => [[0, 1], [0, -1], [1, 0], [-1, 0]].some(([fx, fy]) => Math.hypot(e.x * T - (n.x + fx * 14), e.y * T - 6 - (n.y + fy * 12 - 4)) < 28));
      if (!ok) errs.push(`chest ${e.id} at ${e.x},${e.y} cannot be opened`);
    } else if (e.type === "exit") {
      const ok = nodes.some(n => n.x >= e.x * T && n.x < (e.x + e.w) * T && n.y >= e.y * T && n.y < (e.y + e.h) * T);
      if (!ok) errs.push(`exit to ${e.to} at ${e.x},${e.y} not enterable`);
      const tm = MAPS[e.to];
      if (tm) {
        const tc = new CollisionMap(tm);
        const b = { x: e.at.x * T, y: e.at.y * T, level: tc.heightAt(e.at.x * T, e.at.y * T) };
        tc.resolve(b, R);
        if (Math.hypot(b.x - e.at.x * T, b.y - e.at.y * T) > 2) errs.push(`exit to ${e.to}: landing ${e.at.x},${e.at.y} is pushed ${Math.round(Math.hypot(b.x - e.at.x * T, b.y - e.at.y * T))} px`);
        const inExit = tm.entities.some(x => x.type === "exit" && b.x >= x.x * T && b.x < (x.x + x.w) * T && b.y >= x.y * T && b.y < (x.y + x.h) * T);
        if (inExit) errs.push(`exit to ${e.to}: landing ${e.at.x},${e.at.y} is inside an exit`);
      }
    } else if (e.type === "spawn") {
      if (!within(e.x * T, e.y * T, 40)) errs.push(`spawn ${e.id} not reachable`);
    }
  }
  for (const p of map.props) {
    if (p.kind === "sign" || p.kind === "well") {
      const ok = nodes.some(n => [[0, 1], [0, -1], [1, 0], [-1, 0]].some(([fx, fy]) => Math.hypot(p.x * T - (n.x + fx * 14), p.y * T - 8 - (n.y + fy * 12 - 4)) < 34));
      if (!ok) errs.push(`${p.kind} ${p.id} at ${p.x},${p.y} cannot be read`);
    }
  }
  const tiles = new Set(nodes.map(n => `${Math.floor(n.x / T)},${Math.floor(n.y / T)}`));
  console.log(`${errs.length ? "FAIL" : "ok  "} ${id}: ${nodes.length} nodes, ${tiles.size} tiles reachable`);
  for (const m of errs) console.log("   - " + m);
  bad += errs.length;
  if (process.env.DUMP) {
    const fs = await import("node:fs");
    fs.writeFileSync(`${process.env.DUMP}/${id}-reach.json`, JSON.stringify([...tiles]));
  }
}
process.exit(bad ? 1 : 0);
