/**
 * Title key art, painted procedurally in pixel art at the game's integer scale (DIRECTION.md: one
 * art pixel = k×k device pixels). A dusk valley: dithered sky, moon, drifting clouds, three ranges
 * of mountains, the wardstone on its hill with a pale beam, a lake with reflections, Larkmoor's lit
 * windows on the shore, grass and fireflies. Original design; placeholder until painted key art.
 */
type RGB = [number, number, number];

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map(v => (v + 0.5) / 16);
const SKY: RGB[] = [[18, 16, 46], [30, 24, 70], [52, 34, 96], [88, 48, 112], [146, 70, 108], [212, 108, 92], [240, 160, 104], [252, 206, 140]];
const rgb = (c: RGB, a = 1) => a >= 1 ? `rgb(${c[0]},${c[1]},${c[2]})` : `rgba(${c[0]},${c[1]},${c[2]},${a})`;
const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t].map(Math.round) as RGB;

function rng(seed: number) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

function noise1(x: number, seed: number): number {
  const i = Math.floor(x), f = x - i;
  const h = (n: number) => { const v = Math.sin((n + seed * 131) * 12.9898) * 43758.5453; return v - Math.floor(v); };
  const u = f * f * (3 - 2 * f);
  return h(i) * (1 - u) + h(i + 1) * u;
}
const ridge = (x: number, seed: number, scale: number) =>
  noise1(x / scale, seed) * 0.6 + noise1(x / (scale / 2.3), seed + 7) * 0.28 + noise1(x / (scale / 6), seed + 13) * 0.12;

export class TitleArt {
  private readonly ctx: CanvasRenderingContext2D | null;
  private readonly base: HTMLCanvasElement;
  private readonly frame: HTMLCanvasElement;
  private raf = 0;
  private start = 0;
  private dims = { vw: 1, vh: 1, k: 1, w: 1, h: 1 };
  private stars: Array<{ x: number; y: number; p: number; b: number }> = [];
  private flies: Array<{ x: number; y: number; p: number; s: number }> = [];
  private windows: Array<{ x: number; y: number; p: number }> = [];
  /** Right edge of the near-left shore per row (the lake starts there). */
  private land: number[] = [];
  private lamps: Array<{ x: number; y: number }> = [];
  private disposed = false;

  constructor(private readonly canvas: HTMLCanvasElement, private readonly reducedMotion: boolean) {
    this.ctx = canvas.getContext("2d");
    this.base = document.createElement("canvas");
    this.frame = document.createElement("canvas");
  }

  resize(cssW: number, cssH: number, dpr: number): void {
    const w = Math.max(1, Math.round(cssW * dpr)), h = Math.max(1, Math.round(cssH * dpr));
    const k = Math.max(1, Math.floor(Math.min(w, h) / 360));
    const vw = Math.ceil(w / k), vh = Math.ceil(h / k);
    if (this.canvas.width !== w) this.canvas.width = w;
    if (this.canvas.height !== h) this.canvas.height = h;
    if (vw === this.dims.vw && vh === this.dims.vh && k === this.dims.k) return;
    this.dims = { vw, vh, k, w, h };
    this.paintBase();
    this.render(performance.now());
  }

