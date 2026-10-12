import {
  STEP, TILE, type Action, type CreateGame, type CreateGameOptions, type CreateView, type Device, type EngineEvent,
  type GameCommand, type GameHandle, type HudSnapshot, type InputFrame, type MapId, type MenuCommand, type Modal,
  type Phase, type SaveState, type ViewApi,
} from "./contract";
import { MAPS } from "./content/maps";
import { MONSTERS } from "./content/monsters";
import { NPCS } from "./content/npcs";
import { QUESTS } from "./content/quests";
import { SPELLS } from "./content/spells";
import { XP_TO_NEXT } from "./content/levels";
import { Sim, newSave } from "./sim/sim";
import type { SimInput } from "./sim/types";

const ACTIONS: Action[] = ["attack", "magic", "dodge", "item", "nextSpell", "map", "status", "pause"];
const noPressed = (): Record<Action, boolean> => ({ attack: false, magic: false, dodge: false, item: false, nextSpell: false, map: false, status: false, pause: false });
const finite = (v: number, f = 0) => Number.isFinite(v) ? v : f;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, finite(v)));
const SIM_MODALS = new Set(["dialog", "questCard", "unlock", "dead", "clear"]);

/** Fixed-step adapter between the pure simulation, the Canvas view and the React host. */
export class Game05Engine implements GameHandle {
  readonly ready: Promise<void>;
  sim: Sim | null = null;
  private view: ViewApi | null = null;
  private dead = false;
  private loaded = false;
  private acc = 0;
  private hitstop = 0;
  private pending = noPressed();
  private held = { attack: false };
  private move: [number, number] = [0, 0];
  private axis = { x: 0, y: 0 };
  private device: Device = "keyboard";
  private events: EngineEvent[] = [];
  private notices: Array<{ id: number; text: string; kind: HudSnapshot["notices"][number]["kind"]; expires: number }> = [];
  private noticeId = 0;
  private clock = 0;
  private size = { w: 1, h: 1, dpr: 1 };
  private lastPhase: Phase = "loading";
  private progress = 0;
  private lastAutosave: SaveState | null = null;
  private currentMap: MapId | null = null;
  private reduced = false;

  constructor(canvas: HTMLCanvasElement, private readonly options: CreateGameOptions, factory?: CreateView) {
    this.reduced = !!options.reducedMotion;
    this.ready = this.init(canvas, factory);
  }

  private async init(canvas: HTMLCanvasElement, factory?: CreateView) {
    const make: CreateView = factory ?? (await import("./render/view")).createView;
    if (this.dead) return;
    const view = make(canvas, {
      assetBase: this.options.assetBase ?? "/games/game-05",
      reducedMotion: !!this.options.reducedMotion,
      onProgress: f => { this.progress = clamp(f, 0, 0.99); },
    });
    this.view = view;
    view.resize(this.size.w, this.size.h, this.size.dpr);
    await view.ready;
    if (this.dead) { view.dispose(); return; }
    this.loaded = true;
    this.progress = 1;
    if (this.options.save) this.start(this.options.save);
    this.emitPhase();
  }

  private start(save: SaveState) {
    this.sim = new Sim(save);
    this.lastAutosave = this.sim.durable();
    this.currentMap = null;
    this.clearInput();
    this.syncMap();
    this.flush([]);
  }

  private syncMap() {
    const sim = this.sim;
    if (!sim || !this.view) return;
    if (this.currentMap !== sim.map.id) {
      this.currentMap = sim.map.id;
      this.view.setMap(sim.map);
    }
  }

  private phase(): Phase {
    if (!this.loaded) return "loading";
    const sim = this.sim;
    if (!sim) return "title";
    switch (sim.modal.kind) {
      case "dialog": case "questCard": case "unlock": return "dialog";
      case "shop": case "status": case "items": case "map": return "menu";
      case "pause": return "paused";
      case "dead": return "dead";
      case "clear": return "clear";
    }
    return "playing";
  }

  private emitPhase() {
    const p = this.phase();
    if (p === this.lastPhase) return;
    this.lastPhase = p;
    this.events.push({ type: "phase", phase: p });
  }

