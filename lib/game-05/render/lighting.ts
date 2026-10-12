/**
 * Game 05 lighting (render lane). All passes run in the low-res art buffer so every art pixel
 * stays one flat colour after the integer upscale.
 *
 * Light map: ambient colour (per MapDef.light, blended by WorldView.dusk) × a key-light gradient
 * from the top-left × a subtle vignette, then banded radial lights added with "lighter", then the
 * whole map is multiplied over the scene. Small additive glows, window shafts and sunbeams go on
 * top. Fog is drawn into the scene before the multiply so it is lit like everything else.
 */
import type { MapDef } from "../contract";
import { clamp, ctx2d, hash2, lerp, makeCanvas, noiseTable, parseColor, type Canvas, type Ctx, type RGB } from "./util";

type Grade = { day: RGB; dusk: RGB; night: RGB };
const GRADES: Record<MapDef["light"], Grade> = {
  day: { day: [1, 0.985, 0.95], dusk: [0.98, 0.72, 0.6], night: [0.34, 0.38, 0.62] },
  forest: { day: [0.86, 0.93, 0.8], dusk: [0.78, 0.62, 0.55], night: [0.3, 0.36, 0.55] },
  interior: { day: [0.76, 0.7, 0.62], dusk: [0.68, 0.58, 0.5], night: [0.42, 0.4, 0.52] },
  cave: { day: [0.3, 0.28, 0.38], dusk: [0.3, 0.28, 0.38], night: [0.26, 0.25, 0.36] },
};

export function ambientFor(mode: MapDef["light"], dusk: number): RGB {
  const g = GRADES[mode] ?? GRADES.day;
  const t = clamp(dusk, 0, 1);
  if (t <= 0.5) {
    const u = t / 0.5;
    return [lerp(g.day[0], g.dusk[0], u), lerp(g.day[1], g.dusk[1], u), lerp(g.day[2], g.dusk[2], u)];
  }
  const u = (t - 0.5) / 0.5;
  return [lerp(g.dusk[0], g.night[0], u), lerp(g.dusk[1], g.night[1], u), lerp(g.dusk[2], g.night[2], u)];
}

/** 0 = broad daylight … 1 = dark; how much artificial lights matter. */
export function darkness(amb: RGB): number {
  const L = amb[0] * 0.3 + amb[1] * 0.55 + amb[2] * 0.15;
  return clamp((1 - L) / 0.6, 0, 1);
}

/** Flat steps in a light's falloff: fine enough that no ring shows, while every art pixel stays one colour. */
const BANDS = 32;

export class Lighting {
  lm: Canvas;
  private g: Ctx;
  private key: Canvas;
  private radial = new Map<number, Canvas>();
  private tinted = new Map<string, Canvas>();
  private glowCache = new Map<string, Canvas>();
  bw = 1;
  bh = 1;

  constructor() {
    this.lm = makeCanvas(1, 1);
    this.g = ctx2d(this.lm);
    this.key = makeCanvas(1, 1);
  }

  resize(bw: number, bh: number): void {
    if (bw === this.bw && bh === this.bh) return;
    this.bw = bw;
    this.bh = bh;
    this.lm.width = bw;
    this.lm.height = bh;
    this.g = ctx2d(this.lm);
    this.key = this.buildKey(bw, bh);
  }

  /** Key light from the top-left plus a vignette, banded per art pixel row/column. */
  private buildKey(bw: number, bh: number): Canvas {
    const c = makeCanvas(bw, bh);
    const g = ctx2d(c);
    const d = g.createImageData(bw, bh);
    const p = d.data;
    const cx = bw / 2, cy = bh / 2;
    const rr = Math.hypot(cx, cy);
    for (let y = 0; y < bh; y++)
      for (let x = 0; x < bw; x++) {
        const key = 1.0 - 0.1 * (0.6 * (x / bw) + 0.4 * (y / bh));
        const r = Math.hypot(x - cx, (y - cy) * 1.15) / rr;
        const vig = 1 - 0.26 * Math.pow(clamp((r - 0.45) / 0.6, 0, 1), 1.6);
        const v = Math.round(255 * key * vig);
        const i = (y * bw + x) * 4;
        p[i] = v;
        p[i + 1] = v;
        p[i + 2] = Math.round(v * 0.985);
        p[i + 3] = 255;
      }
    g.putImageData(d, 0, 0);
    return c;
  }

