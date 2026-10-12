/** Seeded mulberry32. The state lives in the save, so loot and AI replay exactly in tests. */
export class Rng {
  constructor(public state: number) {
    this.state = state >>> 0 || 0x9e3779b9;
  }
  /** Uniform in [0, 1). */
  next(): number {
    let t = (this.state = (this.state + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(low: number, high: number): number { return low + (high - low) * this.next(); }
  int(low: number, high: number): number { return Math.floor(this.range(low, high + 1)); }
  chance(p: number): boolean { return this.next() < p; }
  pick<T>(items: readonly T[]): T { return items[Math.min(items.length - 1, Math.floor(this.next() * items.length))]; }
  weighted<T>(items: readonly T[], weight: (item: T) => number): T | null {
    const total = items.reduce((sum, item) => sum + Math.max(0, weight(item)), 0);
    if (total <= 0) return null;
    let roll = this.next() * total;
    for (const item of items) { roll -= Math.max(0, weight(item)); if (roll < 0) return item; }
    return items[items.length - 1] ?? null;
  }
}
