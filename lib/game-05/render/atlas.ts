/**
 * Game 05 atlas runtime (render lane): loads `${assetBase}/art/atlas.json` and its images, resolves
 * animations to frames, and bakes per-sheet variants on demand (mirrored, white flash silhouette,
 * elite warm tint, red telegraph). Image paths in atlas.json are relative to the atlas file.
 * Sprites are only ever drawn at 1x; mirroring is an exact pixel flip.
 */
import type { Atlas, AtlasAnim, AtlasSheet, Dir4 } from "../contract";
import { ctx2d, makeCanvas, type Canvas } from "./util";

export interface GroundSwatch {
  /** Image width = 32 × variants. */
  w: number;
  h: number;
  variants: number;
  data: Uint8ClampedArray;
}

/** Optional per-sheet extras the renderer understands (extra JSON fields are allowed). */
interface SheetExtras {
  /** Origin of the frame grid inside a packed page. */
  x?: number;
  y?: number;
  dev?: boolean;
}

export type Variant = "normal" | "white" | "elite" | "red";
const VARIANT_INDEX: Record<Variant, number> = { normal: 0, white: 1, elite: 2, red: 3 };

export class SheetRT {
  readonly key: string;
  readonly def: AtlasSheet & SheetExtras;
  readonly img: HTMLImageElement;
  readonly cols: number;
  readonly ox: number;
  readonly oy: number;
  /** Rows of empty space above the highest opaque pixel over all frames (for markers). */
  topPad = 0;
  /** Baked variant pages: index = VARIANTS.indexOf(variant) * 2 + (flip ? 1 : 0). */
  private baked: Array<Canvas | undefined> = [];
  /** resolveAnim results by "names|dir" (anims never change after load). */
  readonly animCache = new Map<string, ResolvedAnim | null>();

  constructor(key: string, def: AtlasSheet & SheetExtras, img: HTMLImageElement) {
    this.key = key;
    this.def = def;
    this.img = img;
    this.ox = def.x ?? 0;
    this.oy = def.y ?? 0;
    this.cols = Math.max(1, Math.floor((img.naturalWidth - this.ox) / def.w));
  }

  get w(): number {
    return this.def.w;
  }
  get h(): number {
    return this.def.h;
  }
  get ax(): number {
    return this.def.anchor.x;
  }
  get ay(): number {
    return this.def.anchor.y;
  }

  frameXY(index: number): [number, number] {
    return [this.fx(index), this.fy(index)];
  }

  /** Source x / y of a frame cell (no allocation; used per blit). */
  fx(index: number): number {
    return this.ox + (index % this.cols) * this.def.w;
  }
  fy(index: number): number {
    return this.oy + Math.floor(index / this.cols) * this.def.h;
  }

