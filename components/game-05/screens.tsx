"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Device } from "@/lib/game-05/contract";
import { DEFAULT_NAME, formatPlayTime, formatSavedAt, NAME_MAX, cleanName } from "@/lib/game-05/save";
import type { Preferences, SlotId, SlotMeta } from "@/lib/game-05/save";
import { TitleArt } from "./title-art";
import { CardClose, Confirm, Glyph, Hints, MenuList, Pointer, useCursor, useMenu, useUi } from "./ui";
import type { GlyphAction, MenuItem } from "./ui";

/** Where "Shelf" leads: the arcade this game ships on. */
export const SHELF_URL = "https://gamescool.id/";

// ─── Loading ───────────────────────────────────────────────────────────────────────────────────
const TIPS = [
  "Tall grass hides coins, herbs and the odd root. Swing freely.",
  "Tap attack in rhythm to chain a combo. Mashing only restarts it.",
  "The arrow at the edge of the screen always points to your next goal.",
  "Resting at the inn is free, heals you fully and turns day to night.",
  "A dodge roll makes you untouchable for a moment. Use it through attacks.",
  "Blue numbers in a shop mean better. Orange means worse.",
];

export function Loading({ progress, error, onRetry }: { progress: number; error: string | null; onRetry: () => void }) {
  // The first tip is the same on the server and the client; later tips rotate while loading.
  const [tipIndex, setTipIndex] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTipIndex(i => (i + 1) % TIPS.length), 3500);
    return () => clearInterval(id);
  }, []);
  const tip = TIPS[tipIndex];
  useMenu(command => { if (error && (command === "ok" || command === "start")) onRetry(); }, !!error);
  return <div className="g5-loading" role="status" aria-live="polite">
    <div className="g5-loading-box">
      <div className="g5-loading-title">{error ? "Something went wrong" : "Loading"}</div>
      {error ? <>
        <p className="g5-loading-tip">{error}</p>
        <button type="button" className="g5-button" onClick={onRetry}><Glyph action="ok" />Try again</button>
      </> : <>
        <span className="g5-bar g5-bar-load"><span className="g5-bar-fill" style={{ transform: `scaleX(${Math.max(0.03, progress)})` }} /></span>
        <p className="g5-loading-tip">{tip}</p>
      </>}
    </div>
  </div>;
}

// ─── Title ─────────────────────────────────────────────────────────────────────────────────────
export function TitleArtCanvas({ reducedMotion, dim = false }: { reducedMotion: boolean; dim?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    // The painted key art is the title screen; the procedural scene covers the moment before it loads
    // (and stands in if it cannot load).
    let art: TitleArt | null = new TitleArt(canvas, reducedMotion);
    let key: HTMLImageElement | null = null;
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      if (key) drawKeyart(canvas, key, rect.width, rect.height, dpr);
      else art?.resize(rect.width, rect.height, dpr);
    };
    const img = new Image();
    img.decoding = "async";
    img.onload = () => {
      if (!ref.current) return;
      key = img;
      art?.dispose();
      art = null;
      resize();
    };
    img.src = "/games/game-05/keyart-480x270.webp";
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    resize();
    art.run();
    return () => { observer.disconnect(); art?.dispose(); img.onload = null; };
  }, [reducedMotion]);
  return <canvas ref={ref} className={`g5-title-art${dim ? " is-dim" : ""}`} aria-hidden="true" />;
}

/** Draw the 480×270 key art to cover the canvas at a whole-number device-pixel scale, centred. */
function drawKeyart(canvas: HTMLCanvasElement, img: HTMLImageElement, cssW: number, cssH: number, dpr: number) {
  const w = Math.max(1, Math.round(cssW * dpr)), h = Math.max(1, Math.round(cssH * dpr));
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const k = Math.max(1, Math.ceil(Math.max(w / img.naturalWidth, h / img.naturalHeight)));
  const dw = img.naturalWidth * k, dh = img.naturalHeight * k;
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = "#1b1830";
  ctx.fillRect(0, 0, w, h);
  // Keep the hero (lower centre of the painting) in view on tall phone screens.
  const x = Math.round((w - dw) / 2), y = Math.round(Math.min(0, Math.max(h - dh, (h - dh) * 0.62)));
  ctx.drawImage(img, x, y, dw, dh);
}

