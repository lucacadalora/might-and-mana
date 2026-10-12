import type { Action, Device, InputFrame, MenuCommand } from "../contract";

/**
 * Game 05 input: keyboard, standard gamepad and touch merged into the contract's InputFrame
 * (+x = screen right, +y = screen DOWN) while playing, or into menu commands while a menu is
 * open. Adapted from Game 04's focus-scoped input (no cross-game import).
 *
 * Play mode   keys per DIRECTION.md: WASD/arrows move · J/Z/Space/Enter attack (hold = charge) ·
 *             K/X magic · L/C/Shift dodge · I/V items · Tab next spell · M map · Q status ·
 *             Esc/P pause. Pad: left stick or d-pad move · A attack · X magic · B dodge · Y items ·
 *             RB next spell · LB status · Select map · Start pause.
 * Menu mode   arrows/WASD or d-pad/stick (repeat after 300 ms, then every 110 ms) · ok = J/Z/Enter/
 *             Space or A · back = L/C/Shift/Backspace/Esc or B · start = P or Start · prev/next tab =
 *             Q/E (Tab = next) or LB/RB · map = M or Select · item = I/V or Y.
 *
 * Every mode change, suspend and clear blocks whatever is still held until it is released, so the
 * A that closed a menu never swings the sword and the Start that paused never unpauses.
 */
export type HostMenuCommand = MenuCommand | "prev" | "next" | "map" | "status" | "item";
export type InputMode = "play" | "menu" | "off";
export type TouchControl = Action;
export type AutoPauseReason = "blur" | "hidden" | "disconnect";

export interface Game05InputOptions {
  gamepadDeadzone?: number;
  /** Called once per automatic suspension (window blur, hidden tab, active pad unplugged). */
  onAutoPause?: (reason: AutoPauseReason) => void;
  /** Menu-mode commands from the keyboard and gamepad. */
  onMenu?: (command: HostMenuCommand, device: Device) => void;
  /** The last-used device changed. */
  onDevice?: (device: Device) => void;
}

export const ACTIONS: readonly Action[] = ["attack", "magic", "dodge", "item", "nextSpell", "map", "status", "pause"];

const PLAY_KEYS: Readonly<Record<string, Action>> = {
  KeyJ: "attack", KeyZ: "attack", Space: "attack", Enter: "attack", NumpadEnter: "attack",
  KeyK: "magic", KeyX: "magic",
  KeyL: "dodge", KeyC: "dodge", ShiftLeft: "dodge", ShiftRight: "dodge",
  KeyI: "item", KeyV: "item",
  Tab: "nextSpell",
  KeyM: "map",
  KeyQ: "status",
  Escape: "pause", KeyP: "pause",
};
const MOVE_KEYS: Readonly<Record<string, [number, number]>> = {
  KeyW: [0, -1], ArrowUp: [0, -1], KeyS: [0, 1], ArrowDown: [0, 1],
  KeyA: [-1, 0], ArrowLeft: [-1, 0], KeyD: [1, 0], ArrowRight: [1, 0],
};
const MENU_KEYS: Readonly<Record<string, HostMenuCommand>> = {
  ArrowUp: "up", KeyW: "up", ArrowDown: "down", KeyS: "down",
  ArrowLeft: "left", KeyA: "left", ArrowRight: "right", KeyD: "right",
  KeyJ: "ok", KeyZ: "ok", Enter: "ok", NumpadEnter: "ok", Space: "ok",
  KeyL: "back", KeyC: "back", ShiftLeft: "back", ShiftRight: "back", Backspace: "back", Escape: "back",
  KeyP: "start",
  KeyQ: "prev", KeyE: "next", Tab: "next",
  KeyM: "map", KeyI: "item", KeyV: "item",
};
/** Keys still honoured in menu mode while a text field (the name entry) has focus. */
const TEXT_FIELD_MENU_KEYS = new Set(["Enter", "NumpadEnter", "Escape", "ArrowUp", "ArrowDown", "Tab"]);
const DIRECTIONS = new Set<HostMenuCommand>(["up", "down", "left", "right"]);

