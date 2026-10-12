/**
 * Art lookups for the host UI: item icons, portraits and the hero sheet for the paper doll come
 * from the art atlas (`/games/game-05/art/atlas.json`, contract `Atlas`); anything missing falls
 * back to the UI sheet drawn by ui-src/build_ui.py (`/games/game-05/ui/icons.png`).
 */
export interface HeroFrame { image: string; x: number; y: number; w: number; h: number; anchorY: number }
export interface UiAssets {
  base: string;
  icons: Record<string, string>;
  portraits: Record<string, string>;
  fallback: Record<string, number>;
  fallbackCols: number;
  hero: HeroFrame | null;
}

export const EMPTY_ASSETS: UiAssets = { base: "/games/game-05", icons: {}, portraits: {}, fallback: {}, fallbackCols: 8, hero: null };

type AtlasJson = {
  sheets?: Record<string, { image?: string; w?: number; h?: number; anchor?: { x: number; y: number }; anims?: Record<string, { frames?: unknown }> }>;
  icons?: Record<string, string>;
  portraits?: Record<string, string>;
};

const safePath = (value: unknown): value is string => typeof value === "string" && value.length < 300 && !value.includes("..") && !/^[a-z]+:/i.test(value);

async function json<T>(url: string): Promise<T | null> {
  try {
    const response = await fetch(url, { cache: "force-cache" });
    return response.ok ? await response.json() as T : null;
  } catch { return null; }
}

/** Frames, badges and glyphs drawn by ui-src/build_ui.py; CSS uses them as border-images and
 *  backgrounds, which browsers only fetch on first use, so they are loaded before the title. */
const UI_IMAGES = [
  "advance", "arrows", "badge-level", "badge-main", "badge-side", "crest", "crystal", "frame-bar", "frame-btn-on", "frame-btn",
  "frame-dark", "frame-hud", "frame-paper", "frame-plate", "frame-select", "frame-slot-light", "frame-slot", "frame-tab-on",
  "frame-tab", "icons", "pad-a", "pad-b", "pad-x", "pad-y", "paper-grain", "pointer", "stick-base", "tombstone",
  "touch-22-on", "touch-22", "touch-30-on", "touch-30", "touch-40-on", "touch-40",
];
const held: HTMLImageElement[] = [];
function preload(src: string): Promise<void> {
  return new Promise(resolve => {
    const img = new Image();
    held.push(img);
    img.onload = () => { void img.decode?.().catch(() => {}).then(() => resolve()); };
    img.onerror = () => resolve();
    img.src = src;
  });
}
/** Resolves once the UI frames are in the image cache (or after `capMs`, whichever is first). */
export function preloadUi(base = "/games/game-05", capMs = 5000): Promise<void> {
  const all = Promise.all(UI_IMAGES.map(name => preload(`${base}/ui/${name}.png`))).then(() => undefined);
  return Promise.race([all, new Promise<void>(resolve => setTimeout(resolve, capMs))]);
}

function imageSize(src: string): Promise<{ w: number; h: number } | null> {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

export async function loadUiAssets(base = "/games/game-05"): Promise<UiAssets> {
  const [atlas, index] = await Promise.all([
    json<AtlasJson>(`${base}/art/atlas.json`),
    json<{ cols?: number; icons?: Record<string, number> }>(`${base}/ui/icons.json`),
  ]);
  const artBase = `${base}/art/`;
  const resolve = (path: string) => path.startsWith("/") ? path : artBase + path;
  const icons: Record<string, string> = {};
  const portraits: Record<string, string> = {};
  for (const [key, path] of Object.entries(atlas?.icons ?? {})) if (safePath(path)) icons[key] = resolve(path);
  for (const [key, path] of Object.entries(atlas?.portraits ?? {})) if (safePath(path)) portraits[key] = resolve(path);
  let hero: HeroFrame | null = null;
  const sheet = atlas?.sheets?.hero;
  if (sheet && safePath(sheet.image) && sheet.w && sheet.h) {
    const src = resolve(sheet.image);
    const size = await imageSize(src);
    const frames = sheet.anims?.stand?.frames;
    const list = Array.isArray(frames) ? frames : (frames as Record<string, number[]> | undefined)?.down;
    const index0 = Array.isArray(list) && typeof list[0] === "number" ? list[0] : 0;
    if (size) {
      const cols = Math.max(1, Math.floor(size.w / sheet.w));
      hero = { image: src, x: (index0 % cols) * sheet.w, y: Math.floor(index0 / cols) * sheet.h, w: sheet.w, h: sheet.h, anchorY: sheet.anchor?.y ?? sheet.h };
    }
  }
  // Warm the cache for the item icons and portraits the menus show (no need to wait for them).
  for (const src of [...Object.values(icons), ...Object.values(portraits)]) void preload(src);
  return {
    base, icons, portraits, hero,
    fallback: index?.icons ?? {},
    fallbackCols: index?.cols ?? 8,
  };
}

/** Normalise an icon key: "icon.herb" / "herb" / "icon.spell.emberBolt" / "spell.emberBolt". */
export function iconKeys(id: string): { atlas: string; fallback: string } {
  const bare = id.startsWith("icon.") ? id.slice(5) : id;
  return { atlas: `icon.${bare}`, fallback: bare };
}

export function portraitSrc(assets: UiAssets, key: string | undefined): string | null {
  if (!key) return null;
  const bare = key.startsWith("portrait.") ? key.slice(9) : key;
  return assets.portraits[`portrait.${bare}`] ?? assets.portraits[bare] ?? null;
}
