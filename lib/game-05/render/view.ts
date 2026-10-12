/**
 * Game 05 Canvas 2D view (render lane) behind the contract's ViewApi.
 *
 * Pixel contract: the canvas backing store is in device pixels; every art pixel is exactly k×k
 * device pixels, k = max(1, floor(min(devW, devH) / 360)). The world is drawn at 1x into an
 * offscreen buffer (ceil(dev / k) + 2 art px) at an integer world origin; the fractional camera
 * part becomes a whole-device-pixel offset on the one integer upscale. imageSmoothingEnabled is
 * false everywhere and nothing is ever scaled or rotated except that final blit. Combat text is
 * drawn after the blit, on the same display canvas, at device resolution (numbers.ts).
 *
 * Frame: ground layer (chunk cache, one blit) → water glints → cut stubble, telegraph fissures,
 * drop shadows → y-sorted props, chests, gate tiles, actors, hero, pickups, projectiles (canopies
 * and roofs fade to 35% over the hero; waders lose their feet under a ripple) → lit particles and
 * sprites, death dissolves → fog → light map (ambient grade × key light × vignette + banded
 * lights, multiplied) → shafts, glows, lit windows, telegraph glow, emissive effects, the raised
 * item, NPC markers → upscale → numbers.
 *
 * Time: the WorldView is already interpolated by the simulation (Sim.worldView(alpha)), so the
 * view draws positions as given; its own clock (dt) drives animation, particles and lights.
 * Ground chunks for the first view are built on the map's first frame, the ring around the view
 * one per frame, the rest of the map in idle callbacks.
 *
 * Coordinates: world px (1 = one art pixel). Map placements (props, entities) are in tiles:
 * world = tile × 32. A `light` entity radius ≤ 12 is taken as tiles, otherwise px.
 * Assets: `${assetBase}/art/atlas.json` (contract Atlas); image paths are relative to it. A key
 * whose image fails to load falls back to its dev placeholder (`art/dev/atlas.dev.json`).
 */
import {
  TILE,
  type ActorAnim, type ActorView, type Cond, type CreateView, type EntityPlacement, type HeroAnim, type MapDef,
  type PickupView, type ProjectileView, type PropKind, type Rect, type SimEvent, type ViewApi, type ViewOptions,
  type WorldView,
} from "../contract";
import { PROPS, type PropDef } from "../content/props";
import { AtlasRT, frameAt, resolveAnim, type ResolvedAnim, type SheetRT, type Variant } from "./atlas";
import { blitPlan, Camera, computeScreen, type Screen } from "./camera";
import { Fx, ringSprite } from "./fx";
import { crackSprite, ditherPatterns, markerSprite, rippleSprite, shadowSprite, sporeHaze } from "./glyphs";
import { CHUNK_PX, GroundCache } from "./ground";
import { ambientFor, darkness, FOG_TILE, fogMask, fogTexture, flicker, Lighting, makeShaft } from "./lighting";
import { loadPixelFont, Numbers } from "./numbers";
import { clamp, ctx2d, DIR_VEC, hash1, hash2, makeCanvas, type Canvas, type Ctx } from "./util";

// ─── runtime records ─────────────────────────────────────────────────────────────────────────
interface PropRT {
  i: number;
  kind: PropKind;
  x: number;
  y: number;
  v: number;
  id?: string;
  flip: boolean;
  def: PropDef;
  sheet: SheetRT | null;
  flat: boolean;
  removable: boolean;
  canopy: number;
  fade: number;
  light: { radius: number; color: string; flicker?: boolean; dy: number } | null;
  shadow: [number, number] | null;
  phase: number;
  /** Resolved anims by state (see propAnim), filled lazily. */
  anims: Array<ResolvedAnim | null | undefined>;
}

/** Prop anim states: the variant still, lit (lamps at night, fires), pulled (levers), cut/broken. */
const PS_BASE = 0, PS_LIT = 1, PS_ON = 2, PS_CUT = 3;
interface GateRT { id: string; kind: "flame" | "iron" | "thorns"; x: number; y: number; w: number; h: number; openT: number }
interface ChestRT { id: string; x: number; y: number; openT: number }
interface LightRT { x: number; y: number; r: number; color: string; flicker: boolean; night: boolean; seed: number }
interface ShaftRT { x: number; y: number; w: number; h: number; kind: "window" | "sunbeam"; canvas: Canvas; seed: number }
interface FogRT { x: number; y: number; w: number; h: number; mask: Canvas; seed: number }
interface Ghost { sheet: SheetRT; frame: number; flip: boolean; x: number; y: number; t: number; elite: boolean }
interface DrawItem { y: number; o: number; k: number; ref: unknown; a: number }

const HERO_ANIMS: Record<HeroAnim, string[]> = {
  stand: ["stand", "idle"],
  walk: ["walk", "stand"],
  attack: ["attack1", "attack", "stand"],
  spin: ["spin", "attack1", "stand"],
  cast: ["cast", "stand"],
  dodge: ["dodge", "walk", "stand"],
  hurt: ["hurt", "stand"],
  dead: ["dead", "hurt", "stand"],
  raise: ["raise", "cast", "stand"],
};
const ACTOR_ANIMS: Record<ActorAnim, string[]> = {
  idle: ["idle", "stand", "walk"],
  walk: ["walk", "idle", "stand"],
  windup: ["windup", "idle", "stand"],
  attack: ["attack", "windup", "walk", "idle", "stand"],
  hurt: ["hurt", "idle", "stand"],
  dead: ["dead", "hurt", "idle", "stand"],
  special: ["special", "attack", "idle", "stand"],
};

/** Blood / sap colours per monster sheet (hit particles). */
const GORE: Record<string, [string, string, string]> = {
  "mon.mossling": ["#9df0a8", "#4fbf6a", "#2a7a44"],
  "mon.thornling": ["#b8e070", "#6a9a30", "#3a5a1a"],
  "mon.duskbat": ["#e05060", "#a02034", "#5a1020"],
  "mon.bristleboar": ["#f06050", "#c02a2a", "#701820"],
  "mon.greywolf": ["#f06050", "#c02a2a", "#701820"],
  "mon.sporecap": ["#ffd080", "#e09040", "#8a5020"],
  "mon.webspinner": ["#e8f070", "#a8c030", "#5a7020"],
  "mon.barrowGuard": ["#f4ecd8", "#c8bca0", "#7a705c"],
  "mon.thornmother": ["#b0e060", "#5a9a30", "#4a2a5a"],
  "mon.dummy": ["#f0d890", "#c8a050", "#806030"],
  hero: ["#ff7060", "#d02838", "#7a1020"],
};
const GORE_DEFAULT: [string, string, string] = ["#f06050", "#c02a2a", "#701820"];

/**
 * Projectiles. The sim places a projectile about 8 px above the ground it travels over, so the
 * ground point is (x, y + ground); the sprite centre floats z px above that ground point.
 */
const PROJ_KEYS: Record<ProjectileView["kind"], { key: string; anim: string[]; ground: number; z: number; light?: [number, string] }> = {
  emberBolt: { key: "fx.ember", anim: ["fly"], ground: 8, z: 16, light: [44, "#ff9a3a"] },
  frostRing: { key: "fx.frost", anim: ["shard", "fly"], ground: 8, z: 6, light: [48, "#8fe4ff"] },
  thorn: { key: "fx.thorn", anim: ["fly"], ground: 8, z: 14 },
  web: { key: "fx.web", anim: ["fly"], ground: 8, z: 14 },
  spore: { key: "fx.spore", anim: ["cloud", "fly"], ground: 6, z: 8, light: [30, "#b8f070"] },
  thornLine: { key: "fx.thornLine", anim: ["rise", "fly"], ground: 6, z: 0 },
};
const projGround = (p: ProjectileView): number => p.y + PROJ_KEYS[p.kind].ground;

const LIGHT_CUT = 0.18;

class PixelView implements ViewApi {
  readonly ready: Promise<void>;
  private canvas: HTMLCanvasElement;
  private opts: ViewOptions;
  private display: Ctx;
  private buf: Canvas;
  private g: Ctx;
  private atlas: AtlasRT;
  private loaded = false;
  private disposed = false;
  private screen: Screen = computeScreen(1, 1, 1);
  private devOverride: { w: number; h: number } | null = null;
  private ro: ResizeObserver | null = null;
  private cam = new Camera();
  private lighting = new Lighting();
  private fx: Fx;
  private numbers = new Numbers();
  private map: MapDef | null = null;
  private pendingMap: MapDef | null = null;
  private ground: GroundCache | null = null;
  private props: PropRT[] = [];
  private buckets: number[][] = [];
  private bucketCols = 1;
  private bucketRows = 1;
  private gates: GateRT[] = [];
  /** Lever prop id → ids of the gates whose open condition names that lever's flag. */
  private leverGates = new Map<string, string[]>();
  private chests: ChestRT[] = [];
  private lights: LightRT[] = [];
  private shafts: ShaftRT[] = [];
  private fogs: FogRT[] = [];
  private world: WorldView | null = null;
  private heroX = 0;
  private heroY = 0;
  private hasHero = false;
  /** Set by setMap: the next update adopts gate/chest state silently (no opening effects). */
  private fresh = true;
  private needFirstView = true;
  private t = 0;
  private events: SimEvent[] = [];
  private shake = { amp: 0, t: 0, dur: 0, x: 0, y: 0 };
  private freeze = 0;
  private ghosts: Ghost[] = [];
  private lastActors = new Map<number, { a: ActorView; sheet: SheetRT | null; frame: number; flip: boolean }>();
  private dodgeTrail: Array<{ x: number; y: number; sheet: SheetRT; frame: number; flip: boolean; t: number }> = [];
  private raiseItem: string | null = null;
  private raiseT = -1;
  private plan = blitPlan(0, 0, computeScreen(1, 1, 1));
  private drawPool: DrawItem[] = [];
  private drawList: DrawItem[] = [];
  private scratch: Canvas;
  private sg: Ctx;
  private dither: Array<CanvasPattern | null>;
  private knownChestOpen = new Set<string>();
  private knownGateOpen = new Set<string>();
  private projTrail = new Map<number, { x: number; y: number }>();
  private groundLayer: { canvas: Canvas; ctx: Ctx; w: number; h: number; c0: number; r0: number; src: GroundCache | null; composes: number } =
    (() => {
      const canvas = makeCanvas(8, 8);
      return { canvas, ctx: ctx2d(canvas, { alpha: false }), w: 8, h: 8, c0: 0, r0: 0, src: null, composes: 0 };
    })();
  private fogScratch: Canvas = makeCanvas(8, 8);
  private fogCtx: Ctx = ctx2d(this.fogScratch);
  private fogPattern: CanvasPattern | null = null;
  private fogMatrix = new DOMMatrix();
  private lastProj = new Map<number, ProjectileView>();
  private liveProj = new Set<number>();
  private numberBoxes: Array<{ l: number; t: number; r: number; b: number }> = [];
  private stats = { frames: 0, renderMs: 0, updateMs: 0, maxRenderMs: 0, samples: [] as number[] };

  constructor(canvas: HTMLCanvasElement, opts: ViewOptions) {
    this.canvas = canvas;
    this.opts = opts;
    this.display = ctx2d(canvas, { alpha: false });
    canvas.style.imageRendering = "pixelated";
    this.buf = makeCanvas(8, 8);
    this.g = ctx2d(this.buf, { alpha: false });
    this.scratch = makeCanvas(256, 256);
    this.sg = ctx2d(this.scratch);
    this.dither = ditherPatterns(this.sg);
    this.atlas = new AtlasRT(opts.assetBase || "/games/game-05");
    this.fx = new Fx(this.atlas);
    this.ready = Promise.all([this.atlas.load(opts.onProgress), loadPixelFont()]).then(() => {
      this.loaded = true;
      this.atlas.preloadIcons();
      if (this.pendingMap) {
        const m = this.pendingMap;
        this.pendingMap = null;
        this.setMap(m);
      }
    });
    if (typeof ResizeObserver !== "undefined") {
      try {
        this.ro = new ResizeObserver((entries) => {
          for (const e of entries) {
            const box = (e as ResizeObserverEntry & { devicePixelContentBoxSize?: ReadonlyArray<ResizeObserverSize> })
              .devicePixelContentBoxSize?.[0];
            if (!box) continue;
            const w = Math.round(box.inlineSize), h = Math.round(box.blockSize);
            if (w > 0 && h > 0 && (w !== this.screen.devW || h !== this.screen.devH)) {
              this.devOverride = { w, h };
              this.applyScreen(this.screen.cssW, this.screen.cssH, this.screen.dpr);
            }
          }
        });
        this.ro.observe(canvas, { box: "device-pixel-content-box" as ResizeObserverBoxOptions });
      } catch {
        this.ro = null;
      }
    }
  }

