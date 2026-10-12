"use client";

import { useState } from "react";
import type { GameCommand, SaveState } from "@/lib/game-05/contract";
import type * as CatalogModule from "./catalog";
import { Glyph, Hints, Icon, useMenu, useUi } from "./ui";

type Cat = typeof CatalogModule;
type Send = (command: GameCommand) => void;

/**
 * The quick item ring: consumables in a fixed ring around the hero (same place every time, so
 * hands learn it), the chosen item's card underneath, key items in a strip below that.
 */
export function ItemRing({ cat, save, send, onClose }: { cat: Cat; save: SaveState; send: Send; onClose: () => void }) {
  const { sound, focusStage, device } = useUi();
  const ids = cat.CONSUMABLE_ORDER;
  const firstOwned = Math.max(0, ids.findIndex(id => (save.bag[id] ?? 0) > 0));
  const [index, setIndex] = useState(firstOwned);
  const id = ids[index];
  const info = cat.itemInfo(id);
  const count = save.bag[id] ?? 0;
  const keys = Object.keys(save.bag).filter(k => cat.CATALOG.keyItems[k] && save.bag[k] > 0);
  const use = () => {
    if (!info || count <= 0) { sound("deny"); return; }
    send({ type: "use", item: id });
    onClose();
  };
  const move = (delta: number) => { setIndex(i => (i + delta + ids.length) % ids.length); sound("move"); };
  useMenu(command => {
    if (command === "left" || command === "up") move(-1);
    else if (command === "right" || command === "down") move(1);
    else if (command === "ok") use();
    else if (command === "back" || command === "item" || command === "start") { sound("back"); onClose(); }
  });
  const n = ids.length;
  return <div className="g5-modal-layer g5-items-layer" onClick={event => { if (event.target === event.currentTarget) { sound("back"); onClose(); } }}>
    <div className="g5-ring-zone" onClick={event => { if (event.target === event.currentTarget) { sound("back"); onClose(); } }}>
      <div className="g5-ring" role="listbox" aria-label="Items" style={{ ["--n" as string]: n }}>
        {ids.map((itemId, i) => {
          const it = cat.itemInfo(itemId);
          const have = save.bag[itemId] ?? 0;
          const angle = (i / n) * Math.PI * 2 - Math.PI / 2;
          return <button key={itemId} type="button" role="option" tabIndex={-1} aria-selected={i === index} aria-label={`${it?.name ?? itemId}, ${have}`}
            className={`g5-ring-item${i === index ? " is-on" : ""}${have ? "" : " is-empty"}`}
            style={{ ["--x" as string]: Math.cos(angle).toFixed(4), ["--y" as string]: Math.sin(angle).toFixed(4) }}
            onPointerEnter={event => { if (event.pointerType === "mouse" && i !== index) setIndex(i); }}
            onClick={() => { if (i === index) use(); else { setIndex(i); sound("move"); } focusStage(); }}>
            <span className="g5-slot-frame"><Icon id={it?.icon ?? itemId} dim={!have} /></span>
            <span className="g5-ring-count">{have}</span>
          </button>;
        })}
      </div>
    </div>
    <div className="g5-paper g5-ring-card" aria-live="polite">
      <span className="g5-slot-frame g5-ring-card-icon"><Icon id={info?.icon ?? id} scale={2} dim={!count} /></span>
      <div className="g5-ring-card-text">
        <div className="g5-ring-name">{info?.name ?? ""}</div>
        <div className="g5-ring-effect">{info?.consumable ? cat.describeEffect(info.consumable) : ""}</div>
        <p className="g5-ring-desc">{info?.desc}</p>
      </div>
      <div className="g5-ring-card-side">
        <div className="g5-ring-carry"><b>{count}</b>/{info?.consumable?.carry ?? 9}</div>
        {device === "touch"
          ? <button type="button" tabIndex={-1} className="g5-button g5-button-primary g5-ring-use-btn" disabled={!count} onClick={() => { use(); focusStage(); }}>Use</button>
          : <span className={`g5-ring-use${count ? "" : " is-off"}`}><Glyph action="ok" />Use</span>}
      </div>
    </div>
    {keys.length > 0 && <div className="g5-keyitems g5-dark" aria-label="Key items">
      <span className="g5-keyitems-title">Key items</span>
      {keys.map(k => <span key={k} className="g5-keyitem" title={cat.CATALOG.keyItems[k].desc}>
        <Icon id={cat.CATALOG.keyItems[k].icon} small />{cat.CATALOG.keyItems[k].name}{save.bag[k] > 1 && <b>×{save.bag[k]}</b>}
      </span>)}
    </div>}
    {device === "touch"
      ? <button type="button" tabIndex={-1} className="g5-close has-label g5-items-close" onClick={() => { sound("back"); onClose(); focusStage(); }}>Close</button>
      : <Hints items={[["move", "Choose"], ["ok", "Use"], ["back", "Close"]]} />}
  </div>;
}
