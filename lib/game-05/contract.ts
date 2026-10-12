/**
 * Shared contract. The sim, renderer, host UI, content, art, audio and tests all code against
 * these types. Bump CONTRACT_VERSION on any breaking change.
 *
 * Units: world pixels, where 1 = one art pixel. TILE = 32. +x is screen right, +y is screen DOWN.
 * Positions of actors are their FEET (the y-sort and collision point). Map grids are rows of
 * one character per tile, row 0 at the top.
 */
export const CONTRACT_VERSION = 1;
export const TILE = 32;
export const STEP = 1 / 60;
export const SAVE_PREFIX = "vantis-game05-v2";

// ─── Basics ────────────────────────────────────────────────────────────────────────────────────
export type Dir4 = "down" | "left" | "up" | "right";
export interface Vec { x: number; y: number }
export interface Rect { x: number; y: number; w: number; h: number }
export type Device = "keyboard" | "gamepad" | "touch";

export interface Stats { hp: number; mp: number; atk: number; def: number; spd: number }
export type StatKey = keyof Stats;

// ─── Input ─────────────────────────────────────────────────────────────────────────────────────
export type Action = "attack" | "magic" | "dodge" | "item" | "nextSpell" | "map" | "status" | "pause";
export interface InputFrame {
  /** Analog move, already deadzoned, length ≤ 1. +y = screen down. */
  moveX: number;
  moveY: number;
  /** Edges since the last frame (a tap shorter than a frame still counts). */
  pressed: Record<Action, boolean>;
  /** Attack is held (charge). */
  held: { attack: boolean };
  device: Device;
}
export type MenuCommand = "up" | "down" | "left" | "right" | "ok" | "back" | "start";

// ─── Content ids ───────────────────────────────────────────────────────────────────────────────
export type MapId =
  | "home" | "larkmoor" | "inn" | "shop" | "smithy" | "tavern" | "hall"
  | "southfold" | "mossgloam" | "barrow1" | "barrow2";
export type Slot = "head" | "body" | "boots" | "weapon" | "charm";
export type SpellId = "emberBolt" | "frostRing" | "thornbreak";
export type BuffId = "stoneskin" | "fury" | "fortune" | "quickstep";
export type SkillId = "combo2" | "combo3" | "combo4" | "spin";
export type MusicId =
  | "title" | "village" | "villageNight" | "interior" | "field" | "forest" | "dungeon" | "boss" | "none";
export type Behaviour =
  | "hopper" | "swooper" | "charger" | "spore" | "packWolf" | "spitter" | "shieldGuard" | "boss" | "dummy";

// ─── Items ─────────────────────────────────────────────────────────────────────────────────────
export interface GearDef {
  id: string;
  name: string;
  slot: Slot;
  /** Sort order within its slot ladder. */
  tier: number;
  /** Buy price; null = not sold (quest, chest or drop only). */
  price: number | null;
  mods: Partial<Stats>;
  /** Level band in which monsters may drop it; omit = never drops. */
  dropLevels?: [number, number];
  special?: "burn" | "goldFind" | "none";
  icon: string;
  desc: string;
}
export type ConsumableEffect =
  | { kind: "heal"; hp: number }
  | { kind: "mana"; mp: number }
  | { kind: "full" }
  | { kind: "buff"; buff: BuffId; seconds: number };
export interface ConsumableDef {
  id: string;
  name: string;
  price: number;
  carry: number;
  effect: ConsumableEffect;
  /** Relative weight when a monster or grass drops a consumable. */
  dropWeight: number;
  icon: string;
  desc: string;
}
/** Quest items live in the bag too but cannot be used or sold. */
export interface KeyItemDef { id: string; name: string; icon: string; desc: string }

export interface SpellDef {
  id: SpellId;
  name: string;
  mp: number;
  /** Learned automatically at this level; null = learned from a quest or effect. */
  level: number | null;
  kind: "bolt" | "ring" | "spread";
  power: number;
  icon: string;
  desc: string;
}

