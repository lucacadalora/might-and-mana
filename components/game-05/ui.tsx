"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import type { Action, Device } from "@/lib/game-05/contract";
import type { HostMenuCommand } from "@/lib/game-05/input/game05-input";
import type { UiCue } from "@/lib/game-05/audio";
import { EMPTY_ASSETS, iconKeys, portraitSrc } from "./assets";
import type { UiAssets } from "./assets";

export const UI_BASE = "/games/game-05/ui";

// ─── Menu bus: the top-most screen gets every command ──────────────────────────────────────────
export type MenuListener = (command: HostMenuCommand) => void;
export interface MenuBus { emit(command: HostMenuCommand): boolean; subscribe(listener: MenuListener): () => void; size(): number }

export function createMenuBus(): MenuBus {
  const stack: MenuListener[] = [];
  return {
    emit(command) {
      const top = stack[stack.length - 1];
      if (!top) return false;
      top(command);
      return true;
    },
    subscribe(listener) {
      stack.push(listener);
      return () => { const i = stack.lastIndexOf(listener); if (i >= 0) stack.splice(i, 1); };
    },
    size: () => stack.length,
  };
}

export interface Ui {
  bus: MenuBus;
  sound(cue: UiCue): void;
  device: Device;
  assets: UiAssets;
  /** Return keyboard focus to the stage after a pointer interaction. */
  focusStage(): void;
}
export const UiContext = createContext<Ui>({
  bus: createMenuBus(), sound: () => {}, device: "keyboard", assets: EMPTY_ASSETS, focusStage: () => {},
});
export const useUi = () => useContext(UiContext);

/** Listen to menu commands while mounted and enabled; later mounts sit on top of earlier ones. */
export function useMenu(handler: MenuListener, enabled = true): void {
  const { bus } = useUi();
  const latest = useRef(handler);
  useEffect(() => { latest.current = handler; });
  useEffect(() => {
    if (!enabled) return;
    return bus.subscribe(command => latest.current(command));
  }, [bus, enabled]);
}

export const clamp01 = (v: number) => Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0));
export const fmt = (n: number) => Math.max(0, Math.floor(n)).toLocaleString("en-US");
export const px = (n: number) => `calc(var(--u) * ${n})`;
export const tx = (n: number) => `calc(var(--t) * ${n})`;

// ─── Icons, portraits, pixel images ────────────────────────────────────────────────────────────
/**
 * An item or UI icon at an integer scale. Atlas item icons are 24×24 art px and UI glyphs 16×16;
 * the icon sits centred in a square box of `box` art px (default 24) so rows and slots line up
 * whatever the source size. `small` prefers the 16 px UI-sheet drawing (inline coins, notices).
 * `cssPx` sizes the image in CSS px per art px instead of the world grid (touch buttons, which
 * are sized in CSS px for the thumb).
 */
export function Icon({ id, scale = 1, box, small = false, cssPx, className = "", dim = false }: {
  id: string; scale?: number; box?: number; small?: boolean; cssPx?: number; className?: string; dim?: boolean;
}) {
  const { assets } = useUi();
  const keys = iconKeys(id);
  const fallbackIndex = assets.fallback[keys.fallback];
  const src = small && fallbackIndex !== undefined ? undefined : assets.icons[keys.atlas];
  const [natural, setNatural] = useState<{ src: string; w: number; h: number } | null>(null);
  const cls = `g5-icon${dim ? " is-dim" : ""} ${className}`;
  const size = (n: number) => cssPx ? `${n * cssPx}px` : px(n * scale);
  const boxSize = box ?? (small ? 16 : 24);
  const outer: CSSProperties = { width: size(boxSize), height: size(boxSize) };
  if (src) {
    const nat = natural?.src === src ? natural : null;
    return <span className={cls} style={outer} aria-hidden="true">
      {/* pixel art is drawn 1:1 */}
      <img src={src} alt="" draggable={false}
        onLoad={event => setNatural({ src, w: event.currentTarget.naturalWidth, h: event.currentTarget.naturalHeight })}
        style={{ width: size(nat?.w ?? 24), height: size(nat?.h ?? 24), visibility: nat ? "visible" : "hidden" }} />
    </span>;
  }
  if (fallbackIndex === undefined) return <span className={`${cls} g5-icon-missing`} style={outer} aria-hidden="true" />;
  const cols = assets.fallbackCols || 8;
  const sprite: CSSProperties = {
    width: size(16), height: size(16),
    backgroundImage: `url(${UI_BASE}/icons.png)`,
    backgroundSize: `${size(cols * 16)} auto`,
    backgroundPosition: `${size(-(fallbackIndex % cols) * 16)} ${size(-Math.floor(fallbackIndex / cols) * 16)}`,
  };
  return <span className={cls} style={outer} aria-hidden="true"><i className="g5-icon-sprite" style={sprite} /></span>;
}

