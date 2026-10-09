import { COMBO_WINDOW } from '../config';
import type { World } from '../game/world';

interface Popup {
  x: number;
  y: number;
  text: string;
  color: string;
  life: number;
  max: number;
  size: number;
}

export interface HudInfo {
  renderer: string;
  fps: number;
  resolution: string;
  particles: number;
  debug: boolean;
}

const FONT = '"Segoe UI", Roboto, "Helvetica Neue", "PingFang SC", "Microsoft YaHei", sans-serif';

/** Canvas 2D overlay for in-game UI: score, combo ring, popups and a debug readout. */
export class Hud {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly popups: Popup[] = [];
  private width = 1;
  private height = 1;
  private dpr = 1;
  private shownScore = 0;
  private scorePunch = 0;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
  }

  resize(cssWidth: number, cssHeight: number, dpr: number): void {
    this.width = cssWidth;
    this.height = cssHeight;
    this.dpr = dpr;
    this.canvas.width = Math.round(cssWidth * dpr);
    this.canvas.height = Math.round(cssHeight * dpr);
  }

  /** Coordinates in CSS pixels. */
  popup(x: number, y: number, text: string, color: string, size = 22): void {
    this.popups.push({ x, y, text, color, life: 0.9, max: 0.9, size });
    if (this.popups.length > 24) this.popups.shift();
  }

  punch(): void {
    this.scorePunch = 1;
  }

  clearPopups(): void {
    this.popups.length = 0;
  }

  render(world: World, dt: number, info: HudInfo): void {
    const { ctx, width: W, height: H } = this;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const inRun = world.state === 'playing' || world.state === 'dying';
    if (inRun) {
      // Rolling score counter with a scale "punch" on milestones.
      this.shownScore += (world.score - this.shownScore) * Math.min(1, dt * 12);
      if (Math.abs(world.score - this.shownScore) < 1) this.shownScore = world.score;
      this.scorePunch = Math.max(0, this.scorePunch - dt * 3);
      const base = Math.min(56, Math.max(34, W * 0.075));
      const size = base * (1 + this.scorePunch * 0.25);
      const top = Math.max(18, H * 0.05) + base * 0.6;
      ctx.font = `800 ${size}px ${FONT}`;
      glowText(ctx, String(Math.round(this.shownScore)), W / 2, top, '#ffffff', '#21e6ff', 18);

      if (world.combo > 1) {
        const cy = top + base * 1.05;
        const r = base * 0.42;
        const t = Math.max(0, world.comboTimer / COMBO_WINDOW);
        ctx.lineWidth = 4;
        ctx.strokeStyle = 'rgba(255,255,255,0.15)';
        ctx.beginPath();
        ctx.arc(W / 2, cy, r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.strokeStyle = '#ffd84d';
        ctx.beginPath();
        ctx.arc(W / 2, cy, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * t);
        ctx.stroke();
        ctx.font = `800 ${base * 0.4}px ${FONT}`;
        glowText(ctx, `x${world.combo}`, W / 2, cy + 1, '#ffe98a', '#ffb300', 10);
      }

      if (world.player.shield) {
        ctx.font = `700 ${base * 0.3}px ${FONT}`;
        ctx.textAlign = 'left';
        glowText(ctx, '◆ SHIELD', 16, top, '#8dff8a', '#3dff5a', 10);
        ctx.textAlign = 'center';
      }

      // Speed meter along the bottom edge.
      const barW = Math.min(W * 0.5, 260);
      const y = H - Math.max(22, H * 0.035);
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      roundRect(ctx, (W - barW) / 2, y, barW, 5, 3);
      ctx.fillStyle = '#ff3d9a';
      ctx.shadowColor = '#ff3d9a';
      ctx.shadowBlur = 10;
      roundRect(ctx, (W - barW) / 2, y, barW * (0.08 + world.difficulty * 0.92), 5, 3);
      ctx.shadowBlur = 0;
    }

    for (let i = this.popups.length - 1; i >= 0; i--) {
      const p = this.popups[i];
      p.life -= dt;
      if (p.life <= 0) { this.popups.splice(i, 1); continue; }
      const k = 1 - p.life / p.max;
      ctx.globalAlpha = Math.min(1, p.life / p.max * 2.5);
      ctx.font = `800 ${p.size * (1 + 0.4 * Math.max(0, 0.2 - k) * 5)}px ${FONT}`;
      glowText(ctx, p.text, p.x, p.y - k * 50, '#ffffff', p.color, 12);
    }
    ctx.globalAlpha = 1;

    if (info.debug) {
      ctx.font = `600 12px ui-monospace, Consolas, monospace`;
      ctx.textAlign = 'right';
      ctx.textBaseline = 'top';
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.fillRect(W - 178, 66, 170, 76);
      ctx.fillStyle = '#9ff';
      const lines = [
        `${info.renderer}  ${info.fps.toFixed(0)} fps`,
        `res ${info.resolution}`,
        `entities ${world.entities.length}`,
        `particles ${info.particles}`,
        `speed ${world.speed.toFixed(1)}`,
      ];
      lines.forEach((l, i) => ctx.fillText(l, W - 14, 71 + i * 14));
    }
  }
}

function glowText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, fill: string, glow: string, blur: number): void {
  ctx.shadowColor = glow;
  ctx.shadowBlur = blur;
  ctx.fillStyle = fill;
  ctx.fillText(text, x, y);
  ctx.shadowBlur = 0;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.fill();
}
