import type { Color } from './game/types';

// World units: 1 unit ≈ 1 metre. The player sits at z = 0, the camera looks down -Z and
// obstacles travel towards +Z at `speed`.

export const LANE_WIDTH = 2.4;
export const TRACK_HALF_WIDTH = LANE_WIDTH * 1.5;

export const SPAWN_Z = -120;
export const DESPAWN_Z = 10;
export const PREWARM_Z = -42;

export const BASE_SPEED = 16;
export const MAX_SPEED = 44;
export const SPEED_RAMP = 0.32; // units/s gained per second

export const GRAVITY = -40;
export const JUMP_VELOCITY = 13.5;
export const FAST_FALL_VELOCITY = -26;
export const JUMP_BUFFER = 0.14;
export const LANE_SWITCH_RATE = 16;

export const PLAYER_SIZE = { w: 1.0, h: 0.55, d: 1.3 } as const;

export const COMBO_WINDOW = 1.5;
export const MAX_COMBO = 10;

/** Simulation tick. Rendering runs at display rate; logic is deterministic at 120 Hz. */
export const FIXED_STEP = 1 / 120;

/** "Curved world" vertex-shader bend: y drop and x sway per unit² of distance from camera. */
export const CURVE_DROP = 0.0006;
export const CURVE_BEND = 0.0009;

export const FOG_NEAR = 38;
export const FOG_FAR = 118;

export const COLORS = {
  player: [0.15, 1.0, 0.95],
  playerShield: [0.45, 1.0, 0.45],
  block: [1.0, 0.16, 0.55],
  barrier: [1.0, 0.6, 0.1],
  gem: [1.0, 0.85, 0.3],
  shield: [0.35, 1.0, 0.4],
  lane: [0.1, 0.85, 1.0],
  grid: [0.8, 0.12, 0.75],
  fog: [0.28, 0.035, 0.27],
  skyTop: [0.015, 0.0, 0.06],
} as const satisfies Record<string, Color>;
