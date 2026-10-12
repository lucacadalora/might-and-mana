import type { Dir4 } from "../contract";
import { GEAR } from "../content/items";
import { clamp, damage, facingFrom, type Sim } from "./sim";
import type { Actor } from "./types";

const DIRV: Record<Dir4, [number, number]> = { down: [0, 1], up: [0, -1], left: [-1, 0], right: [1, 0] };
const AGGRO = 150;
const LEASH = 360;

/**
 * Apply a hero hit to a monster: miss/crit rolls, shield blocks, damage, knockback, flash,
 * hit-stop, burn, death. `dir` is the attack direction (null = radial from the hero).
 */
export function hurtMonster(sim: Sim, a: Actor, power: number, kind: "slash" | "magic", knock: number, dir: [number, number] | null, atkOverride?: number) {
  const h = sim.hero;
  const st = sim.stats();
  const atk = atkOverride ?? st.atk;
  const def = a.mdef!;
  if (def.behaviour === "dummy") {
    a.flash = 0.1; a.anim = "hurt"; a.animTime = 0; a.state = "hurt"; a.t = 0;
    const dmg = damage(power, atk, a.st.def, sim.rng);
    sim.emit({ t: "hit", x: a.x, y: a.y - 34, amount: dmg, crit: false, target: "monster", kind });
    sim.sfx("hit", a.x, a.y);
    sim.emit({ t: "hitstop", ms: 45 });
    return;
  }
  // Shield guards block frontal sword hits unless they are recovering.
  if (def.behaviour === "shieldGuard" && kind === "slash" && !["recover", "stun", "hurt"].includes(a.state)) {
    const [fx, fy] = DIRV[a.facing];
    const dx = h.x - a.x, dy = h.y - a.y, d = Math.hypot(dx, dy) || 1;
    if ((dx * fx + dy * fy) / d > 0.45) {
      sim.emit({ t: "miss", x: a.x, y: a.y - 40, target: "monster" });
      sim.sfx("guard.block", a.x, a.y);
      sim.emit({ t: "hitstop", ms: 60 });
      h.kx = dx / d * 140; h.ky = dy / d * 140;
      a.ai.blocks = (a.ai.blocks ?? 0) + 1;
      return;
    }
  }
  if (kind === "slash") {
    const miss = clamp(0.04 + 0.1 * (a.st.spd - st.spd) / Math.max(1, st.spd), 0, 0.45);
    if (sim.rng.chance(miss)) { sim.emit({ t: "miss", x: a.x, y: a.y - 36 - a.z, target: "monster" }); sim.sfx("miss", a.x, a.y); return; }
  }
  const critChance = kind === "slash" ? clamp(0.05 + 0.1 * (st.spd - a.st.spd) / Math.max(1, a.st.spd), 0.02, 0.35) : 0;
  const crit = sim.rng.chance(critChance);
  let dmg = damage(power, atk, a.st.def, sim.rng) * (crit ? 2 : 1);
  if (a.state === "stun") dmg = Math.round(dmg * 1.5);
  a.hp -= dmg;
  if (crit) sim.s.stats.crits++;
  sim.emit({ t: "hit", x: a.x, y: a.y - 36 - a.z, amount: dmg, crit, target: "monster", kind });
  sim.sfx(crit ? "hitCrit" : "hit", a.x, a.y);
  sim.emit({ t: "hitstop", ms: crit ? 85 : 50 });
  if (crit) sim.emit({ t: "shake", strength: 2, ms: 120 });
  a.flash = 0.12;
  a.aggro = true;
  // Burn from the ember blade.
  const weapon = sim.s.equipped.weapon ? GEAR[sim.s.equipped.weapon] : null;
  if (kind === "slash" && weapon?.special === "burn" && sim.rng.chance(0.25)) { a.burnT = 3; a.burnTick = 0.5; }
  // Knockback scaled by weight; bosses barely move.
  const w = def.weight;
  let ux: number, uy: number;
  if (dir) { [ux, uy] = dir; } else { const dx = a.x - h.x, dy = a.y - h.y, d = Math.hypot(dx, dy) || 1; ux = dx / d; uy = dy / d; }
  a.kx = ux * knock * w; a.ky = uy * knock * w;
  if (a.hp <= 0) { kill(sim, a); return; }
  // Poise: enough hits in a short window staggers.
  a.poise += 1;
  a.ai.poiseT = 1.2;
  const poiseMax = def.boss ? 7 : def.behaviour === "shieldGuard" ? 3 : def.behaviour === "charger" ? 3 : 1;
  if (a.poise >= poiseMax && a.state !== "attack" && a.state !== "stun") {
    a.poise = 0;
    if (!(def.boss && a.state === "windup")) { a.state = "hurt"; a.t = 0; a.anim = "hurt"; a.animTime = 0; }
  }
}