  /** The page (or a baked variant of it); mirrored pages are flipped as a whole. */
  page(variant: Variant, flip: boolean): CanvasImageSource {
    if (variant === "normal" && !flip) return this.img;
    const key = VARIANT_INDEX[variant] * 2 + (flip ? 1 : 0);
    let c = this.baked[key];
    if (c) return c;
    const W = this.img.naturalWidth;
    const H = this.img.naturalHeight;
    c = makeCanvas(W, H);
    const g = ctx2d(c, { willReadFrequently: variant === "elite" });
    if (flip) {
      const src = variant === "normal" ? this.img : this.page(variant, false);
      g.setTransform(-1, 0, 0, 1, W, 0);
      g.drawImage(src, 0, 0);
      g.setTransform(1, 0, 0, 1, 0, 0);
    } else {
      if (variant === "white" || variant === "red") {
        g.drawImage(this.img, 0, 0);
        g.globalCompositeOperation = "source-in";
        g.fillStyle = variant === "white" ? "#ffffff" : "#ff3a22";
        g.fillRect(0, 0, W, H);
        g.globalCompositeOperation = "source-over";
      } else if (variant === "elite") {
        // elite: a warm crimson-to-gold palette shift plus a 1 px gold rim around the silhouette
        // (per frame cell, so neighbours never bleed), readable whatever the base palette is
        g.drawImage(this.img, 0, 0);
        const d = g.getImageData(0, 0, W, H);
        const p = d.data;
        const src = new Uint8Array(W * H);
        for (let i = 0, j = 3; i < W * H; i++, j += 4) src[i] = p[j] > 0 ? 1 : 0;
        for (let i = 0; i < p.length; i += 4) {
          if (p[i + 3] === 0) continue;
          const L = (p[i] * 0.3 + p[i + 1] * 0.55 + p[i + 2] * 0.15) / 255;
          let r: number, gg: number, b: number;
          if (L < 0.33) {
            const t = L / 0.33;
            r = 60 + 110 * t;
            gg = 10 + 18 * t;
            b = 30 + 10 * t;
          } else if (L < 0.66) {
            const t = (L - 0.33) / 0.33;
            r = 170 + 70 * t;
            gg = 28 + 100 * t;
            b = 40 - 10 * t;
          } else {
            const t = (L - 0.66) / 0.34;
            r = 240 + 15 * t;
            gg = 128 + 100 * t;
            b = 30 + 120 * t;
          }
          p[i] = p[i] * 0.25 + r * 0.75;
          p[i + 1] = p[i + 1] * 0.25 + gg * 0.75;
          p[i + 2] = p[i + 2] * 0.25 + b * 0.75;
        }
        const cw = this.def.w, ch = this.def.h, ox = this.ox, oy = this.oy;
        for (let y = 0; y < H; y++)
          for (let x = 0; x < W; x++) {
            const i = y * W + x;
            if (src[i]) continue;
            const lx = (x - ox) % cw, ly = (y - oy) % ch;
            if (x < ox || y < oy) continue;
            const n = (lx > 0 && src[i - 1]) || (lx < cw - 1 && x + 1 < W && src[i + 1]) ||
              (ly > 0 && src[i - W]) || (ly < ch - 1 && y + 1 < H && src[i + W]);
            if (!n) continue;
            const j = i * 4;
            const top = ly > 0 && !src[i - W] && y + 1 < H && src[i + W];
            p[j] = top ? 255 : 232;
            p[j + 1] = top ? 226 : 168;
            p[j + 2] = top ? 120 : 48;
            p[j + 3] = 255;
          }
        g.putImageData(d, 0, 0);
      }
    }
    this.baked[key] = c;
    return c;
  }

  /** Source x of a frame inside the (possibly mirrored) page. */
  srcX(index: number, flip: boolean): number {
    const x = this.fx(index);
    return flip ? this.img.naturalWidth - x - this.def.w : x;
  }
}

export interface ResolvedAnim {
  frames: number[];
  fps: number;
  loop: boolean;
  flip: boolean;
  /** 8 frames, one per 45° starting at angle 0 (screen right), clockwise (+y down). */
  octants: boolean;
}

/** The first of `names` the sheet has, for a facing (cached per sheet: anims never change). */
export function resolveAnim(sheet: SheetRT, names: readonly string[], dir: Dir4): ResolvedAnim | null {
  const key = names.length === 1 ? names[0] + "|" + dir : names.join(",") + "|" + dir;
  const hit = sheet.animCache.get(key);
  if (hit !== undefined) return hit;
  const r = resolveAnimUncached(sheet, names, dir);
  if (sheet.animCache.size > 512) sheet.animCache.clear();
  sheet.animCache.set(key, r);
  return r;
}

