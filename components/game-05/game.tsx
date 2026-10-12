"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Device, EngineEvent, GameCommand, GameHandle, HudSnapshot, MusicId, SaveState } from "@/lib/game-05/contract";
import { Game05Input, emptyInputFrame } from "@/lib/game-05/input/game05-input";
import type { HostMenuCommand } from "@/lib/game-05/input/game05-input";
import { Game05Audio } from "@/lib/game-05/audio";
import type { AudioTrace, UiCue } from "@/lib/game-05/audio";
import {
  DEFAULT_PREFERENCES, listSlots, loadPreferences, newestSave, readSlot, writePreferences, writeSlot,
} from "@/lib/game-05/save";
import type { Preferences, SlotId, SlotMeta } from "@/lib/game-05/save";
import type * as CatalogModule from "./catalog";
import { EMPTY_ASSETS, loadUiAssets, preloadUi } from "./assets";
import type { UiAssets } from "./assets";
import { Hud, createLiveNodes, updateLive } from "./hud";
import type { LiveNodes, StageInfo } from "./hud";
import { ChapterClear, DialogBox, GameOver, Pause, QuestCardView, UnlockBanner } from "./modals";
import { Controls, Loading, NameEntry, Settings, SHELF_URL, SlotList, Title, TitleArtCanvas } from "./screens";
import { Shop } from "./shop";
import { Status } from "./status";
import { ItemRing } from "./items";
import { MapScreen } from "./map";
import { TouchBar, TouchControls } from "./touch";
import type { TouchBridge } from "./touch";
import { UiContext, createMenuBus } from "./ui";
import type { Ui } from "./ui";
import "./game.css";

type Cat = typeof CatalogModule;
type Screen = "boot" | "title" | "name" | "load" | "settings" | "controls" | "game";
type MockHandle = GameHandle & { cycle?: () => string };

const INITIAL: HudSnapshot = {
  phase: "loading", loading: 0, heroName: "", level: 1, xp: { value: 0, next: 1 }, hp: { value: 0, max: 1 }, mp: { value: 0, max: 1 },
  gold: 0, charge: 0, spell: null, buffs: [], ticker: { main: null, side: null }, arrow: null, prompt: null, modal: { kind: "none" },
  notices: [], mapName: "", night: false, device: "keyboard", boss: null,
};
const HOST_MODALS = new Set(["shop", "status", "items", "map", "pause", "dead", "clear"]);

/** Art-pixel scale per DIRECTION.md (k device px per art px) and a crisp text pixel for the pixel font. */
export function uiScale(cssW: number, cssH: number, dpr: number) {
  const k = Math.max(1, Math.floor(Math.min(cssW * dpr, cssH * dpr) / 360));
  const textDev = Math.max(k, Math.round(1.667 * dpr));
  return { k, u: k / dpr, t: textDev / dpr };
}

function signature(s: HudSnapshot): string {
  const m = s.modal;
  const detail = m.kind === "dialog" ? `${m.speaker}|${m.text}|${m.index}|${m.choices?.length ?? 0}`
    : m.kind === "questCard" ? `${m.card.quest}|${m.card.mode}` : m.kind === "shop" ? m.shop : m.kind === "unlock" ? m.title : "";
  return `${s.phase}|${m.kind}|${detail}`;
}