function kill(sim: Sim, a: Actor) {
  a.dead = true; a.removeT = 0.6; a.anim = "dead"; a.animTime = 0; a.state = "dead"; a.hp = 0;
  sim.onMonsterKilled(a);
}

function toward(a: Actor, x: number, y: number) {
  const dx = x - a.x, dy = y - a.y, d = Math.hypot(dx, dy) || 1;
  return { dx: dx / d, dy: dy / d, d };
}

function walk(sim: Sim, a: Actor, ux: number, uy: number, speed: number, dt: number, fly = false) {
  const slow = a.slowT > 0 ? 0.5 : 1;
  const r = sim.col.move(a, a.radius, ux * speed * slow * dt, uy * speed * slow * dt, fly);
  if (Math.abs(ux) + Math.abs(uy) > 0.05) a.facing = facingFrom(ux, uy, a.facing);
  return r;
}

function setState(a: Actor, state: Actor["state"], anim: Actor["anim"]) {
  a.state = state; a.t = 0;
  if (a.anim !== anim) { a.anim = anim; a.animTime = 0; }
}

/** Every move power of a monster is scaled by its species power. */
const P = (a: Actor) => a.mdef?.power ?? 1;

function contact(sim: Sim, a: Actor, power: number) {
  const h = sim.hero;
  if (a.contactCd > 0) return;
  if (Math.hypot(h.x - a.x, h.y - a.y) > a.radius + 9) return;
  if (sim.hurtHero(power * P(a), a.st.atk, a.st.spd, a.x, a.y, "contact")) a.contactCd = 0.8;
}

/** Hit the hero with a melee arc in front of the monster. */
function strike(sim: Sim, a: Actor, reach: number, power: number, arc = 0.5) {
  const h = sim.hero;
  const [fx, fy] = DIRV[a.facing];
  const dx = h.x - a.x, dy = h.y - a.y, d = Math.hypot(dx, dy) || 1;
  if (d > reach + 8) return false;
  if ((dx * fx + dy * fy) / d < arc && d > 12) return false;
  return sim.hurtHero(power * P(a), a.st.atk, a.st.spd, a.x, a.y, "slash");
}

