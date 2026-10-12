/**
 * Game 05 ground renderer (render lane): turns MapDef.ground (+ height) into cached 4×4-tile
 * chunks of 1x art pixels.
 *
 * Every pixel's material comes from a bilinear field over the four nearest tile centres plus
 * per-material value noise, so material borders are organic blobs with inner and outer corners
 * (no hand-made autotiles). "Hard" materials (walls, void, floors, bridges) keep crisp tile
 * edges. On top of the swatches it draws the 3/4-view cues procedurally:
 *  - grass teeth hanging over dirt / cobble / sand / mud / cave floor, with a dark lip under them;
 *  - water: a 2 px brown bank on the land side, a darker 3 px far-bank wall on the TOP shore,
 *    a foam line on the water side; shallow → deep drop-off line;
 *  - '#' walls: a top cap plus a vertical face on the south side (2 tiles tall indoors); the look
 *    follows MapDef.kind: interior timber-and-plaster, dungeon stone blocks, outdoor rock;
 *    contact shadow on the floor below; 'x' is black;
 *  - height '0'..'3': plateaus with a 24 px-per-level face on the south edge (boulders outdoors, a
 *    cut-stone retaining wall in towns, blocks in dungeons; darker at the base, lighter lip, grass
 *    overhang), shaded east/west edges and cast shadows. Stairs are props drawn over the face.
 * Chunks never change after they are built (props, gates and cut grass are sprites).
 */
import { TILE, type MapDef } from "../contract";
import type { AtlasRT, GroundSwatch } from "./atlas";
import { ctx2d, hash1, hash2, makeCanvas, noiseTable, type Canvas, type Ctx } from "./util";

export const CHUNK_TILES = 4;
export const CHUNK_PX = CHUNK_TILES * TILE;
const M = 8; // neighbour margin in px
const S = CHUNK_PX + 2 * M;

const C = (ch: string) => ch.charCodeAt(0);
const g_ = C("g"), G_ = C("G"), d_ = C("d"), c_ = C("c"), s_ = C("s"), w_ = C("w"), W_ = C("W"), f_ = C("f");
const t_ = C("t"), k_ = C("k"), m_ = C("m"), WALL = C("#"), H_ = C("H"), x_ = C("x"), b_ = C("b");

const HARD = new Uint8Array(128);
for (const ch of [WALL, x_, f_, t_, b_]) HARD[ch] = 1;
const WATER = new Uint8Array(128);
WATER[w_] = WATER[W_] = 1;
const GRASS = new Uint8Array(128);
GRASS[g_] = GRASS[G_] = 1;
const LOW = new Uint8Array(128);
for (const ch of [d_, c_, s_, m_, k_]) LOW[ch] = 1;
/** Noise amplitude per material (how ragged its borders are). */
const AMP = new Float32Array(128);
AMP.fill(0.24);
AMP[w_] = AMP[W_] = 0.18;
AMP[g_] = AMP[G_] = 0.34;
AMP[c_] = 0.16;
AMP[m_] = 0.3;
const NOFF = new Int32Array(128);
for (let i = 0; i < 128; i++) NOFF[i] = Math.floor(hash1(i, 77) * 65536);

const SH_FACE_FLOOR = [0.52, 0.66, 0.8, 0.9, 0.96];
const SH_WALL_EAST = [0.66, 0.82, 0.93];
const SH_BRIDGE_SIDE = [0, 0.62, 0.5, 0.4];
const SH_BANK_WALL = [0, 0.62, 0.5, 0.4];
const SH_RAIL_H = [1.12, 0.9, 0.62];
const SH_RAIL_V = [0.6, 0.9, 1.1];
const SH_CLIFF_BASE = [0.5, 0.62, 0.74, 0.84, 0.92, 0.97];
const SH_EDGE_E = [0.86, 0.72, 0.55];
const SH_CAST_E = [0.66, 0.78, 0.88, 0.95];

export type WallStyle = "rock" | "in" | "dun";

/** Stand-in colours for materials the atlas lacks. */
const FALLBACK: Record<string, [number, number, number]> = {
  g: [84, 150, 60], G: [52, 100, 48], d: [150, 110, 70], c: [150, 146, 136], s: [220, 196, 140], w: [84, 156, 204],
  W: [40, 90, 160], f: [130, 90, 56], t: [110, 108, 116], k: [70, 64, 64], m: [80, 62, 48], b: [140, 100, 60],
  "#": [70, 64, 60], x: [6, 6, 10],
};
function flatSwatch(rgb: [number, number, number]): GroundSwatch {
  const data = new Uint8ClampedArray(32 * 32 * 4);
  for (let i = 0; i < 32 * 32; i++) {
    data[i * 4] = rgb[0];
    data[i * 4 + 1] = rgb[1];
    data[i * 4 + 2] = rgb[2];
    data[i * 4 + 3] = 255;
  }
  return { w: 32, h: 32, variants: 1, data };
}

export interface GroundDeco {
  /** Called after a chunk's pixels are written (flat props, baked prop shadows). */
  (ctx: Ctx, x0: number, y0: number, w: number, h: number): void;
}

