"use client";

import { useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import type { TouchControl } from "@/lib/game-05/input/game05-input";
import type { SetLive } from "./hud";
import { Icon } from "./ui";

export interface TouchBridge {
  setMove(pointerId: number, x: number, y: number): void;
  setButton(pointerId: number, control: TouchControl, down: boolean): void;
  release(pointerId: number, cancel?: boolean): void;
  focusStage(): void;
}

const STICK_RADIUS = 38;

export function TouchButton({ control, label, icon, size, bridge, className = "", children }: {
  control: TouchControl; label: string; icon: string; size: 40 | 30 | 22; bridge: TouchBridge; className?: string; children?: React.ReactNode;
}) {
  const pointer = useRef<number | null>(null);
  const [down, setDown] = useState(false);
  const end = (event: ReactPointerEvent<HTMLButtonElement>, cancel: boolean) => {
    if (pointer.current !== event.pointerId) return;
    bridge.setButton(event.pointerId, control, false);
    bridge.release(event.pointerId, cancel);
    pointer.current = null;
    setDown(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  return <button type="button" tabIndex={-1} aria-label={label} data-control={control}
    className={`g5-tbtn g5-tbtn-${size} g5-tbtn-${control}${down ? " is-down" : ""} ${className}`}
    onPointerDown={event => {
      event.preventDefault();
      event.stopPropagation();
      if (pointer.current !== null) return;
      pointer.current = event.pointerId;
      event.currentTarget.setPointerCapture(event.pointerId);
      bridge.focusStage();
      bridge.setButton(event.pointerId, control, true);
      setDown(true);
    }}
    onPointerUp={event => end(event, false)} onPointerCancel={event => end(event, true)}
    onLostPointerCapture={event => end(event, true)} onContextMenu={event => event.preventDefault()}>
    {children}
    <span className="g5-tbtn-icon"><Icon id={icon} box={/^(icon\.)?ui\./.test(icon) ? 16 : 24} cssPx={size === 22 ? 1 : 2} /></span>
  </button>;
}

export function TouchControls({ bridge, setLive, spellIcon, spellReady, hasSpell }: {
  bridge: TouchBridge; setLive: SetLive; spellIcon: string | null; spellReady: boolean; hasSpell: boolean;
}) {
  const zoneRef = useRef<HTMLDivElement>(null);
  const pointer = useRef<number | null>(null);
  const [stick, setStick] = useState<{ bx: number; by: number; kx: number; ky: number } | null>(null);
  const base = useRef({ x: 0, y: 0 });
  const update = (event: ReactPointerEvent<HTMLDivElement>) => {
    const zone = zoneRef.current;
    if (!zone || pointer.current !== event.pointerId) return;
    const rect = zone.getBoundingClientRect();
    const px = event.clientX - rect.left, py = event.clientY - rect.top;
    let dx = px - base.current.x, dy = py - base.current.y;
    const len = Math.hypot(dx, dy);
    if (len > STICK_RADIUS) {
      // The base trails the thumb so a long drag never loses the stick.
      base.current.x = px - dx / len * STICK_RADIUS;
      base.current.y = py - dy / len * STICK_RADIUS;
      dx = dx / len * STICK_RADIUS; dy = dy / len * STICK_RADIUS;
    }
    setStick({ bx: base.current.x, by: base.current.y, kx: dx, ky: dy });
    const dead = 6;
    const mag = Math.hypot(dx, dy);
    if (mag < dead) bridge.setMove(event.pointerId, 0, 0);
    else bridge.setMove(event.pointerId, dx / STICK_RADIUS, dy / STICK_RADIUS);
  };
  const end = (event: ReactPointerEvent<HTMLDivElement>, cancel: boolean) => {
    if (pointer.current !== event.pointerId) return;
    bridge.release(event.pointerId, cancel);
    pointer.current = null;
    setStick(null);
  };
  return <div className="g5-touch" aria-label="Touch controls">
    <div className="g5-stick-zone" ref={zoneRef} data-game-input-ignore="true"
      onPointerDown={event => {
        if (pointer.current !== null) return;
        event.preventDefault();
        const rect = event.currentTarget.getBoundingClientRect();
        pointer.current = event.pointerId;
        event.currentTarget.setPointerCapture(event.pointerId);
        bridge.focusStage();
        base.current = {
          x: Math.max(STICK_RADIUS + 8, Math.min(rect.width - STICK_RADIUS - 8, event.clientX - rect.left)),
          y: Math.max(STICK_RADIUS + 8, Math.min(rect.height - STICK_RADIUS - 8, event.clientY - rect.top)),
        };
        update(event);
      }}
      onPointerMove={update} onPointerUp={event => end(event, false)} onPointerCancel={event => end(event, true)}
      onLostPointerCapture={event => end(event, true)}>
      <span className={`g5-stick${stick ? " is-active" : ""}`} aria-hidden="true"
        style={stick ? { transform: `translate(${stick.bx}px, ${stick.by}px)` } : undefined}>
        <i className="g5-stick-base" />
        <i className="g5-stick-knob" style={stick ? { transform: `translate(${stick.kx}px, ${stick.ky}px)` } : undefined} />
      </span>
    </div>
    <div className="g5-touch-cluster">
      <TouchButton bridge={bridge} control="attack" label="Attack, talk, open" icon="ui.sword" size={40}>
        <span className="g5-charge-ring" ref={node => setLive("touchCharge", node)} />
      </TouchButton>
      <TouchButton bridge={bridge} control="magic" label="Magic" icon={spellIcon ?? "ui.magic"} size={30}
        className={`${hasSpell ? "" : "is-locked"}${hasSpell && !spellReady ? " is-dry" : ""}`} />
      <TouchButton bridge={bridge} control="dodge" label="Dodge" icon="ui.dodge" size={30} />
      <TouchButton bridge={bridge} control="item" label="Items" icon="ui.bag" size={22} />
    </div>
  </div>;
}

/** Map and pause, drawn inside the HUD's right column so nothing else has to dodge them. */
export function TouchBar({ bridge }: { bridge: TouchBridge }) {
  return <div className="g5-touchbar">
    <TouchButton bridge={bridge} control="map" label="Map" icon="ui.map" size={22} />
    <TouchButton bridge={bridge} control="pause" label="Pause" icon="ui.pause" size={22} />
  </div>;
}
