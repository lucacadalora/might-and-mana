import {
  TILE, type BuffId, type Cond, type Dir4, type Effect, type EntityPlacement, type MapDef, type MapId,
  type NpcDef, type PropPlacement, type QuestCard, type QuestDef, type SaveState, type SimEvent,
  type Slot, type SpellId, type Stats, type WorldView, type ActorView, type PickupView, type ProjectileView,
} from "../contract";
import { MAPS } from "../content/maps";
import { PROPS } from "../content/props";
import { XP_TO_NEXT, statsAt } from "../content/levels";
import { CONSUMABLES, GEAR, KEY_ITEMS } from "../content/items";
import { SPELLS } from "../content/spells";
import { SKILLS } from "../content/skills";
import { MONSTERS } from "../content/monsters";
import { NPCS } from "../content/npcs";
import { DIALOG, fillHero } from "../content/dialog";
import { QUESTS } from "../content/quests";
import { SHOPS, SHOP_UNLOCKS } from "../content/shops";
import { CollisionMap } from "./collision";
import { Rng } from "./rng";
import { updateMonster, hurtMonster } from "./ai";
import {
  CAST, COMBO_POWER, DODGE, HERO_R, HURT, REACH, SPIN, SWING, WALK,
  type Actor, type DialogRuntime, type Hero, type Pickup, type Projectile, type SimInput,
} from "./types";

const SLOTS: Slot[] = ["head", "body", "boots", "weapon", "charm"];
const DIRS: Record<Dir4, [number, number]> = { down: [0, 1], up: [0, -1], left: [-1, 0], right: [1, 0] };
/** Opening these chests also sets a story flag. */
const CHEST_FLAGS: Record<string, string> = { c_home_bed: "dressed", c_b1_ring: "ringFound", c_mg_bridge: "rodFound" };
/** Clearing these once-spawns sets a story flag. */
const SPAWN_FLAGS: Record<string, string> = { groveWolves: "wolvesCleared" };
const BUFF_NAMES: Record<BuffId, string> = { stoneskin: "Stoneskin", fury: "Fury", fortune: "Fortune", quickstep: "Quickstep" };
const MAX_LEVEL = 30;

export type SimModal =
  | { kind: "none" } | { kind: "dialog" } | { kind: "questCard"; card: QuestCard } | { kind: "unlock"; title: string; hint: string }
  | { kind: "shop"; shop: string } | { kind: "status" } | { kind: "items" } | { kind: "map" } | { kind: "pause" }
  | { kind: "dead" } | { kind: "clear" };

export interface Interactable { kind: "npc" | "chest" | "sign" | "lever" | "inspect"; label: string; x: number; y: number; id: string; actor?: Actor; prop?: PropPlacement }

export function newSave(heroName: string, seed = 20260924): SaveState {
  const name = heroName.trim().slice(0, 12) || "Wren";
  const base = statsAt(1);
  return {
    v: 2, heroName: name, level: 1, xp: 0, hp: base.hp, mp: base.mp, gold: 20,
    equipped: { head: "clothHood", body: null, boots: "clothShoes", weapon: null, charm: null },
    gear: [], bag: { herb: 1 }, spells: [], spell: null, flags: {},
    quests: { wardstone: QUESTS.wardstone?.steps[0]?.id ?? "dress" }, done: [], progress: {}, chests: [],
    map: "home", x: MAPS.home.spawn.x * TILE, y: MAPS.home.spawn.y * TILE, facing: MAPS.home.spawn.facing,
    night: false, visited: ["home"], playSeconds: 0, stats: { kills: 0, deaths: 0, grass: 0, crits: 0 },
    rng: seed >>> 0, savedAt: new Date(0).toISOString(), chapterClear: false,
  };
}

export class Sim {
  s: SaveState;
  rng: Rng;
  map!: MapDef;
  col!: CollisionMap;
  hero!: Hero;
  actors: Actor[] = [];
  pickups: Pickup[] = [];
  projectiles: Projectile[] = [];
  removed = new Set<string>();
  gatesOpen = new Set<string>();
  events: SimEvent[] = [];
  notices: Array<{ text: string; kind: "info" | "gold" | "item" | "quest" | "warning" }> = [];
  dialog: DialogRuntime | null = null;
  modal: SimModal = { kind: "none" };
  private modalQueue: SimModal[] = [];
  private unlockQueue: Array<{ title: string; hint: string }> = [];
  buffs: Partial<Record<BuffId, number>> = {};
  time = 0;
  dusk = 0;
  private duskTarget = 0;
  private nextId = 1;
  private exitArmed = false;
  private triggerInside = new Set<string>();
  private play = 0;
  private scripted: Array<{ at: number; map: MapId; run: () => void; fallback?: () => void }> = [];
  bossId: number | null = null;
  /** Direction held this step (for facing the swing), null when the stick is centred. */
  private aim: [number, number] | null = null;
  lastAutosave: SaveState;
  private needSave: "map" | "rest" | "clear" | "story" | null = null;

  constructor(save: SaveState) {
    this.s = structuredClone(save);
    this.rng = new Rng(this.s.rng);
    // Never start a hero at 0 HP (an old save written during a death).
    if (!(this.s.hp > 0)) this.s.hp = Math.max(1, Math.ceil(statsAt(Math.max(1, this.s.level)).hp / 2));
    this.dusk = this.duskTarget = this.s.night ? 1 : 0;
    this.enterMap(this.s.map, { x: this.s.x / TILE, y: this.s.y / TILE, facing: this.s.facing }, false);
    this.lastAutosave = this.durable();
  }

  // ─── Derived stats ──────────────────────────────────────────────────────────────────────────
  stats(): Stats {
    const base = statsAt(this.s.level);
    const out: Stats = { ...base };
    for (const slot of SLOTS) {
      const id = this.s.equipped[slot];
      const g = id ? GEAR[id] : null;
      if (!g) continue;
      for (const k of Object.keys(g.mods) as Array<keyof Stats>) out[k] += g.mods[k] ?? 0;
    }
    if (this.buffs.fury) { out.atk *= 2; out.def *= 0.5; }
    if (this.buffs.quickstep) out.spd *= 1.6;
    out.atk = Math.max(1, Math.round(out.atk)); out.def = Math.max(1, Math.round(out.def)); out.spd = Math.max(1, Math.round(out.spd));
    out.hp = Math.max(1, Math.round(out.hp)); out.mp = Math.max(0, Math.round(out.mp));
    return out;
  }
  maxCombo(): number {
    let n = 1;
    for (const k of SKILLS) if (this.s.level >= k.level) {
      if (k.id === "combo2") n = Math.max(n, 2);
      if (k.id === "combo3") n = Math.max(n, 3);
      if (k.id === "combo4") n = Math.max(n, 4);
    }
    return n;
  }
  hasSpin(): boolean { return SKILLS.some(k => k.id === "spin" && this.s.level >= k.level); }
  goldFind(): number {
    let m = this.buffs.fortune ? 2 : 1;
    const charm = this.s.equipped.charm ? GEAR[this.s.equipped.charm] : null;
    if (charm?.special === "goldFind") m *= 1.25;
    return m;
  }

  // ─── Map lifecycle ──────────────────────────────────────────────────────────────────────────
  enterMap(id: MapId, at: { x: number; y: number; facing: Dir4 }, announce = true) {
    // Beats scripted for the map we are leaving keep their lasting effects.
    for (const job of this.scripted.splice(0)) job.fallback?.();
    const map = MAPS[id];
    this.map = map;
    this.col = new CollisionMap(map);
    this.actors = []; this.pickups = []; this.projectiles = [];
    this.removed = new Set(); this.gatesOpen = new Set(); this.triggerInside = new Set();
    this.bossId = null;
    const x = at.x * TILE, y = at.y * TILE;
    this.hero = {
      x, y, px: x, py: y, level: this.col.heightAt(x, y), kx: 0, ky: 0, facing: at.facing, state: "free", t: 0, moving: false,
      combo: 0, queued: false, lastSwing: -9, hit: new Set(), holdTime: 0, charge: 0, dodgeX: 0, dodgeY: 0, dodgeCd: 0,
      invuln: 0, flash: 0, slowT: 0, castSpell: null, castDone: false, raiseItem: null, regen: 0, stepDist: 0, deadT: 0,
    };
    this.col.resolve(this.hero, HERO_R);
    this.s.map = id;
    if (!this.s.visited.includes(id)) this.s.visited.push(id);
    this.exitArmed = !this.insideExit();
    // Gates first (they add collision), then actors.
    for (const e of map.entities) if (e.type === "gate") {
      if (this.cond(e.open) || this.s.flags[`gate:${e.id}`]) this.gatesOpen.add(e.id);
      else this.col.add({ kind: "rect", x: e.x * TILE, y: e.y * TILE, w: e.w * TILE, h: e.h * TILE, id: `gate:${e.id}` });
    }
    this.populate();
    this.emit({ t: "map", map: id });
    this.emit({ t: "music", id: this.musicFor() });
    if (announce) this.needSave = "map";
  }

  musicFor() {
    if (this.map.id === "larkmoor" && this.s.night) return "villageNight" as const;
    if (this.map.music === "boss" && this.s.flags.bossDown) return "dungeon" as const;
    return this.map.music;
  }

  private populate() {
    for (const e of this.map.entities) {
      if (e.type === "npc") {
        const npc = NPCS[e.id];
        if (!npc) continue;
        if (e.night === "only" && !this.s.night) continue;
        if (e.night === "hide" && this.s.night) continue;
        if (!this.npcVisible(e.id)) continue;
        this.addNpc(npc, e.x * TILE, e.y * TILE, e.facing ?? "down", e.wander ?? 0);
      } else if (e.type === "follower") {
        const npc = NPCS[e.npc];
        if (!npc || !this.cond(e.when) || this.s.flags.lambHome) continue;
        const a = this.addNpc(npc, e.x * TILE, e.y * TILE, "down", 1.5);
        a.kind = "follower";
      } else if (e.type === "spawn") {
        if (e.once && this.s.flags[`cleared:${e.id}`]) continue;
        if (e.when && !this.cond(e.when)) continue;
        this.spawn(e);
      }
    }
    // A follower already following comes along to the new map.
    if (this.s.flags.lambFollowing && !this.s.flags.lambHome) {
      const npc = NPCS.lamb;
      if (npc && !this.actors.some(a => a.def === "lamb")) {
        const a = this.addNpc(npc, this.hero.x - 16, this.hero.y + 8, this.hero.facing, 0);
        a.kind = "follower"; a.following = true; a.state = "follow";
      }
    }
    // After the lamb comes home it lives in the pen near Lottie.
    if (this.map.id === "larkmoor" && this.s.flags.lambHome && NPCS.lamb) {
      const lottie = this.map.entities.find(e => e.type === "npc" && e.id === "lottie");
      if (lottie) this.addNpc(NPCS.lamb, lottie.x * TILE - 40, lottie.y * TILE - 8, "right", 1.2);
    }
  }

