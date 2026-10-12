"use client";

import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { HudSnapshot } from "@/lib/game-05/contract";
import { BUFF_ICONS, BUFF_NAMES } from "./catalog-lite";
import { Bar, Glyph, Icon, Portrait, fmt, useUi } from "./ui";

/** DOM nodes the host moves every animation frame (outside React) so they track the camera. */
export interface LiveNodes {
  arrow: HTMLDivElement | null;
  arrowImg: HTMLElement | null;
  prompt: HTMLDivElement | null;
  charge: HTMLElement | null;
  touchCharge: HTMLElement | null;
}
export const createLiveNodes = (): LiveNodes => ({ arrow: null, arrowImg: null, prompt: null, charge: null, touchCharge: null });

const ARROW_FRAMES = 16;
const snap = (v: number, dpr: number) => Math.round(v * dpr) / dpr;

/** A HUD block the objective arrow must stay clear of (CSS px, stage coordinates). */
export interface HudBox { l: number; t: number; r: number; b: number }
export interface StageInfo {
  w: number; h: number; dpr: number; u: number;
  /** Bottom of the whole top HUD, and the height taken by the tickers / touch controls. */
  top: number; bottom: number;
  /** Top of the HUD row (the safe-area top) and the HUD blocks themselves. */
  safeTop: number; boxes: HudBox[];
}

/** Where a ray from (ox, oy) along (dx, dy) first enters `box`, or Infinity. */
function rayEnters(ox: number, oy: number, dx: number, dy: number, box: HudBox): number {
  let t0 = -Infinity, t1 = Infinity;
  for (const [o, d, lo, hi] of [[ox, dx, box.l, box.r], [oy, dy, box.t, box.b]] as const) {
    if (Math.abs(d) < 1e-6) { if (o < lo || o > hi) return Infinity; continue; }
    const a = (lo - o) / d, b = (hi - o) / d;
    t0 = Math.max(t0, Math.min(a, b)); t1 = Math.min(t1, Math.max(a, b));
  }
  return t1 >= Math.max(0, t0) && t0 > 0 ? t0 : Infinity;
}

/**
 * Position the objective arrow on the playfield edge, the interaction prompt over its target and
 * the charge fill. The arrow runs from the screen centre toward the target and stops at the screen
 * edge, above the tickers and touch controls, or just short of a HUD block in its way (so it can
 * still use the free top centre between the vitals and the right-hand column).
 */
export function updateLive(nodes: LiveNodes, snapshot: HudSnapshot, stage: StageInfo, visible: boolean) {
  const { arrow, arrowImg, prompt, charge, touchCharge } = nodes;
  const { w, h, dpr, u } = stage;
  if (arrow) {
    const a = visible ? snapshot.arrow : null;
    if (!a || !Number.isFinite(a.angle)) arrow.style.visibility = "hidden";
    else {
      const m = 18 * u;
      const left = m, right = w - m, top = stage.safeTop + m, bottom = h - stage.bottom - m;
      const cx = w / 2, cy = Math.max(stage.top + m, Math.min(bottom - 1, h / 2));
      const dx = Math.cos(a.angle), dy = Math.sin(a.angle);
      let t = Infinity;
      if (dx > 1e-4) t = Math.min(t, (right - cx) / dx);
      if (dx < -1e-4) t = Math.min(t, (left - cx) / dx);
      if (dy > 1e-4) t = Math.min(t, (bottom - cy) / dy);
      if (dy < -1e-4) t = Math.min(t, (top - cy) / dy);
      for (const box of stage.boxes) t = Math.min(t, rayEnters(cx, cy, dx, dy, { l: box.l - m, t: box.t - m, r: box.r + m, b: box.b + m }));
      if (!Number.isFinite(t) || t < 0) t = 0;
      const x = snap(cx + dx * t, dpr), y = snap(cy + dy * t, dpr);
      const frame = ((Math.round(a.angle / (Math.PI * 2 / ARROW_FRAMES)) % ARROW_FRAMES) + ARROW_FRAMES) % ARROW_FRAMES;
      arrow.style.visibility = "visible";
      arrow.style.transform = `translate(${x}px, ${y}px)`;
      arrow.style.setProperty("--dx", dx.toFixed(3));
      arrow.style.setProperty("--dy", dy.toFixed(3));
      arrow.dataset.side = Math.abs(dx) > 0.45 ? (dx > 0 ? "right" : "left") : (dy > 0 ? "bottom" : "top");
      if (arrowImg) arrowImg.style.backgroundPosition = `calc(var(--u) * ${-frame * 21}) 0`;
    }
  }
  if (prompt) {
    const p = visible ? snapshot.prompt : null;
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) prompt.style.visibility = "hidden";
    else {
      prompt.style.visibility = "visible";
      // Keep the bubble between the HUD and the tickers / touch controls.
      const y = Math.min(h - stage.bottom - 6 * u, Math.max(stage.top + 30 * u, p.y));
      prompt.style.transform = `translate(${snap(Math.max(40, Math.min(w - 40, p.x)), dpr)}px, ${snap(y, dpr)}px)`;
    }
  }
  const c = Math.max(0, Math.min(1, snapshot.charge || 0));
  for (const node of [charge, touchCharge]) {
    if (!node) continue;
    node.style.setProperty("--charge", c.toFixed(3));
    node.dataset.full = c >= 1 ? "true" : "false";
    node.dataset.active = c > 0 ? "true" : "false";
  }
}

