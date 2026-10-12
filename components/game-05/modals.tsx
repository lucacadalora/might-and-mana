"use client";

import { useEffect, useRef, useState } from "react";
import type { Device, GameCommand, HudSnapshot, Modal, QuestCard, SaveState } from "@/lib/game-05/contract";
import { formatPlayTime } from "@/lib/game-05/save";
import type { Preferences, SlotId, SlotMeta } from "@/lib/game-05/save";
import { Confirm, Glyph, Hints, Icon, MenuList, Pointer, Portrait, fmt, useCursor, useMenu, useUi } from "./ui";
import type { MenuItem } from "./ui";
import { Controls, Settings, SlotList } from "./screens";

type Send = (command: GameCommand) => void;
type DialogModal = Extract<Modal, { kind: "dialog" }>;

// ─── Dialog ────────────────────────────────────────────────────────────────────────────────────
export function DialogBox({ modal, textSpeed, send }: { modal: DialogModal; textSpeed: number; send: Send }) {
  const { sound, focusStage } = useUi();
  const text = modal.text;
  const lineKey = `${modal.speaker}\u0000${text}\u0000${modal.total}`;
  const [shown, setShown] = useState(textSpeed <= 0 ? text.length : 0);
  const [shownKey, setShownKey] = useState(lineKey);
  // A new line restarts the typewriter (state adjusted during render, not in an effect).
  let current = shown;
  if (shownKey !== lineKey) {
    current = textSpeed <= 0 ? text.length : 0;
    setShownKey(lineKey);
    setShown(current);
  }
  const done = current >= text.length;
  // The typewriter's position lives in a ref shared by the animation and the skip, so a skip is
  // never overwritten by a frame that was already in flight.
  const acc = useRef(0);
  useEffect(() => {
    acc.current = textSpeed <= 0 ? text.length : 0;
    if (textSpeed <= 0) return;
    let raf = 0, last = performance.now(), blipAt = 0;
    const tick = (now: number) => {
      acc.current = Math.min(text.length, acc.current + (now - last) / 1000 * textSpeed);
      last = now;
      const whole = Math.floor(acc.current);
      if (whole - blipAt >= 3 && whole < text.length) { blipAt = whole; sound("blip"); }
      setShown(whole);
      if (whole < text.length) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // Restart only when the line changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lineKey, textSpeed]);
  const choices = done ? modal.choices : null;
  const advance = (command: "ok" | "back" | "start") => {
    if (!done) { acc.current = text.length; setShown(text.length); return; }
    send({ type: "menu", command });
  };
  const pick = (index: number) => {
    if (!modal.choices) return;
    const n = modal.choices.length;
    const steps = ((index - modal.index) % n + n) % n;
    for (let i = 0; i < steps; i++) send({ type: "menu", command: "down" });
    send({ type: "menu", command: "ok" });
  };
  useMenu(command => {
    if (command === "ok" || command === "start" || command === "back") advance(command);
    else if ((command === "up" || command === "down") && choices) send({ type: "menu", command });
  });
  const hasPortrait = !!modal.portrait;
  return <div className="g5-dialog-layer" onClick={() => { if (!choices) advance("ok"); focusStage(); }}>
    <div className={`g5-paper g5-dialog${hasPortrait ? " has-portrait" : ""}`} role="dialog" aria-label={modal.speaker || "Dialog"} aria-live="polite">
      {modal.speaker && <div className="g5-dialog-name">{modal.speaker}</div>}
      {hasPortrait && <Portrait id={modal.portrait} name={modal.speaker} className="g5-dialog-portrait" />}
      <div className="g5-dialog-body">
        <p className="g5-dialog-text">
          <span>{text.slice(0, current)}</span><span className="g5-dialog-rest" aria-hidden="true">{text.slice(current)}</span>
        </p>
        {choices && <ul className="g5-dialog-choices" role="menu">
          {choices.map((choice, index) => <li key={`${index}-${choice}`} role="none">
            <button type="button" role="menuitem" tabIndex={-1} className={`g5-choice${index === modal.index ? " is-on" : ""}`}
              onClick={event => { event.stopPropagation(); pick(index); focusStage(); }}>
              {index === modal.index && <Pointer />}{choice}
            </button>
          </li>)}
        </ul>}
      </div>
      {done && !choices && <i className="g5-advance" aria-hidden="true" />}
      {!modal.choices && modal.total > 1 && <span className="g5-dialog-page">{Math.min(modal.index + 1, modal.total)}/{modal.total}</span>}
    </div>
  </div>;
}

// ─── Quest card ────────────────────────────────────────────────────────────────────────────────
export function QuestCardView({ card, main, send }: { card: QuestCard; main: boolean; send: Send }) {
  const { focusStage } = useUi();
  const [ready, setReady] = useState(false);
  // Swallow the confirm that opened the card for a moment so it is actually read.
  useEffect(() => { const id = setTimeout(() => setReady(true), 350); return () => clearTimeout(id); }, [card.quest, card.mode]);
  useMenu(command => {
    if (!ready) return;
    if (command === "ok" || command === "start" || command === "back") send({ type: "menu", command: command === "back" ? "back" : "ok" });
  });
  const ribbon = card.mode === "offer" ? "New quest" : card.mode === "complete" ? "Quest complete" : "Quest";
  const action = card.mode === "offer" ? "Accept" : card.mode === "complete" ? "Continue" : "Close";
  // A tap anywhere accepts, as with dialog boxes (after the short read delay).
  return <div className="g5-modal-layer g5-dim" onClick={() => { if (ready) send({ type: "menu", command: "ok" }); focusStage(); }}>
    <div className={`g5-paper g5-quest-card is-${card.mode}`} role="dialog" aria-label={`${ribbon}: ${card.title}`}>
      <div className="g5-ribbon"><span>{ribbon}</span></div>
      <h2 className="g5-quest-title"><i className={`g5-badge ${main ? "g5-badge-main" : "g5-badge-side"}`} aria-label={main ? "Main quest" : "Side quest"} />{card.title}</h2>
      <p className="g5-quest-summary">{card.summary}</p>
      <div className="g5-quest-rule" aria-hidden="true" />
      <dl className="g5-quest-facts">
        <div><dt>{card.mode === "complete" ? "Done" : "Objective"}</dt><dd>{card.objective}</dd></div>
        <div className="g5-quest-reward"><dt>Reward</dt><dd><Icon id="icon.gold" small />{card.reward}</dd></div>
      </dl>
      {card.hint && card.mode !== "complete" && <p className="g5-quest-hint">{card.hint}</p>}
      <button type="button" tabIndex={-1} className="g5-button g5-button-primary"
        onClick={event => { event.stopPropagation(); send({ type: "menu", command: "ok" }); focusStage(); }}><Glyph action="ok" />{action}</button>
    </div>
  </div>;
}

// ─── Unlock banner ─────────────────────────────────────────────────────────────────────────────
export function UnlockBanner({ title, hint, icon, send }: { title: string; hint: string; icon: string | null; send: Send }) {
  const { focusStage, device, sound } = useUi();
  const [ready, setReady] = useState(false);
  // The banner's reveal (gong and crystal) is part of the banner.
  useEffect(() => { sound("unlock"); }, [title, sound]);
  useEffect(() => { const id = setTimeout(() => setReady(true), 500); return () => clearTimeout(id); }, [title]);
  useMenu(command => { if (ready && (command === "ok" || command === "back" || command === "start")) send({ type: "menu", command: "ok" }); });
  const magic = /^new magic:/i.test(title);
  const name = title.replace(/^new magic:\s*/i, "");
  return <div className="g5-modal-layer g5-unlock-layer" onClick={() => { if (ready) send({ type: "menu", command: "ok" }); focusStage(); }}>
    <div className="g5-unlock" role="dialog" aria-label={`${magic ? "New magic" : "New skill"}: ${name}`}>
      <div className="g5-unlock-rays" aria-hidden="true" />
      <div className="g5-unlock-kicker">{magic ? "New magic" : "New technique"}</div>
      <div className="g5-unlock-title">{icon && <Icon id={icon} scale={2} />}<span>{name}</span></div>
      <p className="g5-unlock-hint">{hint}</p>
      <Hints items={[["ok", "Got it"]]} />
      {device === "touch" && <i className="g5-advance is-banner" aria-hidden="true" />}
    </div>
  </div>;
}

// ─── Game over ─────────────────────────────────────────────────────────────────────────────────
export function GameOver({ send, onLoad, onTitle }: { send: Send; onLoad: () => void; onTitle: () => void }) {
  const [cursor, setCursor] = useCursor(3);
  const [shown, setShown] = useState(false);
  useEffect(() => { const id = setTimeout(() => setShown(true), 900); return () => clearTimeout(id); }, []);
  const items: MenuItem[] = [
    { key: "retry", label: "Try again", sub: "From the last autosave", onSelect: () => send({ type: "retry" }) },
    { key: "load", label: "Load a save", onSelect: onLoad },
    { key: "title", label: "Title screen", onSelect: onTitle },
  ];
  return <div className="g5-modal-layer g5-gameover">
    <div className="g5-gameover-inner">
      {/* pixel art is drawn 1:1 */}
      <img className="g5-tomb" src="/games/game-05/ui/tombstone.png" alt="" draggable={false} />
      <h2 className="g5-gameover-title">You have fallen</h2>
      <p className="g5-gameover-sub">The valley still needs you. Rest, and rise again.</p>
      {shown && <MenuList className="g5-gameover-menu" items={items} cursor={cursor} setCursor={setCursor} />}
    </div>
  </div>;
}

// ─── Chapter clear ─────────────────────────────────────────────────────────────────────────────
export function ChapterClear({ save, send, onSave, onTitle }: { save: SaveState | null; send: Send; onSave: () => void; onTitle: () => void }) {
  const [cursor, setCursor] = useCursor(3);
  const items: MenuItem[] = [
    { key: "continue", label: "Keep exploring", onSelect: () => send({ type: "menu", command: "ok" }) },
    { key: "save", label: "Save the journey", onSelect: onSave },
    { key: "title", label: "Title screen", onSelect: onTitle },
  ];
  const stats: Array<[string, string]> = save ? [
    ["Time", formatPlayTime(save.playSeconds)], ["Level", String(save.level)], ["Foes defeated", fmt(save.stats.kills)],
    ["Critical hits", fmt(save.stats.crits)], ["Grass cut", fmt(save.stats.grass)], ["Falls", fmt(save.stats.deaths)],
  ] : [];
  return <div className="g5-modal-layer g5-clear-layer">
    <div className="g5-paper g5-clear" role="dialog" aria-label="Chapter One clear">
      {/* pixel art is drawn 1:1 */}
      <img className="g5-clear-gem" src="/games/game-05/ui/crystal.png" alt="" draggable={false} />
      <div className="g5-clear-kicker">Chapter One</div>
      <h2 className="g5-clear-title">The First Wardstone</h2>
      <div className="g5-clear-stamp">Clear</div>
      {save && <dl className="g5-clear-stats">{stats.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>}
      <p className="g5-clear-next">One stone burns again. Chapter Two is on its way.</p>
      <MenuList className="g5-clear-menu" items={items} cursor={cursor} setCursor={setCursor} />
    </div>
  </div>;
}

// ─── Pause ─────────────────────────────────────────────────────────────────────────────────────
type PausePanel = null | "save" | "load" | "settings" | "controls" | "title" | "shelf";

export function Pause({ snapshot, save, slots, prefs, device, onPrefs, onResume, onSaveSlot, onLoadSlot, onTitle, onShelf }: {
  snapshot: HudSnapshot; save: SaveState | null; slots: SlotMeta[]; prefs: Preferences; device: Device;
  onPrefs: (prefs: Preferences) => void; onResume: () => void; onSaveSlot: (slot: SlotId) => boolean; onLoadSlot: (slot: SlotId) => void;
  onTitle: () => void; onShelf: () => void;
}) {
  const [panel, setPanel] = useState<PausePanel>(null);
  const [cursor, setCursor] = useCursor(7);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current); }, []);
  const flash = (text: string) => {
    setToast(text);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 1800);
  };
  const items: MenuItem[] = [
    { key: "resume", label: "Resume", onSelect: onResume },
    { key: "save", label: "Save", onSelect: () => setPanel("save") },
    { key: "load", label: "Load", onSelect: () => setPanel("load"), disabled: !slots.some(s => !s.empty) },
    { key: "settings", label: "Sound & settings", onSelect: () => setPanel("settings") },
    { key: "controls", label: "Controls", onSelect: () => setPanel("controls") },
    { key: "title", label: "Title screen", onSelect: () => setPanel("title") },
    { key: "shelf", label: "Quit to shelf", onSelect: () => setPanel("shelf") },
  ];
  const quests = [snapshot.ticker.main, snapshot.ticker.side].filter(Boolean) as string[];
  return <div className="g5-modal-layer g5-pause-layer">
    <div className="g5-pause" style={panel ? { visibility: "hidden" } : undefined}>
      <div className="g5-paper g5-pause-menu">
        <div className="g5-crest" aria-hidden="true" />
        <h2 className="g5-card-title">Paused</h2>
        <MenuList items={items} cursor={cursor} setCursor={setCursor} onBack={onResume} active={panel === null}
          extra={command => { if (command === "start") { onResume(); return true; } return false; }} />
      </div>
      <div className="g5-dark g5-pause-info">
        <div className="g5-pause-hero">
          <Portrait id="portrait.hero" name={snapshot.heroName} />
          <div>
            <div className="g5-pause-name">{snapshot.heroName}</div>
            <div className="g5-pause-sub">Level {snapshot.level} · {snapshot.mapName}</div>
          </div>
        </div>
        <dl className="g5-pause-facts">
          <div><dt>Play time</dt><dd>{formatPlayTime(save?.playSeconds ?? 0)}</dd></div>
          <div><dt>Gold</dt><dd><Icon id="icon.gold" small />{fmt(snapshot.gold)}</dd></div>
          <div><dt>HP</dt><dd>{snapshot.hp.value}/{snapshot.hp.max}</dd></div>
          <div><dt>MP</dt><dd>{snapshot.mp.value}/{snapshot.mp.max}</dd></div>
        </dl>
        {quests.length > 0 && <div className="g5-pause-quests">
          {snapshot.ticker.main && <div className="g5-ticker g5-ticker-main"><i className="g5-badge g5-badge-main" /><span>{snapshot.ticker.main}</span></div>}
          {snapshot.ticker.side && <div className="g5-ticker g5-ticker-side"><i className="g5-badge g5-badge-side" /><span>{snapshot.ticker.side}</span></div>}
        </div>}
      </div>
    </div>
    {toast && <div className="g5-pause-toast" role="status">{toast}</div>}
    {panel === "save" && <SlotList mode="save" slots={slots} onBack={() => setPanel(null)}
      onPick={slot => { const ok = onSaveSlot(slot); flash(ok ? `Saved to slot ${slot}` : "Could not save on this device"); setPanel(null); }} />}
    {panel === "load" && <SlotList mode="load" slots={slots} onBack={() => setPanel(null)} onPick={slot => { setPanel(null); onLoadSlot(slot); }} />}
    {panel === "settings" && <Settings prefs={prefs} onChange={onPrefs} onBack={() => setPanel(null)} onControls={() => setPanel("controls")} />}
    {panel === "controls" && <Controls initial={device} onBack={() => setPanel(null)} />}
    {panel === "title" && <Confirm message="Return to the title screen?" detail="Progress since your last save or autosave will be lost." danger
      onYes={onTitle} onNo={() => setPanel(null)} />}
    {panel === "shelf" && <Confirm message="Quit to the game shelf?" detail="Progress since your last save or autosave will be lost." danger
      onYes={onShelf} onNo={() => setPanel(null)} />}
  </div>;
}
