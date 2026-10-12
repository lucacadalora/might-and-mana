import { TILE, type MapDef, type Rect } from "../contract";
import { PROPS, SLOW_GROUND, SOLID_GROUND } from "../content/props";

/** A solid shape in world px. */
export type Shape = { kind: "rect"; x: number; y: number; w: number; h: number; id?: string } | { kind: "circle"; x: number; y: number; r: number; id?: string };

/**
 * Static collision for one map: ground solids, height (tiles of another height are blocked
 * unless one side is a stairs tile; the south face of a raised area is solid), and prop
 * footprints. Dynamic shapes (closed gates, uncut bushes) are added by id and can be removed.
 */
export class CollisionMap {
  readonly width: number;
  readonly height: number;
  private readonly solid: Uint8Array;
  private readonly slow: Uint8Array;
  private readonly heights: Uint8Array;
  private readonly stairs: Uint8Array;
  /** Shapes bucketed per tile for quick queries. */
  private readonly buckets = new Map<number, Shape[]>();
  private readonly byId = new Map<string, Shape>();
  /** Doorway centres (px) of buildings, for the door-assist nudge. */
  readonly doors: Array<{ x: number; y: number }> = [];

  constructor(readonly map: MapDef) {
    const H = map.ground.length, W = map.ground[0]?.length ?? 0;
    this.width = W; this.height = H;
    this.solid = new Uint8Array(W * H);
    this.slow = new Uint8Array(W * H);
    this.heights = new Uint8Array(W * H);
    this.stairs = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const ch = map.ground[y][x];
      const i = y * W + x;
      if (SOLID_GROUND.has(ch)) this.solid[i] = 1;
      if (SLOW_GROUND.has(ch)) this.slow[i] = 1;
      this.heights[i] = map.height ? Number(map.height[y]?.[x] ?? 0) || 0 : 0;
    }
    if (map.height) for (let y = 0; y < H - 1; y++) for (let x = 0; x < W; x++) {
      if (this.heights[y * W + x] > this.heights[(y + 1) * W + x]) this.solid[y * W + x] = 1;
    }
    for (const p of map.props) {
      if (p.kind === "stairsUp" || p.kind === "stairsDown") {
        const tx = Math.floor(p.x), ty = Math.floor(p.y - 0.01);
        for (const dy of [0, -1]) {
          const yy = ty + dy;
          if (tx >= 0 && yy >= 0 && tx < W && yy < H) { this.stairs[yy * W + tx] = 1; this.solid[yy * W + tx] = SOLID_GROUND.has(map.ground[yy][tx]) ? 1 : 0; }
        }
      }
    }
    for (const p of map.props) {
      const def = PROPS[p.kind];
      if (!def?.solid) continue;
      const ax = p.x * TILE, ay = p.y * TILE;
      const s = def.solid;
      const shape: Shape = "r" in s
        ? { kind: "circle", x: ax, y: ay - s.r * 0.5, r: s.r, id: p.id }
        : { kind: "rect", x: ax + (p.flip ? -(s.x + s.w) : s.x), y: ay + s.y, w: s.w, h: s.h, id: p.id };
      this.add(shape);
    }
    // Building doors are always open.
    for (const p of map.props) {
      const door = PROPS[p.kind]?.door;
      if (!door) continue;
      const dx = p.x * TILE + door.x, dy = p.y * TILE + door.y;
      this.carve({ x: dx - 14, y: dy - 22, w: 28, h: 24 });
      this.doors.push({ x: dx, y: dy - 8 });
    }
  }

  /** Remove the part of any prop shape overlapping a doorway rect (keeps the rest solid). */
  private carve(hole: Rect) {
    for (const [key, list] of this.buckets) {
      const next: Shape[] = [];
      for (const s of list) {
        if (s.kind !== "rect" || !overlaps(s, hole)) { next.push(s); continue; }
        // Split into left and right parts around the hole (buildings: door on the bottom edge).
        if (hole.x > s.x) next.push({ ...s, w: hole.x - s.x });
        if (hole.x + hole.w < s.x + s.w) next.push({ ...s, x: hole.x + hole.w, w: s.x + s.w - hole.x - hole.w });
        if (hole.y > s.y) next.push({ ...s, x: Math.max(s.x, hole.x), w: Math.min(s.x + s.w, hole.x + hole.w) - Math.max(s.x, hole.x), h: hole.y - s.y });
      }
      this.buckets.set(key, next);
    }
  }

  add(shape: Shape) {
    const b = bounds(shape);
    const x0 = Math.floor(b.x / TILE), x1 = Math.floor((b.x + b.w) / TILE);
    const y0 = Math.floor(b.y / TILE), y1 = Math.floor((b.y + b.h) / TILE);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const key = y * 4096 + x;
      const list = this.buckets.get(key);
      if (list) list.push(shape); else this.buckets.set(key, [shape]);
    }
    if (shape.id) this.byId.set(shape.id, shape);
  }

  remove(id: string) {
    const shape = this.byId.get(id);
    if (!shape) return;
    this.byId.delete(id);
    for (const [key, list] of this.buckets) {
      const i = list.indexOf(shape);
      if (i >= 0) { list.splice(i, 1); if (!list.length) this.buckets.delete(key); }
    }
  }

  has(id: string) { return this.byId.has(id); }

  tileAt(px: number, py: number) { return { x: Math.floor(px / TILE), y: Math.floor(py / TILE) }; }

  heightAt(px: number, py: number): number {
    const { x, y } = this.tileAt(px, py);
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return 0;
    return this.heights[y * this.width + x];
  }

  isStairs(tx: number, ty: number) {
    return tx >= 0 && ty >= 0 && tx < this.width && ty < this.height && this.stairs[ty * this.width + tx] === 1;
  }

  isSlow(px: number, py: number) {
    const { x, y } = this.tileAt(px, py);
    return x >= 0 && y >= 0 && x < this.width && y < this.height && this.slow[y * this.width + x] === 1;
  }

  /** Solid for a mover standing at height `level` (and on stairs or not). */
  tileBlocked(tx: number, ty: number, level: number, onStairs: boolean): boolean {
    if (tx < 0 || ty < 0 || tx >= this.width || ty >= this.height) return true;
    const i = ty * this.width + tx;
    if (this.solid[i]) return true;
    if (this.heights[i] !== level && !this.stairs[i] && !onStairs) return true;
    return false;
  }

  groundAt(px: number, py: number): string {
    const { x, y } = this.tileAt(px, py);
    return this.map.ground[y]?.[x] ?? "x";
  }

  /**
   * Move a circle by (dx, dy) with sliding. Sub-steps keep fast movers from tunnelling.
   * `fly` ignores props and height but not solid ground.
   */
  move(body: { x: number; y: number; level: number }, r: number, dx: number, dy: number, fly = false): { hitWall: boolean } {
    const dist = Math.hypot(dx, dy);
    const steps = Math.max(1, Math.ceil(dist / 4));
    let hitWall = false;
    for (let s = 0; s < steps; s++) {
      body.x += dx / steps;
      if (this.resolve(body, r, fly)) hitWall = true;
      body.y += dy / steps;
      if (this.resolve(body, r, fly)) hitWall = true;
      // The mover takes the height of the ground under its feet once it is off the stairs.
      const t = this.tileAt(body.x, body.y);
      if (!fly && !this.isStairs(t.x, t.y)) body.level = this.heightAt(body.x, body.y);
    }
    return { hitWall };
  }

  /** Push a circle out of everything it overlaps. Returns true if it touched anything. */
  resolve(body: { x: number; y: number; level: number }, r: number, fly = false): boolean {
    let touched = false;
    for (let pass = 0; pass < 3; pass++) {
      let moved = false;
      const x0 = Math.floor((body.x - r) / TILE), x1 = Math.floor((body.x + r) / TILE);
      const y0 = Math.floor((body.y - r) / TILE), y1 = Math.floor((body.y + r) / TILE);
      // On the stairs while any part of the mover's circle touches a stairs tile.
      let onStairs = false;
      for (let ty = y0; ty <= y1 && !onStairs; ty++) for (let tx = x0; tx <= x1; tx++) if (this.isStairs(tx, ty)) { onStairs = true; break; }
      for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) {
        const blocked = fly
          ? tx < 0 || ty < 0 || tx >= this.width || ty >= this.height || (this.solid[ty * this.width + tx] === 1 && this.map.ground[ty][tx] !== "W" && this.map.ground[ty][tx] !== "w")
          : this.tileBlocked(tx, ty, body.level, onStairs);
        if (blocked && pushOutRect(body, r, tx * TILE, ty * TILE, TILE, TILE)) { moved = true; touched = true; }
        if (fly) continue;
        const list = this.buckets.get(ty * 4096 + tx);
        if (list) for (const s of list) {
          const hit = s.kind === "rect" ? pushOutRect(body, r, s.x, s.y, s.w, s.h) : pushOutCircle(body, r, s.x, s.y, s.r);
          if (hit) { moved = true; touched = true; }
        }
      }
      if (!moved) break;
    }
    return touched;
  }

  /** True when a straight line between two points crosses no solid tile (for projectiles/sight). */
  lineClear(ax: number, ay: number, bx: number, by: number, level: number): boolean {
    const dist = Math.hypot(bx - ax, by - ay);
    const steps = Math.max(1, Math.ceil(dist / 8));
    for (let i = 1; i < steps; i++) {
      const x = ax + (bx - ax) * i / steps, y = ay + (by - ay) * i / steps;
      const t = this.tileAt(x, y);
      if (t.x < 0 || t.y < 0 || t.x >= this.width || t.y >= this.height) return false;
      const idx = t.y * this.width + t.x;
      const ch = this.map.ground[t.y][t.x];
      if (this.solid[idx] && ch !== "W" && ch !== "w") return false;
      if (this.heights[idx] > level && !this.stairs[idx]) return false;
    }
    return true;
  }

  /** True when a walker could plausibly go straight from A to B: no solid ground (deep water
   *  included), no height change except over stairs. Props are ignored (walkers slide past). */
  walkClear(ax: number, ay: number, bx: number, by: number, level: number): boolean {
    const dist = Math.hypot(bx - ax, by - ay);
    const steps = Math.max(1, Math.ceil(dist / 8));
    let lv = level;
    for (let i = 1; i <= steps; i++) {
      const x = ax + (bx - ax) * i / steps, y = ay + (by - ay) * i / steps;
      const t = this.tileAt(x, y);
      if (t.x < 0 || t.y < 0 || t.x >= this.width || t.y >= this.height) return false;
      const idx = t.y * this.width + t.x;
      if (this.solid[idx]) return false;
      if (this.stairs[idx]) continue;
      if (this.heights[idx] !== lv) return false;
      lv = this.heights[idx];
    }
    return true;
  }

  /** Is a point inside any prop shape (used for projectile impacts)? */
  pointSolid(x: number, y: number): boolean {
    const t = this.tileAt(x, y);
    const list = this.buckets.get(t.y * 4096 + t.x);
    if (!list) return false;
    for (const s of list) {
      if (s.kind === "rect" ? x >= s.x && x <= s.x + s.w && y >= s.y && y <= s.y + s.h : Math.hypot(x - s.x, y - s.y) <= s.r) return true;
    }
    return false;
  }
}

