/**
 * Game 05 renderer helpers: canvases, hashing, colours. Owner: render lane.
 * Everything draws at 1x art pixels with image smoothing off.
 */

export type Canvas = HTMLCanvasElement;
export type Ctx = CanvasRenderingContext2D;

export function makeCanvas(w: number, h: number): Canvas {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(h));
  return c;
}

export function ctx2d(c: Canvas, opts?: CanvasRenderingContext2DSettings): Ctx {
  const g = c.getContext("2d", opts) as Ctx | null;
  if (!g) throw new Error("Game 05: 2D canvas unavailable");
  g.imageSmoothingEnabled = false;
  return g;
}

/** Integer hash of two ints and a seed → [0, 1). */
export function hash2(x: number, y: number, seed = 0): number {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(seed | 0, 2246822519)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

export function hash1(x: number, seed = 0): number {
  return hash2(x, 0x5bd1e995, seed);
}

export type RGB = [number, number, number];

export function parseColor(c: string): RGB {
  const s = c.trim();
  if (s.startsWith("#")) {
    const h = s.slice(1);
    if (h.length === 3) return [parseInt(h[0] + h[0], 16), parseInt(h[1] + h[1], 16), parseInt(h[2] + h[2], 16)];
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }
  const m = s.match(/rgba?\(([^)]+)\)/);
  if (m) {
    const p = m[1].split(",").map((v) => parseFloat(v));
    return [p[0] | 0, p[1] | 0, p[2] | 0];
  }
  return [255, 255, 255];
}

export function rgbStr(r: number, g: number, b: number, a = 1): string {
  return a >= 1 ? `rgb(${r | 0},${g | 0},${b | 0})` : `rgba(${r | 0},${g | 0},${b | 0},${a})`;
}

export const clamp = (v: number, a: number, b: number): number => (v < a ? a : v > b ? b : v);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

export const DIR_VEC: Record<string, [number, number]> = {
  down: [0, 1],
  up: [0, -1],
  left: [-1, 0],
  right: [1, 0],
};

/** Smooth tileable value noise table (256×256, 0..1), for ground edges and fog. */
let NOISE: Float32Array | null = null;
export function noiseTable(): Float32Array {
  if (NOISE) return NOISE;
  const N = 256;
  const out = new Float32Array(N * N);
  const oct = (cell: number, seed: number, amp: number) => {
    const m = N / cell;
    for (let y = 0; y < N; y++) {
      const gy = y / cell;
      const y0 = Math.floor(gy);
      let fy = gy - y0;
      fy = fy * fy * (3 - 2 * fy);
      for (let x = 0; x < N; x++) {
        const gx = x / cell;
        const x0 = Math.floor(gx);
        let fx = gx - x0;
        fx = fx * fx * (3 - 2 * fx);
        const a = hash2(x0 % m, y0 % m, seed);
        const b = hash2((x0 + 1) % m, y0 % m, seed);
        const c = hash2(x0 % m, (y0 + 1) % m, seed);
        const d = hash2((x0 + 1) % m, (y0 + 1) % m, seed);
        out[y * N + x] += amp * ((a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy);
      }
    }
  };
  oct(8, 11, 0.6);
  oct(4, 12, 0.28);
  oct(2, 13, 0.12);
  NOISE = out;
  return out;
}
