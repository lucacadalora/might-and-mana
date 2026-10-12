"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { MapDef, MapId, SaveState } from "@/lib/game-05/contract";
import type * as CatalogModule from "./catalog";
import { Hints, useMenu, useUi } from "./ui";

type Cat = typeof CatalogModule;

/** Parchment-and-ink colours for each ground material. */
const INK: Record<string, string> = {
  g: "#c7c287", G: "#b2ad73", d: "#d0a96e", c: "#d2c29e", s: "#ecdcab", w: "#a9c9c0", W: "#78a6b2", f: "#dcc493", t: "#c8baa0",
  k: "#ad9e84", m: "#a68f65", "#": "#6e5538", H: "#7d5c3c", x: "", b: "#b98a52",
};
const CLASS: Record<string, number> = { W: 1, w: 1, "#": 2, H: 2, x: 3 };
const BUILDINGS = new Set(["house", "inn", "shopHouse", "smithyHouse", "tavernHouse", "hall"]);
const TREES = new Set(["tree", "pine", "deadTree"]);
const ROCKS = new Set(["rock", "boulder", "gravestone", "statue"]);

function paint(ctx: CanvasRenderingContext2D, map: MapDef, tp: number, props: Cat["CATALOG"]["props"]) {
  const H = map.ground.length, W = map.ground[0]?.length ?? 0;
  ctx.clearRect(0, 0, W * tp, H * tp);
  const at = (x: number, y: number) => map.ground[y]?.[x] ?? "x";
  const height = (x: number, y: number) => Number(map.height?.[y]?.[x] ?? 0) || 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const g = at(x, y);
      const color = INK[g] ?? INK.g;
      if (!color) continue;
      ctx.fillStyle = color;
      ctx.fillRect(x * tp, y * tp, tp, tp);
      const h = height(x, y);
      if (h > 0) { ctx.fillStyle = `rgba(255, 250, 225, ${0.12 * h})`; ctx.fillRect(x * tp, y * tp, tp, tp); }
      if (g === "W" && tp >= 4 && (x + y * 3) % 5 === 0) { ctx.fillStyle = "#9cc3cb"; ctx.fillRect(x * tp + 1, y * tp + Math.floor(tp / 2), Math.max(2, tp - 3), 1); }
      if ((g === "g" || g === "G") && tp >= 5 && (x * 7 + y * 13) % 11 === 0) { ctx.fillStyle = "#a3a067"; ctx.fillRect(x * tp + 2, y * tp + 2, 1, 2); }
    }
  }
  // Ink outlines where water, walls or void meet open ground; cliff lines on terrace edges.
  ctx.fillStyle = "rgba(74, 52, 30, 0.85)";
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const a = CLASS[at(x, y)] ?? 0;
      if (x + 1 < W && (CLASS[at(x + 1, y)] ?? 0) !== a && (a !== 3 || at(x + 1, y) !== "x")) ctx.fillRect((x + 1) * tp - (a === 0 ? 1 : 0), y * tp, 1, tp);
      if (y + 1 < H && (CLASS[at(x, y + 1)] ?? 0) !== a) ctx.fillRect(x * tp, (y + 1) * tp - (a === 0 ? 1 : 0), tp, 1);
      if (y + 1 < H && height(x, y) > height(x, y + 1)) { ctx.fillRect(x * tp, (y + 1) * tp - 1, tp, 2); }
    }
  }
  const T = 32, s = tp / T;
  const sorted = [...map.props].sort((p, q) => Number(BUILDINGS.has(p.kind)) - Number(BUILDINGS.has(q.kind)));
  for (const p of sorted) {
    const def = props[p.kind];
    if (!def) continue;
    const ax = p.x * tp, ay = p.y * tp;
    if (BUILDINGS.has(p.kind)) {
      const w = def.w * s, h = def.h * s * 0.72;
      const x0 = Math.round(ax - w / 2), y0 = Math.round(ay - h), ww = Math.round(w), hh = Math.round(h);
      ctx.fillStyle = "#4a3020"; ctx.fillRect(x0 - 1, y0 - 1, ww + 2, hh + 2);
      ctx.fillStyle = p.kind === "hall" ? "#8a6a8a" : p.kind === "inn" ? "#b0643c" : "#a8553a"; ctx.fillRect(x0, y0, ww, hh);
      ctx.fillStyle = "rgba(255, 220, 180, 0.35)"; ctx.fillRect(x0, y0, ww, Math.max(1, Math.round(hh * 0.3)));
      ctx.fillStyle = "rgba(60, 30, 20, 0.35)"; ctx.fillRect(x0 + Math.round(ww / 2), y0, 1, hh);
    } else if (TREES.has(p.kind)) {
      const r = Math.max(1.5, def.w * s * 0.32);
      ctx.fillStyle = "#4f6b34";
      for (let yy = -Math.ceil(r); yy <= Math.ceil(r); yy++) {
        const half = Math.floor(Math.sqrt(Math.max(0, r * r - yy * yy)));
        ctx.fillRect(Math.round(ax - half), Math.round(ay - r * 1.1 + yy), half * 2 + 1, 1);
      }
      ctx.fillStyle = "#6f8a45"; ctx.fillRect(Math.round(ax - r / 2), Math.round(ay - r * 1.6), Math.max(1, Math.round(r / 2)), 1);
    } else if (p.kind === "bush") {
      ctx.fillStyle = "#6a8440"; ctx.fillRect(Math.round(ax - tp * 0.25), Math.round(ay - tp * 0.4), Math.max(1, Math.round(tp * 0.5)), Math.max(1, Math.round(tp * 0.4)));
    } else if (ROCKS.has(p.kind)) {
      ctx.fillStyle = "#8c8574"; const w = Math.max(1, Math.round(def.w * s * 0.6)); ctx.fillRect(Math.round(ax - w / 2), Math.round(ay - w * 0.7), w, Math.max(1, Math.round(w * 0.6)));
    } else if (p.kind === "fence" || p.kind === "fenceV") {
      ctx.fillStyle = "#7a5530";
      if (p.kind === "fence") ctx.fillRect(Math.round(ax - tp / 2), Math.round(ay - 1), tp, 1);
      else ctx.fillRect(Math.round(ax), Math.round(ay - tp), 1, tp);
    } else if (p.kind === "fountain" || p.kind === "well") {
      ctx.fillStyle = "#5c7f8a"; const w = Math.max(2, Math.round(def.w * s * 0.8)); ctx.fillRect(Math.round(ax - w / 2), Math.round(ay - w * 0.8), w, w);
      ctx.fillStyle = "#9fc6cf"; ctx.fillRect(Math.round(ax - w / 4), Math.round(ay - w * 0.6), Math.max(1, Math.round(w / 2)), Math.max(1, Math.round(w / 2)));
    } else if (p.kind === "dock" || p.kind === "boat") {
      ctx.fillStyle = "#8a6034"; const w = Math.max(1, Math.round(def.w * s)); ctx.fillRect(Math.round(ax - w / 2), Math.round(ay - def.h * s), w, Math.max(1, Math.round(def.h * s)));
    } else if (p.kind === "wardstone") {
      ctx.fillStyle = "#2f7d93"; const w = Math.max(2, Math.round(tp * 0.8)); ctx.fillRect(Math.round(ax - w / 2), Math.round(ay - w * 1.6), w, Math.round(w * 1.6));
      ctx.fillStyle = "#bff4ff"; ctx.fillRect(Math.round(ax), Math.round(ay - w * 1.4), 1, Math.round(w * 1.1));
    } else if (p.kind === "stairsUp" || p.kind === "stairsDown") {
      ctx.fillStyle = "#5e4630"; ctx.fillRect(Math.round(ax - tp / 2), Math.round(ay - tp), tp, tp);
      ctx.fillStyle = "#b8a07a"; for (let i = 1; i < 4; i++) ctx.fillRect(Math.round(ax - tp / 2), Math.round(ay - tp + (i * tp) / 4), tp, 1);
    } else if (p.kind === "counter" || p.kind === "table" || p.kind === "bed" || p.kind === "shelf" || p.kind === "bookcase" || p.kind === "hearth") {
      ctx.fillStyle = "#8d6a44"; const w = Math.max(1, Math.round(def.w * s)), h = Math.max(1, Math.round(Math.min(def.h, 40) * s));
      ctx.fillRect(Math.round(ax - w / 2), Math.round(ay - h), w, h);
    }
  }
}