// Silkscreen's own "&" is 7 px tall with a stroke through it and reads as "$" at logo size.
// This one sits on the font's 5 px cap grid (1 px = .125em) with the logo's gradient bands.
const AMP_PATH = [".##..", "#.#..", ".#..#", "#.##.", ".##.#"]
  .flatMap((row, y) => [...row].map((c, x) => (c === "#" ? `M${x} ${y}h1v1h-1z` : ""))).join("");

function PixelAmp() {
  return <svg className="g5-logo-amp" viewBox="0 0 5 5" aria-hidden="true" shapeRendering="crispEdges">
    <defs>
      <linearGradient id="g5-logo-amp-fill" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#fff6cf" /><stop offset=".088" stopColor="#fff6cf" />
        <stop offset=".088" stopColor="#f7d170" /><stop offset=".491" stopColor="#f7d170" />
        <stop offset=".491" stopColor="#e0a23c" /><stop offset=".808" stopColor="#e0a23c" />
        <stop offset=".808" stopColor="#b06a22" /><stop offset="1" stopColor="#b06a22" />
      </linearGradient>
    </defs>
    <path d={AMP_PATH} fill="url(#g5-logo-amp-fill)" />
  </svg>;
}

export function Title({ newest, onNew, onContinue, onLoad, onSettings, onShelf }: {
  newest: SlotMeta | null; onNew: () => void; onContinue: () => void; onLoad: () => void; onSettings: () => void; onShelf: () => void;
}) {
  const items: MenuItem[] = [
    ...(newest ? [{
      key: "continue", label: "Continue", onSelect: onContinue,
      sub: `${newest.heroName} · Lv ${newest.level} · ${newest.mapName}`,
    }] : []),
    { key: "new", label: "New Journey", onSelect: onNew },
    { key: "load", label: "Load Game", onSelect: onLoad, disabled: !newest },
    { key: "settings", label: "Settings", onSelect: onSettings },
  ];
  const [cursor, setCursor] = useCursor(items.length, 0);
  return <div className="g5-title">
    <a className="g5-shelf-link" href={SHELF_URL} onClick={event => { event.preventDefault(); onShelf(); }}>‹ Shelf</a>
    <header className="g5-logo">
      <span className="g5-logo-kicker">Gamescool</span>
      <h1 className="g5-logo-title" aria-label="Might & Mana"><span>Might <PixelAmp /></span>{" "}<span>Mana</span></h1>
      <span className="g5-logo-sub"><i />Chapter One · The First Wardstone<i /></span>
    </header>
    <nav className="g5-title-menu" aria-label="Title menu">
      <MenuList items={items} cursor={cursor} setCursor={setCursor} />
    </nav>
    <footer className="g5-title-foot">
      <Hints items={[["move", "Choose"], ["ok", "Select"]]} />
      <span className="g5-copyright">An original game · Saves stay on this device</span>
    </footer>
  </div>;
}

// ─── Name entry ────────────────────────────────────────────────────────────────────────────────
type Key = { label: string; value?: string; action?: "case" | "del" | "done"; wide?: boolean };
function keyRows(upper: boolean): Key[][] {
  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").map(c => upper ? c : c.toLowerCase());
  return [
    letters.slice(0, 10).map(c => ({ label: c, value: c })),
    letters.slice(10, 20).map(c => ({ label: c, value: c })),
    [...letters.slice(20).map(c => ({ label: c, value: c })), { label: "'", value: "'" }, { label: "-", value: "-" }, { label: "Space", value: " ", wide: true }],
    [{ label: upper ? "abc" : "ABC", action: "case", wide: true }, { label: "Delete", action: "del", wide: true }, { label: "Done", action: "done", wide: true }],
  ];
}