  // ─── ViewApi ────────────────────────────────────────────────────────────────────────────────
  setMap(map: MapDef): void {
    if (!this.loaded) {
      this.pendingMap = map;
      this.map = map;
      return;
    }
    this.map = map;
    this.cancelStream();
    this.ground?.dispose();
    const ground = new GroundCache(map, this.atlas);
    this.ground = ground;
    this.buildProps(map);
    this.buildEntities(map);
    ground.deco = (g, x0, y0, w, h) => this.decorateChunk(g, x0, y0, w, h);
    this.cam.reset();
    this.fx.clear();
    this.numbers.clear();
    this.ghosts.length = 0;
    this.hasHero = false;
    this.fresh = true;
    this.needFirstView = true;
    this.lastActors.clear();
    this.projTrail.clear();
    this.lastProj.clear();
    this.dodgeTrail.length = 0;
    this.raiseT = -1;
    // the first update builds what the hero will see (at the hero, who may enter by any door);
    // the rest streams in at 2 ms per frame
  }

  resize(cssWidth: number, cssHeight: number, pixelRatio: number): void {
    this.devOverride = null;
    this.applyScreen(cssWidth, cssHeight, pixelRatio);
  }

  private applyScreen(cssW: number, cssH: number, dpr: number): void {
    const s = computeScreen(cssW, cssH, dpr, this.devOverride ?? undefined);
    this.screen = s;
    if (this.canvas.width !== s.devW) this.canvas.width = s.devW;
    if (this.canvas.height !== s.devH) this.canvas.height = s.devH;
    this.canvas.style.width = `${cssW}px`;
    this.canvas.style.height = `${cssH}px`;
    this.display = ctx2d(this.canvas, { alpha: false });
    if (this.buf.width !== s.bw || this.buf.height !== s.bh) {
      this.buf.width = s.bw;
      this.buf.height = s.bh;
      this.g = ctx2d(this.buf, { alpha: false });
    }
    this.lighting.resize(s.bw, s.bh);
  }

  onEvents(events: readonly SimEvent[]): void {
    for (const e of events) this.events.push(e);
  }

  update(world: WorldView, dtSeconds: number, alpha: number): void {
    const t0 = performance.now();
    const dt = clamp(dtSeconds, 0, 0.1);
    this.world = world;
    void alpha; // the WorldView is already interpolated by the simulation (Sim.worldView(alpha))
    this.t += dt;
    if (!this.loaded || !this.ground || !this.map) return;
    const h = world.hero;
    const teleport = !this.hasHero || Math.abs(h.x - this.heroX) + Math.abs(h.y - this.heroY) > 96;
    this.heroX = h.x;
    this.heroY = h.y;
    this.hasHero = true;
    if (this.fresh) {
      this.fresh = false;
      this.knownGateOpen = new Set(world.openGates);
      this.knownChestOpen = new Set(world.openChests);
    }
    // events
    if (this.events.length) {
      const evs = this.events;
      this.events = [];
      for (const e of evs) this.handle(e, world);
    }
    // camera
    const moving = h.anim === "walk" || h.anim === "dodge";
    const s = this.screen;
    if (teleport) this.cam.reset();
    // a boss in the fight pulls the camera a third of the way toward it
    let focus: { x: number; y: number; weight: number } | null = null;
    for (const a of world.actors) {
      if (a.kind !== "monster" || a.radius < 20 || a.alpha < 0.5) continue;
      const d = Math.hypot(a.x - h.x, a.y - h.y);
      if (d < 320) focus = { x: a.x, y: a.y - this.spriteTop(a.sprite) * 0.45, weight: 0.36 };
    }
    this.cam.focus = focus;
    this.cam.update(this.heroX, this.heroY, h.facing, moving, dt, this.ground.pxW, this.ground.pxH, s.viewW, s.viewH);
    // shake (whole art pixels)
    const sk = this.shake;
    if (sk.t > 0 && !this.opts.reducedMotion) {
      sk.t -= dt;
      const k = clamp(sk.t / Math.max(0.001, sk.dur), 0, 1);
      const a = sk.amp * k;
      sk.x = Math.round((Math.random() * 2 - 1) * a);
      sk.y = Math.round((Math.random() * 2 - 1) * a);
    } else {
      sk.x = sk.y = 0;
    }
    // effects advance unless a hit-stop freezes them
    const fdt = this.freeze > 0 ? 0 : dt;
    if (this.freeze > 0) this.freeze -= dt;
    this.fx.update(fdt);
    this.numbers.update(dt);
    this.ambientFx(world, fdt);
    for (const gh of this.ghosts) gh.t += fdt;
    this.ghosts = this.ghosts.filter((gh) => gh.t < 0.5);
    this.dodgeTrail = this.dodgeTrail.filter((d) => this.t - d.t < 0.16);
    // canopy fades
    this.updateCanopies(dt);
    // gates and chests that changed state
    for (const gt of this.gates) {
      const open = world.openGates.has(gt.id);
      if (open && !this.knownGateOpen.has(gt.id)) {
        this.knownGateOpen.add(gt.id);
        if (gt.openT < 0) gt.openT = this.t;
        this.gateOpenFx(gt);
      } else if (!open && this.knownGateOpen.has(gt.id)) {
        this.knownGateOpen.delete(gt.id);
        gt.openT = -1;
      }
    }
    for (const c of this.chests) {
      if (world.openChests.has(c.id) && !this.knownChestOpen.has(c.id)) {
        this.knownChestOpen.add(c.id);
        c.openT = this.t;
      }
    }
    // projectiles that ended: clouds disperse, spikes crumble
    const liveProj = this.liveProj;
    liveProj.clear();
    for (const p of world.projectiles) liveProj.add(p.id);
    for (const [id, p] of this.lastProj) {
      if (liveProj.has(id)) continue;
      this.lastProj.delete(id);
      this.projTrail.delete(id);
      const gy = projGround(p);
      if (p.kind === "spore") {
        this.fx.play("fx.spore", ["burst"], p.x, gy - 8, { emissive: false });
        this.fx.burst(p.x, gy, 10, { colors: ["#e0f0a0", "#b0d060", "#809040"], speed: [10, 30], up: [10, 30], life: [0.5, 0.9], z: 6, grav: -8, drag: 2, spread: p.r * 0.6 });
      } else if (p.kind === "thornLine" && p.age >= 0) {
        this.fx.burst(p.x, gy, 4, { colors: ["#6a8a30", "#3a5020", "#5a4028"], speed: [10, 30], up: [30, 60], life: [0.3, 0.5], grav: 260, size: [1, 2] });
      }
    }
    for (const p of world.projectiles) this.lastProj.set(p.id, p);
    // monsters that vanished while visible dissolve in place
    const now = new Set<number>();
    for (const a of world.actors) now.add(a.id);
    for (const [id, last] of this.lastActors) {
      if (!now.has(id) && last.sheet && last.a.kind === "monster" && last.a.alpha > 0.1) {
        this.ghosts.push({ sheet: last.sheet, frame: last.frame, flip: last.flip, x: last.a.x, y: last.a.y - last.a.z, t: 0, elite: last.a.elite });
      }
      if (!now.has(id)) this.lastActors.delete(id);
    }
    // ground: everything the camera shows is built now (all of it on a map's first frame, where
    // the host is fading in); the ring just outside the view one chunk per frame; the rest of
    // the map streams in during idle time between frames
    {
      const vx = this.cam.x - s.viewW / 2, vy = this.cam.y - s.viewH / 2;
      if (this.needFirstView) {
        this.needFirstView = false;
        this.ground.ensure(vx - 64, vy - 64, s.viewW + 128, s.viewH + 128);
      } else this.ground.ensure(vx - 128, vy - 128, s.viewW + 256, s.viewH + 256, 1);
    }
    this.scheduleStream();
    const ms = performance.now() - t0;
    this.stats.updateMs = this.stats.updateMs * 0.95 + ms * 0.05;
  }

  render(): void {
    const t0 = performance.now();
    const s = this.screen;
    const D = this.display;
    if (!this.loaded || !this.ground || !this.map || !this.world) {
      D.setTransform(1, 0, 0, 1, 0, 0);
      D.fillStyle = "#06060a";
      D.fillRect(0, 0, s.devW, s.devH);
      return;
    }
    const world = this.world;
    const plan = blitPlan(this.cam.x, this.cam.y, s, this.shake.x, this.shake.y);
    this.plan = plan;
    const { ox, oy } = plan;
    const g = this.g;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalAlpha = 1;
    g.globalCompositeOperation = "source-over";
    g.imageSmoothingEnabled = false;
    g.fillStyle = "#06060a";
    g.fillRect(0, 0, s.bw, s.bh);
    // 1. ground (one blit of the chunk-aligned ground layer)
    this.drawGround(g, ox, oy);
    // 2. animated water glints
    this.drawWater(g, ox, oy);
    // 3. dynamic flat things (cut stubble), then drop shadows
    this.collect(world, ox, oy);
    this.drawFlatDynamic(g, ox, oy);
    this.drawGroundDecals(g, ox, oy, world);
    this.drawShadows(g, ox, oy);
    // 4. y-sorted sprites
    for (const it of this.drawList) this.drawItem(g, it, ox, oy, world);
    // 5. lit effects
    this.fx.parts.draw(g, ox, oy, false, this.t);
    this.fx.drawSprites(g, ox, oy, false, this.heroX, this.heroY);
    this.drawGhosts(g, ox, oy);
    // 6. fog (lit)
    this.drawFog(g, ox, oy);
    // 7. light map
    const amb = ambientFor(this.map.light, world.dusk);
    const dark = darkness(amb);
    this.lightPass(g, ox, oy, amb, dark, world);
    // 8. additive / emissive
    this.drawShafts(g, ox, oy, world);
    this.drawGlows(g, ox, oy, dark, world);
    this.drawTelegraphGlow(g, ox, oy, world);
    this.fx.drawSprites(g, ox, oy, true, this.heroX, this.heroY);
    this.fx.parts.draw(g, ox, oy, true, this.t);
    this.fx.drawSpecials(g, ox, oy, this.heroX, this.heroY);
    this.drawRaise(g, ox, oy, world);
    this.drawMarkers(g, ox, oy, world);
    // 9. the one integer upscale
    D.setTransform(1, 0, 0, 1, 0, 0);
    D.imageSmoothingEnabled = false;
    D.globalCompositeOperation = "source-over";
    D.drawImage(this.buf, 0, 0, s.bw, s.bh, plan.offX, plan.offY, s.bw * s.k, s.bh * s.k);
    // 10. device-resolution combat text on the display canvas (never in the art buffer)
    this.numbers.reducedMotion = !!this.opts.reducedMotion;
    this.numberBoxes = this.numbers.render(D, (x, y) => this.toDevice(x, y), s.k).slice();
    const ms = performance.now() - t0;
    const st = this.stats;
    st.frames++;
    st.renderMs = st.frames < 10 ? ms : st.renderMs * 0.95 + ms * 0.05;
    st.maxRenderMs = Math.max(st.maxRenderMs * 0.999, ms);
    if (st.samples.length < 2000) st.samples.push(ms);
  }

  project(x: number, y: number): { x: number; y: number; visible: boolean } {
    const [dx, dy] = this.toDevice(x, y);
    const s = this.screen;
    return { x: dx / s.dpr, y: dy / s.dpr, visible: dx >= 0 && dy >= 0 && dx <= s.devW && dy <= s.devH };
  }

  viewRect(): Rect {
    const s = this.screen;
    return { x: this.cam.x - s.viewW / 2, y: this.cam.y - s.viewH / 2, w: s.viewW, h: s.viewH };
  }

  setReducedMotion(reduced: boolean): void {
    this.opts = { ...this.opts, reducedMotion: reduced };
    if (reduced) this.shake.t = 0;
  }

  /** Ground chunks outside the first view are built in idle callbacks, nearest to the camera first. */
  private streamHandle: number | null = null;
  private streamTimer = false;
  private scheduleStream(): void {
    const gc = this.ground;
    if (this.streamHandle !== null || !gc || gc.complete || this.disposed) return;
    const run = (deadline?: IdleDeadline) => {
      this.streamHandle = null;
      const g = this.ground;
      if (!g || this.disposed) return;
      const budget = deadline ? Math.min(8, deadline.timeRemaining() - 1) : 3;
      g.prebuild(this.cam.x, this.cam.y, budget, !deadline || deadline.didTimeout);
      this.scheduleStream();
    };
    if (typeof requestIdleCallback === "function") {
      this.streamTimer = false;
      this.streamHandle = requestIdleCallback(run, { timeout: 150 });
    } else {
      this.streamTimer = true;
      this.streamHandle = window.setTimeout(() => run(), 30);
    }
  }

  private cancelStream(): void {
    if (this.streamHandle === null) return;
    if (this.streamTimer) window.clearTimeout(this.streamHandle);
    else if (typeof cancelIdleCallback === "function") cancelIdleCallback(this.streamHandle);
    this.streamHandle = null;
  }

  dispose(): void {
    this.disposed = true;
    this.cancelStream();
    this.ro?.disconnect();
    this.ro = null;
    this.ground?.dispose();
    this.ground = null;
    this.groundLayer.src = null;
    this.fx.clear();
  }

  // ─── internals ──────────────────────────────────────────────────────────────────────────────
  private toDevice(x: number, y: number): [number, number] {
    const s = this.screen;
    const p = this.plan;
    return [p.offX + (x - p.ox) * s.k, p.offY + (y - p.oy) * s.k];
  }