/** Standard-mapping gamepad buttons. */
const PAD = { a: 0, b: 1, x: 2, y: 3, lb: 4, rb: 5, select: 8, start: 9, up: 12, down: 13, left: 14, right: 15 } as const;
const PAD_PLAY: Readonly<Record<number, Action>> = {
  [PAD.a]: "attack", [PAD.x]: "magic", [PAD.b]: "dodge", [PAD.y]: "item",
  [PAD.rb]: "nextSpell", [PAD.lb]: "status", [PAD.select]: "map", [PAD.start]: "pause",
};
const PAD_MENU: Readonly<Record<number, HostMenuCommand>> = {
  [PAD.a]: "ok", [PAD.b]: "back", [PAD.start]: "start", [PAD.lb]: "prev", [PAD.rb]: "next",
  [PAD.select]: "map", [PAD.y]: "item",
  [PAD.up]: "up", [PAD.down]: "down", [PAD.left]: "left", [PAD.right]: "right",
};
const MENU_STICK_DEADZONE = 0.5;
const REPEAT_DELAY = 300;
const REPEAT_EVERY = 110;

const finite = (value: number, fallback = 0): number => Number.isFinite(value) ? value : fallback;
const clamp1 = (value: number): number => Math.max(-1, Math.min(1, finite(value)));
function normalize(x: number, y: number): [number, number] {
  const length = Math.hypot(x, y);
  return length > 1 ? [x / length, y / length] : [x, y];
}
function emptyPressed(): Record<Action, boolean> {
  return { attack: false, magic: false, dodge: false, item: false, nextSpell: false, map: false, status: false, pause: false };
}
export function emptyInputFrame(device: Device = "keyboard"): InputFrame {
  return { moveX: 0, moveY: 0, pressed: emptyPressed(), held: { attack: false }, device };
}

export class Game05Input {
  private readonly doc: Document;
  private readonly win: Window;
  private readonly deadzone: number;
  private attached = false;
  /** Manual suspension (leaving the page); only resume() lifts it. */
  private suspended = false;
  /** When the last automatic pause fired (blur and hidden often arrive together). */
  private lastAutoPause = -Infinity;
  private windowFocused = true;
  private modeValue: InputMode = "play";
  private lastDevice: Device = "keyboard";
  private listeners: Array<() => void> = [];
  private keys = new Set<string>();
  private blockedKeys = new Set<string>();
  /** Queued action edges by the sources that pressed them (a canceled touch drops its own). */
  private pressed = new Map<Action, Set<string>>();
  private touchMoves = new Map<number, [number, number]>();
  private touchControls = new Map<number, Set<TouchControl>>();
  private blockedTouches = new Set<number>();
  private padIdentity: string | null = null;
  private padIndex: number | null = null;
  private padButtons = new Set<number>();
  private blockedPad = new Set<number>();
  private padAxesBlocked = false;
  private padMenuHeld = new Set<HostMenuCommand>();
  private padRepeatAt = new Map<HostMenuCommand, number>();

  constructor(private readonly stage: HTMLElement, private readonly options: Game05InputOptions = {}) {
    this.doc = stage.ownerDocument;
    const win = this.doc.defaultView;
    if (!win) throw new TypeError("Game stage must belong to a browser document.");
    this.win = win;
    this.deadzone = Math.max(0, Math.min(0.9, finite(options.gamepadDeadzone ?? 0.18, 0.18)));
  }

  get device(): Device { return this.lastDevice; }
  get mode(): InputMode { return this.modeValue; }

  /** Switch between play and menu input; anything still held must be released first. */
  setMode(mode: InputMode): void {
    if (mode === this.modeValue) return;
    this.modeValue = mode;
    this.clear();
  }