export interface SkillDef { id: SkillId; level: number; name: string; hint: string }

// ─── Monsters ──────────────────────────────────────────────────────────────────────────────────
export interface MonsterDef {
  id: string;
  name: string;
  level: number;
  behaviour: Behaviour;
  /** Multipliers on the shared level table at `level`. */
  mult: Stats;
  /** Collision radius at the feet. */
  radius: number;
  /** Walk speed in px/s. */
  speed: number;
  /** Sprite sheet key in the art atlas. */
  sprite: string;
  /** XP and gold per kill (gold is the coin total, split into coins on the ground). */
  xp: number;
  gold: [number, number];
  /** Drop roll: chance of gold coins, of a consumable, of level-band gear. */
  drops: { gold: number; consumable: number; gear: number };
  /** Palette-variant elite: ×1.5 stats, its own name and sprite tint. */
  elite?: boolean;
  /** Knockback taken multiplier (0 = immovable). */
  weight: number;
  /** Touch damage power when the hero walks into it (0 = none). */
  contact: number;
  /** Attack power multiplier applied to every move of this monster (default 1). */
  power?: number;
  boss?: { phases: number };
}

// ─── Maps ──────────────────────────────────────────────────────────────────────────────────────
/**
 * Ground materials, one char per tile:
 *  g grass · G dark grass · d dirt path · c cobble · s sand · w shallow water (walkable, slow)
 *  W deep water (solid) · f wooden floor · t stone floor · k cave floor · m mud
 *  # rock wall (solid, drawn as a wall face) · H house wall (solid; houses are props, use under them)
 *  x void (solid, black: outside an interior) · b bridge planks (walkable over water)
 */
export type Ground = "g" | "G" | "d" | "c" | "s" | "w" | "W" | "f" | "t" | "k" | "m" | "#" | "H" | "x" | "b";

export type PropKind =
  | "tree" | "pine" | "deadTree" | "bush" | "grass" | "flowers" | "rock" | "boulder" | "stump" | "log"
  | "pot" | "barrel" | "crate" | "sign" | "fence" | "fenceV" | "lamp" | "torch" | "brazier" | "well"
  | "fountain" | "statue" | "house" | "inn" | "shopHouse" | "smithyHouse" | "tavernHouse" | "hall"
  | "bed" | "table" | "chair" | "counter" | "shelf" | "hearth" | "rug" | "stairsUp" | "stairsDown"
  | "web" | "bones" | "mushroom" | "reeds" | "lilypad" | "dock" | "boat" | "wardstone" | "lever"
  | "cart" | "hay" | "anvil" | "weaponRack" | "bookcase" | "window" | "banner" | "gravestone";

export interface PropPlacement {
  kind: PropKind;
  /** Tile coordinates of the FOOT anchor (may be fractional). */
  x: number;
  y: number;
  /** Sprite variant index (0 default). */
  v?: number;
  /** Stable id for stateful props (cuttable grass/bush/pot keep state per map visit; levers). */
  id?: string;
  /** Flip horizontally. */
  flip?: boolean;
}

export type EntityPlacement =
  | { type: "npc"; id: string; x: number; y: number; facing?: Dir4; wander?: number; night?: "only" | "hide" }
  | { type: "spawn"; monster: string; x: number; y: number; count: number; radius?: number; id: string; once?: boolean; when?: Cond }
  | { type: "chest"; id: string; x: number; y: number; loot: Loot }
  | { type: "exit"; x: number; y: number; w: number; h: number; to: MapId; at: { x: number; y: number; facing: Dir4 }; kind: "door" | "edge" | "stairs" }
  | { type: "trigger"; id: string; x: number; y: number; w: number; h: number; effects: Effect[]; once?: boolean; when?: Cond }
  | { type: "gate"; id: string; x: number; y: number; w: number; h: number; kind: "flame" | "iron" | "thorns"; open: Cond }
  | { type: "light"; x: number; y: number; radius: number; color: string; flicker?: boolean; night?: boolean }
  | { type: "follower"; id: string; x: number; y: number; npc: string; when: Cond }
  | { type: "shaft"; x: number; y: number; w: number; h: number; kind: "window" | "sunbeam" }
  | { type: "fog"; x: number; y: number; w: number; h: number };