type Box = { x: number; y: number; w: number; h: number };
const overlaps = (a: Box, b: Box, pad = 2) => a.x < b.x + b.w + pad && a.x + a.w + pad > b.x && a.y < b.y + b.h + pad && a.y + a.h + pad > b.y;

/**
 * Place exit labels inside the sheet without overlaps: edge exits read inward from their edge,
 * doors sit above their door; a label that would cover another (or the hero marker) slides up or
 * down by whole label heights until it is clear. Runs on the rendered labels (real text widths).
 */
function placeLabels(sheet: HTMLElement, tp: number, u: number, W: number, H: number) {
  const sw = sheet.clientWidth, sh = sheet.clientHeight;
  const gap = 7 * u;
  const placed: Box[] = [];
  const hero = sheet.querySelector<HTMLElement>(".g5-map-hero");
  if (hero) placed.push({ x: hero.offsetLeft - 6 * u, y: hero.offsetTop - 6 * u, w: 12 * u, h: 12 * u });
  const els = [...sheet.querySelectorAll<HTMLElement>(".g5-map-exit")];
  // Edge exits first: they have the least room to move.
  els.sort((a, b) => Number(a.dataset.kind === "door") - Number(b.dataset.kind === "door"));
  for (const el of els) {
    const tx = Number(el.dataset.x), ty = Number(el.dataset.y);
    const w = el.offsetWidth, h = el.offsetHeight;
    const ax = tx * tp * u, ay = ty * tp * u;
    const alignX = tx < W * 0.22 ? ax : tx > W * 0.78 ? ax - w : ax - w / 2;
    let x = alignX, y = ay - gap - h;
    if (tx <= 1.5) { x = ax + gap; y = ay - h / 2; }
    else if (tx >= W - 1.5) { x = ax - gap - w; y = ay - h / 2; }
    else if (ty <= 1.5) y = ay + gap;
    const clamp = (b: Box): Box => ({ ...b, x: Math.max(0, Math.min(sw - b.w, b.x)), y: Math.max(0, Math.min(sh - b.h, b.y)) });
    let best = clamp({ x, y, w, h });
    for (const step of [0, -1, 1, -2, 2, -3, 3, -4, 4]) {
      const r = clamp({ x, y: y + step * (h + 2), w, h });
      if (!placed.some(p => overlaps(r, p))) { best = r; break; }
    }
    placed.push(best);
    el.style.left = `${Math.round(best.x)}px`;
    el.style.top = `${Math.round(best.y)}px`;
    el.style.visibility = "visible";
  }
  void H;
}