  /** First sheet present among keys (the art lane also publishes obj.* aliases). */
  private sheetOf(...keys: string[]): SheetRT | null {
    for (const k of keys) {
      const s = this.atlas.sheets.get(k);
      if (s) return s;
    }
    return this.atlas.sheet(keys[0]);
  }

  private propSheet(kind: PropKind): SheetRT | null {
    return this.atlas.sheets.get(`prop.${kind}`) ?? null;
  }

  private buildProps(map: MapDef): void {
    const gc = this.ground!;
    this.props = [];
    this.bucketCols = gc.cols;
    this.bucketRows = gc.rows;
    this.buckets = Array.from({ length: gc.cols * gc.rows }, () => []);
    map.props.forEach((p, i) => {
      const def = PROPS[p.kind];
      if (!def) return;
      const sheet = this.propSheet(p.kind);
      if (!sheet) this.atlas.sheet(`prop.${p.kind}`);
      const sd = sheet?.def;
      const light = sd?.light ? { radius: sd.light.radius, color: sd.light.color, flicker: sd.light.flicker, dy: sd.light.dy ?? -16 }
        : def.light ?? null;
      const removable = !!(def.cut || def.breaks || def.interact === "lever");
      const flat = !!def.flat;
      let shadow: [number, number] | null = null;
      if (sd?.shadow) shadow = sd.shadow[0] > 0 ? [sd.shadow[0], sd.shadow[1]] : null;
      else if (!flat && sheet && def.solid) {
        const w = Math.round(sheet.w * 0.6);
        shadow = [w, Math.max(3, Math.round(w * 0.28))];
      }
      const rt: PropRT = {
        i, kind: p.kind, x: p.x * TILE, y: p.y * TILE, v: p.v ?? 0, id: p.id, flip: !!p.flip, def, sheet, flat,
        removable, canopy: sd?.canopyAbove ?? def.canopyAbove ?? 0, fade: 1, light, shadow, phase: hash1(i, 3), anims: [],
      };
      this.props.push(rt);
      const bx = clamp(Math.floor(rt.x / CHUNK_PX), 0, gc.cols - 1), by = clamp(Math.floor(rt.y / CHUNK_PX), 0, gc.rows - 1);
      this.buckets[by * gc.cols + bx].push(this.props.length - 1);
    });
  }

  private buildEntities(map: MapDef): void {
    this.gates = [];
    this.leverGates = new Map();
    this.chests = [];
    this.lights = [];
    this.shafts = [];
    this.fogs = [];
    this.knownChestOpen = new Set(this.world?.mapId === map.id ? this.world.openChests : []);
    this.knownGateOpen = new Set(this.world?.mapId === map.id ? this.world.openGates : []);
    let seed = 1;
    for (const e of map.entities as EntityPlacement[]) {
      seed++;
      switch (e.type) {
        case "gate": {
          this.gates.push({ id: e.id, kind: e.kind, x: e.x * TILE, y: e.y * TILE, w: e.w * TILE, h: e.h * TILE, openT: -1 });
          const flags: string[] = [];
          const walk = (c: Cond) => {
            if ("flag" in c) flags.push(c.flag);
            else if ("any" in c) c.any.forEach(walk);
            else if ("all" in c) c.all.forEach(walk);
          };
          walk(e.open);
          for (const p of map.props) {
            if (p.kind !== "lever" || !p.id || !flags.includes(p.id)) continue;
            const list = this.leverGates.get(p.id) ?? [];
            list.push(e.id);
            this.leverGates.set(p.id, list);
          }
          break;
        }
        case "chest":
          this.chests.push({ id: e.id, x: e.x * TILE, y: e.y * TILE, openT: -99 });
          break;
        case "light":
          this.lights.push({
            x: e.x * TILE, y: e.y * TILE, r: e.radius <= 12 ? e.radius * TILE : e.radius, color: e.color,
            flicker: !!e.flicker, night: !!e.night, seed,
          });
          break;
        case "shaft": {
          const w = e.w * TILE, h = e.h * TILE;
          this.shafts.push({ x: e.x * TILE, y: e.y * TILE, w, h, kind: e.kind, canvas: makeShaft(w, h, e.kind), seed });
          break;
        }
        case "fog": {
          const w = Math.round(e.w * TILE), h = Math.round(e.h * TILE);
          this.fogs.push({ x: e.x * TILE, y: e.y * TILE, w, h, mask: fogMask(w, h, Math.min(72, Math.min(w, h) / 2.2), seed), seed });
          break;
        }
        default:
          break;
      }
    }
  }

  /** Bake flat props and static drop shadows into a ground chunk. */
  private decorateChunk(g: Ctx, x0: number, y0: number, w: number, h: number): void {
    const cx = Math.floor(x0 / CHUNK_PX), cy = Math.floor(y0 / CHUNK_PX);
    const list: PropRT[] = [];
    for (let by = cy - 1; by <= cy + 1; by++)
      for (let bx = cx - 1; bx <= cx + 1; bx++) {
        if (bx < 0 || by < 0 || bx >= this.bucketCols || by >= this.bucketRows) continue;
        for (const i of this.buckets[by * this.bucketCols + bx]) list.push(this.props[i]);
      }
    list.sort((a, b) => a.y - b.y || a.i - b.i);
    for (const p of list) {
      if (p.removable || !p.sheet) continue;
      if (p.shadow && !p.flat) {
        const sh = shadowSprite(p.shadow[0], p.shadow[1]);
        const sx = Math.round(p.x + 2 - sh.width / 2) - x0, sy = Math.round(p.y - sh.height / 2) - y0;
        if (sx < w && sy < h && sx + sh.width > 0 && sy + sh.height > 0) g.drawImage(sh, sx, sy);
      }
    }
    for (const p of list) {
      if (!p.flat || p.removable || !p.sheet) continue;
      const a = this.propAnim(p, PS_BASE);
      if (!a) continue;
      if (a.frames.length > 1 && a.fps > 0) continue; // animated flats are drawn live
      this.blitFrame(g, p.sheet, a.frames[0], p.flip !== a.flip, p.x, p.y, x0, y0, "normal");
    }
  }

  /**
   * The ground chunks under the view are composed into one chunk-aligned layer canvas that is only
   * recomposed when the camera crosses a chunk line, so a frame blits the ground with one call.
   */
  private drawGround(g: Ctx, ox: number, oy: number): void {
    const gc = this.ground!;
    const s = this.screen;
    const cols = Math.ceil(s.bw / CHUNK_PX) + 1, rows = Math.ceil(s.bh / CHUNK_PX) + 1;
    const c0 = Math.floor(ox / CHUNK_PX), r0 = Math.floor(oy / CHUNK_PX);
    const W = cols * CHUNK_PX, H = rows * CHUNK_PX;
    const L = this.groundLayer;
    if (L.w !== W || L.h !== H) {
      L.canvas.width = W;
      L.canvas.height = H;
      L.ctx = ctx2d(L.canvas, { alpha: false });
      L.w = W;
      L.h = H;
      L.src = null;
    }
    if (L.src !== gc || L.c0 !== c0 || L.r0 !== r0) {
      const lg = L.ctx;
      lg.fillStyle = "#06060a";
      lg.fillRect(0, 0, W, H);
      for (let cy = r0; cy < r0 + rows; cy++)
        for (let cx = c0; cx < c0 + cols; cx++) {
          const ch = gc.chunk(cx, cy);
          if (ch) lg.drawImage(ch, (cx - c0) * CHUNK_PX, (cy - r0) * CHUNK_PX);
        }
      L.src = gc;
      L.c0 = c0;
      L.r0 = r0;
      L.composes++;
    }
    g.drawImage(L.canvas, c0 * CHUNK_PX - ox, r0 * CHUNK_PX - oy);
  }

  /** Draw one frame with its anchor at world (x, y). `cut` hides that many rows above the feet line (wading). */
  private blitFrame(g: Ctx, sh: SheetRT, fi: number, flip: boolean, x: number, y: number, ox: number, oy: number,
    variant: Variant, cut = 0): void {
    const fy = sh.fy(fi);
    const sx = sh.srcX(fi, flip);
    const bx = Math.round(x) - ox - (flip ? sh.w - sh.ax : sh.ax);
    const by = Math.round(y) - oy - sh.ay;
    const h = cut > 0 ? Math.min(sh.h, Math.max(0, sh.ay - cut)) : sh.h;
    if (h > 0) g.drawImage(sh.page(variant, flip), sx, fy, sh.w, h, bx, by, sh.w, h);
  }

  /** Rows of an actor standing at (x, y) hidden under shallow water (0 when not wading). */
  private wadeCut(x: number, y: number, z = 0): number {
    if (z > 0.5 || !this.ground) return 0;
    return this.ground.groundAt(Math.floor(x / TILE), Math.floor(y / TILE)) === 119 ? 4 : 0;
  }

  private ripple(g: Ctx, x: number, y: number, w: number, half: "back" | "front", ox: number, oy: number): void {
    const wob = this.opts.reducedMotion ? 0 : Math.floor(this.t * 3 + x * 0.1) % 2;
    const spr = rippleSprite(w + wob * 2, 5 + wob, half);
    g.drawImage(spr, Math.round(x - spr.width / 2) - ox, Math.round(y - spr.height / 2) - oy);
  }

  /** Indices of props whose bucket is near the view (cached for the last rect asked; callers never mutate it). */
  private visCache = { ox: NaN, oy: NaN, bw: 0, bh: 0, props: null as PropRT[] | null, list: [] as number[] };
  private visiblePropIdx(ox: number, oy: number, bw: number, bh: number): number[] {
    const vc = this.visCache;
    if (vc.ox === ox && vc.oy === oy && vc.bw === bw && vc.bh === bh && vc.props === this.props) return vc.list;
    const out = vc.list;
    out.length = 0;
    vc.ox = ox;
    vc.oy = oy;
    vc.bw = bw;
    vc.bh = bh;
    vc.props = this.props;
    const margin = 260;
    const c0 = Math.max(0, Math.floor((ox - margin) / CHUNK_PX)), c1 = Math.min(this.bucketCols - 1, Math.floor((ox + bw + margin) / CHUNK_PX));
    const r0 = Math.max(0, Math.floor((oy - 16) / CHUNK_PX)), r1 = Math.min(this.bucketRows - 1, Math.floor((oy + bh + margin) / CHUNK_PX));
    for (let by = r0; by <= r1; by++)
      for (let bx = c0; bx <= c1; bx++) for (const i of this.buckets[by * this.bucketCols + bx]) out.push(i);
    return out;
  }

  private item(y: number, o: number, k: number, ref: unknown, a = 0): void {
    let it = this.drawPool[this.drawList.length];
    if (!it) {
      it = { y: 0, o: 0, k: 0, ref: null, a: 0 };
      this.drawPool.push(it);
    }
    it.y = y;
    it.o = o;
    it.k = k;
    it.ref = ref;
    it.a = a;
    this.drawList.push(it);
  }

  /** Gather everything y-sorted this frame. k: 0 prop, 1 actor, 2 hero, 3 chest, 4 gate tile, 5 pickup, 6 projectile. */
  private collect(world: WorldView, ox: number, oy: number): void {
    this.drawList.length = 0;
    const s = this.screen;
    const vx0 = ox - 120, vx1 = ox + s.bw + 120, vy0 = oy - 16, vy1 = oy + s.bh + 240;
    for (const i of this.visiblePropIdx(ox, oy, s.bw, s.bh)) {
      const p = this.props[i];
      if (p.flat && !p.removable) continue;
      if (p.id && world.removedProps.has(p.id)) continue;
      if (p.x < vx0 || p.x > vx1 || p.y < vy0 || p.y > vy1) continue;
      if (p.flat) continue;
      this.item(p.y, p.i, 0, p);
    }
    for (const c of this.chests) if (c.x > vx0 && c.x < vx1 && c.y > vy0 && c.y < vy1) this.item(c.y, 0, 3, c);
    for (const gt of this.gates) {
      const open = world.openGates.has(gt.id);
      const opening = open && gt.openT >= 0 && this.t - gt.openT < 0.9;
      if (open && !opening) continue;
      if (gt.x + gt.w < vx0 || gt.x > vx1 || gt.y + gt.h < vy0 || gt.y > vy1) continue;
      const cols = Math.max(1, Math.round(gt.w / TILE)), rows = Math.max(1, Math.round(gt.h / TILE));
      for (let r = 0; r < rows; r++)
        for (let c = 0; c < cols; c++) this.item(gt.y + (r + 1) * TILE - 2, r * 64 + c, 4, gt, c + r * 100);
    }
    for (const a of world.actors) {
      if (a.x < vx0 || a.x > vx1 || a.y < vy0 || a.y > vy1) continue;
      this.item(a.y, a.id, 1, a);
    }
    this.item(this.heroY, 0, 2, world.hero);
    for (const p of world.pickups) if (p.x > vx0 && p.x < vx1 && p.y > vy0 && p.y < vy1) this.item(p.y, p.id, 5, p);
    for (const p of world.projectiles) {
      if (p.x < vx0 || p.x > vx1 || p.y < vy0 || p.y > vy1) continue;
      if (p.kind === "thornLine" && p.age < 0) continue; // a telegraph: ground decal only
      this.item(p.kind === "frostRing" || p.kind === "spore" ? projGround(p) - 60 : projGround(p), p.id, 6, p);
    }
    this.drawList.sort((a, b) => a.y - b.y || a.k - b.k || a.o - b.o);
  }