export default function Game05() {
  const stageRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<MockHandle | null>(null);
  const inputRef = useRef<Game05Input | null>(null);
  const audioRef = useRef<Game05Audio | null>(null);
  const flushRef = useRef<(() => void) | null>(null);
  const bus = useMemo(() => createMenuBus(), []);
  const liveRef = useRef<LiveNodes>(createLiveNodes());
  const setLive = useCallback((key: keyof LiveNodes, node: HTMLElement | null) => { (liveRef.current as unknown as Record<string, HTMLElement | null>)[key] = node; }, []);
  const screenRef = useRef<Screen>("boot");
  const snapRef = useRef<HudSnapshot>(INITIAL);
  const readyRef = useRef(false);
  const musicRef = useRef<MusicId>("none");
  const stageInfo = useRef<StageInfo>({ w: 1, h: 1, dpr: 1, u: 1, top: 0, bottom: 0, safeTop: 0, boxes: [] });
  const [screen, setScreenState] = useState<Screen>("boot");
  const [snapshot, setSnapshot] = useState<HudSnapshot>(INITIAL);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [prefs, setPrefsState] = useState<Preferences>(DEFAULT_PREFERENCES);
  const [slots, setSlots] = useState<SlotMeta[]>([]);
  const [device, setDeviceState] = useState<Device>("keyboard");
  const [cat, setCat] = useState<Cat | null>(null);
  const [assets, setAssets] = useState<UiAssets>(EMPTY_ASSETS);
  const [save, setSave] = useState<SaveState | null>(null);
  const [overlay, setOverlay] = useState<null | "load" | "save">(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [reducedMotion, setReducedMotionState] = useState(false);
  const reducedRef = useRef(false);
  const setReducedMotion = useCallback((value: boolean) => { reducedRef.current = value; setReducedMotionState(value); }, []);

  const setScreen = useCallback((next: Screen) => {
    screenRef.current = next;
    setScreenState(next);
    if (next !== "game") audioRef.current?.setMusic("title");
    else audioRef.current?.setMusic(musicRef.current);
  }, []);
  const focusStage = useCallback(() => {
    const active = document.activeElement as HTMLElement | null;
    if (active?.matches?.("input,textarea")) return;
    stageRef.current?.focus({ preventScroll: true });
  }, []);
  const sound = useCallback((cue: UiCue) => audioRef.current?.ui(cue), []);
  const refreshSlots = useCallback(() => setSlots(listSlots()), []);
  const refreshSave = useCallback(() => {
    try { setSave(handleRef.current ? handleRef.current.save() : null); } catch { setSave(null); }
  }, []);
  const showWarning = useCallback((text: string) => {
    setWarning(text);
    window.setTimeout(() => setWarning(current => current === text ? null : current), 3600);
  }, []);

  /** Every host → engine command: apply, flush its events, refresh the HUD right away. */
  const send = useCallback((command: GameCommand) => {
    const handle = handleRef.current;
    if (!handle || !readyRef.current) return;
    try { handle.command(command); } catch { showWarning("The game could not do that."); }
    flushRef.current?.();
    const next = handle.snapshot();
    snapRef.current = next;
    setSnapshot(next);
    if (HOST_MODALS.has(next.modal.kind) || command.type === "load" || command.type === "newGame") refreshSave();
  }, [refreshSave, showWarning]);

  const setPrefs = useCallback((next: Preferences) => {
    setPrefsState(next);
    writePreferences(next);
    audioRef.current?.setVolumes({ master: next.master, music: next.music, sfx: next.sfx, muted: next.muted });
    const reduced = next.reducedMotion ?? matchMedia("(prefers-reduced-motion: reduce)").matches;
    setReducedMotion(reduced);
    // Shake, flashes and hit-stop follow the setting mid-session.
    try { if (readyRef.current) handleRef.current?.command({ type: "setReducedMotion", reduced }); } catch { /* engine not ready */ }
  }, [setReducedMotion]);

  // ─── mount: engine (or mock), input, audio, loop ────────────────────────────────────────────
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    let cancelled = false, raf = 0, last = 0, lastHud = 0, lastMeasure = 0, failed = false;
    let lastSig = "";
    const params = new URLSearchParams(location.search);
    const mock = params.get("mock") === "1";
    // ?debug=1 exposes the engine as window.__g5 (and host internals as __g5host) for tests.
    const debug = params.get("debug") === "1";
    const debugWindow = window as unknown as { __g5?: GameHandle | null; __g5host?: unknown };
    const audioTrace: AudioTrace[] = [];
    const canvas = document.createElement("canvas");
    canvas.className = "g5-canvas";
    canvas.setAttribute("aria-hidden", "true");
    stage.insertBefore(canvas, stage.firstChild);
    readyRef.current = false;
    screenRef.current = "boot";
    setScreenState("boot");
    setError(null);
    snapRef.current = INITIAL;
    setSnapshot(INITIAL);

    const preferences = loadPreferences();
    setPrefsState(preferences);
    const reduced = preferences.reducedMotion ?? matchMedia("(prefers-reduced-motion: reduce)").matches;
    setReducedMotion(reduced);
    const forced = params.get("device");
    const initialDevice: Device = forced === "touch" || forced === "gamepad" || forced === "keyboard" ? forced
      : matchMedia("(pointer: coarse)").matches ? "touch" : "keyboard";
    setDeviceState(initialDevice);
    refreshSlots();

    const audio = new Game05Audio();
    audio.setVolumes({ master: preferences.master, music: preferences.music, sfx: preferences.sfx, muted: preferences.muted });
    audio.setMusic("title");
    audioRef.current = audio;
    if (debug) {
      audio.trace = entry => { audioTrace.push(entry); if (audioTrace.length > 400) audioTrace.splice(0, 100); };
      debugWindow.__g5host = {
        audio, audioTrace, get input() { return inputRef.current; }, get screen() { return screenRef.current; }, get snapshot() { return snapRef.current; },
        get ticks() { return ticks; }, get lastTick() { return lastTick; },
      };
    }
    const unlock = () => { void audio.unlock(); };
    window.addEventListener("pointerdown", unlock, { capture: true });
    window.addEventListener("keydown", unlock, { capture: true });
    const visibility = () => audio.setHidden(document.hidden);
    document.addEventListener("visibilitychange", visibility);

    const input = new Game05Input(stage, {
      onMenu: (command: HostMenuCommand, source) => {
        // Pad presses are not a user activation everywhere; asking costs nothing.
        if (source === "gamepad") void audio.unlock();
        bus.emit(command);
      },
      onDevice: next => {
        if (forced) return;
        setDeviceState(next);
        try { handleRef.current?.command({ type: "setDevice", device: next }); } catch { /* ignore */ }
      },
      onAutoPause: () => {
        const snap = snapRef.current;
        if (screenRef.current === "game" && snap.phase === "playing" && snap.modal.kind === "none") {
          try { handleRef.current?.setPaused(true); } catch { /* ignore */ }
        }
      },
    });
    input.attach();
    input.setMode("menu");
    inputRef.current = input;

    // CSS variables are only written when they change (this runs a few times a second).
    const cssCache = new Map<string, string>();
    const setVar = (name: string, value: string) => {
      if (cssCache.get(name) === value) return;
      cssCache.set(name, value);
      stage.style.setProperty(name, value);
    };
    const measureInsets = () => {
      const rect = stage.getBoundingClientRect();
      const info = stageInfo.current;
      const tick = stage.querySelector(".g5-tickers")?.getBoundingClientRect();
      const touch = stage.querySelector(".g5-touch-cluster")?.getBoundingClientRect();
      const bottomEdge = Math.min(tick ? tick.top - rect.top : rect.height, touch ? touch.top - rect.top : rect.height);
      info.bottom = Math.max(0, rect.height - bottomEdge);
      // The top HUD slides away under modals: only a HUD at rest is measured.
      if (stage.dataset.modal !== "none") return;
      const top = stage.querySelector(".g5-hud-top")?.getBoundingClientRect();
      const vit = stage.querySelector(".g5-vitals")?.getBoundingClientRect();
      const col = stage.querySelector(".g5-hud-right")?.getBoundingClientRect();
      info.top = top ? top.bottom - rect.top : 0;
      info.safeTop = top ? top.top - rect.top : 0;
      info.boxes = [vit, col].filter((b): b is DOMRect => !!b && b.width > 0)
        .map(b => ({ l: b.left - rect.left, t: b.top - rect.top, r: b.right - rect.left, b: b.bottom - rect.top }));
      if (top) setVar("--hud-bottom", `${Math.round(info.top)}px`);
      // The boss bar and notices take the top centre when the gap between the vitals plate and the
      // right-hand column is wide enough (desktop, landscape), else they sit under the vitals plate,
      // beside the right-hand column when that runs longer.
      if (vit && col && top) {
        const u = info.u || 1;
        const left = vit.right - rect.left, right = rect.right - col.left;
        const free = rect.width - left - right;
        const inGap = free >= Math.min(260 * u, rect.width * 0.5) + 16 * u;
        const besideColumn = col.bottom > vit.bottom + 4;
        setVar("--center-top", `${Math.round(inGap ? vit.top - rect.top : vit.bottom - rect.top + 6 * u)}px`);
        setVar("--center-left", `${Math.round(inGap ? left + 8 * u : 8 * u)}px`);
        setVar("--center-right", `${Math.round(inGap || besideColumn ? right + 8 * u : 8 * u)}px`);
      }
    };
    const resize = () => {
      const rect = stage.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const { k, u, t } = uiScale(rect.width, rect.height, dpr);
      stage.style.setProperty("--u", `${u}px`);
      stage.style.setProperty("--t", `${t}px`);
      stage.style.setProperty("--k", String(k));
      stage.style.setProperty("--dp", `${1 / dpr}px`);
      // Portraits are 64x64 and are only ever drawn at whole device pixels per portrait pixel:
      // the HUD crops a 32-unit window, dialogs show the whole bust.
      stage.style.setProperty("--pk-hud", String(Math.max(1, Math.ceil(k / 2))));
      stage.style.setProperty("--pk-dlg", String(Math.max(1, Math.round(k * 0.75))));
      Object.assign(stageInfo.current, { w: rect.width, h: rect.height, dpr, u });
      try { handleRef.current?.resize(rect.width, rect.height, dpr); } catch { /* engine not ready */ }
      measureInsets();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(stage);
    resize();

    const rumble = (event: Extract<EngineEvent, { type: "rumble" }>) => {
      if (reducedRef.current) return;
      try {
        const pad = Array.from(navigator.getGamepads?.() ?? []).find(p => p?.connected);
        const actuator = (pad as (Gamepad & { vibrationActuator?: { playEffect(type: string, params: object): Promise<unknown> } }) | undefined)?.vibrationActuator;
        void actuator?.playEffect("dual-rumble", {
          duration: Math.max(0, Math.min(250, event.ms)),
          strongMagnitude: Math.max(0, Math.min(1, event.strong)), weakMagnitude: Math.max(0, Math.min(1, event.weak)),
        }).catch(() => {});
      } catch { /* optional */ }
    };
    const flush = () => {
      const handle = handleRef.current;
      if (!handle) return;
      let events: EngineEvent[] = [];
      try { events = handle.drainEvents(); } catch { return; }
      for (const event of events) {
        if (event.type === "sfx") audio.sfx(event.cue, event.pan, event.gain ?? 1);
        else if (event.type === "music") { musicRef.current = event.id; if (screenRef.current === "game") audio.setMusic(event.id); }
        else if (event.type === "save") {
          if (writeSlot("auto", event.state)) refreshSlots();
          else showWarning("Progress could not be saved on this device.");
        } else if (event.type === "rumble") rumble(event);
      }
    };
    flushRef.current = flush;
    const fail = (message: string) => {
      if (cancelled || failed) return;
      failed = true;
      readyRef.current = false;
      setError(message);
      screenRef.current = "boot";
      setScreenState("boot");
    };

    let ticks = 0, lastTick = 0;
    const tick = (now: number) => {
      if (cancelled || failed) return;
      raf = requestAnimationFrame(tick);
      ticks++; lastTick = now;
      const handle = handleRef.current;
      if (!handle) return;
      try {
        const dt = last ? Math.min(0.1, (now - last) / 1000) : 0;
        last = now;
        const scr = screenRef.current;
        const current = snapRef.current;
        const playing = readyRef.current && scr === "game" && current.phase === "playing" && current.modal.kind === "none";
        input.setMode(playing ? "play" : "menu");
        const frame = input.frame(now);
        if (playing) {
          const p = frame.pressed;
          const open = p.pause ? "pause" : p.map ? "map" : p.status ? "status" : p.item ? "items" : null;
          if (open) {
            p.pause = p.map = p.status = p.item = false;
            handle.command({ type: "openModal", modal: open });
          }
        }
        // Off the game screen (title, name entry, load) the world is frozen and not drawn: a game
        // left for the title must not keep running (or making noise) behind it.
        if (scr === "game") {
          if (readyRef.current) handle.frame(dt, playing ? frame : emptyInputFrame(frame.device));
          handle.render();
        }
        flush();
        const next = handle.snapshot();
        const prevSig = lastSig;
        lastSig = signature(next);
        snapRef.current = next;
        if (lastSig !== prevSig) {
          setSnapshot(next);
          lastHud = now;
          if (HOST_MODALS.has(next.modal.kind)) { refreshSave(); refreshSlots(); }
        } else if (now - lastHud > 66) { setSnapshot(next); lastHud = now; }
        if (!readyRef.current && next.phase !== "loading") { /* wait for ready() */ }
        audio.setNight(next.night);
        audio.setPaused(scr === "game" && next.phase === "paused");
        // Game over and chapter clear keep the music stopped until the screen closes.
        audio.setHold(scr === "game" && (next.phase === "dead" || next.phase === "clear"));
        if (now - lastMeasure > 400) { measureInsets(); lastMeasure = now; }
        updateLive(liveRef.current, next, stageInfo.current, scr === "game" && next.phase === "playing" && next.modal.kind === "none");
      } catch (e) {
        console.error(e);
        fail("The game hit a problem and stopped. Try again to reload it.");
      }
    };

    const options = { save: null, reducedMotion: reduced, assetBase: "/games/game-05" };
    const created: Promise<MockHandle> = mock
      ? import("@/lib/game-05/mock-engine").then(m => m.createMockGame(canvas, options, params))
      : import("@/lib/game-05/engine").then(m => m.createGame(canvas, options));
    void import("./catalog").then(module => { if (!cancelled) setCat(module); }).catch(() => {});
    const uiReady = preloadUi();
    const assetsReady = loadUiAssets().then(value => { if (!cancelled) setAssets(value); });
    created.then(handle => {
      if (cancelled) { handle.destroy(); return; }
      handleRef.current = handle;
      if (debug) debugWindow.__g5 = handle;
      resize();
      raf = requestAnimationFrame(tick);
      // The title waits for the engine and for the UI frames, so no screen shows unframed.
      return Promise.all([handle.ready, uiReady, Promise.race([assetsReady, new Promise(r => setTimeout(r, 4000))])]).then(() => {
        if (cancelled || failed) return;
        readyRef.current = true;
        resize();
        const next = handle.snapshot();
        snapRef.current = next;
        setSnapshot(next);
        const modal = params.get("modal"), first = params.get("screen");
        if (mock && modal) {
          handle.command({ type: "newGame", heroName: "Wren" });
          flush();
          screenRef.current = "game";
          setScreenState("game");
          refreshSave();
        } else if (mock && (first === "name" || first === "load" || first === "settings" || first === "controls")) {
          screenRef.current = first;
          setScreenState(first);
        } else {
          screenRef.current = "title";
          setScreenState("title");
        }
        stage.focus({ preventScroll: true });
      });
    }).catch(err => {
      console.error(err);
      fail(mock ? "The mock engine failed to start." : "The game could not load. Check your connection and try again.");
    });

    const cycleKey = (event: KeyboardEvent) => {
      if (!mock || event.code !== "Backquote") return;
      const handle = handleRef.current;
      if (!handle?.cycle) return;
      const shown = handle.cycle();
      screenRef.current = "game";
      setScreenState("game");
      flush();
      const next = handle.snapshot();
      snapRef.current = next;
      setSnapshot(next);
      refreshSave();
      console.info(`[game-05 mock] modal: ${shown}`);
    };
    window.addEventListener("keydown", cycleKey);

    return () => {
      cancelled = true;
      readyRef.current = false;
      cancelAnimationFrame(raf);
      observer.disconnect();
      window.removeEventListener("pointerdown", unlock, { capture: true });
      window.removeEventListener("keydown", unlock, { capture: true });
      window.removeEventListener("keydown", cycleKey);
      document.removeEventListener("visibilitychange", visibility);
      input.dispose();
      audio.dispose();
      try { handleRef.current?.destroy(); } catch { /* already gone */ }
      handleRef.current = null;
      if (debug) { debugWindow.__g5 = null; debugWindow.__g5host = undefined; }
      canvas.remove();
      if (inputRef.current === input) inputRef.current = null;
      if (audioRef.current === audio) audioRef.current = null;
      if (flushRef.current === flush) flushRef.current = null;
    };
  }, [attempt, bus, refreshSave, refreshSlots, showWarning, setReducedMotion]);

  // Return keyboard focus to the stage whenever the screen or modal changes.
  useEffect(() => {
    const id = requestAnimationFrame(() => focusStage());
    return () => cancelAnimationFrame(id);
  }, [screen, snapshot.modal.kind, focusStage]);

  // ─── actions ────────────────────────────────────────────────────────────────────────────────
  const startNew = useCallback((heroName: string) => {
    void audioRef.current?.unlock();
    send({ type: "newGame", heroName });
    setScreen("game");
  }, [send, setScreen]);
  const loadSlot = useCallback((slot: SlotId) => {
    const state = readSlot(slot);
    if (!state) { sound("deny"); showWarning("That save could not be read."); refreshSlots(); return; }
    void audioRef.current?.unlock();
    setOverlay(null);
    send({ type: "load", state: cat ? cat.sanitizeSave(state) : state });
    setScreen("game");
  }, [cat, refreshSlots, send, setScreen, showWarning, sound]);
  const continueGame = useCallback(() => {
    const newest = newestSave();
    if (newest) loadSlot(newest.slot);
  }, [loadSlot]);
  const saveSlot = useCallback((slot: SlotId): boolean => {
    try {
      const state = handleRef.current?.save();
      const ok = !!state && writeSlot(slot, state);
      refreshSlots();
      if (ok) sound("ok");
      return ok;
    } catch { return false; }
  }, [refreshSlots, sound]);
  const closeHostModal = useCallback(() => send({ type: "closeModal" }), [send]);
  const resume = useCallback(() => {
    try { handleRef.current?.setPaused(false); } catch { /* ignore */ }
    flushRef.current?.();
    const handle = handleRef.current;
    if (handle) { const next = handle.snapshot(); snapRef.current = next; setSnapshot(next); }
  }, []);
  const toTitle = useCallback(() => { setOverlay(null); refreshSlots(); setScreen("title"); }, [refreshSlots, setScreen]);
  const toShelf = useCallback(() => { inputRef.current?.suspend(); window.location.assign(SHELF_URL); }, []);

  const touchBridge: TouchBridge = useMemo(() => ({
    setMove: (id, x, y) => inputRef.current?.setMove(id, x, y),
    setButton: (id, control, down) => inputRef.current?.setButton(id, control, down),
    release: (id, cancel) => inputRef.current?.release(id, cancel),
    focusStage,
  }), [focusStage]);
  const tapAction = useCallback((control: "status" | "nextSpell") => {
    const input = inputRef.current;
    if (!input) return;
    input.noteTouch();
    input.setButton(-7, control, true);
    input.setButton(-7, control, false);
    input.release(-7);
  }, []);

  const ui: Ui = useMemo(() => ({ bus, sound, device, assets, focusStage }), [bus, sound, device, assets, focusStage]);
  // Slot lists show the live map names once the content catalog has loaded.
  const namedSlots = useMemo(() => cat ? slots.map(x => x.empty ? x : { ...x, mapName: cat.CATALOG.maps[x.map]?.name ?? x.mapName }) : slots, [cat, slots]);
  const touchMode = prefs.touchControls === "on" || (prefs.touchControls === "auto" && device === "touch");
  const s = snapshot;
  const m = s.modal;
  const inGame = screen === "game" && s.phase !== "loading" && s.phase !== "title";
  const newest = namedSlots.filter(x => !x.empty).sort((a, b) => Date.parse(b.savedAt) - Date.parse(a.savedAt))[0] ?? null;
  const spellIcon = (title: string): string | null => {
    if (!cat) return null;
    const name = title.replace(/^new magic:\s*/i, "").toLowerCase();
    const spell = Object.values(cat.CATALOG.spells).find(sp => sp.name.toLowerCase() === name);
    return spell ? (spell.icon || `icon.spell.${spell.id}`) : null;
  };

  return <UiContext.Provider value={ui}>
    <div className="g5-stage" ref={stageRef} tabIndex={0} aria-label="Might & Mana" data-device={device} data-touch={touchMode ? "on" : "off"}
      data-reduced={reducedMotion ? "true" : "false"} data-screen={screen} data-modal={inGame ? m.kind : "none"}
      onPointerDown={event => { if (event.pointerType === "touch") inputRef.current?.noteTouch(); }}>
      {inGame && <Hud snapshot={s} setLive={setLive} touch={touchMode} hideTop={m.kind === "dialog"}
        onPortrait={() => { if (s.phase === "playing" && m.kind === "none") send({ type: "openModal", modal: "status" }); }}
        onSpell={() => tapAction("nextSpell")}
        touchBar={touchMode && s.phase === "playing" && m.kind === "none" ? <TouchBar bridge={touchBridge} /> : null} />}
      {inGame && touchMode && s.phase === "playing" && m.kind === "none" &&
        <TouchControls bridge={touchBridge} setLive={setLive} spellIcon={s.spell ? (s.spell.icon || `icon.spell.${s.spell.id}`) : null}
          spellReady={!!s.spell?.ready} hasSpell={!!s.spell} />}

      {inGame && m.kind === "dialog" && <DialogBox modal={m} textSpeed={reducedMotion && prefs.textSpeed ? Math.max(prefs.textSpeed, 80) : prefs.textSpeed} send={send} />}
      {inGame && m.kind === "questCard" && <QuestCardView card={m.card} main={cat?.CATALOG.quests[m.card.quest]?.kind === "main"} send={send} />}
      {inGame && m.kind === "unlock" && <UnlockBanner title={m.title} hint={m.hint} icon={spellIcon(m.title)} send={send} />}
      {inGame && m.kind === "shop" && cat && save && <Shop key={m.shop} cat={cat} shopId={m.shop} save={save} send={send} onLeave={closeHostModal} />}
      {inGame && m.kind === "status" && cat && save && <Status cat={cat} save={save} snapshot={s} send={send} onClose={closeHostModal} />}
      {inGame && m.kind === "items" && cat && save && <ItemRing cat={cat} save={save} send={send} onClose={closeHostModal} />}
      {inGame && m.kind === "map" && cat && save && <MapScreen cat={cat} save={save} onClose={closeHostModal} />}
      {inGame && m.kind === "pause" && <Pause snapshot={s} save={save} slots={namedSlots} prefs={prefs} device={device} onPrefs={setPrefs}
        onResume={resume} onSaveSlot={saveSlot} onLoadSlot={loadSlot} onTitle={toTitle} onShelf={toShelf} />}
      {inGame && m.kind === "dead" && !overlay && <GameOver send={send} onLoad={() => { refreshSlots(); setOverlay("load"); }} onTitle={toTitle} />}
      {inGame && m.kind === "clear" && !overlay && <ChapterClear save={save} send={send} onSave={() => { refreshSlots(); setOverlay("save"); }} onTitle={toTitle} />}
      {inGame && overlay && <SlotList mode={overlay} slots={namedSlots} onBack={() => setOverlay(null)}
        onPick={slot => { if (overlay === "load") loadSlot(slot); else { const ok = saveSlot(slot); showWarning(ok ? `Saved to slot ${slot}` : "Could not save on this device"); setOverlay(null); } }} />}

      {screen !== "game" && <TitleArtCanvas reducedMotion={reducedMotion} dim={screen !== "title" && screen !== "boot"} />}
      {screen === "boot" && <Loading progress={s.loading} error={error} onRetry={() => setAttempt(a => a + 1)} />}
      {screen === "title" && <Title newest={newest} onNew={() => setScreen("name")} onContinue={continueGame}
        onLoad={() => { refreshSlots(); setScreen("load"); }} onSettings={() => setScreen("settings")} onShelf={toShelf} />}
      {screen === "name" && <NameEntry onDone={startNew} onBack={() => setScreen("title")} />}
      {screen === "load" && <SlotList mode="load" slots={namedSlots} onPick={loadSlot} onBack={() => setScreen("title")} />}
      {screen === "settings" && <Settings prefs={prefs} onChange={setPrefs} onBack={() => setScreen("title")} onControls={() => setScreen("controls")} />}
      {screen === "controls" && <Controls initial={device} onBack={() => setScreen("settings")} />}
      {warning && <p className="g5-warning" role="status">{warning}</p>}
    </div>
  </UiContext.Provider>;
}
