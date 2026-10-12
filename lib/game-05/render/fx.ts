/**
 * Game 05 visual effects (render lane): pixel particles, one-shot atlas animations and a few
 * procedural effects (light columns, pixel rings, chest rays), all at 1x in the art buffer.
 * "Lit" effects (dust, leaves, shards, blood) are drawn before the light map; "emissive" ones
 * (slashes, sparks, magic, glows) after it, so they stay bright at night.
 */
import type { Dir4 } from "../contract";
import { animDuration, frameAt, resolveAnim, type AtlasRT, type ResolvedAnim, type SheetRT } from "./atlas";
import { clamp, ctx2d, makeCanvas, type Canvas, type Ctx } from "./util";

const CAP = 900;
export const F_EMIT = 1;
export const F_BOUNCE = 2;
export const F_FADE = 4;
export const F_SPRITE = 8;
export const F_FLICKER = 16;

export class Particles {
  n = 0;
  x = new Float32Array(CAP);
  y = new Float32Array(CAP);
  z = new Float32Array(CAP);
  vx = new Float32Array(CAP);
  vy = new Float32Array(CAP);
  vz = new Float32Array(CAP);
  life = new Float32Array(CAP);
  max = new Float32Array(CAP);
  grav = new Float32Array(CAP);
  drag = new Float32Array(CAP);
  size = new Uint8Array(CAP);
  color = new Uint16Array(CAP);
  color2 = new Uint16Array(CAP);
  flags = new Uint8Array(CAP);
  frame = new Int16Array(CAP);
  sheets: Array<SheetRT | null> = new Array(CAP).fill(null);
  private palette: string[] = [];
  private palIdx = new Map<string, number>();

  col(c: string): number {
    let i = this.palIdx.get(c);
    if (i === undefined) {
      i = this.palette.length;
      this.palette.push(c);
      this.palIdx.set(c, i);
    }
    return i;
  }

  spawn(o: {
    x: number; y: number; z?: number; vx?: number; vy?: number; vz?: number; life: number; grav?: number;
    drag?: number; size?: number; color?: string; color2?: string; flags?: number; sheet?: SheetRT | null; frame?: number;
  }): void {
    let i = this.n;
    if (i >= CAP) {
      // recycle the oldest-looking slot
      i = Math.floor(Math.random() * CAP);
    } else this.n++;
    this.x[i] = o.x;
    this.y[i] = o.y;
    this.z[i] = o.z ?? 0;
    this.vx[i] = o.vx ?? 0;
    this.vy[i] = o.vy ?? 0;
    this.vz[i] = o.vz ?? 0;
    this.life[i] = o.life;
    this.max[i] = o.life;
    this.grav[i] = o.grav ?? 0;
    this.drag[i] = o.drag ?? 0;
    this.size[i] = o.size ?? 1;
    this.color[i] = this.col(o.color ?? "#ffffff");
    this.color2[i] = this.col(o.color2 ?? o.color ?? "#ffffff");
    this.flags[i] = o.flags ?? 0;
    this.sheets[i] = o.sheet ?? null;
    this.frame[i] = o.frame ?? 0;
  }