  private drawFlatDynamic(g: Ctx, ox: number, oy: number): void {
    const world = this.world!;
    const s = this.screen;
    for (const i of this.visiblePropIdx(ox, oy, s.bw, s.bh)) {
      const p = this.props[i];
      if (!p.sheet) continue;
      const removed = p.id ? world.removedProps.has(p.id) : false;
      if (removed) {
        const a = this.propAnim(p, PS_CUT);
        if (a) this.blitFrame(g, p.sheet, a.frames[a.frames.length - 1], p.flip, p.x, p.y, ox, oy, "normal");
        continue;
      }
      if (!p.flat) continue;
      const a = this.propAnim(p, PS_BASE);
      if (!a) continue;
      if (p.removable || (a.frames.length > 1 && a.fps > 0)) {
        this.blitFrame(g, p.sheet, frameAt(a, this.t + p.phase * 3), p.flip !== a.flip, p.x, p.y, ox, oy, "normal");
      }
    }
  }

  private drawShadows(g: Ctx, ox: number, oy: number): void {
    for (const it of this.drawList) {
      let x = 0, y = 0, w = 0, h = 0, z = 0;
      if (it.k === 0) {
        const p = it.ref as PropRT;
        if (!p.removable || !p.shadow) continue;
        x = p.x + 1;
        y = p.y;
        [w, h] = p.shadow;
      } else if (it.k === 1) {
        const a = it.ref as ActorView;
        const sh = this.atlas.sheets.get(a.sprite);
        const d = sh?.def.shadow;
        if (d && d[0] <= 0) continue;
        w = d ? d[0] : Math.max(10, Math.round(a.radius * 2.2));
        h = d ? d[1] : Math.max(3, Math.round(w / 3.2));
        x = a.x;
        y = a.y;
        z = a.z;
        if (this.wadeCut(x, y - z, z)) continue;
        if (a.alpha < 1) {
          w = Math.round(w * a.alpha);
          h = Math.max(1, Math.round(h * a.alpha));
        }
      } else if (it.k === 2) {
        const sh = this.atlas.sheets.get("hero");
        const d = sh?.def.shadow ?? [20, 6];
        x = this.heroX;
        y = this.heroY;
        [w, h] = d;
        if (this.wadeCut(x, y)) continue;
        if ((it.ref as WorldView["hero"]).anim === "dead") w += 10;
      } else if (it.k === 3) {
        x = (it.ref as ChestRT).x;
        y = (it.ref as ChestRT).y;
        w = 22;
        h = 6;
      } else if (it.k === 5) {
        const p = it.ref as PickupView;
        x = p.x;
        y = p.y;
        w = p.kind === "coin" ? 7 : 11;
        h = 3;
      } else if (it.k === 6) {
        const p = it.ref as ProjectileView;
        const cfg = PROJ_KEYS[p.kind];
        if (!cfg || cfg.z < 12) continue;
        x = p.x;
        y = projGround(p);
        w = 8;
        h = 3;
      } else continue;
      if (z > 0) {
        const k = clamp(1 - z / 60, 0.4, 1);
        w = Math.round(w * k);
        h = Math.max(1, Math.round(h * k));
      }
      const sh = shadowSprite(w, h);
      g.drawImage(sh, Math.round(x - sh.width / 2) - ox, Math.round(y - sh.height / 2) - oy);
    }
  }

  private drawItem(g: Ctx, it: DrawItem, ox: number, oy: number, world: WorldView): void {
    switch (it.k) {
      case 0:
        this.drawProp(g, it.ref as PropRT, ox, oy);
        break;
      case 1:
        this.drawActor(g, it.ref as ActorView, ox, oy);
        break;
      case 2:
        this.drawHero(g, world.hero, ox, oy);
        break;
      case 3:
        this.drawChest(g, it.ref as ChestRT, ox, oy, world);
        break;
      case 4:
        this.drawGateTile(g, it.ref as GateRT, it.a, ox, oy);
        break;
      case 5:
        this.drawPickup(g, it.ref as PickupView, ox, oy);
        break;
      case 6:
        this.drawProjectile(g, it.ref as ProjectileView, ox, oy);
        break;
    }
  }

  /** A prop's anim for a state, resolved once: `lit<v>` animates variant v (`lit` = variant 0). */
  private propAnim(p: PropRT, state: number): ResolvedAnim | null {
    const hit = p.anims[state];
    if (hit !== undefined) return hit;
    if (!p.sheet) return null;
    const v = `v${p.v}`;
    const names = state === PS_ON ? ["on", "v1", "cut", v, "v0"] : state === PS_CUT ? ["cut"]
      : state === PS_LIT ? (p.v ? [`lit${p.v}`, v, "v0"] : ["lit0", "lit", "v0"]) : [v, "v0"];
    const a = resolveAnim(p.sheet, names, "down");
    p.anims[state] = a;
    return a;
  }

  /**
   * A lever is shown pulled once a gate it controls is open (the lever's id is the flag in that
   * gate's `open` condition; WorldView carries no flags).
   */
  private leverOn(p: PropRT): boolean {
    const gates = p.id ? this.leverGates.get(p.id) : undefined;
    if (!gates || !this.world) return false;
    for (const g of gates) if (this.world.openGates.has(g)) return true;
    return false;
  }

  private propLit(p: PropRT): boolean {
    if (p.kind === "lamp") return darkness(ambientFor(this.map!.light, this.world!.dusk)) > LIGHT_CUT;
    if (p.kind === "wardstone") return !!this.world?.flags?.wardstoneLit;
    return true;
  }

  private drawProp(g: Ctx, p: PropRT, ox: number, oy: number): void {
    const sh = p.sheet;
    if (!sh) return;
    // lit props: `lit<v>` animates variant v (`lit` = variant 0), else the still variant
    const a = this.propAnim(p, p.kind === "wardstone" ? (this.propLit(p) ? PS_ON : PS_BASE)
      : p.kind === "lever" && this.leverOn(p) ? PS_ON : p.light && this.propLit(p) ? PS_LIT : PS_BASE);
    if (!a) return;
    const fi = frameAt(a, this.t + p.phase * 2);
    const flip = p.flip !== a.flip;
    if (p.canopy > 0 && p.fade < 0.999) {
      const fy = sh.fy(fi);
      const sx = sh.srcX(fi, flip);
      const bx = Math.round(p.x) - ox - (flip ? sh.w - sh.ax : sh.ax);
      const by = Math.round(p.y) - oy - sh.ay;
      const cut = clamp(sh.ay - p.canopy, 0, sh.h);
      g.drawImage(sh.page("normal", flip), sx, fy + cut, sh.w, sh.h - cut, bx, by + cut, sh.w, sh.h - cut);
      g.globalAlpha = p.fade;
      g.drawImage(sh.page("normal", flip), sx, fy, sh.w, cut, bx, by, sh.w, cut);
      g.globalAlpha = 1;
      return;
    }
    this.blitFrame(g, sh, fi, flip, p.x, p.y, ox, oy, "normal");
  }

  private updateCanopies(dt: number): void {
    const h = this.world?.hero;
    if (!h) return;
    const hx = this.heroX, hy = this.heroY;
    const k = 1 - Math.exp(-dt * 10);
    const s = this.screen;
    // the camera was just updated; the last render's plan may be a frame (or a map) old
    const vx = Math.floor(this.cam.x - s.viewW / 2) - 1, vy = Math.floor(this.cam.y - s.viewH / 2) - 1;
    for (const i of this.visiblePropIdx(vx, vy, s.bw, s.bh)) {
      const p = this.props[i];
      if (!p.canopy || !p.sheet) continue;
      const sh = p.sheet;
      const left = p.x - (p.flip ? sh.w - sh.ax : sh.ax);
      const top = p.y - sh.ay;
      const cutY = p.y - p.canopy;
      const behind = hy < p.y - 2 && hx + 9 > left + 4 && hx - 9 < left + sh.w - 4 && hy - 40 < cutY && hy > top + 6;
      const target = behind ? 0.35 : 1;
      p.fade += (target - p.fade) * k;
      if (Math.abs(p.fade - target) < 0.01) p.fade = target;
    }
  }

  private actorFrame(a: ActorView, sh: SheetRT): { fi: number; flip: boolean } | null {
    let names = ACTOR_ANIMS[a.anim] ?? ACTOR_ANIMS.idle;
    if (a.talking && (a.anim === "idle" || a.anim === "walk")) names = ["talk", ...names];
    const an = resolveAnim(sh, names, a.facing);
    if (!an) return null;
    // Hoppers leave the ground in their walk frames: keep those in step with the sim's hop height.
    const hopper = a.anim === "walk" && (a.sprite === "mon.mossling" || a.sprite === "mon.thornling");
    return { fi: frameAt(an, a.animTime + (an.loop && !hopper ? hash1(a.id, 9) * 2 : 0)), flip: an.flip };
  }

  private drawActor(g: Ctx, a: ActorView, ox: number, oy: number): void {
    const sh = this.atlas.sheet(a.sprite);
    if (!sh) return;
    const fr = this.actorFrame(a, sh);
    if (!fr) return;
    const x = a.x, y = a.y - a.z;
    this.lastActors.set(a.id, { a, sheet: sh, frame: fr.fi, flip: fr.flip });
    const cut = this.wadeCut(x, y, a.z);
    const rw = Math.max(12, Math.round(a.radius * 2.2));
    if (cut) this.ripple(g, x, y, rw, "back", ox, oy);
    const base: Variant = a.elite || (a.phase ?? 0) >= 3 ? "elite" : "normal";
    if (a.alpha < 0.999) {
      this.dissolve(g, sh, fr.fi, fr.flip, base, x, y, ox, oy, a.alpha);
      return;
    }
    if (a.flash > 0 && this.opts.reducedMotion) {
      // a softer hit flash: half-white over the sprite
      this.blitFrame(g, sh, fr.fi, fr.flip, x, y, ox, oy, base, cut);
      g.globalAlpha = 0.5;
      this.blitFrame(g, sh, fr.fi, fr.flip, x, y, ox, oy, "white", cut);
      g.globalAlpha = 1;
    } else this.blitFrame(g, sh, fr.fi, fr.flip, x, y, ox, oy, a.flash > 0 ? "white" : base, cut);
    if (cut) this.ripple(g, x, y, rw, "front", ox, oy);
    if (a.anim === "windup" && !a.flash && (this.opts.reducedMotion ? Math.floor(this.t * 4) % 2 === 0 : Math.floor(this.t * 12) % 2 === 0)) {
      g.globalAlpha = 0.5;
      this.blitFrame(g, sh, fr.fi, fr.flip, x, y, ox, oy, "red", cut);
      g.globalAlpha = 1;
    }
  }

  private dissolve(g: Ctx, sh: SheetRT, fi: number, flip: boolean, variant: Variant, x: number, y: number, ox: number,
    oy: number, alpha: number): void {
    if (this.scratch.width < sh.w || this.scratch.height < sh.h) {
      this.scratch.width = Math.max(this.scratch.width, sh.w);
      this.scratch.height = Math.max(this.scratch.height, sh.h);
      this.sg = ctx2d(this.scratch);
      this.dither = ditherPatterns(this.sg);
    }
    const sg = this.sg;
    sg.globalCompositeOperation = "source-over";
    sg.globalAlpha = 1;
    sg.clearRect(0, 0, sh.w, sh.h);
    const fy = sh.fy(fi);
    sg.drawImage(sh.page(variant, flip), sh.srcX(fi, flip), fy, sh.w, sh.h, 0, 0, sh.w, sh.h);
    const level = clamp(Math.floor((1 - alpha) * 16), 0, 16);
    if (level > 0) {
      sg.globalCompositeOperation = "destination-out";
      sg.fillStyle = this.dither[level] ?? "#000";
      sg.fillRect(0, 0, sh.w, sh.h);
    }
    sg.globalCompositeOperation = "source-atop";
    sg.globalAlpha = clamp((1 - alpha) * 0.9, 0, 0.8);
    sg.fillStyle = "#f4f0ff";
    sg.fillRect(0, 0, sh.w, sh.h);
    sg.globalAlpha = 1;
    sg.globalCompositeOperation = "source-over";
    const rise = Math.round((1 - alpha) * 6);
    const bx = Math.round(x) - ox - (flip ? sh.w - sh.ax : sh.ax);
    const by = Math.round(y) - oy - sh.ay - rise;
    g.drawImage(this.scratch, 0, 0, sh.w, sh.h, bx, by, sh.w, sh.h);
  }

  private drawGhosts(g: Ctx, ox: number, oy: number): void {
    for (const gh of this.ghosts) {
      const a = clamp(1 - gh.t / 0.45, 0, 1);
      this.dissolve(g, gh.sheet, gh.frame, gh.flip, gh.elite ? "elite" : "normal", gh.x, gh.y, ox, oy, a);
    }
  }

