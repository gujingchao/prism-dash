import { CURVE_BEND, CURVE_DROP } from '../config';
import { DEG, clamp, damp, lookAt, mat4Identity, multiply, perspective, transformVec4, type Vec3 } from '../core/math';
import type { World } from '../game/world';

export interface ScreenPoint {
  x: number;
  y: number;
  /** Clip-space w (≈ view depth), useful for perspective sizing. */
  w: number;
}

/** Chase camera shared by both renderers so WebGL2 and Canvas2D frame the scene identically. */
export class Camera {
  readonly view = mat4Identity();
  readonly proj = mat4Identity();
  readonly viewProj = mat4Identity();
  readonly eye: Vec3 = [0, 3.4, 7.4];
  readonly target: Vec3 = [0, 0.8, -14];
  /** [x sway, y drop] coefficients for the curved-world bend, uploaded as a uniform. */
  readonly curve = new Float32Array([0, CURVE_DROP]);
  fov = 60 * DEG;
  aspect = 1;

  private smoothX = 0;
  private smoothY = 3.4;
  private readonly up: Vec3 = [0, 1, 0];
  private readonly clip = new Float32Array(4);

  update(world: World, aspect: number, dt: number): void {
    const p = world.player;
    this.aspect = aspect;
    const portrait = aspect < 1;

    // Keep at least ~52° horizontal FOV so all three lanes fit on tall phone screens.
    const fitWidth = 2 * Math.atan(Math.tan(26 * DEG) / aspect);
    const baseFov = clamp(Math.max(58 * DEG, fitWidth), 0, 95 * DEG);
    this.fov = damp(this.fov, baseFov + world.difficulty * 10 * DEG, 3, dt);

    this.smoothX = damp(this.smoothX, p.x * 0.55, 7, dt);
    this.smoothY = damp(this.smoothY, (portrait ? 5.2 : 3.3) + p.y * 0.35, 5, dt);
    const s = world.shake * world.shake * 0.4;
    this.eye[0] = this.smoothX + (Math.random() * 2 - 1) * s;
    this.eye[1] = this.smoothY + (Math.random() * 2 - 1) * s;
    this.eye[2] = portrait ? 6.6 : 7.4;
    this.target[0] = p.x * 0.3;
    this.target[1] = 0.8 + p.y * 0.25;
    this.target[2] = -14;

    this.curve[0] = Math.sin(world.distance * 0.0032) * CURVE_BEND;

    perspective(this.proj, this.fov, aspect, 0.1, 400);
    lookAt(this.view, this.eye, this.target, this.up);
    multiply(this.viewProj, this.proj, this.view);
  }

  /** CPU mirror of the GLSL `bend()` + projection; returns false when behind the camera. */
  project(x: number, y: number, z: number, width: number, height: number, out: ScreenPoint): boolean {
    const dz = z - this.eye[2];
    const d2 = dz * dz;
    const c = transformVec4(this.clip, this.viewProj, x + d2 * this.curve[0], y - d2 * this.curve[1], z, 1);
    const w = c[3];
    if (w < 0.05) return false;
    out.x = (c[0] / w * 0.5 + 0.5) * width;
    out.y = (0.5 - c[1] / w * 0.5) * height;
    out.w = w;
    return true;
  }
}
