import { AudioEngine } from './audio/audio';
import * as C from './config';
import { Input } from './core/input';
import { clamp } from './core/math';
import type { Color, GameEvent } from './game/types';
import { World } from './game/world';
import { applyI18n, setLanguage, t } from './i18n';
import { Platform } from './platform/playables';
import { Camera, type ScreenPoint } from './render/camera';
import { CanvasRenderer } from './render/canvas2d/canvas-renderer';
import { Hud } from './render/hud';
import { Particles } from './render/particles';
import type { FrameData, Renderer } from './render/scene';
import { WebGLRenderer } from './render/webgl/webgl-renderer';

interface SaveData {
  best: number;
  muted: boolean;
  renderer: 'webgl' | '2d';
}

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;

/** Owns the main loop and wires simulation → presentation (renderers, HUD, audio, DOM UI, SDK). */
export class App {
  private readonly params = new URLSearchParams(location.search);
  private readonly platform = new Platform();
  private readonly world = new World(1);
  private readonly camera = new Camera();
  private readonly particles = new Particles(3000);
  private readonly audio = new AudioEngine();
  private readonly hud = new Hud($<HTMLCanvasElement>('hud'));
  private readonly canvas2d = new CanvasRenderer($<HTMLCanvasElement>('scene-2d'));
  private webgl?: WebGLRenderer;
  private renderer!: Renderer;
  private preferWebGL = true;

  private save: SaveData = { best: 0, muted: false, renderer: 'webgl' };
  private hostAudio = true;

  private rafId = 0;
  private running = false;
  private paused = false;
  private last = 0;
  private accumulator = 0;
  private time = 0;
  private firstFrameSent = false;

  private flash = 0;
  private flashColor: Color = [1, 1, 1];
  private aberration = 0;
  private debug = this.params.has('debug');
  private fps = 60;
  private slowFrames = 0;
  private renderScale = 1;
  private cssW = 1;
  private cssH = 1;
  private dpr = 1;
  private readonly sp: ScreenPoint = { x: 0, y: 0, w: 0 };
  private overShownAt = 0;

  async boot(): Promise<void> {
    const [lang, raw] = await Promise.all([this.platform.language(), this.platform.load()]);
    setLanguage(this.params.get('lang') ?? lang);
    applyI18n(document);
    try {
      this.save = { ...this.save, ...(JSON.parse(raw || '{}') as Partial<SaveData>) };
    } catch { /* corrupt save: start fresh */ }

    this.setupRenderers();
    this.setupInput();
    this.setupUi();
    this.setupPlatform();

    window.addEventListener('resize', () => this.resize());
    this.resize();

    this.world.reset('title', this.seed());
    this.showScreen('title');
    this.start();
    $('boot').remove();
  }

  // ------------------------------------------------------------------ setup

