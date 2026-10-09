import * as C from '../../config';
import { rotateXYZ } from '../../core/math';
import type { Color } from '../../game/types';
import type { ScreenPoint } from '../camera';
import { buildCube } from '../mesh';
import { PACKED_FLOATS } from '../particles';
import { collectBoxes, sunRadius, type BoxInstance, type FrameData, type Renderer } from '../scene';

const cube = buildCube();
const LIGHT = [0.35, 0.9, 0.4].map((v, _, a) => v / Math.hypot(a[0], a[1], a[2]));

const css = (c: Color, k = 1, a = 1): string =>
  `rgba(${Math.min(255, c[0] * k * 255) | 0},${Math.min(255, c[1] * k * 255) | 0},${Math.min(255, c[2] * k * 255) | 0},${a})`;

/**
 * Software-projected fallback renderer using only the Canvas 2D API. It shares the camera,
 * curved-world maths and draw list with the WebGL2 renderer, and does its own painter's-sort,
 * back-face culling, flat shading, fog and additive particles.
 */
export class CanvasRenderer implements Renderer {
  readonly name = 'Canvas2D';
  private readonly ctx: CanvasRenderingContext2D;
  private width = 1;
  private height = 1;
  private readonly boxes: BoxInstance[] = [];
  private readonly order: number[] = [];
  private readonly particleData = new Float32Array(4096 * PACKED_FLOATS);
  private readonly screen: ScreenPoint[] = Array.from({ length: 24 }, () => ({ x: 0, y: 0, w: 0 }));
  private readonly sp: ScreenPoint = { x: 0, y: 0, w: 0 };
  private readonly v = new Float32Array(3);
  private vignette?: CanvasGradient;

  constructor(readonly canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('Canvas 2D is not available');
    this.ctx = ctx;
  }

  resize(w: number, h: number): void {
    this.width = this.canvas.width = Math.max(1, w);
    this.height = this.canvas.height = Math.max(1, h);
    const r = Math.hypot(w, h) / 2;
    this.vignette = this.ctx.createRadialGradient(w / 2, h / 2, r * 0.35, w / 2, h / 2, r);
    this.vignette.addColorStop(0, 'rgba(0,0,0,0)');
    this.vignette.addColorStop(1, 'rgba(0,0,0,0.6)');
  }

  render(f: FrameData): void {
    const { ctx, width: W, height: H } = this;
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    this.drawSky(f);
    this.drawGround(f);
    this.drawBoxes(f);
    this.drawParticles(f);

    ctx.globalCompositeOperation = 'source-over';
    if (this.vignette) {
      ctx.fillStyle = this.vignette;
      ctx.fillRect(0, 0, W, H);
    }
    if (f.flash > 0.001) {
      ctx.fillStyle = css(f.flashColor, 1, f.flash);
      ctx.fillRect(0, 0, W, H);
    }
  }