export function Portrait({ id, name, className = "" }: { id?: string; name?: string; className?: string }) {
  const { assets } = useUi();
  const src = portraitSrc(assets, id);
  return <span className={`g5-portrait ${className}`} aria-hidden="true">
    {/* pixel art is drawn 1:1 */}
    {src ? <img src={src} alt="" draggable={false} /> : <span className="g5-portrait-blank">{(name ?? "?").slice(0, 1)}</span>}
  </span>;
}

/** The hero's standing frame from the atlas, trimmed to its opaque pixels and drawn at an
 *  integer scale (paper doll). Frames are padded for wide attack poses, so the trim matters. */
export function HeroDoll({ scale = 2 }: { scale?: number }) {
  const { assets } = useUi();
  const ref = useRef<HTMLCanvasElement>(null);
  const frame = assets.hero;
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !frame) return;
    let live = true;
    const img = new Image();
    img.onload = () => {
      if (!live) return;
      const work = document.createElement("canvas");
      work.width = frame.w; work.height = frame.h;
      const wctx = work.getContext("2d", { willReadFrequently: true });
      const ctx = canvas.getContext("2d");
      if (!wctx || !ctx) return;
      wctx.drawImage(img, frame.x, frame.y, frame.w, frame.h, 0, 0, frame.w, frame.h);
      const data = wctx.getImageData(0, 0, frame.w, frame.h).data;
      let x0 = frame.w, y0 = frame.h, x1 = -1, y1 = -1;
      for (let y = 0; y < frame.h; y++) for (let x = 0; x < frame.w; x++) {
        if (data[(y * frame.w + x) * 4 + 3] > 8) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
      }
      if (x1 < 0) { x0 = 0; y0 = 0; x1 = frame.w - 1; y1 = frame.h - 1; }
      const w = x1 - x0 + 1, h = y1 - y0 + 1;
      canvas.width = w; canvas.height = h;
      ctx.imageSmoothingEnabled = false;
      ctx.clearRect(0, 0, w, h);
      ctx.drawImage(work, x0, y0, w, h, 0, 0, w, h);
      setSize({ w, h });
    };
    img.src = frame.image;
    return () => { live = false; };
  }, [frame]);
  if (!frame) return <span className="g5-doll-blank" aria-hidden="true" />;
  return <canvas ref={ref} className="g5-doll" aria-hidden="true"
    style={size ? { width: px(size.w * scale), height: px(size.h * scale) } : { width: 0, height: 0 }} />;
}

// ─── Button glyphs per device ──────────────────────────────────────────────────────────────────
export type GlyphAction = Action | "ok" | "back" | "start" | "prev" | "next" | "move";
const KEY_LABELS: Record<GlyphAction, string> = {
  attack: "J", magic: "K", dodge: "L", item: "I", nextSpell: "Tab", map: "M", status: "Q", pause: "Esc",
  ok: "J", back: "L", start: "P", prev: "Q", next: "E", move: "WASD",
};
const PAD_LABELS: Record<GlyphAction, string> = {
  attack: "a", magic: "x", dodge: "b", item: "y", nextSpell: "RB", map: "View", status: "LB", pause: "Start",
  ok: "a", back: "b", start: "Start", prev: "LB", next: "RB", move: "L",
};
const TOUCH_ICONS: Partial<Record<GlyphAction, string>> = {
  attack: "ui.sword", magic: "ui.magic", dodge: "ui.dodge", item: "ui.bag", map: "ui.map", status: "ui.status", pause: "ui.pause",
};

/** Menu actions have no glyph on touch: the thing on screen is what you tap. */
const MENU_ACTIONS = new Set<GlyphAction>(["ok", "back", "start", "prev", "next", "move"]);

export function Glyph({ action, device }: { action: GlyphAction; device?: Device }) {
  const ui = useUi();
  const d = device ?? ui.device;
  if (d === "touch" && MENU_ACTIONS.has(action)) return null;
  if (d === "gamepad") {
    const label = PAD_LABELS[action];
    if (label.length === 1) return <i className={`g5-glyph g5-pad g5-pad-${label}`} aria-label={`${label.toUpperCase()} button`} />;
    return <kbd className="g5-glyph g5-key g5-key-pad">{label}</kbd>;
  }
  if (d === "touch") {
    const icon = TOUCH_ICONS[action];
    if (icon) return <span className="g5-glyph g5-touch-glyph"><Icon id={icon} small /></span>;
    return <kbd className="g5-glyph g5-key g5-key-touch">Tap</kbd>;
  }
  return <kbd className="g5-glyph g5-key">{KEY_LABELS[action]}</kbd>;
}

// ─── Bars and pointer ──────────────────────────────────────────────────────────────────────────
export function Bar({ value, max, kind, className = "", segments = 0 }: { value: number; max: number; kind: string; className?: string; segments?: number }) {
  const pct = max > 0 ? clamp01(value / max) : 0;
  return <span className={`g5-bar g5-bar-${kind} ${className}`} data-low={pct <= 0.25 ? "true" : undefined}>
    <span className="g5-bar-ghost" style={{ transform: `scaleX(${pct})` }} />
    <span className="g5-bar-fill" style={{ transform: `scaleX(${pct})` }} />
    {segments > 1 && <span className="g5-bar-ticks" style={{ backgroundSize: `${100 / segments}% 100%` }} />}
  </span>;
}

