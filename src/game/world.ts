import * as C from '../config';
import { clamp, damp } from '../core/math';
import { Rng } from '../core/rng';
import { overlaps } from './collision';
import { generatePattern, rowSpacing, LANES } from './spawner';
import type { Action, Box, Entity, GameEvent, GameState, Kind } from './types';

export interface Player {
  lane: number;
  x: number;
  /** Height of the player's underside above the track. */
  y: number;
  vy: number;
  grounded: boolean;
  shield: boolean;
  invuln: number;
  tilt: number;
  pitch: number;
  jumpBuffer: number;
  alive: boolean;
}

/**
 * Pure game simulation: no DOM, no rendering, no audio. Advanced with a fixed timestep and
 * communicates outwards only through the `events` queue, which keeps it deterministic and testable.
 */
export class World {
  state: GameState = 'title';
  readonly entities: Entity[] = [];
  readonly events: GameEvent[] = [];
  readonly player: Player = World.freshPlayer();

  speed = C.BASE_SPEED;
  distance = 0;
  time = 0;
  score = 0;
  gems = 0;
  combo = 0;
  bestCombo = 0;
  comboTimer = 0;
  shake = 0;
  dyingTime = 0;

  private bonus = 0;
  private nextRowIn = 0;
  private nextMilestone = 1000;
  private rng: Rng;
  private readonly pool: Entity[] = [];
  private readonly playerBox: Box = { x: 0, y: 0, z: 0, w: 0, h: 0, d: 0 };

  constructor(seed = 1) {
    this.rng = new Rng(seed);
    this.reset('title', seed);
  }

  private static freshPlayer(): Player {
    return {
      lane: 0, x: 0, y: 0, vy: 0, grounded: true, shield: false, invuln: 0,
      tilt: 0, pitch: 0, jumpBuffer: 0, alive: true,
    };
  }

  /** 0 → 1 as speed ramps from base to max. Drives spawn density and camera FOV. */
  get difficulty(): number {
    return clamp((this.speed - C.BASE_SPEED) / (C.MAX_SPEED - C.BASE_SPEED), 0, 1);
  }

  reset(state: 'title' | 'playing', seed: number): void {
    while (this.entities.length) this.pool.push(this.entities.pop()!);
    this.events.length = 0;
    this.rng = new Rng(seed);
    Object.assign(this.player, World.freshPlayer());
    this.state = state;
    this.speed = C.BASE_SPEED;
    this.distance = 0;
    this.time = 0;
    this.score = 0;
    this.bonus = 0;
    this.gems = 0;
    this.combo = 0;
    this.bestCombo = 0;
    this.comboTimer = 0;
    this.shake = 0;
    this.dyingTime = 0;
    this.nextMilestone = 1000;

    // Pre-populate the visible track so the run starts with obstacles already in view.
    let z = C.PREWARM_Z;
    while (z > C.SPAWN_Z) {
      this.spawnRow(z);
      z -= rowSpacing(0);
    }
    this.nextRowIn = C.SPAWN_Z - z;
  }

  input(action: Action): void {
    if (this.state === 'playing') this.act(action);
  }

  private act(action: Action): void {
    const p = this.player;
    switch (action) {
      case 'left':
        if (p.lane > -1) { p.lane--; this.events.push({ type: 'lane', dir: -1 }); }
        break;
      case 'right':
        if (p.lane < 1) { p.lane++; this.events.push({ type: 'lane', dir: 1 }); }
        break;
      case 'jump':
        p.jumpBuffer = C.JUMP_BUFFER;
        break;
      case 'down':
        if (!p.grounded) p.vy = Math.min(p.vy, C.FAST_FALL_VELOCITY);
        break;
    }
  }