export interface MapDef {
  id: MapId;
  name: string;
  kind: "town" | "interior" | "field" | "forest" | "dungeon";
  /** Rows of Ground chars; all rows the same length. */
  ground: string[];
  /** Optional elevation rows '0'..'3' (same size). Higher ground's south edge draws a cliff face
   *  and is solid except where a stairs prop sits. */
  height?: string[];
  props: PropPlacement[];
  entities: EntityPlacement[];
  music: MusicId;
  light: "day" | "interior" | "cave" | "forest";
  /** Default arrival point (tile coordinates of the feet). */
  spawn: { x: number; y: number; facing: Dir4 };
  /** Recommended level shown on signposts and the map. */
  level?: number;
}

// ─── Quests, dialogue, conditions, effects ─────────────────────────────────────────────────────
export type Cond =
  | { flag: string }
  | { notFlag: string }
  | { quest: string; step: string }
  | { questActive: string }
  | { questDone: string }
  | { night: boolean }
  | { level: number }
  | { has: string; count?: number }
  | { gold: number }
  | { all: Cond[] }
  | { any: Cond[] };

export type Effect =
  | { t: "flag"; flag: string; value?: boolean }
  | { t: "give"; item: string; count?: number }
  | { t: "take"; item: string; count?: number }
  | { t: "gold"; amount: number }
  | { t: "xp"; amount: number }
  | { t: "startQuest"; quest: string }
  | { t: "advance"; quest: string; step: string }
  | { t: "completeQuest"; quest: string }
  | { t: "teach"; spell: SpellId }
  | { t: "shop"; shop: string }
  | { t: "rest" }
  | { t: "heal" }
  | { t: "dialog"; dialog: string }
  | { t: "open"; gate: string }
  | { t: "shake"; strength: number }
  | { t: "chapterClear" };

export type Loot =
  | { kind: "gold"; amount: number }
  | { kind: "item"; item: string; count?: number };

export interface DialogLine { speaker: string; text: string; portrait?: string }
export interface DialogChoice { label: string; effects?: Effect[]; next?: string }
export interface DialogDef {
  id: string;
  lines: DialogLine[];
  choices?: DialogChoice[];
  /** Applied after the last line (and before choices). */
  effects?: Effect[];
}
export interface NpcDef {
  id: string;
  name: string;
  sprite: string;
  portrait?: string;
  /** First matching rule wins. The marker shows "!" when a rule starts a quest, "?" when it completes one. */
  talk: Array<{ when?: Cond; dialog: string; marker?: "!" | "?" }>;
}

export type StepGoal =
  | { kind: "talk"; npc: string }
  | { kind: "reach"; map: MapId; x: number; y: number; r?: number }
  | { kind: "kill"; monster: string; count: number }
  | { kind: "collect"; item: string; count: number }
  | { kind: "flag"; flag: string };
export interface QuestStep {
  id: string;
  /** Short line for the bottom ticker, e.g. "Talk to Elder Maren" or "Feverroot 3 / 10". */
  ticker: string;
  goal: StepGoal;
  /** Where the objective arrow points while this step is active. */
  target?: { map: MapId; x: number; y: number } | { npc: string };
}
export interface QuestDef {
  id: string;
  kind: "main" | "side" | "bounty";
  title: string;
  summary: string;
  giver?: string;
  minLevel?: number;
  steps: QuestStep[];
  reward: { gold?: number; xp?: number; items?: string[]; spell?: SpellId };
  /** Side quests only: shown in the quest card. */
  hint?: string;
}

