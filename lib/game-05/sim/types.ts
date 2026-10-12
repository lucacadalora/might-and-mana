import type { Action, ActorAnim, Dir4, MonsterDef, NpcDef, ProjectileView, SpellId, Stats } from "../contract";

export interface SimInput {
  mx: number;
  my: number;
  pressed: Record<Action, boolean>;
  held: { attack: boolean };
}

export type HeroState = "free" | "attack" | "charge" | "spin" | "cast" | "dodge" | "hurt" | "dead" | "raise";

export interface Hero {
  x: number; y: number; px: number; py: number;
  level: number;
  /** Knockback velocity (decays). */
  kx: number; ky: number;
  facing: Dir4;
  state: HeroState;
  t: number;
  moving: boolean;
  combo: number;
  queued: boolean;
  lastSwing: number;
  hit: Set<string>;
  holdTime: number;
  charge: number;
  dodgeX: number; dodgeY: number;
  dodgeCd: number;
  invuln: number;
  flash: number;
  slowT: number;
  castSpell: SpellId | null;
  castDone: boolean;
  raiseItem: string | null;
  regen: number;
  stepDist: number;
  deadT: number;
}

export type ActorState =
  | "idle" | "wander" | "chase" | "windup" | "attack" | "recover" | "hurt" | "dead" | "stun"
  | "circle" | "retreat" | "retreat2" | "follow" | "talk" | "special";

export interface Actor {
  id: number;
  kind: "monster" | "npc" | "follower";
  /** Monster def id or NPC id. */
  def: string;
  sprite: string;
  x: number; y: number; px: number; py: number; z: number;
  level: number;
  kx: number; ky: number;
  facing: Dir4;
  state: ActorState;
  t: number;
  anim: ActorAnim;
  animTime: number;
  hp: number; maxHp: number;
  st: Stats;
  radius: number;
  speed: number;
  homeX: number; homeY: number;
  spawnId?: string;
  once?: boolean;
  mdef?: MonsterDef;
  npc?: NpcDef;
  wander: number;
  flash: number;
  alpha: number;
  dead: boolean;
  elite: boolean;
  invuln: number;
  contactCd: number;
  hitBy: number;
  poise: number;
  phase: number;
  slowT: number;
  burnT: number;
  burnTick: number;
  aggro: boolean;
  /** Free-form AI memory. */
  ai: Record<string, number>;
  /** Target point for moves (wander goal, charge direction). */
  gx: number; gy: number;
  removeT: number;
  following?: boolean;
}

export interface Pickup {
  id: number;
  kind: "coin" | "item";
  item?: string;
  value: number;
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  age: number;
  /** The hero's bag was full when it touched this; it stays put until the hero comes back. */
  refused?: boolean;
}

export interface Projectile {
  id: number;
  kind: ProjectileView["kind"];
  x: number; y: number; vx: number; vy: number;
  r: number;
  age: number;
  life: number;
  hostile: boolean;
  power: number;
  /** Attacker stats for damage. */
  atk: number; spd: number;
  pierce: boolean;
  hit: Set<number>;
  /** Ring radius growth (frost ring) or tick timer (spore cloud). */
  grow: number;
  slow: number;
  level: number;
  /** Seconds before a thorn-line segment becomes dangerous. */
  delay: number;
  /** Damage-over-time cooldown (spore clouds). */
  tick: number;
}

export interface DialogRuntime {
  id: string;
  npc: string | null;
  lines: Array<{ speaker: string; text: string; portrait?: string }>;
  index: number;
  choices: Array<{ label: string; effects?: import("../contract").Effect[]; next?: string }> | null;
  choice: number;
  effects: import("../contract").Effect[];
  effectsApplied: boolean;
  /** Called when the dialog closes (after effects and choices). */
  onClose?: () => void;
}

export const HERO_R = 7;
export const WALK = 104;
export const SWING = { anticipation: 0.05, activeEnd: 0.14, chainAt: 0.19, end: 0.3, window: 0.44 };
export const SPIN = { time: 0.42, activeStart: 0.06, activeEnd: 0.34 };
export const DODGE = { time: 0.28, invuln: 0.2, speed: 236, cooldown: 0.55 };
export const CAST = { time: 0.24, release: 0.1 };
export const HURT = { time: 0.2, invuln: 0.75 };
export const COMBO_POWER = [0, 1, 1, 1.2, 1.5];
export const REACH = { swing: 30, spin: 40, talk: 46, use: 30 };