  private setupRenderers(): void {
    const forced = this.params.get('renderer');
    this.preferWebGL = forced ? forced !== '2d' : this.save.renderer !== '2d';
    const glCanvas = $<HTMLCanvasElement>('scene-gl');
    try {
      this.webgl = new WebGLRenderer(glCanvas);
    } catch (e) {
      this.platform.warn(e);
      this.preferWebGL = false;
    }

    // Context loss is routine on mobile (backgrounding, GPU resets): drop to Canvas2D, rebuild on restore.
    glCanvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.applyRenderer();
    });
    glCanvas.addEventListener('webglcontextrestored', () => {
      try {
        this.webgl?.init();
      } catch (e) {
        this.platform.error(e);
      }
      this.applyRenderer();
      this.resize();
    });
    this.applyRenderer();
  }

  private applyRenderer(): void {
    const useGL = this.preferWebGL && !!this.webgl && !this.webgl.contextLost;
    this.renderer = useGL ? this.webgl! : this.canvas2d;
    $('scene-gl').hidden = !useGL;
    $('scene-2d').hidden = useGL;
    $('btn-renderer').textContent = `⚙ ${this.renderer.name}`;
    this.resize();
  }

  private toggleRenderer(): void {
    if (!this.webgl) return;
    this.preferWebGL = !this.preferWebGL;
    this.save.renderer = this.preferWebGL ? 'webgl' : '2d';
    void this.persist();
    this.applyRenderer();
  }

  private setupInput(): void {
    const input = new Input($('game'));
    input.onAction = (a) => {
      if (this.paused) return;
      const s = this.world.state;
      if (s === 'playing') this.world.input(a);
      else if (a === 'jump' && s === 'title') this.startRun();
      else if (a === 'jump' && s === 'over' && performance.now() - this.overShownAt > 600) this.startRun();
    };
    input.onPause = () => (this.paused ? this.resumeFromPause() : this.pause(true));
    input.onToggleDebug = () => (this.debug = !this.debug);
    input.onToggleRenderer = () => this.toggleRenderer();
  }

  private setupUi(): void {
    const tap = (id: string, fn: () => void): void => {
      $(id).addEventListener('click', (e) => {
        e.stopPropagation();
        this.audio.unlock();
        this.audio.click();
        fn();
      });
      // Keep UI taps from also being read as in-game jumps/swipes.
      $(id).addEventListener('pointerdown', (e) => e.stopPropagation());
    };
    tap('screen-title', () => this.startRun());
    tap('btn-retry', () => this.startRun());
    tap('btn-resume', () => this.resumeFromPause());
    tap('btn-pause', () => this.pause(true));
    tap('btn-sound', () => {
      this.save.muted = !this.save.muted;
      void this.persist();
      this.updateAudioState();
    });
    tap('btn-renderer', () => this.toggleRenderer());
    $('screen-over').addEventListener('pointerdown', (e) => e.stopPropagation());
    $('screen-pause').addEventListener('pointerdown', (e) => e.stopPropagation());
    $('title-best').textContent = String(this.save.best);
    this.updateAudioState();
  }

  private setupPlatform(): void {
    this.hostAudio = this.platform.isAudioEnabled();
    this.platform.onAudioEnabledChange((on) => {
      this.hostAudio = on;
      this.updateAudioState();
    });
    this.platform.onPause(() => this.pause(this.world.state === 'playing'));
    this.platform.onResume(() => {
      // Mid-run we keep the pause overlay up so the player resumes on their own terms.
      if (this.world.state !== 'playing') this.resumeFromPause();
    });
    // The sound toggle is redundant inside YouTube, which owns the mute control.
    $('btn-sound').hidden = this.platform.inPlayables;
  }

  private updateAudioState(): void {
    this.audio.setEnabled(this.hostAudio && !this.save.muted);
    $('btn-sound').textContent = this.save.muted ? `🔇 ${t('soundOff')}` : `🔊 ${t('soundOn')}`;
  }

  private seed(): number {
    const s = Number(this.params.get('seed'));
    return Number.isFinite(s) && s > 0 ? s : (Math.random() * 2 ** 31) | 0;
  }

  // ------------------------------------------------------------------ flow

  private startRun(): void {
    this.audio.unlock();
    this.world.reset('playing', this.seed());
    this.particles.count = 0;
    this.hud.clearPopups();
    this.flash = 0;
    this.showScreen(null);
    this.audio.startMusic();
  }

  private pause(showOverlay: boolean): void {
    if (this.paused) return;
    this.paused = true;
    this.audio.suspend();
    this.stop();
    if (showOverlay && this.world.state === 'playing') this.showScreen('pause');
  }

  private resumeFromPause(): void {
    if (!this.paused) return;
    this.paused = false;
    this.audio.resume();
    if (this.world.state === 'playing') this.showScreen(null);
    this.start();
  }

  private gameOver(score: number): void {
    const best = this.save.best;
    const isBest = score > best;
    if (isBest) {
      this.save.best = score;
      void this.persist();
      this.platform.sendScore(score);
    }
    $('final-score').textContent = String(score);
    $('over-best').textContent = String(this.save.best);
    $('over-gems').textContent = String(this.world.gems);
    $('over-combo').textContent = `x${this.world.bestCombo}`;
    $('title-best').textContent = String(this.save.best);
    $('new-best').hidden = !isBest;
    this.overShownAt = performance.now();
    this.showScreen('over');
  }

  private showScreen(name: 'title' | 'over' | 'pause' | null): void {
    for (const id of ['title', 'over', 'pause']) $(`screen-${id}`).classList.toggle('active', id === name);
    $('btn-pause').hidden = name !== null;
  }

  private persist(): Promise<void> {
    return this.platform.save(JSON.stringify(this.save));
  }

  // ------------------------------------------------------------------ loop

  private start(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    this.rafId = requestAnimationFrame(this.frame);
  }

  private stop(): void {
    this.running = false;
    cancelAnimationFrame(this.rafId);
  }

  private frame = (now: number): void => {
    if (!this.running) return;
    this.rafId = requestAnimationFrame(this.frame);
    const dt = Math.min((now - this.last) / 1000, 0.1);
    this.last = now;
    this.time += dt;

    // Fixed-timestep simulation, decoupled from display refresh rate.
    this.accumulator += dt;
    let steps = 0;
    while (this.accumulator >= C.FIXED_STEP && steps < 24) {
      this.world.step(C.FIXED_STEP);
      this.accumulator -= C.FIXED_STEP;
      steps++;
    }
    if (steps === 24) this.accumulator = 0;

    for (const e of this.world.events) this.handleEvent(e);
    this.world.events.length = 0;

    this.updateEffects(dt);
    this.camera.update(this.world, this.cssW / this.cssH, dt);

    const frame: FrameData = {
      world: this.world, camera: this.camera, particles: this.particles,
      time: this.time, flash: this.flash, flashColor: this.flashColor, aberration: this.aberration,
    };
    try {
      this.renderer.render(frame);
    } catch (e) {
      // A failing GPU path must never take the game down: report and fall back.
      this.platform.error(e);
      if (this.renderer !== this.canvas2d) {
        this.webgl = undefined;
        this.applyRenderer();
      }
    }
    this.hud.render(this.world, dt, {
      renderer: this.renderer.name + (this.renderer === this.webgl && this.webgl.hdr ? ' HDR' : ''),
      fps: this.fps,
      resolution: `${this.renderer.canvas.width}×${this.renderer.canvas.height}`,
      particles: this.particles.count,
      debug: this.debug,
    });

    if (!this.firstFrameSent) {
      this.firstFrameSent = true;
      this.platform.firstFrameReady();
      this.platform.gameReady();
    }
    this.adaptResolution(dt);
  };

  private updateEffects(dt: number): void {
    const w = this.world;
    const p = w.player;
    this.flash = Math.max(0, this.flash - dt * 2.2);
    this.aberration = Math.max(0, this.aberration - dt * 0.05);

    if (p.alive) {
      // Engine exhaust.
      const color = p.shield ? C.COLORS.playerShield : C.COLORS.player;
      for (let i = 0; i < 2; i++) {
        this.particles.emit(p.x + (Math.random() - 0.5) * 0.5, p.y + 0.3, 0.75,
          (Math.random() - 0.5) * 1.5, Math.random() * 0.5, 4 + Math.random() * 3, 0.35, color, 0.32);
      }
      if (p.shield && Math.random() < 0.6) {
        const a = this.time * 6 + Math.random() * 0.3;
        this.particles.emit(p.x + Math.cos(a) * 1.0, p.y + 0.4 + Math.sin(a * 0.5) * 0.3, Math.sin(a) * 1.0,
          0, 0.5, -w.speed, 0.3, C.COLORS.shield, 0.28);
      }
    }
    // Warp dust along the sides; density scales with speed.
    const dust = w.speed * dt * 0.6;
    for (let i = 0; i < dust; i++) {
      const side = Math.random() < 0.5 ? -1 : 1;
      this.particles.emit(side * (5 + Math.random() * 14), Math.random() * 7, C.SPAWN_Z * 0.6 * Math.random() - 10,
        0, 0.6, 0, 1.6, Math.random() < 0.5 ? C.COLORS.lane : C.COLORS.grid, 0.18);
    }
    this.particles.update(dt, w.speed);
  }

  private handleEvent(e: GameEvent): void {
    if (this.world.state === 'title') return;
    const P = this.particles;
    switch (e.type) {
      case 'jump':
        this.audio.jump();
        P.burst(this.world.player.x, 0.1, 0.3, 12, C.COLORS.lane, 4, 0.25, 0.4);
        break;
      case 'land':
        this.audio.land();
        P.burst(this.world.player.x, 0.05, 0.3, 10, C.COLORS.lane, 3, 0.22, 0.35);
        break;
      case 'lane':
        this.audio.lane(e.dir);
        break;
      case 'gem':
        this.audio.gem(e.combo);
        P.burst(e.x, e.y, e.z, 18, C.COLORS.gem, 7, 0.3, 0.6);
        this.popupAt(e.x, e.y, e.z, `+${e.points}`, '#ffc933', 18 + e.combo);
        break;
      case 'nearMiss':
        this.audio.nearMiss();
        this.popupAt(e.x, e.y, e.z, `${t('nearMiss')} +${e.points}`, '#21e6ff', 16);
        break;
      case 'shieldPickup':
        this.audio.shield();
        P.burst(e.x, e.y, e.z, 30, C.COLORS.shield, 8, 0.35);
        this.popupAt(e.x, e.y, e.z, t('shield'), '#3dff5a', 22);
        break;
      case 'shieldBreak':
        this.audio.shieldBreak();
        P.burst(e.x, e.y, e.z, 60, C.COLORS.shield, 12, 0.4);
        this.flash = 0.35;
        this.flashColor = [0.5, 1, 0.5];
        this.aberration = 0.012;
        this.popupAt(e.x, e.y + 1, e.z, t('blocked'), '#3dff5a', 24);
        navigator.vibrate?.(40);
        break;
      case 'crash':
        this.audio.crash();
        this.audio.stopMusic(0.6);
        P.burst(e.x, e.y, e.z, 140, C.COLORS.player, 16, 0.45, 1.2);
        P.burst(e.x, e.y, e.z, 80, e.color, 12, 0.4, 1.0);
        this.flash = 0.6;
        this.flashColor = [1, 0.6, 0.85];
        this.aberration = 0.02;
        navigator.vibrate?.(90);
        break;
      case 'milestone':
        this.audio.milestone();
        this.hud.punch();
        break;
      case 'gameOver':
        this.gameOver(e.score);
        break;
    }
  }

  private popupAt(x: number, y: number, z: number, text: string, color: string, size: number): void {
    if (this.camera.project(x, y, z, this.cssW, this.cssH, this.sp)) {
      this.hud.popup(clamp(this.sp.x, 60, this.cssW - 60), clamp(this.sp.y - 20, 80, this.cssH - 40), text, color, size);
    }
  }

  // ------------------------------------------------------------------ sizing

  private resize(): void {
    const el = $('game');
    this.cssW = Math.max(1, el.clientWidth);
    this.cssH = Math.max(1, el.clientHeight);
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.hud.resize(this.cssW, this.cssH, this.dpr);
    const s = this.dpr * this.renderScale;
    this.renderer?.resize(Math.round(this.cssW * s), Math.round(this.cssH * s));
  }

  /** Dynamic resolution: drop internal resolution when frames are consistently slow. */
  private adaptResolution(dt: number): void {
    if (dt <= 0) return;
    this.fps += (1 / dt - this.fps) * 0.05;
    if (this.fps < 48) this.slowFrames++;
    else this.slowFrames = Math.max(0, this.slowFrames - 1);
    if (this.slowFrames > 120 && this.renderScale > 0.55) {
      this.renderScale = Math.max(0.55, this.renderScale - 0.15);
      this.slowFrames = 0;
      this.resize();
    }
  }
}
