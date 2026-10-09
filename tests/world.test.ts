import { describe, expect, it } from 'vitest';
import { FIXED_STEP, LANE_WIDTH } from '../src/config';
import { World } from '../src/game/world';

function emptyRun(): World {
  const w = new World(1);
  w.reset('playing', 1);
  w.entities.length = 0; // clear the pre-warmed track for isolated tests
  return w;
}

const run = (w: World, seconds: number): void => {
  for (let t = 0; t < seconds; t += FIXED_STEP) w.step(FIXED_STEP);
};

describe('World', () => {
  it('clamps lane changes to the three lanes', () => {
    const w = emptyRun();
    w.input('left');
    w.input('left');
    w.input('left');
    expect(w.player.lane).toBe(-1);
    run(w, 0.5);
    expect(w.player.x).toBeCloseTo(-LANE_WIDTH, 1);
  });

  it('jumps and lands back on the track', () => {
    const w = emptyRun();
    w.input('jump');
    run(w, 0.2);
    expect(w.player.y).toBeGreaterThan(1);
    run(w, 1.0);
    expect(w.player.y).toBe(0);
    expect(w.player.grounded).toBe(true);
    expect(w.events.some((e) => e.type === 'jump')).toBe(true);
    expect(w.events.some((e) => e.type === 'land')).toBe(true);
  });

  it('crashes into a block in the same lane and reaches game over', () => {
    const w = emptyRun();
    w.spawn('block', 0, -5);
    run(w, 1);
    expect(['dying', 'over']).toContain(w.state);
    run(w, 2);
    expect(w.state).toBe('over');
    expect(w.events.some((e) => e.type === 'gameOver')).toBe(true);
  });

  it('dodges a block by switching lanes', () => {
    const w = emptyRun();
    w.spawn('block', 0, -12);
    w.input('right');
    run(w, 1.5);
    expect(w.state).toBe('playing');
  });

  it('a shield absorbs one hit', () => {
    const w = emptyRun();
    w.player.shield = true;
    w.spawn('block', 0, -5);
    run(w, 1);
    expect(w.state).toBe('playing');
    expect(w.player.shield).toBe(false);
  });

  it('jumping clears a barrier', () => {
    const w = emptyRun();
    w.spawn('barrier', 0, -6);
    run(w, 0.2);
    w.input('jump');
    run(w, 1);
    expect(w.state).toBe('playing');
  });

  it('collecting gems builds a combo and adds score', () => {
    const w = emptyRun();
    for (let i = 0; i < 3; i++) w.spawn('gem', 0, -5 - i * 3);
    run(w, 1.5);
    expect(w.gems).toBe(3);
    expect(w.bestCombo).toBe(3);
    expect(w.score).toBeGreaterThanOrEqual(60);
  });

  it('is deterministic for the same seed and inputs', () => {
    const sim = (): number[] => {
      const w = new World(1);
      w.reset('playing', 77);
      const out: number[] = [];
      for (let i = 0; i < 600; i++) {
        if (i % 90 === 0) w.input(i % 180 === 0 ? 'left' : 'right');
        w.step(FIXED_STEP);
      }
      for (const e of w.entities) out.push(e.x, e.z, e.h);
      out.push(w.score, w.distance);
      return out;
    };
    expect(sim()).toEqual(sim());
  });
});