  run(): void {
    if (this.raf || this.disposed) return;
    this.start = performance.now();
    const tick = (now: number) => {
      if (this.disposed) return;
      this.render(now);
      this.raf = this.reducedMotion ? 0 : requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  stop(): void { cancelAnimationFrame(this.raf); this.raf = 0; }
  dispose(): void { this.stop(); this.disposed = true; }

  private layout() {
    const { vw, vh } = this.dims;
    const portrait = vh > vw * 1.1;
    const horizon = Math.round(vh * (portrait ? 0.5 : 0.58));
    return { vw, vh, portrait, horizon };
  }

  /** Static layers (sky, moon, mountains, lake base, village) painted once per size. */
  private paintBase(): void {
    const { vw, vh, portrait, horizon } = this.layout();
    this.base.width = vw; this.base.height = vh;
    this.frame.width = vw; this.frame.height = vh;
    const b = this.base.getContext("2d");
    if (!b) return;
    const img = b.createImageData(vw, vh);
    const d = img.data;
    const set = (x: number, y: number, c: RGB) => { const i = (y * vw + x) * 4; d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = 255; };
    // Dithered sky, bands packed toward the horizon.
    for (let y = 0; y < horizon; y++) {
      const t = Math.pow(y / horizon, 1.35) * (SKY.length - 1);
      const i = Math.min(SKY.length - 2, Math.floor(t)), f = t - i;
      for (let x = 0; x < vw; x++) set(x, y, f > BAYER[(y & 3) * 4 + (x & 3)] ? SKY[i + 1] : SKY[i]);
    }
    // Lake: mirrored, darkened sky.
    for (let y = horizon; y < vh; y++) {
      const my = Math.max(0, 2 * horizon - y - 1);
      const t = Math.pow(my / horizon, 1.35) * (SKY.length - 1);
      const i = Math.min(SKY.length - 2, Math.floor(t)), f = t - i;
      for (let x = 0; x < vw; x++) {
        const c = f > BAYER[(y & 3) * 4 + (x & 3)] ? SKY[i + 1] : SKY[i];
        set(x, y, mix(c, [14, 20, 44], 0.45 + Math.min(0.35, (y - horizon) / vh)));
      }
    }
    b.putImageData(img, 0, 0);
    const r = rng(97);
    // Moon with a banded halo.
    // Portrait keeps the upper sky free for the logo, so the moon sits lower there.
    const moon = { x: Math.round(vw * (portrait ? 0.72 : 0.76)), y: Math.round(horizon * (portrait ? 0.64 : 0.28)), r: Math.max(10, Math.round(Math.min(vw, vh) * 0.055)) };
    for (const [rr, a] of [[3.2, 0.06], [2.3, 0.08], [1.6, 0.1]] as const) {
      b.fillStyle = `rgba(255, 236, 200, ${a})`;
      this.disc(b, moon.x, moon.y, moon.r * rr);
    }
    b.fillStyle = rgb([252, 240, 214]); this.disc(b, moon.x, moon.y, moon.r);
    b.fillStyle = rgb([232, 214, 186]);
    this.disc(b, moon.x + moon.r * 0.3, moon.y - moon.r * 0.2, moon.r * 0.28);
    this.disc(b, moon.x - moon.r * 0.35, moon.y + moon.r * 0.35, moon.r * 0.18);
    this.disc(b, moon.x + moon.r * 0.15, moon.y + moon.r * 0.5, moon.r * 0.12);
    // Stars.
    this.stars = [];
    for (let i = 0; i < Math.round(vw * horizon / 900); i++) {
      const y = Math.floor(Math.pow(r(), 1.6) * horizon * 0.72);
      this.stars.push({ x: Math.floor(r() * vw), y, p: r() * Math.PI * 2, b: 0.35 + r() * 0.65 });
    }
    // Mountains: far (hazy violet, snow), mid, near.
    const ranges: Array<{ seed: number; base: number; amp: number; scale: number; color: RGB; lit: RGB; snow?: RGB }> = [
      { seed: 3, base: horizon - vh * 0.04, amp: vh * (portrait ? 0.16 : 0.24), scale: 90, color: [92, 66, 124], lit: [128, 90, 140], snow: [214, 196, 226] },
      { seed: 11, base: horizon - vh * 0.01, amp: vh * (portrait ? 0.1 : 0.15), scale: 60, color: [58, 42, 88], lit: [84, 58, 104] },
      { seed: 23, base: horizon + 1, amp: vh * 0.06, scale: 34, color: [30, 26, 54], lit: [44, 36, 70] },
    ];
    for (const range of ranges) {
      for (let x = 0; x < vw; x++) {
        const h = ridge(x, range.seed, range.scale);
        const top = Math.round(range.base - h * range.amp);
        const slope = ridge(x + 2, range.seed, range.scale) - ridge(x - 2, range.seed, range.scale);
        // Light from the left-hand sky: faces turned toward it are lit down a slanted band whose
        // depth follows the slope, with a dithered edge (no flat vertical stripes).
        const litDepth = Math.max(0, Math.min(1, slope * 60)) * range.amp * 0.55;
        // Snow only on the high peaks, deeper on the tallest, ragged at its lower edge.
        const peak = (h - 0.55) / 0.45;
        const snowDepth = range.snow && peak > 0 ? range.amp * (0.03 + 0.16 * peak) * (0.7 + 0.6 * noise1(x / 5, range.seed + 3)) : 0;
        for (let y = top; y < horizon + 1; y++) {
          const d = y - top;
          const dither = BAYER[(y & 3) * 4 + (x & 3)];
          let c = range.color;
          if (d < litDepth - 1 || (d < litDepth + 2 && dither > 0.5)) c = range.lit;
          if (range.snow && (d < snowDepth - 1 || (d < snowDepth + 1 && dither > 0.4))) c = range.snow;
          b.fillStyle = rgb(c);
          b.fillRect(x, y, 1, 1);
        }
      }
    }
    // Wardstone hill (right third) with the stone.
    const hill = { x: Math.round(vw * (portrait ? 0.68 : 0.7)), w: Math.round(vw * (portrait ? 0.5 : 0.3)), h: Math.round(vh * 0.07) };
    b.fillStyle = rgb([24, 30, 40]);
    for (let x = hill.x - hill.w / 2; x < hill.x + hill.w / 2; x++) {
      const t = (x - hill.x) / (hill.w / 2);
      const top = Math.round(horizon - hill.h * Math.sqrt(Math.max(0, 1 - t * t)));
      b.fillRect(x, top, 1, horizon - top + 1);
    }
    const stone = { x: hill.x, y: horizon - hill.h, w: Math.max(5, Math.round(vw * 0.012)), h: Math.max(14, Math.round(vh * 0.05)) };
    b.fillStyle = rgb([70, 110, 130]);
    b.fillRect(stone.x - stone.w / 2, stone.y - stone.h, stone.w, stone.h);
    b.fillStyle = rgb([150, 230, 250]);
    b.fillRect(stone.x - 1, stone.y - stone.h + 2, 2, stone.h - 4);
    b.fillStyle = rgb([26, 40, 52]);
    b.fillRect(stone.x - stone.w / 2 - 1, stone.y - 1, stone.w + 2, 2);
    // Village silhouette on the near-left shore, with window slots.
    this.windows = [];
    const shore = horizon + Math.round(vh * 0.035);
    const villageX = Math.round(vw * (portrait ? 0.05 : 0.08)), villageW = Math.round(vw * (portrait ? 0.55 : 0.36));
    // The near shore runs toward the viewer on a diagonal with a ragged waterline: a dark meadow,
    // dithered from violet at the water to deep green below, with a moonlit rim.
    const shoreEnd = villageX + villageW + 14;
    this.land = [];
    for (let y = 0; y < vh; y++) {
      if (y < shore - 2) { this.land.push(0); continue; }
      const t = (y - shore) / Math.max(1, vh - shore);
      const drift = Math.pow(Math.max(0, t), 1.25) * (vh - shore) * 0.55;
      const rag = (noise1(y / 5, 9) - 0.5) * 7 + (noise1(y / 17, 4) - 0.5) * 12;
      this.land.push(Math.round(shoreEnd - 10 + drift + rag));
    }
    const LAND_TOP: RGB = [30, 26, 48], LAND_LOW: RGB = [14, 22, 24];
    for (let y = shore - 2; y < vh; y++) {
      const t = Math.min(1, Math.max(0, (y - shore) / Math.max(1, (vh - shore) * 0.7)));
      for (let x = 0; x < this.land[y]; x++) {
        b.fillStyle = rgb(t > BAYER[(y & 3) * 4 + (x & 3)] ? LAND_LOW : LAND_TOP);
        b.fillRect(x, y, 1, 1);
      }
    }
    // Moonlit rim along the waterline and a few reeds.
    b.fillStyle = rgb([74, 62, 92]);
    for (let y = shore; y < vh; y++) b.fillRect(this.land[y], y, 1, 1);
    b.fillStyle = rgb([40, 52, 44]);
    for (let y = shore + 4; y < vh; y += 3) {
      if (noise1(y / 3, 21) < 0.55) continue;
      const rx = this.land[y] - 1, rh = 3 + Math.floor(noise1(y, 22) * 5);
      b.fillRect(rx, y - rh, 1, rh);
      if (rh > 5) b.fillRect(rx - 2, y - rh + 2, 1, rh - 2);
    }
    // Round trees and a lamp post on the meadow, silhouetted.
    const TREE: RGB = [18, 20, 30];
    const treeAt = (tx: number, ty: number, tr: number) => {
      b.fillStyle = rgb(TREE);
      b.fillRect(tx - 1, ty - tr, 3, tr + 2);
      this.disc(b, tx, ty - tr * 1.6, tr);
      this.disc(b, tx - tr * 0.6, ty - tr * 1.3, tr * 0.7);
      this.disc(b, tx + tr * 0.6, ty - tr * 1.35, tr * 0.72);
      b.fillStyle = rgb([44, 40, 66]);
      b.fillRect(Math.round(tx - tr * 0.5), Math.round(ty - tr * 2.5), Math.max(2, Math.round(tr * 0.6)), 1);
    };
    const treeRows = portrait ? [0.28, 0.46] : [0.2, 0.34];
    treeAt(Math.round(vw * 0.03), Math.round(shore + (vh - shore) * treeRows[0]), Math.max(6, Math.round(vh * 0.022)));
    treeAt(Math.round(Math.min(this.land[Math.round(shore + (vh - shore) * treeRows[1])] ?? vw * 0.3, vw) * 0.55), Math.round(shore + (vh - shore) * treeRows[1]), Math.max(7, Math.round(vh * 0.026)));
    this.lamps = [];
    const lampY = Math.round(shore + (vh - shore) * (portrait ? 0.2 : 0.16));
    const lampX = Math.round((this.land[lampY] ?? vw * 0.3) * 0.72);
    b.fillStyle = rgb(TREE);
    b.fillRect(lampX, lampY - 12, 1, 12);
    b.fillRect(lampX - 1, lampY - 13, 3, 2);
    this.lamps.push({ x: lampX, y: lampY - 12 });
    b.fillStyle = rgb([16, 16, 30]);
    let x = villageX;
    while (x < villageX + villageW) {
      const w = 12 + Math.floor(r() * 14), h = 9 + Math.floor(r() * 10), roof = Math.round(w * 0.5);
      const bx = x, by = shore - h;
      b.fillRect(bx, by, w, h);
      for (let i = 0; i < roof; i++) b.fillRect(bx - 1 + i, by - i, w + 2 - i * 2, 1);
      if (r() > 0.4) b.fillRect(bx + w - 4, by - roof + 1, 2, roof - 2);
      for (let wy = by + 3; wy < shore - 3; wy += 6) for (let wx = bx + 3; wx < bx + w - 3; wx += 6) if (r() > 0.35) this.windows.push({ x: wx, y: wy, p: r() * 6 });
      x += w + 2 + Math.floor(r() * 6);
    }
    // Tall trees at the right edge, a pale shoreline under the village.
    b.fillStyle = rgb([12, 14, 24]);
    for (let i = 0; i < 5; i++) {
      const tx = vw - 6 - i * Math.round(vw * 0.035), th = Math.round(vh * (0.2 + r() * 0.12));
      for (let y = 0; y < th; y++) {
        const half = Math.round((y / th) * 9 + (y % 5 === 0 ? 2 : 0));
        b.fillRect(tx - half, horizon + Math.round(vh * 0.05) - th + y, half * 2 + 1, 1);
      }
    }
    b.fillStyle = rgb([70, 58, 80]);
    b.fillRect(0, shore - 1, shoreEnd - 10, 1);
    // Foreground meadow.
    const meadow = vh - Math.round(vh * (portrait ? 0.14 : 0.12));
    for (let x2 = 0; x2 < vw; x2++) {
      const top = Math.round(meadow - noise1(x2 / 40, 5) * vh * 0.05);
      b.fillStyle = rgb([12, 22, 22]);
      b.fillRect(x2, top, 1, vh - top);
      b.fillStyle = rgb([28, 44, 40]);
      b.fillRect(x2, top, 1, 1);
    }
    this.flies = [];
    for (let i = 0; i < Math.round(vw / 26); i++) this.flies.push({ x: r() * vw, y: meadow - r() * vh * 0.2, p: r() * 10, s: 0.5 + r() });
  }

  private disc(b: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
    for (let y = -Math.ceil(r); y <= Math.ceil(r); y++) {
      const w = Math.floor(Math.sqrt(Math.max(0, r * r - y * y)));
      if (w > 0) b.fillRect(Math.round(cx - w), Math.round(cy + y), w * 2, 1);
    }
  }

  private render(now: number): void {
    const ctx = this.ctx, f = this.frame.getContext("2d");
    if (!ctx || !f) return;
    const t = this.reducedMotion ? 4 : (now - this.start) / 1000;
    const { vw, vh, horizon, portrait } = this.layout();
    f.imageSmoothingEnabled = false;
    f.clearRect(0, 0, vw, vh);
    f.drawImage(this.base, 0, 0);
    // Twinkling stars.
    for (const s of this.stars) {
      const a = s.b * (0.55 + 0.45 * Math.sin(t * 1.7 + s.p));
      f.fillStyle = `rgba(255, 246, 220, ${a.toFixed(2)})`;
      f.fillRect(s.x, s.y, 1, 1);
      if (s.b > 0.93 && a > 0.8) { f.fillRect(s.x - 1, s.y, 3, 1); f.fillRect(s.x, s.y - 1, 1, 3); }
    }
    // Drifting clouds, lit from below.
    for (let i = 0; i < 4; i++) {
      const w = Math.round(vw * (0.18 + i * 0.05)), y = Math.round(horizon * (0.2 + i * 0.13));
      const x = Math.round(((t * (2 + i) + i * vw * 0.37) % (vw + w)) - w);
      f.fillStyle = `rgba(88, 60, 120, 0.75)`;
      f.fillRect(x, y, w, 2);
      f.fillRect(x + Math.round(w * 0.12), y - 2, Math.round(w * 0.5), 2);
      f.fillRect(x + Math.round(w * 0.3), y - 3, Math.round(w * 0.25), 1);
      f.fillStyle = `rgba(240, 150, 110, 0.55)`;
      f.fillRect(x + 2, y + 2, w - 4, 1);
    }
    // Wardstone beam and glow.
    const stoneX = Math.round(vw * (portrait ? 0.68 : 0.7));
    const stoneTop = horizon - Math.round(vh * 0.07) - Math.max(14, Math.round(vh * 0.05));
    const pulse = 0.5 + 0.5 * Math.sin(t * 1.3);
    for (let i = 0; i < 3; i++) {
      f.fillStyle = `rgba(140, 230, 255, ${(0.05 + pulse * 0.05) / (i + 1)})`;
      const bw = 2 + i * 3;
      f.fillRect(stoneX - bw / 2, 0, bw, stoneTop + 4);
    }
    for (const [rr, a] of [[22, 0.07], [14, 0.1], [8, 0.16]] as const) {
      f.fillStyle = `rgba(140, 230, 255, ${a * (0.7 + pulse * 0.3)})`;
      this.disc(f, stoneX, stoneTop + 8, rr);
    }
    // Lake shimmer and the moon's path.
    const moonX = Math.round(vw * (portrait ? 0.72 : 0.76));
    for (let y = horizon + 2; y < vh; y += 3) {
      const spread = 3 + (y - horizon) * 0.18;
      const wob = Math.round(Math.sin(t * 2 + y * 0.7) * 2);
      f.fillStyle = `rgba(252, 236, 200, ${Math.max(0.08, 0.55 - (y - horizon) / vh)})`;
      const px0 = Math.max(Math.round(moonX - spread / 2 + wob), (this.land[y] ?? 0) + 2);
      const px1 = Math.round(moonX - spread / 2 + wob) + Math.round(spread * (0.4 + 0.6 * Math.abs(Math.sin(y * 1.3 + t))));
      if (px1 > px0) f.fillRect(px0, y, px1 - px0, 1);
      if ((y / 3) % 4 === 0) {
        f.fillStyle = "rgba(160, 150, 210, 0.18)";
        const lx = Math.round(((t * 6 + y * 17) % (vw + 40)) - 20);
        const shoreX = (this.land[y] ?? 0) + 2;
        const len = 10 + (y % 7);
        if (lx + len > shoreX) f.fillRect(Math.max(lx, shoreX), y, lx + len - Math.max(lx, shoreX), 1);
      }
    }
    // Lit windows flicker; each throws a short reflection.
    for (const w of this.windows) {
      const on = 0.75 + 0.25 * Math.sin(t * 3 + w.p);
      f.fillStyle = `rgba(255, 196, 110, ${on.toFixed(2)})`;
      f.fillRect(w.x, w.y, 2, 2);
    }
    // The lamp on the meadow: a warm banded glow.
    for (const l of this.lamps) {
      const flick = 0.85 + 0.15 * Math.sin(t * 7.3) * Math.sin(t * 3.1);
      for (const [rr, a] of [[10, 0.08], [6, 0.12], [3, 0.22]] as const) {
        f.fillStyle = `rgba(255, 190, 100, ${(a * flick).toFixed(3)})`;
        this.disc(f, l.x, l.y, rr);
      }
      f.fillStyle = "rgb(255, 226, 150)";
      f.fillRect(l.x - 1, l.y - 1, 2, 2);
    }
    // Chimney smoke.
    for (let i = 0; i < 10; i++) {
      const age = (t * 0.6 + i * 0.35) % 3.5;
      const sx = Math.round(vw * (portrait ? 0.2 : 0.16) + Math.sin(age * 2 + i) * 2 + age * 3);
      const sy = Math.round(horizon + vh * 0.035 - 26 - age * 10);
      f.fillStyle = `rgba(150, 130, 170, ${Math.max(0, 0.35 - age * 0.1).toFixed(2)})`;
      f.fillRect(sx, sy, 2 + Math.floor(age), 2);
    }
    // Grass tufts swaying at the bottom edge.
    const meadow = vh - Math.round(vh * (portrait ? 0.14 : 0.12));
    for (let x = 2; x < vw; x += 5) {
      const top = Math.round(meadow - noise1(x / 40, 5) * vh * 0.05);
      const sway = Math.round(Math.sin(t * 1.6 + x * 0.3) * 1.5);
      f.fillStyle = "rgb(34, 54, 44)";
      f.fillRect(x + sway, top - 4, 1, 4);
      f.fillRect(x + 2 + Math.round(sway / 2), top - 3, 1, 3);
    }
    // Fireflies.
    for (const fly of this.flies) {
      const x = Math.round(fly.x + Math.sin(t * 0.7 * fly.s + fly.p) * 14);
      const y = Math.round(fly.y + Math.cos(t * 0.9 * fly.s + fly.p * 2) * 8);
      const a = Math.max(0, Math.sin(t * 2.2 * fly.s + fly.p));
      if (a < 0.05) continue;
      f.fillStyle = `rgba(214, 255, 140, ${(a * 0.25).toFixed(2)})`;
      f.fillRect(x - 1, y - 1, 3, 3);
      f.fillStyle = `rgba(240, 255, 190, ${a.toFixed(2)})`;
      f.fillRect(x, y, 1, 1);
    }
    // Vignette.
    const g = f.createRadialGradient(vw / 2, vh * 0.55, Math.min(vw, vh) * 0.35, vw / 2, vh * 0.55, Math.max(vw, vh) * 0.75);
    g.addColorStop(0, "rgba(10, 6, 20, 0)");
    g.addColorStop(1, "rgba(10, 6, 20, 0.55)");
    f.fillStyle = g;
    f.fillRect(0, 0, vw, vh);
    ctx.imageSmoothingEnabled = false;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(this.frame, 0, 0, vw, vh, 0, 0, vw * this.dims.k, vh * this.dims.k);
  }
}