  step(dt: number): void {
    this.shake = Math.max(0, this.shake - dt * 2.5);
    if (this.state === 'over') return;

    if (this.state === 'playing') {
      this.time += dt;
      this.speed = Math.min(C.MAX_SPEED, this.speed + C.SPEED_RAMP * dt);
    } else if (this.state === 'dying') {
      this.dyingTime += dt;
      this.speed = damp(this.speed, 0, 3, dt);
      if (this.dyingTime > 1.1) {
        this.state = 'over';
        this.events.push({ type: 'gameOver', score: this.score });
      }
    } else {
      this.speed = C.BASE_SPEED;
      this.autopilot();
    }

    const move = this.speed * dt;
    this.distance += move;

    if (this.player.alive) this.updatePlayer(dt);
    this.updateEntities(dt, move);

    this.nextRowIn -= move;
    while (this.nextRowIn <= 0) {
      this.spawnRow(C.SPAWN_Z - this.nextRowIn);
      this.nextRowIn += rowSpacing(this.difficulty);
    }

    if (this.state === 'playing') {
      this.collide();
      this.comboTimer -= dt;
      if (this.comboTimer <= 0) this.combo = 0;
      this.score = Math.floor(this.distance * 0.25) + this.bonus;
      if (this.score >= this.nextMilestone) {
        this.events.push({ type: 'milestone', score: this.nextMilestone });
        this.nextMilestone += 1000;
      }
    }
  }

  private updatePlayer(dt: number): void {
    const p = this.player;
    const prevX = p.x;
    p.x = damp(p.x, p.lane * C.LANE_WIDTH, C.LANE_SWITCH_RATE, dt);
    const vx = (p.x - prevX) / dt;
    p.tilt = damp(p.tilt, -vx * 0.018, 18, dt);

    p.jumpBuffer -= dt;
    if (p.jumpBuffer > 0 && p.grounded) {
      p.vy = C.JUMP_VELOCITY;
      p.grounded = false;
      p.jumpBuffer = 0;
      this.events.push({ type: 'jump' });
    }
    if (!p.grounded) {
      p.vy += C.GRAVITY * dt;
      p.y += p.vy * dt;
      if (p.y <= 0) {
        p.y = 0;
        p.vy = 0;
        p.grounded = true;
        this.events.push({ type: 'land' });
      }
    }
    p.pitch = damp(p.pitch, p.grounded ? 0 : clamp(p.vy * 0.025, -0.35, 0.35), 12, dt);
    if (p.invuln > 0) p.invuln -= dt;
  }

  private updateEntities(dt: number, move: number): void {
    const p = this.player;
    for (let i = this.entities.length - 1; i >= 0; i--) {
      const e = this.entities[i];
      e.z += move;
      e.rotY += e.spin * dt;

      if (e.kind === 'block' && !e.passed && e.z > 0) {
        e.passed = true;
        const gap = Math.abs(e.x - p.x) - (e.w + C.PLAYER_SIZE.w) / 2;
        if (this.state === 'playing' && p.alive && gap > 0 && gap < 0.9) {
          this.bonus += 25;
          this.events.push({ type: 'nearMiss', points: 25, x: p.x, y: p.y + 1, z: 0 });
        }
      }
      if (e.z > C.DESPAWN_Z) this.remove(i);
    }
  }