  npcVisible(id: string): boolean {
    if (id === "hooded") return !!this.s.flags.bossDown && !this.s.flags.sawHooded && !!this.s.flags.wardstoneLit;
    return true;
  }

  private addNpc(npc: NpcDef, x: number, y: number, facing: Dir4, wander: number): Actor {
    const a = this.blankActor("npc", npc.id, npc.sprite, x, y);
    a.npc = npc; a.facing = facing; a.wander = wander; a.radius = 7; a.speed = 26;
    this.col.resolve(a, a.radius);
    this.actors.push(a);
    return a;
  }

  private blankActor(kind: Actor["kind"], def: string, sprite: string, x: number, y: number): Actor {
    return {
      id: this.nextId++, kind, def, sprite, x, y, px: x, py: y, z: 0, level: this.col.heightAt(x, y), kx: 0, ky: 0,
      facing: "down", state: "idle", t: 0, anim: "idle", animTime: 0, hp: 1, maxHp: 1, st: { hp: 1, mp: 0, atk: 1, def: 1, spd: 1 },
      radius: 8, speed: 40, homeX: x, homeY: y, wander: 0, flash: 0, alpha: 1, dead: false, elite: false, invuln: 0,
      contactCd: 0, hitBy: -1, poise: 0, phase: 1, slowT: 0, burnT: 0, burnTick: 0, aggro: false, ai: {}, gx: x, gy: y, removeT: 0,
    };
  }

  spawnMonster(defId: string, x: number, y: number, spawnId?: string, once?: boolean): Actor | null {
    const def = MONSTERS[defId];
    if (!def) return null;
    const base = statsAt(Math.max(1, Math.min(MAX_LEVEL, def.level)));
    const elite = def.elite ? 1.5 : 1;
    const st: Stats = {
      hp: Math.max(1, Math.round(base.hp * def.mult.hp * elite)),
      mp: 0,
      atk: Math.max(1, Math.round(base.atk * def.mult.atk * elite)),
      def: Math.max(1, Math.round(base.def * def.mult.def * elite)),
      spd: Math.max(1, Math.round(base.spd * def.mult.spd * elite)),
    };
    const a = this.blankActor("monster", defId, def.sprite, x, y);
    a.mdef = def; a.st = st; a.hp = a.maxHp = st.hp; a.radius = def.radius; a.speed = def.speed; a.elite = !!def.elite;
    a.spawnId = spawnId; a.once = once; a.state = "idle"; a.t = this.rng.range(0, 1.5);
    a.facing = this.rng.pick(["down", "left", "right", "up"] as Dir4[]);
    this.col.resolve(a, a.radius);
    this.actors.push(a);
    if (def.boss) this.bossId = a.id;
    return a;
  }

  private spawn(e: Extract<EntityPlacement, { type: "spawn" }>) {
    const r = (e.radius ?? 1.5) * TILE;
    for (let i = 0; i < e.count; i++) {
      let x = e.x * TILE, y = e.y * TILE;
      for (let tries = 0; tries < 12; tries++) {
        const ang = this.rng.range(0, Math.PI * 2), d = e.count > 1 ? this.rng.range(0, r) : 0;
        const cx = e.x * TILE + Math.cos(ang) * d, cy = e.y * TILE + Math.sin(ang) * d;
        const t = this.col.tileAt(cx, cy);
        if (!this.col.tileBlocked(t.x, t.y, this.col.heightAt(e.x * TILE, e.y * TILE), false)) { x = cx; y = cy; break; }
      }
      this.spawnMonster(e.monster, x, y, e.id, e.once);
    }
  }

  // ─── Conditions and events ──────────────────────────────────────────────────────────────────
  cond(c: Cond | undefined): boolean {
    if (!c) return true;
    if ("flag" in c) return !!this.s.flags[c.flag];
    if ("notFlag" in c) return !this.s.flags[c.notFlag];
    if ("quest" in c) return this.s.quests[c.quest] === c.step;
    if ("questActive" in c) return c.questActive in this.s.quests;
    if ("questDone" in c) return this.s.done.includes(c.questDone);
    if ("night" in c) return this.s.night === c.night;
    if ("level" in c) return this.s.level >= c.level;
    if ("has" in c) return this.count(c.has) >= (c.count ?? 1);
    if ("gold" in c) return this.s.gold >= c.gold;
    if ("all" in c) return c.all.every(x => this.cond(x));
    if ("any" in c) return c.any.some(x => this.cond(x));
    return false;
  }

  emit(e: SimEvent) { this.events.push(e); }
  drain(): SimEvent[] { const e = this.events; this.events = []; return e; }
  notice(text: string, kind: Sim["notices"][number]["kind"] = "info") { this.notices.push({ text, kind }); }
  sfx(cue: string, x?: number, y?: number) { this.emit({ t: "sfx", cue, x, y }); }
  takeSaveRequest() { const r = this.needSave; this.needSave = null; return r; }

  count(item: string): number {
    if (GEAR[item]) return this.s.gear.filter(g => g === item).length + SLOTS.filter(s => this.s.equipped[s] === item).length;
    return this.s.bag[item] ?? 0;
  }

  // ─── Main step ──────────────────────────────────────────────────────────────────────────────
  step(input: SimInput, dt: number) {
    this.time += dt;
    this.play += dt;
    if (this.play >= 1) { this.s.playSeconds += Math.floor(this.play); this.play -= Math.floor(this.play); }
    if (this.dusk !== this.duskTarget) this.dusk += Math.sign(this.duskTarget - this.dusk) * Math.min(Math.abs(this.duskTarget - this.dusk), dt / 1.2);
    for (const k of Object.keys(this.buffs) as BuffId[]) {
      this.buffs[k] = (this.buffs[k] ?? 0) - dt;
      if ((this.buffs[k] ?? 0) <= 0) { delete this.buffs[k]; this.notice(`${BUFF_NAMES[k]} wore off`, "warning"); }
    }
    for (let i = this.scripted.length - 1; i >= 0; i--) {
      const job = this.scripted[i];
      if (job.map !== this.map.id) { this.scripted.splice(i, 1); job.fallback?.(); continue; }
      if (this.time >= job.at) { this.scripted.splice(i, 1); job.run(); }
    }
    if (this.modal.kind !== "none") return;
    this.stepHero(input, dt);
    for (const a of this.actors) this.stepActor(a, dt);
    this.separate();
    this.stepProjectiles(dt);
    this.stepPickups(dt);
    this.actors = this.actors.filter(a => !(a.dead && a.removeT <= 0));
    this.checkGates();
    this.checkExits();
    this.checkTriggers();
    this.checkQuests();
    if (this.modal.kind === "none" && this.unlockQueue.length && this.hero.state === "free" && !this.inCombat()) {
      const u = this.unlockQueue.shift()!;
      this.openModal({ kind: "unlock", title: u.title, hint: u.hint });
    }
  }

  inCombat(): boolean {
    return this.actors.some(a => a.kind === "monster" && !a.dead && a.aggro && Math.hypot(a.x - this.hero.x, a.y - this.hero.y) < 200);
  }