export class GroundCache {
  readonly W: number;
  readonly H: number;
  readonly pxW: number;
  readonly pxH: number;
  readonly cols: number;
  readonly rows: number;
  private grid: Uint8Array;
  private hgt: Uint8Array;
  private faceRow: Int8Array;
  private faceTotal: Int8Array;
  private cliffH: Uint8Array;
  private bridgeNS: Uint8Array;
  /** Tiles whose 3×3 neighbourhood is one material at one height with no face nearby: a swatch copy. */
  private simple: Uint8Array;
  private chunks: Array<Canvas | null>;
  private sw: Array<GroundSwatch | null> = new Array(128).fill(null);
  private capTex: GroundSwatch | null;
  private faceTex: GroundSwatch | null;
  private cliffTex: GroundSwatch | null;
  private style: WallStyle;
  private mat = new Uint8Array(S * S);
  private img: ImageData | null = null;
  private noise = noiseTable();
  readonly waterTiles: Int32Array;
  readonly hasHeight: boolean;
  deco: GroundDeco | null = null;
  builtCount = 0;
  /** Build timings (ms) for the lab. */
  buildMs = 0;
  maxBuildMs = 0;

  constructor(map: MapDef, atlas: AtlasRT) {
    const rows = map.ground;
    this.H = rows.length;
    this.W = rows.reduce((a, r) => Math.max(a, r.length), 0);
    this.pxW = this.W * TILE;
    this.pxH = this.H * TILE;
    this.cols = Math.ceil(this.W / CHUNK_TILES);
    this.rows = Math.ceil(this.H / CHUNK_TILES);
    this.chunks = new Array(this.cols * this.rows).fill(null);
    const W = this.W, H = this.H;
    this.grid = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) {
      const r = rows[y];
      for (let x = 0; x < W; x++) {
        const code = r.charCodeAt(x);
        this.grid[y * W + x] = code > 0 && code < 128 ? code : g_;
      }
    }
    this.resolveHouseWalls();
    this.hgt = new Uint8Array(W * H);
    this.hasHeight = !!map.height;
    if (map.height) {
      for (let y = 0; y < H; y++) {
        const r = map.height[y] ?? "";
        for (let x = 0; x < W; x++) {
          const v = r.charCodeAt(x) - 48;
          this.hgt[y * W + x] = v >= 0 && v <= 9 ? v : 0;
        }
      }
    }
    this.style = map.kind === "interior" ? "in" : map.kind === "dungeon" ? "dun" : "rock";
    // swatches (a material whose swatch is missing gets a flat stand-in colour, never magenta)
    for (const [key, s] of atlas.ground) if (key.length === 1) this.sw[key.charCodeAt(0)] = s;
    for (const [ch, rgb] of Object.entries(FALLBACK)) {
      const code = ch.charCodeAt(0);
      if (!this.sw[code]) this.sw[code] = flatSwatch(rgb);
    }
    const pick = (...keys: string[]) => {
      for (const k of keys) {
        const s = atlas.ground.get(k);
        if (s) return s;
      }
      return null;
    };
    this.capTex = this.style === "in" ? pick("#in", "#") : this.style === "dun" ? pick("#dun", "#") : pick("#");
    this.faceTex = this.style === "in" ? pick("#inface", "#face") : this.style === "dun" ? pick("#dunface", "#face") : pick("#face");
    // height-step faces: a cut-stone retaining wall in towns, stone blocks in dungeons, rock outdoors
    this.cliffTex = map.kind === "town" ? pick("cliff.town", "cliff", "#face")
      : this.style === "dun" ? pick("cliff.dun", "#dunface", "cliff") : pick("cliff", "#face");
    // walls: rows of face on the south end of each vertical run of '#'
    this.faceRow = new Int8Array(W * H).fill(-1);
    this.faceTotal = new Int8Array(W * H);
    const faceTiles = this.style === "in" ? 2 : 1;
    for (let x = 0; x < W; x++) {
      let y = 0;
      while (y < H) {
        if (this.grid[y * W + x] !== WALL) {
          y++;
          continue;
        }
        const y0 = y;
        while (y < H && this.grid[y * W + x] === WALL) y++;
        const y1 = y; // exclusive
        const below = y1 < H ? this.grid[y1 * W + x] : x_;
        if (below === x_ || below === H_ || below === WALL) continue;
        const F = Math.min(faceTiles, y1 - y0);
        for (let i = 0; i < F; i++) {
          const ty = y1 - F + i;
          this.faceRow[ty * W + x] = i;
          this.faceTotal[ty * W + x] = F;
        }
      }
    }
    // cliffs
    this.cliffH = new Uint8Array(W * H);
    if (this.hasHeight) {
      for (let y = 0; y < H - 1; y++)
        for (let x = 0; x < W; x++) {
          const a = this.hgt[y * W + x], b = this.hgt[(y + 1) * W + x];
          if (a > b) this.cliffH[y * W + x] = (a - b) * 24;
        }
    }
    // bridges: planks across the walking direction
    this.bridgeNS = new Uint8Array(W * H);
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        if (this.grid[y * W + x] !== b_) continue;
        const wl = WATER[this.at(x - 1, y)] && WATER[this.at(x + 1, y)];
        const wn = WATER[this.at(x, y - 1)] || WATER[this.at(x, y + 1)];
        this.bridgeNS[y * W + x] = wl && !wn ? 1 : 0;
      }
    const wt: number[] = [];
    for (let i = 0; i < W * H; i++) if (WATER[this.grid[i]]) wt.push(i);
    this.waterTiles = Int32Array.from(wt);
    this.simple = new Uint8Array(W * H);
    for (let y = 1; y < H - 1; y++)
      for (let x = 1; x < W - 1; x++) {
        const i = y * W + x;
        const c = this.grid[i];
        if (c === WALL || c === b_ || !this.sw[c]) continue;
        const h = this.hgt[i];
        let ok = true;
        for (let dy = -1; dy <= 1 && ok; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const j = i + dy * W + dx;
            if (this.grid[j] !== c || this.hgt[j] !== h) {
              ok = false;
              break;
            }
          }
        if (ok && this.hasHeight && (this.cliffH[i + W] || (y + 2 < H && this.cliffH[i + 2 * W]))) ok = false;
        if (ok) this.simple[i] = 1;
      }
  }

  private resolveHouseWalls(): void {
    const W = this.W, H = this.H, g = this.grid;
    for (let pass = 0; pass < 6; pass++) {
      let left = 0;
      for (let y = 0; y < H; y++)
        for (let x = 0; x < W; x++) {
          if (g[y * W + x] !== H_) continue;
          const cnt = new Map<number, number>();
          for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const v = this.at(x + dx, y + dy);
            if (v !== H_ && !HARD[v] && !WATER[v]) cnt.set(v, (cnt.get(v) ?? 0) + 1);
          }
          let best = 0, bn = 0;
          for (const [k, n] of cnt) if (n > bn) { best = k; bn = n; }
          if (best) g[y * W + x] = best;
          else left++;
        }
      if (!left) break;
    }
    for (let i = 0; i < g.length; i++) if (g[i] === H_) g[i] = d_;
  }

  at(x: number, y: number): number {
    if (x < 0) x = 0;
    else if (x >= this.W) x = this.W - 1;
    if (y < 0) y = 0;
    else if (y >= this.H) y = this.H - 1;
    return this.grid[y * this.W + x];
  }

  heightAt(tx: number, ty: number): number {
    if (tx < 0 || ty < 0 || tx >= this.W || ty >= this.H) return 0;
    return this.hgt[ty * this.W + tx];
  }

  groundAt(tx: number, ty: number): number {
    return this.at(tx, ty);
  }

  private matAt(wx: number, wy: number): number {
    const tx = wx >> 5, ty = wy >> 5;
    const own = this.at(tx, ty);
    if (HARD[own]) return own;
    const fx = (wx + 0.5) / 32 - 0.5, fy = (wy + 0.5) / 32 - 0.5;
    const x0 = Math.floor(fx), y0 = Math.floor(fy);
    const ax = fx - x0, ay = fy - y0;
    let a = this.at(x0, y0), b = this.at(x0 + 1, y0), c = this.at(x0, y0 + 1), d = this.at(x0 + 1, y0 + 1);
    if (HARD[a]) a = own;
    if (HARD[b]) b = own;
    if (HARD[c]) c = own;
    if (HARD[d]) d = own;
    if (a === b && a === c && a === d) return a;
    const wa = (1 - ax) * (1 - ay), wb = ax * (1 - ay), wc = (1 - ax) * ay, wd = ax * ay;
    const nz = this.noise;
    const score = (m: number) => {
      let s = 0;
      if (a === m) s += wa;
      if (b === m) s += wb;
      if (c === m) s += wc;
      if (d === m) s += wd;
      const o = NOFF[m];
      const n = nz[(((wy + (o >> 8)) & 255) << 8) | ((wx + o) & 255)];
      return s + AMP[m] * (n - 0.5) * 2;
    };
    let best = a, bs = score(a);
    if (b !== a) {
      const s = score(b);
      if (s > bs) { bs = s; best = b; }
    }
    if (c !== a && c !== b) {
      const s = score(c);
      if (s > bs) { bs = s; best = c; }
    }
    if (d !== a && d !== b && d !== c) {
      const s = score(d);
      if (s > bs) { bs = s; best = d; }
    }
    return best;
  }

  private variantOf(tx: number, ty: number, code: number, n: number): number {
    if (n <= 1) return 0;
    const h = hash2(tx, ty, code * 31 + 7);
    if (h < 0.55) return 0;
    return 1 + Math.min(n - 2, Math.floor(((h - 0.55) / 0.45) * (n - 1)));
  }

  isBuilt(cx: number, cy: number): boolean {
    return !!this.chunks[cy * this.cols + cx];
  }

  chunk(cx: number, cy: number): Canvas | null {
    if (cx < 0 || cy < 0 || cx >= this.cols || cy >= this.rows) return null;
    const i = cy * this.cols + cx;
    let ch = this.chunks[i];
    if (!ch) {
      const t0 = performance.now();
      ch = this.build(cx, cy);
      const ms = performance.now() - t0;
      this.buildMs += ms;
      this.maxBuildMs = Math.max(this.maxBuildMs, ms);
      this.chunks[i] = ch;
      this.builtCount++;
    }
    return ch;
  }

  /** Build not-yet-built chunks for up to `budgetMs`, nearest to (px, py) first. */
  /**
   * Build the missing chunks that overlap a world rect: all of them (`max` = Infinity) or at most
   * `max`, nearest to the rect's centre first. Returns how many were built.
   */
  ensure(x: number, y: number, w: number, h: number, max = Infinity): number {
    if (this.complete) return 0;
    const c0 = Math.max(0, Math.floor(x / CHUNK_PX)), c1 = Math.min(this.cols - 1, Math.floor((x + w) / CHUNK_PX));
    const r0 = Math.max(0, Math.floor(y / CHUNK_PX)), r1 = Math.min(this.rows - 1, Math.floor((y + h) / CHUNK_PX));
    const mx = (x + w / 2) / CHUNK_PX - 0.5, my = (y + h / 2) / CHUNK_PX - 0.5;
    const todo: Array<[number, number, number]> = [];
    for (let cy = r0; cy <= r1; cy++)
      for (let cx = c0; cx <= c1; cx++) if (!this.isBuilt(cx, cy)) todo.push([(cx - mx) ** 2 + (cy - my) ** 2, cx, cy]);
    todo.sort((a, b) => a[0] - b[0]);
    let n = 0;
    for (const [, cx, cy] of todo) {
      if (n >= max) break;
      this.chunk(cx, cy);
      n++;
    }
    return n;
  }

  /** All chunks are built. */
  get complete(): boolean {
    return this.builtCount >= this.chunks.length;
  }

  /** Mean build time of one chunk so far (ms), for budgeting. */
  get chunkCost(): number {
    return this.builtCount ? this.buildMs / this.builtCount : 1.5;
  }

  /**
   * Build not-yet-built chunks nearest to (px, py) while the next one is expected to fit in
   * `budgetMs` (at least one when `atLeastOne`). Returns how many were built.
   */
  prebuild(px: number, py: number, budgetMs: number, atLeastOne = false): number {
    const t0 = performance.now();
    let n = 0;
    if (this.complete || (budgetMs <= 0 && !atLeastOne)) return 0;
    const ccx = Math.floor(px / CHUNK_PX), ccy = Math.floor(py / CHUNK_PX);
    for (let r = 0; r < Math.max(this.cols, this.rows) + 1; r++) {
      for (let cy = ccy - r; cy <= ccy + r; cy++)
        for (let cx = ccx - r; cx <= ccx + r; cx++) {
          if (Math.max(Math.abs(cx - ccx), Math.abs(cy - ccy)) !== r) continue;
          if (cx < 0 || cy < 0 || cx >= this.cols || cy >= this.rows) continue;
          if (this.isBuilt(cx, cy)) continue;
          if ((n > 0 || !atLeastOne) && performance.now() - t0 + this.chunkCost > budgetMs) return n;
          this.chunk(cx, cy);
          n++;
        }
    }
    return n;
  }

  private build(cx: number, cy: number): Canvas {
    const X0 = cx * CHUNK_PX, Y0 = cy * CHUNK_PX;
    const mat = this.mat;
    const W = this.W, H = this.H;
    const simple = this.simple;
    // material field (chunk + margin); tiles inside a uniform neighbourhood skip the noise field
    for (let ry = 0; ry < S; ry++) {
      const wy = Y0 - M + ry;
      const ty = wy >> 5;
      const row = ty >= 0 && ty < H ? ty * W : -1;
      for (let rx = 0; rx < S; rx++) {
        const wx = X0 - M + rx;
        const tx = wx >> 5;
        mat[ry * S + rx] = row >= 0 && tx >= 0 && tx < W && simple[row + tx] ? this.grid[row + tx] : this.matAt(wx, wy);
      }
    }
    const canvas = makeCanvas(CHUNK_PX, CHUNK_PX);
    const g = ctx2d(canvas);
    if (!this.img) this.img = g.createImageData(CHUNK_PX, CHUNK_PX);
    const out = this.img.data;
    const col = [0, 0, 0];
    for (let cty = 0; cty < CHUNK_TILES; cty++)
      for (let ctx_ = 0; ctx_ < CHUNK_TILES; ctx_++) {
        const tx = cx * CHUNK_TILES + ctx_, ty = cy * CHUNK_TILES + cty;
        const px0 = ctx_ * TILE, py0 = cty * TILE;
        if (tx >= W || ty >= H) {
          for (let py = py0; py < py0 + TILE; py++)
            for (let px = px0; px < px0 + TILE; px++) {
              const o = (py * CHUNK_PX + px) * 4;
              out[o] = 6;
              out[o + 1] = 6;
              out[o + 2] = 10;
              out[o + 3] = 255;
            }
          continue;
        }
        const ti = ty * W + tx;
        if (simple[ti]) {
          // fast path: a plain swatch copy (plus the plateau brightening)
          const code = this.grid[ti];
          const k = 1 + 0.045 * this.hgt[ti];
          if (code === x_) {
            for (let py = py0; py < py0 + TILE; py++)
              for (let px = px0; px < px0 + TILE; px++) {
                const o = (py * CHUNK_PX + px) * 4;
                out[o] = 6;
                out[o + 1] = 6;
                out[o + 2] = 10;
                out[o + 3] = 255;
              }
            continue;
          }
          const sw = this.sw[code]!;
          const variant = this.variantOf(tx, ty, code, sw.variants) % sw.variants;
          const wy0 = ty * TILE;
          for (let v = 0; v < TILE; v++) {
            const vv = (wy0 + v) % sw.h;
            const src = (vv * sw.w + variant * 32) * 4;
            let o = ((py0 + v) * CHUNK_PX + px0) * 4;
            for (let u = 0; u < TILE; u++, o += 4) {
              const i = src + u * 4;
              const r = sw.data[i] * k, gg = sw.data[i + 1] * k, b = sw.data[i + 2] * k;
              out[o] = r > 255 ? 255 : r;
              out[o + 1] = gg > 255 ? 255 : gg;
              out[o + 2] = b > 255 ? 255 : b;
              out[o + 3] = 255;
            }
          }
          continue;
        }
        const tile = this.grid[ti];
        for (let py = py0; py < py0 + TILE; py++) {
          const wy = Y0 + py;
          for (let px = px0; px < px0 + TILE; px++) {
            const wx = X0 + px;
            const mi = (py + M) * S + px + M;
            this.shadePixel(mat[mi], tile, wx, wy, tx, ty, mi, col);
            const o = (py * CHUNK_PX + px) * 4;
            out[o] = col[0] < 0 ? 0 : col[0] > 255 ? 255 : col[0];
            out[o + 1] = col[1] < 0 ? 0 : col[1] > 255 ? 255 : col[1];
            out[o + 2] = col[2] < 0 ? 0 : col[2] > 255 ? 255 : col[2];
            out[o + 3] = 255;
          }
        }
      }
    g.putImageData(this.img, 0, 0);
    if (this.deco) this.deco(g, X0, Y0, CHUNK_PX, CHUNK_PX);
    return canvas;
  }

  private sample(sw: GroundSwatch | null, variant: number, u: number, v: number, col: number[]): void {
    if (!sw) {
      col[0] = 255;
      col[1] = 0;
      col[2] = 255;
      return;
    }
    const vv = ((v % sw.h) + sw.h) % sw.h;
    const i = (vv * sw.w + (variant % sw.variants) * 32 + (u & 31)) * 4;
    col[0] = sw.data[i];
    col[1] = sw.data[i + 1];
    col[2] = sw.data[i + 2];
  }

  private mul(col: number[], k: number): void {
    col[0] *= k;
    col[1] *= k;
    col[2] *= k;
  }

  private shadePixel(m: number, tile: number, wx: number, wy: number, tx: number, ty: number, mi: number,
    col: number[]): void {
    const mat = this.mat;
    const W = this.W;
    // ── base ────────────────────────────────────────────────────────────────────────────────
    if (m === x_) {
      col[0] = 6;
      col[1] = 6;
      col[2] = 10;
      return;
    }
    if (m === WALL) {
      this.wallPixel(wx, wy, tx, ty, col);
      return;
    }
    const sw = this.sw[m];
    if (m === b_ && this.bridgeNS[this.idx(tx, ty)]) this.sample(sw, this.variantOf(tx, ty, m, sw?.variants ?? 1), wy, wx, col);
    else this.sample(sw, m === tile ? this.variantOf(tx, ty, m, sw?.variants ?? 1) : 0, wx & 31, wy, col);
    // ── transitions ─────────────────────────────────────────────────────────────────────────
    if (WATER[m]) {
      this.waterEdge(m, wx, wy, mi, col);
    } else if (m === b_) {
      this.bridgeEdge(wx, wy, tx, ty, col);
    } else {
      let bank = 0;
      if (!HARD[m]) {
        // water within 2 px → brown (or wet-sand) bank
        if (WATER[mat[mi - 1]] || WATER[mat[mi + 1]] || WATER[mat[mi - S]] || WATER[mat[mi + S]]) bank = 1;
        else if (WATER[mat[mi - 2]] || WATER[mat[mi + 2]] || WATER[mat[mi - 2 * S]] || WATER[mat[mi + 2 * S]] ||
          WATER[mat[mi - S - 1]] || WATER[mat[mi - S + 1]] || WATER[mat[mi + S - 1]] || WATER[mat[mi + S + 1]]) bank = 2;
      }
      if (bank) {
        const n = this.noise[((wy & 255) << 8) | (wx & 255)];
        if (m === s_) {
          const k = bank === 1 ? 0.78 : 0.88;
          col[0] = (176 + n * 20) * k;
          col[1] = (138 + n * 16) * k;
          col[2] = (88 + n * 10) * k;
        } else {
          const k = bank === 1 ? 0.8 : 1;
          col[0] = (112 + n * 22) * k;
          col[1] = (80 + n * 14) * k;
          col[2] = (50 + n * 8) * k;
        }
      } else if (LOW[m]) {
        this.grassOverLow(m, wx, wy, mi, col);
      } else if (GRASS[m]) {
        const up = mat[mi - S];
        if (LOW[up]) this.mul(col, 1.13);
        else if (LOW[mat[mi + S]]) this.mul(col, 0.9);
      }
      if (m === f_ || m === t_) this.floorEdge(wx, wy, tx, ty, col);
    }
    // ── elevation and structures ───────────────────────────────────────────────────────────
    if (this.hasHeight) this.heightPixel(m, wx, wy, tx, ty, col);
    // contact shadow under wall faces and beside walls
    const above = ty > 0 ? this.idx(tx, ty - 1) : -1;
    if (above >= 0 && this.faceRow[above] >= 0 && tile !== WALL) {
      const r = wy & 31;
      if (r < 5) this.mul(col, SH_FACE_FLOOR[r]);
    }
    if (tx > 0 && tile !== WALL && tile !== x_ && this.grid[this.idx(tx - 1, ty)] === WALL) {
      const r = wx & 31;
      if (r < 3) this.mul(col, SH_WALL_EAST[r]);
    }
    void W;
  }

  private idx(tx: number, ty: number): number {
    return ty * this.W + tx;
  }

  private tooth(wx: number): number {
    // triangular teeth: centres every few px, depth 2-4
    let L = 0;
    for (let dx = -3; dx <= 3; dx++) {
      const c = wx + dx;
      const h = hash1(c, 911);
      if (h < 0.3) {
        const D = 2 + (h < 0.1 ? 2 : h < 0.2 ? 1 : 0);
        const l = D - Math.abs(dx);
        if (l > L) L = l;
      }
    }
    return L;
  }

  private grassOverLow(m: number, wx: number, wy: number, mi: number, col: number[]): void {
    const mat = this.mat;
    let ka = 0;
    for (let k = 1; k <= 5; k++) {
      const a = mat[mi - k * S];
      if (GRASS[a]) {
        ka = k;
        break;
      }
      if (!LOW[a]) break;
    }
    if (ka) {
      const L = this.tooth(wx);
      if (ka <= L) {
        const gm = mat[mi - ka * S];
        this.sample(this.sw[gm], 0, wx & 31, wy, col);
        if (ka === L) this.mul(col, 0.8);
        return;
      }
      if (ka === L + 1) this.mul(col, 0.6);
      else if (ka === L + 2) this.mul(col, 0.8);
      else if (ka === L + 3) this.mul(col, 0.92);
      return;
    }
    const below = mat[mi + S];
    if (GRASS[below]) {
      if (hash2(wx, wy, 5) < 0.38) {
        this.sample(this.sw[below], 0, wx & 31, wy, col);
        this.mul(col, 1.08);
      } else this.mul(col, 0.8);
      return;
    }
    const l = mat[mi - 1], r = mat[mi + 1];
    if (GRASS[l] || GRASS[r]) {
      if (hash2(wx, wy, 6) < 0.3) this.sample(this.sw[GRASS[l] ? l : r], 0, wx & 31, wy, col);
      else this.mul(col, GRASS[r] ? 0.78 : 0.86);
      return;
    }
    if (m === c_) {
      if (mat[mi - 1] !== c_ || mat[mi + 1] !== c_ || mat[mi + S] !== c_ || mat[mi - S] !== c_) this.mul(col, 0.82);
    }
  }

  private waterEdge(m: number, wx: number, wy: number, mi: number, col: number[]): void {
    const mat = this.mat;
    const wallN = m === W_ ? 3 : 2;
    let d = 0;
    let bridge = 0;
    for (let k = 1; k <= 7; k++) {
      const a = mat[mi - k * S];
      if (a === b_) {
        bridge = k;
        break;
      }
      if (!WATER[a]) {
        d = k;
        break;
      }
    }
    if (bridge) {
      // the bridge's plank side, then its shadow on the water
      if (bridge <= 3) {
        const k = SH_BRIDGE_SIDE[bridge];
        col[0] = 124 * k;
        col[1] = 88 * k;
        col[2] = 54 * k;
        return;
      }
      if (bridge <= 7) this.mul(col, 0.66 + (bridge - 4) * 0.08);
      return;
    }
    if (d > 0 && d <= wallN) {
      const land = mat[mi - d * S];
      const sand = land === s_;
      const k = SH_BANK_WALL[d] * (wallN === 2 ? 1.12 : 1);
      if (sand) {
        col[0] = 170 * k;
        col[1] = 130 * k;
        col[2] = 82 * k;
      } else {
        col[0] = 120 * k;
        col[1] = 86 * k;
        col[2] = 56 * k;
      }
      return;
    }
    if (d === wallN + 1) {
      this.foam(wx, wy, col, 0.92);
      return;
    }
    const l = mat[mi - 1], r = mat[mi + 1], dn = mat[mi + S];
    const landSide = (!WATER[l] && l !== b_) || (!WATER[r] && r !== b_) || (!WATER[dn] && dn !== b_);
    if (landSide) {
      this.foam(wx, wy, col, 1);
      return;
    }
    const l2 = mat[mi - 2], r2 = mat[mi + 2], dn2 = mat[mi + 2 * S];
    if ((!WATER[l2] && l2 !== b_) || (!WATER[r2] && r2 !== b_) || (!WATER[dn2] && dn2 !== b_)) {
      this.mul(col, 1.12);
      return;
    }
    if (m === W_ && (mat[mi - 1] === w_ || mat[mi + 1] === w_ || mat[mi - S] === w_ || mat[mi + S] === w_)) {
      this.mul(col, 0.84);
    } else if (d === wallN + 2) {
      this.mul(col, 1.08);
    }
  }

  private foam(wx: number, wy: number, col: number[], k: number): void {
    const h = hash2(wx >> 1, wy, 17);
    if (h < 0.12) {
      this.mul(col, 1.25);
      return;
    }
    col[0] = 214 * k;
    col[1] = 238 * k;
    col[2] = 246 * k;
  }

  private bridgeEdge(wx: number, wy: number, tx: number, ty: number, col: number[]): void {
    const ns = this.bridgeNS[this.idx(tx, ty)];
    const u = wx & 31, v = wy & 31;
    if (!ns) {
      // east-west span: rails along north and south where water is
      const wn = WATER[this.at(tx, ty - 1)], ws = WATER[this.at(tx, ty + 1)];
      if ((wn && v < 3) || (ws && v > 28)) {
        const r = wn && v < 3 ? v : v - 29;
        const k = SH_RAIL_H[r];
        col[0] = 150 * k;
        col[1] = 108 * k;
        col[2] = 64 * k;
        if (u % 16 === 3) this.mul(col, 0.7);
      }
    } else {
      const ww = WATER[this.at(tx - 1, ty)], we = WATER[this.at(tx + 1, ty)];
      if ((ww && u < 3) || (we && u > 28)) {
        const r = ww && u < 3 ? u : 31 - u;
        const k = SH_RAIL_V[r];
        col[0] = 150 * k;
        col[1] = 108 * k;
        col[2] = 64 * k;
        if (v % 16 === 3) this.mul(col, 0.7);
      }
    }
  }

  private floorEdge(wx: number, wy: number, tx: number, ty: number, col: number[]): void {
    const u = wx & 31, v = wy & 31;
    if (v >= 30 && this.at(tx, ty + 1) === x_) this.mul(col, v === 31 ? 0.45 : 0.7);
    if (u === 0 && this.at(tx - 1, ty) === x_) this.mul(col, 0.55);
    if (u === 31 && this.at(tx + 1, ty) === x_) this.mul(col, 0.55);
  }

  private wallPixel(wx: number, wy: number, tx: number, ty: number, col: number[]): void {
    const i = this.idx(tx, ty);
    const fr = this.faceRow[i];
    const u = wx & 31, v = wy & 31;
    const isWall = (x: number, y: number) => this.at(x, y) === WALL;
    if (fr >= 0) {
      const F = this.faceTotal[i];
      // the wall's top edge seen from above: a cap band where nothing wall-like sits above
      const topOpen = fr === 0 && (ty === 0 || !isWall(tx, ty - 1));
      if (topOpen && v < 5) {
        // a free-standing wall row: show its thickness from above
        this.sample(this.capTex, 0, u, v, col);
        if (v === 0) this.mul(col, 0.55);
        else if (v === 4) this.mul(col, 1.3);
        return;
      }
      const fy = fr * 32 + v;
      const total = F * 32;
      const tex = this.faceTex;
      if (tex) {
        const row = tex.h >= total ? tex.h - total + fy : fy % tex.h;
        this.sample(tex, 0, u, row, col);
      } else {
        col[0] = 90;
        col[1] = 80;
        col[2] = 72;
      }
      const t = fy / total;
      this.mul(col, 1.04 - 0.3 * t * t);
      if (fr === 0 && v === 0) this.mul(col, 1.3);
      // face ends
      const eastFace = tx + 1 < this.W && this.faceRow[this.idx(tx + 1, ty)] >= 0;
      const westFace = tx > 0 && this.faceRow[this.idx(tx - 1, ty)] >= 0;
      if (!eastFace && u >= 30) this.mul(col, u === 31 ? 0.5 : 0.75);
      if (!westFace && u === 0) this.mul(col, isWall(tx - 1, ty) ? 0.9 : 1.2);
      return;
    }
    // cap
    this.sample(this.capTex, this.variantOf(tx, ty, WALL, this.capTex?.variants ?? 1), u, v, col);
    const openN = !isWall(tx, ty - 1) && this.at(tx, ty - 1) !== x_ && ty > 0;
    const openW = !isWall(tx - 1, ty) && this.at(tx - 1, ty) !== x_ && tx > 0;
    const openE = !isWall(tx + 1, ty) && this.at(tx + 1, ty) !== x_ && tx < this.W - 1;
    const faceBelow = ty + 1 < this.H && this.faceRow[this.idx(tx, ty + 1)] >= 0;
    const openS = !isWall(tx, ty + 1) && this.at(tx, ty + 1) !== x_ && ty < this.H - 1;
    if (openN && v === 0) this.mul(col, 0.45);
    else if (openN && v === 1) this.mul(col, 1.28);
    if (openW && u === 0) this.mul(col, 0.5);
    else if (openW && u === 1) this.mul(col, 1.2);
    if (openE && u === 31) this.mul(col, 0.42);
    else if (openE && u === 30) this.mul(col, 0.8);
    if (faceBelow && v === 31) this.mul(col, 1.35);
    if (openS && v === 31) this.mul(col, 0.45);
    if (this.style === "rock") {
      // darker cap toward the middle of a thick rock mass reads as depth
      const inner = isWall(tx, ty - 1) && isWall(tx - 1, ty) && isWall(tx + 1, ty);
      if (inner) this.mul(col, 0.9);
    }
  }

  private heightPixel(m: number, wx: number, wy: number, tx: number, ty: number, col: number[]): void {
    const W = this.W;
    const u = wx & 31, v = wy & 31;
    // a cliff face from this tile or from up to two tiles below (taller drops)
    for (let dy = 2; dy >= 0; dy--) {
      const fty = ty + dy;
      if (fty >= this.H) continue;
      const fh = this.cliffH[fty * W + tx];
      if (!fh) continue;
      const bottom = (fty + 1) * 32;
      const top = bottom - fh;
      if (wy < top || wy >= bottom) continue;
      const fy = wy - top;
      this.cliffPixel(wx, wy, tx, fty, fy, fh, col);
      return;
    }
    const h = this.hgt[ty * W + tx];
    if (h) this.mul(col, 1 + 0.045 * h);
    // base shadow below a face
    if (ty > 0 && this.cliffH[(ty - 1) * W + tx] && v < 6) this.mul(col, SH_CLIFF_BASE[v]);
    // east / west / north edges of plateaus
    if (tx + 1 < W && h > this.hgt[ty * W + tx + 1] && u >= 29) this.mul(col, SH_EDGE_E[u - 29]);
    if (tx > 0 && h > this.hgt[ty * W + tx - 1] && u <= 1) this.mul(col, u === 0 ? 1.25 : 1.1);
    if (tx > 0 && this.hgt[ty * W + tx - 1] > h && u < 4) this.mul(col, SH_CAST_E[u]);
    if (tx + 1 < W && this.hgt[ty * W + tx + 1] > h && u === 31) this.mul(col, 0.72);
    if (ty > 0 && h > this.hgt[(ty - 1) * W + tx] && v <= 1) this.mul(col, v === 0 ? 1.28 : 1.1);
    if (ty + 1 < this.H && this.hgt[(ty + 1) * W + tx] > h && v === 31 && !this.cliffH[ty * W + tx]) this.mul(col, 0.7);
    void m;
  }

  private cliffPixel(wx: number, wy: number, tx: number, fty: number, fy: number, fh: number, col: number[]): void {
    const W = this.W;
    const u = wx & 31;
    // grass (or other top material) hangs over the lip
    const topMat = this.at(tx, fty - (fh > 32 ? 1 : 0));
    const L = Math.min(3, this.tooth(wx) >> 1) + 1;
    if (fy < L && (GRASS[topMat] || topMat === s_ || topMat === d_)) {
      this.sample(this.sw[topMat], 0, u, wy, col);
      this.mul(col, fy === L - 1 ? 0.72 : 0.92);
      return;
    }
    const tex = this.cliffTex;
    if (tex) this.sample(tex, 0, u, fy % tex.h, col);
    else {
      col[0] = 104;
      col[1] = 86;
      col[2] = 70;
    }
    const t = fy / fh;
    this.mul(col, 1.08 - 0.42 * Math.pow(t, 1.4));
    if (fy === L) this.mul(col, 1.35);
    else if (fy === L + 1) this.mul(col, 1.12);
    if (fy >= fh - 2) this.mul(col, 0.7);
    // ends of the face
    const eastH = tx + 1 < W ? this.cliffH[fty * W + tx + 1] : 0;
    const westH = tx > 0 ? this.cliffH[fty * W + tx - 1] : 0;
    const bottom = (fty + 1) * 32;
    const coversE = eastH && wy >= bottom - eastH;
    const coversW = westH && wy >= bottom - westH;
    if (!coversE && u >= 30) this.mul(col, u === 31 ? 0.5 : 0.72);
    if (!coversW && u <= 1) this.mul(col, u === 0 ? 0.62 : 1.18);
  }

  dispose(): void {
    this.chunks.fill(null);
  }
}