  private drawSky(f: FrameData): void {
    const { ctx, width: W, height: H } = this;
    const sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, css(C.COLORS.skyTop));
    sky.addColorStop(0.75, css(C.COLORS.fog));
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);

    // Striped retro sun: a gradient disc with horizontal gaps cut out of the lower half.
    const sunY = H * (1 - (f.camera.aspect < 1 ? 0.64 : 0.66));
    const r = H * sunRadius(f.camera.aspect);
    ctx.save();
    ctx.beginPath();
    ctx.arc(W / 2, sunY, r, 0, Math.PI * 2);
    ctx.clip();
    const g = ctx.createLinearGradient(0, sunY - r, 0, sunY + r);
    g.addColorStop(0, '#ffe766');
    g.addColorStop(1, '#ff2e8c');
    ctx.fillStyle = g;
    ctx.fillRect(W / 2 - r, sunY - r, r * 2, r * 2);
    ctx.fillStyle = css(C.COLORS.fog);
    const band = r / 6.2;
    const scroll = (f.time * 0.35 * band) % band;
    for (let y = sunY + scroll; y < sunY + r; y += band) {
      const gap = Math.min(0.75, ((y - sunY) / r) * 0.26 * 3.2) * band;
      ctx.fillRect(W / 2 - r, y, r * 2, gap);
    }
    ctx.restore();
  }

  private drawGround(f: FrameData): void {
    const { ctx, width: W, height: H, sp } = this;
    const cam = f.camera;
    const fogAt = (z: number): number => Math.min(1, Math.max(0, (cam.eye[2] - z - C.FOG_NEAR) / (C.FOG_FAR - C.FOG_NEAR)));

    // Ground strips from far to near so nearer strips cover the bent horizon.
    const zs: number[] = [];
    for (let z = C.SPAWN_Z; z <= 12; z += 6) zs.push(z);
    for (let i = 0; i < zs.length - 1; i++) {
      const quad: number[] = [];
      for (const [x, z] of [[-70, zs[i]], [70, zs[i]], [70, zs[i + 1]], [-70, zs[i + 1]]]) {
        if (!cam.project(x, 0, z, W, H, sp)) break;
        quad.push(sp.x, sp.y);
      }
      if (quad.length < 8) continue;
      const fz = fogAt(zs[i]);
      ctx.fillStyle = css(mix([0.03, 0.005, 0.06], C.COLORS.fog, fz));
      ctx.beginPath();
      ctx.moveTo(quad[0], quad[1]);
      for (let k = 2; k < 8; k += 2) ctx.lineTo(quad[k], quad[k + 1]);
      ctx.closePath();
      ctx.fill();
    }

    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    const half = C.TRACK_HALF_WIDTH;

    // Magenta outer grid on both sides of the track.
    const gridOffset = f.world.distance % 6;
    for (let z = gridOffset - 6 * 20; z < 8; z += 6) {
      const a = 1 - fogAt(z);
      if (a <= 0.02) continue;
      ctx.strokeStyle = css(C.COLORS.grid, 1, a * 0.5);
      for (const [x0, x1] of [[-70, -half], [half, 70]]) {
        if (!cam.project(x0, 0, z, W, H, sp)) continue;
        const sx = sp.x, sy = sp.y;
        if (!cam.project(x1, 0, z, W, H, sp)) continue;
        ctx.lineWidth = Math.max(1, 40 / sp.w);
        line(ctx, sx, sy, sp.x, sp.y);
      }
    }
    for (let x = 6; x <= 66; x += 6) {
      for (const sx of [-x, x]) {
        let px = 0, py = 0, has = false;
        for (let z = C.SPAWN_Z; z <= 12; z += 12) {
          if (!cam.project(sx, 0, z, W, H, sp)) { has = false; continue; }
          if (has) {
            ctx.strokeStyle = css(C.COLORS.grid, 1, (1 - fogAt(z - 6)) * 0.5);
            ctx.lineWidth = Math.max(1, 40 / sp.w);
            line(ctx, px, py, sp.x, sp.y);
          }
          px = sp.x; py = sp.y; has = true;
        }
      }
    }

    // Scrolling cross lines.
    const offset = f.world.distance % 4;
    for (let z = offset - 4 * 30; z < 8; z += 4) {
      const a = 1 - fogAt(z);
      if (a <= 0.02) continue;
      if (!cam.project(-half, 0, z, W, H, sp)) continue;
      const x0 = sp.x, y0 = sp.y;
      if (!cam.project(half, 0, z, W, H, sp)) continue;
      ctx.strokeStyle = css(C.COLORS.lane, 1, a * 0.35);
      ctx.lineWidth = Math.max(1, 30 / sp.w);
      line(ctx, x0, y0, sp.x, sp.y);
    }

    // Lane dividers (dashed) and glowing track edges, as polylines so they follow the bend.
    const dash = f.world.distance % 3;
    for (const x of [-half, -C.LANE_WIDTH / 2, C.LANE_WIDTH / 2, half]) {
      const edge = Math.abs(x) === half;
      for (let z = C.SPAWN_Z + dash; z < 8; z += 3) {
        const z1 = edge ? z + 3 : z + 1.65;
        const a = 1 - fogAt(z);
        if (a <= 0.02 || !cam.project(x, 0, z, W, H, sp)) continue;
        const x0 = sp.x, y0 = sp.y;
        if (!cam.project(x, 0, z1, W, H, sp)) continue;
        ctx.strokeStyle = css(C.COLORS.lane, edge ? 1.3 : 1, a * (edge ? 1 : 0.7));
        ctx.lineWidth = Math.max(1, (edge ? 120 : 50) / sp.w);
        line(ctx, x0, y0, sp.x, sp.y);
      }
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  private drawBoxes(f: FrameData): void {
    const { ctx, width: W, height: H, screen, v } = this;
    const cam = f.camera;
    const n = collectBoxes(f.world, f.time, this.boxes);

    // Painter's algorithm: far → near.
    const order = this.order;
    order.length = n;
    for (let i = 0; i < n; i++) order[i] = i;
    order.sort((a, b) => this.boxes[a].z - this.boxes[b].z);

    for (const idx of order) {
      const b = this.boxes[idx];
      const dist = cam.eye[2] - b.z;
      const fog = Math.min(1, Math.max(0, (dist - C.FOG_NEAR) / (C.FOG_FAR - C.FOG_NEAR)));
      if (fog >= 0.98) continue;

      let ok = true;
      for (let i = 0; i < 24; i++) {
        const p = cube.positions;
        rotateXYZ(v, p[i * 3] * b.sx, p[i * 3 + 1] * b.sy, p[i * 3 + 2] * b.sz, b.rx, b.ry, b.rz);
        if (!cam.project(v[0] + b.x, v[1] + b.y, v[2] + b.z, W, H, screen[i])) { ok = false; break; }
      }
      if (!ok) continue;

      const edgeColor = css(mix(b.color, C.COLORS.fog, fog), 1.2 + b.glow * 0.3);
      for (let face = 0; face < 6; face++) {
        const s0 = screen[face * 4], s1 = screen[face * 4 + 1], s2 = screen[face * 4 + 2], s3 = screen[face * 4 + 3];
        // Screen-space back-face culling via signed area.
        const area = (s1.x - s0.x) * (s2.y - s0.y) - (s2.x - s0.x) * (s1.y - s0.y);
        if (area >= 0) continue;
        const nn = cube.normals;
        rotateXYZ(v, nn[face * 12], nn[face * 12 + 1], nn[face * 12 + 2], b.rx, b.ry, b.rz);
        const diff = 0.35 + 0.65 * Math.max(0, v[0] * LIGHT[0] + v[1] * LIGHT[1] + v[2] * LIGHT[2]);
        ctx.beginPath();
        ctx.moveTo(s0.x, s0.y);
        ctx.lineTo(s1.x, s1.y);
        ctx.lineTo(s2.x, s2.y);
        ctx.lineTo(s3.x, s3.y);
        ctx.closePath();
        ctx.fillStyle = css(mix(b.color.map((c) => c * 0.22 * diff) as unknown as Color, C.COLORS.fog, fog));
        ctx.fill();
        ctx.strokeStyle = edgeColor;
        ctx.lineWidth = Math.max(1, 70 / s0.w);
        ctx.stroke();
      }
    }
  }

  private drawParticles(f: FrameData): void {
    const { ctx, width: W, height: H, sp } = this;
    const n = f.particles.pack(this.particleData);
    const d = this.particleData;
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < n; i++) {
      const o = i * PACKED_FLOATS;
      if (!f.camera.project(d[o], d[o + 1], d[o + 2], W, H, sp)) continue;
      const size = Math.min(40, (d[o + 7] * H * 0.45) / sp.w);
      if (size < 0.5) continue;
      ctx.fillStyle = `rgba(${(d[o + 3] * 255) | 0},${(d[o + 4] * 255) | 0},${(d[o + 5] * 255) | 0},${d[o + 6]})`;
      ctx.fillRect(sp.x - size / 2, sp.y - size / 2, size, size);
    }
  }
}

function mix(a: Color, b: Color, t: number): Color {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

function line(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number): void {
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();
}