  // ─── Hero ───────────────────────────────────────────────────────────────────────────────────
  private stepHero(input: SimInput, dt: number) {
    const h = this.hero;
    h.px = h.x; h.py = h.y;
    h.t += dt;
    h.invuln = Math.max(0, h.invuln - dt);
    h.flash = Math.max(0, h.flash - dt);
    h.dodgeCd = Math.max(0, h.dodgeCd - dt);
    h.slowT = Math.max(0, h.slowT - dt);
    const st = this.stats();
    if (this.s.hp > st.hp) this.s.hp = st.hp;
    if (this.s.mp > st.mp) this.s.mp = st.mp;
    if (h.state === "dead") {
      h.deadT += dt;
      if (h.deadT > 1.6 && this.modal.kind === "none") this.openModal({ kind: "dead" });
      return;
    }
    // MP regeneration outside combat.
    h.regen += dt;
    if (h.regen >= 4) { h.regen = 0; if (!this.inCombat() && this.s.mp < st.mp) this.s.mp += 1; }

    let mx = input.mx, my = input.my;
    const len = Math.hypot(mx, my);
    if (len > 1) { mx /= len; my /= len; }
    const moving = len > 0.15;
    this.aim = moving ? [mx, my] : null;
    const p = input.pressed;
    if (p.pause) { this.openModal({ kind: "pause" }); return; }
    if (p.item) { this.openModal({ kind: "items" }); return; }
    if (p.map) { this.openModal({ kind: "map" }); return; }
    if (p.status) { this.openModal({ kind: "status" }); return; }
    if (p.nextSpell) this.cycleSpell();

    // Held attack tracking (charge).
    h.holdTime = input.held.attack ? h.holdTime + dt : 0;

    // Interact beats attack when something is in reach.
    if (p.attack && (h.state === "free" || h.state === "charge")) {
      const target = this.interactable();
      if (target) { this.interact(target); h.holdTime = -1; return; }
    }
    if (p.dodge && h.dodgeCd <= 0 && ["free", "attack", "charge", "hurt"].includes(h.state) && !(h.state === "attack" && h.t < SWING.activeEnd)) {
      const [dx, dy] = moving ? [mx / Math.max(len, 1e-6), my / Math.max(len, 1e-6)] : DIRS[h.facing];
      h.state = "dodge"; h.t = 0; h.dodgeX = dx; h.dodgeY = dy; h.invuln = Math.max(h.invuln, DODGE.invuln);
      h.combo = 0; h.queued = false; h.charge = 0;
      this.emit({ t: "dodge", x: h.x, y: h.y }); this.sfx("dodge");
    }
    if (p.magic && (h.state === "free" || h.state === "charge" || (h.state === "attack" && h.t >= SWING.activeEnd))) this.startCast();
    if (p.attack && h.holdTime >= 0) {
      if (!this.s.equipped.weapon) {
        if (!this.s.flags.noBladeHint) { this.notice("You have no weapon yet", "warning"); this.s.flags.noBladeHint = true; }
      } else if (h.state === "free") {
        const chain = this.time - h.lastSwing <= SWING.window && h.combo < this.maxCombo() ? h.combo + 1 : 1;
        this.startSwing(chain);
      } else if (h.state === "attack" && h.combo < this.maxCombo()) h.queued = true;
    }

    switch (h.state) {
      case "free": {
        if (moving) {
          h.facing = facingFrom(mx, my, h.facing);
          let speed = WALK * (this.buffs.quickstep ? 1.3 : 1);
          if (this.col.isSlow(h.x, h.y)) speed *= 0.6;
          if (h.slowT > 0) speed *= 0.5;
          // Door assist: walking into a doorway slightly off-centre slides the hero into it.
          let ax = 0;
          if (Math.abs(my) > 0.6) for (const d of this.col.doors) {
            const ddx = d.x - h.x, ddy = d.y - h.y;
            if (Math.abs(ddx) < 22 && Math.abs(ddx) > 1 && ddy * my > 0 && Math.abs(ddy) < 34) { ax = Math.sign(ddx) * Math.min(Math.abs(ddx), 70 * dt); break; }
          }
          this.moveHero(mx * speed * dt + ax, my * speed * dt);
          h.stepDist += speed * dt * Math.min(1, len);
          if (h.stepDist >= 26) { h.stepDist = 0; this.emit({ t: "step", surface: surfaceOf(this.col.groundAt(h.x, h.y)) }); }
        }
        h.moving = moving;
        if (input.held.attack && h.holdTime >= 0.3 && this.hasSpin() && this.s.equipped.weapon) { h.state = "charge"; h.t = 0; h.charge = 0; }
        break;
      }
      case "charge": {
        h.charge = Math.min(1, h.charge + dt / 0.6);
        if (moving) { h.facing = facingFrom(mx, my, h.facing); this.moveHero(mx * WALK * 0.45 * dt, my * WALK * 0.45 * dt); }
        h.moving = moving;
        if (!input.held.attack) {
          if (h.charge >= 1) { h.state = "spin"; h.t = 0; h.hit.clear(); this.emit({ t: "swing", x: h.x, y: h.y, facing: h.facing, combo: 4, spin: true }); this.sfx("spin", h.x, h.y); }
          else h.state = "free";
          h.charge = 0;
        }
        break;
      }
      case "attack": {
        const [fx, fy] = DIRS[h.facing];
        if (h.t < SWING.activeEnd) this.moveHero(fx * 26 * dt, fy * 26 * dt);
        if (h.t >= SWING.anticipation && h.t <= SWING.activeEnd) this.swingHits(false);
        if (h.queued && h.t >= SWING.chainAt) { this.startSwing(h.combo + 1); break; }
        if (h.t >= SWING.end) { h.state = "free"; h.queued = false; }
        break;
      }
      case "spin": {
        if (h.t >= SPIN.activeStart && h.t <= SPIN.activeEnd) this.swingHits(true);
        if (h.t >= SPIN.time) { h.state = "free"; h.combo = 0; }
        break;
      }
      case "cast": {
        if (!h.castDone && h.t >= CAST.release) { h.castDone = true; this.releaseSpell(); }
        if (h.t >= CAST.time) h.state = "free";
        break;
      }
      case "dodge": {
        const k = 1 - h.t / DODGE.time;
        this.moveHero(h.dodgeX * DODGE.speed * (0.45 + 0.55 * k) * dt, h.dodgeY * DODGE.speed * (0.45 + 0.55 * k) * dt);
        if (h.t >= DODGE.time) { h.state = "free"; h.dodgeCd = DODGE.cooldown; }
        break;
      }
      case "hurt": {
        if (h.t >= HURT.time) h.state = "free";
        break;
      }
      case "raise": {
        if (h.t >= 0.95) { h.state = "free"; h.raiseItem = null; }
        break;
      }
    }
    // Knockback.
    if (Math.abs(h.kx) + Math.abs(h.ky) > 1) {
      this.moveHero(h.kx * dt, h.ky * dt);
      const d = Math.exp(-10 * dt); h.kx *= d; h.ky *= d;
    } else { h.kx = 0; h.ky = 0; }
  }

  private moveHero(dx: number, dy: number) { this.col.move(this.hero, HERO_R, dx, dy); }

  private startSwing(combo: number) {
    const h = this.hero;
    if (this.aim) h.facing = facingFrom(this.aim[0], this.aim[1], h.facing);
    h.state = "attack"; h.t = 0; h.combo = combo; h.queued = false; h.lastSwing = this.time; h.hit.clear();
    this.emit({ t: "swing", x: h.x, y: h.y, facing: h.facing, combo });
    this.sfx(combo >= 3 ? "swing3" : combo === 2 ? "swing2" : "swing1", h.x, h.y);
  }

  private swingHits(spin: boolean) {
    const h = this.hero;
    const [fx, fy] = DIRS[h.facing];
    const cx = h.x, cy = h.y - 10;
    const reach = spin ? REACH.spin : REACH.swing;
    const inArc = (x: number, y: number, r: number) => {
      const dx = x - cx, dy = y - cy;
      const d = Math.hypot(dx, dy);
      if (d > reach + r) return false;
      if (spin || d < 8) return true;
      return (dx * fx + dy * fy) / d > Math.cos(1.25);
    };
    for (const a of this.actors) {
      if (a.kind !== "monster" || a.dead || h.hit.has(`a${a.id}`)) continue;
      if (!inArc(a.x, a.y - 8 - a.z, a.radius)) continue;
      h.hit.add(`a${a.id}`);
      const power = spin ? 1.6 : COMBO_POWER[Math.min(4, h.combo)] ?? 1;
      const knock = spin ? 170 : h.combo >= this.maxCombo() ? 190 : 95;
      hurtMonster(this, a, power, "slash", knock, spin ? null : [fx, fy]);
      if (a.def === "dummy" && !spin && h.combo >= this.maxCombo() && this.s.quests.wardstone === "dummy") this.s.flags.dummyDone = true;
    }
    for (const p of this.map.props) {
      if (!p.id || this.removed.has(p.id)) continue;
      const def = PROPS[p.kind];
      if (!def?.cut && !def?.breaks) continue;
      const px = p.x * TILE, py = p.y * TILE - 6;
      if (!inArc(px, py, 10)) continue;
      this.cutProp(p);
    }
  }

  private cutProp(p: PropPlacement) {
    const def = PROPS[p.kind];
    this.removed.add(p.id!);
    this.col.remove(p.id!);
    const x = p.x * TILE, y = p.y * TILE;
    this.emit({ t: "cut", x, y, prop: p.kind });
    this.sfx(def.breaks ? "potBreak" : p.kind === "bush" ? "cutBush" : "cutGrass", x, y);
    if (p.kind === "grass" || p.kind === "reeds") this.s.stats.grass++;
    const r = this.rng;
    if (p.kind === "grass" || p.kind === "reeds") {
      if ("feverroot" in this.s.quests && r.chance(0.35)) this.dropItem("feverroot", x, y);
      else if (r.chance(0.18)) this.dropGold(r.int(1, 3), x, y);
      else if (r.chance(0.04)) this.dropItem("herb", x, y);
    } else if (p.kind === "bush") {
      if ("feverroot" in this.s.quests && r.chance(0.35)) this.dropItem("feverroot", x, y);
      else if (r.chance(0.25)) this.dropGold(r.int(2, 4), x, y);
      else if (r.chance(0.05)) this.dropItem("herb", x, y);
    } else {
      if (r.chance(0.45)) this.dropGold(r.int(2, 6), x, y);
      else if (r.chance(0.08)) this.dropItem("herb", x, y);
    }
  }

  // ─── Spells ─────────────────────────────────────────────────────────────────────────────────
  cycleSpell() {
    if (!this.s.spells.length) return;
    const i = this.s.spell ? this.s.spells.indexOf(this.s.spell) : -1;
    this.s.spell = this.s.spells[(i + 1) % this.s.spells.length];
    this.sfx("ui.move");
    this.notice(SPELLS[this.s.spell].name, "info");
  }
  selectSpell(id: SpellId) { if (this.s.spells.includes(id)) this.s.spell = id; }

  private startCast() {
    const h = this.hero;
    const id = this.s.spell;
    if (!id) { this.notice("No spell learned yet", "warning"); this.sfx("ui.deny"); return; }
    const spell = SPELLS[id];
    if (this.s.mp < spell.mp) { this.notice("Not enough MP", "warning"); this.sfx("ui.deny"); return; }
    this.s.mp -= spell.mp;
    if (this.aim) h.facing = facingFrom(this.aim[0], this.aim[1], h.facing);
    h.state = "cast"; h.t = 0; h.castSpell = id; h.castDone = false; h.combo = 0; h.queued = false; h.charge = 0;
    this.emit({ t: "cast", spell: id, x: h.x, y: h.y });
    this.sfx(id === "emberBolt" ? "cast.ember" : id === "frostRing" ? "cast.frost" : "cast.thorn", h.x, h.y);
  }

  private releaseSpell() {
    const h = this.hero;
    const id = h.castSpell;
    if (!id) return;
    const spell = SPELLS[id];
    const st = this.stats();
    const matk = Math.round(st.atk * 0.8 + this.s.level * 2);
    const [fx, fy] = DIRS[h.facing];
    const ox = h.x + fx * 10, oy = h.y - 12 + fy * 8;
    if (spell.kind === "bolt") this.addProjectile("emberBolt", ox, oy, fx * 270, fy * 270, 6, 0.9, false, spell.power, matk, st.spd, false);
    else if (spell.kind === "spread") {
      const base = Math.atan2(fy, fx);
      for (const off of [-0.32, 0, 0.32]) this.addProjectile("thorn", ox, oy, Math.cos(base + off) * 250, Math.sin(base + off) * 250, 6, 0.8, false, spell.power, matk, st.spd, true);
    } else {
      const p = this.addProjectile("frostRing", h.x, h.y - 8, 0, 0, 8, 0.4, false, spell.power, matk, st.spd, true);
      p.grow = 170; p.slow = 3;
    }
  }