function bounds(s: Shape): Rect {
  return s.kind === "rect" ? { x: s.x, y: s.y, w: s.w, h: s.h } : { x: s.x - s.r, y: s.y - s.r, w: s.r * 2, h: s.r * 2 };
}
function overlaps(a: Rect, b: Rect) { return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y; }

function pushOutRect(body: { x: number; y: number }, r: number, rx: number, ry: number, rw: number, rh: number): boolean {
  const cx = Math.max(rx, Math.min(body.x, rx + rw)), cy = Math.max(ry, Math.min(body.y, ry + rh));
  const dx = body.x - cx, dy = body.y - cy;
  const d2 = dx * dx + dy * dy;
  if (d2 >= r * r) return false;
  if (d2 > 1e-9) {
    const d = Math.sqrt(d2), push = r - d;
    body.x += dx / d * push; body.y += dy / d * push;
    return true;
  }
  // Centre inside the rect: push out along the shortest axis.
  const left = body.x - rx, right = rx + rw - body.x, up = body.y - ry, down = ry + rh - body.y;
  const m = Math.min(left, right, up, down);
  if (m === left) body.x = rx - r; else if (m === right) body.x = rx + rw + r; else if (m === up) body.y = ry - r; else body.y = ry + rh + r;
  return true;
}

function pushOutCircle(body: { x: number; y: number }, r: number, cx: number, cy: number, cr: number): boolean {
  const dx = body.x - cx, dy = body.y - cy;
  const d = Math.hypot(dx, dy), min = r + cr;
  if (d >= min) return false;
  if (d < 1e-6) { body.y += min; return true; }
  body.x += dx / d * (min - d); body.y += dy / d * (min - d);
  return true;
}
