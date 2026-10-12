import type { Stats } from "../contract";

/**
 * Hero level table (DIRECTION.md, "Hero rules"). Monsters read the same table at their own level
 * and scale it with their species multipliers (see monsters.ts `monsterStats`).
 *
 *   HP  = round(18 × 1.12^(L−1))      MP  = 6 + 2L
 *   ATK = round(6 × 1.10^(L−1))       DEF = round(5 × 1.10^(L−1))
 *   SPD = round(8 × 1.08^(L−1))       XP to the next level = 8L² + 16L
 *
 * No stat points: stats come from this table plus gear. Full heal on level-up.
 */
export const LEVEL_CAP = 30;

/** Base stats at `level` (clamped to 1..LEVEL_CAP). */
export function statsAt(level: number): Stats {
  const L = Math.min(LEVEL_CAP, Math.max(1, Math.floor(level)));
  return {
    hp: Math.round(18 * Math.pow(1.12, L - 1)),
    mp: 6 + 2 * L,
    atk: Math.round(6 * Math.pow(1.1, L - 1)),
    def: Math.round(5 * Math.pow(1.1, L - 1)),
    spd: Math.round(8 * Math.pow(1.08, L - 1)),
  };
}

/** XP needed to go from `level` to `level + 1` (XP resets on level-up). 0 at the cap. */
export function XP_TO_NEXT(level: number): number {
  const L = Math.max(1, Math.floor(level));
  if (L >= LEVEL_CAP) return 0;
  return 8 * L * L + 16 * L;
}

/** LEVELS[L] = base stats at level L. Index 0 is unused and repeats level 1 so lookups never fail. */
export const LEVELS: Stats[] = Array.from({ length: LEVEL_CAP + 1 }, (_, i) => statsAt(Math.max(1, i)));

/** Total XP earned from a fresh level-1 hero to reach `level` (for tuning and tests). */
export function xpTotalTo(level: number): number {
  let sum = 0;
  for (let L = 1; L < Math.min(level, LEVEL_CAP); L++) sum += XP_TO_NEXT(L);
  return sum;
}
