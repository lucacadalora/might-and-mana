import type { SkillDef } from "../contract";

/**
 * Sword skills unlocked by level (DIRECTION "Unlocks"): 2-hit combo at L1, 3-hit at L3, charged
 * spin at L5, 4-hit at L6 (the last hit launches). The sim shows `name` as the banner title and
 * `hint` under it on the level-up that unlocks the skill (combo2 comes with the blade, no banner).
 * Hints name the Attack action, not a key, so they read right on keyboard, pad and touch.
 *
 * Combo timing (DIRECTION): the next tap chains when it lands 0.10–0.38 s after the previous swing
 * starts; early taps buffer, late taps restart the chain. Hits 3 and 4 do 1.2× and 1.5×.
 */
export const SKILLS: SkillDef[] = [
  { id: "combo2", level: 1, name: "Double Cut", hint: "Tap Attack twice in rhythm to cut twice." },
  { id: "combo3", level: 3, name: "Triple Cut", hint: "Tap Attack in rhythm: the third cut hits harder." },
  { id: "spin", level: 5, name: "Charged Spin", hint: "Hold Attack until the bar fills, then let go to spin." },
  { id: "combo4", level: 6, name: "Rising Finish", hint: "Four taps in rhythm: the last cut launches the foe." },
];

/** Longest combo available at `level` (1..4). */
export function comboAt(level: number): number {
  let n = 1;
  for (const s of SKILLS) {
    if (level < s.level) continue;
    if (s.id === "combo2") n = Math.max(n, 2);
    if (s.id === "combo3") n = Math.max(n, 3);
    if (s.id === "combo4") n = Math.max(n, 4);
  }
  return n;
}