export interface ShopDef { id: string; name: string; keeper: string; kind: "items" | "arms"; stock: string[] }

// ─── Durable save ──────────────────────────────────────────────────────────────────────────────
export interface SaveState {
  v: 2;
  heroName: string;
  level: number;
  xp: number;
  hp: number;
  mp: number;
  gold: number;
  equipped: Record<Slot, string | null>;
  /** Gear owned but not equipped (ids, duplicates allowed). */
  gear: string[];
  /** Consumables and key items: id → count. */
  bag: Record<string, number>;
  spells: SpellId[];
  spell: SpellId | null;
  flags: Record<string, boolean>;
  /** Active quests: id → current step id. At most one main and one side/bounty active. */
  quests: Record<string, string>;
  done: string[];
  /** Kill and collect counters per active quest step, keyed `${quest}:${step}`. */
  progress: Record<string, number>;
  chests: string[];
  map: MapId;
  x: number;
  y: number;
  facing: Dir4;
  night: boolean;
  visited: MapId[];
  playSeconds: number;
  stats: { kills: number; deaths: number; grass: number; crits: number };
  rng: number;
  savedAt: string;
  chapterClear: boolean;
}

// ─── Runtime view of the world (read by the renderer, never written) ───────────────────────────
export type HeroAnim = "stand" | "walk" | "attack" | "spin" | "cast" | "dodge" | "hurt" | "dead" | "raise";
export interface HeroView {
  x: number; y: number; facing: Dir4; anim: HeroAnim; animTime: number;
  /** Which swing of the combo (1..4) during "attack". */
  combo: number;
  invulnerable: boolean;
  flash: number;
  charge: number;
  /** While anim === "raise": the item held overhead (an item id, or "gold"). */
  raiseItem?: string | null;
}
export type ActorAnim = "idle" | "walk" | "windup" | "attack" | "hurt" | "dead" | "special";
export interface ActorView {
  id: number; kind: "monster" | "npc" | "follower";
  def: string; sprite: string;
  x: number; y: number; z: number; facing: Dir4;
  anim: ActorAnim; animTime: number;
  flash: number; elite: boolean; radius: number;
  /** 0..1 fade for death dissolve. */
  alpha: number;
  marker?: "!" | "?" | "...";
  /** Bosses: current phase (1..n). */
  phase?: number;
  /** NPCs: this actor is the speaker of the open dialog (the renderer may play its "talk" pose). */
  talking?: boolean;
}
export interface PickupView { id: number; kind: "coin" | "item"; item?: string; x: number; y: number; z: number; age: number }
export interface ProjectileView { id: number; kind: "emberBolt" | "frostRing" | "thorn" | "web" | "spore" | "thornLine"; x: number; y: number; r: number; age: number; hostile: boolean; angle: number }
export interface WorldView {
  mapId: MapId;
  hero: HeroView;
  actors: readonly ActorView[];
  pickups: readonly PickupView[];
  projectiles: readonly ProjectileView[];
  /** Ids of stateful props that are gone (cut grass, broken pots) on this map visit. */
  removedProps: ReadonlySet<string>;
  openChests: ReadonlySet<string>;
  openGates: ReadonlySet<string>;
  night: boolean;
  /** 0 day … 1 night, animated across a rest. */
  dusk: number;
  time: number;
  /** Story flags, read-only (e.g. wardstoneLit picks the lit wardstone). */
  flags: Readonly<Record<string, boolean>>;
}

