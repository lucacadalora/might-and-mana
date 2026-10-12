"use client";

import { useState } from "react";
import type { GameCommand, HudSnapshot, SaveState, Slot, SpellId } from "@/lib/game-05/contract";
import type * as CatalogModule from "./catalog";
import { StatPreview } from "./shop";
import { Bar, HeroDoll, Hints, Icon, Pointer, Portrait, fmt, useMenu, useUi } from "./ui";

type Cat = typeof CatalogModule;
type Send = (command: GameCommand) => void;
const SLOT_ICONS: Record<Slot, string> = { head: "slot.head", body: "slot.body", boots: "slot.boots", weapon: "slot.weapon", charm: "slot.charm" };
/** Slot grid around the doll: [row, col] in a 3x3 layout with the doll in the middle column. */
const SLOT_GRID: Record<Slot, [number, number]> = { head: [0, 0], weapon: [0, 2], body: [1, 0], charm: [1, 2], boots: [2, 0] };
const SLOT_ORDER: Slot[] = ["head", "weapon", "body", "charm", "boots"];

export function Status({ cat, save, snapshot, send, onClose }: { cat: Cat; save: SaveState; snapshot: HudSnapshot; send: Send; onClose: () => void }) {
  const { sound, focusStage } = useUi();
  const [tab, setTab] = useState<"gear" | "skills">("gear");
  const [slot, setSlot] = useState<Slot>("weapon");
  const [focus, setFocus] = useState<"slots" | "list">("slots");
  const [row, setRow] = useState(0);
  const [spellRow, setSpellRow] = useState(0);
  const stats = cat.heroStats(save);
  const base = cat.heroStats({ level: save.level, equipped: { head: null, body: null, boots: null, weapon: null, charm: null } });
  // Gear for the slot, plus "take it off" for anything but the weapon.
  const REMOVE = "__remove";
  const owned = cat.gearForSlot(save, slot);
  const list = slot !== "weapon" && save.equipped[slot] ? [...owned, REMOVE] : owned;
  const rowIndex = Math.max(0, Math.min(list.length - 1, row));
  const spells = Object.values(cat.CATALOG.spells);
  const next = cat.xpToNext(save.level);

  const moveSlot = (dr: number, dc: number) => {
    const [r, c] = SLOT_GRID[slot];
    let best: Slot | null = null, bestScore = Infinity;
    for (const s of SLOT_ORDER) {
      if (s === slot) continue;
      const [sr, sc] = SLOT_GRID[s];
      const along = dr ? (sr - r) * dr : (sc - c) * dc;
      if (along <= 0) continue;
      const score = along * 10 + Math.abs(dr ? sc - c : sr - r);
      if (score < bestScore) { bestScore = score; best = s; }
    }
    if (best) { setSlot(best); setRow(0); sound("move"); }
  };
  const equip = (id: string) => {
    if (id === REMOVE) { send({ type: "unequip", slot }); sound("ok"); setRow(0); return; }
    if (cat.isEquipped(save, id)) { sound("deny"); return; }
    send({ type: "equip", item: id });
    sound("ok");
  };
  const toggleTab = () => { setTab(t => t === "gear" ? "skills" : "gear"); setFocus("slots"); sound("move"); };
  useMenu(command => {
    if (command === "prev" || command === "next") { toggleTab(); return; }
    if (command === "status" || command === "start") { sound("back"); onClose(); return; }
    if (tab === "skills") {
      if (command === "up" || command === "down") { setSpellRow(i => (i + (command === "down" ? 1 : -1) + spells.length) % spells.length); sound("move"); }
      else if (command === "left" || command === "right") toggleTab();
      else if (command === "ok") {
        const sp = spells[spellRow];
        if (sp && save.spells.includes(sp.id)) { send({ type: "selectSpell", spell: sp.id }); sound("ok"); } else sound("deny");
      } else if (command === "back") { sound("back"); onClose(); }
      return;
    }
    if (focus === "slots") {
      if (command === "up") moveSlot(-1, 0);
      else if (command === "down") moveSlot(1, 0);
      else if (command === "left") moveSlot(0, -1);
      else if (command === "right") moveSlot(0, 1);
      else if (command === "ok") { if (list.length) { setFocus("list"); setRow(0); sound("ok"); } else sound("deny"); }
      else if (command === "back") { sound("back"); onClose(); }
    } else {
      if (command === "up" || command === "down") { setRow((rowIndex + (command === "down" ? 1 : -1) + list.length) % Math.max(1, list.length)); sound("move"); }
      else if (command === "ok") { if (list[rowIndex]) equip(list[rowIndex]); }
      else if (command === "back" || command === "left") { setFocus("slots"); sound("back"); }
    }
  });
  const selectedItem = focus === "list" ? list[rowIndex] : save.equipped[slot];
  return <div className="g5-modal-layer g5-status-layer">
    <div className="g5-status" role="dialog" aria-label="Status and gear">
      <header className="g5-status-head">
        <div className="g5-tabs" role="tablist">
          {(["gear", "skills"] as const).map(t => <button key={t} type="button" tabIndex={-1} role="tab" aria-selected={t === tab}
            className={`g5-tab${t === tab ? " is-on" : ""}`} onClick={() => { if (t !== tab) toggleTab(); focusStage(); }}>{t === "gear" ? "Gear" : "Skills"}</button>)}
        </div>
        <button type="button" tabIndex={-1} className="g5-close" onClick={() => { sound("back"); onClose(); focusStage(); }} aria-label="Close" />
      </header>
      <div className="g5-status-body">
        <section className="g5-paper g5-status-card">
          <div className="g5-status-hero">
            <Portrait id="portrait.hero" name={save.heroName} />
            <div>
              <div className="g5-status-name">{save.heroName}</div>
              <div className="g5-status-level">Level <b>{save.level}</b></div>
            </div>
          </div>
          <div className="g5-status-xp">
            <div className="g5-status-row"><span>EXP</span><span>{fmt(save.xp)} / {fmt(next)}</span></div>
            <Bar value={save.xp} max={next || 1} kind="xp-big" />
            <div className="g5-status-note">{next ? `${fmt(Math.max(0, next - save.xp))} to level ${save.level + 1}` : "Highest level"}</div>
          </div>
          <dl className="g5-status-stats">
            <div><dt>HP</dt><dd>{snapshot.hp.value}<small>/{stats.hp}</small></dd></div>
            <div><dt>MP</dt><dd>{snapshot.mp.value}<small>/{stats.mp}</small></dd></div>
            {(["atk", "def", "spd"] as const).map(k => {
              const bonus = stats[k] - base[k];
              return <div key={k}><dt>{cat.STAT_NAMES[k]}</dt><dd>{stats[k]}{bonus !== 0 && <em className={bonus > 0 ? "is-up" : "is-down"}>{bonus > 0 ? `+${bonus}` : `−${-bonus}`}</em>}</dd></div>;
            })}
            <div><dt>Gold</dt><dd>{fmt(save.gold)}</dd></div>
          </dl>
        </section>
        {tab === "gear" ? <>
          <section className="g5-doll-stage">
            <div className="g5-doll-grid">
              {SLOT_ORDER.map(s => {
                const id = save.equipped[s];
                const info = id ? cat.itemInfo(id) : null;
                const [r, c] = SLOT_GRID[s];
                return <button key={s} type="button" tabIndex={-1} style={{ gridRow: r + 1, gridColumn: c + 1 }}
                  className={`g5-gear-slot${s === slot ? " is-on" : ""}${focus === "list" && s === slot ? " is-open" : ""}`}
                  onClick={() => { if (s === slot && list.length) setFocus(focus === "list" ? "slots" : "list"); else { setSlot(s); setRow(0); setFocus("slots"); } sound("move"); focusStage(); }}>
                  <span className="g5-slot-frame">{info ? <Icon id={info.icon} /> : <Icon id={SLOT_ICONS[s]} dim />}</span>
                  <span className="g5-gear-slot-label">{cat.SLOT_NAMES[s]}</span>
                </button>;
              })}
              <div className="g5-doll-center" style={{ gridRow: "1 / span 3", gridColumn: 2 }}>
                <span className="g5-doll-pedestal" aria-hidden="true" />
                <HeroDoll scale={2} />
              </div>
            </div>
          </section>
          <section className="g5-paper g5-gear-list">
            <h3 className="g5-panel-title">{cat.SLOT_NAMES[slot]}</h3>
            <ul role="listbox" aria-label={`${cat.SLOT_NAMES[slot]} gear`}>
              {list.map((id, i) => {
                if (id === REMOVE) {
                  const on = focus === "list" && i === rowIndex;
                  return <li key={id} role="option" aria-selected={on} className={`g5-gear-row is-remove${on ? " is-on" : ""}`}
                    onPointerEnter={event => { if (event.pointerType === "mouse") { setFocus("list"); setRow(i); } }}
                    onClick={() => { setFocus("list"); setRow(i); equip(id); focusStage(); }}>
                    {on && <Pointer />}
                    <Icon id={SLOT_ICONS[slot]} dim />
                    <span className="g5-gear-name">Take off</span>
                    <span className="g5-gear-mods">Leave the slot empty</span>
                  </li>;
                }
                const info = cat.itemInfo(id);
                if (!info) return null;
                const on = focus === "list" && i === rowIndex;
                const equipped = cat.isEquipped(save, id);
                return <li key={id} role="option" aria-selected={on} className={`g5-gear-row${on ? " is-on" : ""}${equipped ? " is-equipped" : ""}`}
                  onPointerEnter={event => { if (event.pointerType === "mouse") { setFocus("list"); setRow(i); } }}
                  onClick={() => { setFocus("list"); setRow(i); equip(id); focusStage(); }}>
                  {on && <Pointer />}
                  <Icon id={info.icon} />
                  <span className="g5-gear-name">{info.name}{equipped && <em className="g5-tag">E</em>}</span>
                  <span className="g5-gear-mods">{info.gear ? cat.modsText(info.gear.mods) : ""}</span>
                </li>;
              })}
              {list.length === 0 && <li className="g5-gear-row is-empty">Nothing for this slot yet.</li>}
            </ul>
            {selectedItem && selectedItem !== REMOVE && cat.itemInfo(selectedItem) && <div className="g5-gear-detail">
              {focus === "list" && !cat.isEquipped(save, selectedItem) ? <StatPreview cat={cat} save={save} item={selectedItem} compact />
                : <p className="g5-detail-desc is-small">{cat.itemInfo(selectedItem)!.desc}</p>}
            </div>}
          </section>
        </> : <section className="g5-paper g5-skills">
          <h3 className="g5-panel-title">Sword techniques</h3>
          <ul className="g5-skill-list">
            {cat.CATALOG.skills.map(skill => {
              const learned = save.level >= skill.level;
              return <li key={skill.id} className={`g5-skill${learned ? " is-learned" : ""}`}>
                <span className="g5-skill-level">Lv {skill.level}</span>
                <span className="g5-skill-name">{skill.name}</span>
                <span className="g5-skill-hint">{learned ? skill.hint : "Not yet learned"}</span>
              </li>;
            })}
          </ul>
          <h3 className="g5-panel-title">Magic</h3>
          <ul className="g5-spell-list" role="listbox" aria-label="Spells">
            {spells.map((sp, i) => {
              const known = save.spells.includes(sp.id as SpellId);
              const selected = save.spell === sp.id;
              return <li key={sp.id} role="option" aria-selected={i === spellRow}
                className={`g5-spell-row${i === spellRow ? " is-on" : ""}${known ? " is-known" : ""}${selected ? " is-selected" : ""}`}
                onPointerEnter={event => { if (event.pointerType === "mouse") setSpellRow(i); }}
                onClick={() => { setSpellRow(i); if (known) { send({ type: "selectSpell", spell: sp.id }); sound("ok"); } else sound("deny"); focusStage(); }}>
                {i === spellRow && <Pointer />}
                <Icon id={sp.icon || `icon.spell.${sp.id}`} dim={!known} />
                <span className="g5-spell-row-name">{known ? sp.name : "? ? ?"}{selected && <em className="g5-tag">Set</em>}</span>
                <span className="g5-spell-row-cost">{known ? `${sp.mp} MP` : sp.level ? `Lv ${sp.level}` : "Quest"}</span>
                <span className="g5-spell-row-desc">{known ? sp.desc : sp.level ? `Learned at level ${sp.level}.` : "Someone in the valley can teach this."}</span>
              </li>;
            })}
          </ul>
        </section>}
      </div>
      <Hints items={tab === "gear"
        ? (focus === "slots" ? [["move", "Slot"], ["ok", "Choose"], ["prev", "Skills"], ["back", "Close"]] : [["move", "Item"], ["ok", "Equip"], ["back", "Slots"]])
        : [["move", "Spell"], ["ok", "Set spell"], ["prev", "Gear"], ["back", "Close"]]} />
    </div>
  </div>;
}
