import type { Color } from '../game/types';

// Struct-of-floats layout in one Float32Array: no per-particle objects, no GC churn.
const STRIDE = 12; // x y z | vx vy vz | life maxLife | r g b | size
export const PACKED_FLOATS = 8; // x y z | r g b a | size  (GPU vertex layout)

export class Particles {
  count = 0;
  private readonly data: Float32Array;

  constructor(readonly capacity = 3000) {
    this.data = new Float32Array(capacity * STRIDE);
  }

  emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, color: Color, size: number): void {
    if (this.count >= this.capacity) return;
    const d = this.data;
    const o = this.count++ * STRIDE;
    d[o] = x; d[o + 1] = y; d[o + 2] = z;
    d[o + 3] = vx; d[o + 4] = vy; d[o + 5] = vz;
    d[o + 6] = life; d[o + 7] = life;
    d[o + 8] = color[0]; d[o + 9] = color[1]; d[o + 10] = color[2];
    d[o + 11] = size;
  }

  burst(x: number, y: number, z: number, n: number, color: Color, speed: number, size: number, life = 0.8): void {
    for (let i = 0; i < n; i++) {
      // Uniform direction on the unit sphere.
      const u = Math.random() * 2 - 1;
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(1 - u * u);
      const s = speed * (0.3 + Math.random() * 0.7);
      this.emit(x, y, z, Math.cos(a) * r * s, Math.abs(u) * s * 0.8 + s * 0.2, Math.sin(a) * r * s,
        life * (0.6 + Math.random() * 0.4), color, size * (0.6 + Math.random() * 0.6));
    }
  }

  /** `worldSpeed` carries every particle towards the camera with the track. */
  update(dt: number, worldSpeed: number): void {
    const d = this.data;
    const drag = Math.exp(-1.8 * dt);
    for (let i = 0; i < this.count; i++) {
      const o = i * STRIDE;
      d[o + 6] -= dt;
      if (d[o + 6] <= 0) {
        // Swap-remove with the last live particle.
        const last = --this.count * STRIDE;
        d.copyWithin(o, last, last + STRIDE);
        i--;
        continue;
      }
      d[o + 4] -= 9 * dt;
      d[o + 3] *= drag; d[o + 4] *= drag; d[o + 5] *= drag;
      d[o] += d[o + 3] * dt;
      d[o + 1] += d[o + 4] * dt;
      d[o + 2] += (d[o + 5] + worldSpeed) * dt;
      if (d[o + 1] < 0) { d[o + 1] = 0; d[o + 4] *= -0.4; }
    }
  }

  /** Writes the GPU-ready interleaved layout; returns the number of particles written. */
  pack(out: Float32Array): number {
    const d = this.data;
    const n = Math.min(this.count, out.length / PACKED_FLOATS);
    for (let i = 0; i < n; i++) {
      const o = i * STRIDE;
      const p = i * PACKED_FLOATS;
      const a = d[o + 6] / d[o + 7];
      out[p] = d[o]; out[p + 1] = d[o + 1]; out[p + 2] = d[o + 2];
      out[p + 3] = d[o + 8]; out[p + 4] = d[o + 9]; out[p + 5] = d[o + 10];
      out[p + 6] = a;
      out[p + 7] = d[o + 11] * (0.4 + 0.6 * a);
    }
    return n;
  }
}