export function updateMonster(sim: Sim, a: Actor, dt: number) {
  const def = a.mdef!;
  const h = sim.hero;
  const heroDead = h.state === "dead";
  const { dx, dy, d } = toward(a, h.x, h.y);
  a.ai.poiseT = (a.ai.poiseT ?? 0) - dt;
  if (a.ai.poiseT <= 0) a.poise = 0;
  // Burn damage over time.
  if (a.burnT > 0) {
    a.burnT -= dt; a.burnTick -= dt;
    if (a.burnTick <= 0) {
      a.burnTick = 0.5;
      const dmg = Math.max(1, Math.round(sim.stats().atk * 0.15));
      a.hp -= dmg; a.flash = 0.06;
      sim.emit({ t: "hit", x: a.x, y: a.y - 36, amount: dmg, crit: false, target: "monster", kind: "magic" });
      if (a.hp <= 0) { kill(sim, a); return; }
    }
  }
  if (a.state === "hurt") {
    if (def.behaviour !== "swooper") a.z = 0;
    if (a.t > 0.28) setState(a, "chase", "walk");
    return;
  }
  // Aggro and leash.
  const seen = !heroDead && d < AGGRO && sim.col.lineClear(a.x, a.y - 6, h.x, h.y - 6, Math.max(a.level, sim.hero.level));
  if (!a.aggro && seen && def.behaviour !== "dummy" && !(a.ai.calm > 0)) {
    a.aggro = true;
    if (def.behaviour === "packWolf") sim.sfx("wolf.howl", a.x, a.y);
  }
  // Walkers that cannot reach the hero (deep water, a cliff) give up after a few seconds.
  if (a.aggro && def.behaviour !== "swooper" && def.behaviour !== "boss") {
    const reach = d < 40 || sim.col.walkClear(a.x, a.y, h.x, h.y, a.level);
    a.ai.blocked = reach ? 0 : (a.ai.blocked ?? 0) + dt;
  }
  // The boss's arena is her leash: she never drops aggro while the hero is alive on her map.
  const leashed = !def.boss && (Math.hypot(a.x - a.homeX, a.y - a.homeY) > LEASH || d > AGGRO * 2.4 || (a.ai.blocked ?? 0) > 4);
  if (a.aggro && (heroDead || leashed)) {
    a.aggro = false; a.ai.blocked = 0; a.ai.calm = 3; a.z = def.behaviour === "swooper" ? a.z : 0; setState(a, "retreat", "walk");
  }
  if (def.boss && !a.aggro && !heroDead && d < AGGRO * 3) a.aggro = true;
  a.ai.calm = Math.max(0, (a.ai.calm ?? 0) - dt);
  if (a.state === "retreat") {
    const home = toward(a, a.homeX, a.homeY);
    if (home.d < 8 || a.t > 5) { setState(a, "idle", "idle"); if (!def.boss) a.hp = Math.min(a.maxHp, a.hp + a.maxHp * 0.5); }
    else walk(sim, a, home.dx, home.dy, a.speed * 1.2, dt, def.behaviour === "swooper");
    return;
  }
  if (!a.aggro) { idleWander(sim, a, dt); return; }

  switch (def.behaviour) {
    case "dummy": a.anim = a.t > 0.25 ? "idle" : "hurt"; a.hp = a.maxHp; return;
    case "hopper": return hopper(sim, a, dt, dx, dy, d);
    case "swooper": return swooper(sim, a, dt, dx, dy, d);
    case "charger": return charger(sim, a, dt, dx, dy, d);
    case "spore": return spore(sim, a, dt, dx, dy, d);
    case "packWolf": return packWolf(sim, a, dt, dx, dy, d);
    case "spitter": return spitter(sim, a, dt, dx, dy, d);
    case "shieldGuard": return shieldGuard(sim, a, dt, dx, dy, d);
    case "boss": return boss(sim, a, dt, dx, dy, d);
  }
}

function idleWander(sim: Sim, a: Actor, dt: number) {
  if (a.state === "idle" || a.state === "chase" || a.state === "recover" || a.state === "windup" || a.state === "attack") {
    if (a.state !== "idle") setState(a, "idle", "idle");
    if (a.t > (a.ai.wait ?? 1)) {
      const ang = sim.rng.range(0, Math.PI * 2), r = sim.rng.range(12, 56);
      a.gx = a.homeX + Math.cos(ang) * r; a.gy = a.homeY + Math.sin(ang) * r;
      setState(a, "wander", "walk");
    }
    if (a.mdef?.behaviour === "swooper") a.z = 14 + Math.sin(sim.time * 3 + a.id) * 3;
    return;
  }
  if (a.state === "wander") {
    const g = toward(a, a.gx, a.gy);
    if (g.d < 4 || a.t > 3) { setState(a, "idle", "idle"); a.ai.wait = sim.rng.range(1, 3.5); return; }
    walk(sim, a, g.dx, g.dy, a.speed * 0.45, dt, a.mdef?.behaviour === "swooper");
    if (a.mdef?.behaviour === "swooper") a.z = 14 + Math.sin(sim.time * 3 + a.id) * 3;
  }
}