  update(dt: number): void {
    let n = this.n;
    for (let i = 0; i < n; i++) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        n--;
        this.copy(n, i);
        i--;
        continue;
      }
      const dr = this.drag[i];
      if (dr) {
        const k = Math.exp(-dr * dt);
        this.vx[i] *= k;
        this.vy[i] *= k;
      }
      this.x[i] += this.vx[i] * dt;
      this.y[i] += this.vy[i] * dt;
      if (this.grav[i] || this.vz[i]) {
        this.vz[i] -= this.grav[i] * dt;
        this.z[i] += this.vz[i] * dt;
        if (this.z[i] < 0) {
          this.z[i] = 0;
          if (this.flags[i] & F_BOUNCE && this.vz[i] < -30) {
            this.vz[i] *= -0.35;
            this.vx[i] *= 0.6;
            this.vy[i] *= 0.6;
          } else {
            this.vz[i] = 0;
            this.vx[i] *= 0.5;
            this.vy[i] *= 0.5;
          }
        }
      }
    }
    this.n = n;
  }

  private copy(from: number, to: number): void {
    if (from === to) return;
    this.x[to] = this.x[from];
    this.y[to] = this.y[from];
    this.z[to] = this.z[from];
    this.vx[to] = this.vx[from];
    this.vy[to] = this.vy[from];
    this.vz[to] = this.vz[from];
    this.life[to] = this.life[from];
    this.max[to] = this.max[from];
    this.grav[to] = this.grav[from];
    this.drag[to] = this.drag[from];
    this.size[to] = this.size[from];
    this.color[to] = this.color[from];
    this.color2[to] = this.color2[from];
    this.flags[to] = this.flags[from];
    this.frame[to] = this.frame[from];
    this.sheets[to] = this.sheets[from];
  }

  draw(g: Ctx, ox: number, oy: number, emissive: boolean, t: number): void {
    const pal = this.palette;
    let last = -1;
    for (let i = 0; i < this.n; i++) {
      const f = this.flags[i];
      if (!!(f & F_EMIT) !== emissive) continue;
      const k = this.life[i] / this.max[i];
      if (f & F_FLICKER && ((t * 30 + i) | 0) % 3 === 0) continue;
      const sx = Math.round(this.x[i]) - ox;
      const sy = Math.round(this.y[i] - this.z[i]) - oy;
      g.globalAlpha = f & F_FADE ? clamp(k * 2, 0, 1) : 1;
      if (f & F_SPRITE) {
        const sh = this.sheets[i];
        if (!sh) continue;
        const fi = this.frame[i];
        g.drawImage(sh.img, sh.fx(fi), sh.fy(fi), sh.w, sh.h, sx - sh.ax, sy - sh.ay, sh.w, sh.h);
        last = -1;
        continue;
      }
      const ci = k > 0.5 ? this.color[i] : this.color2[i];
      if (ci !== last) {
        g.fillStyle = pal[ci];
        last = ci;
      }
      const s = this.size[i];
      const ss = s > 1 && k < 0.35 ? s - 1 : s;
      g.fillRect(sx - (ss >> 1), sy - (ss >> 1), ss, ss);
    }
    g.globalAlpha = 1;
  }

  clear(): void {
    this.n = 0;
  }
}

export interface SpriteFx {
  sheet: SheetRT;
  anim: ResolvedAnim;
  x: number;
  y: number;
  t: number;
  dur: number;
  emissive: boolean;
  /** Follow the hero: x/y are offsets from the hero's feet. */
  follow: boolean;
  alpha: number;
  hold?: number;
}

export type Special =
  | { kind: "column"; x: number; y: number; t: number; dur: number; color: string; w: number; h: number; follow: boolean }
  | { kind: "ring"; x: number; y: number; t: number; dur: number; r0: number; r1: number; color: string; follow: boolean; thick: number }
  | { kind: "rays"; x: number; y: number; t: number; dur: number; color: string };

/** Pixel circle outline (midpoint), cached per radius/colour/thickness. */
const RINGS = new Map<string, Canvas>();
export function ringSprite(r: number, color: string, thick = 1): Canvas {
  const R = Math.max(1, Math.round(r));
  const key = `${R}|${color}|${thick}`;
  let c = RINGS.get(key);
  if (c) return c;
  const s = R * 2 + 3;
  c = makeCanvas(s, s);
  const g = ctx2d(c);
  g.fillStyle = color;
  const cx = R + 1, cy = R + 1;
  for (let y = -R - 1; y <= R + 1; y++)
    for (let x = -R - 1; x <= R + 1; x++) {
      const d = Math.hypot(x, y * 1.18);
      if (d <= R + 0.5 && d > R + 0.5 - thick) g.fillRect(cx + x, cy + y, 1, 1);
    }
  if (RINGS.size > 400) RINGS.clear();
  RINGS.set(key, c);
  return c;
}

const COLUMNS = new Map<string, Canvas>();
function columnSprite(w: number, h: number, color: string): Canvas {
  const key = `${w}|${h}|${color}`;
  let c = COLUMNS.get(key);
  if (c) return c;
  c = makeCanvas(w, h);
  const g = ctx2d(c);
  const d = g.createImageData(w, h);
  const p = d.data;
  const m = color.match(/#(..)(..)(..)/);
  const rgb = m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [255, 240, 160];
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const u = Math.abs(x + 0.5 - w / 2) / (w / 2);
      const across = 1 - u * u;
      const v = y / h;
      const along = v < 0.15 ? v / 0.15 : 1 - Math.pow((v - 0.15) / 0.85, 3) * 0.3;
      const a = Math.ceil(clamp(across * along, 0, 1) * 5) / 5;
      const core = u < 0.25 ? 1 : 0;
      const i = (y * w + x) * 4;
      p[i] = core ? 255 : rgb[0];
      p[i + 1] = core ? 255 : rgb[1];
      p[i + 2] = core ? 240 : rgb[2];
      p[i + 3] = Math.round(255 * a);
    }
  g.putImageData(d, 0, 0);
  COLUMNS.set(key, c);
  return c;
}

