import type {
  Cond, ConsumableDef, GearDef, KeyItemDef, MapDef, MapId, QuestDef, SaveState, ShopDef, SkillDef, Slot, SpellDef, SpellId, Stats,
} from "@/lib/game-05/contract";
import { TILE } from "@/lib/game-05/contract";
import { CONSUMABLES, GEAR, KEY_ITEMS, sellPrice } from "@/lib/game-05/content/items";
import { statsAt, XP_TO_NEXT } from "@/lib/game-05/content/levels";
import { SPELLS } from "@/lib/game-05/content/spells";
import { SKILLS } from "@/lib/game-05/content/skills";
import { SHOPS, SHOP_UNLOCKS } from "@/lib/game-05/content/shops";
import { QUESTS } from "@/lib/game-05/content/quests";
import { MAPS } from "@/lib/game-05/content/maps";
import { PROPS } from "@/lib/game-05/content/props";
import { BUFF_NAMES } from "./catalog-lite";

export { BUFF_ICONS, BUFF_NAMES } from "./catalog-lite";

/**
 * The host's read-only view of the game data for its own screens (shop, status, item ring, map).
 * Loaded with a dynamic import after the title so the route chunk stays small. The engine owns
 * the rules; these helpers only preview them (prices, stat changes, shop gating) for display.
 */
export const SLOTS: readonly Slot[] = ["head", "body", "boots", "weapon", "charm"];
export const SLOT_NAMES: Readonly<Record<Slot, string>> = { head: "Head", body: "Body", boots: "Boots", weapon: "Weapon", charm: "Charm" };
export const STAT_KEYS = ["atk", "def", "spd"] as const;
export const STAT_NAMES: Readonly<Record<keyof Stats, string>> = { hp: "HP", mp: "MP", atk: "ATK", def: "DEF", spd: "SPD" };

export type ItemKind = "gear" | "consumable" | "key";
export interface ItemInfo {
  id: string;
  kind: ItemKind;
  name: string;
  icon: string;
  desc: string;
  price: number | null;
  sell: number;
  gear?: GearDef;
  consumable?: ConsumableDef;
  key?: KeyItemDef;
}

export const CATALOG = {
  gear: GEAR as Record<string, GearDef>,
  consumables: CONSUMABLES as Record<string, ConsumableDef>,
  keyItems: KEY_ITEMS as Record<string, KeyItemDef>,
  spells: SPELLS as Record<SpellId, SpellDef>,
  skills: SKILLS as SkillDef[],
  shops: SHOPS as Record<string, ShopDef>,
  quests: QUESTS as Record<string, QuestDef>,
  maps: MAPS as Record<MapId, MapDef>,
  props: PROPS,
};
export type Catalog = typeof CATALOG;

/** Consumables in their fixed ring order (content order). */
export const CONSUMABLE_ORDER: readonly string[] = Object.keys(CONSUMABLES);

export function itemInfo(id: string): ItemInfo | null {
  const g = GEAR[id];
  if (g) return { id, kind: "gear", name: g.name, icon: g.icon, desc: g.desc, price: g.price, sell: sellPrice(id), gear: g };
  const c = CONSUMABLES[id];
  if (c) return { id, kind: "consumable", name: c.name, icon: c.icon, desc: c.desc, price: c.price, sell: sellPrice(id), consumable: c };
  const k = KEY_ITEMS[id];
  if (k) return { id, kind: "key", name: k.name, icon: k.icon, desc: k.desc, price: null, sell: 0, key: k };
  return null;
}

export function xpToNext(level: number): number { return XP_TO_NEXT(level); }

const ZERO: Stats = { hp: 0, mp: 0, atk: 0, def: 0, spd: 0 };
function addMods(target: Stats, mods: Partial<Stats> | undefined): void {
  if (!mods) return;
  for (const key of Object.keys(ZERO) as (keyof Stats)[]) target[key] += mods[key] ?? 0;
}

/** Level-table stats plus equipped gear (buffs excluded). */
export function heroStats(save: Pick<SaveState, "level" | "equipped">, equipped = save.equipped): Stats {
  const stats = { ...statsAt(save.level) };
  for (const slot of SLOTS) addMods(stats, equipped[slot] ? GEAR[equipped[slot]!]?.mods : undefined);
  return stats;
}