// Mossling / thornling: hops toward the hero; a quicker lunge hop when close.
function hopper(sim: Sim, a: Actor, dt: number, dx: number, dy: number, d: number) {
  const def = a.mdef!;
  if (a.state === "windup") {
    a.anim = "windup";
    if (a.t > 0.32) { setState(a, "attack", "attack"); a.gx = dx; a.gy = dy; sim.sfx("slime.hop", a.x, a.y); }
    return;
  }
  if (a.state === "attack") {
    const k = a.t / 0.3;
    a.z = Math.sin(Math.min(1, k) * Math.PI) * 14;
    walk(sim, a, a.gx, a.gy, a.speed * 2.3, dt);
    contact(sim, a, 1.0);
    if (a.t > 0.3) { a.z = 0; setState(a, "recover", "idle"); }
    return;
  }
  if (a.state === "recover") { if (a.t > 0.55) setState(a, "chase", "walk"); return; }
  // Chase with hops.
  if (a.state !== "chase") setState(a, "chase", "walk");
  const cycle = 0.85, k = (a.t % cycle) / cycle;
  if (k < 0.45) { a.z = Math.sin(k / 0.45 * Math.PI) * 7; walk(sim, a, dx, dy, a.speed, dt); }
  else a.z = 0;
  if (def.contact > 0) contact(sim, a, def.contact);
  if (d < 44 && a.t > 0.6) setState(a, "windup", "windup");
}

// Duskbat: flutters erratically, hovers, then swoops at where the hero was.
function swooper(sim: Sim, a: Actor, dt: number, dx: number, dy: number, d: number) {
  a.z = 16 + Math.sin(sim.time * 7 + a.id) * 4;
  if (a.state === "windup") {
    a.anim = "windup";
    if (a.t > 0.35) { setState(a, "attack", "attack"); a.gx = dx; a.gy = dy; sim.sfx("bat.flap", a.x, a.y); }
    return;
  }
  if (a.state === "attack") {
    walk(sim, a, a.gx, a.gy, 230, dt, true);
    a.z = 6;
    contact(sim, a, 0.9);
    if (a.t > 0.36) setState(a, "retreat2", "walk");
    return;
  }
  if (a.state === "retreat2") {
    walk(sim, a, -dx, -dy, a.speed * 1.2, dt, true);
    if (a.t > 0.5) setState(a, "chase", "walk");
    return;
  }
  if (a.state !== "chase") setState(a, "chase", "walk");
  const orbit = Math.sin(sim.time * 2.3 + a.id * 1.7);
  const want = d > 80 ? 1 : d < 50 ? -0.6 : 0;
  walk(sim, a, dx * want - dy * orbit, dy * want + dx * orbit, a.speed, dt, true);
  if (d < 110 && a.t > 1.2 + (a.id % 3) * 0.4) setState(a, "windup", "windup");
}