export class Fx {
  readonly parts = new Particles();
  sprites: SpriteFx[] = [];
  specials: Special[] = [];
  private atlas: AtlasRT;

  constructor(atlas: AtlasRT) {
    this.atlas = atlas;
  }

  clear(): void {
    this.parts.clear();
    this.sprites.length = 0;
    this.specials.length = 0;
  }

  /** Play a one-shot atlas animation. Returns false if the sheet/anim is missing. */
  play(key: string, names: readonly string[], x: number, y: number, o: {
    dir?: Dir4; flip?: boolean; emissive?: boolean; follow?: boolean; alpha?: number; hold?: number;
  } = {}): boolean {
    const sh = this.atlas.sheets.get(key);
    if (!sh) return false;
    const a = resolveAnim(sh, names, o.dir ?? "down");
    if (!a) return false;
    const anim = o.flip ? { ...a, flip: !a.flip } : a;
    const dur = Math.max(0.05, animDuration(a) || 0.3);
    this.sprites.push({ sheet: sh, anim, x, y, t: 0, dur: dur + (o.hold ?? 0), emissive: o.emissive ?? true,
      follow: o.follow ?? false, alpha: o.alpha ?? 1, hold: o.hold });
    return true;
  }

  special(s: Special): void {
    this.specials.push(s);
  }

  /** Burst of pixel particles. */
  burst(x: number, y: number, n: number, o: {
    colors: string[]; speed: [number, number]; up?: [number, number]; life: [number, number]; grav?: number;
    size?: [number, number]; z?: number; emissive?: boolean; bounce?: boolean; fade?: boolean; drag?: number;
    spread?: number; angle?: number; arc?: number; flicker?: boolean;
  }): void {
    for (let i = 0; i < n; i++) {
      const ang = o.angle !== undefined ? o.angle + (Math.random() - 0.5) * (o.arc ?? Math.PI * 2) : Math.random() * Math.PI * 2;
      const sp = o.speed[0] + Math.random() * (o.speed[1] - o.speed[0]);
      const c = o.colors[(Math.random() * o.colors.length) | 0];
      const c2 = o.colors[Math.min(o.colors.length - 1, ((Math.random() * o.colors.length) | 0) + 1)];
      const sz = o.size ? o.size[0] + Math.round(Math.random() * (o.size[1] - o.size[0])) : 1;
      this.parts.spawn({
        x: x + (Math.random() - 0.5) * (o.spread ?? 0) * 2,
        y: y + (Math.random() - 0.5) * (o.spread ?? 0),
        z: o.z ?? 0,
        vx: Math.cos(ang) * sp,
        vy: Math.sin(ang) * sp * 0.6,
        vz: o.up ? o.up[0] + Math.random() * (o.up[1] - o.up[0]) : 0,
        life: o.life[0] + Math.random() * (o.life[1] - o.life[0]),
        grav: o.grav ?? 0,
        drag: o.drag ?? 0,
        size: sz,
        color: c,
        color2: c2,
        flags: (o.emissive ? F_EMIT : 0) | (o.bounce ? F_BOUNCE : 0) | (o.fade !== false ? F_FADE : 0) | (o.flicker ? F_FLICKER : 0),
      });
    }
  }

  /**
   * Particles that are atlas frames (leaves, coins, sparks): each particle takes a random frame of
   * the first anim of `anims` the sheet has (e.g. ["leaf", "p"]).
   */
  frames(key: string, x: number, y: number, n: number, anims: readonly string[], o: {
    speed: [number, number]; up: [number, number]; life: [number, number]; grav: number; z?: number; emissive?: boolean;
    spread?: number; drag?: number;
  }): boolean {
    const sh = this.atlas.sheets.get(key);
    const a = sh ? resolveAnim(sh, anims, "down") : null;
    const frameList = a?.frames ?? [];
    if (!sh || !frameList.length) return false;
    for (let i = 0; i < n; i++) {
      const ang = Math.random() * Math.PI * 2;
      const sp = o.speed[0] + Math.random() * (o.speed[1] - o.speed[0]);
      this.parts.spawn({
        x: x + (Math.random() - 0.5) * (o.spread ?? 0) * 2,
        y: y + (Math.random() - 0.5) * (o.spread ?? 0),
        z: o.z ?? 0,
        vx: Math.cos(ang) * sp,
        vy: Math.sin(ang) * sp * 0.6,
        vz: o.up[0] + Math.random() * (o.up[1] - o.up[0]),
        life: o.life[0] + Math.random() * (o.life[1] - o.life[0]),
        grav: o.grav,
        drag: o.drag ?? 1.5,
        flags: F_SPRITE | F_FADE | (o.emissive ? F_EMIT : 0),
        sheet: sh,
        frame: frameList[(Math.random() * frameList.length) | 0],
      });
    }
    return true;
  }