  private heroFrame(h: WorldView["hero"], sh: SheetRT): { fi: number; flip: boolean } | null {
    let names = HERO_ANIMS[h.anim] ?? HERO_ANIMS.stand;
    if (h.anim === "attack") names = [`attack${clamp(h.combo | 0, 1, 4)}`, ...names];
    if (h.anim === "stand" && h.animTime > 1) names = ["idle", ...names];
    const an = resolveAnim(sh, names, h.facing);
    if (!an) return null;
    return { fi: frameAt(an, h.animTime), flip: an.flip };
  }

  private drawHero(g: Ctx, h: WorldView["hero"], ox: number, oy: number): void {
    const sh = this.atlas.sheet("hero");
    if (!sh) return;
    const fr = this.heroFrame(h, sh);
    if (!fr) return;
    const x = this.heroX, y = this.heroY;
    if (h.anim === "dodge") {
      if (!this.dodgeTrail.length || this.t - this.dodgeTrail[this.dodgeTrail.length - 1].t > 0.035)
        this.dodgeTrail.push({ x, y, sheet: sh, frame: fr.fi, flip: fr.flip, t: this.t });
    }
    for (const d of this.dodgeTrail) {
      const age = this.t - d.t;
      if (age <= 0.001) continue;
      g.globalAlpha = clamp(0.5 - age * 3, 0, 0.5);
      this.blitFrame(g, d.sheet, d.frame, d.flip, d.x, d.y, ox, oy, "white");
    }
    g.globalAlpha = 1;
    const rm = !!this.opts.reducedMotion;
    const cut = h.anim === "dead" ? 0 : this.wadeCut(x, y);
    if (cut) this.ripple(g, x, y, 18, "back", ox, oy);
    // the white hit flash wins over the invulnerability blink
    const inv = h.invulnerable && h.flash <= 0 && h.anim !== "dodge" && h.anim !== "dead" && h.anim !== "raise";
    // invulnerability blinks (steady half alpha with reduced motion)
    if (inv && (rm || Math.floor(this.t * 20) % 2 === 1)) g.globalAlpha = rm ? 0.6 : 0.35;
    if (h.flash > 0 && rm) {
      this.blitFrame(g, sh, fr.fi, fr.flip, x, y, ox, oy, "normal", cut);
      g.globalAlpha *= 0.5;
      this.blitFrame(g, sh, fr.fi, fr.flip, x, y, ox, oy, "white", cut);
    } else this.blitFrame(g, sh, fr.fi, fr.flip, x, y, ox, oy, h.flash > 0 ? "white" : "normal", cut);
    g.globalAlpha = 1;
    // a full charge pulses white (a steady faint tint with reduced motion)
    if (h.charge >= 1 && (rm || Math.floor(this.t * 10) % 2 === 0)) {
      g.globalAlpha = rm ? 0.25 : 0.45;
      this.blitFrame(g, sh, fr.fi, fr.flip, x, y, ox, oy, "white", cut);
      g.globalAlpha = 1;
    }
    if (cut) this.ripple(g, x, y, 18, "front", ox, oy);
  }

  private drawChest(g: Ctx, c: ChestRT, ox: number, oy: number, world: WorldView): void {
    const sh = this.sheetOf("prop.chest", "obj.chest");
    if (!sh) return;
    const open = world.openChests.has(c.id);
    const a = open ? resolveAnim(sh, ["open", "v1"], "down") : resolveAnim(sh, ["v0", "closed"], "down");
    if (!a) return;
    const fi = open ? frameAt(a, this.t - c.openT) : frameAt(a, this.t);
    this.blitFrame(g, sh, fi, false, c.x, c.y, ox, oy, "normal");
  }

  private drawGateTile(g: Ctx, gt: GateRT, cell: number, ox: number, oy: number): void {
    const c = cell % 100, r = Math.floor(cell / 100);
    const x = gt.x + c * TILE + TILE / 2, y = gt.y + (r + 1) * TILE - 2;
    const opening = gt.openT >= 0 ? clamp((this.t - gt.openT) / 0.8, 0, 1) : 0;
    if (gt.kind === "flame") {
      // a continuous wall of fire: two overlapping flames per tile, out of phase, one mirrored
      const sh = this.atlas.sheet("fx.flame");
      if (!sh) return;
      const a = resolveAnim(sh, ["burn", "loop", "v0"], "down");
      if (!a) return;
      if (opening > 0) g.globalAlpha = 1 - opening;
      for (let k = 0; k < 2; k++) {
        const fi = frameAt(a, this.t + hash1(c * 2 + k + r * 7, 5) * 3);
        const flip = k === 1;
        const shrink = Math.round(opening * sh.h * (0.7 + 0.2 * k));
        const fy = sh.fy(fi);
        const bx = Math.round(x + (k ? 8 : -8)) - ox - (flip ? sh.w - sh.ax : sh.ax);
        const by = Math.round(y - (k ? 1 : 0)) - oy - sh.ay + shrink;
        if (sh.h - shrink > 0) g.drawImage(sh.page("normal", flip), sh.srcX(fi, flip), fy + shrink, sh.w, sh.h - shrink, bx, by, sh.w, sh.h - shrink);
      }
      g.globalAlpha = 1;
      return;
    }
    const sh = gt.kind === "iron" ? this.sheetOf("gate.iron", "obj.gate.iron") : this.sheetOf("gate.thorns", "obj.gate.thorns");
    if (!sh) return;
    const a = resolveAnim(sh, ["v0"], "down");
    if (!a) return;
    // thorns grow as a tangle: alternate tiles mirrored and nudged so no grid shows; iron is regular
    const thorns = gt.kind === "thorns";
    const flip = thorns && ((c + r) & 1) === 1;
    const jx = thorns ? Math.round((hash1(c * 13 + r * 7, 21) - 0.5) * 8) : 0;
    const jy = thorns ? Math.round((hash1(c * 5 + r * 11, 22) - 0.5) * 4) : 0;
    const fi = frameAt(a, this.t + c * 0.37 + r * 0.21);
    const sink = Math.round(opening * sh.h);
    const fy = sh.fy(fi);
    const bx = Math.round(x + jx) - ox - (flip ? sh.w - sh.ax : sh.ax), by = Math.round(y + jy) - oy - sh.ay + sink;
    if (sh.h - sink > 0) g.drawImage(sh.page("normal", flip), sh.srcX(fi, flip), fy, sh.w, sh.h - sink, bx, by, sh.w, sh.h - sink);
  }

  private drawPickup(g: Ctx, p: PickupView, ox: number, oy: number): void {
    const bob = p.z < 0.5 ? Math.round(Math.sin(p.age * 4 + p.id) * 1.5 + 1.5) : 0;
    const y = p.y - p.z - bob;
    if (p.kind === "coin") {
      const sh = this.atlas.sheet("fx.coin");
      if (!sh) return;
      const a = resolveAnim(sh, ["spin", "v0"], "down");
      if (!a) return;
      this.blitFrame(g, sh, frameAt(a, p.age + hash1(p.id, 2)), false, p.x, y, ox, oy, "normal");
      return;
    }
    const icon = p.item ? this.atlas.icon(`icon.${p.item}`) : null;
    if (icon) {
      g.drawImage(icon, Math.round(p.x - icon.naturalWidth / 2) - ox, Math.round(y - icon.naturalHeight) - oy);
    } else {
      const sh = this.atlas.sheet("fx.sparkle");
      if (sh) {
        const a = resolveAnim(sh, ["twinkle"], "down");
        if (a) this.blitFrame(g, sh, frameAt(a, p.age), false, p.x, y, ox, oy, "normal");
      }
    }
  }

  private drawProjectile(g: Ctx, p: ProjectileView, ox: number, oy: number): void {
    const cfg = PROJ_KEYS[p.kind];
    if (!cfg) return;
    const gy = projGround(p);
    if (p.kind === "frostRing") {
      const r = Math.max(4, Math.round(p.r));
      const ring = ringSprite(r, "#e4faff", 2);
      const inner = ringSprite(Math.max(2, r - 3), "#5ab8e8", 1);
      const outer = ringSprite(r + 2, "#2a6aa8", 1);
      g.globalAlpha = 0.85;
      g.drawImage(outer, Math.round(p.x - outer.width / 2) - ox, Math.round(gy - outer.height / 2) - oy);
      g.drawImage(inner, Math.round(p.x - inner.width / 2) - ox, Math.round(gy - inner.height / 2) - oy);
      g.globalAlpha = 1;
      g.drawImage(ring, Math.round(p.x - ring.width / 2) - ox, Math.round(gy - ring.height / 2) - oy);
      const sh = this.atlas.sheets.get(cfg.key);
      const a = sh ? resolveAnim(sh, cfg.anim, "down") : null;
      if (sh && a) {
        const n = clamp(Math.round(r / 5), 6, 16);
        for (let i = 0; i < n; i++) {
          const ang = (i / n) * Math.PI * 2 + p.age * 1.5;
          const fx = p.x + Math.cos(ang) * r, fy = gy + Math.sin(ang) * r / 1.18;
          this.blitFrame(g, sh, frameAt(a, p.age + i * 0.13), false, fx, fy + sh.ay - sh.h / 2 - 4, ox, oy, "normal");
        }
      }
      return;
    }
    if (p.kind === "spore") {
      this.drawSporeCloud(g, p, ox, oy);
      return;
    }
    const sh = this.atlas.sheets.get(cfg.key);
    if (!sh) return;
    if (p.kind === "thornLine") {
      const a = resolveAnim(sh, ["rise"], "down");
      if (!a) return;
      this.blitFrame(g, sh, frameAt(a, p.age), false, p.x, gy, ox, oy, "normal");
      return;
    }
    const a = resolveAnim(sh, cfg.anim, "down");
    if (!a) return;
    let fi: number;
    let flip = a.flip;
    if (a.octants && a.frames.length >= 8) {
      const o = ((Math.round(p.angle / (Math.PI / 4)) % 8) + 8) % 8;
      fi = a.frames[o];
      flip = false;
    } else fi = frameAt(a, p.age);
    // sprites are centred on their anchor; float them above the ground point
    this.blitFrame(g, sh, fi, flip, p.x, gy - cfg.z, ox, oy, "normal");
  }

  /** A spore cloud filling its hit radius: a puffy body sized to r, with the atlas's puffs drifting over it. */
  private drawSporeCloud(g: Ctx, p: ProjectileView, ox: number, oy: number): void {
    const gy = projGround(p);
    const grow = clamp(p.age / 0.25, 0.35, 1);
    const r = Math.max(6, p.r * grow);
    const body = sporeHaze(r, Math.floor((p.age + hash1(p.id, 3)) * 5));
    const cy = body.height - Math.round((Math.max(6, Math.round(r / 2) * 2)) * 0.7) - 4;
    g.globalAlpha = 0.78;
    g.drawImage(body, Math.round(p.x - body.width / 2) - ox, Math.round(gy - cy) - oy);
    g.globalAlpha = 1;
    const sh = this.atlas.sheets.get("fx.spore");
    const a = sh ? resolveAnim(sh, ["cloud"], "down") : null;
    if (!sh || !a) return;
    const n = clamp(Math.round(r / 12), 2, 5);
    for (let i = 0; i < n; i++) {
      const ang = (i / n) * Math.PI * 2 + hash1(p.id, i) * 2 + p.age * 0.5;
      const d = r * (0.2 + 0.4 * hash1(p.id, i + 20));
      const px = p.x + Math.cos(ang) * d, py = gy + Math.sin(ang) * d * 0.6 - r * 0.45 - p.age * 6;
      this.blitFrame(g, sh, frameAt(a, p.age + i * 0.21), (i & 1) === 1, px, py + sh.ay - sh.h / 2, ox, oy, "normal");
    }
  }

  /** Ground decals under everything that stands: thorn-line telegraph cracks. */
  private drawGroundDecals(g: Ctx, ox: number, oy: number, world: WorldView): void {
    for (const p of world.projectiles) {
      if (p.kind !== "thornLine") continue;
      const gy = projGround(p);
      // the warning shows for the last 0.45 s before the spike, the scar while it stands
      const k = p.age < 0 ? clamp(1 + p.age / 0.45, 0, 1) : 1;
      if (k <= 0) continue;
      const stage = k < 0.34 ? 0 : k < 0.67 ? 1 : 2;
      const spr = crackSprite(p.id % 4, stage);
      g.drawImage(spr, Math.round(p.x - spr.width / 2) - ox, Math.round(gy - spr.height / 2) - oy);
    }
  }

  /**
   * The telegraph's hot glow, drawn after the light map so a warning reads even in a dark arena:
   * it swells as the spike's moment approaches and pulses in the last 0.16 s.
   */
  private drawTelegraphGlow(g: Ctx, ox: number, oy: number, world: WorldView): void {
    let any = false;
    for (const p of world.projectiles) {
      if (p.kind !== "thornLine" || p.age >= 0 || p.age < -0.45) continue;
      const k = clamp(1 + p.age / 0.45, 0, 1);
      if (k < 0.34) continue;
      if (!any) {
        g.globalCompositeOperation = "lighter";
        any = true;
      }
      const late = p.age > -0.16;
      const pulse = !this.opts.reducedMotion && Math.floor(this.t * 20) % 2 ? 1 : 0.6;
      g.globalAlpha = late ? 0.85 * pulse : 0.12 + 0.3 * (k - 0.34) / 0.66;
      const glow = crackSprite(p.id % 4, 3);
      g.drawImage(glow, Math.round(p.x - glow.width / 2) - ox, Math.round(projGround(p) - glow.height / 2) - oy);
    }
    if (any) {
      g.globalAlpha = 1;
      g.globalCompositeOperation = "source-over";
    }
  }