export function MapScreen({ cat, save, onClose }: { cat: Cat; save: SaveState; onClose: () => void }) {
  const { sound, focusStage } = useUi();
  const map = cat.CATALOG.maps[save.map];
  const boxRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [fit, setFit] = useState<{ tp: number; u: number } | null>(null);
  const W = map?.ground[0]?.length ?? 1, H = map?.ground.length ?? 1;
  useLayoutEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const measure = () => {
      const u = parseFloat(getComputedStyle(box).getPropertyValue("--u")) || 1;
      const rect = box.getBoundingClientRect();
      // Phone portrait: the card hugs the map, which may use up to 62% of the screen height.
      const portrait = matchMedia("(max-aspect-ratio: 4/5)").matches;
      const stage = box.closest(".g5-stage")?.getBoundingClientRect();
      const maxH = portrait && stage ? stage.height * 0.62 : rect.height;
      const tp = Math.max(2, Math.min(24, Math.floor(Math.min(rect.width / u / W, maxH / u / H))));
      setFit(current => current && current.tp === tp && current.u === u ? current : { tp, u });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    return () => observer.disconnect();
  }, [W, H]);
  useEffect(() => {
    const canvas = canvasRef.current, ctx = canvas?.getContext("2d");
    if (!canvas || !ctx || !map || !fit) return;
    canvas.width = W * fit.tp; canvas.height = H * fit.tp;
    ctx.imageSmoothingEnabled = false;
    paint(ctx, map, fit.tp, cat.CATALOG.props);
  }, [cat, map, fit, W, H]);
  const goals = useMemo(() => cat.objectives(save), [cat, save]);
  const exits = useMemo(() => (map?.entities ?? []).flatMap(e => e.type === "exit" ? [e] : []), [map]);
  const labels = useMemo(() => {
    const seen = new Set<MapId>();
    return exits.filter(e => { if (seen.has(e.to)) return false; seen.add(e.to); return true; })
      .map(e => ({ x: e.x + e.w / 2, y: e.y + e.h / 2, to: e.to, name: cat.CATALOG.maps[e.to]?.name ?? e.to, kind: e.kind }));
  }, [exits, cat]);
  const sheetRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (sheetRef.current && fit) placeLabels(sheetRef.current, fit.tp, fit.u, W, H);
  }, [fit, labels, W, H]);
  useMenu(command => { if (command === "back" || command === "map" || command === "ok" || command === "start") { sound("back"); onClose(); } });
  if (!map) return null;
  const heroX = save.x / cat.WORLD_TILE, heroY = save.y / cat.WORLD_TILE;
  const here = goals.filter(g => g.map === save.map);
  const away = goals.filter(g => g.map !== save.map).map(g => ({ goal: g, exit: cat.exitToward(save.map, g.map) }));
  const pos = (x: number, y: number) => fit ? { left: `calc(var(--u) * ${x * fit.tp})`, top: `calc(var(--u) * ${y * fit.tp})` } : {};
  return <div className="g5-modal-layer g5-map-layer" onClick={() => { sound("back"); onClose(); focusStage(); }}>
    <div className="g5-paper g5-map-card" role="dialog" aria-label={`Map: ${map.name}`}>
      <header className="g5-map-head">
        <h2 className="g5-card-title">{map.name}</h2>
        {map.level ? <span className="g5-map-level">Foes around level {map.level}</span> : null}
      </header>
      <div className="g5-map-box" ref={boxRef}>
        {fit && <div className="g5-map-sheet" ref={sheetRef} style={{ width: `calc(var(--u) * ${W * fit.tp})`, height: `calc(var(--u) * ${H * fit.tp})` }}>
          <canvas ref={canvasRef} className="g5-map-canvas" aria-hidden="true" />
          {labels.map(l => <span key={l.to} className={`g5-map-exit is-${l.kind}`} data-x={l.x} data-y={l.y} data-kind={l.kind}
            style={{ visibility: "hidden" }}><i />{l.name}</span>)}
          {here.map(g => <span key={g.quest} className={`g5-map-goal${g.main ? " is-main" : ""}`} style={pos(g.x + 0.5, g.y + 0.5)} title={g.label}><i /></span>)}
          {away.map(({ goal, exit }) => exit && <span key={goal.quest} className={`g5-map-goal is-away${goal.main ? " is-main" : ""}`} style={pos(exit.x + exit.w / 2, exit.y + exit.h / 2)}><i /></span>)}
          <span className="g5-map-hero" style={pos(heroX, heroY)} aria-label="You are here"><i /></span>
        </div>}
      </div>
      <footer className="g5-map-foot">
        <ul className="g5-map-goals">
          {goals.length === 0 && <li>No active quest.</li>}
          {goals.map(g => <li key={g.quest}>
            <i className={`g5-badge ${g.main ? "g5-badge-main" : "g5-badge-side"}`} />
            <span>{g.label}</span>
            {g.map !== save.map && <em>{cat.CATALOG.maps[g.map]?.name ?? g.map}</em>}
          </li>)}
        </ul>
        <div className="g5-map-legend"><span><i className="g5-legend-hero" />You</span><span><i className="g5-legend-goal" />Goal</span><span><i className="g5-legend-exit" />Way out</span></div>
      </footer>
      <Hints items={[["back", "Close"]]} />
    </div>
  </div>;
}