// ─── Sim → view/engine events ──────────────────────────────────────────────────────────────────
export type SimEvent =
  | { t: "swing"; x: number; y: number; facing: Dir4; combo: number; spin?: boolean }
  | { t: "hit"; x: number; y: number; amount: number; crit: boolean; target: "monster" | "hero"; kind: "slash" | "magic" | "contact" }
  | { t: "miss"; x: number; y: number; target: "monster" | "hero" }
  | { t: "die"; x: number; y: number; sprite: string; big: boolean }
  | { t: "cut"; x: number; y: number; prop: PropKind }
  | { t: "pickup"; x: number; y: number; kind: "coin" | "item"; amount: number; item?: string }
  | { t: "chest"; x: number; y: number; item: string | null; gold: number }
  | { t: "cast"; spell: SpellId; x: number; y: number }
  | { t: "impact"; x: number; y: number; kind: ProjectileView["kind"] }
  | { t: "levelUp"; level: number }
  | { t: "unlock"; skill?: SkillId; spell?: SpellId }
  | { t: "heal"; x: number; y: number; hp: number; mp: number }
  | { t: "dodge"; x: number; y: number }
  | { t: "step"; surface: "grass" | "stone" | "wood" | "dirt" | "water" | "cave" }
  | { t: "shake"; strength: number; ms: number }
  | { t: "hitstop"; ms: number }
  | { t: "map"; map: MapId }
  | { t: "gate"; id: string; open: boolean }
  | { t: "rest" }
  | { t: "sfx"; cue: string; x?: number; y?: number }
  | { t: "music"; id: MusicId };

// ─── Engine → host events ──────────────────────────────────────────────────────────────────────
export type Phase = "loading" | "title" | "playing" | "dialog" | "menu" | "paused" | "dead" | "clear";
export type EngineEvent =
  | { type: "phase"; phase: Phase }
  | { type: "sfx"; cue: string; pan: number; gain?: number }
  | { type: "music"; id: MusicId }
  | { type: "save"; reason: "map" | "rest" | "slot" | "clear" | "story"; state: SaveState }
  | { type: "rumble"; strong: number; weak: number; ms: number };

// ─── HUD and modal snapshot (React reads this every frame) ─────────────────────────────────────
export interface QuestCard { quest: string; title: string; summary: string; objective: string; reward: string; hint?: string; mode: "offer" | "complete" | "info" }
export type Modal =
  | { kind: "none" }
  | { kind: "dialog"; speaker: string; text: string; portrait?: string; choices: string[] | null; index: number; total: number }
  | { kind: "questCard"; card: QuestCard }
  | { kind: "shop"; shop: string }
  | { kind: "status" }
  | { kind: "items" }
  | { kind: "map" }
  | { kind: "pause" }
  | { kind: "unlock"; title: string; hint: string }
  | { kind: "dead" }
  | { kind: "clear" };

export interface HudSnapshot {
  phase: Phase;
  loading: number;
  heroName: string;
  level: number;
  xp: { value: number; next: number };
  hp: { value: number; max: number };
  mp: { value: number; max: number };
  gold: number;
  /** 0..1 charge of a held attack (spin threshold at 1). */
  charge: number;
  spell: { id: SpellId; name: string; mp: number; icon: string; ready: boolean } | null;
  buffs: Array<{ id: BuffId; seconds: number }>;
  ticker: { main: string | null; side: string | null };
  /** Objective arrow: screen angle in radians (0 = right, +π/2 = down) when the target is off
   *  screen or in another map; null when there is no target or it is visible. */
  arrow: { angle: number; label: string } | null;
  prompt: { label: string; x: number; y: number } | null;
  modal: Modal;
  notices: Array<{ id: number; text: string; kind: "info" | "gold" | "item" | "quest" | "warning" }>;
  mapName: string;
  night: boolean;
  device: Device;
  /** Visible monsters with HP bars only for bosses. */
  boss: { name: string; hp: number; max: number; phase: number } | null;
}

// ─── Commands from the host ────────────────────────────────────────────────────────────────────
export type GameCommand =
  | { type: "newGame"; heroName: string; seed?: number }
  | { type: "load"; state: SaveState }
  | { type: "menu"; command: MenuCommand }
  | { type: "openModal"; modal: "status" | "items" | "map" | "pause" }
  | { type: "closeModal" }
  | { type: "buy"; shop: string; item: string }
  | { type: "sell"; item: string }
  | { type: "equip"; item: string }
  | { type: "unequip"; slot: Slot }
  | { type: "use"; item: string }
  | { type: "selectSpell"; spell: SpellId }
  | { type: "retry" }
  | { type: "setDevice"; device: Device }
  | { type: "setReducedMotion"; reduced: boolean };