  // ─── ambient effects (particles that come from state, not events) ─────────────────────────
  private ambientFx(world: WorldView, dt: number): void {
    if (dt <= 0) return;
    const h = world.hero;
    // charge sparks
    if (h.charge > 0.05) {
      const rate = 20 + h.charge * 60;
      if (Math.random() < rate * dt) {
        const ang = Math.random() * Math.PI * 2;
        const r = 14 + Math.random() * 6;
        this.fx.parts.spawn({
          x: this.heroX + Math.cos(ang) * r, y: this.heroY - 18 + Math.sin(ang) * r * 0.7, vx: -Math.cos(ang) * 40,
          vy: -Math.sin(ang) * 30, life: 0.25, color: h.charge >= 1 ? "#ffffff" : "#bfe8ff", color2: "#6ab0ff", flags: 1 | 4,
        });
      }
    }
    // projectile trails
    for (const p of world.projectiles) {
      if (p.kind === "emberBolt" && Math.random() < 40 * dt) {
        this.fx.burst(p.x, projGround(p), 1, { colors: ["#fff2b0", "#ffb040", "#e05020"], speed: [4, 14], up: [10, 30], life: [0.2, 0.4],
          z: PROJ_KEYS.emberBolt.z, emissive: true, grav: 40 });
      } else if (p.kind === "spore" && Math.random() < 16 * dt) {
        const ang = Math.random() * Math.PI * 2, d = Math.random() * p.r;
        this.fx.burst(p.x + Math.cos(ang) * d, projGround(p) + Math.sin(ang) * d * 0.7, 1, { colors: ["#e8f8b0", "#b0d060"], speed: [2, 8], up: [8, 20], life: [0.6, 1], z: 6, grav: -6 });
      } else if (p.kind === "thornLine") {
        const gy = projGround(p);
        if (p.age < 0) {
          if (p.age > -0.45 && Math.random() < 14 * dt)
            this.fx.burst(p.x + (Math.random() - 0.5) * 12, gy, 1, { colors: ["#8a6a4a", "#5a4028"], speed: [4, 12], up: [20, 40], life: [0.2, 0.35], grav: 220 });
        } else if (!this.projTrail.has(p.id)) {
          this.projTrail.set(p.id, { x: p.x, y: gy });
          this.fx.burst(p.x, gy, 6, { colors: ["#7a5a3a", "#5a4028", "#3a2818"], speed: [10, 40], up: [50, 100], life: [0.3, 0.55], grav: 300, size: [1, 2] });
        }
      } else if (p.kind === "frostRing" && Math.random() < 30 * dt) {
        const ang = Math.random() * Math.PI * 2;
        this.fx.parts.spawn({ x: p.x + Math.cos(ang) * p.r, y: projGround(p) + Math.sin(ang) * p.r / 1.18, z: 4, vz: 16, life: 0.4,
          color: "#ffffff", color2: "#9fe0ff", flags: 1 | 4 });
      }
    }
    // coins glint now and then
    for (const p of world.pickups) {
      if (p.kind === "coin" && Math.random() < 0.9 * dt) this.fx.play("fx.sparkle", ["twinkle"], p.x + (Math.random() - 0.5) * 8, p.y - p.z - 6 - Math.random() * 6);
      if (p.kind === "item" && Math.random() < 1.5 * dt) this.fx.play("fx.sparkle", ["twinkle"], p.x + (Math.random() - 0.5) * 12, p.y - p.z - 8 - Math.random() * 10);
    }
    // closed chests glint
    for (const c of this.chests) {
      if (!world.openChests.has(c.id) && Math.random() < 0.35 * dt) this.fx.play("fx.sparkle", ["twinkle"], c.x + (Math.random() - 0.5) * 18, c.y - 12 - Math.random() * 8);
    }
    // embers above fires
    for (const gt of this.gates) {
      if (gt.kind !== "flame" || world.openGates.has(gt.id)) continue;
      if (Math.random() < (gt.w / TILE) * (gt.h / TILE) * 3 * dt)
        this.fx.burst(gt.x + Math.random() * gt.w, gt.y + Math.random() * gt.h, 1, { colors: ["#fff0a0", "#ffa030", "#ff5020"], speed: [2, 8],
          up: [30, 60], life: [0.5, 0.9], z: 20, grav: -10, emissive: true, flicker: true });
    }
  }

  // ─── sim events → visuals ──────────────────────────────────────────────────────────────────
  /** The actor a hit/miss event refers to: the sim reports (feet x, feet y − z − ~36). */
  private actorAt(x: number, y: number, world: WorldView): ActorView | null {
    let best: ActorView | null = null, bd = 28 * 28;
    for (const a of world.actors) {
      const dx = a.x - x, dy = a.y - a.z - 36 - y;
      const d = dx * dx + dy * dy;
      if (d < bd) { bd = d; best = a; }
    }
    return best;
  }

  /** Height of a sheet's visible top above its anchor (art px). */
  private spriteTop(sheetKey: string): number {
    const sh = this.atlas.sheets.get(sheetKey);
    return sh ? sh.ay - sh.topPad : 40;
  }

  /** Where a hit/miss lands: feet, body centre and the point above the head for text. */
  private hitSpot(e: { x: number; y: number; target: "monster" | "hero" }, world: WorldView) {
    if (e.target === "hero") {
      const top = Math.min(52, this.spriteTop("hero"));
      return { x: this.heroX, feet: this.heroY, body: this.heroY - Math.round(top * 0.45), head: this.heroY - top, sprite: "hero" };
    }
    const a = this.actorAt(e.x, e.y, world);
    if (!a) return { x: e.x, feet: e.y + 36, body: e.y + 18, head: e.y, sprite: "" };
    const top = this.spriteTop(a.sprite);
    const y = a.y - a.z;
    return { x: a.x, feet: a.y, body: y - Math.round(top * 0.45), head: y - top, sprite: a.sprite };
  }

  private handle(e: SimEvent, world: WorldView): void {
    const fx = this.fx;
    const rm = !!this.opts.reducedMotion;
    switch (e.t) {
      case "swing": {
        const v = DIR_VEC[e.facing] ?? [0, 1];
        if (e.spin) {
          fx.play("fx.spin", ["spin", "sweep"], 0, -18, { follow: true });
          fx.special({ kind: "ring", x: 0, y: -14, t: 0, dur: 0.3, r0: 10, r1: 34, color: "#dff6ff", follow: true, thick: 1 });
          break;
        }
        const big = e.combo >= 3;
        const key = big && this.atlas.has("fx.slashBig") ? "fx.slashBig" : "fx.slash";
        const alt = e.combo % 2 === 0;
        const reach = big ? 14 : 12;
        fx.play(key, alt ? ["sweepB", "sweep"] : ["sweep"], v[0] * reach, -18 + v[1] * (reach - 2), { dir: e.facing, follow: true });
        if (e.combo >= 4) fx.special({ kind: "ring", x: v[0] * 16, y: -16 + v[1] * 12, t: 0, dur: 0.25, r0: 6, r1: 22, color: "#ffffff", follow: true, thick: 1 });
        break;
      }
      case "hit": {
        const sp = this.hitSpot(e, world);
        const gore = GORE[sp.sprite] ?? GORE_DEFAULT;
        fx.play("fx.hit", e.crit ? ["crit", "burst"] : ["burst"], sp.x, sp.body);
        const n = e.crit ? 14 : 8;
        const away = e.target === "hero" ? Math.random() * Math.PI * 2 : Math.atan2(sp.feet - this.heroY, sp.x - this.heroX);
        fx.burst(sp.x, sp.feet, n, { colors: gore, speed: [30, 90], up: [40, 110], life: [0.35, 0.7], grav: 320, z: sp.feet - sp.body,
          size: [1, 2], bounce: false, angle: away, arc: 2.2, drag: 2 });
        if (e.kind === "magic") fx.burst(sp.x, sp.body, 8, { colors: ["#ffffff", "#ffe0a0"], speed: [30, 70], life: [0.15, 0.3], emissive: true, drag: 5 });
        if (e.crit) {
          fx.special({ kind: "ring", x: sp.x, y: sp.body, t: 0, dur: 0.22, r0: 4, r1: 18, color: "#fff0a0", follow: false, thick: 1 });
          fx.burst(sp.x, sp.body, 10, { colors: ["#ffffff", "#ffe070"], speed: [60, 120], life: [0.15, 0.3], emissive: true, drag: 6, size: [1, 2] });
        }
        const txt = String(Math.max(0, Math.round(e.amount)));
        const ty = sp.head - 2;
        if (e.target === "hero") this.numbers.add(sp.x, ty, `-${txt}`, "hurt");
        else if (e.crit) this.numbers.add(sp.x, ty, txt, "crit", "CRITICAL");
        else this.numbers.add(sp.x, ty, txt, "damage");
        break;
      }
      case "miss": {
        const sp = this.hitSpot(e, world);
        this.numbers.add(sp.x, sp.head - 2, "MISS", "miss");
        fx.burst(sp.x, sp.body, 4, { colors: ["#e8f0ff", "#a8c0e0"], speed: [30, 60], life: [0.12, 0.22], emissive: true, drag: 6 });
        break;
      }
      case "die": {
        const big = e.big;
        fx.play("fx.poof", ["poof"], e.x, e.y + 2, { emissive: false });
        if (big) {
          fx.play("fx.poof", ["poof"], e.x - 12, e.y - 4, { emissive: false });
          fx.play("fx.poof", ["poof"], e.x + 12, e.y - 2, { emissive: false });
          fx.special({ kind: "ring", x: e.x, y: e.y - 6, t: 0, dur: 0.5, r0: 8, r1: 56, color: "#fff4d0", follow: false, thick: 2 });
        }
        const gore = GORE[e.sprite] ?? GORE_DEFAULT;
        fx.burst(e.x, e.y, big ? 30 : 12, { colors: gore, speed: [20, 70], up: [60, 140], life: [0.4, 0.8], grav: 320, z: 10, size: [1, 2] });
        // a few coin glints spill out (the real coins are sim pickups)
        fx.frames("fx.coin", e.x, e.y, big ? 6 : 3, ["spin", "v0"], { speed: [20, 50], up: [80, 140], life: [0.45, 0.7], grav: 380, z: 8, emissive: true });
        fx.burst(e.x, e.y - 10, big ? 16 : 8, { colors: ["#ffffff", "#fff0b0"], speed: [30, 80], life: [0.2, 0.4], emissive: true, drag: 4 });
        break;
      }
      case "cut": {
        this.cutFx(e.x, e.y, e.prop);
        break;
      }
      case "pickup": {
        fx.play("fx.sparkle", ["twinkle"], e.x, e.y - 8);
        fx.burst(e.x, e.y - 8, 6, { colors: ["#ffffff", "#fff0a0", "#ffd040"], speed: [20, 50], life: [0.2, 0.35], emissive: true, drag: 4 });
        if (e.kind === "coin" && e.amount > 0) this.numbers.addGold(this.heroX, this.heroY - Math.min(52, this.spriteTop("hero")) - 2, e.amount);
        break;
      }
      case "chest": {
        fx.special({ kind: "rays", x: e.x, y: e.y - 14, t: 0, dur: 1.2, color: "#ffe9a0" });
        fx.burst(e.x, e.y - 12, 18, { colors: ["#ffffff", "#fff0a0", "#ffd040"], speed: [20, 60], up: [20, 60], life: [0.5, 1], emissive: true, grav: 30, drag: 2 });
        this.raiseItem = e.item ? `icon.${e.item}` : "icon.gold";
        this.raiseT = this.t;
        break;
      }
      case "cast": {
        const col = e.spell === "emberBolt" ? ["#fff2b0", "#ffa040", "#ff5020"] : e.spell === "frostRing" ? ["#ffffff", "#bff0ff", "#60c0f0"] : ["#f0ffd0", "#a0e060", "#50a030"];
        fx.burst(e.x, e.y - 20, 14, { colors: col, speed: [30, 80], life: [0.2, 0.45], emissive: true, drag: 3 });
        fx.special({ kind: "ring", x: e.x, y: e.y - 18, t: 0, dur: 0.3, r0: 3, r1: 16, color: col[1], follow: false, thick: 1 });
        break;
      }
      case "impact": {
        this.impactFx(e.x, e.y, e.kind);
        break;
      }
      case "levelUp": {
        fx.special({ kind: "column", x: 0, y: 0, t: 0, dur: 1.4, color: "#ffe070", w: 26, h: 88, follow: true });
        fx.special({ kind: "ring", x: 0, y: -6, t: 0, dur: 0.7, r0: 6, r1: 48, color: "#fff4c0", follow: true, thick: 2 });
        fx.play("fx.levelUp", ["burst"], 0, -20, { follow: true });
        for (let i = 0; i < 24; i++) {
          const ang = (i / 24) * Math.PI * 2;
          fx.parts.spawn({ x: this.heroX + Math.cos(ang) * 10, y: this.heroY + Math.sin(ang) * 6, vx: Math.cos(ang) * 30, vy: Math.sin(ang) * 18,
            vz: 60 + Math.random() * 60, z: 2, life: 0.9 + Math.random() * 0.5, grav: 10, color: "#ffffff", color2: "#ffd84a", flags: 1 | 4 | 16 });
        }
        break;
      }
      case "unlock": {
        fx.special({ kind: "ring", x: 0, y: -18, t: 0, dur: 0.6, r0: 4, r1: 30, color: "#c8f0ff", follow: true, thick: 1 });
        fx.burst(this.heroX, this.heroY - 20, 16, { colors: ["#ffffff", "#c8f0ff", "#80c8ff"], speed: [30, 70], life: [0.4, 0.7], emissive: true, drag: 2, flicker: true });
        break;
      }
      case "heal": {
        fx.special({ kind: "column", x: e.x, y: e.y, t: 0, dur: 1.0, color: "#c8ff90", w: 20, h: 64, follow: Math.abs(e.x - this.heroX) + Math.abs(e.y - this.heroY) < 24 });
        fx.frames("fx.heal", e.x, e.y, 8, ["rise"], { speed: [2, 10], up: [30, 70], life: [0.6, 1], grav: -10, z: 4, emissive: true, spread: 10, drag: 1 });
        const hy = e.y - Math.min(52, this.spriteTop("hero")) - 2;
        if (e.hp > 0) this.numbers.add(e.x, hy, `+${Math.round(e.hp)}`, "heal");
        if (e.mp > 0) this.numbers.add(e.x, hy, `+${Math.round(e.mp)}`, "mana");
        break;
      }
      case "dodge": {
        fx.play("fx.dust", ["puff"], e.x, e.y, { emissive: false });
        fx.burst(e.x, e.y, 6, { colors: ["#d8c8a8", "#b0a080"], speed: [20, 50], up: [10, 30], life: [0.25, 0.4], grav: 60, size: [1, 2] });
        break;
      }
      case "step": {
        const x = this.heroX, y = this.heroY;
        if (e.surface === "water") {
          fx.special({ kind: "ring", x, y: y - 1, t: 0, dur: 0.4, r0: 3, r1: 9, color: "#d8f4ff", follow: false, thick: 1 });
          fx.burst(x, y, 3, { colors: ["#ffffff", "#bfe8f8"], speed: [10, 30], up: [30, 60], life: [0.2, 0.35], grav: 300 });
        } else if (e.surface === "dirt" || e.surface === "cave") {
          fx.burst(x, y, 2, { colors: e.surface === "dirt" ? ["#c8a878", "#a08058"] : ["#8a8078", "#6a6058"], speed: [6, 16], up: [6, 16], life: [0.25, 0.4], grav: 40 });
        }
        break;
      }
      case "shake": {
        if (rm) break;
        const sk = this.shake;
        sk.amp = Math.max(sk.t > 0 ? sk.amp : 0, clamp(e.strength, 0, 6));
        sk.dur = Math.max(sk.t, e.ms / 1000);
        sk.t = sk.dur;
        break;
      }
      case "hitstop": {
        this.freeze = Math.max(this.freeze, e.ms / 1000);
        break;
      }
      case "map": {
        this.fx.clear();
        this.numbers.clear();
        break;
      }
      case "gate": {
        const gt = this.gates.find((g) => g.id === e.id);
        if (gt && e.open && gt.openT < 0) gt.openT = this.t;
        break;
      }
      default:
        break;
    }
  }