/** Stats if `item` replaced whatever is in its slot. */
export function previewStats(save: Pick<SaveState, "level" | "equipped">, item: string): Stats {
  const g = GEAR[item];
  if (!g) return heroStats(save);
  return heroStats(save, { ...save.equipped, [g.slot]: item });
}

export function ownedCount(save: SaveState, id: string): number {
  if (GEAR[id]) return save.gear.filter(g => g === id).length + (Object.values(save.equipped).includes(id) ? 1 : 0);
  return save.bag[id] ?? 0;
}

export function isEquipped(save: SaveState, id: string): boolean {
  return Object.values(save.equipped).includes(id);
}

/** Mirrors the sim's condition rules for display gating (shop stock). */
export function evalCond(cond: Cond, save: SaveState): boolean {
  if ("all" in cond) return cond.all.every(c => evalCond(c, save));
  if ("any" in cond) return cond.any.some(c => evalCond(c, save));
  if ("flag" in cond) return save.flags[cond.flag] === true;
  if ("notFlag" in cond) return save.flags[cond.notFlag] !== true;
  if ("quest" in cond) return save.quests[cond.quest] === cond.step;
  if ("questActive" in cond) return cond.questActive in save.quests;
  if ("questDone" in cond) return save.done.includes(cond.questDone);
  if ("night" in cond) return save.night === cond.night;
  if ("level" in cond) return save.level >= cond.level;
  if ("has" in cond) return ownedCount(save, cond.has) >= (cond.count ?? 1);
  return false;
}

export function shopStock(shopId: string, save: SaveState): string[] {
  const shop = SHOPS[shopId];
  if (!shop) return [];
  const unlocks = SHOP_UNLOCKS as Record<string, Cond | undefined>;
  return shop.stock.filter(id => itemInfo(id) && (!unlocks[id] || evalCond(unlocks[id]!, save)));
}

/** Items the shop will buy back: unequipped gear with a price and consumables in the bag. */
export function sellable(save: SaveState): Array<{ id: string; count: number }> {
  const out: Array<{ id: string; count: number }> = [];
  const seen = new Set<string>();
  for (const id of save.gear) {
    if (seen.has(id) || !GEAR[id] || GEAR[id].price == null) continue;
    seen.add(id);
    out.push({ id, count: save.gear.filter(g => g === id).length });
  }
  for (const id of CONSUMABLE_ORDER) if ((save.bag[id] ?? 0) > 0) out.push({ id, count: save.bag[id] });
  return out;
}

/** Gear the hero owns for a slot (equipped first, then the bag, ladder order). */
export function gearForSlot(save: SaveState, slot: Slot): string[] {
  const ids = new Set<string>();
  const equipped = save.equipped[slot];
  if (equipped) ids.add(equipped);
  for (const id of save.gear) if (GEAR[id]?.slot === slot) ids.add(id);
  return [...ids].sort((a, b) => (a === equipped ? -1 : b === equipped ? 1 : GEAR[a].tier - GEAR[b].tier));
}

export function describeEffect(c: ConsumableDef): string {
  const e = c.effect;
  if (e.kind === "heal") return `Restores ${e.hp} HP`;
  if (e.kind === "mana") return `Restores ${e.mp} MP`;
  if (e.kind === "full") return "Restores all HP and MP";
  return `${BUFF_NAMES[e.buff] ?? e.buff} for ${e.seconds} s`;
}

export function modsText(mods: Partial<Stats>): string {
  return (Object.keys(ZERO) as (keyof Stats)[])
    .filter(k => mods[k])
    .map(k => `${STAT_NAMES[k]} ${mods[k]! > 0 ? "+" : ""}${mods[k]}`)
    .join("  ");
}

