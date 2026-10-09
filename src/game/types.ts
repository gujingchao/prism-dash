export type Color = readonly [number, number, number];

export type Kind = 'block' | 'barrier' | 'gem' | 'shield';

/** Axis-aligned box; (x, y, z) is the centre. */
export interface Box {
  x: number;
  y: number;
  z: number;
  w: number;
  h: number;
  d: number;
}

export interface Entity extends Box {
  kind: Kind;
  lane: number;
  rotX: number;
  rotY: number;
  spin: number;
  color: Color;
  glow: number;
  passed: boolean;
}

export type GameState = 'title' | 'playing' | 'dying' | 'over';

export type Action = 'left' | 'right' | 'jump' | 'down';

interface At {
  x: number;
  y: number;
  z: number;
}

/** Gameplay → presentation events (audio, particles, HUD). Drained once per frame. */
export type GameEvent =
  | { type: 'jump' }
  | { type: 'land' }
  | { type: 'lane'; dir: number }
  | ({ type: 'gem'; combo: number; points: number } & At)
  | ({ type: 'shieldPickup' } & At)
  | ({ type: 'shieldBreak' } & At)
  | ({ type: 'nearMiss'; points: number } & At)
  | ({ type: 'crash'; color: Color } & At)
  | { type: 'milestone'; score: number }
  | { type: 'gameOver'; score: number };
