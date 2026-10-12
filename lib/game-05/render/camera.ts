/**
 * Game 05 pixel-perfect screen math and camera (render lane).
 *
 * The canvas backing store is in device pixels. k = max(1, floor(min(devW, devH) / 360)) device
 * pixels per art pixel; the offscreen buffer is ceil(dev / k) + 2 art pixels so the sub-pixel
 * camera can shift it by up to one art pixel. The buffer is drawn at an integer world origin and
 * the fractional camera part becomes a whole-device-pixel offset on the final blit.
 */
import type { Dir4 } from "../contract";
import { DIR_VEC } from "./util";

export const SHORT_SIDE = 360;

export interface Screen {
  cssW: number;
  cssH: number;
  dpr: number;
  devW: number;
  devH: number;
  k: number;
  /** Buffer size in art px (includes the 1 px margin on every side). */
  bw: number;
  bh: number;
  /** Visible world size in art px (fractional). */
  viewW: number;
  viewH: number;
}

export function computeScreen(cssW: number, cssH: number, dpr: number, devOverride?: { w: number; h: number }): Screen {
  const r = dpr > 0 && Number.isFinite(dpr) ? dpr : 1;
  const devW = Math.max(1, devOverride?.w ?? Math.round(cssW * r));
  const devH = Math.max(1, devOverride?.h ?? Math.round(cssH * r));
  const k = Math.max(1, Math.floor(Math.min(devW, devH) / SHORT_SIDE));
  return {
    cssW, cssH, dpr: r, devW, devH, k,
    bw: Math.ceil(devW / k) + 2,
    bh: Math.ceil(devH / k) + 2,
    viewW: devW / k,
    viewH: devH / k,
  };
}

export class Camera {
  /** Centre of the view in world px. */
  x = 0;
  y = 0;
  private lookX = 0;
  private lookY = 0;
  /** Smoothed pull toward a point of interest (a boss in the fight), in world px. */
  private pullX = 0;
  private pullY = 0;
  private init = false;
  /** Set each frame by the view: a point the camera should lean toward (null = none). */
  focus: { x: number; y: number; weight: number } | null = null;

  /** Where the hero's body centre sits relative to its feet. */
  static readonly BODY = -18;
  static readonly LOOK = 22;

  target(hx: number, hy: number, facing: Dir4, moving: boolean): [number, number] {
    const v = DIR_VEC[facing] ?? [0, 0];
    const la = moving ? Camera.LOOK : Camera.LOOK * 0.55;
    return [hx + v[0] * la, hy + Camera.BODY + v[1] * la * 0.8];
  }

  update(hx: number, hy: number, facing: Dir4, moving: boolean, dt: number, mapW: number, mapH: number,
    viewW: number, viewH: number): void {
    const v = DIR_VEC[facing] ?? [0, 0];
    const la = moving ? Camera.LOOK : Camera.LOOK * 0.55;
    if (!this.init) {
      this.snap(hx, hy, facing, mapW, mapH, viewW, viewH);
      return;
    }
    const kl = 1 - Math.exp(-dt * 2.6);
    this.lookX += (v[0] * la - this.lookX) * kl;
    this.lookY += (v[1] * la * 0.8 - this.lookY) * kl;
    // lean toward the focus (keeps a boss and the hero in frame together)
    const f = this.focus;
    const fx = f ? (f.x - hx) * f.weight : 0, fy = f ? (f.y - (hy + Camera.BODY)) * f.weight : 0;
    const kp = 1 - Math.exp(-dt * 2);
    this.pullX += (fx - this.pullX) * kp;
    this.pullY += (fy - this.pullY) * kp;
    const tx = hx + (f ? this.lookX * 0.4 : this.lookX) + this.pullX;
    const ty = hy + Camera.BODY + (f ? this.lookY * 0.4 : this.lookY) + this.pullY;
    const kf = 1 - Math.exp(-dt * 7.5);
    this.x += (tx - this.x) * kf;
    this.y += (ty - this.y) * kf;
    // never let the hero leave the middle 70% of the view, however fast it moves
    const mx = viewW * 0.35;
    const my = viewH * 0.35;
    if (hx - this.x > mx) this.x = hx - mx;
    if (this.x - hx > mx) this.x = hx + mx;
    if (hy - this.y > my) this.y = hy - my;
    if (this.y - hy > my) this.y = hy + my;
    this.clamp(mapW, mapH, viewW, viewH);
  }

  snap(hx: number, hy: number, facing: Dir4, mapW: number, mapH: number, viewW: number, viewH: number): void {
    const v = DIR_VEC[facing] ?? [0, 0];
    this.lookX = v[0] * Camera.LOOK * 0.55;
    this.lookY = v[1] * Camera.LOOK * 0.44;
    this.x = hx + this.lookX;
    this.y = hy + Camera.BODY + this.lookY;
    this.init = true;
    this.clamp(mapW, mapH, viewW, viewH);
  }

  reset(): void {
    this.init = false;
    this.pullX = this.pullY = 0;
  }

  /** Clamp to the map; a map smaller than the view is centred on that axis. */
  clamp(mapW: number, mapH: number, viewW: number, viewH: number): void {
    if (mapW <= viewW) this.x = mapW / 2;
    else this.x = Math.min(Math.max(this.x, viewW / 2), mapW - viewW / 2);
    if (mapH <= viewH) this.y = mapH / 2;
    else this.y = Math.min(Math.max(this.y, viewH / 2), mapH - viewH / 2);
  }
}

/** Buffer origin (integer world px) and final-blit device offset for a camera position. */
export function blitPlan(camX: number, camY: number, s: Screen, shakeX = 0, shakeY = 0) {
  const left = camX - s.viewW / 2;
  const top = camY - s.viewH / 2;
  const fl = Math.floor(left);
  const ft = Math.floor(top);
  const ox = fl - 1 + shakeX;
  const oy = ft - 1 + shakeY;
  // the buffer pixel (1,1) holds world (fl, ft); shift left by (1 + frac) art px in device px
  const offX = -Math.round((1 + (left - fl)) * s.k);
  const offY = -Math.round((1 + (top - ft)) * s.k);
  return { left, top, ox, oy, offX, offY };
}