  private clearInput() {
    this.pending = noPressed();
    this.held = { attack: false };
    this.move = [0, 0];
    this.acc = 0;
  }

  frame(dtSeconds: number, input: InputFrame): void {
    if (this.dead || !this.loaded || !this.view) return;
    const real = clamp(dtSeconds, 0, 0.1);
    this.clock += real;
    this.notices = this.notices.filter(n => n.expires > this.clock);
    const sim = this.sim;
    this.device = input.device ?? this.device;
    if (!sim) { this.emitPhase(); return; }
    // Menus owned by the simulation read the game input as menu commands.
    if (SIM_MODALS.has(sim.modal.kind)) {
      this.menuFromInput(input);
      this.clearInput();
      this.stepVisual(real);
      this.emitPhase();
      return;
    }
    if (sim.modal.kind !== "none") { this.clearInput(); this.stepVisual(real); this.emitPhase(); return; }
    let mx = clamp(input.moveX, -1, 1), my = clamp(input.moveY, -1, 1);
    const len = Math.hypot(mx, my);
    if (len > 1) { mx /= len; my /= len; }
    this.move = [mx, my];
    this.held = { attack: !!input.held?.attack };
    for (const a of ACTIONS) this.pending[a] ||= !!input.pressed?.[a];
    this.axis = { x: mx, y: my };

    let remaining = real;
    if (this.hitstop > 0) {
      const used = Math.min(this.hitstop, remaining);
      this.hitstop -= used;
      remaining -= used;
    }
    this.acc += remaining;
    let steps = 0;
    const visual: ReturnType<Sim["drain"]> = [];
    while (this.acc >= STEP && steps < 5) {
      this.acc -= STEP;
      const stepInput: SimInput = { mx: this.move[0], my: this.move[1], pressed: this.pending, held: this.held };
      this.pending = noPressed();
      sim.step(stepInput, STEP);
      steps++;
      const ev = sim.drain();
      visual.push(...ev);
      for (const e of ev) if (e.t === "hitstop") this.hitstop = Math.max(this.hitstop, this.reduced ? 0 : e.ms / 1000);
      if (this.hitstop > 0 || sim.modal.kind !== "none") { this.acc = 0; break; }
    }
    if (this.acc > STEP * 5) this.acc = 0;
    this.flush(visual);
    this.view.update(sim.worldView(clamp(this.acc / STEP, 0, 1)), real, clamp(this.acc / STEP, 0, 1));
    this.emitPhase();
  }

  /** Visual time keeps running under menus (lights flicker, the world stays alive). */
  private stepVisual(real: number) {
    const sim = this.sim;
    if (!sim || !this.view) return;
    sim.step({ mx: 0, my: 0, pressed: noPressed(), held: { attack: false } }, 0);
    this.flush(sim.drain());
    this.view.update(sim.worldView(1), real, 1);
  }

  private menuFromInput(input: InputFrame) {
    const sim = this.sim!;
    const cmds: MenuCommand[] = [];
    const y = clamp(input.moveY, -1, 1), x = clamp(input.moveX, -1, 1);
    if (y < -0.55 && this.axis.y >= -0.55) cmds.push("up");
    if (y > 0.55 && this.axis.y <= 0.55) cmds.push("down");
    if (x < -0.55 && this.axis.x >= -0.55) cmds.push("left");
    if (x > 0.55 && this.axis.x <= 0.55) cmds.push("right");
    this.axis = { x, y };
    if (input.pressed?.attack || input.pressed?.magic) cmds.push("ok");
    if (input.pressed?.dodge) cmds.push("back");
    if (input.pressed?.pause) cmds.push("start");
    for (const c of cmds) this.menu(c);
    void sim;
  }

  private menu(cmd: MenuCommand) {
    const sim = this.sim;
    if (!sim) return;
    if (sim.modal.kind === "dead") { if (cmd === "ok" || cmd === "start") this.retry(); return; }
    sim.menu(cmd);
    this.flush(sim.drain());
  }