function resolveAnimUncached(sheet: SheetRT, names: readonly string[], dir: Dir4): ResolvedAnim | null {
  for (const name of names) {
    const a = sheet.def.anims[name] as (AtlasAnim & { octants?: boolean }) | undefined;
    if (!a) continue;
    const base = { fps: a.fps, loop: a.loop, octants: !!a.octants };
    if (Array.isArray(a.frames)) return { frames: a.frames, flip: false, ...base };
    const f = a.frames;
    const direct = f[dir];
    if (direct && direct.length) return { frames: direct, flip: false, ...base };
    if (dir === "right" && f.left?.length) return { frames: f.left, flip: true, ...base };
    if (dir === "left" && f.right?.length) return { frames: f.right, flip: true, ...base };
    const any = f.down ?? f.left ?? f.up ?? f.right;
    if (any && any.length) return { frames: any, flip: false, ...base };
  }
  return null;
}

export function frameAt(a: ResolvedAnim, t: number): number {
  const n = a.frames.length;
  if (n <= 1 || a.fps <= 0) return a.frames[0];
  const i = Math.floor(Math.max(0, t) * a.fps);
  return a.frames[a.loop ? i % n : Math.min(i, n - 1)];
}

export function animDuration(a: ResolvedAnim): number {
  return a.fps > 0 ? a.frames.length / a.fps : 0;
}

export class AtlasRT {
  readonly base: string;
  atlas: Atlas | null = null;
  readonly sheets = new Map<string, SheetRT>();
  readonly ground = new Map<string, GroundSwatch>();
  private icons = new Map<string, HTMLImageElement | "loading" | "missing">();
  private warned = new Set<string>();
  /** Keys whose image failed to load (the view skips them instead of failing to start). */
  readonly failed: string[] = [];

  constructor(assetBase: string) {
    const b = assetBase.replace(/\/+$/, "");
    this.base = `${b}/art/`;
  }

  async load(onProgress?: (f: number) => void): Promise<void> {
    const res = await fetch(`${this.base}atlas.json`, { cache: "no-cache" });
    if (!res.ok) throw new Error(`Game 05 atlas: HTTP ${res.status}`);
    const atlas = (await res.json()) as Atlas;
    this.atlas = atlas;
    const jobs: Array<Promise<void>> = [];
    const imgCache = new Map<string, Promise<HTMLImageElement>>();
    const total = Object.keys(atlas.sheets).length + Object.keys(atlas.ground).length;
    let done = 0;
    const tick = () => {
      done++;
      onProgress?.(Math.min(1, done / Math.max(1, total)));
    };
    const loadImg = (path: string): Promise<HTMLImageElement> => {
      let p = imgCache.get(path);
      if (!p) {
        p = new Promise<HTMLImageElement>((ok, no) => {
          const im = new Image();
          im.decoding = "async";
          im.onload = () => ok(im);
          im.onerror = () => no(new Error(`Game 05 atlas: cannot load ${path}`));
          im.src = this.base + path;
        });
        imgCache.set(path, p);
      }
      return p;
    };
    // one missing or broken image must never stop the game: warn, skip that key, carry on
    const skip = (key: string) => (e: unknown) => {
      this.failed.push(key);
      console.warn(`Game 05 view: skipping "${key}": ${e instanceof Error ? e.message : String(e)}`);
      tick();
    };
    for (const [key, def] of Object.entries(atlas.sheets)) {
      if (!def || typeof def.image !== "string" || !(def.w > 0) || !(def.h > 0) || !def.anchor || !def.anims) {
        skip(key)(new Error("malformed sheet"));
        continue;
      }
      jobs.push(
        loadImg(def.image).then((im) => {
          const s = new SheetRT(key, def, im);
          s.topPad = measureTopPad(s);
          this.sheets.set(key, s);
          tick();
        }, skip(key)),
      );
    }
    for (const [key, g] of Object.entries(atlas.ground)) {
      jobs.push(
        loadImg(g.image).then((im) => {
          const c = makeCanvas(im.naturalWidth, im.naturalHeight);
          const x = ctx2d(c, { willReadFrequently: true });
          x.drawImage(im, 0, 0);
          const d = x.getImageData(0, 0, c.width, c.height);
          this.ground.set(key, { w: c.width, h: c.height, variants: Math.max(1, g.variants | 0), data: d.data });
          tick();
        }, skip(`ground:${key}`)),
      );
    }
    await Promise.all(jobs);
    if (this.failed.length) await this.loadDevFallback(loadImg);
  }

