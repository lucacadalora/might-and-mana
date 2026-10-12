import type {
  BuffId, CreateGameOptions, Device, Dir4, EngineEvent, GameCommand, GameHandle, HudSnapshot, InputFrame, MenuCommand, Modal,
  Phase, QuestCard, SaveState, Slot,
} from "./contract";
import { CONSUMABLES, GEAR } from "./content/items";
import { statsAt, XP_TO_NEXT } from "./content/levels";
import { SPELLS } from "./content/spells";

/**
 * Host-UI mock of the Game 05 engine (`/game-05?mock=1`). It renders a small animated placeholder
 * world at the real integer pixel scale, moves a hero with the real InputFrame (+y = down), and
 * produces realistic HudSnapshots so every HUD element, modal and phase can be built and tested
 * before the simulation lands. URL parameters:
 *   modal=dialog|choice|questOffer|questComplete|questInfo|shop|shopArms|status|items|map|pause|unlock|dead|clear
 *   boss=1  night=1  buffs=1  lowhp=1  device=keyboard|gamepad|touch  slow=1 (long loading)
 * The backquote key (or cycle()) steps through every modal kind in order.
 */
const DIALOG_LINES = [
  { speaker: "Grandpa Oren", text: "There you are. Sit, sit. My knee has been talking about rain all morning.", portrait: "portrait.oren" },
  { speaker: "Grandpa Oren", text: "The wardstone under the Barrow is cracking. I can feel it in the floorboards.", portrait: "portrait.oren" },
  { speaker: "Grandpa Oren", text: "Take my blade, Wren. It is old, but it remembers how to be brave.", portrait: "portrait.oren" },
];
const CHOICE_LINES = [
  { speaker: "Bram", text: "A bed by the hearth, clean sheets and no charge for family of Oren. Rest a while?", portrait: "portrait.bram" },
];
const CHOICES = ["Rest until nightfall", "Not now"];
const CARDS: Record<"offer" | "complete" | "info", QuestCard> = {
  offer: {
    quest: "feverroot", title: "Weedcutter", summary: "Tilda needs feverroot for her fever tonic. It grows wild in the long grass around the village.",
    objective: "Cut grass and gather 10 feverroot", reward: "60 gold · 2 Mana Draught", hint: "Swing at tall grass. Roots turn up about one tuft in three.", mode: "offer",
  },
  complete: {
    quest: "lostLamb", title: "The Lost Lamb", summary: "Lottie's lamb is safe in the pen again, and very pleased with itself.",
    objective: "Lead the lamb home", reward: "Lamb's Bell · 40 gold", mode: "complete",
  },
  info: {
    quest: "wardstone", title: "The First Wardstone", summary: "The wolves are gone from the grove. Somewhere past the flames lies the mouth of the Barrow.",
    objective: "Find the Barrow key", reward: "The village's thanks", mode: "info",
  },
};
const MODAL_CYCLE = ["dialog", "choice", "questOffer", "questComplete", "questInfo", "shop", "shopArms", "status", "items", "map", "pause", "unlock", "dead", "clear", "none"] as const;
type MockModalKey = (typeof MODAL_CYCLE)[number];

interface Slime { x: number; y: number; vx: number; vy: number; t: number; hop: number; hp: number; hurt: number }
type DialogState = { lines: typeof DIALOG_LINES; index: number; choices: string[] | null; choice: number; then?: Modal };

const TILE_PX = 32;
const WORLD_W = 48, WORLD_H = 36;

export function mockSave(name = "Wren"): SaveState {
  const level = 5;
  const stats = statsAt(level);
  return {
    v: 2, heroName: name, level, xp: 142, hp: Math.round(stats.hp * 0.72), mp: 11, gold: 1250,
    equipped: { head: "leatherCap2", body: "leatherVest1", boots: "clothShoes", weapon: "wornBlade", charm: null },
    gear: ["ironSword", "leatherBoots1", "clothTunic", "clothHood", "wolfFang"],
    bag: { herb: 4, tonic: 1, manaDraught: 2, stoneskin: 1, fury: 0, fortune: 1, quickstep: 0, elixir: 0, feverroot: 3, loaves: 1 },
    spells: ["emberBolt", "frostRing"], spell: "emberBolt",
    flags: { dressed: true, gotBlade: true, dummyDone: true, metMaren: true, gateOpen: true },
    quests: { wardstone: "grove", feverroot: "gather" }, done: [], progress: { "feverroot:gather": 3 }, chests: ["c_home_bed"],
    map: "southfold", x: 20 * TILE_PX, y: 16 * TILE_PX, facing: "down", night: false, visited: ["home", "larkmoor", "southfold"],
    playSeconds: 1735, stats: { kills: 37, deaths: 1, grass: 212, crits: 9 }, rng: 12345, savedAt: new Date().toISOString(), chapterClear: false,
  };
}