  /** Radial light in flat bands (white), radius r. */
  private radialOf(r: number): Canvas {
    let c = this.radial.get(r);
    if (c) return c;
    const s = r * 2;
    c = makeCanvas(s, s);
    const g = ctx2d(c);
    const d = g.createImageData(s, s);
    const p = d.data;
    for (let y = 0; y < s; y++)
      for (let x = 0; x < s; x++) {
        const t = 1 - Math.hypot(x - r + 0.5, y - r + 0.5) / r;
        if (t <= 0) continue;
        // smooth falloff with a bright core and a long soft tail, quantised to BANDS flat steps
        const sm = t * t * (3 - 2 * t);
        const a = Math.round(Math.pow(sm, 1.35) * BANDS) / BANDS;
        const i = (y * s + x) * 4;
        p[i] = p[i + 1] = p[i + 2] = 255;
        p[i + 3] = Math.round(255 * a);
      }
    g.putImageData(d, 0, 0);
    this.radial.set(r, c);
    return c;
  }

  lightSprite(r: number, color: string): Canvas {
    const rq = Math.max(4, Math.round(r / 4) * 4);
    const key = `${rq}|${color}`;
    let c = this.tinted.get(key);
    if (c) return c;
    const base = this.radialOf(rq);
    c = makeCanvas(base.width, base.height);
    const g = ctx2d(c);
    g.drawImage(base, 0, 0);
    g.globalCompositeOperation = "source-in";
    g.fillStyle = color;
    g.fillRect(0, 0, c.width, c.height);
    if (this.tinted.size > 160) this.tinted.clear();
    this.tinted.set(key, c);
    return c;
  }

  /** Small soft glow sprite (for additive halos). */
  glow(r: number, color: string): Canvas {
    const rq = Math.max(2, Math.round(r));
    const key = `${rq}|${color}`;
    let c = this.glowCache.get(key);
    if (c) return c;
    const s = rq * 2;
    c = makeCanvas(s, s);
    const g = ctx2d(c);
    const d = g.createImageData(s, s);
    const p = d.data;
    const [cr, cg, cb] = parseColor(color);
    for (let y = 0; y < s; y++)
      for (let x = 0; x < s; x++) {
        const t = 1 - Math.hypot(x - rq + 0.5, y - rq + 0.5) / rq;
        if (t <= 0) continue;
        const band = Math.ceil(t * 4) / 4;
        const i = (y * s + x) * 4;
        p[i] = cr;
        p[i + 1] = cg;
        p[i + 2] = cb;
        p[i + 3] = Math.round(255 * band * band);
      }
    g.putImageData(d, 0, 0);
    if (this.glowCache.size > 120) this.glowCache.clear();
    this.glowCache.set(key, c);
    return c;
  }

  begin(amb: RGB): Ctx {
    const g = this.g;
    g.globalCompositeOperation = "source-over";
    g.globalAlpha = 1;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = `rgb(${Math.round(amb[0] * 255)},${Math.round(amb[1] * 255)},${Math.round(amb[2] * 255)})`;
    g.fillRect(0, 0, this.bw, this.bh);
    g.globalCompositeOperation = "multiply";
    g.drawImage(this.key, 0, 0);
    g.globalCompositeOperation = "lighter";
    return g;
  }

  /** Add a light at buffer coordinates. */
  add(bx: number, by: number, r: number, color: string, intensity: number): void {
    if (intensity <= 0.01 || r < 2) return;
    const s = this.lightSprite(r, color);
    const h = s.width / 2;
    if (bx + h < 0 || by + h < 0 || bx - h > this.bw || by - h > this.bh) return;
    this.g.globalAlpha = clamp(intensity, 0, 1);
    this.g.drawImage(s, Math.round(bx - h), Math.round(by - h));
  }

  apply(scene: Ctx): void {
    this.g.globalAlpha = 1;
    this.g.globalCompositeOperation = "source-over";
    scene.save();
    scene.setTransform(1, 0, 0, 1, 0, 0);
    scene.globalCompositeOperation = "multiply";
    scene.drawImage(this.lm, 0, 0);
    scene.restore();
  }
}

