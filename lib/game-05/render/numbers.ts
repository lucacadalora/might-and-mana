/**
 * Game 05 floating combat text (render lane): damage, MISS, CRITICAL, heals, gold.
 *
 * Text never goes into the art buffer. Each label is rasterised once at the pixel font's design
 * size (Silkscreen, 8 px) into a tiny 1x bitmap whose alpha is thresholded to 0/255, given a hard
 * 1-font-pixel outline, a drop row and a two-tone bevel, then drawn on the DEVICE-resolution display
 * canvas at an integer scale u (one font pixel = u×u device pixels), so it is crisp at any DPR.
 *
 * Layout: numbers never overlap each other or their labels. Every frame the labels are placed
 * newest first at their natural spot (above the target, rising); an older label that would
 * overlap an already placed one is lifted just above it. A label's lift only ever grows, so labels
 * never jump down when a neighbour expires.
 */
import { clamp, ctx2d, makeCanvas, type Canvas, type Ctx } from "./util";

export type NumberKind = "damage" | "crit" | "miss" | "hurt" | "heal" | "mana" | "gold" | "info";

interface Style { fill: string; edge: string; shade: string; scale: number; life: number }
const STYLE: Record<NumberKind, Style> = {
  damage: { fill: "#ffffff", edge: "#1a1020", shade: "#c4bcd4", scale: 1.7, life: 0.95 },
  crit: { fill: "#ffe45a", edge: "#3a1606", shade: "#f09a24", scale: 2.2, life: 1.25 },
  miss: { fill: "#bfe4ff", edge: "#0c1a38", shade: "#6aa4e8", scale: 1.4, life: 0.8 },
  hurt: { fill: "#ff6a5e", edge: "#2a0608", shade: "#c8262c", scale: 1.7, life: 0.95 },
  heal: { fill: "#9cf486", edge: "#0a2a0c", shade: "#44b044", scale: 1.6, life: 1.1 },
  mana: { fill: "#8cc4ff", edge: "#0a1638", shade: "#3a6ad8", scale: 1.6, life: 1.1 },
  gold: { fill: "#ffe070", edge: "#3a2406", shade: "#d89a20", scale: 1.35, life: 0.9 },
  info: { fill: "#f4ecd8", edge: "#1a1410", shade: "#b0a488", scale: 1.35, life: 1.2 },
};
const LABEL_SCALE = 1.35;

export const FONT_FAMILY = "Game05Silk";
let fontPromise: Promise<void> | null = null;

export function loadPixelFont(url = "/fonts/silkscreen.woff2"): Promise<void> {
  if (fontPromise) return fontPromise;
  fontPromise = (async () => {
    try {
      if (typeof FontFace === "undefined" || typeof document === "undefined") return;
      const ff = new FontFace(FONT_FAMILY, `url(${url}) format("woff2")`);
      await ff.load();
      document.fonts.add(ff);
    } catch {
      /* fall back to monospace; numbers still render */
    }
  })();
  return fontPromise;
}