  private retry() {
    const save = this.lastAutosave;
    const sim = this.sim;
    if (!save || !sim) return;
    const restored = structuredClone(save);
    restored.stats.deaths = sim.s.stats.deaths;
    const st = restored;
    // Come back with at least half health so a retry is not an instant loss.
    this.sim = new Sim(st);
    const max = this.sim.stats();
    this.sim.s.hp = Math.max(this.sim.s.hp, Math.ceil(max.hp * 0.5));
    this.currentMap = null;
    this.clearInput();
    this.syncMap();
    this.flush(this.sim.drain());
  }

  /** Route sim events to the host (audio, music, saves) and the view (everything visual). */
  private flush(visual: ReturnType<Sim["drain"]>) {
    const sim = this.sim;
    if (!sim) return;
    this.syncMap();
    for (const e of visual) {
      if (e.t === "sfx") this.events.push({ type: "sfx", cue: e.cue, pan: e.x != null ? this.pan(e.x, e.y ?? 0) : 0 });
      else if (e.t === "music") this.events.push({ type: "music", id: e.id });
      else if (e.t === "hit" && e.target === "hero") this.events.push({ type: "rumble", strong: 0.5, weak: 0.3, ms: 140 });
      else if (e.t === "levelUp") this.events.push({ type: "rumble", strong: 0.2, weak: 0.6, ms: 220 });
    }
    if (visual.length) this.view?.onEvents(visual);
    for (const n of sim.notices.splice(0)) this.notice(n.text, n.kind);
    const reason = sim.takeSaveRequest();
    if (reason) {
      const state = sim.durable();
      if (reason !== "clear") this.lastAutosave = state;
      this.events.push({ type: "save", reason, state });
    }
  }

  private pan(x: number, y: number) {
    const p = this.view?.project(x, y);
    if (!p || !p.visible) return 0;
    return clamp(p.x / Math.max(1, this.size.w) * 2 - 1, -1, 1);
  }

  private notice(text: string, kind: HudSnapshot["notices"][number]["kind"]) {
    this.notices.push({ id: ++this.noticeId, text, kind, expires: this.clock + 3.2 });
    this.notices = this.notices.slice(-4);
  }

  render(): void { if (!this.dead) this.view?.render(); }

  resize(w: number, h: number, dpr: number): void {
    if (this.dead) return;
    this.size = { w: Math.max(1, finite(w, 1)), h: Math.max(1, finite(h, 1)), dpr: clamp(dpr, 0.5, 4) };
    this.view?.resize(this.size.w, this.size.h, this.size.dpr);
  }

  setPaused(paused: boolean): void {
    if (this.dead) return;
    const sim = this.sim;
    if (!sim || sim.hero.state === "dead") return;
    if (paused && sim.modal.kind === "none") { sim.openModal({ kind: "pause" }); this.events.push({ type: "sfx", cue: "ui.back", pan: 0 }); }
    if (!paused && sim.modal.kind === "pause") { sim.closeModal(); this.events.push({ type: "sfx", cue: "ui.ok", pan: 0 }); }
    this.clearInput();
    this.emitPhase();
  }

  drainEvents(): EngineEvent[] { const e = this.events; this.events = []; return e; }

  save(): SaveState {
    if (!this.sim) throw new Error("No game in progress");
    // A fallen hero is never written to a slot: the last autosave stands in for them.
    if (this.sim.hero.state === "dead" && this.lastAutosave) return structuredClone(this.lastAutosave);
    return this.sim.durable();
  }

