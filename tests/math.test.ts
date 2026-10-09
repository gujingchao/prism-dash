import { describe, expect, it } from 'vitest';
import { DEG, lookAt, mat4Identity, multiply, perspective, rotateXYZ, transformVec4 } from '../src/core/math';

describe('math', () => {
  it('multiply by identity is a no-op', () => {
    const a = new Float32Array(16).map((_, i) => i + 1);
    const out = multiply(new Float32Array(16), a, mat4Identity());
    expect(Array.from(out)).toEqual(Array.from(a));
  });

  it('projects the look-at target to the centre of the screen', () => {
    const proj = perspective(new Float32Array(16), 60 * DEG, 16 / 9, 0.1, 100);
    const view = lookAt(new Float32Array(16), [1, 3, 7], [0, 1, -10], [0, 1, 0]);
    const vp = multiply(new Float32Array(16), proj, view);
    const c = transformVec4(new Float32Array(4), vp, 0, 1, -10);
    expect(c[0] / c[3]).toBeCloseTo(0, 5);
    expect(c[1] / c[3]).toBeCloseTo(0, 5);
    expect(c[2] / c[3]).toBeGreaterThan(-1);
    expect(c[2] / c[3]).toBeLessThan(1);
  });

  it('points behind the camera have negative w', () => {
    const proj = perspective(new Float32Array(16), 60 * DEG, 1, 0.1, 100);
    const view = lookAt(new Float32Array(16), [0, 0, 0], [0, 0, -1], [0, 1, 0]);
    const vp = multiply(new Float32Array(16), proj, view);
    expect(transformVec4(new Float32Array(4), vp, 0, 0, 5)[3]).toBeLessThan(0);
  });

  it('rotateXYZ applies Y rotation correctly', () => {
    const out = [0, 0, 0];
    rotateXYZ(out, 1, 0, 0, 0, Math.PI / 2, 0);
    expect(out[0]).toBeCloseTo(0);
    expect(out[2]).toBeCloseTo(-1);
  });
});