  addProjectile(kind: Projectile["kind"], x: number, y: number, vx: number, vy: number, r: number, life: number, hostile: boolean, power: number, atk: number, spd: number, pierce: boolean): Projectile {
    const p: Projectile = { id: this.nextId++, kind, x, y, vx, vy, r, age: 0, life, hostile, power, atk, spd, pierce, hit: new Set(), grow: 0, slow: 0, level: this.col.heightAt(x, y + 8), delay: 0, tick: 0 };
    this.projectiles.push(p);
    return p;
  }

  private stepProjectiles(dt: number) {
    const h = this.hero;
    for (const p of this.projectiles) {
      p.age += dt;
      if (p.age < p.delay) continue;
      p.x += p.vx * dt; p.y += p.vy * dt;
      if (p.grow) p.r += p.grow * dt;
      const moving = Math.abs(p.vx) + Math.abs(p.vy) > 0;
      if (moving && p.kind !== "thornLine") {
        const t = this.col.tileAt(p.x, p.y + 8);
        if (this.col.tileBlocked(t.x, t.y, p.level, true) || this.col.pointSolid(p.x, p.y + 6)) {
          if (!(this.map.ground[t.y]?.[t.x] === "W")) { p.life = 0; this.emit({ t: "impact", x: p.x, y: p.y, kind: p.kind }); continue; }
        }
      }
      if (p.hostile) {
        if (p.hit.has(0) || h.state === "dead") continue;
        const cloud = p.kind === "spore";
        p.tick = Math.max(0, p.tick - dt);
        if (cloud && p.tick > 0) continue;
        if (Math.hypot(h.x - p.x, h.y - 8 - p.y) <= p.r + HERO_R) {
          if (this.hurtHero(p.power, p.atk, p.spd, p.x, p.y, "magic")) {
            if (p.kind === "web") h.slowT = Math.max(h.slowT, 2);
            if (cloud) p.tick = 0.6;
            else if (!p.pierce) { p.life = 0; this.emit({ t: "impact", x: p.x, y: p.y, kind: p.kind }); }
            else p.hit.add(0);
          } else if (cloud) p.tick = 0.3;
        }
      } else {
        for (const a of this.actors) {
          if (a.kind !== "monster" || a.dead || p.hit.has(a.id)) continue;
          if (Math.hypot(a.x - p.x, a.y - 8 - a.z - p.y) > p.r + a.radius) continue;
          p.hit.add(a.id);
          hurtMonster(this, a, p.power, "magic", 110, moving ? [p.vx / Math.hypot(p.vx, p.vy), p.vy / Math.hypot(p.vx, p.vy)] : null, p.atk);
          if (p.slow) a.slowT = Math.max(a.slowT, p.slow);
          this.emit({ t: "impact", x: p.x, y: p.y, kind: p.kind });
          if (!p.pierce) { p.life = 0; break; }
        }
      }
    }
    this.projectiles = this.projectiles.filter(p => p.age < p.life);
  }

  /** Returns true if the hit landed (not dodged, not missed, not invulnerable). */
  hurtHero(power: number, atk: number, spd: number, fromX: number, fromY: number, kind: "contact" | "magic" | "slash"): boolean {
    const h = this.hero;
    if (h.invuln > 0 || h.state === "dead" || this.modal.kind !== "none") return false;
    const st = this.stats();
    if (kind !== "magic") {
      const miss = clamp(0.04 + 0.1 * (st.spd - spd) / Math.max(1, spd), 0, 0.45);
      if (this.rng.chance(miss)) { this.emit({ t: "miss", x: h.x, y: h.y - 30, target: "hero" }); this.sfx("miss", h.x, h.y); h.invuln = 0.25; return false; }
    }
    let dmg = damage(power, atk, st.def, this.rng);
    if (this.buffs.stoneskin) dmg = Math.max(1, Math.round(dmg * 0.5));
    this.s.hp = Math.max(0, this.s.hp - dmg);
    this.emit({ t: "hit", x: h.x, y: h.y - 30, amount: dmg, crit: false, target: "hero", kind });
    this.sfx("hitHero", h.x, h.y);
    this.emit({ t: "shake", strength: 2, ms: 120 });
    const dx = h.x - fromX, dy = h.y - fromY, d = Math.hypot(dx, dy) || 1;
    h.kx = dx / d * 150; h.ky = dy / d * 150;
    h.flash = 0.12;
    if (this.s.hp <= 0) {
      h.state = "dead"; h.t = 0; h.deadT = 0; h.invuln = 99;
      this.s.stats.deaths++;
      this.emit({ t: "die", x: h.x, y: h.y, sprite: "hero", big: true });
      this.sfx("sting.gameOver");
      this.emit({ t: "music", id: "none" });
      return true;
    }
    if (h.state !== "cast" && h.state !== "spin") { h.state = "hurt"; h.t = 0; h.combo = 0; h.queued = false; h.charge = 0; }
    h.invuln = HURT.invuln;
    return true;
  }

  // ─── Actors ─────────────────────────────────────────────────────────────────────────────────
  private stepActor(a: Actor, dt: number) {
    a.px = a.x; a.py = a.y;
    a.t += dt; a.animTime += dt;
    a.flash = Math.max(0, a.flash - dt);
    a.invuln = Math.max(0, a.invuln - dt);
    a.contactCd = Math.max(0, a.contactCd - dt);
    a.slowT = Math.max(0, a.slowT - dt);
    if (a.dead) { a.removeT -= dt; a.alpha = Math.max(0, a.removeT / 0.6); return; }
    if (Math.abs(a.kx) + Math.abs(a.ky) > 1) {
      this.col.move(a, a.radius, a.kx * dt, a.ky * dt, a.mdef?.behaviour === "swooper");
      const d = Math.exp(-9 * dt); a.kx *= d; a.ky *= d;
    } else { a.kx = 0; a.ky = 0; }
    if (a.kind === "monster") { updateMonster(this, a, dt); return; }
    this.stepNpc(a, dt);
  }

  private stepNpc(a: Actor, dt: number) {
    const h = this.hero;
    const near = Math.hypot(h.x - a.x, h.y - a.y);
    if (a.kind === "follower" && (a.following || this.s.quests.lostLamb === "lead")) {
      a.following = true;
      this.s.flags.lambFollowing = true;
      const dx = h.x - a.x, dy = h.y - a.y, d = Math.hypot(dx, dy);
      if (d > 30) {
        const sp = Math.min(WALK * 1.05, d * 3);
        this.col.move(a, a.radius, dx / d * sp * dt, dy / d * sp * dt);
        a.facing = facingFrom(dx, dy, a.facing); a.anim = "walk";
      } else a.anim = "idle";
      if (d > 220) { a.x = h.x - 12; a.y = h.y + 6; }
      // Home: the pen by Lottie in Larkmoor.
      if (this.map.id === "larkmoor" && this.s.quests.lostLamb === "lead") {
        const lottie = this.actors.find(o => o.def === "lottie");
        if (lottie && Math.hypot(lottie.x - a.x, lottie.y - a.y) < 110) {
          this.s.flags.lambHome = true; this.s.flags.lambFollowing = false; a.following = false; a.kind = "npc"; a.homeX = a.x; a.homeY = a.y; a.wander = 1.2;
          this.sfx("questDone");
        }
      }
      return;
    }
    if (near < 44) { a.anim = "idle"; return; }
    if (a.wander > 0) {
      if (a.state === "idle" && a.t > a.ai.wait) {
        const ang = this.rng.range(0, Math.PI * 2), d = this.rng.range(0.3, 1) * a.wander * TILE;
        a.gx = a.homeX + Math.cos(ang) * d; a.gy = a.homeY + Math.sin(ang) * d;
        a.state = "wander"; a.t = 0;
      } else if (a.state === "wander") {
        const dx = a.gx - a.x, dy = a.gy - a.y, d = Math.hypot(dx, dy);
        if (d < 3 || a.t > 3) { a.state = "idle"; a.t = 0; a.ai.wait = this.rng.range(1.5, 4); a.anim = "idle"; }
        else { this.col.move(a, a.radius, dx / d * a.speed * dt, dy / d * a.speed * dt); a.facing = facingFrom(dx, dy, a.facing); a.anim = "walk"; }
      }
      a.ai.wait ??= this.rng.range(0.5, 3);
    }
  }

