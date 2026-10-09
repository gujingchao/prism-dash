import type { Rng } from '../core/rng';
import type { Kind } from './types';

export interface SpawnSpec {
  kind: Kind;
  lane: number;
  /** Offset along Z from the row origin (negative = further away). */
  dz: number;
  high?: boolean;
}

export const LANES = [-1, 0, 1] as const;

/** Distance between obstacle rows; tightens as the run speeds up. */
export function rowSpacing(difficulty: number): number {
  return 30 - 12 * difficulty;
}

/**
 * Generates one row of obstacles/pickups. Invariant (covered by tests): a row never blocks all
 * three lanes with walls, so there is always a path — dodge into a free lane or jump a barrier.
 */
export function generatePattern(rng: Rng, difficulty: number): SpawnSpec[] {
  const out: SpawnSpec[] = [];
  const roll = rng.next();

  if (roll < 0.14 + difficulty * 0.08) {
    // Full-width low barrier: must jump. Sometimes a gem floats at jump apex as a reward.
    for (const lane of LANES) out.push({ kind: 'barrier', lane, dz: 0 });
    if (rng.chance(0.6)) out.push({ kind: 'gem', lane: rng.pick(LANES), dz: 0, high: true });
  } else if (roll < 0.32) {
    // Gem trail, optionally guarded by a block in another lane.
    const lane = rng.pick(LANES);
    const n = 4 + rng.int(3);
    for (let i = 0; i < n; i++) out.push({ kind: 'gem', lane, dz: -i * 3 });
    if (difficulty > 0.25 && rng.chance(0.5)) {
      const others = LANES.filter((l) => l !== lane);
      out.push({ kind: 'block', lane: rng.pick(others), dz: -(n - 1) * 1.5 });
    }
  } else {
    // Wall row: one or two lanes blocked.
    const lanes = rng.shuffle([...LANES]);
    const blocked = rng.chance(0.3 + difficulty * 0.45) ? 2 : 1;
    for (let i = 0; i < blocked; i++) out.push({ kind: 'block', lane: lanes[i], dz: 0 });
    for (const lane of lanes.slice(blocked)) {
      if (difficulty > 0.35 && rng.chance(0.25)) out.push({ kind: 'barrier', lane, dz: 0 });
      else if (rng.chance(0.45)) out.push({ kind: 'gem', lane, dz: 0 });
    }
  }

  // Rare shield power-up, placed in a lane that holds no wall in this row.
  if (rng.chance(0.03)) {
    const free = LANES.filter((l) => !out.some((s) => s.lane === l && s.kind === 'block'));
    if (free.length > 0) out.push({ kind: 'shield', lane: rng.pick(free), dz: -10.5 });
  }

  return out;
}