  /**
   * Keys whose final art failed to load fall back to the render lane's dev placeholder for the same
   * key (art/dev/atlas.dev.json, image paths relative to art/), so a half-finished art drop never
   * leaves a hole in the world.
   */
  private async loadDevFallback(loadImg: (path: string) => Promise<HTMLImageElement>): Promise<void> {
    let dev: Atlas | null = null;
    try {
      const res = await fetch(`${this.base}dev/atlas.dev.json`, { cache: "no-cache" });
      if (res.ok) dev = (await res.json()) as Atlas;
    } catch {
      dev = null;
    }
    if (!dev) return;
    const jobs: Array<Promise<void>> = [];
    for (const key of this.failed.splice(0)) {
      if (key.startsWith("ground:")) {
        const g = dev.ground[key.slice(7)];
        if (!g) continue;
        jobs.push(loadImg(g.image).then((im) => {
          const c = makeCanvas(im.naturalWidth, im.naturalHeight);
          const x = ctx2d(c, { willReadFrequently: true });
          x.drawImage(im, 0, 0);
          this.ground.set(key.slice(7), { w: c.width, h: c.height, variants: Math.max(1, g.variants | 0), data: x.getImageData(0, 0, c.width, c.height).data });
        }, () => void this.failed.push(key)));
        continue;
      }
      const def = dev.sheets[key];
      if (!def) {
        this.failed.push(key);
        continue;
      }
      jobs.push(loadImg(def.image).then((im) => {
        const s = new SheetRT(key, def, im);
        s.topPad = measureTopPad(s);
        this.sheets.set(key, s);
        console.warn(`Game 05 view: "${key}" uses its dev placeholder`);
      }, () => void this.failed.push(key)));
    }
    await Promise.all(jobs);
  }

  sheet(key: string): SheetRT | null {
    const s = this.sheets.get(key);
    if (!s && !this.warned.has(key)) {
      this.warned.add(key);
      console.warn(`Game 05 view: atlas has no sheet "${key}"`);
    }
    return s ?? null;
  }

  has(key: string): boolean {
    return this.sheets.has(key);
  }

  /** Item/UI icon at 1x (loaded lazily; null until ready). */
  icon(key: string): HTMLImageElement | null {
    const v = this.icons.get(key);
    if (v instanceof HTMLImageElement) return v;
    if (v) return null;
    const path = this.atlas?.icons[key];
    if (!path) {
      this.icons.set(key, "missing");
      return null;
    }
    this.icons.set(key, "loading");
    const im = new Image();
    im.onload = () => this.icons.set(key, im);
    im.onerror = () => this.icons.set(key, "missing");
    im.src = this.base + path;
    return null;
  }

  preloadIcons(): void {
    if (!this.atlas) return;
    for (const k of Object.keys(this.atlas.icons)) this.icon(k);
  }
}

function measureTopPad(s: SheetRT): number {
  try {
    const W = s.img.naturalWidth;
    const H = s.img.naturalHeight;
    const c = makeCanvas(W, H);
    const g = ctx2d(c, { willReadFrequently: true });
    g.drawImage(s.img, 0, 0);
    const p = g.getImageData(0, 0, W, H).data;
    let best = s.h;
    for (let y = 0; y < H; y++) {
      const ly = (y - s.oy) % s.h;
      if (ly >= best) continue;
      for (let x = 0; x < W; x++) {
        if (p[(y * W + x) * 4 + 3] > 0) {
          best = Math.min(best, ly);
          break;
        }
      }
    }
    return best === s.h ? 0 : best;
  } catch {
    return 0;
  }
}