/** Flicker multiplier for a light (deterministic per light, off with reduced motion). */
export function flicker(t: number, seed: number, reduced: boolean): number {
  if (reduced) return 1;
  const a = Math.sin(t * 11.3 + seed * 1.7) * 0.5 + Math.sin(t * 17.9 + seed * 3.1) * 0.3 + Math.sin(t * 5.1 + seed) * 0.2;
  const step = Math.floor(t * 12 + seed * 7);
  return 0.92 + a * 0.05 + (hash2(step, seed | 0, 3) - 0.5) * 0.06;
}

/** A pre-rendered light shaft (window beam or sunbeam) as a banded additive parallelogram. */
export function makeShaft(w: number, h: number, kind: "window" | "sunbeam"): Canvas {
  const W = Math.max(4, Math.round(w)), H = Math.max(4, Math.round(h));
  const c = makeCanvas(W, H);
  const g = ctx2d(c);
  const d = g.createImageData(W, H);
  const p = d.data;
  const beamW = kind === "window" ? W * 0.62 : W * 0.46;
  const slant = W - beamW;
  const col = kind === "window" ? [255, 226, 160] : [255, 244, 196];
  for (let y = 0; y < H; y++) {
    const t = y / (H - 1);
    const x0 = slant * t;
    const along = kind === "window" ? Math.pow(1 - t, 1.2) * 0.9 + 0.1 : 0.55 + 0.45 * Math.sin(Math.PI * t);
    for (let x = 0; x < W; x++) {
      const u = (x - x0) / beamW;
      if (u < 0 || u > 1) continue;
      const across = Math.min(1, Math.min(u, 1 - u) * 5);
      let a = along * across;
      a = Math.ceil(a * 5) / 5;
      if (a <= 0) continue;
      // dust motes: faint dotted texture keeps the beam from looking like a flat quad
      const mote = hash2(x, y, 41) < 0.03 ? 1.6 : 1;
      const i = (y * W + x) * 4;
      p[i] = col[0];
      p[i + 1] = col[1];
      p[i + 2] = col[2];
      p[i + 3] = Math.round(255 * clamp(a * mote, 0, 1));
    }
  }
  g.putImageData(d, 0, 0);
  return c;
}

/** Tileable 256×256 fog texture: large soft wisps (low-frequency noise) in 8 alpha levels. */
let FOG: Canvas | null = null;
export const FOG_TILE = 256;
export function fogTexture(): Canvas {
  if (FOG) return FOG;
  const N = FOG_TILE;
  const c = makeCanvas(N, N);
  const g = ctx2d(c);
  const d = g.createImageData(N, N);
  const p = d.data;
  const nz = noiseTable();
  // the 256 noise table is periodic, so a 1:1 read (plus a coarser octave) tiles seamlessly
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const lo = nz[((y >> 1) & 255) * 256 + ((x >> 1) & 255)];
      const hi = nz[((y + 91) & 255) * 256 + ((x + 37) & 255)];
      const v = lo * 0.72 + hi * 0.28;
      const a = clamp((v - 0.36) / 0.34, 0, 1);
      const sm = a * a * (3 - 2 * a);
      const level = Math.round(sm * 8) / 8;
      const i = (y * N + x) * 4;
      p[i] = 232;
      p[i + 1] = 240;
      p[i + 2] = 242;
      p[i + 3] = Math.round(255 * level);
    }
  g.putImageData(d, 0, 0);
  FOG = c;
  return c;
}

/**
 * Edge mask for a fog rect: full inside, falling off over `edge` px towards the rect's sides with
 * a noisy, organic border (no visible rectangle), in 8 flat levels.
 */
export function fogMask(w: number, h: number, edge: number, seed: number): Canvas {
  const c = makeCanvas(w, h);
  const g = ctx2d(c);
  const d = g.createImageData(w, h);
  const p = d.data;
  const nz = noiseTable();
  const ox = (seed * 53) & 255, oy = (seed * 97) & 255;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const n = nz[((y + oy) & 255) * 256 + ((x + ox) & 255)];
      const e = Math.min(x, y, w - 1 - x, h - 1 - y) / edge + (n - 0.5) * 0.9;
      const a = clamp(e, 0, 1);
      const level = Math.round(a * a * (3 - 2 * a) * 8) / 8;
      const i = (y * w + x) * 4;
      p[i] = p[i + 1] = p[i + 2] = 255;
      p[i + 3] = Math.round(255 * level);
    }
  g.putImageData(d, 0, 0);
  return c;
}