  command(c: GameCommand): void {
    if (this.dead) return;
    const sim = this.sim;
    const fail = (msg: string | null) => { if (msg) { this.notice(msg, "warning"); this.events.push({ type: "sfx", cue: "ui.deny", pan: 0 }); } };
    switch (c.type) {
      case "setDevice": this.device = c.device; return;
      case "newGame": {
        const save = newSave(c.heroName, c.seed ?? (Date.now() >>> 0));
        this.start(save);
        const s = this.sim!;
        // The opening line from Oren's house, then the first quest card.
        this.events.push({ type: "save", reason: "map", state: s.durable() });
        break;
      }
      case "load":
        try { this.start(c.state); } catch { this.notice("That save could not be loaded", "warning"); }
        break;
      case "menu": this.menu(c.command); break;
      case "openModal":
        if (sim && sim.modal.kind === "none") sim.openModal({ kind: c.modal });
        break;
      case "closeModal":
        if (sim && !SIM_MODALS.has(sim.modal.kind)) sim.closeModal();
        break;
      case "buy": if (sim) fail(sim.buy(c.shop, c.item)); break;
      case "sell": if (sim) fail(sim.sell(c.item)); break;
      case "equip": if (sim) fail(sim.equip(c.item)); break;
      case "unequip": if (sim) fail(sim.unequip(c.slot)); break;
      case "setReducedMotion": this.reduced = c.reduced; this.view?.setReducedMotion?.(c.reduced); break;
      case "use": if (sim) fail(sim.use(c.item)); break;
      case "selectSpell": sim?.selectSpell(c.spell); break;
      case "retry": if (sim?.modal.kind === "dead") this.retry(); break;
    }
    if (this.sim) this.flush(this.sim.drain());
    this.emitPhase();
  }

  snapshot(): HudSnapshot {
    const sim = this.sim;
    const phase = this.phase();
    const notices = this.notices.map(({ id, text, kind }) => ({ id, text, kind }));
    if (!sim) {
      return {
        phase, loading: this.progress, heroName: "", level: 1, xp: { value: 0, next: 1 }, hp: { value: 0, max: 1 }, mp: { value: 0, max: 1 },
        gold: 0, charge: 0, spell: null, buffs: [], ticker: { main: null, side: null }, arrow: null, prompt: null, modal: { kind: "none" },
        notices, mapName: "", night: false, device: this.device, boss: null,
      };
    }
    const s = sim.s, st = sim.stats();
    const spellId = s.spell;
    const spell = spellId ? SPELLS[spellId] : null;
    const target = sim.modal.kind === "none" ? sim.interactable() : null;
    const tp = target ? this.view?.project(target.x, target.y) : null;
    const boss = sim.bossId != null ? sim.actors.find(a => a.id === sim.bossId && !a.dead) : undefined;
    return {
      phase, loading: this.progress, heroName: s.heroName, level: s.level,
      xp: { value: s.xp, next: XP_TO_NEXT(s.level) },
      hp: { value: Math.ceil(s.hp), max: st.hp }, mp: { value: Math.floor(s.mp), max: st.mp }, gold: s.gold,
      charge: sim.hero.state === "charge" ? sim.hero.charge : 0,
      spell: spell ? { id: spell.id, name: spell.name, mp: spell.mp, icon: spell.icon, ready: s.mp >= spell.mp } : null,
      buffs: Object.entries(sim.buffs).map(([id, t]) => ({ id: id as keyof typeof sim.buffs, seconds: Math.ceil(t ?? 0) })),
      ticker: this.ticker(sim),
      arrow: sim.modal.kind === "none" ? this.arrow(sim) : null,
      prompt: target && tp && tp.visible ? { label: target.label, x: tp.x, y: tp.y } : null,
      modal: this.modal(sim),
      notices, mapName: sim.map.name, night: s.night, device: this.device,
      boss: boss ? { name: MONSTERS[boss.def]?.name ?? "Boss", hp: Math.max(0, boss.hp), max: boss.maxHp, phase: boss.phase } : null,
    };
  }

  private modal(sim: Sim): Modal {
    const m = sim.modal;
    switch (m.kind) {
      case "dialog": {
        const d = sim.dialogView();
        return d ? { kind: "dialog", ...d } : { kind: "none" };
      }
      case "questCard": return { kind: "questCard", card: m.card };
      case "unlock": return { kind: "unlock", title: m.title, hint: m.hint };
      case "shop": return { kind: "shop", shop: m.shop };
      default: return { kind: m.kind } as Modal;
    }
  }