  attach(): void {
    if (this.attached) return;
    this.attached = true;
    this.suspended = false;
    this.lastAutoPause = -Infinity;
    this.windowFocused = this.doc.hasFocus();
    const listen = <T extends Event>(target: EventTarget, type: string, handler: (event: T) => void, options?: AddEventListenerOptions) => {
      const listener = handler as EventListener;
      target.addEventListener(type, listener, options);
      this.listeners.push(() => target.removeEventListener(type, listener, options));
    };
    listen(this.doc, "keydown", (event: KeyboardEvent) => this.keyDown(event));
    listen(this.doc, "keyup", (event: KeyboardEvent) => {
      this.keys.delete(event.code);
      this.blockedKeys.delete(event.code);
    });
    const endPointer = (event: PointerEvent) => this.release(event.pointerId, event.type !== "pointerup");
    listen(this.doc, "pointerup", endPointer);
    listen(this.doc, "pointercancel", endPointer);
    // Losing the window or the tab pauses the game and drops held input; coming back needs no
    // extra step (the pause menu is waiting), and keys still held must be pressed again.
    listen(this.win, "blur", () => {
      // Focus that moves into a frame inside this page (the site's hidden sign-in frame does this
      // on its own) is not the player leaving: take it back instead of pausing.
      this.win.setTimeout(() => {
        if (!this.attached) return;
        const frame = this.doc.activeElement;
        if (this.doc.hasFocus() && frame?.tagName === "IFRAME" && !this.visibleFrame(frame as HTMLIFrameElement)) {
          this.windowFocused = true;
          this.stage.focus({ preventScroll: true });
          return;
        }
        if (this.doc.hasFocus()) return;
        this.windowFocused = false;
        this.autoPause("blur");
      }, 0);
    });
    listen(this.win, "focus", () => { this.windowFocused = true; this.clear(); });
    listen(this.doc, "visibilitychange", () => { if (this.doc.hidden) this.autoPause("hidden"); else this.clear(); });
    listen(this.doc, "focusin", () => { if (!this.ownsFocus()) this.clear(); });
    listen(this.win, "gamepaddisconnected", (event: GamepadEvent) => {
      if (event.gamepad.index !== this.padIndex) return;
      const pause = this.active() && this.lastDevice === "gamepad";
      this.resetPad();
      if (pause) this.autoPause("disconnect");
    });
    this.clear();
  }

  dispose(): void {
    this.clear();
    this.attached = false;
    for (const remove of this.listeners) remove();
    this.listeners = [];
    this.blockedKeys.clear();
    this.blockedTouches.clear();
    this.resetPad();
  }

  /** Drop queued edges; controls held right now stay blocked until released. */
  clear(): void {
    for (const key of this.keys) this.blockedKeys.add(key);
    for (const pointer of [...this.touchMoves.keys(), ...this.touchControls.keys()]) this.blockedTouches.add(pointer);
    this.keys.clear();
    this.touchMoves.clear();
    this.touchControls.clear();
    this.pressed.clear();
    for (const button of this.padButtons) this.blockedPad.add(button);
    this.padAxesBlocked = true;
    this.padMenuHeld.clear();
    this.padRepeatAt.clear();
  }

  suspend(): void { this.suspended = true; this.clear(); }
  resume(): void { this.clear(); this.suspended = false; }

  /** Touch stick, +y = screen down. Each pointer is independent. */
  setMove(pointerId: number, x: number, y: number): void {
    if (!this.attached || this.suspended || this.blockedTouches.has(pointerId)) return;
    this.touchMoves.set(pointerId, normalize(clamp1(x), clamp1(y)));
    this.noteDevice("touch");
  }

  /** Touch buttons: down queues an edge; attack stays held for the charge until released. */
  setButton(pointerId: number, control: TouchControl, down: boolean): void {
    if (!down) { this.touchControls.get(pointerId)?.delete(control); return; }
    if (!this.attached || this.suspended || this.blockedTouches.has(pointerId)) return;
    const controls = this.touchControls.get(pointerId) ?? new Set<TouchControl>();
    if (!controls.has(control)) this.queue(control, `touch:${pointerId}`);
    controls.add(control);
    this.touchControls.set(pointerId, controls);
    this.noteDevice("touch");
  }

  /** Normal pointerup keeps a quick tap's edge; cancel drops this pointer's unconsumed edges. */
  release(pointerId: number, cancel = false): void {
    const tracked = this.touchMoves.has(pointerId) || this.touchControls.has(pointerId);
    this.touchMoves.delete(pointerId);
    this.touchControls.delete(pointerId);
    this.blockedTouches.delete(pointerId);
    if (cancel && tracked) this.discardSource(`touch:${pointerId}`);
  }

  /** Mark touch as the active device (a tap on a menu, the stage, or a touch control). */
  noteTouch(): void { this.noteDevice("touch"); }