export function NameEntry({ onDone, onBack }: { onDone: (name: string) => void; onBack: () => void }) {
  const { sound, device, focusStage } = useUi();
  const [name, setName] = useState(DEFAULT_NAME);
  const [upper, setUpper] = useState(true);
  const [pos, setPos] = useState({ row: 3, col: 2 });
  const inputRef = useRef<HTMLInputElement>(null);
  const rows = useMemo(() => keyRows(upper), [upper]);
  const typing = device === "keyboard";
  useEffect(() => {
    if (typing) { inputRef.current?.focus({ preventScroll: true }); inputRef.current?.select(); }
  }, [typing]);
  const finish = () => {
    const clean = cleanName(name);
    sound("ok");
    onDone(clean);
  };
  const press = (key: Key) => {
    if (key.action === "case") { setUpper(v => !v); sound("move"); return; }
    if (key.action === "del") { setName(n => n.slice(0, -1)); sound("back"); return; }
    if (key.action === "done") { finish(); return; }
    if (name.length >= NAME_MAX) { sound("deny"); return; }
    setName(n => (n + (key.value ?? "")).replace(/^ +/, "").replace(/ {2,}/g, " "));
    sound("move");
  };
  const moveTo = (row: number, col: number) => {
    const r = (row + rows.length) % rows.length;
    const from = rows[pos.row].length, to = rows[r].length;
    const c = row !== pos.row ? Math.min(to - 1, Math.round(pos.col / Math.max(1, from - 1) * (to - 1))) : (col + to) % to;
    setPos({ row: r, col: c });
    sound("move");
  };
  useMenu(command => {
    const fieldFocused = typeof document !== "undefined" && document.activeElement === inputRef.current;
    if (command === "ok") {
      if (fieldFocused) { finish(); return; }
      press(rows[pos.row][pos.col]);
    } else if (command === "back") {
      if (!fieldFocused && name.length) { setName(n => n.slice(0, -1)); sound("back"); }
      else { sound("back"); onBack(); }
    } else if (command === "start") finish();
    else if (command === "up") { inputRef.current?.blur(); moveTo(pos.row - 1, pos.col); }
    else if (command === "down") { inputRef.current?.blur(); moveTo(pos.row + 1, pos.col); }
    else if (command === "left") moveTo(pos.row, pos.col - 1);
    else if (command === "right") moveTo(pos.row, pos.col + 1);
    else if (command === "prev" || command === "next") { setUpper(v => !v); sound("move"); }
  });
  return <div className="g5-screen g5-name">
    <div className="g5-paper g5-name-card">
      <div className="g5-crest" aria-hidden="true" />
      <CardClose onClick={onBack} />
      <h2 className="g5-card-title">Name your hero</h2>
      <p className="g5-card-lead">Grandpa Oren has called you this since you were small.</p>
      <label className="g5-name-field">
        <span className="g5-sr">Hero name</span>
        <input ref={inputRef} value={name} maxLength={NAME_MAX} spellCheck={false} autoComplete="off" autoCapitalize="words"
          enterKeyHint="done" inputMode="text" data-game-input-ignore="true"
          onChange={event => setName(event.target.value.replace(/[^\p{L}\p{N} '\-]/gu, "").slice(0, NAME_MAX))}
          onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); finish(); } }} />
        <span className="g5-name-count">{name.length}/{NAME_MAX}</span>
      </label>
      <div className="g5-keys" role="grid" aria-label="Letters">
        {rows.map((row, r) => <div className="g5-keys-row" role="row" key={r}>
          {row.map((key, c) => <button type="button" tabIndex={-1} role="gridcell" key={`${r}-${c}`}
            className={`g5-key-cell${key.wide ? " is-wide" : ""}${key.action === "done" ? " is-done" : ""}${pos.row === r && pos.col === c ? " is-on" : ""}`}
            onClick={() => { setPos({ row: r, col: c }); press(key); if (!typing) focusStage(); }}>
            {key.label}
          </button>)}
        </div>)}
      </div>
      <Hints items={typing ? [["ok", "Begin"], ["back", "Back"]] : [["ok", "Type"], ["back", "Delete"], ["start", "Begin"]]} />
    </div>
  </div>;
}