  private ticker(sim: Sim): HudSnapshot["ticker"] {
    let main: string | null = null, side: string | null = null;
    for (const [q, stepId] of Object.entries(sim.s.quests)) {
      const quest = QUESTS[q];
      const step = quest?.steps.find(x => x.id === stepId);
      if (!step) continue;
      let text = step.ticker;
      const g = step.goal;
      if (g.kind === "kill") text = `${text.replace(/\s*\d+\s*\/\s*\d+\s*$/, "")} ${Math.min(g.count, sim.s.progress[`${q}:${stepId}`] ?? 0)} / ${g.count}`;
      if (g.kind === "collect" && g.count > 1) text = `${text.replace(/\s*\d+\s*\/\s*\d+\s*$/, "")} ${Math.min(g.count, sim.count(g.item))} / ${g.count}`;
      if (quest.kind === "main") main = text; else side = text;
    }
    return { main, side };
  }

  /** Objective arrow for the main quest (or the side quest when the main has no target). */
  private arrow(sim: Sim): HudSnapshot["arrow"] {
    const order = Object.keys(sim.s.quests).sort((a, b) => (QUESTS[a]?.kind === "main" ? -1 : 0) - (QUESTS[b]?.kind === "main" ? -1 : 0));
    for (const q of order) {
      const quest = QUESTS[q];
      const step = quest?.steps.find(x => x.id === sim.s.quests[q]);
      if (!step) continue;
      const goal = targetOf(step, sim);
      if (!goal) continue;
      let tx = goal.x * TILE, ty = goal.y * TILE;
      let label = step.ticker;
      if (goal.map !== sim.map.id) {
        const exit = routeExit(sim.map.id, goal.map);
        if (!exit) continue;
        tx = (exit.x + exit.w / 2) * TILE; ty = (exit.y + exit.h / 2) * TILE;
        label = MAPS[exit.to]?.name ?? label;
      } else if (goal.npc) {
        const a = sim.actors.find(o => o.def === goal.npc && !o.dead);
        if (a) { tx = a.x; ty = a.y - 20; }
      }
      const v = this.view?.viewRect();
      if (v && tx > v.x + 16 && tx < v.x + v.w - 16 && ty > v.y + 16 && ty < v.y + v.h - 16) return null;
      return { angle: Math.atan2(ty - sim.hero.y, tx - sim.hero.x), label };
    }
    return null;
  }

  destroy(): void {
    if (this.dead) return;
    this.dead = true;
    this.events = [];
    this.view?.dispose();
    this.view = null;
    this.sim = null;
  }
}

/** Where a quest step points: explicit target, else derived from its goal. */
function targetOf(step: import("./contract").QuestStep, sim: Sim): { map: MapId; x: number; y: number; npc?: string } | null {
  const t = step.target;
  if (t && "map" in t) return { map: t.map, x: t.x, y: t.y };
  const npc = t && "npc" in t ? t.npc : step.goal.kind === "talk" ? step.goal.npc : null;
  if (npc) {
    const here = sim.actors.find(a => a.def === npc && !a.dead);
    if (here) return { map: sim.map.id, x: here.x / TILE, y: here.y / TILE, npc };
    for (const m of Object.values(MAPS)) {
      const e = m.entities.find(x => x.type === "npc" && x.id === npc);
      if (e) return { map: m.id, x: e.x, y: e.y, npc };
    }
    return null;
  }
  if (step.goal.kind === "reach") return { map: step.goal.map, x: step.goal.x, y: step.goal.y };
  void NPCS;
  return null;
}

/** First exit on the shortest map-to-map route. */
function routeExit(from: MapId, to: MapId) {
  const prev = new Map<MapId, { map: MapId; exit: Extract<import("./contract").EntityPlacement, { type: "exit" }> }>();
  const queue: MapId[] = [from];
  const seen = new Set<MapId>([from]);
  while (queue.length) {
    const m = queue.shift()!;
    if (m === to) break;
    for (const e of MAPS[m]?.entities ?? []) {
      if (e.type !== "exit" || seen.has(e.to)) continue;
      seen.add(e.to);
      prev.set(e.to, { map: m, exit: e });
      queue.push(e.to);
    }
  }
  if (!prev.has(to)) return null;
  let cur: MapId = to;
  for (;;) {
    const p = prev.get(cur)!;
    if (p.map === from) return p.exit;
    cur = p.map;
  }
}

export const createGame: CreateGame = (canvas, options) => new Game05Engine(canvas, options);