/** Where the active quests point, for the map screen: in this map, or the map to head for. */
export interface MapObjective { quest: string; main: boolean; label: string; map: MapId; x: number; y: number }
export function objectives(save: SaveState): MapObjective[] {
  const out: MapObjective[] = [];
  for (const [questId, stepId] of Object.entries(save.quests)) {
    const quest = QUESTS[questId];
    const step = quest?.steps.find(s => s.id === stepId);
    if (!quest || !step) continue;
    let where: { map: MapId; x: number; y: number } | null = null;
    const t = step.target;
    if (t && "map" in t) where = { map: t.map, x: t.x, y: t.y };
    const npc = t && "npc" in t ? t.npc : step.goal.kind === "talk" ? step.goal.npc : null;
    if (!where && npc) {
      const preferred = [save.map, ...(Object.keys(MAPS) as MapId[]).filter(m => m !== save.map)];
      for (const mapId of preferred) {
        const e = MAPS[mapId]?.entities.find(x => x.type === "npc" && x.id === npc);
        if (e) { where = { map: mapId, x: e.x, y: e.y }; break; }
      }
    }
    if (!where && step.goal.kind === "reach") where = { map: step.goal.map, x: step.goal.x, y: step.goal.y };
    if (where) out.push({ quest: questId, main: quest.kind === "main", label: step.ticker, ...where });
  }
  return out.sort((a, b) => Number(b.main) - Number(a.main));
}

/** The exit of `from` that leads toward `to` (breadth-first over map exits). */
export function exitToward(from: MapId, to: MapId): { x: number; y: number; w: number; h: number; to: MapId } | null {
  if (from === to) return null;
  type Exit = { x: number; y: number; w: number; h: number; to: MapId };
  const prev = new Map<MapId, { map: MapId; exit: Exit }>();
  const queue: MapId[] = [from];
  const seen = new Set<MapId>([from]);
  while (queue.length) {
    const m = queue.shift()!;
    if (m === to) break;
    for (const e of MAPS[m]?.entities ?? []) {
      if (e.type !== "exit" || seen.has(e.to)) continue;
      seen.add(e.to);
      prev.set(e.to, { map: m, exit: e });
      queue.push(e.to);
    }
  }
  if (!prev.has(to)) return null;
  let cur: MapId = to;
  for (let guard = 0; guard < 32; guard++) {
    const p = prev.get(cur)!;
    if (p.map === from) return p.exit;
    cur = p.map;
  }
  return null;
}

export const WORLD_TILE = TILE;

/**
 * Content-aware pass over a save that already passed lib/game-05/save.ts's type validation:
 * drops ids the content does not know (or gear in the wrong slot), caps carried counts, and keeps
 * only quest steps and counters that exist. Derived stats are never read from a save.
 */
export function sanitizeSave(input: SaveState): SaveState {
  const s = structuredClone(input);
  for (const slot of SLOTS) {
    const id = s.equipped[slot];
    if (id && (!GEAR[id] || GEAR[id].slot !== slot)) s.equipped[slot] = null;
  }
  s.gear = s.gear.filter(id => !!GEAR[id]).slice(0, 120);
  const bag: Record<string, number> = {};
  for (const [id, n] of Object.entries(s.bag)) {
    if (CONSUMABLES[id]) bag[id] = Math.min(n, CONSUMABLES[id].carry);
    else if (KEY_ITEMS[id]) bag[id] = Math.min(n, 99);
  }
  s.bag = bag;
  const quests: Record<string, string> = {};
  for (const [q, step] of Object.entries(s.quests)) if (QUESTS[q]?.steps.some(x => x.id === step)) quests[q] = step;
  s.quests = quests;
  s.done = s.done.filter(q => !!QUESTS[q]);
  const progress: Record<string, number> = {};
  for (const [key, n] of Object.entries(s.progress)) {
    const [q, step] = key.split(":");
    if (QUESTS[q]?.steps.some(x => x.id === step)) progress[key] = n;
  }
  s.progress = progress;
  s.spells = s.spells.filter(id => !!SPELLS[id]);
  if (s.spell && !s.spells.includes(s.spell)) s.spell = s.spells[0] ?? null;
  if (!MAPS[s.map]) s.map = "home";
  // A position outside the map or inside something solid (e.g. after the map id fell back)
  // becomes the map's own arrival point.
  const map = MAPS[s.map];
  const W = (map.ground[0]?.length ?? 0) * TILE, H = map.ground.length * TILE;
  const ground = map.ground[Math.floor(s.y / TILE)]?.[Math.floor(s.x / TILE)] ?? "x";
  if (!(s.x > 0 && s.x < W && s.y > 0 && s.y < H) || "#WxH".includes(ground)) {
    s.x = map.spawn.x * TILE; s.y = map.spawn.y * TILE; s.facing = map.spawn.facing;
  }
  return s;
}