// Bristleboar / Old Tusk: approaches, paws the ground, charges straight; stuns on walls.
function charger(sim: Sim, a: Actor, dt: number, dx: number, dy: number, d: number) {
  const def = a.mdef!;
  if (a.state === "windup") {
    a.anim = "windup";
    a.facing = facingFrom(dx, dy, a.facing);
    a.gx = dx; a.gy = dy;
    if (a.t > (def.elite ? 0.45 : 0.6)) { setState(a, "attack", "attack"); sim.sfx("boar.charge", a.x, a.y); }
    return;
  }
  if (a.state === "attack") {
    const r = walk(sim, a, a.gx, a.gy, def.elite ? 270 : 245, dt);
    if (a.contactCd <= 0 && Math.hypot(sim.hero.x - a.x, sim.hero.y - a.y) < a.radius + 11) {
      if (sim.hurtHero(1.4 * P(a), a.st.atk, a.st.spd, a.x, a.y, "contact")) a.contactCd = 1;
    }
    if (r.hitWall && a.t > 0.08) { setState(a, "stun", "hurt"); sim.emit({ t: "shake", strength: 2, ms: 150 }); sim.sfx("boss.slam", a.x, a.y); return; }
    if (a.t > 0.62) setState(a, "recover", "idle");
    return;
  }
  if (a.state === "stun") { a.anim = "hurt"; if (a.t > 1.1) setState(a, "chase", "walk"); return; }
  if (a.state === "recover") { if (a.t > 0.7) setState(a, "chase", "walk"); return; }
  if (a.state !== "chase") setState(a, "chase", "walk");
  if (d > 120) walk(sim, a, dx, dy, a.speed, dt);
  else if (d < 60) walk(sim, a, -dx, -dy, a.speed * 0.6, dt);
  else a.facing = facingFrom(dx, dy, a.facing);
  if (def.contact > 0) contact(sim, a, def.contact);
  if (d < 150 && a.t > 0.9) setState(a, "windup", "windup");
}

// Sporecap: shuffles closer, puffs a lingering spore cloud.
function spore(sim: Sim, a: Actor, dt: number, dx: number, dy: number, d: number) {
  if (a.state === "windup") {
    a.anim = "windup";
    if (a.t > 0.55) {
      setState(a, "attack", "attack");
      sim.sfx("spore.puff", a.x, a.y);
      const p = sim.addProjectile("spore", a.x + dx * 18, a.y - 6 + dy * 12, 0, 0, 30, 1.6, true, 0.55 * P(a), a.st.atk, a.st.spd, true);
      p.slow = 0;
    }
    return;
  }
  if (a.state === "attack") { if (a.t > 0.4) setState(a, "recover", "idle"); return; }
  if (a.state === "recover") { if (a.t > 1.2) setState(a, "chase", "walk"); return; }
  if (a.state !== "chase") setState(a, "chase", "walk");
  if (d > 56) walk(sim, a, dx, dy, a.speed, dt);
  contact(sim, a, a.mdef!.contact || 0.5);
  if (d < 76 && a.t > 0.8) setState(a, "windup", "windup");
}

// Greywolf: circles at a distance; at most two lunge at once.
function packWolf(sim: Sim, a: Actor, dt: number, dx: number, dy: number, d: number) {
  if (a.state === "windup") {
    a.anim = "windup"; a.facing = facingFrom(dx, dy, a.facing); a.gx = dx; a.gy = dy;
    if (a.t > 0.36) setState(a, "attack", "attack");
    return;
  }
  if (a.state === "attack") {
    walk(sim, a, a.gx, a.gy, 265, dt);
    if (a.contactCd <= 0 && Math.hypot(sim.hero.x - a.x, sim.hero.y - a.y) < a.radius + 10) {
      if (sim.hurtHero(1.0 * P(a), a.st.atk, a.st.spd, a.x, a.y, "contact")) a.contactCd = 0.8;
    }
    if (a.t > 0.26) setState(a, "retreat2", "walk");
    return;
  }
  if (a.state === "retreat2") {
    walk(sim, a, -dx, -dy, a.speed * 1.1, dt);
    if (a.t > 0.45) setState(a, "circle", "walk");
    return;
  }
  if (a.state !== "circle") setState(a, "circle", "walk");
  const side = a.id % 2 ? 1 : -1;
  const want = d > 90 ? 1 : d < 62 ? -1 : 0;
  walk(sim, a, dx * want - dy * side * 0.9, dy * want + dx * side * 0.9, a.speed, dt);
  a.facing = facingFrom(dx, dy, a.facing);
  const attackers = sim.actors.filter(o => !o.dead && o.mdef?.behaviour === "packWolf" && (o.state === "windup" || o.state === "attack")).length;
  if (d < 110 && a.t > 1.1 + (a.id % 4) * 0.35 && attackers < 2) setState(a, "windup", "windup");
}

