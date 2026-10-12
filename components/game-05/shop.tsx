"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { GameCommand, SaveState, Slot, Stats } from "@/lib/game-05/contract";
import type * as CatalogModule from "./catalog";
import { Confirm, Hints, Icon, Pointer, fmt, useMenu, useUi } from "./ui";
import { GoldPlate } from "./hud";

type Cat = typeof CatalogModule;
type Send = (command: GameCommand) => void;
type Tab = "buy" | "sell";
const SLOT_ICONS: Record<Slot, string> = { head: "slot.head", body: "slot.body", boots: "slot.boots", weapon: "slot.weapon", charm: "slot.charm" };

export function StatPreview({ cat, save, item, compact = false }: { cat: Cat; save: SaveState; item: string; compact?: boolean }) {
  const now = cat.heroStats(save);
  const next = cat.previewStats(save, item);
  const keys: (keyof Stats)[] = ["atk", "def", "spd", ...(["hp", "mp"] as const).filter(k => now[k] !== next[k])];
  return <div className={`g5-stats-preview${compact ? " is-compact" : ""}`}>
    {keys.map(key => {
      const d = next[key] - now[key];
      return <div key={key} className="g5-stat-row">
        <span className="g5-stat-name">{cat.STAT_NAMES[key]}</span>
        <span className="g5-stat-now">{now[key]}</span>
        <span className="g5-stat-arrow" aria-hidden="true">›</span>
        <span className={`g5-stat-next${d > 0 ? " is-up" : d < 0 ? " is-down" : ""}`}>{next[key]}</span>
        <span className={`g5-stat-delta${d > 0 ? " is-up" : d < 0 ? " is-down" : ""}`}>{d > 0 ? `+${d}` : d < 0 ? `−${-d}` : ""}</span>
      </div>;
    })}
  </div>;
}