/** A thresholded, outlined 1x bitmap of a string (cached). */
const GLYPHS = new Map<string, Canvas>();
let measure: Ctx | null = null;
function textBitmap(text: string, st: Style): Canvas {
  const key = `${text}|${st.fill}|${st.edge}|${st.shade}`;
  const hit = GLYPHS.get(key);
  if (hit) return hit;
  if (!measure) measure = ctx2d(makeCanvas(256, 24), { willReadFrequently: true });
  const g = measure;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, 256, 24);
  g.font = `8px ${FONT_FAMILY}, monospace`;
  g.textBaseline = "alphabetic";
  g.textAlign = "left";
  g.fillStyle = "#fff";
  g.fillText(text, 4, 14);
  const W = Math.min(256, Math.ceil(g.measureText(text).width) + 8);
  const px = g.getImageData(0, 0, W, 24).data;
  let x0 = W, y0 = 24, x1 = -1, y1 = -1;
  for (let y = 0; y < 24; y++)
    for (let x = 0; x < W; x++)
      if (px[(y * W + x) * 4 + 3] > 110) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
  if (x1 < 0) {
    const empty = makeCanvas(1, 1);
    GLYPHS.set(key, empty);
    return empty;
  }
  const gw = x1 - x0 + 1, gh = y1 - y0 + 1;
  const mask = new Uint8Array(gw * gh);
  for (let y = 0; y < gh; y++)
    for (let x = 0; x < gw; x++) mask[y * gw + x] = px[((y + y0) * W + x + x0) * 4 + 3] > 110 ? 1 : 0;
  // 1 px outline all round plus a drop row under it
  const BW = gw + 2, BH = gh + 3;
  const c = makeCanvas(BW, BH);
  const o = ctx2d(c);
  const img = o.createImageData(BW, BH);
  const d = img.data;
  const rgb = (h: string) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  const edge = rgb(st.edge), fill = rgb(st.fill), shade = rgb(st.shade);
  const at = (x: number, y: number) => x >= 0 && y >= 0 && x < gw && y < gh && mask[y * gw + x] === 1;
  const split = Math.ceil(gh * 0.55);
  for (let y = 0; y < BH; y++)
    for (let x = 0; x < BW; x++) {
      const mx = x - 1, my = y - 1;
      let col: number[] | null = null;
      if (at(mx, my)) col = my >= split ? shade : fill;
      else {
        for (let dy = -2; dy <= 1 && !col; dy++)
          for (let dx = -1; dx <= 1; dx++)
            if (at(mx + dx, my + dy) && (dy >= -1 || dx === 0)) {
              col = edge;
              break;
            }
      }
      if (!col) continue;
      const i = (y * BW + x) * 4;
      d[i] = col[0];
      d[i + 1] = col[1];
      d[i + 2] = col[2];
      d[i + 3] = 255;
    }
  o.putImageData(img, 0, 0);
  if (GLYPHS.size > 300) GLYPHS.clear();
  GLYPHS.set(key, c);
  return c;
}

interface Num {
  id: number;
  x: number;
  y: number;
  text: string;
  label: string | null;
  kind: NumberKind;
  t: number;
  life: number;
  /** Device px this label was lifted to clear newer ones (only grows). */
  lift: number;
  dx: number;
  /** Running total for merged gold labels. */
  value: number;
}

interface Box { l: number; t: number; r: number; b: number }

export class Numbers {
  private list: Num[] = [];
  private seq = 0;
  private boxes: Box[] = [];
  hidden = false;
  reducedMotion = false;

  add(x: number, y: number, text: string, kind: NumberKind, label: string | null = null): void {
    const st = STYLE[kind];
    // a small deterministic sideways jitter keeps a rapid stream from forming a perfect column
    const dx = [0, -3, 3, -1, 2][this.seq % 5];
    this.list.push({ id: this.seq++, x, y, text, label, kind, t: 0, life: st.life, lift: 0, dx, value: 0 });
    if (this.list.length > 40) this.list.shift();
  }

