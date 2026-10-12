import { SAVE_PREFIX } from "./contract";
import type { Dir4, MapId, SaveState, Slot, SpellId } from "./contract";

/**
 * Game 05 durable storage on this device (localStorage, keys `vantis-game05-v2:*`).
 *   :auto        autosave (map change, inn rest, chapter clear)
 *   :slot1..3    manual slots from the pause menu
 *   :prefs       volumes, reduced motion, text speed, touch controls
 * Every read goes through validateSave, which rebuilds each SaveState field from scratch with
 * type checks and clamps and never copies an unknown field. Derived stats (max HP, ATK…) are
 * never stored; the engine recomputes them from level and gear.
 */
export type SlotId = "auto" | 1 | 2 | 3;
export const SLOT_IDS: readonly SlotId[] = ["auto", 1, 2, 3];
export const MANUAL_SLOTS: readonly (1 | 2 | 3)[] = [1, 2, 3];

export const MAP_IDS: readonly MapId[] = [
  "home", "larkmoor", "inn", "shop", "smithy", "tavern", "hall", "southfold", "mossgloam", "barrow1", "barrow2",
];
const SPELL_IDS: readonly SpellId[] = ["emberBolt", "frostRing", "thornbreak"];
const SLOTS: readonly Slot[] = ["head", "body", "boots", "weapon", "charm"];
const DIRS: readonly Dir4[] = ["down", "left", "up", "right"];

/** Display names for slot lists before the content catalog has loaded (the host prefers the
 *  live MapDef names once it has them; these mirror lib/game-05/content/maps). */
export const MAP_NAMES: Readonly<Record<MapId, string>> = {
  home: "Wren's house", larkmoor: "Larkmoor", inn: "The Lantern Inn", shop: "Tilda's Goods", smithy: "Hask's Smithy",
  tavern: "The Reed & Barrel", hall: "Elder's Hall", southfold: "Southfold", mossgloam: "Mossgloam Wood",
  barrow1: "The Barrow", barrow2: "Heart of the Barrow",
};

export const MAX_LEVEL = 30;
export const NAME_MAX = 10;
export const DEFAULT_NAME = "Wren";

const key = (slot: SlotId) => `${SAVE_PREFIX}:${slot === "auto" ? "auto" : `slot${slot}`}`;
const PREFS_KEY = `${SAVE_PREFIX}:prefs`;
const ID = /^[A-Za-z][A-Za-z0-9_.:-]{0,47}$/;

// ─── Validation ────────────────────────────────────────────────────────────────────────────────
type Raw = Record<string, unknown>;
const isObject = (value: unknown): value is Raw => typeof value === "object" && value !== null && !Array.isArray(value);
function int(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(min, Math.min(max, Math.floor(value))) : fallback;
}
function num(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
}
function id(value: unknown): string | null {
  return typeof value === "string" && ID.test(value) ? value : null;
}
function ids(value: unknown, limit: number, unique: boolean): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const entry of value) {
    const valid = id(entry);
    if (!valid || (unique && out.includes(valid))) continue;
    out.push(valid);
    if (out.length >= limit) break;
  }
  return out;
}
function oneOf<T extends string>(value: unknown, options: readonly T[], fallback: T): T {
  return typeof value === "string" && (options as readonly string[]).includes(value) ? value as T : fallback;
}

