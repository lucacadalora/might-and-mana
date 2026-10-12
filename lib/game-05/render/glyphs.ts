/**
 * Small procedural 1x sprites the renderer owns (render lane): NPC markers, drop-shadow ellipses,
 * ordered-dither masks for the death dissolve, water glints. They are art, not text: pixel
 * bitmaps drawn into the art buffer.
 */
import { ctx2d, makeCanvas, type Canvas, type Ctx } from "./util";

function bitmap(rows: string[], pal: Record<string, string>): Canvas {
  const h = rows.length, w = rows[0].length;
  const c = makeCanvas(w, h);
  const g = ctx2d(c);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const ch = rows[y][x];
      const col = pal[ch];
      if (!col) continue;
      g.fillStyle = col;
      g.fillRect(x, y, 1, 1);
    }
  return c;
}

const MARK_PAL = { o: "#2a1606", y: "#ffd23a", Y: "#fff2a0", d: "#d88a14", w: "#ffffff", g: "#c8d4e0", b: "#223048" };

const EXCLAIM = [
  ".ooo.",
  "oYYyo",
  "oYyyo",
  "oyyyo",
  "oyydo",
  "oyydo",
  ".odo.",
  ".oo..",
  ".ooo.",
  "oyydo",
  ".ooo.",
];
const QUESTION = [
  ".oooo.",
  "oYYyyo",
  "oyoodo",
  ".o.oyo",
  "..oyyo",
  ".oydo.",
  ".oyo..",
  "..o...",
  ".ooo..",
  "oyydo.",
  ".ooo..",
];
const DOTS = [
  ".bbbbbbbbbb.",
  "bwwwwwwwwwwb",
  "bwgwwgwwgwwb",
  "bwwwwwwwwwwb",
  ".bbbwbbbbbb.",
  "...bb.......",
];

let MARKERS: Record<string, Canvas> | null = null;
export function markerSprite(kind: "!" | "?" | "..."): Canvas {
  if (!MARKERS) {
    MARKERS = {
      "!": bitmap(EXCLAIM, MARK_PAL),
      "?": bitmap(QUESTION, MARK_PAL),
      "...": bitmap(DOTS, MARK_PAL),
    };
  }
  return MARKERS[kind];
}

const SHADOWS = new Map<string, Canvas>();
/** Pixel-art drop shadow: hard-edged ellipse with a darker core band. */
export function shadowSprite(w: number, h: number): Canvas {
  const W = Math.max(2, Math.round(w)), H = Math.max(1, Math.round(h));
  const key = `${W}x${H}`;
  let c = SHADOWS.get(key);
  if (c) return c;
  c = makeCanvas(W, H);
  const g = ctx2d(c);
  const d = g.createImageData(W, H);
  const p = d.data;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const nx = (x + 0.5 - W / 2) / (W / 2), ny = (y + 0.5 - H / 2) / (H / 2);
      const r = nx * nx + ny * ny;
      if (r > 1) continue;
      const i = (y * W + x) * 4;
      p[i] = 12;
      p[i + 1] = 18;
      p[i + 2] = 24;
      p[i + 3] = r < 0.45 ? 104 : 72;
    }
  g.putImageData(d, 0, 0);
  if (SHADOWS.size > 200) SHADOWS.clear();
  SHADOWS.set(key, c);
  return c;
}

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
/** 17 patterns: level L erases L/16 of the pixels in a 4×4 ordered-dither order. */
export function ditherPatterns(g: Ctx): Array<CanvasPattern | null> {
  const out: Array<CanvasPattern | null> = [];
  for (let L = 0; L <= 16; L++) {
    const c = makeCanvas(4, 4);
    const x = ctx2d(c);
    x.fillStyle = "#000";
    for (let i = 0; i < 16; i++) if (BAYER[i] < L) x.fillRect(i % 4, (i / 4) | 0, 1, 1);
    out.push(g.createPattern(c, "repeat"));
  }
  return out;
}