function hash(x: number, y: number): number {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export class MockGame implements GameHandle {
  readonly ready: Promise<void>;
  private readonly ctx: CanvasRenderingContext2D | null;
  private readonly buffer: HTMLCanvasElement;
  private readonly bctx: CanvasRenderingContext2D | null;
  private dead = false;
  private loaded = false;
  private progress = 0;
  private paused = false;
  private save_: SaveState | null = null;
  private modal: Modal = { kind: "none" };
  private dialog: DialogState | null = null;
  private events: EngineEvent[] = [];
  private notices: Array<{ id: number; text: string; kind: HudSnapshot["notices"][number]["kind"]; until: number }> = [];
  private noticeId = 0;
  private clock = 0;
  private device: Device = "keyboard";
  private size = { w: 1, h: 1, dpr: 1, k: 1, vw: 1, vh: 1 };
  private hero = { x: 20 * TILE_PX, y: 16 * TILE_PX, facing: "down" as Dir4, walk: 0, swing: 0, hold: 0, charge: 0, hurt: 0 };
  private cam = { x: 0, y: 0 };
  private slimes: Slime[] = [];
  private buffs: Array<{ id: BuffId; seconds: number }> = [];
  private boss: HudSnapshot["boss"] = null;
  private lastPhase: Phase = "loading";
  private cycleIndex = -1;
  private readonly npc = { x: 24 * TILE_PX, y: 13 * TILE_PX };
  private readonly target = { x: 44 * TILE_PX, y: 6 * TILE_PX };

  constructor(private readonly canvas: HTMLCanvasElement, private readonly options: CreateGameOptions, private readonly params: URLSearchParams) {
    this.ctx = canvas.getContext("2d");
    this.buffer = document.createElement("canvas");
    this.bctx = this.buffer.getContext("2d");
    const forced = params.get("device");
    if (forced === "keyboard" || forced === "gamepad" || forced === "touch") this.device = forced;
    for (let i = 0; i < 5; i++) {
      this.slimes.push({ x: (14 + i * 5) * TILE_PX, y: (20 + (i % 3) * 3) * TILE_PX, vx: 0, vy: 0, t: i * 0.7, hop: 0, hp: 3, hurt: 0 });
    }
    const slow = params.get("slow") === "1";
    this.ready = new Promise(resolve => {
      const started = performance.now();
      const total = slow ? 6000 : 450;
      const tick = () => {
        if (this.dead) return;
        this.progress = Math.min(0.99, (performance.now() - started) / total);
        if (this.progress >= 0.99) {
          this.loaded = true;
          this.progress = 1;
          if (options.save) this.start(options.save);
          this.emitPhase();
          resolve();
        } else setTimeout(tick, 50);
      };
      tick();
    });
  }

  // ─── GameHandle ─────────────────────────────────────────────────────────────────────────────
  frame(dtSeconds: number, input: InputFrame): void {
    if (this.dead || !this.loaded) return;
    const dt = Math.max(0, Math.min(0.1, Number.isFinite(dtSeconds) ? dtSeconds : 0));
    this.clock += dt;
    this.notices = this.notices.filter(n => n.until > this.clock);
    this.device = this.params.get("device") as Device || input.device || this.device;
    const s = this.save_;
    if (!s) { this.emitPhase(); return; }
    this.buffs = this.buffs.map(b => ({ ...b, seconds: b.seconds - dt })).filter(b => b.seconds > 0 || this.params.get("buffs") === "1");
    for (const slime of this.slimes) this.stepSlime(slime, dt);
    if (this.modal.kind !== "none" || this.paused) { this.emitPhase(); return; }
    s.playSeconds += dt;
    const h = this.hero;
    const speed = 92;
    const mx = Number.isFinite(input.moveX) ? input.moveX : 0, my = Number.isFinite(input.moveY) ? input.moveY : 0;
    if (Math.hypot(mx, my) > 0.1) {
      h.x = Math.max(16, Math.min(WORLD_W * TILE_PX - 16, h.x + mx * speed * dt));
      h.y = Math.max(24, Math.min(WORLD_H * TILE_PX - 8, h.y + my * speed * dt));
      h.facing = Math.abs(mx) > Math.abs(my) ? (mx < 0 ? "left" : "right") : (my < 0 ? "up" : "down");
      h.walk += dt;
      if (Math.floor(h.walk * 4) !== Math.floor((h.walk - dt) * 4)) this.sfx("step.grass", h.x, 0.5);
    } else h.walk = 0;
    h.swing = Math.max(0, h.swing - dt);
    h.hurt = Math.max(0, h.hurt - dt);
    const near = Math.hypot(h.x - this.npc.x, h.y - this.npc.y) < 56;
    if (input.pressed.attack) {
      if (near) { this.openDialog(DIALOG_LINES, null); return; }
      h.swing = 0.28;
      this.sfx(`swing${1 + Math.floor(Math.random() * 3)}`, h.x);
      for (const slime of this.slimes) {
        if (Math.hypot(slime.x - h.x, slime.y - h.y) < 44) {
          slime.hurt = 0.2; slime.hp -= 1;
          this.sfx("hit", slime.x);
          if (slime.hp <= 0) {
            slime.hp = 3; slime.x = (10 + Math.random() * 30) * TILE_PX; slime.y = (18 + Math.random() * 12) * TILE_PX;
            const coins = 3 + Math.floor(Math.random() * 6);
            s.gold += coins; s.xp += 6;
            this.notice(`+${coins} gold`, "gold");
            this.sfx("die.small", h.x);
            this.gainXp();
          }
        }
      }
    }
    if (input.held.attack) h.hold += dt; else {
      if (h.charge >= 1) { this.sfx("spin", h.x); h.swing = 0.4; }
      h.hold = 0;
    }
    h.charge = h.hold > 0.15 ? Math.min(1, (h.hold - 0.15) / 0.6) : 0;
    if (input.pressed.magic) {
      const spell = s.spell ? SPELLS[s.spell] : null;
      if (spell && s.mp >= spell.mp) { s.mp -= spell.mp; this.sfx(`cast.${spell.id === "emberBolt" ? "ember" : spell.id === "frostRing" ? "frost" : "thorn"}`, h.x); }
      else this.notice("Not enough MP", "warning");
    }
    if (input.pressed.dodge) this.sfx("dodge", h.x);
    if (input.pressed.nextSpell && s.spells.length) {
      const i = s.spell ? s.spells.indexOf(s.spell) : -1;
      s.spell = s.spells[(i + 1) % s.spells.length];
      this.sfx("ui.move");
    }
    if (input.pressed.pause) this.open({ kind: "pause" });
    else if (input.pressed.item) this.open({ kind: "items" });
    else if (input.pressed.map) this.open({ kind: "map" });
    else if (input.pressed.status) this.open({ kind: "status" });
    for (const slime of this.slimes) {
      if (h.hurt <= 0 && Math.hypot(slime.x - h.x, slime.y - h.y) < 16) {
        const max = statsAt(s.level).hp;
        s.hp = Math.max(1, s.hp - Math.max(1, Math.round(max * 0.08)));
        h.hurt = 0.8;
        this.sfx("hitHero", h.x);
        this.events.push({ type: "rumble", strong: 0.4, weak: 0.3, ms: 120 });
      }
    }
    // MP trickles back so the spell chip shows both states.
    if (Math.floor(this.clock / 2) !== Math.floor((this.clock - dt) / 2)) s.mp = Math.min(statsAt(s.level).mp, s.mp + 1);
    this.emitPhase();
  }

  render(): void {
    if (this.dead || !this.ctx || !this.bctx) return;
    const { k, vw, vh } = this.size;
    const b = this.bctx;
    if (this.buffer.width !== vw || this.buffer.height !== vh) { this.buffer.width = vw; this.buffer.height = vh; }
    const h = this.hero;
    const targetX = Math.max(0, Math.min(WORLD_W * TILE_PX - vw, h.x - vw / 2));
    const targetY = Math.max(0, Math.min(WORLD_H * TILE_PX - vh, h.y - 20 - vh / 2));
    this.cam.x += (targetX - this.cam.x) * 0.18;
    this.cam.y += (targetY - this.cam.y) * 0.18;
    const cx = Math.round(this.cam.x), cy = Math.round(this.cam.y);
    this.drawWorld(b, cx, cy, vw, vh);
    const ctx = this.ctx;
    ctx.imageSmoothingEnabled = false;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(this.buffer, 0, 0, vw, vh, 0, 0, vw * k, vh * k);
  }

  resize(cssWidth: number, cssHeight: number, pixelRatio: number): void {
    const dpr = Math.max(0.5, Math.min(4, Number.isFinite(pixelRatio) ? pixelRatio : 1));
    const w = Math.max(1, Math.round(cssWidth * dpr)), h = Math.max(1, Math.round(cssHeight * dpr));
    const k = Math.max(1, Math.floor(Math.min(w, h) / 360));
    this.size = { w: cssWidth, h: cssHeight, dpr, k, vw: Math.ceil(w / k), vh: Math.ceil(h / k) };
    if (this.canvas.width !== w) this.canvas.width = w;
    if (this.canvas.height !== h) this.canvas.height = h;
  }

  setPaused(paused: boolean): void {
    if (this.dead || !this.save_) return;
    this.paused = paused;
    if (paused && this.modal.kind === "none") this.open({ kind: "pause" });
    if (!paused && this.modal.kind === "pause") this.close();
    this.emitPhase();
  }

  snapshot(): HudSnapshot {
    const s = this.save_;
    const phase = this.phase();
    const notices = this.notices.map(({ id, text, kind }) => ({ id, text, kind }));
    if (!s) {
      return {
        phase, loading: this.progress, heroName: "", level: 1, xp: { value: 0, next: 1 }, hp: { value: 0, max: 1 }, mp: { value: 0, max: 1 },
        gold: 0, charge: 0, spell: null, buffs: [], ticker: { main: null, side: null }, arrow: null, prompt: null, modal: { kind: "none" },
        notices, mapName: "", night: false, device: this.device, boss: null,
      };
    }
    const stats = this.stats();
    const spell = s.spell ? SPELLS[s.spell] : null;
    const h = this.hero;
    const near = Math.hypot(h.x - this.npc.x, h.y - this.npc.y) < 56 && this.modal.kind === "none";
    const npcScreen = this.project(this.npc.x, this.npc.y - 44);
    const view = this.viewRect();
    const inView = this.target.x > view.x + 16 && this.target.x < view.x + view.w - 16 && this.target.y > view.y + 16 && this.target.y < view.y + view.h - 16;
    return {
      phase, loading: this.progress, heroName: s.heroName, level: s.level,
      xp: { value: s.xp, next: XP_TO_NEXT(s.level) },
      hp: { value: s.hp, max: stats.hp }, mp: { value: s.mp, max: stats.mp }, gold: s.gold,
      charge: h.charge,
      spell: spell ? { id: spell.id, name: spell.name, mp: spell.mp, icon: spell.icon, ready: s.mp >= spell.mp } : null,
      buffs: this.buffs.map(b => ({ id: b.id, seconds: Math.max(0, Math.ceil(b.seconds)) })),
      ticker: {
        main: s.quests.wardstone ? "Drive the wolves from the grove" : null,
        side: s.quests.feverroot ? `Feverroot ${Math.min(10, s.bag.feverroot ?? 0)} / 10` : null,
      },
      arrow: this.modal.kind === "none" && !inView ? { angle: Math.atan2(this.target.y - h.y, this.target.x - h.x), label: "Mossgloam Wood" } : null,
      prompt: near && npcScreen.visible ? { label: "Talk", x: npcScreen.x, y: npcScreen.y } : null,
      modal: this.modalView(),
      notices, mapName: "Southfold meadow", night: s.night, device: this.device,
      boss: this.boss,
    };
  }

  drainEvents(): EngineEvent[] { const out = this.events; this.events = []; return out; }

  command(command: GameCommand): void {
    if (this.dead) return;
    const s = this.save_;
    switch (command.type) {
      case "setDevice": if (!this.params.get("device")) this.device = command.device; return;
      case "newGame": {
        const save = mockSave(command.heroName);
        save.savedAt = new Date().toISOString();
        this.start(save);
        this.events.push({ type: "save", reason: "map", state: this.save() });
        break;
      }
      case "load": this.start(command.state); break;
      case "menu": this.menu(command.command); break;
      case "openModal": if (s && this.modal.kind === "none") this.open({ kind: command.modal }); break;
      case "closeModal":
        if (["shop", "status", "items", "map", "pause"].includes(this.modal.kind)) { this.close(); this.paused = false; }
        break;
      case "buy": if (s) this.fail(this.buy(s, command.item)); break;
      case "sell": if (s) this.fail(this.sell(s, command.item)); break;
      case "equip": if (s) this.fail(this.equip(s, command.item)); break;
      case "unequip": {
        const id = s?.equipped[command.slot];
        if (!s || !id) this.fail("Nothing equipped");
        else if (command.slot === "weapon") this.fail("You need a weapon");
        else { s.equipped[command.slot] = null; s.gear.push(id); this.events.push({ type: "sfx", cue: "equip", pan: 0 }); }
        break;
      }
      case "setReducedMotion": break;
      case "use": if (s) this.fail(this.use(s, command.item)); break;
      case "selectSpell": if (s?.spells.includes(command.spell)) s.spell = command.spell; break;
      case "retry":
        if (s && this.modal.kind === "dead") {
          s.hp = Math.ceil(this.stats().hp * 0.5);
          this.close();
          this.events.push({ type: "music", id: "field" });
        }
        break;
    }
    this.emitPhase();
  }

  save(): SaveState {
    if (!this.save_) throw new Error("No game in progress");
    const out = structuredClone(this.save_);
    out.x = Math.round(this.hero.x); out.y = Math.round(this.hero.y); out.facing = this.hero.facing;
    out.savedAt = new Date().toISOString();
    return out;
  }

  destroy(): void { this.dead = true; this.events = []; }

  /** Mock only: step to the next modal kind (backquote key in the host). */
  cycle(): string {
    this.cycleIndex = (this.cycleIndex + 1) % MODAL_CYCLE.length;
    const key = MODAL_CYCLE[this.cycleIndex];
    this.forceModal(key);
    return key;
  }

  /** Mock only: open a modal by name, as `?modal=` does. */
  forceModal(key: string): void {
    if (!this.save_) return;
    this.modal = { kind: "none" };
    this.dialog = null;
    this.paused = false;
    const k = key as MockModalKey;
    if (k === "dialog") this.openDialog(DIALOG_LINES, null);
    else if (k === "choice") this.openDialog(CHOICE_LINES, CHOICES);
    else if (k === "questOffer") this.open({ kind: "questCard", card: CARDS.offer });
    else if (k === "questComplete") this.open({ kind: "questCard", card: CARDS.complete });
    else if (k === "questInfo") this.open({ kind: "questCard", card: CARDS.info });
    else if (k === "shop") this.open({ kind: "shop", shop: "tildaShop" });
    else if (k === "shopArms") this.open({ kind: "shop", shop: "haskShop" });
    else if (k === "status" || k === "items" || k === "map" || k === "pause" || k === "dead" || k === "clear") this.open({ kind: k });
    else if (k === "unlock") this.open({ kind: "unlock", title: "Charged Spin", hint: "Hold attack until the ring fills, then let go to spin and hit everything around you." });
    if (k === "dead") { this.save_.hp = 0; this.events.push({ type: "sfx", cue: "sting.gameOver", pan: 0 }); }
    if (k === "clear") this.events.push({ type: "sfx", cue: "sting.chapterClear", pan: 0 });
    this.emitPhase();
  }

  // ─── internals ──────────────────────────────────────────────────────────────────────────────
  private start(save: SaveState) {
    this.save_ = structuredClone(save);
    this.hero.x = save.x > 0 ? save.x : 20 * TILE_PX;
    this.hero.y = save.y > 0 ? save.y : 16 * TILE_PX;
    this.hero.facing = save.facing;
    this.cam = { x: this.hero.x - this.size.vw / 2, y: this.hero.y - this.size.vh / 2 };
    this.modal = { kind: "none" };
    this.dialog = null;
    this.paused = false;
    const p = this.params;
    if (p.get("night") === "1") this.save_.night = true;
    if (p.get("lowhp") === "1") this.save_.hp = Math.max(1, Math.round(this.stats().hp * 0.18));
    if (p.get("buffs") === "1") this.buffs = [{ id: "fury", seconds: 24 }, { id: "stoneskin", seconds: 4 }];
    if (p.get("boss") === "1") this.boss = { name: "The Thornmother", hp: 412, max: 640, phase: 2 };
    this.events.push({ type: "music", id: this.save_.night ? "villageNight" : "field" });
    const modal = p.get("modal");
    if (modal) this.forceModal(modal);
    else this.notice("Southfold meadow", "info");
  }

  private stats() {
    const s = this.save_!;
    const base = statsAt(s.level);
    for (const slot of Object.keys(s.equipped) as Slot[]) {
      const g = s.equipped[slot] ? GEAR[s.equipped[slot]!] : null;
      if (!g) continue;
      base.hp += g.mods.hp ?? 0; base.mp += g.mods.mp ?? 0; base.atk += g.mods.atk ?? 0; base.def += g.mods.def ?? 0; base.spd += g.mods.spd ?? 0;
    }
    return base;
  }

  private gainXp() {
    const s = this.save_!;
    const next = XP_TO_NEXT(s.level);
    if (s.xp >= next) {
      s.xp -= next; s.level += 1;
      const st = this.stats(); s.hp = st.hp; s.mp = st.mp;
      this.notice(`Level ${s.level}!`, "info");
      this.sfx("sting.levelUp");
    }
  }

  private phase(): Phase {
    if (!this.loaded) return "loading";
    if (!this.save_) return "title";
    switch (this.modal.kind) {
      case "dialog": case "questCard": case "unlock": return "dialog";
      case "shop": case "status": case "items": case "map": return "menu";
      case "pause": return "paused";
      case "dead": return "dead";
      case "clear": return "clear";
      default: return "playing";
    }
  }

  private emitPhase() {
    const phase = this.phase();
    if (phase !== this.lastPhase) { this.lastPhase = phase; this.events.push({ type: "phase", phase }); }
  }

  private modalView(): Modal {
    if (this.modal.kind !== "dialog" || !this.dialog) return this.modal;
    const d = this.dialog;
    const line = d.lines[Math.min(d.index, d.lines.length - 1)];
    const atChoices = d.index >= d.lines.length - 1 && !!d.choices;
    return {
      kind: "dialog", speaker: line.speaker, text: line.text, portrait: line.portrait,
      choices: atChoices ? d.choices : null, index: atChoices ? d.choice : d.index, total: d.lines.length,
    };
  }

  private open(modal: Modal) {
    if (this.modal.kind !== "none" && modal.kind !== "dead") return;
    this.modal = modal;
    if (["items", "map", "status", "pause", "shop"].includes(modal.kind)) this.sfx("ui.ok");
  }

  private close() { this.modal = { kind: "none" }; }

  private openDialog(lines: typeof DIALOG_LINES, choices: string[] | null, then?: Modal) {
    this.dialog = { lines, index: 0, choices, choice: 0, then };
    this.modal = { kind: "dialog", speaker: "", text: "", choices: null, index: 0, total: lines.length };
    this.sfx("text.blip");
  }

  private menu(cmd: MenuCommand) {
    const m = this.modal;
    if (m.kind === "dialog" && this.dialog) {
      const d = this.dialog;
      const atChoices = d.index >= d.lines.length - 1 && !!d.choices;
      if (atChoices && (cmd === "up" || cmd === "down")) {
        d.choice = (d.choice + (cmd === "down" ? 1 : d.choices!.length - 1)) % d.choices!.length;
        this.sfx("ui.move");
        return;
      }
      if (cmd !== "ok" && cmd !== "back" && cmd !== "start") return;
      if (d.index < d.lines.length - 1) { d.index++; this.sfx("text.blip"); return; }
      this.dialog = null;
      this.close();
      if (atChoices) {
        const picked = cmd === "back" ? d.choices!.length - 1 : d.choice;
        this.sfx(cmd === "back" ? "ui.back" : "ui.ok");
        if (picked === 0) {
          const s = this.save_!;
          const st = this.stats();
          s.hp = st.hp; s.mp = st.mp; s.night = !s.night;
          this.notice(s.night ? "You rest until nightfall" : "You rest until morning", "info");
          this.sfx("rest");
          this.events.push({ type: "music", id: s.night ? "villageNight" : "village" });
        }
      } else if (d.lines === DIALOG_LINES) {
        this.open({ kind: "questCard", card: CARDS.offer });
        this.sfx("questStart");
      }
      return;
    }
    if (m.kind === "questCard" || m.kind === "unlock") {
      if (cmd === "ok" || cmd === "back" || cmd === "start") { this.sfx("ui.ok"); this.close(); }
      return;
    }
    if (m.kind === "clear" && (cmd === "ok" || cmd === "start")) this.close();
    if (m.kind === "dead" && (cmd === "ok" || cmd === "start")) this.command({ type: "retry" });
  }

  private fail(message: string | null) {
    if (!message) return;
    this.notice(message, "warning");
    this.events.push({ type: "sfx", cue: "ui.deny", pan: 0 });
  }

  private buy(s: SaveState, item: string): string | null {
    const price = GEAR[item]?.price ?? CONSUMABLES[item]?.price ?? null;
    if (price == null) return "Not for sale";
    if (s.gold < price) return "Not enough gold";
    if (CONSUMABLES[item] && (s.bag[item] ?? 0) >= CONSUMABLES[item].carry) return "You can't carry more";
    s.gold -= price;
    if (GEAR[item]) s.gear.push(item); else s.bag[item] = (s.bag[item] ?? 0) + 1;
    this.sfx("buy");
    return null;
  }

  private sell(s: SaveState, item: string): string | null {
    const price = GEAR[item]?.price ?? CONSUMABLES[item]?.price ?? null;
    if (price == null) return "Can't sell that";
    if (GEAR[item]) {
      const i = s.gear.indexOf(item);
      if (i < 0) return "Unequip it first";
      s.gear.splice(i, 1);
    } else {
      if (!s.bag[item]) return "You have none";
      s.bag[item]--;
    }
    s.gold += Math.max(1, Math.floor(price / 4));
    this.sfx("coin");
    return null;
  }

  private equip(s: SaveState, item: string): string | null {
    const g = GEAR[item];
    if (!g) return "Not gear";
    const i = s.gear.indexOf(item);
    if (i < 0) return s.equipped[g.slot] === item ? null : "You don't have it";
    s.gear.splice(i, 1);
    const prev = s.equipped[g.slot];
    if (prev) s.gear.push(prev);
    s.equipped[g.slot] = item;
    const st = this.stats();
    s.hp = Math.min(s.hp, st.hp); s.mp = Math.min(s.mp, st.mp);
    this.sfx("equip");
    return null;
  }

  private use(s: SaveState, item: string): string | null {
    const c = CONSUMABLES[item];
    if (!c) return "Can't use that";
    if (!s.bag[item]) return "You have none";
    const st = this.stats();
    const e = c.effect;
    if (e.kind === "heal" && s.hp >= st.hp) return "HP is full";
    if (e.kind === "mana" && s.mp >= st.mp) return "MP is full";
    s.bag[item]--;
    if (e.kind === "heal") s.hp = Math.min(st.hp, s.hp + e.hp);
    if (e.kind === "mana") s.mp = Math.min(st.mp, s.mp + e.mp);
    if (e.kind === "full") { s.hp = st.hp; s.mp = st.mp; }
    if (e.kind === "buff") { this.buffs = this.buffs.filter(b => b.id !== e.buff).concat({ id: e.buff, seconds: e.seconds }); this.notice(`${c.name}: ${e.seconds} s`, "info"); }
    this.sfx("heal");
    return null;
  }

  private notice(text: string, kind: HudSnapshot["notices"][number]["kind"]) {
    this.notices.push({ id: ++this.noticeId, text, kind, until: this.clock + 3.2 });
    this.notices = this.notices.slice(-4);
  }

  private sfx(cue: string, x?: number, gain?: number) {
    const pan = x === undefined ? 0 : Math.max(-1, Math.min(1, (x - this.cam.x) / Math.max(1, this.size.vw) * 2 - 1));
    this.events.push({ type: "sfx", cue, pan, gain });
  }

  private project(x: number, y: number) {
    const { k, dpr, vw, vh } = this.size;
    const sx = (x - this.cam.x) * k / dpr, sy = (y - this.cam.y) * k / dpr;
    return { x: sx, y: sy, visible: x >= this.cam.x && x <= this.cam.x + vw && y >= this.cam.y && y <= this.cam.y + vh };
  }

  private viewRect() { return { x: this.cam.x, y: this.cam.y, w: this.size.vw, h: this.size.vh }; }

  private stepSlime(slime: Slime, dt: number) {
    slime.t += dt;
    slime.hurt = Math.max(0, slime.hurt - dt);
    const period = 1.4;
    const phase = (slime.t % period) / period;
    slime.hop = phase < 0.35 ? Math.sin(phase / 0.35 * Math.PI) : 0;
    if (phase < dt / period + 0.001) {
      const a = hash(Math.floor(slime.t * 10), Math.floor(slime.x)) * Math.PI * 2;
      slime.vx = Math.cos(a) * 36; slime.vy = Math.sin(a) * 36;
    }
    if (slime.hop > 0) {
      slime.x = Math.max(4 * TILE_PX, Math.min((WORLD_W - 4) * TILE_PX, slime.x + slime.vx * dt));
      slime.y = Math.max(15 * TILE_PX, Math.min((WORLD_H - 3) * TILE_PX, slime.y + slime.vy * dt));
    }
  }

  // ─── placeholder world ──────────────────────────────────────────────────────────────────────
  private ground(tx: number, ty: number): "grass" | "path" | "water" | "sand" {
    const pathY = 16 + Math.round(Math.sin(tx * 0.35) * 1.5);
    if (Math.hypot(tx - 34, ty - 24) < 5.2 + hash(tx, ty) * 0.6) return "water";
    if (Math.hypot(tx - 34, ty - 24) < 6.4) return "sand";
    if (Math.abs(ty - pathY) <= 1 || (tx >= 23 && tx <= 25 && ty < pathY)) return "path";
    return "grass";
  }

  private drawWorld(b: CanvasRenderingContext2D, cx: number, cy: number, vw: number, vh: number) {
    const t = this.clock;
    b.imageSmoothingEnabled = false;
    const tx0 = Math.floor(cx / TILE_PX) - 1, ty0 = Math.floor(cy / TILE_PX) - 1;
    const tx1 = Math.ceil((cx + vw) / TILE_PX) + 1, ty1 = Math.ceil((cy + vh) / TILE_PX) + 1;
    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        const g = this.ground(tx, ty);
        const x = tx * TILE_PX - cx, y = ty * TILE_PX - cy;
        const n = hash(tx, ty);
        b.fillStyle = g === "grass" ? (n > 0.5 ? "#5c9e3f" : "#58993c") : g === "path" ? "#a8794a" : g === "sand" ? "#d9c08a" : "#3d78a8";
        b.fillRect(x, y, TILE_PX, TILE_PX);
        if (g === "grass") {
          b.fillStyle = "#6db04a";
          for (let i = 0; i < 6; i++) {
            const px = Math.floor(hash(tx * 7 + i, ty) * 30), py = Math.floor(hash(tx, ty * 5 + i) * 30);
            b.fillRect(x + px, y + py, 1, 2);
          }
          b.fillStyle = "#4a8a34";
          for (let i = 0; i < 3; i++) b.fillRect(x + Math.floor(hash(tx + i, ty * 3) * 30), y + Math.floor(hash(tx * 3, ty + i) * 30), 2, 1);
        } else if (g === "path") {
          b.fillStyle = "#94683f";
          for (let i = 0; i < 5; i++) b.fillRect(x + Math.floor(hash(tx * 11 + i, ty) * 30), y + Math.floor(hash(tx, ty * 13 + i) * 30), 2, 2);
        } else if (g === "water") {
          b.fillStyle = "#5b9bcc";
          const wave = Math.floor((t * 6 + tx * 3 + ty * 5) % 32);
          b.fillRect(x + wave % 28, y + 8 + (ty % 2) * 12, 4, 1);
        }
      }
    }
    type Sprite = { y: number; draw: () => void };
    const sprites: Sprite[] = [];
    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        if (this.ground(tx, ty) !== "grass") continue;
        const n = hash(tx * 3 + 1, ty * 7 + 2);
        const wx = tx * TILE_PX + 16, wy = ty * TILE_PX + 28;
        if (n < 0.035 && Math.abs(tx - 20) + Math.abs(ty - 16) > 4) sprites.push({ y: wy, draw: () => this.drawTree(b, wx - cx, wy - cy) });
        else if (n < 0.12) sprites.push({ y: wy - 8, draw: () => this.drawTuft(b, wx - cx, wy - 8 - cy, t + n * 9) });
      }
    }
    for (const slime of this.slimes) sprites.push({ y: slime.y, draw: () => this.drawSlime(b, slime, cx, cy) });
    sprites.push({ y: this.npc.y, draw: () => this.drawPerson(b, this.npc.x - cx, this.npc.y - cy, "down", 0, "#5a6fb8", "#e3c49a", true) });
    const h = this.hero;
    sprites.push({ y: h.y, draw: () => this.drawHero(b, h.x - cx, h.y - cy) });
    sprites.sort((a, c) => a.y - c.y);
    for (const sprite of sprites) sprite.draw();
    if (this.save_?.night) {
      b.fillStyle = "rgba(20, 30, 80, 0.45)";
      b.fillRect(0, 0, vw, vh);
    }
  }

  private drawTree(b: CanvasRenderingContext2D, x: number, y: number) {
    b.fillStyle = "rgba(20,40,10,0.35)";
    b.fillRect(x - 18, y - 3, 36, 6);
    b.fillStyle = "#6b4527"; b.fillRect(x - 4, y - 22, 8, 22);
    b.fillStyle = "#4e321c"; b.fillRect(x + 2, y - 22, 2, 22);
    const blobs: Array<[number, number, number, string]> = [[0, -46, 22, "#2f6b2e"], [-10, -40, 14, "#3a7d34"], [9, -42, 15, "#3a7d34"], [-4, -52, 12, "#4d9440"], [6, -54, 8, "#63a94f"]];
    for (const [ox, oy, r, color] of blobs) {
      b.fillStyle = color;
      b.beginPath();
      for (let yy = -r; yy <= r; yy++) {
        const w = Math.floor(Math.sqrt(r * r - yy * yy));
        b.rect(x + ox - w, y + oy + yy, w * 2, 1);
      }
      b.fill();
    }
  }

  private drawTuft(b: CanvasRenderingContext2D, x: number, y: number, t: number) {
    const sway = Math.round(Math.sin(t * 2) * 1);
    b.fillStyle = "#3d7a2c";
    for (let i = -5; i <= 5; i += 2) b.fillRect(x + i + (i > 0 ? sway : 0), y - 8 + Math.abs(i), 1, 8 - Math.abs(i));
    b.fillStyle = "#7cc453";
    for (let i = -4; i <= 4; i += 4) b.fillRect(x + i + sway, y - 7 + Math.abs(i), 1, 3);
  }

  private drawSlime(b: CanvasRenderingContext2D, s: Slime, cx: number, cy: number) {
    const x = Math.round(s.x - cx), y = Math.round(s.y - cy);
    const lift = Math.round(s.hop * 10);
    const squash = s.hop > 0 ? 0 : Math.round(Math.sin(s.t * 6) * 1);
    b.fillStyle = "rgba(10,30,10,0.35)"; b.fillRect(x - 9, y - 2, 18, 4);
    const w = 11 + squash, h = 10 - squash;
    b.fillStyle = s.hurt > 0 ? "#ffffff" : "#3fa860";
    b.fillRect(x - w, y - h * 2 + 4 - lift, w * 2, h * 2 - 4);
    b.fillRect(x - w + 2, y - h * 2 + 2 - lift, w * 2 - 4, 2);
    b.fillStyle = s.hurt > 0 ? "#ffffff" : "#6fd88a"; b.fillRect(x - w + 3, y - h * 2 + 4 - lift, 5, 3);
    b.fillStyle = "#16301c"; b.fillRect(x - 5, y - h - lift, 2, 3); b.fillRect(x + 3, y - h - lift, 2, 3);
  }

  private drawPerson(b: CanvasRenderingContext2D, x: number, y: number, facing: Dir4, walk: number, cloth: string, skin: string, marker: boolean) {
    x = Math.round(x); y = Math.round(y);
    const step = walk ? Math.round(Math.sin(walk * 12) * 2) : 0;
    b.fillStyle = "rgba(10,20,10,0.35)"; b.fillRect(x - 9, y - 2, 18, 4);
    b.fillStyle = "#3b2a1c"; b.fillRect(x - 6, y - 8 + Math.max(0, step), 5, 8 - Math.max(0, step)); b.fillRect(x + 1, y - 8 + Math.max(0, -step), 5, 8 - Math.max(0, -step));
    b.fillStyle = cloth; b.fillRect(x - 8, y - 26, 16, 18);
    b.fillStyle = "rgba(0,0,0,0.18)"; b.fillRect(x + 3, y - 26, 5, 18);
    b.fillStyle = skin; b.fillRect(x - 7, y - 40, 14, 14);
    b.fillStyle = "#8a4a22"; b.fillRect(x - 8, y - 44, 16, 6);
    if (facing !== "up") { b.fillStyle = "#1a110b"; b.fillRect(x - 4 + (facing === "right" ? 3 : facing === "left" ? -2 : 0), y - 34, 2, 3); b.fillRect(x + 2 + (facing === "right" ? 3 : facing === "left" ? -2 : 0), y - 34, 2, 3); }
    if (marker) {
      const bob = Math.round(Math.sin(this.clock * 4) * 2);
      b.fillStyle = "#1a110b"; b.fillRect(x - 3, y - 64 + bob, 7, 14);
      b.fillStyle = "#ffd24a"; b.fillRect(x - 2, y - 63 + bob, 5, 8); b.fillRect(x - 2, y - 53 + bob, 5, 2);
    }
  }

  private drawHero(b: CanvasRenderingContext2D, x: number, y: number) {
    const h = this.hero;
    if (h.hurt > 0 && Math.floor(h.hurt * 20) % 2 === 0) return;
    this.drawPerson(b, x, y, h.facing, h.walk, "#b23a2a", "#f0c8a0", false);
    x = Math.round(x); y = Math.round(y);
    b.fillStyle = "#e0602a"; b.fillRect(x - 8, y - 46, 16, 7);
    if (h.swing > 0) {
      const dir = { down: [0, 1], up: [0, -1], left: [-1, 0], right: [1, 0] }[h.facing];
      const cxs = x + dir[0] * 18, cys = y - 18 + dir[1] * 16;
      b.fillStyle = `rgba(230, 250, 255, ${Math.min(1, h.swing * 4)})`;
      for (let i = 0; i < 14; i++) {
        const a = Math.atan2(dir[1], dir[0]) - 1.2 + i * 0.18;
        b.fillRect(Math.round(cxs + Math.cos(a) * 14), Math.round(cys + Math.sin(a) * 12), 3, 3);
      }
    }
    if (h.charge > 0) {
      b.fillStyle = h.charge >= 1 ? "#fff2a0" : "#ffb13b";
      const n = Math.floor(h.charge * 16);
      for (let i = 0; i < n; i++) {
        const a = -Math.PI / 2 + i / 16 * Math.PI * 2;
        b.fillRect(Math.round(x + Math.cos(a) * 20), Math.round(y - 20 + Math.sin(a) * 20), 2, 2);
      }
    }
  }
}

/** Mock factory with the contract's CreateGame shape plus the URL parameters. */
export function createMockGame(canvas: HTMLCanvasElement, options: CreateGameOptions, params: URLSearchParams): MockGame {
  return new MockGame(canvas, options, params);
}