export interface GameHandle {
  readonly ready: Promise<void>;
  frame(dtSeconds: number, input: InputFrame): void;
  render(): void;
  resize(cssWidth: number, cssHeight: number, pixelRatio: number): void;
  setPaused(paused: boolean): void;
  snapshot(): HudSnapshot;
  drainEvents(): EngineEvent[];
  command(command: GameCommand): void;
  /** Current durable state, for manual slots. */
  save(): SaveState;
  destroy(): void;
}
export interface CreateGameOptions { save?: SaveState | null; reducedMotion?: boolean; assetBase?: string }
export type CreateGame = (canvas: HTMLCanvasElement, options: CreateGameOptions) => GameHandle;

// ─── Art atlas (written by the art pipeline, read by the renderer) ────────────────────────────
/**
 * `public/games/game-05/art/atlas.json`. Every image is lossless WebP or PNG at 1x art pixels.
 * Frames are cells of `w × h` in a row-major grid; `anchor` is the foot point inside a cell.
 * A directional animation lists frame indices per direction; a missing `right` means "mirror
 * `left`". Static sprites (props, buildings) are single-frame sheets.
 */
export interface AtlasAnim {
  frames: number[] | Partial<Record<Dir4, number[]>>;
  /** Frames per second; 0 = hold the first frame. */
  fps: number;
  loop: boolean;
}
export interface AtlasSheet {
  image: string;
  w: number;
  h: number;
  anchor: Vec;
  anims: Record<string, AtlasAnim>;
  /** Optional per-sheet shadow ellipse (width, height) under the anchor; 0 = none. */
  shadow?: [number, number];
  /** Props only: collision footprint relative to the anchor, in px. */
  solid?: Rect | { r: number };
  /** Props only: the part above this y (relative to anchor) is a canopy that fades over the hero. */
  canopyAbove?: number;
  /** Emits light (props; the renderer also honours it on actor sheets such as a glowing spirit). */
  light?: { radius: number; color: string; flicker?: boolean; dy?: number };
}
export interface Atlas {
  version: 1;
  sheets: Record<string, AtlasSheet>;
  /** Ground material swatches: key → image of one seamless 32×32 tile (or a row of variants). */
  ground: Record<string, { image: string; variants: number }>;
  /** Item and UI icons: key → image (16×16 or 24×24). */
  icons: Record<string, string>;
  portraits: Record<string, string>;
}

// ─── View seam ─────────────────────────────────────────────────────────────────────────────────
export interface ViewOptions { assetBase: string; reducedMotion: boolean; onProgress?: (fraction: number) => void }
export interface ViewApi {
  readonly ready: Promise<void>;
  /** Load (or switch to) a map. The view builds its tile cache from the MapDef. */
  setMap(map: MapDef): void;
  resize(cssWidth: number, cssHeight: number, pixelRatio: number): void;
  /** Visual events from the last sim steps (particles, numbers, shake, hit-stop visuals). */
  onEvents(events: readonly SimEvent[]): void;
  /** Advance visual time; alpha = interpolation between the last two sim steps. */
  update(world: WorldView, dtSeconds: number, alpha: number): void;
  render(): void;
  /** World px → CSS px on the canvas (for DOM prompts and arrows). */
  project(x: number, y: number): { x: number; y: number; visible: boolean };
  /** The visible world rectangle in world px. */
  viewRect(): Rect;
  /** Optional: switch screen shake and flashes off or on mid-session. */
  setReducedMotion?(reduced: boolean): void;
  dispose(): void;
}
export type CreateView = (canvas: HTMLCanvasElement, options: ViewOptions) => ViewApi;