const HAZE = new Map<string, Canvas>();
/**
 * A spore cloud's body filling radius r: overlapping round puffs, lit from the top-left with a
 * dark rim, over a dithered ground haze. Four drift frames per radius (r quantised to 2 px).
 */
export function sporeHaze(r: number, frame = 0): Canvas {
  const R = Math.max(6, Math.round(r / 2) * 2);
  const f = ((frame % 4) + 4) % 4;
  const key = `${R}|${f}`;
  let c = HAZE.get(key);
  if (c) return c;
  const W = R * 2 + 8, H = Math.round(R * 1.5) + 10;
  c = makeCanvas(W, H);
  const g = ctx2d(c);
  const d = g.createImageData(W, H);
  const p = d.data;
  const cx = W / 2, cy = H - Math.round(R * 0.7) - 4;
  // puffs on a jittered disc; they turn slowly with the frame
  const n = Math.max(5, Math.min(12, Math.round(R / 5)));
  const puffs: Array<[number, number, number]> = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + f * 0.18 + ((i * 37) % 11) * 0.05;
    const dist = R * (0.42 + 0.22 * (((i * 53) % 7) / 7));
    const pr = R * (0.34 + 0.12 * (((i * 29) % 5) / 5));
    puffs.push([cx + Math.cos(a) * dist, cy + Math.sin(a) * dist * 0.62 - pr * 0.35, pr]);
  }
  puffs.push([cx, cy - R * 0.25, R * 0.5]);
  const inside = new Uint8Array(W * H);
  const shade = new Float32Array(W * H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      let best = -1;
      for (const [px, py, pr] of puffs) {
        const dx = (x + 0.5 - px) / pr, dy = (y + 0.5 - py) / pr;
        const q = dx * dx + dy * dy;
        if (q > 1) continue;
        // light from the top-left on each puff's dome
        const l = 1 - q + (-dx * 0.5 - dy * 0.7) * 0.6;
        if (l > best) best = l;
      }
      if (best < -0.5) continue;
      inside[y * W + x] = 1;
      shade[y * W + x] = best;
    }
  const PAL = [[74, 92, 40], [122, 142, 58], [168, 190, 84], [206, 222, 124], [236, 244, 176]];
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (!inside[i]) {
        // ground haze under the cloud
        const nx = (x + 0.5 - cx) / R, ny = (y + 0.5 - cy - 2) / (R * 0.62);
        const q = nx * nx + ny * ny;
        if (q > 1 || BAYER[(y & 3) * 4 + (x & 3)] >= (1 - q) * 9) continue;
        p[i * 4] = 150;
        p[i * 4 + 1] = 180;
        p[i * 4 + 2] = 70;
        p[i * 4 + 3] = 160;
        continue;
      }
      const edge = !inside[i - 1] || !inside[i + 1] || !inside[i - W] || !inside[i + W];
      const v = edge ? 0 : Math.max(1, Math.min(4, Math.floor(shade[i] * 3.2 + 1.4)));
      const col = PAL[v];
      p[i * 4] = col[0];
      p[i * 4 + 1] = col[1];
      p[i * 4 + 2] = col[2];
      p[i * 4 + 3] = 255;
    }
  g.putImageData(d, 0, 0);
  if (HAZE.size > 96) HAZE.clear();
  HAZE.set(key, c);
  return c;
}

const CRACKS = new Map<string, Canvas>();
/**
 * Ground fissures that warn of a thorn spike: stages 0..2 grow (hairline → split earth with
 * lifted chips), stage 3 is the same fissure in hot colours (drawn additively after the light map).
 * Three jagged arms with short forks, squashed for the 3/4 ground plane; four shapes by seed.
 */