export function Shop({ cat, shopId, save, send, onLeave }: { cat: Cat; shopId: string; save: SaveState; send: Send; onLeave: () => void }) {
  const { sound, device, focusStage } = useUi();
  const shop = cat.CATALOG.shops[shopId];
  const arms = shop?.kind === "arms";
  const [tab, setTab] = useState<Tab>("buy");
  const [cat0, setCategory] = useState(0);
  const [row, setRow] = useState(0);
  const [ask, setAsk] = useState<null | { kind: "buy" | "sell" | "equip"; item: string }>(null);
  const stock = useMemo(() => cat.shopStock(shopId, save), [cat, shopId, save]);
  const listRef = useRef<HTMLUListElement>(null);
  const categories = useMemo(() => {
    if (!arms) return [] as Slot[];
    const slots = cat.SLOTS.filter(slot => stock.some(id => cat.CATALOG.gear[id]?.slot === slot));
    return slots;
  }, [arms, cat, stock]);
  const sellList = useMemo(() => cat.sellable(save), [cat, save]);
  const category = categories[Math.min(cat0, categories.length - 1)];
  const rows: Array<{ id: string; count: number }> = tab === "sell"
    ? sellList
    : (arms ? stock.filter(id => cat.CATALOG.gear[id]?.slot === category) : stock).map(id => ({ id, count: cat.ownedCount(save, id) }));
  const index = Math.max(0, Math.min(rows.length - 1, row));
  // Keep the chosen row in view when the list scrolls (keys, pad).
  useEffect(() => { listRef.current?.querySelector(".g5-shop-row.is-on")?.scrollIntoView({ block: "nearest" }); }, [index, tab, cat0]);
  const selected = rows[index]?.id ?? null;
  const info = selected ? cat.itemInfo(selected) : null;
  // The shelf always shows the goods themselves; the armourer's slots are tabs above the list.
  const carousel: string[] = rows.map(r => cat.itemInfo(r.id)?.icon ?? r.id);
  const center = index;
  const centerLabel = info?.name ?? "";
  const showCategories = tab === "buy" && arms && categories.length > 1;

  const priceOf = (id: string) => tab === "sell" ? cat.itemInfo(id)?.sell ?? 0 : cat.itemInfo(id)?.price ?? 0;
  const blocked = (id: string): string | null => {
    const i = cat.itemInfo(id);
    if (!i) return "Unavailable";
    if (tab === "sell") return null;
    if ((i.price ?? 0) > save.gold) return "Not enough gold";
    if (i.consumable && (save.bag[id] ?? 0) >= i.consumable.carry) return "Bag full";
    return null;
  };
  const shiftTab = () => { setTab(t => t === "buy" ? "sell" : "buy"); setRow(0); sound("move"); };
  const moveRow = (delta: number) => {
    if (!rows.length) return;
    setRow((index + delta + rows.length) % rows.length);
    sound("move");
  };
  const moveCategory = (delta: number) => {
    if (tab === "buy" && arms) {
      if (categories.length < 2) return;
      setCategory((cat0 + delta + categories.length) % categories.length);
      setRow(0);
      sound("move");
    } else moveRow(delta);
  };
  const choose = () => {
    if (!selected) { sound("deny"); return; }
    const why = blocked(selected);
    if (why) { sound("deny"); return; }
    sound("ok");
    setAsk({ kind: tab, item: selected });
  };
  useMenu(command => {
    if (command === "up") moveRow(-1);
    else if (command === "down") moveRow(1);
    else if (command === "left") moveCategory(-1);
    else if (command === "right") moveCategory(1);
    else if (command === "prev" || command === "next") shiftTab();
    else if (command === "ok") choose();
    else if (command === "back" || command === "start") { sound("back"); onLeave(); }
  }, ask === null);

  const confirmBuy = (item: string) => {
    send({ type: "buy", shop: shopId, item });
    setAsk(cat.CATALOG.gear[item] ? { kind: "equip", item } : null);
  };
  if (!shop) return null;
  const name = cat.itemInfo(ask?.item ?? "")?.name ?? "";
  return <div className="g5-modal-layer g5-shop-layer">
    <div className={`g5-shop${arms ? " is-arms" : " is-items"}`} role="dialog" aria-label={shop.name}>
      <header className="g5-shop-head">
        <div className="g5-shop-sign g5-dark"><span className="g5-shop-name">{shop.name}</span></div>
        <div className="g5-tabs g5-shop-tabs" role="tablist">
          {(["buy", "sell"] as const).map(t => <button key={t} type="button" role="tab" tabIndex={-1} aria-selected={t === tab}
            className={`g5-tab${t === tab ? " is-on" : ""}`} onClick={() => { if (t !== tab) shiftTab(); focusStage(); }}>{t === "buy" ? "Buy" : "Sell"}</button>)}
        </div>
        <GoldPlate gold={save.gold} />
        <button type="button" tabIndex={-1} className="g5-close has-label g5-shop-leave" onClick={() => { sound("back"); onLeave(); focusStage(); }}>Leave</button>
      </header>
      <div className="g5-carousel" aria-hidden="true">
        {carousel.length > 1 && <button type="button" tabIndex={-1} className="g5-carousel-step is-left" aria-label="Previous" onClick={() => { moveRow(-1); focusStage(); }} />}
        <div className="g5-carousel-track">
          {[-2, -1, 0, 1, 2].map(offset => {
            if (carousel.length === 0) return null;
            if (Math.abs(offset) > 0 && carousel.length < 2) return null;
            if (Math.abs(offset) === 2 && carousel.length < 5) return null;
            const i = ((center + offset) % carousel.length + carousel.length) % carousel.length;
            return <span key={offset} className={`g5-carousel-item is-${offset === 0 ? "center" : Math.abs(offset) === 1 ? "near" : "far"}`}
              onClick={() => { if (offset) moveRow(offset); focusStage(); }}>
              <Icon id={carousel[i]} scale={offset === 0 ? 3 : Math.abs(offset) === 1 ? 2 : 1} />
            </span>;
          })}
          {carousel.length === 0 && <span className="g5-carousel-empty">{tab === "sell" ? "Nothing to sell" : "Sold out"}</span>}
        </div>
        {carousel.length > 1 && <button type="button" tabIndex={-1} className="g5-carousel-step is-right" aria-label="Next" onClick={() => { moveRow(1); focusStage(); }} />}
        <div className="g5-carousel-label">{centerLabel}</div>
      </div>
      {showCategories && <div className="g5-tabs g5-shop-cats" role="tablist" aria-label="Gear slot">
        {categories.map((slot, i) => <button key={slot} type="button" role="tab" tabIndex={-1} aria-selected={slot === category}
          className={`g5-tab g5-shop-cat${slot === category ? " is-on" : ""}`}
          onClick={() => { if (slot !== category) { setCategory(i); setRow(0); sound("move"); } focusStage(); }}>
          <Icon id={SLOT_ICONS[slot]} small />{cat.SLOT_NAMES[slot]}
        </button>)}
      </div>}
      <div className="g5-paper g5-shop-panel">
        <ul className="g5-shop-list" ref={listRef} role="listbox" aria-label={tab === "buy" ? "For sale" : "Your items"}>
          {rows.map((r, i) => {
            const it = cat.itemInfo(r.id);
            if (!it) return null;
            const why = blocked(r.id);
            const equipped = it.gear && cat.isEquipped(save, r.id);
            return <li key={`${r.id}-${i}`} role="option" aria-selected={i === index}
              className={`g5-shop-row${i === index ? " is-on" : ""}${why ? " is-blocked" : ""}`}
              onPointerEnter={event => { if (event.pointerType === "mouse") setRow(i); }}
              onClick={() => { if (i === index) choose(); else { setRow(i); sound("move"); } focusStage(); }}>
              {i === index && <Pointer />}
              <Icon id={it.icon} />
              <span className="g5-shop-item">{it.name}{equipped && <em className="g5-tag">E</em>}</span>
              <span className="g5-shop-owned">{it.consumable ? `${cat.ownedCount(save, r.id)}/${it.consumable.carry}` : tab === "sell" ? `×${r.count}` : r.count ? `×${r.count}` : ""}</span>
              <span className={`g5-shop-price${why === "Not enough gold" ? " is-short" : ""}`}>{fmt(priceOf(r.id))}<Icon id="icon.gold" small /></span>
            </li>;
          })}
          {rows.length === 0 && <li className="g5-shop-row is-empty">{tab === "sell" ? "You have nothing the shop will buy." : "Nothing in stock right now."}</li>}
        </ul>
        <div className="g5-shop-detail">
          {info ? <>
            <div className="g5-detail-head"><Icon id={info.icon} scale={2} /><div>
              <div className="g5-detail-name">{info.name}</div>
              <div className="g5-detail-kind">{info.gear ? `${cat.SLOT_NAMES[info.gear.slot]} · ${cat.modsText(info.gear.mods)}` : info.consumable ? cat.describeEffect(info.consumable) : "Key item"}</div>
            </div></div>
            {info.gear ? <StatPreview cat={cat} save={save} item={info.id} /> : <p className="g5-detail-desc">{info.desc}</p>}
            {info.gear && <p className="g5-detail-desc is-small">{info.desc}</p>}
            {tab === "buy" && blocked(info.id) && <p className="g5-detail-warn">{blocked(info.id)}</p>}
          </> : <p className="g5-detail-desc">{tab === "sell" ? "Unequipped gear and potions can be sold for a quarter of their price." : ""}</p>}
        </div>
      </div>
      <Hints items={[
        ["ok", tab === "buy" ? "Buy" : "Sell"],
        ...(showCategories ? [["move", "Slot"] as ["move", string]] : []),
        ...(device === "touch" ? [] : [["prev", tab === "buy" ? "Sell tab" : "Buy tab"] as ["prev", string]]),
        ["back", "Leave"],
      ]} />
    </div>
    {ask?.kind === "buy" && <Confirm message={`Buy ${name}?`} detail={<>{fmt(cat.itemInfo(ask.item)?.price ?? 0)} gold · you have {fmt(save.gold)}</>}
      onYes={() => confirmBuy(ask.item)} onNo={() => setAsk(null)} />}
    {ask?.kind === "sell" && <Confirm message={`Sell ${name}?`} detail={<>For {fmt(cat.itemInfo(ask.item)?.sell ?? 0)} gold</>}
      onYes={() => { send({ type: "sell", item: ask.item }); setAsk(null); }} onNo={() => setAsk(null)} />}
    {ask?.kind === "equip" && <Confirm message={`Equip ${name} now?`} detail={<StatPreview cat={cat} save={save} item={ask.item} compact />}
      yes="Equip" no="Later" onYes={() => { send({ type: "equip", item: ask.item }); setAsk(null); }} onNo={() => setAsk(null)} />}
  </div>;
}