  /**
   * Call once per animation frame. In play mode it returns movement and action edges; in menu
   * mode it returns an empty frame and emits gamepad menu commands (with repeat) via onMenu.
   */
  frame(now = performance.now()): InputFrame {
    const pad = this.samplePad(now);
    const frame = emptyInputFrame(this.lastDevice);
    if (this.modeValue !== "play" || !this.active()) {
      this.pressed.clear();
      return frame;
    }
    // Pause wins the frame: nothing else leaks into a pausing simulation.
    if (this.pressed.has("pause")) {
      this.clear();
      frame.pressed.pause = true;
      return frame;
    }
    let x = pad.x, y = pad.y;
    for (const code of this.keys) {
      const move = MOVE_KEYS[code];
      if (move) { x += move[0]; y += move[1]; }
    }
    for (const move of this.touchMoves.values()) { x += move[0]; y += move[1]; }
    [frame.moveX, frame.moveY] = normalize(x, y);
    let held = pad.attack;
    for (const code of this.keys) if (PLAY_KEYS[code] === "attack") held = true;
    for (const controls of this.touchControls.values()) if (controls.has("attack")) held = true;
    frame.held.attack = held;
    for (const action of this.pressed.keys()) frame.pressed[action] = true;
    this.pressed.clear();
    return frame;
  }

  private keyDown(event: KeyboardEvent): void {
    if (!this.attached || this.suspended || event.altKey || event.metaKey || event.ctrlKey) return;
    if (!this.windowFocused || this.doc.hidden || !this.ownsFocus()) return;
    const textField = this.isTextField(event.target);
    if (this.modeValue === "menu") {
      const command = MENU_KEYS[event.code];
      if (!command) return;
      if (textField && !TEXT_FIELD_MENU_KEYS.has(event.code)) return;
      // A key held through a mode change must be released before it counts again.
      if (this.blockedKeys.has(event.code)) { event.preventDefault(); return; }
      event.preventDefault();
      if (event.repeat && !DIRECTIONS.has(command)) return;
      this.noteDevice("keyboard");
      this.options.onMenu?.(command, "keyboard");
      return;
    }
    if (this.modeValue !== "play" || textField) return;
    const action = PLAY_KEYS[event.code];
    if (!action && !MOVE_KEYS[event.code]) return;
    event.preventDefault();
    if (event.repeat || this.blockedKeys.has(event.code) || this.keys.has(event.code)) return;
    this.keys.add(event.code);
    this.noteDevice("keyboard");
    if (action) this.queue(action, `key:${event.code}`);
  }

  private samplePad(now: number): { x: number; y: number; attack: boolean } {
    const none = { x: 0, y: 0, attack: false };
    let pad: Gamepad | undefined;
    try {
      const pads = Array.from(this.win.navigator.getGamepads?.() ?? [])
        .filter((value): value is Gamepad => Boolean(value?.connected && value.mapping === "standard"));
      const current = pads.find(value => `${value.index}:${value.id}` === this.padIdentity);
      if (this.padIdentity !== null && !current) {
        const pause = this.active() && this.lastDevice === "gamepad";
        this.resetPad();
        if (pause) this.autoPause("disconnect");
      }
      pad = current ?? pads[0];
    } catch { return none; }
    if (!pad) return none;
    const identity = `${pad.index}:${pad.id}`;
    let suppress = !this.active();
    if (identity !== this.padIdentity) {
      this.resetPad();
      this.padIdentity = identity;
      this.padIndex = pad.index;
      suppress = true;
    }
    const down = new Set<number>();
    pad.buttons.forEach((button, index) => { if (button.pressed || finite(button.value) > 0.5) down.add(index); });
    for (const button of this.blockedPad) if (!down.has(button)) this.blockedPad.delete(button);
    if (suppress) for (const button of down) this.blockedPad.add(button);
    const live = (button: number) => down.has(button) && !this.blockedPad.has(button);
    const ax = clamp1(pad.axes[0] ?? 0), ay = clamp1(pad.axes[1] ?? 0);
    const length = Math.hypot(ax, ay);
    const strength = length <= this.deadzone ? 0 : Math.min(1, (length - this.deadzone) / (1 - this.deadzone));
    if (suppress) this.padAxesBlocked = strength > 0 || this.padAxesBlocked;
    if (!strength) this.padAxesBlocked = false;
    const stickLive = !this.padAxesBlocked && strength > 0;

    if (this.modeValue === "menu" && !suppress) {
      const held = new Set<HostMenuCommand>();
      for (const [button, command] of Object.entries(PAD_MENU)) if (live(Number(button))) held.add(command);
      if (stickLive && length >= MENU_STICK_DEADZONE) {
        if (Math.abs(ax) > Math.abs(ay)) held.add(ax < 0 ? "left" : "right");
        else held.add(ay < 0 ? "up" : "down");
      }
      for (const command of held) {
        if (!this.padMenuHeld.has(command)) {
          this.emitMenu(command);
          if (DIRECTIONS.has(command)) this.padRepeatAt.set(command, now + REPEAT_DELAY);
        } else if (DIRECTIONS.has(command) && now >= (this.padRepeatAt.get(command) ?? Infinity)) {
          this.emitMenu(command);
          this.padRepeatAt.set(command, now + REPEAT_EVERY);
        }
      }
      for (const command of [...this.padRepeatAt.keys()]) if (!held.has(command)) this.padRepeatAt.delete(command);
      this.padMenuHeld = held;
      this.padButtons = down;
      return none;
    }
    if (this.modeValue !== "play" || suppress) { this.padButtons = down; return none; }
    for (const button of down) {
      const action = PAD_PLAY[button];
      if (action && !this.padButtons.has(button) && !this.blockedPad.has(button)) {
        this.queue(action, `pad:${button}`);
        this.noteDevice("gamepad");
      }
    }
    this.padButtons = down;
    let x = 0, y = 0;
    if (stickLive) { x = ax / length * strength; y = ay / length * strength; }
    x += Number(live(PAD.right)) - Number(live(PAD.left));
    y += Number(live(PAD.down)) - Number(live(PAD.up));
    const attack = live(PAD.a);
    if (x || y || attack) this.noteDevice("gamepad");
    return { x, y, attack };
  }