  private collide(): void {
    const p = this.player;
    const pb = this.playerBox;
    pb.x = p.x;
    pb.y = p.y + C.PLAYER_SIZE.h / 2;
    pb.w = C.PLAYER_SIZE.w * 0.8;
    pb.h = C.PLAYER_SIZE.h;
    pb.d = C.PLAYER_SIZE.d * 0.8;

    for (let i = this.entities.length - 1; i >= 0; i--) {
      const e = this.entities[i];
      if (Math.abs(e.z) > 4) continue;
      const pickup = e.kind === 'gem' || e.kind === 'shield';
      if (!overlaps(pb, e, pickup ? 0.7 : 0)) continue;

      if (e.kind === 'gem') {
        this.combo = this.comboTimer > 0 ? Math.min(this.combo + 1, C.MAX_COMBO) : 1;
        this.bestCombo = Math.max(this.bestCombo, this.combo);
        this.comboTimer = C.COMBO_WINDOW;
        const points = 10 * this.combo;
        this.bonus += points;
        this.gems++;
        this.events.push({ type: 'gem', combo: this.combo, points, x: e.x, y: e.y, z: e.z });
        this.remove(i);
      } else if (e.kind === 'shield') {
        p.shield = true;
        this.events.push({ type: 'shieldPickup', x: e.x, y: e.y, z: e.z });
        this.remove(i);
      } else if (p.invuln <= 0) {
        if (p.shield) {
          p.shield = false;
          p.invuln = 0.8;
          this.shake = 0.6;
          this.events.push({ type: 'shieldBreak', x: e.x, y: e.y, z: e.z });
          this.remove(i);
        } else {
          this.crash(e);
          return;
        }
      }
    }
  }

  private crash(e: Entity): void {
    const p = this.player;
    this.state = 'dying';
    this.dyingTime = 0;
    p.alive = false;
    this.shake = 1;
    this.events.push({ type: 'crash', color: e.color, x: p.x, y: p.y + C.PLAYER_SIZE.h / 2, z: 0 });
  }

  /** Attract-mode steering for the title screen (collisions are off there). */
  private autopilot(): void {
    const p = this.player;
    const clearance = (lane: number): number => {
      let nearest = Infinity;
      for (const e of this.entities) {
        if (e.kind !== 'block' || e.lane !== lane) continue;
        const ahead = -e.z;
        if (ahead > -1.5 && ahead < nearest) nearest = ahead;
      }
      return nearest;
    };
    if (clearance(p.lane) < 30) {
      let best = p.lane;
      for (const lane of LANES) if (clearance(lane) > clearance(best) + 2) best = lane;
      if (best !== p.lane) this.act(best < p.lane ? 'left' : 'right');
    }
    if (p.grounded) {
      for (const e of this.entities) {
        if (e.kind === 'barrier' && e.lane === p.lane && e.z > -6 && e.z < -2) {
          this.act('jump');
          break;
        }
      }
    }
    this.events.length = 0; // attract mode is silent
  }

  private spawnRow(z: number): void {
    for (const s of generatePattern(this.rng, this.difficulty)) {
      this.spawn(s.kind, s.lane, z + s.dz, s.high);
    }
  }

  spawn(kind: Kind, lane: number, z: number, high = false): Entity {
    const e = this.pool.pop() ?? ({} as Entity);
    e.kind = kind;
    e.lane = lane;
    e.x = lane * C.LANE_WIDTH;
    e.z = z;
    e.rotX = 0;
    e.rotY = 0;
    e.spin = 0;
    e.passed = false;
    switch (kind) {
      case 'block':
        e.w = 1.9; e.d = 1.9; e.h = 2.6 + this.rng.next() * 1.8;
        e.y = e.h / 2;
        e.color = C.COLORS.block; e.glow = 0.6;
        break;
      case 'barrier':
        e.w = 2.2; e.h = 0.8; e.d = 0.5; e.y = 0.4;
        e.color = C.COLORS.barrier; e.glow = 1.0;
        break;
      case 'gem':
        e.w = e.h = e.d = 0.6;
        e.y = high ? 2.7 : 0.9;
        e.rotX = Math.PI / 4; e.spin = 3;
        e.color = C.COLORS.gem; e.glow = 1.6;
        break;
      case 'shield':
        e.w = e.h = e.d = 0.8; e.y = 1.1;
        e.rotX = 0.6; e.spin = 2;
        e.color = C.COLORS.shield; e.glow = 1.8;
        break;
    }
    this.entities.push(e);
    return e;
  }

  private remove(i: number): void {
    const last = this.entities.pop()!;
    if (i < this.entities.length) {
      this.pool.push(this.entities[i]);
      this.entities[i] = last;
    } else {
      this.pool.push(last);
    }
  }
}