  private cutFx(x: number, y: number, prop: PropKind): void {
    const fx = this.fx;
    if (prop === "pot" || prop === "crate" || prop === "barrel") {
      const cols = prop === "pot" ? ["#d88a5a", "#a85a34", "#6a3420"] : ["#b08858", "#8a6038", "#5a3c20"];
      fx.burst(x, y, 14, { colors: cols, speed: [30, 80], up: [60, 130], life: [0.5, 0.9], grav: 380, z: 8, size: [1, 3], bounce: true });
      fx.play("fx.dust", ["puff"], x, y, { emissive: false });
      return;
    }
    const leaves = prop === "reeds" ? ["straw", "p"] : prop === "bush" ? ["leaf", "p"] : ["blade", "p"];
    const n = prop === "bush" ? 12 : 8;
    const ok = fx.frames("fx.leaves", x, y - 8, n, leaves, { speed: [20, 60], up: [50, 110], life: [0.5, 0.9], grav: 200, z: 6, spread: 6, drag: 2.5 });
    const green = prop === "reeds" ? ["#d8c080", "#a89050", "#786030"] : ["#9ad860", "#5aa040", "#2e6a2a"];
    fx.burst(x, y, ok ? 8 : 16, { colors: green, speed: [20, 70], up: [40, 100], life: [0.3, 0.7], grav: 260, z: 6, size: [1, 2] });
    fx.play("fx.leaves", ["burst"], x, y, { emissive: false });
  }

  private impactFx(x: number, y: number, kind: ProjectileView["kind"]): void {
    const fx = this.fx;
    switch (kind) {
      case "emberBolt":
        fx.play("fx.ember", ["burst"], x, y - 10);
        fx.burst(x, y - 10, 18, { colors: ["#fff4c0", "#ffb040", "#ff5a20", "#a02810"], speed: [30, 100], up: [20, 80], life: [0.3, 0.6], grav: 120, z: 10, emissive: true, drag: 2 });
        fx.special({ kind: "ring", x, y: y - 8, t: 0, dur: 0.25, r0: 4, r1: 18, color: "#ffc060", follow: false, thick: 1 });
        break;
      case "frostRing":
        fx.play("fx.frost", ["burst"], x, y - 8);
        fx.burst(x, y - 8, 14, { colors: ["#ffffff", "#c8f4ff", "#70c8f0"], speed: [30, 90], up: [30, 80], life: [0.3, 0.6], grav: 200, z: 8, emissive: true });
        break;
      case "thorn":
        fx.play("fx.thorn", ["burst"], x, y - 10);
        fx.burst(x, y - 10, 8, { colors: ["#a0c060", "#6a8a30", "#3a5020"], speed: [30, 70], up: [30, 60], life: [0.3, 0.5], grav: 260, z: 10 });
        break;
      case "web":
        fx.play("fx.web", ["splat", "burst"], x, y - 4, { emissive: false });
        fx.burst(x, y - 6, 8, { colors: ["#f0f0e8", "#c8c8c0"], speed: [20, 50], life: [0.3, 0.5], z: 6, grav: 100 });
        break;
      case "spore":
        fx.play("fx.spore", ["burst"], x, y - 6, { emissive: false });
        fx.burst(x, y - 6, 12, { colors: ["#e0f0a0", "#b0d060", "#809040"], speed: [10, 40], up: [10, 30], life: [0.6, 1.1], z: 6, grav: -8, drag: 2 });
        break;
      case "thornLine":
        fx.play("fx.thornLine", ["rise"], x, y, { emissive: false, hold: 0.2 });
        fx.burst(x, y, 10, { colors: ["#7a5a3a", "#5a4028", "#3a2818"], speed: [20, 60], up: [60, 120], life: [0.4, 0.7], grav: 320, size: [1, 2] });
        break;
    }
  }