  private emitMenu(command: HostMenuCommand): void {
    this.noteDevice("gamepad");
    try { this.options.onMenu?.(command, "gamepad"); } catch { /* A failing screen never breaks polling. */ }
  }
  private noteDevice(device: Device): void {
    if (device === this.lastDevice) return;
    this.lastDevice = device;
    try { this.options.onDevice?.(device); } catch { /* Host UI errors stay in the host. */ }
  }
  private visibleFrame(frame: HTMLIFrameElement): boolean {
    const rect = frame.getBoundingClientRect();
    const style = this.win.getComputedStyle(frame);
    return rect.width * rect.height > 400 && style.visibility !== "hidden" && style.display !== "none" && Number(style.opacity) > 0.05;
  }
  private ownsFocus(): boolean {
    const focused = this.doc.activeElement;
    return focused === null || focused === this.doc.body || focused === this.stage || this.stage.contains(focused);
  }
  private active(): boolean {
    return this.attached && !this.suspended && this.windowFocused && !this.doc.hidden && this.ownsFocus();
  }
  private isTextField(target: EventTarget | null): boolean {
    const element = target as Element | null;
    return typeof element?.closest === "function"
      && Boolean(element.closest("input,textarea,select,[contenteditable]:not([contenteditable='false']),[data-game-input-ignore]"));
  }
  private queue(action: Action, source: string): void {
    const sources = this.pressed.get(action) ?? new Set<string>();
    sources.add(source);
    this.pressed.set(action, sources);
  }
  private discardSource(source: string): void {
    for (const [action, sources] of this.pressed) {
      sources.delete(source);
      if (!sources.size) this.pressed.delete(action);
    }
  }
  private autoPause(reason: AutoPauseReason): void {
    this.clear();
    const now = typeof performance !== "undefined" ? performance.now() : Date.now();
    if (now - this.lastAutoPause < 400) return;
    this.lastAutoPause = now;
    try { this.options.onAutoPause?.(reason); } catch { /* Cleanup stays effective if the host fails. */ }
  }
  private resetPad(): void {
    for (const sources of this.pressed.values()) for (const source of [...sources]) if (source.startsWith("pad:")) sources.delete(source);
    for (const [action, sources] of this.pressed) if (!sources.size) this.pressed.delete(action);
    this.padIdentity = null;
    this.padIndex = null;
    this.padButtons.clear();
    this.blockedPad.clear();
    this.padAxesBlocked = true;
    this.padMenuHeld.clear();
    this.padRepeatAt.clear();
  }
}
