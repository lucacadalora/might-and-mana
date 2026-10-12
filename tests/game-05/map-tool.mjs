// Game 05 map checker and previewer.
//   node --import tsx tests/game-05/map-tool.mjs [mapId ...|all] [--png DIR] [--scale N]
// Checks: row lengths, ground chars, height rows, entity bounds, exits land on walkable tiles of
// the target map, spawn points walkable, every NPC/chest/exit/spawn reachable from the map spawn
// (flood fill over walkable tiles minus solid prop footprints; gates count as open), stateful
// props have ids, ids are unique. Writes a PNG per map (tiles coloured by material, height
// shading, prop footprints, entity markers) when --png is given. Exit code 1 on any error.
import { writeFileSync, mkdirSync } from "node:fs";
import { PNG } from "pngjs";

const { MAPS } = await import("../../lib/game-05/content/maps/index.ts");
const { PROPS, SOLID_GROUND } = await import("../../lib/game-05/content/props.ts");
const TILE = 32;
const GROUND = "gGdcswWftkm#Hxb";
const COLORS = {
  g: [96, 150, 70], G: [66, 112, 52], d: [150, 112, 72], c: [168, 160, 146], s: [222, 202, 150], w: [92, 150, 196],
  W: [40, 84, 150], f: [150, 104, 62], t: [120, 118, 126], k: [88, 80, 76], m: [98, 82, 58], "#": [48, 44, 48],
  H: [120, 60, 50], x: [0, 0, 0], b: [170, 124, 70],
};

const args = process.argv.slice(2);
const pngDir = args.includes("--png") ? args[args.indexOf("--png") + 1] : null;
const scale = args.includes("--scale") ? Number(args[args.indexOf("--scale") + 1]) : 8;
const wanted = args.filter((a, i) => !a.startsWith("--") && !["--png", "--scale"].includes(args[i - 1]));
const ids = !wanted.length || wanted.includes("all") ? Object.keys(MAPS) : wanted;

let errors = 0;
const err = (map, msg) => { errors++; console.log(`ERROR ${map}: ${msg}`); };
const warn = (map, msg) => console.log(`warn  ${map}: ${msg}`);

function blocked(map) {
  const H = map.ground.length, W = map.ground[0].length;
  const grid = Array.from({ length: H }, (_, y) => Array.from({ length: W }, (_, x) => SOLID_GROUND.has(map.ground[y][x])));
  // Height: the south edge of a higher tile is a cliff face; moving between different heights is
  // only allowed through a stairs prop. We block tiles whose height differs from the tile below
  // along the edge row (approximation: cliff tiles = higher tiles whose south neighbour is lower).
  if (map.height) for (let y = 0; y < H - 1; y++) for (let x = 0; x < W; x++) {
    if (map.height[y][x] > map.height[y + 1][x]) grid[y][x] = true;
  }
  for (const p of map.props) {
    const def = PROPS[p.kind];
    if (!def?.solid) continue;
    const s = def.solid;
    const rect = "r" in s ? { x: -s.r, y: -s.r, w: 2 * s.r, h: 2 * s.r } : s;
    const x0 = Math.floor((p.x * TILE + rect.x) / TILE), x1 = Math.floor((p.x * TILE + rect.x + rect.w - 1) / TILE);
    const y0 = Math.floor((p.y * TILE + rect.y) / TILE), y1 = Math.floor((p.y * TILE + rect.y + rect.h - 1) / TILE);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (grid[y]?.[x] !== undefined) grid[y][x] = true;
  }
  // Stairs props open cliffs and anything under them.
  for (const p of map.props) if (p.kind === "stairsUp" || p.kind === "stairsDown") {
    const tx = Math.floor(p.x), ty = Math.floor(p.y - 0.01);
    for (const [dx, dy] of [[0, 0], [0, -1]]) if (grid[ty + dy]?.[tx + dx] !== undefined) grid[ty + dy][tx + dx] = false;
  }
  // Doors of buildings are walkable (the exit sits on them).
  for (const p of map.props) { const d = PROPS[p.kind]?.door; if (d) { const tx = Math.floor(p.x + d.x / TILE), ty = Math.floor(p.y + d.y / TILE - 0.01); if (grid[ty]?.[tx] !== undefined) grid[ty][tx] = false; } }
  return grid;
}