  private separate() {
    const list = this.actors.filter(a => !a.dead && a.kind === "monster");
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      const a = list[i], b = list[j];
      const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy), min = a.radius + b.radius - 2;
      if (d >= min || d < 1e-6) continue;
      const push = (min - d) / 2, ux = dx / d, uy = dy / d;
      const fa = a.mdef?.weight ?? 1, fb = b.mdef?.weight ?? 1;
      const wa = fa / Math.max(0.01, fa + fb), wb = fb / Math.max(0.01, fa + fb);
      this.col.move(a, a.radius, -ux * push * 2 * wa, -uy * push * 2 * wa, a.mdef?.behaviour === "swooper");
      this.col.move(b, b.radius, ux * push * 2 * wb, uy * push * 2 * wb, b.mdef?.behaviour === "swooper");
    }
    // Monsters don't stand inside the hero.
    const h = this.hero;
    for (const a of list) {
      if (a.mdef?.behaviour === "swooper") continue;
      const dx = a.x - h.x, dy = a.y - h.y, d = Math.hypot(dx, dy), min = a.radius + HERO_R - 3;
      if (d < min && d > 1e-6) {
        const share = Math.max(0, Math.min(1, a.mdef?.weight ?? 1));
        const push = min - d, ux = dx / d, uy = dy / d;
        if (share > 0) this.col.move(a, a.radius, ux * push * share, uy * push * share);
        if (share < 1) this.col.move(h, HERO_R, -ux * push * (1 - share), -uy * push * (1 - share));
      }
    }
  }

  onMonsterKilled(a: Actor) {
    const def = a.mdef!;
    this.s.stats.kills++;
    this.emit({ t: "die", x: a.x, y: a.y, sprite: a.sprite, big: !!def.boss || a.radius > 14 });
    this.sfx(def.boss || a.radius > 14 ? "die.big" : "die.small", a.x, a.y);
    if (def.behaviour !== "dummy") this.gainXp(def.xp);
    for (const [q, step] of Object.entries(this.s.quests)) {
      const g = QUESTS[q]?.steps.find(s => s.id === step)?.goal;
      if (g?.kind === "kill" && g.monster === a.def) this.s.progress[`${q}:${step}`] = (this.s.progress[`${q}:${step}`] ?? 0) + 1;
    }
    const r = this.rng;
    if (r.chance(def.drops.gold)) this.dropGold(r.int(def.gold[0], def.gold[1]), a.x, a.y);
    if (r.chance(def.drops.consumable)) {
      const c = r.weighted(Object.values(CONSUMABLES), c => c.dropWeight);
      if (c) this.dropItem(c.id, a.x, a.y);
    }
    if (r.chance(def.drops.gear)) {
      const pool = Object.values(GEAR).filter(g => g.dropLevels && def.level >= g.dropLevels[0] && def.level <= g.dropLevels[1]);
      if (pool.length) this.dropItem(r.pick(pool).id, a.x, a.y);
    }
    if (a.once && a.spawnId) {
      const left = this.actors.some(o => o !== a && !o.dead && o.spawnId === a.spawnId);
      if (!left) {
        this.s.flags[`cleared:${a.spawnId}`] = true;
        const flag = SPAWN_FLAGS[a.spawnId];
        if (flag) { this.s.flags[flag] = true; this.sfx("gateOpen"); }
      }
    }
    if (def.boss) this.bossDefeated(a);
  }

  private bossDefeated(a: Actor) {
    this.s.flags.bossDown = true;
    // Her brood and her attacks die with her: a won fight cannot be lost afterwards.
    for (const o of this.actors) if (o !== a && o.kind === "monster" && !o.dead) {
      o.dead = true; o.removeT = 0.6; o.anim = "dead"; o.animTime = 0; o.state = "dead"; o.hp = 0;
      this.emit({ t: "die", x: o.x, y: o.y, sprite: o.sprite, big: false });
    }
    this.projectiles = this.projectiles.filter(p => !p.hostile);
    this.emit({ t: "shake", strength: 5, ms: 700 });
    this.emit({ t: "music", id: "none" });
    this.sfx("sting.victory");
    this.needSave = "story";
    const lightStone = () => {
      if (this.s.flags.wardstoneLit) return;
      this.s.flags.wardstoneLit = true;
      this.needSave = "story";
    };
    this.scripted.push({ at: this.time + 1.6, map: this.map.id, fallback: lightStone, run: () => {
      lightStone();
      this.emit({ t: "shake", strength: 3, ms: 500 });
      this.sfx("gateOpen");
      this.emit({ t: "music", id: "dungeon" });
    } });
    // Leaving before the figure speaks: it waits by the stone (the map places it once the stone is lit).
    this.scripted.push({ at: this.time + 3.2, map: this.map.id, fallback: lightStone, run: () => {
      if (this.s.flags.sawHooded || !NPCS.hooded) return;
      const stone = this.map.props.find(p => p.kind === "wardstone");
      const x = stone ? stone.x * TILE + 34 : a.x + 40, y = stone ? stone.y * TILE + 18 : a.y;
      // The map may already place the figure (it shows once the stone is lit); never make two.
      const hooded = this.actors.find(o => o.def === "hooded" && !o.dead) ?? this.addNpc(NPCS.hooded, x, y, "left", 0);
      const rule = NPCS.hooded.talk.find(t => this.cond(t.when));
      if (rule) this.startDialog(rule.dialog, "hooded", () => {
        this.s.flags.sawHooded = true;
        hooded.dead = true; hooded.removeT = 0.8;
        this.emit({ t: "die", x: hooded.x, y: hooded.y, sprite: hooded.sprite, big: false });
        this.needSave = "story";
      });
      else this.s.flags.sawHooded = true;
    } });
  }

  // ─── Loot ───────────────────────────────────────────────────────────────────────────────────
  dropGold(amount: number, x: number, y: number) {
    let total = Math.max(1, Math.round(amount * this.goldFind()));
    const coins: number[] = [];
    while (total > 0 && coins.length < 6) {
      const v = total >= 25 ? 10 : total >= 8 ? 5 : 1;
      coins.push(v); total -= v;
    }
    if (total > 0) coins[coins.length - 1] += total;
    for (const v of coins) this.addPickup("coin", x, y, v);
  }
  dropItem(item: string, x: number, y: number) { this.addPickup("item", x, y, 1, item); }
  private addPickup(kind: Pickup["kind"], x: number, y: number, value: number, item?: string) {
    const ang = this.rng.range(0, Math.PI * 2), sp = this.rng.range(20, 60);
    this.pickups.push({ id: this.nextId++, kind, item, value, x, y, z: 6, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp * 0.6, vz: this.rng.range(70, 110), age: 0 });
  }

  private stepPickups(dt: number) {
    const h = this.hero;
    for (const p of this.pickups) {
      p.age += dt;
      if (p.z > 0 || p.vz > 0) {
        p.vz -= 320 * dt; p.z += p.vz * dt;
        if (p.z <= 0) { p.z = 0; p.vz = Math.abs(p.vz) > 40 ? -p.vz * 0.35 : 0; }
        const body = { x: p.x, y: p.y, level: h.level };
        this.col.move(body, 3, p.vx * dt, p.vy * dt);
        p.x = body.x; p.y = body.y;
        p.vx *= Math.exp(-3 * dt); p.vy *= Math.exp(-3 * dt);
      }
      if (p.age < 0.35 || h.state === "dead") continue;
      // A refused pickup waits until the hero walks away and comes back with room in the bag.
      if (p.refused) {
        const far = Math.hypot(h.x - p.x, h.y - 6 - p.y) > 48;
        const room = !!p.item && CONSUMABLES[p.item] ? (this.s.bag[p.item] ?? 0) < CONSUMABLES[p.item].carry : true;
        if (far && room) p.refused = false;
        continue;
      }
      const dx = h.x - p.x, dy = h.y - 6 - p.y, d = Math.hypot(dx, dy);
      if (d < 40) { const sp = 200 * dt; p.x += dx / Math.max(d, 1) * Math.min(sp, d); p.y += dy / Math.max(d, 1) * Math.min(sp, d); }
      if (d < 11) this.collect(p);
    }
    this.pickups = this.pickups.filter(p => p.value > 0 && p.age < 45);
  }

  private collect(p: Pickup) {
    if (p.kind === "coin") {
      const value = p.value;
      this.s.gold += value; p.value = 0;
      this.emit({ t: "pickup", x: p.x, y: p.y, kind: "coin", amount: value });
      this.sfx("coin", p.x, p.y);
      return;
    }
    const id = p.item!;
    if (!this.addItem(id, 1, false)) {
      if (!p.refused) { const c = CONSUMABLES[id]; this.notice(`Can't carry more ${c?.name ?? id}`, "warning"); this.sfx("ui.deny"); }
      p.refused = true;
      return;
    }
    p.value = 0;
    { const c = CONSUMABLES[id]; const k = KEY_ITEMS[id]; const g = GEAR[id]; this.notice(`Got ${g?.name ?? c?.name ?? k?.name ?? id}`, "item"); }
    this.emit({ t: "pickup", x: p.x, y: p.y, kind: "item", amount: 1, item: id });
    this.sfx("pickup", p.x, p.y);
  }

  /** Adds an item; consumables respect the carry cap. Returns false when the bag is full. */
  addItem(id: string, n = 1, announce = true, force = false): boolean {
    if (GEAR[id]) {
      for (let i = 0; i < n; i++) this.s.gear.push(id);
      const g = GEAR[id];
      if (!this.s.equipped[g.slot] && g.slot !== "charm") this.equip(id, false);
      if (announce) this.notice(`Got ${g.name}`, "item");
      return true;
    }
    const c = CONSUMABLES[id];
    if (c) {
      const have = this.s.bag[id] ?? 0;
      if (have >= c.carry && !force) { if (announce) this.notice(`Can't carry more ${c.name}`, "warning"); return false; }
      this.s.bag[id] = force ? have + n : Math.min(c.carry, have + n);
      if (announce) this.notice(`Got ${c.name}${n > 1 ? ` ×${n}` : ""}`, "item");
      return true;
    }
    const k = KEY_ITEMS[id];
    this.s.bag[id] = (this.s.bag[id] ?? 0) + n;
    if (announce) this.notice(`Got ${k?.name ?? id}${n > 1 ? ` ×${n}` : ""}`, "item");
    return true;
  }

  // ─── Interaction ────────────────────────────────────────────────────────────────────────────
  interactable(): Interactable | null {
    const h = this.hero;
    if (h.state !== "free" && h.state !== "charge") return null;
    const [fx, fy] = DIRS[h.facing];
    const front = { x: h.x + fx * 14, y: h.y + fy * 12 - 4 };
    let best: Interactable | null = null, bestD = Infinity;
    const facingOk = (x: number, y: number) => {
      const dx = x - h.x, dy = y - h.y, d = Math.hypot(dx, dy);
      return d < 10 || (dx * fx + dy * fy) / d > 0.35;
    };
    for (const a of this.actors) {
      if (a.dead || (a.kind !== "npc" && a.kind !== "follower") || !a.npc || a.following) continue;
      const d = Math.hypot(a.x - h.x, a.y - h.y);
      const reach = this.counterBetween(h, a) ? REACH.talk + 24 : REACH.talk;
      if (d < reach && facingOk(a.x, a.y) && d < bestD) { best = { kind: "npc", label: "Talk", x: a.x, y: a.y - 40, id: a.def, actor: a }; bestD = d; }
    }
    for (const e of this.map.entities) {
      if (e.type !== "chest" || this.s.chests.includes(e.id)) continue;
      const x = e.x * TILE, y = e.y * TILE;
      const d = Math.hypot(x - front.x, y - 6 - front.y);
      if (d < REACH.use && facingOk(x, y) && d < bestD) { best = { kind: "chest", label: "Open", x, y: y - 28, id: e.id }; bestD = d; }
    }
    for (const p of this.map.props) {
      const def = PROPS[p.kind];
      if (!def?.interact || !p.id) continue;
      const x = p.x * TILE, y = p.y * TILE;
      const d = Math.hypot(x - front.x, y - 8 - front.y);
      if (d < REACH.use + 6 && facingOk(x, y) && d < bestD) {
        const label = def.interact === "read" ? "Read" : def.interact === "lever" ? (this.s.flags[p.id] ? "Lever" : "Pull") : "Look";
        best = { kind: def.interact === "read" ? "sign" : def.interact === "lever" ? "lever" : "inspect", label, x, y: y - def.h, id: p.id, prop: p };
        bestD = d;
      }
    }
    return best;
  }

  /** A counter prop between the hero and an NPC lets them talk across it. */
  private counterBetween(h: { x: number; y: number }, a: { x: number; y: number }) {
    return this.map.props.some(p => p.kind === "counter" && Math.abs(p.x * TILE - (h.x + a.x) / 2) < 70 && Math.abs(p.y * TILE - (h.y + a.y) / 2) < 30);
  }

  interact(t: Interactable) {
    const h = this.hero;
    h.state = "free"; h.charge = 0;
    if (t.kind === "npc" && t.actor && t.actor.npc) {
      const a = t.actor;
      a.facing = facingFrom(h.x - a.x, h.y - a.y, a.facing);
      h.facing = facingFrom(a.x - h.x, a.y - h.y, h.facing);
      const rule = a.npc!.talk.find(r => this.cond(r.when));
      if (!rule) return;
      this.startDialog(rule.dialog, a.def);
      return;
    }
    if (t.kind === "chest") { this.openChest(t.id); return; }
    if (t.kind === "sign") {
      if (t.id === "bountyBoard") { this.bountyBoard(); return; }
      if (DIALOG[`sign.${t.id}`]) this.startDialog(`sign.${t.id}`, null);
      else this.inlineDialog([{ speaker: "Sign", text: signFallback(this.map, t.prop!) }]);
      return;
    }
    if (t.kind === "lever") {
      const id = t.id;
      if (this.s.flags[id]) { this.inlineDialog([{ speaker: "", text: "The lever is already down." }]); return; }
      this.s.flags[id] = true;
      this.sfx("lever", t.x, t.y);
      this.emit({ t: "shake", strength: 2, ms: 250 });
      this.notice("Something opened nearby", "info");
      return;
    }
    if (DIALOG[`inspect.${t.id}`]) this.startDialog(`inspect.${t.id}`, null);
    else this.inlineDialog([{ speaker: "", text: this.s.night ? "The water glows faintly under the moon." : "Still water, deep and cold." }]);
  }

  openChest(id: string) {
    const e = this.map.entities.find(x => x.type === "chest" && x.id === id) as Extract<EntityPlacement, { type: "chest" }> | undefined;
    if (!e || this.s.chests.includes(id)) return;
    this.s.chests.push(id);
    const h = this.hero;
    h.state = "raise"; h.t = 0; h.facing = facingFrom(e.x * TILE - h.x, e.y * TILE - h.y, h.facing);
    let item: string | null = null, gold = 0;
    if (e.loot.kind === "gold") { gold = e.loot.amount; this.s.gold += gold; this.notice(`Found ${gold} gold`, "gold"); }
    else { item = e.loot.item; this.addItem(item, e.loot.count ?? 1, true, true); }
    h.raiseItem = item ?? "gold";
    const flag = CHEST_FLAGS[id];
    if (flag) this.s.flags[flag] = true;
    this.emit({ t: "chest", x: e.x * TILE, y: e.y * TILE, item, gold });
    this.sfx("chestOpen", e.x * TILE, e.y * TILE);
    this.sfx("sting.item");
  }

  private bountyBoard() {
    const active = Object.keys(this.s.quests).find(q => QUESTS[q] && QUESTS[q].kind !== "main");
    const bounties = Object.values(QUESTS).filter(q => q.kind === "bounty" && !this.s.done.includes(q.id));
    if (active) {
      const q = QUESTS[active];
      this.inlineDialog([{ speaker: "Bounty Board", text: `You already have a task: ${q.title}. Finish it first.` }]);
      return;
    }
    const next = bounties.find(q => !(q.id in this.s.quests));
    if (!next) { this.inlineDialog([{ speaker: "Bounty Board", text: "No bounties posted. Check back later." }]); return; }
    if (next.minLevel && this.s.level < next.minLevel) {
      this.inlineDialog([{ speaker: "Bounty Board", text: `${next.title}. Too dangerous for now: come back at level ${next.minLevel}.` }]);
      return;
    }
    this.inlineDialog([{ speaker: "Bounty Board", text: `${next.title}: ${next.summary}` }], [
      { label: "Take it", effects: [{ t: "startQuest", quest: next.id }] },
      { label: "Not now" },
    ]);
  }

  // ─── Dialog ─────────────────────────────────────────────────────────────────────────────────
  startDialog(id: string, npc: string | null, onClose?: () => void) {
    const d = DIALOG[id];
    if (!d) return;
    const portrait = npc ? NPCS[npc]?.portrait : undefined;
    this.dialog = {
      id, npc, lines: d.lines.map(l => ({ ...l, speaker: fillHero(l.speaker, this.s.heroName), text: fillHero(l.text, this.s.heroName), portrait: l.portrait ?? (l.speaker && npc && NPCS[npc]?.name === l.speaker ? portrait : undefined) })),
      index: 0, choices: d.choices ?? null, choice: 0, effects: d.effects ?? [], effectsApplied: false, onClose,
    };
    this.openModal({ kind: "dialog" });
    this.sfx("text.blip");
  }

  inlineDialog(lines: DialogRuntime["lines"], choices?: DialogRuntime["choices"], effects: Effect[] = []) {
    lines = lines.map(l => ({ ...l, speaker: fillHero(l.speaker, this.s.heroName), text: fillHero(l.text, this.s.heroName) }));
    this.dialog = { id: "_inline", npc: null, lines, index: 0, choices: choices ?? null, choice: 0, effects, effectsApplied: false };
    this.openModal({ kind: "dialog" });
  }

  dialogView() {
    const d = this.dialog;
    if (!d) return null;
    const line = d.lines[Math.min(d.index, d.lines.length - 1)];
    const atChoices = d.index >= d.lines.length - 1 && d.choices && d.choices.length > 0;
    return { speaker: line?.speaker ?? "", text: line?.text ?? "", portrait: line?.portrait, choices: atChoices ? d.choices!.map(c => c.label) : null, index: atChoices ? d.choice : d.index, total: d.lines.length };
  }

  /** Menu input while a sim modal is open. */
  menu(cmd: "up" | "down" | "left" | "right" | "ok" | "back" | "start") {
    const m = this.modal;
    if (m.kind === "dialog" && this.dialog) {
      const d = this.dialog;
      const atChoices = d.index >= d.lines.length - 1 && d.choices && d.choices.length > 0;
      if (atChoices && (cmd === "up" || cmd === "down")) {
        d.choice = (d.choice + (cmd === "down" ? 1 : d.choices!.length - 1)) % d.choices!.length;
        this.sfx("ui.move");
        return;
      }
      if (cmd !== "ok" && cmd !== "back" && cmd !== "start") return;
      if (d.index < d.lines.length - 1) { d.index++; this.sfx("text.blip"); return; }
      // Last line: effects, then choice.
      this.closeModal();
      const npc = d.npc;
      this.dialog = null;
      if (!d.effectsApplied) { d.effectsApplied = true; this.applyEffects(d.effects, npc); }
      if (atChoices) {
        const c = cmd === "back" ? d.choices![d.choices!.length - 1] : d.choices![d.choice];
        this.sfx(cmd === "back" ? "ui.back" : "ui.ok");
        const paid = c.effects ? this.applyEffects(c.effects, npc) : true;
        if (c.next && paid) { this.startDialog(c.next, npc, d.onClose); return; }
      }
      if (npc) this.onTalked(npc);
      d.onClose?.();
      return;
    }
    if (m.kind === "questCard" || m.kind === "unlock") {
      if (cmd === "ok" || cmd === "back" || cmd === "start") { this.sfx("ui.ok"); this.closeModal(); }
      return;
    }
    if (m.kind === "clear" && (cmd === "ok" || cmd === "start")) { this.closeModal(); }
  }

  // ─── Modals ─────────────────────────────────────────────────────────────────────────────────
  openModal(m: SimModal) {
    if (this.hero?.state === "dead" && ["pause", "items", "map", "status", "shop"].includes(m.kind)) return;
    if (this.modal.kind !== "none") {
      if (m.kind === "dead") { this.modal = m; return; }
      this.modalQueue.push(m); return;
    }
    this.modal = m;
    if (["items", "map", "status", "pause", "shop"].includes(m.kind)) this.sfx("ui.ok");
    this.hero.holdTime = -1;
  }
  closeModal() {
    this.modal = this.modalQueue.shift() ?? { kind: "none" };
    this.hero.holdTime = -1;
  }

  // ─── Effects ────────────────────────────────────────────────────────────────────────────────
  /** Applies effects in order; stops and returns false when a payment fails. */
  applyEffects(effects: Effect[], npc: string | null = null): boolean {
    for (const e of effects) if (this.applyEffect(e, npc) === false) return false;
    return true;
  }

  applyEffect(e: Effect, npc: string | null): boolean | void {
    switch (e.t) {
      case "flag": this.s.flags[e.flag] = e.value ?? true; break;
      case "give": this.addItem(e.item, e.count ?? 1, true, true); if (GEAR[e.item] || KEY_ITEMS[e.item]) { this.hero.state = "raise"; this.hero.t = 0; this.hero.raiseItem = e.item; this.sfx("sting.item"); } break;
      case "take": {
        const n = e.count ?? 1;
        if (GEAR[e.item]) { for (let i = 0; i < n; i++) { const k = this.s.gear.indexOf(e.item); if (k >= 0) this.s.gear.splice(k, 1); } }
        else { this.s.bag[e.item] = Math.max(0, (this.s.bag[e.item] ?? 0) - n); if (!this.s.bag[e.item]) delete this.s.bag[e.item]; }
        break;
      }
      case "gold":
        if (e.amount < 0 && this.s.gold < -e.amount) { this.notice("Not enough gold", "warning"); this.sfx("ui.deny"); return false; }
        this.s.gold += e.amount; if (e.amount > 0) this.notice(`+${e.amount} gold`, "gold"); this.sfx("coin");
        break;
      case "xp": this.gainXp(e.amount); break;
      case "startQuest": this.startQuest(e.quest, npc); break;
      case "advance": this.advance(e.quest, e.step); break;
      case "completeQuest": this.completeQuest(e.quest); break;
      case "teach": this.learnSpell(e.spell, true); break;
      case "shop": this.openModal({ kind: "shop", shop: e.shop }); break;
      case "rest": this.rest(); break;
      case "heal": { const st = this.stats(); this.s.hp = st.hp; this.s.mp = st.mp; this.emit({ t: "heal", x: this.hero.x, y: this.hero.y, hp: st.hp, mp: st.mp }); this.sfx("heal"); break; }
      case "dialog": this.startDialog(e.dialog, npc); break;
      case "open": this.s.flags[`gate:${e.gate}`] = true; break;
      case "shake": this.emit({ t: "shake", strength: e.strength, ms: 400 }); break;
      case "chapterClear":
        this.s.flags.chapterClear = true; this.s.chapterClear = true;
        this.sfx("sting.chapterClear");
        this.openModal({ kind: "clear" });
        this.needSave = "clear";
        break;
    }
  }

  rest() {
    const st = this.stats();
    this.s.hp = st.hp; this.s.mp = st.mp;
    this.s.night = !this.s.night;
    this.duskTarget = this.s.night ? 1 : 0;
    this.emit({ t: "rest" });
    this.sfx("rest");
    this.notice(this.s.night ? "You rest until nightfall" : "You rest until morning", "info");
    this.needSave = "rest";
    this.emit({ t: "music", id: this.musicFor() });
  }

  // ─── Progression ────────────────────────────────────────────────────────────────────────────
  gainXp(n: number) {
    if (this.s.level >= MAX_LEVEL) return;
    this.s.xp += Math.max(0, Math.round(n));
    while (this.s.level < MAX_LEVEL && this.s.xp >= XP_TO_NEXT(this.s.level)) {
      this.s.xp -= XP_TO_NEXT(this.s.level);
      this.s.level++;
      const st = this.stats();
      this.s.hp = st.hp; this.s.mp = st.mp;
      this.emit({ t: "levelUp", level: this.s.level });
      this.sfx("levelUp");
      this.sfx("sting.levelUp");
      this.notice(`Level ${this.s.level}!`, "quest");
      for (const k of SKILLS) if (k.level === this.s.level && k.id !== "combo2") {
        this.emit({ t: "unlock", skill: k.id });
        this.unlockQueue.push({ title: k.name, hint: k.hint });
      }
      for (const sp of Object.values(SPELLS)) if (sp.level === this.s.level) this.learnSpell(sp.id, false);
    }
    if (this.s.level >= MAX_LEVEL) this.s.xp = 0;
  }

  learnSpell(id: SpellId, fromQuest: boolean) {
    if (this.s.spells.includes(id)) return;
    this.s.spells.push(id);
    if (!this.s.spell) this.s.spell = id;
    const sp = SPELLS[id];
    this.emit({ t: "unlock", spell: id });
    this.unlockQueue.push({ title: `New magic: ${sp.name}`, hint: `${sp.desc} Costs ${sp.mp} MP.` });
    if (fromQuest) this.sfx("unlock");
  }

  // ─── Quests ─────────────────────────────────────────────────────────────────────────────────
  startQuest(id: string, npc: string | null = null): boolean {
    const q = QUESTS[id];
    if (!q || this.s.done.includes(id) || id in this.s.quests) return false;
    if (q.kind !== "main") {
      const other = Object.keys(this.s.quests).find(k => QUESTS[k] && QUESTS[k].kind !== "main");
      if (other) {
        this.notice(`Finish "${QUESTS[other].title}" first`, "warning");
        this.sfx("ui.deny");
        return false;
      }
    }
    this.s.quests[id] = q.steps[0].id;
    this.sfx("questStart");
    this.openModal({ kind: "questCard", card: this.card(q, "offer") });
    this.checkQuests();
    void npc;
    return true;
  }

  advance(id: string, step: string) {
    const q = QUESTS[id];
    if (!q || !(id in this.s.quests)) return;
    if (!q.steps.some(s => s.id === step)) return;
    this.s.quests[id] = step;
    const s = q.steps.find(x => x.id === step)!;
    this.notice(s.ticker, "quest");
    this.sfx("questStart");
  }

  completeQuest(id: string) {
    const q = QUESTS[id];
    if (!q || this.s.done.includes(id)) return;
    delete this.s.quests[id];
    for (const k of Object.keys(this.s.progress)) if (k.startsWith(`${id}:`)) delete this.s.progress[k];
    this.s.done.push(id);
    const rw = q.reward;
    if (rw.gold) this.s.gold += rw.gold;
    if (rw.xp) this.gainXp(rw.xp);
    for (const item of rw.items ?? []) this.addItem(item, 1, false, true);
    if (rw.spell) this.learnSpell(rw.spell, true);
    // Quest key items are handed over.
    for (const s of q.steps) if (s.goal.kind === "collect" && KEY_ITEMS[s.goal.item]) { delete this.s.bag[s.goal.item]; }
    this.sfx("questDone");
    if (q.kind !== "main" || id !== "wardstone") this.openModal({ kind: "questCard", card: this.card(q, "complete") });
  }

  card(q: QuestDef, mode: QuestCard["mode"]): QuestCard {
    const step = q.steps.find(s => s.id === this.s.quests[q.id]) ?? q.steps[0];
    return { quest: q.id, title: q.title, summary: q.summary, objective: step.ticker, reward: rewardText(q), hint: q.hint, mode };
  }

  /** Talk goals complete when a dialog with that NPC ends (unless the dialog already moved on). */
  onTalked(npc: string) {
    // The hooded figure speaks once, then is gone.
    if (npc === "hooded" && !this.s.flags.sawHooded) {
      this.s.flags.sawHooded = true;
      const f = this.actors.find(o => o.def === "hooded" && !o.dead);
      if (f) { f.dead = true; f.removeT = 0.8; this.emit({ t: "die", x: f.x, y: f.y, sprite: f.sprite, big: false }); }
      this.needSave = "story";
    }
    for (const [q, stepId] of Object.entries({ ...this.s.quests })) {
      const quest = QUESTS[q];
      const step = quest?.steps.find(s => s.id === stepId);
      if (step?.goal.kind === "talk" && step.goal.npc === npc && this.s.quests[q] === stepId) this.stepDone(q, stepId);
    }
    this.checkQuests();
  }

  checkQuests() {
    for (let guard = 0; guard < 8; guard++) {
      let changed = false;
      for (const [q, stepId] of Object.entries({ ...this.s.quests })) {
        const quest = QUESTS[q];
        const step = quest?.steps.find(s => s.id === stepId);
        if (!step) continue;
        const g = step.goal;
        let ok = false;
        if (g.kind === "flag") ok = !!this.s.flags[g.flag];
        else if (g.kind === "collect") ok = this.count(g.item) >= g.count;
        else if (g.kind === "kill") ok = (this.s.progress[`${q}:${stepId}`] ?? 0) >= g.count;
        else if (g.kind === "reach") ok = this.map.id === g.map && Math.hypot(this.hero.x - g.x * TILE, this.hero.y - g.y * TILE) <= (g.r ?? 2) * TILE;
        if (ok) { this.stepDone(q, stepId); changed = true; }
      }
      if (!changed) break;
    }
  }

  private stepDone(q: string, stepId: string) {
    const quest = QUESTS[q];
    const i = quest.steps.findIndex(s => s.id === stepId);
    const next = quest.steps[i + 1];
    if (next) {
      this.s.quests[q] = next.id;
      this.notice(next.ticker, "quest");
      this.sfx("questStart");
    } else this.completeQuest(q);
  }

  // ─── World checks ───────────────────────────────────────────────────────────────────────────
  private checkGates() {
    for (const e of this.map.entities) {
      if (e.type !== "gate" || this.gatesOpen.has(e.id)) continue;
      if (this.cond(e.open) || this.s.flags[`gate:${e.id}`]) {
        this.gatesOpen.add(e.id);
        this.col.remove(`gate:${e.id}`);
        if (e.kind === "iron" && e.id === "g_barrow") this.s.flags.barrowGateOpen = true;
        this.emit({ t: "gate", id: e.id, open: true });
        this.sfx("gateOpen", (e.x + e.w / 2) * TILE, (e.y + e.h / 2) * TILE);
      }
    }
  }

  private insideExit(): boolean {
    const h = this.hero;
    return this.map.entities.some(e => e.type === "exit" && inRect(h.x, h.y, e));
  }

  private checkExits() {
    const h = this.hero;
    if (h.state === "dead") return;
    if (!this.exitArmed) { if (!this.insideExit()) this.exitArmed = true; return; }
    for (const e of this.map.entities) {
      if (e.type !== "exit" || !inRect(h.x, h.y, e)) continue;
      if (e.to === "southfold" && this.map.id === "larkmoor" && !this.s.flags.gateOpen && !this.s.flags.metMaren) {
        // Cato keeps you in until the elder has spoken to you.
        this.moveHero(0, -12);
        this.inlineDialog([{ speaker: "Cato", text: "Not so fast. Elder Maren wants a word before anyone leaves town." }]);
        return;
      }
      this.sfx(e.kind === "door" ? "door" : e.kind === "stairs" ? "stairs" : "step.grass");
      const follow = this.s.flags.lambFollowing && !this.s.flags.lambHome;
      this.enterMap(e.to, e.at);
      if (follow) this.s.flags.lambFollowing = true;
      return;
    }
  }

  private checkTriggers() {
    const h = this.hero;
    for (const e of this.map.entities) {
      if (e.type !== "trigger") continue;
      const inside = inRect(h.x, h.y, e);
      const was = this.triggerInside.has(e.id);
      if (inside && !was) {
        this.triggerInside.add(e.id);
        if (e.once && this.s.flags[`trig:${e.id}`]) continue;
        if (!this.cond(e.when)) continue;
        if (e.once) this.s.flags[`trig:${e.id}`] = true;
        this.applyEffects(e.effects);
      } else if (!inside && was) this.triggerInside.delete(e.id);
    }
  }

  // ─── Host commands ──────────────────────────────────────────────────────────────────────────
  buy(shopId: string, item: string): string | null {
    const shop = SHOPS[shopId];
    if (!shop || !shop.stock.includes(item)) return "Not sold here";
    const unlock = SHOP_UNLOCKS[item];
    if (unlock && !this.cond(unlock)) return "Not in stock yet";
    const price = GEAR[item]?.price ?? CONSUMABLES[item]?.price ?? null;
    if (price == null) return "Not for sale";
    if (this.s.gold < price) { this.sfx("ui.deny"); return "Not enough gold"; }
    if (CONSUMABLES[item] && (this.s.bag[item] ?? 0) >= CONSUMABLES[item].carry) { this.sfx("ui.deny"); return "You can't carry more"; }
    this.s.gold -= price;
    this.addItem(item, 1, false);
    this.sfx("buy");
    return null;
  }

  sell(item: string): string | null {
    const price = GEAR[item]?.price ?? CONSUMABLES[item]?.price ?? null;
    if (price == null || KEY_ITEMS[item]) return "Can't sell that";
    if (GEAR[item]) {
      const k = this.s.gear.indexOf(item);
      if (k < 0) return "Unequip it first";
      this.s.gear.splice(k, 1);
    } else {
      if (!this.s.bag[item]) return "You have none";
      this.s.bag[item]--; if (!this.s.bag[item]) delete this.s.bag[item];
    }
    this.s.gold += Math.max(1, Math.floor(price / 4));
    this.sfx("coin");
    return null;
  }

  equip(item: string, sound = true): string | null {
    const g = GEAR[item];
    if (!g) return "Not gear";
    const k = this.s.gear.indexOf(item);
    if (k < 0) return this.s.equipped[g.slot] === item ? null : "You don't have it";
    this.s.gear.splice(k, 1);
    const prev = this.s.equipped[g.slot];
    if (prev) this.s.gear.push(prev);
    this.s.equipped[g.slot] = item;
    const st = this.stats();
    this.s.hp = Math.min(this.s.hp, st.hp); this.s.mp = Math.min(this.s.mp, st.mp);
    if (sound) this.sfx("equip");
    return null;
  }

  unequip(slot: Slot): string | null {
    const id = this.s.equipped[slot];
    if (!id) return "Nothing equipped";
    if (slot === "weapon") return "You need a weapon";
    this.s.equipped[slot] = null;
    this.s.gear.push(id);
    const st = this.stats();
    this.s.hp = Math.min(this.s.hp, st.hp); this.s.mp = Math.min(this.s.mp, st.mp);
    this.sfx("equip");
    return null;
  }

  use(item: string): string | null {
    const c = CONSUMABLES[item];
    if (!c) return "Can't use that";
    if (!this.s.bag[item]) return "You have none";
    const st = this.stats();
    const e = c.effect;
    if (e.kind === "heal" && this.s.hp >= st.hp) return "HP is full";
    if (e.kind === "mana" && this.s.mp >= st.mp) return "MP is full";
    if (e.kind === "full" && this.s.hp >= st.hp && this.s.mp >= st.mp) return "Already at full strength";
    this.s.bag[item]--; if (!this.s.bag[item]) delete this.s.bag[item];
    let hp = 0, mp = 0;
    if (e.kind === "heal") { hp = Math.min(e.hp, st.hp - this.s.hp); this.s.hp += hp; }
    if (e.kind === "mana") { mp = Math.min(e.mp, st.mp - this.s.mp); this.s.mp += mp; }
    if (e.kind === "full") { hp = st.hp - this.s.hp; mp = st.mp - this.s.mp; this.s.hp = st.hp; this.s.mp = st.mp; }
    if (e.kind === "buff") { this.buffs[e.buff] = e.seconds; this.notice(`${BUFF_NAMES[e.buff]} for ${e.seconds} s`, "info"); }
    this.emit({ t: "heal", x: this.hero.x, y: this.hero.y, hp, mp });
    this.sfx("heal");
    return null;
  }

  /** The durable save with the hero's current position. */
  durable(): SaveState {
    const out = structuredClone(this.s);
    out.x = Math.round(this.hero.x * 10) / 10; out.y = Math.round(this.hero.y * 10) / 10; out.facing = this.hero.facing; out.map = this.map.id;
    out.rng = this.rng.state;
    out.savedAt = new Date().toISOString();
    return out;
  }

  // ─── View ───────────────────────────────────────────────────────────────────────────────────
  worldView(alpha: number): WorldView {
    const h = this.hero;
    const lerp = (a: number, b: number) => a + (b - a) * alpha;
    const heroAnim = h.state === "free" ? (h.moving ? "walk" : "stand") : h.state === "charge" ? (h.moving ? "walk" : "stand") : h.state;
    const actors: ActorView[] = [];
    for (const a of this.actors) {
      const marker = a.npc ? this.markerFor(a) : undefined;
      actors.push({
        id: a.id, kind: a.kind, def: a.def, sprite: a.sprite, x: lerp(a.px, a.x), y: lerp(a.py, a.y), z: a.z, facing: a.facing,
        anim: a.dead ? "dead" : a.anim, animTime: a.animTime, flash: a.flash, elite: a.elite, radius: a.radius, alpha: a.alpha, marker,
        phase: a.mdef?.boss ? a.phase : undefined,
        talking: !!this.dialog && this.dialog.npc === a.def,
      });
    }
    const pickups: PickupView[] = this.pickups.map(p => ({ id: p.id, kind: p.kind, item: p.item, x: p.x, y: p.y, z: p.z, age: p.age }));
    const projectiles: ProjectileView[] = this.projectiles.map(p => ({ id: p.id, kind: p.kind, x: p.x, y: p.y, r: p.r, age: p.age - p.delay, hostile: p.hostile, angle: Math.atan2(p.vy, p.vx) }));
    const openChests = new Set(this.s.chests);
    return {
      mapId: this.map.id,
      hero: {
        x: lerp(h.px, h.x), y: lerp(h.py, h.y), facing: h.facing, anim: heroAnim as WorldView["hero"]["anim"], animTime: h.t,
        combo: h.combo, invulnerable: h.invuln > 0 && h.state !== "dodge", flash: h.flash, charge: h.state === "charge" ? h.charge : 0,
        raiseItem: h.state === "raise" ? h.raiseItem : null,
      },
      actors, pickups, projectiles, removedProps: this.removed, openChests, openGates: this.gatesOpen,
      night: this.s.night, dusk: this.dusk, time: this.time, flags: this.s.flags,
    };
  }

  markerFor(a: Actor): "!" | "?" | "..." | undefined {
    const npc = a.npc!;
    const rule = npc.talk.find(r => this.cond(r.when));
    if (rule?.marker) return rule.marker;
    // A talk goal pointing at this NPC shows "?".
    for (const [q, stepId] of Object.entries(this.s.quests)) {
      const step = QUESTS[q]?.steps.find(s => s.id === stepId);
      if (step?.goal.kind === "talk" && step.goal.npc === a.def) return "?";
    }
    if (Math.hypot(a.x - this.hero.x, a.y - this.hero.y) < 56) return "...";
    return undefined;
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────────────────────
export function clamp(v: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, v)); }