/** Letters, digits, spaces, apostrophes and hyphens; trimmed, collapsed, at most NAME_MAX. */
export function cleanName(value: unknown): string {
  if (typeof value !== "string") return DEFAULT_NAME;
  const cleaned = value.normalize("NFC").replace(/[^\p{L}\p{N} '\-]/gu, "").replace(/\s+/g, " ").trim().slice(0, NAME_MAX).trim();
  return cleaned || DEFAULT_NAME;
}

/** Rebuild a SaveState field by field. Returns null when the value is not a v2 save at all. */
export function validateSave(input: unknown): SaveState | null {
  if (!isObject(input) || input.v !== 2) return null;
  const map = oneOf<MapId>(input.map, MAP_IDS, "home");
  const equippedRaw = isObject(input.equipped) ? input.equipped : {};
  const equipped = {} as Record<Slot, string | null>;
  for (const slot of SLOTS) equipped[slot] = id(equippedRaw[slot]);
  const bag: Record<string, number> = {};
  if (isObject(input.bag)) {
    for (const [item, count] of Object.entries(input.bag).slice(0, 200)) {
      const valid = id(item), n = int(count, 0, 999, 0);
      if (valid && n > 0) bag[valid] = n;
    }
  }
  const flags: Record<string, boolean> = {};
  if (isObject(input.flags)) {
    for (const [flag, value] of Object.entries(input.flags).slice(0, 400)) {
      const valid = id(flag);
      if (valid && value === true) flags[valid] = true;
    }
  }
  const quests: Record<string, string> = {};
  if (isObject(input.quests)) {
    for (const [quest, step] of Object.entries(input.quests).slice(0, 16)) {
      const q = id(quest), s = id(step);
      if (q && s) quests[q] = s;
    }
  }
  const progress: Record<string, number> = {};
  if (isObject(input.progress)) {
    for (const [counter, value] of Object.entries(input.progress).slice(0, 64)) {
      const [quest, step, extra] = counter.split(":");
      if (extra !== undefined || !id(quest) || !id(step)) continue;
      progress[counter] = int(value, 0, 9999, 0);
    }
  }
  const spells = ids(input.spells, SPELL_IDS.length, true).filter((s): s is SpellId => (SPELL_IDS as readonly string[]).includes(s));
  const selected = oneOf<SpellId | "">(input.spell, [...SPELL_IDS, ""], "");
  const visitedRaw = ids(input.visited, MAP_IDS.length, true).filter((m): m is MapId => (MAP_IDS as readonly string[]).includes(m));
  const visited = visitedRaw.includes(map) ? visitedRaw : [...visitedRaw, map];
  const statsRaw = isObject(input.stats) ? input.stats : {};
  const savedAt = typeof input.savedAt === "string" && input.savedAt.length <= 40 && Number.isFinite(Date.parse(input.savedAt))
    ? new Date(Date.parse(input.savedAt)).toISOString() : new Date(0).toISOString();
  return {
    v: 2,
    heroName: cleanName(input.heroName),
    level: int(input.level, 1, MAX_LEVEL, 1),
    xp: int(input.xp, 0, 10_000_000, 0),
    hp: int(input.hp, 0, 100_000, 1),
    mp: int(input.mp, 0, 100_000, 0),
    gold: int(input.gold, 0, 9_999_999, 0),
    equipped,
    gear: ids(input.gear, 200, false),
    bag,
    spells,
    spell: selected && spells.includes(selected) ? selected : spells[0] ?? null,
    flags,
    quests,
    done: ids(input.done, 64, true),
    progress,
    chests: ids(input.chests, 256, true),
    map,
    x: num(input.x, 0, 100_000, 0),
    y: num(input.y, 0, 100_000, 0),
    facing: oneOf<Dir4>(input.facing, DIRS, "down"),
    night: input.night === true,
    visited,
    playSeconds: num(input.playSeconds, 0, 3.6e7, 0),
    stats: {
      kills: int(statsRaw.kills, 0, 1e9, 0),
      deaths: int(statsRaw.deaths, 0, 1e9, 0),
      grass: int(statsRaw.grass, 0, 1e9, 0),
      crits: int(statsRaw.crits, 0, 1e9, 0),
    },
    rng: int(input.rng, 0, 0xffffffff, 1) >>> 0,
    savedAt,
    chapterClear: input.chapterClear === true,
  };
}

// ─── Storage ───────────────────────────────────────────────────────────────────────────────────
function storage(): Storage | null {
  try { return typeof window === "undefined" ? null : window.localStorage; } catch { return null; }
}

/** A real save is a few KB; anything far larger is not ours and is never parsed. */
const MAX_SAVE_CHARS = 200_000;

export function readSlot(slot: SlotId): SaveState | null {
  try {
    const raw = storage()?.getItem(key(slot));
    return raw && raw.length <= MAX_SAVE_CHARS ? validateSave(JSON.parse(raw)) : null;
  } catch { return null; }
}

/** Writes a validated copy stamped with the save time; false when storage is unavailable or full. */
export function writeSlot(slot: SlotId, state: SaveState): boolean {
  const clean = validateSave({ ...state, savedAt: new Date().toISOString() });
  const store = storage();
  if (!clean || !store) return false;
  try { store.setItem(key(slot), JSON.stringify(clean)); return true; } catch { return false; }
}

export function clearSlot(slot: SlotId): boolean {
  try { storage()?.removeItem(key(slot)); return true; } catch { return false; }
}

export interface SlotMeta {
  slot: SlotId;
  empty: boolean;
  heroName: string;
  level: number;
  map: MapId;
  mapName: string;
  playSeconds: number;
  savedAt: string;
  chapterClear: boolean;
}

export function slotMeta(slot: SlotId, state = readSlot(slot)): SlotMeta {
  return state
    ? { slot, empty: false, heroName: state.heroName, level: state.level, map: state.map, mapName: MAP_NAMES[state.map],
      playSeconds: state.playSeconds, savedAt: state.savedAt, chapterClear: state.chapterClear }
    : { slot, empty: true, heroName: "", level: 0, map: "home", mapName: "", playSeconds: 0, savedAt: "", chapterClear: false };
}

export function listSlots(): SlotMeta[] { return SLOT_IDS.map(slot => slotMeta(slot)); }

/** Continue = the most recently written save among the autosave and the three slots. */
export function newestSave(): { slot: SlotId; state: SaveState } | null {
  let best: { slot: SlotId; state: SaveState } | null = null;
  for (const slot of SLOT_IDS) {
    const state = readSlot(slot);
    if (state && (!best || Date.parse(state.savedAt) > Date.parse(best.state.savedAt))) best = { slot, state };
  }
  return best;
}

export function formatPlayTime(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600), m = Math.floor(total / 60) % 60, s = total % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
}

/** "24 Sep 21:14 UTC" style stamp for slot lists. */
export function formatSavedAt(iso: string): string {
  const time = Date.parse(iso);
  if (!Number.isFinite(time) || time <= 0) return "";
  const d = new Date(time);
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${d.getUTCDate()} ${months[d.getUTCMonth()]} ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")} UTC`;
}

// ─── Preferences ───────────────────────────────────────────────────────────────────────────────
export interface Preferences {
  /** 0..1 */
  master: number;
  music: number;
  sfx: number;
  muted: boolean;
  /** null = follow the operating system setting. */
  reducedMotion: boolean | null;
  /** Characters per second for dialog; 0 = instant. */
  textSpeed: number;
  /** Touch buttons: auto = show on touch input. */
  touchControls: "auto" | "on" | "off";
}
export const DEFAULT_PREFERENCES: Preferences = {
  master: 0.85, music: 0.7, sfx: 0.85, muted: false, reducedMotion: null, textSpeed: 48, touchControls: "auto",
};

export function loadPreferences(): Preferences {
  try {
    const raw = storage()?.getItem(PREFS_KEY);
    const value: unknown = raw ? JSON.parse(raw) : null;
    if (!isObject(value)) return { ...DEFAULT_PREFERENCES };
    return {
      master: num(value.master, 0, 1, DEFAULT_PREFERENCES.master),
      music: num(value.music, 0, 1, DEFAULT_PREFERENCES.music),
      sfx: num(value.sfx, 0, 1, DEFAULT_PREFERENCES.sfx),
      muted: value.muted === true,
      reducedMotion: typeof value.reducedMotion === "boolean" ? value.reducedMotion : null,
      textSpeed: [0, 32, 48, 80].includes(value.textSpeed as number) ? value.textSpeed as number : DEFAULT_PREFERENCES.textSpeed,
      touchControls: oneOf(value.touchControls, ["auto", "on", "off"] as const, "auto"),
    };
  } catch { return { ...DEFAULT_PREFERENCES }; }
}

export function writePreferences(preferences: Preferences): boolean {
  try { storage()?.setItem(PREFS_KEY, JSON.stringify(preferences)); return true; } catch { return false; }
}
