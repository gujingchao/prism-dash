import * as C from '../config';
import type { Color } from '../game/types';
import type { World } from '../game/world';
import type { Camera } from './camera';
import type { Particles } from './particles';

export interface FrameData {
  world: World;
  camera: Camera;
  particles: Particles;
  time: number;
  /** 0..1 full-screen flash (crash / shield break). */
  flash: number;
  flashColor: Color;
  /** Chromatic aberration strength. */
  aberration: number;
}

export interface Renderer {
  readonly name: string;
  readonly canvas: HTMLCanvasElement;
  resize(pixelWidth: number, pixelHeight: number): void;
  render(frame: FrameData): void;
}

/** Sun radius as a fraction of screen height; shrinks on tall screens so it never fills the width. */
export function sunRadius(aspect: number): number {
  return 0.26 * Math.min(1, aspect * 1.25);
}

/** Renderer-agnostic draw item; both backends consume the same list. */
export interface BoxInstance {
  x: number; y: number; z: number;
  rx: number; ry: number; rz: number;
  sx: number; sy: number; sz: number;
  color: Color;
  glow: number;
}

/**
 * Converts world state into box instances (entities + the player ship). Shared by both
 * renderers so visuals stay in sync. Returns the number of items written into `out`.
 */
export function collectBoxes(world: World, time: number, out: BoxInstance[]): number {
  let n = 0;
  const next = (): BoxInstance => (out[n] ??= {
    x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0, sx: 1, sy: 1, sz: 1, color: C.COLORS.block, glow: 0,
  });

  for (const e of world.entities) {
    const b = next(); n++;
    b.x = e.x; b.y = e.y; b.z = e.z;
    b.rx = e.rotX; b.ry = e.rotY; b.rz = 0;
    b.sx = e.w; b.sy = e.h; b.sz = e.d;
    // Gems bob gently so they read as pickups rather than obstacles.
    if (e.kind === 'gem' || e.kind === 'shield') b.y += Math.sin(time * 4 + e.z * 0.3) * 0.12;
    b.color = e.color;
    b.glow = e.glow;
  }

  const p = world.player;
  const blink = p.invuln > 0 && Math.floor(time * 20) % 2 === 0;
  if (p.alive && !blink) {
    const hover = p.grounded ? Math.sin(time * 9) * 0.05 + 0.08 : 0;
    const color = p.shield ? C.COLORS.playerShield : C.COLORS.player;
    const body = next(); n++;
    body.x = p.x; body.y = p.y + C.PLAYER_SIZE.h / 2 + hover; body.z = 0;
    body.rx = -p.pitch; body.ry = 0; body.rz = p.tilt;
    body.sx = C.PLAYER_SIZE.w; body.sy = C.PLAYER_SIZE.h; body.sz = C.PLAYER_SIZE.d;
    body.color = color; body.glow = 1.4;

    // Cockpit: small raised box, offset in the ship's local frame (approximated for small angles).
    const cab = next(); n++;
    cab.x = p.x - p.tilt * 0.35; cab.y = body.y + 0.38; cab.z = 0.12;
    cab.rx = body.rx; cab.ry = 0; cab.rz = p.tilt;
    cab.sx = 0.5; cab.sy = 0.22; cab.sz = 0.6;
    cab.color = color; cab.glow = 2.2;
  }
  return n;
}