export const Pointer = ({ className = "" }: { className?: string }) => <i className={`g5-pointer ${className}`} aria-hidden="true" />;

// ─── Menu list with a pointer (keyboard, pad and touch) ────────────────────────────────────────
export interface MenuItem {
  key: string;
  label: ReactNode;
  sub?: ReactNode;
  right?: ReactNode;
  disabled?: boolean;
  onSelect: () => void;
}

export function useCursor(count: number, initial = 0): [number, (value: number) => void] {
  const [cursor, setCursor] = useState(initial);
  const safe = count > 0 ? Math.max(0, Math.min(count - 1, cursor)) : 0;
  return [safe, setCursor];
}

export function MenuList({ items, cursor, setCursor, onBack, className = "", active = true, wrap = true, extra }: {
  items: MenuItem[]; cursor: number; setCursor: (value: number) => void; onBack?: () => void; className?: string;
  active?: boolean; wrap?: boolean; extra?: (command: HostMenuCommand) => boolean;
}) {
  const { sound, focusStage } = useUi();
  const move = useCallback((delta: number) => {
    if (!items.length) return;
    let next = cursor;
    for (let i = 0; i < items.length; i++) {
      next = wrap ? (next + delta + items.length) % items.length : Math.max(0, Math.min(items.length - 1, next + delta));
      if (!items[next].disabled) break;
    }
    if (next !== cursor) { setCursor(next); sound("move"); }
  }, [cursor, items, setCursor, sound, wrap]);
  const choose = useCallback((index: number) => {
    const item = items[index];
    if (!item) return;
    if (item.disabled) { sound("deny"); return; }
    sound("ok");
    item.onSelect();
  }, [items, sound]);
  useMenu(command => {
    if (extra?.(command)) return;
    if (command === "up") move(-1);
    else if (command === "down") move(1);
    else if (command === "ok") choose(cursor);
    else if (command === "back" && onBack) { sound("back"); onBack(); }
  }, active);
  return <ul className={`g5-menu ${className}`} role="menu">
    {items.map((item, index) => <li key={item.key} role="none">
      <button type="button" role="menuitem" tabIndex={-1}
        className={`g5-menu-item${index === cursor ? " is-on" : ""}${item.disabled ? " is-disabled" : ""}`}
        aria-disabled={item.disabled || undefined}
        onPointerEnter={event => { if (event.pointerType === "mouse" && !item.disabled && index !== cursor) setCursor(index); }}
        onClick={() => { setCursor(index); choose(index); focusStage(); }}>
        {index === cursor && <Pointer />}
        <span className="g5-menu-label">{item.label}{item.sub && <small>{item.sub}</small>}</span>
        {item.right !== undefined && <span className="g5-menu-right">{item.right}</span>}
      </button>
    </li>)}
  </ul>;
}

/** Small Yes/No box used by buy, overwrite, retry and quit prompts. */
export function Confirm({ message, detail, yes = "Yes", no = "No", onYes, onNo, danger = false }: {
  message: ReactNode; detail?: ReactNode; yes?: string; no?: string; onYes: () => void; onNo: () => void; danger?: boolean;
}) {
  const [cursor, setCursor] = useCursor(2, danger ? 1 : 0);
  return <div className="g5-confirm-layer" role="alertdialog" aria-label={typeof message === "string" ? message : "Confirm"}>
    <div className="g5-paper g5-confirm">
      <p className="g5-confirm-text">{message}</p>
      {detail && <div className="g5-confirm-detail">{detail}</div>}
      <MenuList className="g5-confirm-menu" cursor={cursor} setCursor={setCursor} onBack={onNo}
        items={[{ key: "yes", label: yes, onSelect: onYes }, { key: "no", label: no, onSelect: onNo }]} />
    </div>
  </div>;
}

/** Back / close button in a card's top-right corner (the way out for touch and mouse). */
export function CardClose({ onClick, label = "Back" }: { onClick: () => void; label?: string }) {
  const { sound, focusStage } = useUi();
  return <button type="button" tabIndex={-1} className="g5-close g5-card-close" aria-label={label}
    onClick={event => { event.stopPropagation(); sound("back"); onClick(); focusStage(); }} />;
}

/** Hint strip: "[J] Select  [L] Back". Touch shows none: every control is tapped directly. */
export function Hints({ items }: { items: Array<[GlyphAction, string]> }) {
  const { device } = useUi();
  if (device === "touch") return null;
  return <div className="g5-hints">
    {items.map(([action, label]) => <span key={`${action}-${label}`} className="g5-hint"><Glyph action={action} />{label}</span>)}
  </div>;
}