  /** Gold picked up in quick succession counts up in one label instead of a column of "+1"s. */
  addGold(x: number, y: number, amount: number): void {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const n = this.list[i];
      if (n.kind !== "gold" || n.t > 0.5 || Math.abs(n.x - x) > 48 || Math.abs(n.y - y) > 48) continue;
      n.value += amount;
      n.text = `+${n.value}`;
      n.t = Math.min(n.t, 0.12);
      return;
    }
    this.add(x, y, `+${amount}`, "gold");
    this.list[this.list.length - 1].value = amount;
  }

  update(dt: number): void {
    let j = 0;
    for (const n of this.list) {
      n.t += dt;
      if (n.t < n.life) this.list[j++] = n;
    }
    this.list.length = j;
  }

  clear(): void {
    this.list.length = 0;
  }

  get count(): number {
    return this.list.length;
  }

  /** Scale (device px per font px) for a kind at art scale k. */
  static unit(kind: NumberKind | "label", k: number): number {
    const s = kind === "label" ? LABEL_SCALE : STYLE[kind].scale;
    return Math.max(2, Math.ceil(k * s));
  }

  /**
   * Draw onto the display canvas. project: world px → device px. k: device px per art px.
   * Returns the device boxes drawn (for tests).
   */
  render(g: Ctx, project: (x: number, y: number) => [number, number], k: number): Box[] {
    const boxes = this.boxes;
    boxes.length = 0;
    if (this.hidden || !this.list.length) return boxes;
    g.save();
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.imageSmoothingEnabled = false;
    g.globalCompositeOperation = "source-over";
    // newest first: new numbers take their natural spot, older ones get lifted above them
    const order = this.list.slice().sort((a, b) => b.id - a.id);
    const draws: Array<{ n: Num; bmp: Canvas; lbmp: Canvas | null; u: number; lu: number; x: number; y: number; w: number; h: number }> = [];
    for (const n of order) {
      const st = STYLE[n.kind];
      const u = Numbers.unit(n.kind, k);
      const bmp = textBitmap(n.text, st);
      const lbmp = n.label ? textBitmap(n.label, st) : null;
      const lu = Numbers.unit("label", k);
      const w = Math.max(bmp.width * u, lbmp ? lbmp.width * lu : 0);
      const h = bmp.height * u + (lbmp ? lbmp.height * lu + lu : 0);
      // motion (art px): quick pop up, then a slow float
      const rise = n.t < 0.12 ? 12 * (1 - Math.pow(1 - n.t / 0.12, 2)) : 12 + (n.t - 0.12) * 10;
      const [px, py] = project(n.x + n.dx, n.y);
      const cx = Math.round(px);
      const bottom = Math.round(py - rise * k);
      const gap = Math.max(2, u);
      let box: Box = { l: cx - (w >> 1) - gap, r: cx - (w >> 1) + w + gap, b: bottom - n.lift + gap, t: bottom - n.lift - h };
      for (let guard = 0; guard < 40; guard++) {
        let hitTop = Infinity;
        for (const o of boxes) if (box.l < o.r && box.r > o.l && box.t < o.b && box.b > o.t) hitTop = Math.min(hitTop, o.t);
        if (hitTop === Infinity) break;
        n.lift += box.b - hitTop;
        box = { l: box.l, r: box.r, b: bottom - n.lift + gap, t: bottom - n.lift - h };
      }
      boxes.push(box);
      draws.push({ n, bmp, lbmp, u, lu, x: cx - (w >> 1), y: bottom - n.lift - h, w, h });
    }
    // draw oldest first so the newest sits on top if anything ever touches
    for (let i = draws.length - 1; i >= 0; i--) {
      const d = draws[i];
      const n = d.n;
      const p = n.t / n.life;
      g.globalAlpha = p > 0.75 ? clamp(1 - (p - 0.75) / 0.25, 0, 1) : 1;
      let y = d.y;
      if (d.lbmp) {
        const lw = d.lbmp.width * d.lu;
        g.drawImage(d.lbmp, d.x + ((d.w - lw) >> 1), y, lw, d.lbmp.height * d.lu);
        y += d.lbmp.height * d.lu + d.lu;
      }
      const tw = d.bmp.width * d.u;
      const tx = d.x + ((d.w - tw) >> 1);
      g.drawImage(d.bmp, tx, y, tw, d.bmp.height * d.u);
      // a crit flashes white for its first frames (not with reduced motion)
      if (n.kind === "crit" && n.t < 0.08 && !this.reducedMotion) {
        g.globalAlpha = 0.6;
        g.globalCompositeOperation = "lighter";
        g.drawImage(d.bmp, tx, y, tw, d.bmp.height * d.u);
        g.globalCompositeOperation = "source-over";
      }
    }
    g.restore();
    return boxes;
  }
}