// Webspinner: keeps its distance, skitters sideways, spits web; bites if cornered.
function spitter(sim: Sim, a: Actor, dt: number, dx: number, dy: number, d: number) {
  if (a.state === "windup") {
    a.anim = "windup"; a.facing = facingFrom(dx, dy, a.facing);
    if (a.t > (a.ai.bite ? 0.3 : 0.42)) {
      if (a.ai.bite) { setState(a, "attack", "attack"); strike(sim, a, 26, 0.9); a.ai.bite = 0; }
      else {
        setState(a, "attack", "attack");
        sim.sfx("web.spit", a.x, a.y);
        const p = sim.addProjectile("web", a.x + dx * 10, a.y - 10 + dy * 8, dx * 165, dy * 165, 6, 1.4, true, 0.6 * P(a), a.st.atk, a.st.spd, false);
        p.slow = 2;
      }
    }
    return;
  }
  if (a.state === "attack") { if (a.t > 0.3) setState(a, "circle", "walk"); return; }
  if (a.state !== "circle") setState(a, "circle", "walk");
  const side = Math.sin(sim.time * 1.7 + a.id) > 0 ? 1 : -1;
  const want = d > 150 ? 1 : d < 100 ? -1 : 0;
  walk(sim, a, dx * want - dy * side * 0.8, dy * want + dx * side * 0.8, a.speed, dt);
  a.facing = facingFrom(dx, dy, a.facing);
  if (d < 34 && a.t > 0.5) { a.ai.bite = 1; setState(a, "windup", "windup"); return; }
  if (d < 190 && a.t > 1.7) { a.ai.bite = 0; setState(a, "windup", "windup"); }
}

// Barrow Guard: slow advance, shield up; telegraphed overhead swing; open while recovering.
function shieldGuard(sim: Sim, a: Actor, dt: number, dx: number, dy: number, d: number) {
  if (a.state === "windup") {
    a.anim = "windup";
    if (a.t > 0.62) { setState(a, "attack", "attack"); sim.sfx("swing2", a.x, a.y); }
    return;
  }
  if (a.state === "attack") {
    if (a.t > 0.04 && a.t < 0.2 && !a.ai.struck) { if (strike(sim, a, 34, 1.3, 0.3)) a.ai.struck = 1; }
    if (a.t > 0.22) { a.ai.struck = 0; setState(a, "recover", "idle"); }
    return;
  }
  if (a.state === "recover") { if (a.t > 0.75) setState(a, "chase", "walk"); return; }
  if (a.state !== "chase") setState(a, "chase", "walk");
  // Turn slowly toward the hero so flanking works.
  a.ai.turnT = (a.ai.turnT ?? 0) + dt;
  if (a.ai.turnT > 0.45) { a.ai.turnT = 0; a.facing = facingFrom(dx, dy, a.facing); }
  const [fx, fy] = DIRV[a.facing];
  if (d > 30) walk(sim, a, (dx + fx) / 2, (dy + fy) / 2, a.speed, dt);
  const front = (dx * fx + dy * fy) > 0.5;
  if (d < 40 && front && a.t > 0.5) setState(a, "windup", "windup");
}