// ─── Save / load slots ─────────────────────────────────────────────────────────────────────────
export function SlotList({ mode, slots, onPick, onBack }: {
  mode: "load" | "save"; slots: SlotMeta[]; onPick: (slot: SlotId) => void; onBack: () => void;
}) {
  const list = mode === "save" ? slots.filter(s => s.slot !== "auto") : slots;
  const [cursor, setCursor] = useCursor(list.length, Math.max(0, list.findIndex(s => mode === "save" ? true : !s.empty)));
  const [confirm, setConfirm] = useState<SlotId | null>(null);
  const items: MenuItem[] = list.map(meta => ({
    key: String(meta.slot),
    disabled: mode === "load" && meta.empty,
    label: <span className="g5-slot-row">
      <span className="g5-slot-name">{meta.slot === "auto" ? "Autosave" : `Slot ${meta.slot}`}</span>
      {meta.empty ? <span className="g5-slot-empty">Empty</span> : <span className="g5-slot-meta">
        <b>{meta.heroName}</b><span>Lv {meta.level}</span><span>{meta.mapName}</span>
        <span className="g5-slot-time">{formatPlayTime(meta.playSeconds)}</span>
        <span className="g5-slot-when">{formatSavedAt(meta.savedAt)}{meta.chapterClear ? " · Clear" : ""}</span>
      </span>}
    </span>,
    onSelect: () => {
      if (mode === "save" && !meta.empty) setConfirm(meta.slot);
      else onPick(meta.slot);
    },
  }));
  return <div className="g5-screen g5-slots">
    <div className="g5-paper g5-slots-card">
      <div className="g5-crest" aria-hidden="true" />
      <CardClose onClick={onBack} />
      <h2 className="g5-card-title">{mode === "save" ? "Save your journey" : "Load a journey"}</h2>
      <MenuList items={items} cursor={cursor} setCursor={setCursor} onBack={onBack} className="g5-slot-menu" active={confirm === null} />
      <Hints items={[["ok", mode === "save" ? "Save" : "Load"], ["back", "Back"]]} />
    </div>
    {confirm !== null && <Confirm message={`Overwrite slot ${confirm}?`} detail="The journey saved there will be replaced." danger
      onYes={() => { const slot = confirm; setConfirm(null); onPick(slot); }} onNo={() => setConfirm(null)} />}
  </div>;
}

// ─── Settings and controls ─────────────────────────────────────────────────────────────────────
const TEXT_SPEEDS: Array<[number, string]> = [[32, "Slow"], [48, "Normal"], [80, "Fast"], [0, "Instant"]];
type Row = { key: string; label: string; value: string; step?: (dir: -1 | 1) => void; level?: number; onSelect?: () => void };