  update(dt: number): void {
    this.parts.update(dt);
    let j = 0;
    for (const s of this.sprites) {
      s.t += dt;
      if (s.t < s.dur) this.sprites[j++] = s;
    }
    this.sprites.length = j;
    j = 0;
    for (const s of this.specials) {
      s.t += dt;
      if (s.t < s.dur) this.specials[j++] = s;
    }
    this.specials.length = j;
  }

  drawSprites(g: Ctx, ox: number, oy: number, emissive: boolean, heroX: number, heroY: number): void {
    for (const s of this.sprites) {
      if (s.emissive !== emissive) continue;
      const sh = s.sheet;
      const fi = frameAt(s.anim, Math.min(s.t, animDuration(s.anim) - 1e-4));
      const flip = s.anim.flip;
      const fy = sh.fy(fi);
      const sx = sh.srcX(fi, flip);
      const bx = Math.round(s.follow ? heroX + s.x : s.x) - ox - (flip ? sh.w - sh.ax : sh.ax);
      const by = Math.round(s.follow ? heroY + s.y : s.y) - oy - sh.ay;
      const fade = s.hold && s.t > s.dur - 0.2 ? clamp((s.dur - s.t) / 0.2, 0, 1) : 1;
      g.globalAlpha = s.alpha * fade;
      g.drawImage(sh.page("normal", flip), sx, fy, sh.w, sh.h, bx, by, sh.w, sh.h);
    }
    g.globalAlpha = 1;
  }

  drawSpecials(g: Ctx, ox: number, oy: number, heroX: number, heroY: number): void {
    for (const s of this.specials) {
      const k = s.t / s.dur;
      if (s.kind === "column") {
        const cx = (s.follow ? heroX : s.x) - ox;
        const cy = (s.follow ? heroY : s.y) - oy;
        const grow = clamp(k / 0.15, 0, 1);
        const a = k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3;
        const h = Math.round(s.h * grow);
        const spr = columnSprite(s.w, s.h, s.color);
        g.globalAlpha = a * 0.85;
        g.globalCompositeOperation = "lighter";
        g.drawImage(spr, 0, s.h - h, s.w, h, Math.round(cx - s.w / 2), Math.round(cy - h + 4), s.w, h);
        g.globalCompositeOperation = "source-over";
      } else if (s.kind === "ring") {
        const cx = (s.follow ? heroX : s.x) - ox;
        const cy = (s.follow ? heroY : s.y) - oy;
        const e = 1 - Math.pow(1 - k, 2.2);
        const r = s.r0 + (s.r1 - s.r0) * e;
        const spr = ringSprite(r, s.color, s.thick);
        g.globalAlpha = 1 - k * k;
        g.drawImage(spr, Math.round(cx - spr.width / 2), Math.round(cy - spr.height / 2));
      } else if (s.kind === "rays") {
        const cx = Math.round(s.x - ox), cy = Math.round(s.y - oy);
        const a = k < 0.2 ? k / 0.2 : 1 - (k - 0.2) / 0.8;
        g.globalAlpha = clamp(a, 0, 1) * 0.8;
        g.globalCompositeOperation = "lighter";
        g.fillStyle = s.color;
        const n = 8;
        for (let i = 0; i < n; i++) {
          const ang = (i / n) * Math.PI * 2 + s.t * 0.8;
          const len = 10 + 8 * Math.sin(s.t * 6 + i);
          for (let d = 4; d < len + 4; d++) {
            const px = Math.round(cx + Math.cos(ang) * d);
            const py = Math.round(cy + Math.sin(ang) * d * 0.8);
            g.fillRect(px, py, 1, 1);
          }
        }
        g.globalCompositeOperation = "source-over";
      }
    }
    g.globalAlpha = 1;
  }
}