// Thornmother: three phases.
function boss(sim: Sim, a: Actor, dt: number, dx: number, dy: number, d: number) {
  const frac = a.hp / a.maxHp;
  const phase = frac > 0.66 ? 1 : frac > 0.33 ? 2 : 3;
  if (phase !== a.phase) {
    a.phase = phase;
    sim.sfx("boss.roar", a.x, a.y);
    sim.emit({ t: "shake", strength: 4, ms: 500 });
    setState(a, "special", "special");
    a.ai.next = 0;
  }
  const fast = phase === 3 ? 1.25 : 1;
  a.ai.brood = (a.ai.brood ?? 6) - dt;
  if (a.state === "special") { if (a.t > 0.9) setState(a, "chase", "walk"); return; }
  if (a.state === "windup") {
    a.anim = "windup";
    const move = a.ai.move;
    if (a.t > (move === 1 ? 0.6 : 0.8) / fast) {
      setState(a, "attack", "attack");
      if (move === 1) { a.gx = dx; a.gy = dy; sim.sfx("boar.charge", a.x, a.y); }
      if (move === 2) thornLines(sim, a, dx, dy);
      if (move === 3) webRing(sim, a);
    }
    return;
  }
  if (a.state === "attack") {
    if (a.ai.move === 1) {
      const r = walk(sim, a, a.gx, a.gy, 230 * fast, dt);
      if (a.contactCd <= 0 && Math.hypot(sim.hero.x - a.x, sim.hero.y - a.y) < a.radius + 12) {
        if (sim.hurtHero(1.3 * P(a), a.st.atk, a.st.spd, a.x, a.y, "contact")) a.contactCd = 1;
      }
      if (r.hitWall && a.t > 0.1) { setState(a, "stun", "hurt"); sim.sfx("boss.slam", a.x, a.y); sim.emit({ t: "shake", strength: 3, ms: 250 }); return; }
      if (a.t > 0.55) setState(a, "recover", "idle");
    } else if (a.t > 0.5) setState(a, "recover", "idle");
    return;
  }
  if (a.state === "stun") { a.anim = "hurt"; if (a.t > 1.3) setState(a, "chase", "walk"); return; }
  if (a.state === "recover") { if (a.t > 0.9 / fast) setState(a, "chase", "walk"); return; }
  if (a.state !== "chase") setState(a, "chase", "walk");
  if (d > 70) walk(sim, a, dx, dy, a.speed * fast, dt);
  a.facing = facingFrom(dx, dy, a.facing);
  contact(sim, a, a.mdef!.contact || 0.8);
  // Brood: small thornlings, at most four alive.
  if (a.ai.brood <= 0) {
    a.ai.brood = phase === 1 ? 9 : 12;
    const alive = sim.actors.filter(o => !o.dead && o.def === "thornling").length;
    for (let i = 0; i < Math.min(2, 4 - alive); i++) {
      const ang = sim.rng.range(0, Math.PI * 2);
      const t = sim.spawnMonster("thornling", a.x + Math.cos(ang) * 40, a.y + Math.sin(ang) * 30);
      if (t) { t.aggro = true; t.homeX = a.homeX; t.homeY = a.homeY; }
    }
    sim.sfx("spore.puff", a.x, a.y);
  }
  if (a.t > 1.3 / fast) {
    const roll = sim.rng.next();
    a.ai.move = phase === 1 ? 1 : phase === 2 ? (roll < 0.5 ? 2 : 1) : (roll < 0.35 ? 3 : roll < 0.7 ? 2 : 1);
    setState(a, "windup", "windup");
  }
}

function thornLines(sim: Sim, a: Actor, dx: number, dy: number) {
  const base = Math.atan2(dy, dx);
  for (const off of [-0.45, 0, 0.45]) {
    const ux = Math.cos(base + off), uy = Math.sin(base + off);
    for (let i = 1; i <= 9; i++) {
      const p = sim.addProjectile("thornLine", a.x + ux * (20 + i * 22), a.y + uy * (14 + i * 18), 0, 0, 11, 0, true, 1.1 * P(a), a.st.atk, a.st.spd, true);
      p.delay = 0.35 + i * 0.06;
      p.life = p.delay + 0.35;
    }
  }
  sim.sfx("boss.slam", a.x, a.y);
}

function webRing(sim: Sim, a: Actor) {
  for (let i = 0; i < 12; i++) {
    const ang = i / 12 * Math.PI * 2;
    const p = sim.addProjectile("web", a.x, a.y - 16, Math.cos(ang) * 140, Math.sin(ang) * 140, 7, 1.8, true, 0.8 * P(a), a.st.atk, a.st.spd, false);
    p.slow = 2;
  }
  sim.sfx("web.spit", a.x, a.y);
}