// ─── pieces ────────────────────────────────────────────────────────────────────────────────────
function useFlash(value: unknown, ms = 1400): boolean {
  const [on, setOn] = useState(false);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    setOn(true);
    const id = setTimeout(() => setOn(false), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return on;
}

/** Gold counts up (or down) to its new value with a short glow, inside the plate. */
export function GoldPlate({ gold }: { gold: number }) {
  const [shown, setShown] = useState(gold);
  const [mood, setMood] = useState<"gain" | "spend" | null>(null);
  const shownRef = useRef(gold);
  useEffect(() => {
    const from = shownRef.current;
    if (from === gold) return;
    setMood(gold > from ? "gain" : "spend");
    const t0 = performance.now(), span = Math.min(700, 250 + Math.abs(gold - from) * 8);
    let raf = 0;
    const step = (now: number) => {
      const k = Math.min(1, (now - t0) / span);
      const value = Math.round(from + (gold - from) * (1 - (1 - k) * (1 - k)));
      shownRef.current = value;
      setShown(value);
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    const calm = setTimeout(() => setMood(null), span + 500);
    return () => { cancelAnimationFrame(raf); clearTimeout(calm); shownRef.current = gold; setShown(gold); };
  }, [gold]);
  return <div className={`g5-gold g5-plate${mood ? ` is-${mood}` : ""}`} aria-label={`${gold} gold`}>
    <Icon id="icon.gold" />
    <span className="g5-num">{fmt(shown)}</span>
  </div>;
}

type NoticeItem = HudSnapshot["notices"][number] & { leaving?: boolean };
function Notices({ notices }: { notices: HudSnapshot["notices"] }) {
  const [items, setItems] = useState<NoticeItem[]>([]);
  // The snapshot hands over a new array every frame; only a change in the set of ids matters.
  // (State derived during render: React re-renders at once, before painting.)
  const key = notices.map(n => n.id).join(",");
  const [seenKey, setSeenKey] = useState("");
  if (key !== seenKey) {
    setSeenKey(key);
    const ids = new Set(notices.map(n => n.id));
    const kept = items.map(n => ids.has(n.id) ? n : { ...n, leaving: true });
    for (const n of notices) if (!kept.some(k => k.id === n.id)) kept.push(n);
    setItems(kept.slice(-6));
  }
  const leaving = items.some(n => n.leaving);
  useEffect(() => {
    if (!leaving) return;
    const id = setTimeout(() => setItems(current => current.filter(n => !n.leaving)), 320);
    return () => clearTimeout(id);
  }, [leaving, items]);
  const icon = (kind: NoticeItem["kind"]) => kind === "gold" ? "icon.gold" : kind === "item" ? "ui.bag" : kind === "quest" ? "ui.quest" : kind === "warning" ? "ui.warning" : "ui.star";
  return <div className="g5-notices" aria-live="polite">
    {items.map(n => <div key={n.id} className={`g5-notice g5-notice-${n.kind}${n.leaving ? " is-leaving" : ""}`}>
      <Icon id={icon(n.kind)} small />
      <span>{n.text}</span>
    </div>)}
  </div>;
}

function BossBar({ boss }: { boss: NonNullable<HudSnapshot["boss"]> }) {
  const phases = 3;
  return <div className="g5-boss" role="status" aria-label={`${boss.name}, ${boss.hp} of ${boss.max}`}>
    <div className="g5-boss-head">
      <span className="g5-boss-name">{boss.name}</span>
      <span className="g5-boss-phases" aria-hidden="true">
        {Array.from({ length: phases }, (_, i) => <i key={i} className={i < boss.phase ? "is-on" : ""} />)}
      </span>
    </div>
    <Bar value={boss.hp} max={boss.max} kind="boss" />
  </div>;
}

function Ticker({ main, side }: HudSnapshot["ticker"]) {
  const flashMain = useFlash(main);
  const flashSide = useFlash(side);
  if (!main && !side) return null;
  return <div className="g5-tickers">
    {main && <div className={`g5-ticker g5-ticker-main${flashMain ? " is-new" : ""}`}><i className="g5-badge g5-badge-main" aria-label="Main quest" /><span>{main}</span></div>}
    {side && <div className={`g5-ticker g5-ticker-side${flashSide ? " is-new" : ""}`}><i className="g5-badge g5-badge-side" aria-label="Side quest" /><span>{side}</span></div>}
  </div>;
}

export type SetLive = (key: keyof LiveNodes, node: HTMLElement | null) => void;

export function Hud({ snapshot, setLive, touch, hideTop, onPortrait, onSpell, touchBar = null }: {
  snapshot: HudSnapshot; setLive: SetLive; touch: boolean; hideTop: boolean; onPortrait: () => void; onSpell: () => void;
  /** Touch map and pause buttons (only while playing on touch). */
  touchBar?: ReactNode;
}) {
  const { device } = useUi();
  const s = snapshot;
  const levelFlash = useFlash(s.level, 1800);
  const hpLow = s.hp.max > 0 && s.hp.value / s.hp.max <= 0.25 && s.hp.value > 0;
  const xpPct = s.xp.next > 0 ? Math.round(Math.max(0, Math.min(1, s.xp.value / s.xp.next)) * 100) : 100;
  return <div className={`g5-hud${touch ? " has-touch" : ""}`} data-top={hideTop ? "hidden" : "shown"}>
    {hpLow && <div className="g5-low-hp" aria-hidden="true" />}
    <div className="g5-hud-top">
      <div className="g5-vitals g5-plate">
        <button type="button" tabIndex={-1} className="g5-vitals-portrait" onClick={onPortrait} aria-label="Status and gear">
          <Portrait id="portrait.hero" name={s.heroName} />
          <span className={`g5-level${levelFlash ? " is-up" : ""}`} aria-label={`Level ${s.level}`}>
            <span className="g5-level-num">{s.level}</span>
          </span>
        </button>
        <div className="g5-vitals-bars">
          <div className="g5-vital g5-vital-hp">
            <span className="g5-vital-tag">HP</span>
            <Bar value={s.hp.value} max={s.hp.max} kind="hp" />
            <span className="g5-vital-num"><b>{s.hp.value}</b>/{s.hp.max}</span>
          </div>
          <div className="g5-vital g5-vital-mp">
            <span className="g5-vital-tag">MP</span>
            <Bar value={s.mp.value} max={s.mp.max} kind="mp" />
            <span className="g5-vital-num"><b>{s.mp.value}</b>/{s.mp.max}</span>
          </div>
          <div className="g5-vital g5-vital-charge">
            <span className="g5-vital-tag">PW</span>
            <span className="g5-bar g5-bar-charge" ref={node => setLive("charge", node)}><span className="g5-bar-fill" /><span className="g5-bar-ticks" /></span>
            <span className="g5-xp" aria-label={`Experience ${s.xp.value} of ${s.xp.next}`} title={`EXP ${s.xp.value} / ${s.xp.next}`}>
              <span className="g5-xp-tag">EXP</span>
              <Bar value={s.xp.value} max={s.xp.next || 1} kind="xp" />
              <span className="g5-sr">{xpPct}%</span>
            </span>
          </div>
        </div>
      </div>
      <div className="g5-hud-right">
        <GoldPlate gold={s.gold} />
        <div className="g5-chips">
          {s.spell && <button type="button" tabIndex={-1} className={`g5-spell g5-plate${s.spell.ready ? "" : " is-dry"}`} onClick={onSpell}
            aria-label={`${s.spell.name}, ${s.spell.mp} MP. Next spell`}>
            <span className="g5-spell-icon"><Icon id={s.spell.icon || `icon.spell.${s.spell.id}`} /></span>
            <span className="g5-spell-text"><span className="g5-spell-name">{s.spell.name}</span><span className="g5-spell-mp">{s.spell.mp} MP</span></span>
            {!touch && <Glyph action="magic" device={device} />}
          </button>}
          {s.buffs.map(b => <Buff key={b.id} id={b.id} seconds={b.seconds} />)}
        </div>
        {touchBar}
      </div>
    </div>
    {s.boss && <BossBar boss={s.boss} />}
    <Notices notices={s.notices} />
    <Ticker main={s.ticker.main} side={s.ticker.side} />
    <div className="g5-arrow" ref={node => setLive("arrow", node)} style={{ visibility: "hidden" }} aria-hidden="true">
      <i className="g5-arrow-img" ref={node => setLive("arrowImg", node)} />
      {s.arrow?.label && <span className="g5-arrow-label">{s.arrow.label}</span>}
    </div>
    <div className="g5-prompt" ref={node => setLive("prompt", node)} style={{ visibility: "hidden" }} aria-live="polite">
      {s.prompt && <span className="g5-prompt-bubble"><Glyph action="attack" device={device} /><span>{s.prompt.label}</span></span>}
    </div>
  </div>;
}

/** A timed draught: icon, a draining bar and whole seconds left. Buffs last 30 s. */
function Buff({ id, seconds }: { id: string; seconds: number }) {
  const [full, setFull] = useState(Math.max(30, seconds));
  if (seconds > full) setFull(seconds);
  return <span className={`g5-buff g5-plate${seconds <= 5 ? " is-ending" : ""}`} title={`${BUFF_NAMES[id] ?? id}: ${seconds} seconds`}
    aria-label={`${BUFF_NAMES[id] ?? id}, ${seconds} seconds left`}>
    <Icon id={BUFF_ICONS[id] ?? `icon.${id}`} />
    <span className="g5-num g5-buff-time">{seconds}</span>
    <span className="g5-buff-drain" style={{ transform: `scaleX(${Math.max(0, Math.min(1, seconds / full))})` }} />
  </span>;
}