export function crackSprite(seed: number, stage: number): Canvas {
  const key = `${seed}|${stage}`;
  let c = CRACKS.get(key);
  if (c) return c;
  const W = 36, H = 20;
  c = makeCanvas(W, H);
  const g = ctx2d(c);
  const len = stage === 0 ? 0.35 : stage === 1 ? 0.65 : 1;
  const hot = stage === 3;
  let s = (seed + 1) * 9301 + 49297;
  const rnd = () => ((s = (s * 49297 + 233280) % 233280) / 233280);
  const main: Array<[number, number]> = [];
  const thin: Array<[number, number]> = [];
  const base = rnd() * Math.PI * 2;
  for (let a = 0; a < 3; a++) {
    let ang = base + (a / 3) * Math.PI * 2 + (rnd() - 0.5) * 0.7;
    const L = (9 + rnd() * 7) * len;
    let x = W / 2, y = H / 2;
    for (let t = 0; t < L; t++) {
      ang += (rnd() - 0.5) * 0.5;
      x += Math.cos(ang);
      y += Math.sin(ang) * 0.5;
      (t < L * 0.6 && stage >= 1 ? main : thin).push([Math.round(x), Math.round(y)]);
      // a short fork now and then
      if (stage >= 1 && t > 3 && rnd() < 0.12) {
        const fa = ang + (rnd() < 0.5 ? 0.9 : -0.9);
        for (let q = 1; q <= 3; q++) thin.push([Math.round(x + Math.cos(fa) * q), Math.round(y + Math.sin(fa) * q * 0.5)]);
      }
    }
  }
  if (!hot) {
    g.fillStyle = "#8a6a4a";
    for (const [x, y] of main) g.fillRect(x, y + 1, 2, 1);
  }
  g.fillStyle = hot ? "#b8341a" : "#1a0e0a";
  for (const [x, y] of main) g.fillRect(x, y, 2, 1);
  for (const [x, y] of thin) g.fillRect(x, y, 1, 1);
  g.fillRect(W / 2 - 1, H / 2 - 1, 3, 2);
  if (hot) {
    g.fillStyle = "#ff8a3a";
    for (const [x, y] of main) g.fillRect(x, y, 1, 1);
  } else if (stage >= 2) {
    g.fillStyle = "#a88a64";
    for (let i = 0; i < 6; i++) g.fillRect(Math.round(W / 2 + (rnd() - 0.5) * 20), Math.round(H / 2 + (rnd() - 0.5) * 10), 2, 1);
  }
  CRACKS.set(key, c);
  return c;
}

const RIPPLES = new Map<string, Canvas>();
/**
 * The water line around a wading actor's legs: an ellipse outline w×h split in two halves, the
 * back arc (drawn before the sprite) and the front arc (drawn after it), with a foam highlight.
 */
export function rippleSprite(w: number, h: number, half: "back" | "front"): Canvas {
  const W = Math.max(6, Math.round(w)), H = Math.max(3, Math.round(h));
  const key = `${W}x${H}|${half}`;
  let c = RIPPLES.get(key);
  if (c) return c;
  c = makeCanvas(W, H);
  const g = ctx2d(c);
  const d = g.createImageData(W, H);
  const p = d.data;
  const cx = W / 2, cy = H / 2;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const nx = (x + 0.5 - cx) / (W / 2), ny = (y + 0.5 - cy) / (H / 2);
      const r = Math.sqrt(nx * nx + ny * ny);
      const inRing = r <= 1 && r > 1 - 2.2 / Math.min(W / 2, H);
      if (!inRing) continue;
      const front = y + 0.5 >= cy;
      if ((half === "front") !== front) continue;
      const i = (y * W + x) * 4;
      const hi = front && Math.abs(nx) < 0.55;
      p[i] = hi ? 236 : 196;
      p[i + 1] = hi ? 248 : 232;
      p[i + 2] = hi ? 252 : 244;
      p[i + 3] = front ? 255 : 170;
    }
  g.putImageData(d, 0, 0);
  RIPPLES.set(key, c);
  return c;
}