export function Settings({ prefs, onChange, onBack, onControls }: {
  prefs: Preferences; onChange: (prefs: Preferences) => void; onBack: () => void; onControls: () => void;
}) {
  const { sound, focusStage } = useUi();
  const volume = (key: "master" | "music" | "sfx", label: string): Row => ({
    key, label, value: prefs.muted && key === "master" ? "Muted" : `${Math.round(prefs[key] * 10)}`, level: prefs.muted && key === "master" ? 0 : prefs[key],
    step: dir => onChange({ ...prefs, muted: false, [key]: Math.max(0, Math.min(1, Math.round(prefs[key] * 10 + dir) / 10)) }),
  });
  const speedIndex = Math.max(0, TEXT_SPEEDS.findIndex(([v]) => v === prefs.textSpeed));
  const motion = prefs.reducedMotion === null ? "Auto" : prefs.reducedMotion ? "Reduced" : "Full";
  const touchLabel = prefs.touchControls === "auto" ? "Auto" : prefs.touchControls === "on" ? "Show" : "Hide";
  const cycle = <T,>(options: T[], current: T, dir: -1 | 1) => options[(options.indexOf(current) + dir + options.length) % options.length];
  const rows: Row[] = [
    volume("master", "Volume"), volume("music", "Music"), volume("sfx", "Effects"),
    { key: "mute", label: "Sound", value: prefs.muted ? "Off" : "On", step: () => onChange({ ...prefs, muted: !prefs.muted }), onSelect: () => onChange({ ...prefs, muted: !prefs.muted }) },
    { key: "text", label: "Text speed", value: TEXT_SPEEDS[speedIndex][1], step: dir => onChange({ ...prefs, textSpeed: TEXT_SPEEDS[(speedIndex + dir + TEXT_SPEEDS.length) % TEXT_SPEEDS.length][0] }) },
    { key: "motion", label: "Screen motion", value: motion, step: dir => onChange({ ...prefs, reducedMotion: cycle<boolean | null>([null, false, true], prefs.reducedMotion, dir) }) },
    { key: "touch", label: "Touch buttons", value: touchLabel, step: dir => onChange({ ...prefs, touchControls: cycle<Preferences["touchControls"]>(["auto", "on", "off"], prefs.touchControls, dir) }) },
    { key: "controls", label: "Controls", value: "", onSelect: onControls },
    { key: "back", label: "Done", value: "", onSelect: onBack },
  ];
  const [cursor, setCursor] = useCursor(rows.length);
  const act = (index: number, dir: -1 | 1 | 0) => {
    const row = rows[index];
    if (dir !== 0 && row.step) { row.step(dir); sound("move"); return; }
    if (dir === 0 && row.onSelect) { sound("ok"); row.onSelect(); return; }
    if (dir === 0 && row.step) { row.step(1); sound("move"); }
  };
  useMenu(command => {
    if (command === "up") { setCursor((cursor - 1 + rows.length) % rows.length); sound("move"); }
    else if (command === "down") { setCursor((cursor + 1) % rows.length); sound("move"); }
    else if (command === "left") act(cursor, -1);
    else if (command === "right") act(cursor, 1);
    else if (command === "ok") act(cursor, 0);
    else if (command === "back") { sound("back"); onBack(); }
  });
  return <div className="g5-screen g5-settings">
    <div className="g5-paper g5-settings-card">
      <div className="g5-crest" aria-hidden="true" />
      <CardClose onClick={onBack} />
      <h2 className="g5-card-title">Settings</h2>
      <ul className="g5-settings-rows" role="menu">
        {rows.map((row, index) => <li key={row.key} role="none">
          <div role="menuitem" className={`g5-setting${index === cursor ? " is-on" : ""}`}
            onPointerEnter={event => { if (event.pointerType === "mouse") setCursor(index); }}
            onClick={() => { setCursor(index); if (!row.step || row.onSelect) act(index, 0); focusStage(); }}>
            {index === cursor && <Pointer />}
            <span className="g5-setting-label">{row.label}</span>
            {row.step && <span className="g5-setting-value">
              <button type="button" tabIndex={-1} className="g5-step is-prev" aria-label={`Lower ${row.label}`} onClick={event => { event.stopPropagation(); setCursor(index); act(index, -1); focusStage(); }} />
              {row.level !== undefined
                ? <span className="g5-pips" aria-label={row.value}>{Array.from({ length: 10 }, (_, i) => <i key={i} className={i < Math.round(row.level! * 10) ? "is-on" : ""} />)}</span>
                : <span className="g5-setting-text">{row.value}</span>}
              <button type="button" tabIndex={-1} className="g5-step is-next" aria-label={`Raise ${row.label}`} onClick={event => { event.stopPropagation(); setCursor(index); act(index, 1); focusStage(); }} />
            </span>}
            {!row.step && row.key === "controls" && <span className="g5-setting-text">&gt;</span>}
          </div>
        </li>)}
      </ul>
      <Hints items={[["move", "Choose"], ["ok", "Change"], ["back", "Back"]]} />
    </div>
  </div>;
}