function flood(grid, sx, sy) {
  const H = grid.length, W = grid[0].length;
  const seen = Array.from({ length: H }, () => new Uint8Array(W));
  const q = [[sx, sy]];
  if (grid[sy]?.[sx] === false) seen[sy][sx] = 1; else return seen;
  while (q.length) {
    const [x, y] = q.pop();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H || seen[ny][nx] || grid[ny][nx]) continue;
      seen[ny][nx] = 1; q.push([nx, ny]);
    }
  }
  return seen;
}

function near(seen, x, y, r = 1) {
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (seen[Math.floor(y) + dy]?.[Math.floor(x) + dx]) return true;
  return false;
}

const allIds = new Map();
for (const id of ids) {
  const map = MAPS[id];
  if (!map) { err(id, "no such map"); continue; }
  if (map.id !== id) err(id, `map.id is ${map.id}`);
  const H = map.ground.length, W = map.ground[0]?.length ?? 0;
  map.ground.forEach((row, y) => {
    if (row.length !== W) err(id, `ground row ${y} has ${row.length} cols, expected ${W}`);
    for (const ch of row) if (!GROUND.includes(ch)) { err(id, `ground row ${y} has unknown char '${ch}'`); break; }
  });
  if (map.height) {
    if (map.height.length !== H) err(id, `height has ${map.height.length} rows, expected ${H}`);
    map.height.forEach((row, y) => { if (row.length !== W) err(id, `height row ${y} has ${row.length} cols`); if (!/^[0-3]*$/.test(row)) err(id, `height row ${y} has chars outside 0-3`); });
  }
  const inBounds = (x, y) => x >= 0 && y >= 0 && x <= W && y <= H;
  for (const p of map.props) {
    if (!PROPS[p.kind]) err(id, `unknown prop kind ${p.kind}`);
    if (!inBounds(p.x, p.y)) err(id, `prop ${p.kind} at ${p.x},${p.y} out of bounds`);
    const def = PROPS[p.kind];
    if ((def?.cut || def?.breaks || def?.interact) && !p.id) err(id, `stateful prop ${p.kind} at ${p.x},${p.y} needs an id`);
  }
  const grid = blocked(map);
  const seen = flood(grid, Math.floor(map.spawn.x), Math.floor(map.spawn.y - 0.01));
  if (grid[Math.floor(map.spawn.y - 0.01)]?.[Math.floor(map.spawn.x)] !== false) err(id, `spawn ${map.spawn.x},${map.spawn.y} is not walkable`);
  const localIds = new Set();
  const addId = (kind, eid) => {
    if (!eid) return;
    const key = `${kind}:${eid}`;
    if (localIds.has(key)) err(id, `duplicate ${kind} id ${eid}`);
    localIds.add(key);
    if (["chest", "npc", "spawn", "gate", "trigger"].includes(kind)) {
      if (allIds.has(key) && kind !== "npc") err(id, `${kind} id ${eid} also used in ${allIds.get(key)}`);
      allIds.set(key, id);
    }
  };
  for (const p of map.props) addId("prop", p.id);
  let counts = {};
  for (const e of map.entities) {
    counts[e.type] = (counts[e.type] ?? 0) + 1;
    addId(e.type, e.id);
    if (!inBounds(e.x, e.y)) err(id, `${e.type} ${e.id ?? ""} at ${e.x},${e.y} out of bounds`);
    if (["npc", "chest", "spawn", "exit", "follower"].includes(e.type)) {
      const cx = e.type === "exit" ? e.x + e.w / 2 : e.x, cy = e.type === "exit" ? e.y + e.h / 2 : e.y;
      if (!near(seen, cx, cy - 0.01, e.type === "exit" ? 1 : 1)) err(id, `${e.type} ${e.id ?? e.to ?? ""} at ${e.x},${e.y} is not reachable from spawn`);
    }
    if (e.type === "exit") {
      const target = MAPS[e.to];
      if (!target) { err(id, `exit to unknown map ${e.to}`); continue; }
      const tg = blocked(target);
      if (tg[Math.floor(e.at.y - 0.01)]?.[Math.floor(e.at.x)] !== false) err(id, `exit to ${e.to} lands on a blocked tile ${e.at.x},${e.at.y}`);
    }
  }
  const walk = seen.reduce((n, row) => n + row.reduce((a, b) => a + b, 0), 0);
  console.log(`ok    ${id}: ${W}x${H}, ${map.props.length} props, entities ${JSON.stringify(counts)}, ${walk} reachable tiles`);

  if (pngDir) {
    mkdirSync(pngDir, { recursive: true });
    const png = new PNG({ width: W * scale, height: H * scale });
    const put = (px, py, c, a = 255) => {
      if (px < 0 || py < 0 || px >= png.width || py >= png.height) return;
      const i = (py * png.width + px) * 4;
      png.data[i] = Math.round(png.data[i] * (1 - a / 255) + c[0] * a / 255);
      png.data[i + 1] = Math.round(png.data[i + 1] * (1 - a / 255) + c[1] * a / 255);
      png.data[i + 2] = Math.round(png.data[i + 2] * (1 - a / 255) + c[2] * a / 255);
      png.data[i + 3] = 255;
    };
    const rect = (x, y, w, h, c, a = 255) => { for (let py = Math.round(y); py < Math.round(y + h); py++) for (let px = Math.round(x); px < Math.round(x + w); px++) put(px, py, c, a); };
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      let c = COLORS[map.ground[y][x]] ?? [255, 0, 255];
      const h = map.height ? Number(map.height[y][x]) : 0;
      c = c.map(v => Math.min(255, v + h * 14));
      rect(x * scale, y * scale, scale, scale, c);
      if (!seen[y][x] && !grid[y][x]) rect(x * scale, y * scale, scale, scale, [255, 0, 0], 60);
      if (map.height && y + 1 < H && map.height[y][x] > map.height[y + 1][x]) rect(x * scale, (y + 1) * scale - Math.max(2, scale / 3), scale, Math.max(2, scale / 3), [60, 50, 40]);
    }
    const k = scale / TILE;
    for (const p of map.props) {
      const def = PROPS[p.kind]; if (!def) continue;
      const col = p.kind.includes("tree") || p.kind === "pine" ? [30, 80, 30] : ["grass", "bush", "reeds"].includes(p.kind) ? [150, 210, 90] : p.kind.match(/house|inn|hall|Hall/i) ? [170, 90, 60] : [230, 230, 230];
      if (def.solid) { const s = def.solid; const rr = "r" in s ? { x: -s.r, y: -s.r, w: 2 * s.r, h: 2 * s.r } : s; rect((p.x * TILE + rr.x) * k, (p.y * TILE + rr.y) * k, Math.max(1, rr.w * k), Math.max(1, rr.h * k), col, 220); }
      else rect(p.x * scale - 1, p.y * scale - 2, 3, 3, col);
    }
    const mark = { npc: [255, 230, 0], chest: [255, 140, 0], spawn: [230, 30, 30], exit: [0, 200, 255], trigger: [200, 0, 255], gate: [255, 60, 160], light: [255, 255, 180], follower: [255, 255, 255] };
    for (const e of map.entities) {
      const c = mark[e.type]; if (!c) continue;
      if (e.type === "exit" || e.type === "trigger" || e.type === "gate") rect(e.x * scale, e.y * scale, e.w * scale, e.h * scale, c, 150);
      else rect(e.x * scale - 3, e.y * scale - 3, 6, 6, c);
    }
    rect(map.spawn.x * scale - 4, map.spawn.y * scale - 4, 8, 8, [255, 255, 255]);
    writeFileSync(`${pngDir}/${id}.png`, PNG.sync.write(png));
  }
}
console.log(errors ? `FAILED with ${errors} errors` : "all maps ok");
process.exit(errors ? 1 : 0);