export function damage(power: number, atk: number, def: number, rng: Rng): number {
  return Math.max(1, Math.round(power * atk * atk / Math.max(1, atk + def) * rng.range(0.9, 1.1)));
}

export function facingFrom(dx: number, dy: number, prev: Dir4): Dir4 {
  const ax = Math.abs(dx), ay = Math.abs(dy);
  if (ax < 1e-6 && ay < 1e-6) return prev;
  // Hysteresis near the diagonals keeps the sprite from flickering.
  const horizontalPrev = prev === "left" || prev === "right";
  if (horizontalPrev ? ax >= ay * 0.8 : ax > ay * 1.25) return dx < 0 ? "left" : "right";
  return dy < 0 ? "up" : "down";
}

function inRect(x: number, y: number, e: { x: number; y: number; w: number; h: number }) {
  return x >= e.x * TILE && x <= (e.x + e.w) * TILE && y >= e.y * TILE && y <= (e.y + e.h) * TILE;
}

function surfaceOf(ch: string): Extract<SimEvent, { t: "step" }>["surface"] {
  if (ch === "c" || ch === "t") return "stone";
  if (ch === "f" || ch === "b") return "wood";
  if (ch === "d" || ch === "s" || ch === "m") return "dirt";
  if (ch === "w") return "water";
  if (ch === "k") return "cave";
  return "grass";
}

function rewardText(q: QuestDef): string {
  const parts: string[] = [];
  if (q.reward.gold) parts.push(`${q.reward.gold} gold`);
  if (q.reward.xp) parts.push(`${q.reward.xp} XP`);
  for (const i of q.reward.items ?? []) parts.push(GEAR[i]?.name ?? CONSUMABLES[i]?.name ?? KEY_ITEMS[i]?.name ?? i);
  if (q.reward.spell) parts.push(`Spell: ${SPELLS[q.reward.spell]?.name ?? q.reward.spell}`);
  return parts.join(" · ") || "Gratitude";
}

function signFallback(map: MapDef, p: PropPlacement): string {
  const exits = map.entities.filter(e => e.type === "exit" && e.kind === "edge") as Array<Extract<EntityPlacement, { type: "exit" }>>;
  let best: (typeof exits)[number] | null = null, bd = Infinity;
  for (const e of exits) { const d = Math.hypot(e.x + e.w / 2 - p.x, e.y + e.h / 2 - p.y); if (d < bd) { bd = d; best = e; } }
  if (!best) return `${map.name}.`;
  return `${MAPS[best.to]?.name ?? best.to} this way.`;
}