  private gateOpenFx(gt: GateRT): void {
    const cols = Math.max(1, Math.round(gt.w / TILE)), rows = Math.max(1, Math.round(gt.h / TILE));
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++) {
        const x = gt.x + c * TILE + 16, y = gt.y + (r + 1) * TILE - 4;
        if (gt.kind === "flame") {
          this.fx.play("fx.poof", ["poof"], x, y, { emissive: false, alpha: 0.8 });
          this.fx.burst(x, y - 12, 8, { colors: ["#fff0a0", "#ffa030", "#ff5020"], speed: [20, 50], up: [40, 90], life: [0.4, 0.8], z: 10, grav: 60, emissive: true });
        } else if (gt.kind === "thorns") {
          this.fx.frames("fx.leaves", x, y - 10, 5, ["leaf", "p"], { speed: [20, 50], up: [40, 90], life: [0.5, 0.9], grav: 200, z: 8 });
        } else {
          this.fx.play("fx.dust", ["puff"], x, y, { emissive: false });
        }
      }
  }

  // ─── passes ────────────────────────────────────────────────────────────────────────────────
  private drawWater(g: Ctx, ox: number, oy: number): void {
    const gc = this.ground!;
    if (!gc.waterTiles.length) return;
    const s = this.screen;
    const tx0 = Math.floor(ox / TILE) - 1, tx1 = Math.floor((ox + s.bw) / TILE) + 1;
    const ty0 = Math.floor(oy / TILE) - 1, ty1 = Math.floor((oy + s.bh) / TILE) + 1;
    const t = this.opts.reducedMotion ? this.t * 0.4 : this.t;
    g.fillStyle = "#d4f0fa";
    for (let ty = Math.max(0, ty0); ty <= Math.min(gc.H - 1, ty1); ty++)
      for (let tx = Math.max(0, tx0); tx <= Math.min(gc.W - 1, tx1); tx++) {
        const m = gc.groundAt(tx, ty);
        if (m !== 87 && m !== 119) continue;
        const n1 = gc.groundAt(tx, ty - 1), n2 = gc.groundAt(tx, ty + 1), n3 = gc.groundAt(tx - 1, ty), n4 = gc.groundAt(tx + 1, ty);
        const inner = (n1 === 87 || n1 === 119) && (n2 === 87 || n2 === 119) && (n3 === 87 || n3 === 119) && (n4 === 87 || n4 === 119);
        if (!inner) continue;
        for (let k = 0; k < 2; k++) {
          const ph = hash2(tx, ty, 50 + k);
          const cyc = (t * 0.45 + ph) % 1;
          if (cyc > 0.42) continue;
          const len = cyc < 0.1 || cyc > 0.32 ? 2 : 4;
          const px = tx * TILE + 4 + Math.floor(hash2(tx, ty, 60 + k + Math.floor(t * 0.45 + ph)) * 22) + Math.floor(cyc * 6);
          const py = ty * TILE + 4 + Math.floor(hash2(tx, ty, 70 + k + Math.floor(t * 0.45 + ph)) * 24);
          g.globalAlpha = m === 87 ? 0.55 : 0.8;
          g.fillRect(px - ox, py - oy, len, 1);
        }
      }
    g.globalAlpha = 1;
  }

  /** Drifting ground fog, only over the part of each fog rect that is on screen; lit like the scene. */
  private drawFog(g: Ctx, ox: number, oy: number): void {
    if (!this.fogs.length) return;
    const s = this.screen;
    const tex = fogTexture();
    const speed = this.opts.reducedMotion ? 0.25 : 1;
    for (const f of this.fogs) {
      const x0 = Math.max(f.x, ox), y0 = Math.max(f.y, oy);
      const x1 = Math.min(f.x + f.w, ox + s.bw), y1 = Math.min(f.y + f.h, oy + s.bh);
      if (x1 <= x0 || y1 <= y0) continue;
      const w = Math.ceil(x1 - x0), h = Math.ceil(y1 - y0);
      if (this.fogScratch.width < w || this.fogScratch.height < h) {
        this.fogScratch.width = Math.max(this.fogScratch.width, w);
        this.fogScratch.height = Math.max(this.fogScratch.height, h);
        this.fogCtx = ctx2d(this.fogScratch);
        this.fogPattern = null;
      }
      const sg = this.fogCtx;
      const pat = this.fogPattern ?? (this.fogPattern = sg.createPattern(tex, "repeat"));
      if (!pat) continue;
      sg.globalCompositeOperation = "source-over";
      sg.globalAlpha = 1;
      sg.clearRect(0, 0, w, h);
      sg.fillStyle = pat;
      for (let layer = 0; layer < 2; layer++) {
        // world-anchored wisps drifting slowly; offsets in whole art pixels
        const dx = Math.round(this.t * (layer ? -4 : 6) * speed + f.seed * 37 + layer * 101);
        const dy = Math.round(this.t * (layer ? 1.5 : -1) * speed + f.seed * 11 + layer * 57);
        const tx = ((((x0 - dx) % FOG_TILE) + FOG_TILE) % FOG_TILE), ty = ((((y0 - dy) % FOG_TILE) + FOG_TILE) % FOG_TILE);
        this.fogMatrix.e = -tx;
        this.fogMatrix.f = -ty;
        pat.setTransform(this.fogMatrix);
        sg.globalAlpha = layer ? 0.5 : 0.75;
        sg.fillRect(0, 0, w, h);
      }
      sg.globalAlpha = 1;
      sg.globalCompositeOperation = "destination-in";
      sg.drawImage(f.mask, Math.round(x0 - f.x), Math.round(y0 - f.y), w, h, 0, 0, w, h);
      sg.globalCompositeOperation = "source-over";
      g.globalAlpha = 0.3;
      g.drawImage(this.fogScratch, 0, 0, w, h, Math.round(x0) - ox, Math.round(y0) - oy, w, h);
      g.globalAlpha = 1;
    }
  }

  private lightPass(g: Ctx, ox: number, oy: number, amb: [number, number, number], dark: number, world: WorldView): void {
    const L = this.lighting;
    L.begin(amb);
    const rm = !!this.opts.reducedMotion;
    const s = this.screen;
    const vis = (x: number, y: number, r: number) => x + r > ox && y + r > oy && x - r < ox + s.bw && y - r < oy + s.bh;
    const lightAmt = 0.35 + dark * 0.75;
    // prop lights
    for (const i of this.visiblePropIdx(ox, oy, s.bw, s.bh)) {
      const p = this.props[i];
      if (!p.light) continue;
      if (p.id && world.removedProps.has(p.id)) continue;
      if (!this.propLit(p)) continue;
      const y = p.y + p.light.dy;
      if (!vis(p.x, y, p.light.radius)) continue;
      const f = p.light.flicker ? flicker(this.t, p.i, rm) : 1;
      L.add(p.x - ox, y - oy, p.light.radius * (0.97 + 0.03 * f), p.light.color, lightAmt * f);
    }
    // actors that carry a light on their sheet (the Well Spirit)
    for (const a of world.actors) {
      const light = this.atlas.sheet(a.sprite)?.def.light;
      if (!light || a.alpha < 0.05) continue;
      const y = a.y - a.z + (light.dy ?? -16);
      if (!vis(a.x, y, light.radius)) continue;
      const f = light.flicker ? flicker(this.t, a.id, rm) : 1;
      L.add(a.x - ox, y - oy, light.radius, light.color, lightAmt * f * a.alpha);
    }
    // placed lights
    for (const l of this.lights) {
      if (l.night && world.dusk < 0.35) continue;
      if (!vis(l.x, l.y, l.r)) continue;
      const f = l.flicker ? flicker(this.t, l.seed, rm) : 1;
      const k = l.night ? clamp((world.dusk - 0.35) / 0.4, 0, 1) : 1;
      L.add(l.x - ox, l.y - oy, l.r, l.color, lightAmt * f * k);
    }
    // flame gates
    for (const gt of this.gates) {
      if (gt.kind !== "flame") continue;
      const open = world.openGates.has(gt.id);
      const k = open ? (gt.openT >= 0 ? clamp(1 - (this.t - gt.openT) / 0.8, 0, 1) : 0) : 1;
      if (k <= 0) continue;
      const cx = gt.x + gt.w / 2, cy = gt.y + gt.h / 2 - 12;
      const r = Math.max(gt.w, gt.h) / 2 + 56;
      L.add(cx - ox, cy - oy, r, "#ff9a40", (0.5 + dark * 0.6) * k * flicker(this.t, 99, rm));
    }
    // projectiles
    for (const p of world.projectiles) {
      const c = PROJ_KEYS[p.kind];
      if (!c?.light) continue;
      const r = p.kind === "frostRing" ? p.r + 24 : p.kind === "spore" ? p.r + 10 : c.light[0];
      L.add(p.x - ox, projGround(p) - c.z - oy, r, c.light[1], (p.kind === "spore" ? 0.25 : 0.5) + dark * 0.5);
    }
    // hero lantern when it is dark, charge glow
    if (dark > 0.3) L.add(this.heroX - ox, this.heroY - 16 - oy, 44 + dark * 16, "#b8b0a0", (dark - 0.3) * 0.5);
    if (world.hero.charge > 0.2) L.add(this.heroX - ox, this.heroY - 18 - oy, 28 + world.hero.charge * 16, "#a8d8ff", world.hero.charge * 0.6);
    // effect lights
    for (const sp of this.fx.specials) {
      const x = sp.kind !== "rays" && sp.follow ? this.heroX + (sp.kind === "column" ? 0 : sp.x) : sp.x;
      const y = sp.kind !== "rays" && sp.follow ? this.heroY + (sp.kind === "column" ? -30 : sp.y) : sp.y - (sp.kind === "column" ? 30 : 0);
      const k = 1 - sp.t / sp.dur;
      if (sp.kind === "column") L.add(x - ox, y - oy, 80, sp.color, k * 0.9);
      else if (sp.kind === "rays") L.add(x - ox, y - oy, 56, "#ffe8a0", k * 0.8);
    }
    for (const sp of this.fx.sprites) {
      if (!sp.emissive) continue;
      const k = sp.sheet.key;
      if (k === "fx.ember" || k === "fx.levelUp") {
        const x = sp.follow ? this.heroX + sp.x : sp.x, y = sp.follow ? this.heroY + sp.y : sp.y;
        L.add(x - ox, y - oy, k === "fx.levelUp" ? 90 : 48, k === "fx.levelUp" ? "#fff0a0" : "#ff9a40", 0.9 * (1 - sp.t / sp.dur));
      }
    }
    // shafts brighten what they cross a little in the light map too
    for (const sh of this.shafts) {
      const day = 1 - clamp(world.dusk * 1.6, 0, 1);
      if (day <= 0 || !vis(sh.x + sh.w / 2, sh.y + sh.h / 2, Math.max(sh.w, sh.h))) continue;
      L.add(sh.x + sh.w * 0.62 - ox, sh.y + sh.h * 0.78 - oy, Math.max(24, sh.w * 0.6), "#fff0d0", 0.35 * day);
    }
    L.apply(g);
  }

  private drawShafts(g: Ctx, ox: number, oy: number, world: WorldView): void {
    if (!this.shafts.length) return;
    const day = 1 - clamp(world.dusk * 1.6, 0, 1);
    if (day <= 0) return;
    g.globalCompositeOperation = "lighter";
    for (const sh of this.shafts) {
      const pulse = this.opts.reducedMotion ? 1 : 0.82 + 0.18 * Math.sin(this.t * 0.7 + sh.seed);
      g.globalAlpha = (sh.kind === "window" ? 0.34 : 0.26) * day * pulse;
      g.drawImage(sh.canvas, Math.round(sh.x) - ox, Math.round(sh.y) - oy);
    }
    g.globalAlpha = 1;
    g.globalCompositeOperation = "source-over";
  }

  private drawGlows(g: Ctx, ox: number, oy: number, dark: number, world: WorldView): void {
    const L = this.lighting;
    const s = this.screen;
    const rm = !!this.opts.reducedMotion;
    g.globalCompositeOperation = "lighter";
    for (const i of this.visiblePropIdx(ox, oy, s.bw, s.bh)) {
      const p = this.props[i];
      if (!p.light || !this.propLit(p)) continue;
      if (p.id && world.removedProps.has(p.id)) continue;
      const f = p.light.flicker ? flicker(this.t, p.i, rm) : 1;
      const r = p.kind === "wardstone" ? 22 : p.kind === "hearth" ? 18 : 9;
      const spr = L.glow(r, p.light.color);
      g.globalAlpha = (0.18 + dark * 0.4) * f;
      g.drawImage(spr, Math.round(p.x - r) - ox, Math.round(p.y + p.light.dy - r) - oy);
    }
    // lit windows: a building's `glow` anim holds one emissive frame per variant
    if (dark > LIGHT_CUT) {
      g.globalAlpha = clamp((dark - LIGHT_CUT) * 1.6, 0, 1);
      for (const i of this.visiblePropIdx(ox, oy, s.bw, s.bh)) {
        const p = this.props[i];
        const sh = p.sheet;
        const ga = sh?.def.anims.glow;
        if (!sh || !ga || !Array.isArray(ga.frames) || !ga.frames.length) continue;
        const fi = ga.frames[Math.min(p.v, ga.frames.length - 1)];
        this.blitFrame(g, sh, fi, p.flip, p.x, p.y, ox, oy, "normal");
      }
    }
    for (const p of world.projectiles) {
      const c = PROJ_KEYS[p.kind];
      if (!c?.light || p.kind === "frostRing" || p.kind === "spore") continue;
      const spr = L.glow(10, c.light[1]);
      g.globalAlpha = 0.6;
      g.drawImage(spr, Math.round(p.x - 10) - ox, Math.round(projGround(p) - c.z - 10) - oy);
    }
    for (const p of world.pickups) {
      if (p.kind !== "item") continue;
      const spr = L.glow(9, "#ffe8a0");
      g.globalAlpha = 0.35 + 0.15 * Math.sin(this.t * 4 + p.id);
      g.drawImage(spr, Math.round(p.x - 9) - ox, Math.round(p.y - p.z - 12) - oy);
    }
    for (const gt of this.gates) {
      if (gt.kind !== "flame" || (world.openGates.has(gt.id) && (gt.openT < 0 || this.t - gt.openT > 0.8))) continue;
      const spr = L.glow(14, "#ff9030");
      const cols = Math.max(1, Math.round(gt.w / TILE)), rows = Math.max(1, Math.round(gt.h / TILE));
      g.globalAlpha = 0.35 * flicker(this.t, 7, rm);
      for (let r = 0; r < rows; r++)
        for (let c = 0; c < cols; c++) g.drawImage(spr, Math.round(gt.x + c * TILE + 2) - ox, Math.round(gt.y + r * TILE + 4) - oy);
    }
    g.globalAlpha = 1;
    g.globalCompositeOperation = "source-over";
  }

  private drawRaise(g: Ctx, ox: number, oy: number, world: WorldView): void {
    const h = world.hero;
    if (h.anim !== "raise") return;
    // HeroView has no item field yet: prefer one if the sim ever adds it, else the chest's loot
    const extra = (h as typeof h & { raiseItem?: string | null }).raiseItem;
    const key = extra ? (extra === "gold" ? "icon.gold" : `icon.${extra}`)
      : this.raiseItem && this.raiseT >= 0 && this.t - this.raiseT < 1.6 ? this.raiseItem : null;
    const icon = key ? this.atlas.icon(key) : null;
    const lift = Math.round(clamp(h.animTime / 0.12, 0, 1) * 6);
    const x = this.heroX, y = this.heroY - Math.min(52, this.spriteTop("hero")) - 6 - lift;
    const L = this.lighting;
    const glow = L.glow(16, "#ffe070");
    g.globalCompositeOperation = "lighter";
    g.globalAlpha = 0.55 + 0.15 * Math.sin(this.t * 6);
    g.drawImage(glow, Math.round(x - 16) - ox, Math.round(y - 16) - oy);
    g.globalCompositeOperation = "source-over";
    g.globalAlpha = 1;
    if (icon) g.drawImage(icon, Math.round(x - icon.naturalWidth / 2) - ox, Math.round(y - icon.naturalHeight / 2) - oy);
    else {
      const sh = this.atlas.sheets.get("fx.sparkle");
      const a = sh ? resolveAnim(sh, ["twinkle"], "down") : null;
      if (sh && a) this.blitFrame(g, sh, a.frames[Math.floor(this.t * 12) % a.frames.length], false, x, y + sh.ay - sh.h / 2, ox, oy, "normal");
    }
    if (!this.opts.reducedMotion && Math.random() < 0.3)
      this.fx.play("fx.sparkle", ["twinkle"], x + (Math.random() - 0.5) * 22, y + (Math.random() - 0.5) * 18);
  }

  private drawMarkers(g: Ctx, ox: number, oy: number, world: WorldView): void {
    for (const a of world.actors) {
      if (!a.marker) continue;
      const sh = this.atlas.sheets.get(a.sprite);
      const top = sh ? sh.ay - sh.topPad : 40;
      const spr = markerSprite(a.marker);
      const bob = this.opts.reducedMotion ? 0 : Math.round(Math.sin(this.t * 4 + a.id) * 1.5);
      const x = Math.round(a.x - spr.width / 2) - ox;
      const y = Math.round(a.y - a.z - top - spr.height - 5 + bob) - oy;
      g.drawImage(spr, x, y);
    }
  }

  /** Test/diagnostic hooks (not part of the contract). */
  setDebug(o: { hideText?: boolean }): void {
    if (o.hideText !== undefined) this.numbers.hidden = o.hideText;
  }

  /** Lab: build every ground chunk now (to measure steady-state frames). */
  buildAll(): void {
    if (this.ground) this.ground.ensure(0, 0, this.ground.pxW, this.ground.pxH);
  }

  debug() {
    const s = this.screen;
    return {
      k: s.k, devW: s.devW, devH: s.devH, bw: s.bw, bh: s.bh, dpr: s.dpr, offX: this.plan.offX, offY: this.plan.offY,
      ox: this.plan.ox, oy: this.plan.oy, cam: { x: this.cam.x, y: this.cam.y },
      renderMs: this.stats.renderMs, updateMs: this.stats.updateMs, maxRenderMs: this.stats.maxRenderMs, frames: this.stats.frames,
      samples: this.stats.samples.slice(), chunksBuilt: this.ground?.builtCount ?? 0, chunksTotal: (this.ground?.cols ?? 0) * (this.ground?.rows ?? 0),
      chunkBuildMs: this.ground?.buildMs ?? 0, chunkMaxMs: this.ground?.maxBuildMs ?? 0, groundComposes: this.groundLayer.composes, buffer: this.buf,
      particles: this.fx.parts.n, sprites: this.fx.sprites.length, disposed: this.disposed, numberBoxes: this.numberBoxes.slice(),
    };
  }
}

export const createView: CreateView = (canvas, options) => new PixelView(canvas, options);