const CONTROL_ROWS: Array<[GlyphAction, string, string]> = [
  ["move", "Move", "Walk in eight directions"],
  ["attack", "Attack · Talk", "Tap to chain a combo, hold to charge"],
  ["magic", "Magic", "Cast the selected spell"],
  ["dodge", "Dodge", "Roll through danger"],
  ["item", "Items", "Open the item ring"],
  ["nextSpell", "Next spell", "Switch the selected spell"],
  ["map", "Map", "Open the map"],
  ["status", "Status", "Level, stats and gear"],
  ["pause", "Pause", "Save, load and settings"],
];
const TOUCH_TEXT: Partial<Record<GlyphAction, string>> = {
  move: "Left thumb anywhere", attack: "Big sword button", magic: "Spell button", dodge: "Roll button", item: "Bag button",
  nextSpell: "Tap the spell icon", map: "Map button, top right", status: "Tap your portrait", pause: "Pause button, top right",
};

export function Controls({ initial, onBack }: { initial: Device; onBack: () => void }) {
  const { sound, focusStage } = useUi();
  const tabs: Device[] = ["keyboard", "gamepad", "touch"];
  const [tab, setTab] = useState<Device>(initial);
  const shift = (dir: number) => { setTab(tabs[(tabs.indexOf(tab) + dir + tabs.length) % tabs.length]); sound("move"); };
  useMenu(command => {
    if (command === "left" || command === "prev") shift(-1);
    else if (command === "right" || command === "next") shift(1);
    else if (command === "back" || command === "ok" || command === "start") { sound("back"); onBack(); }
  });
  return <div className="g5-screen g5-controls">
    <div className="g5-paper g5-controls-card">
      <div className="g5-crest" aria-hidden="true" />
      <CardClose onClick={onBack} />
      <h2 className="g5-card-title">Controls</h2>
      <div className="g5-tabs" role="tablist">
        {tabs.map(t => <button type="button" tabIndex={-1} role="tab" aria-selected={t === tab} key={t}
          className={`g5-tab${t === tab ? " is-on" : ""}`} onClick={() => { setTab(t); sound("move"); focusStage(); }}>
          {t === "keyboard" ? "Keyboard" : t === "gamepad" ? "Gamepad" : "Touch"}
        </button>)}
      </div>
      <table className={`g5-control-table${tab === "touch" ? " is-touch" : ""}`}>
        <tbody>
          {CONTROL_ROWS.map(([action, label, detail]) => <tr key={action}>
            <td className="g5-control-glyph">
              {tab === "keyboard" && action === "move" ? <><kbd className="g5-glyph g5-key">WASD</kbd><kbd className="g5-glyph g5-key">Arrows</kbd></>
                : tab === "gamepad" && action === "move" ? <kbd className="g5-glyph g5-key g5-key-pad">Stick · D-pad</kbd>
                  : tab === "touch" ? <span className="g5-control-touch">{TOUCH_TEXT[action]}</span>
                    : <Glyph action={action} device={tab} />}
            </td>
            <td className="g5-control-label">{label}</td>
            <td className="g5-control-detail">{detail}</td>
          </tr>)}
        </tbody>
      </table>
      <Hints items={[["prev", "Device"], ["back", "Back"]]} />
    </div>
  </div>;
}
