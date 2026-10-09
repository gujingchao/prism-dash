import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core/rng';
import { generatePattern, rowSpacing } from '../src/game/spawner';

describe('Rng', () => {
  it('is deterministic for a given seed', () => {
    const a = new Rng(42);
    const b = new Rng(42);
    for (let i = 0; i < 100; i++) expect(a.next()).toBe(b.next());
  });

  it('stays in [0, 1)', () => {
    const r = new Rng(7);
    for (let i = 0; i < 10_000; i++) {
      const v = r.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe('spawner', () => {
  it('never walls off all three lanes', () => {
    const rng = new Rng(123);
    for (let i = 0; i < 20_000; i++) {
      const difficulty = (i % 100) / 99;
      const row = generatePattern(rng, difficulty);
      const byDz = new Map<number, Set<number>>();
      for (const s of row) {
        if (s.kind !== 'block') continue;
        if (!byDz.has(s.dz)) byDz.set(s.dz, new Set());
        byDz.get(s.dz)!.add(s.lane);
      }
      for (const lanes of byDz.values()) expect(lanes.size).toBeLessThan(3);
    }
  });

  it('never stacks a block on top of a barrier in the same lane and row', () => {
    const rng = new Rng(9);
    for (let i = 0; i < 5_000; i++) {
      const row = generatePattern(rng, 1);
      for (const s of row.filter((r) => r.kind === 'barrier')) {
        expect(row.some((o) => o.kind === 'block' && o.lane === s.lane && o.dz === s.dz)).toBe(false);
      }
    }
  });

  it('every pattern fits inside the tightest row spacing', () => {
    const rng = new Rng(5);
    const minSpacing = rowSpacing(1);
    for (let i = 0; i < 5_000; i++) {
      for (const s of generatePattern(rng, Math.random())) expect(-s.dz).toBeLessThan(minSpacing);
    }
  });
});
