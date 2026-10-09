import type { Action } from '../game/types';

const SWIPE_PX = 26;
const TAP_MS = 250;

/**
 * Unified keyboard + pointer (touch/mouse/pen) input. Swipes fire as soon as the threshold is
 * crossed (not on release) for responsiveness, and a single drag can chain multiple swipes.
 */
export class Input {
  onAction: (a: Action) => void = () => {};
  onPause: () => void = () => {};
  onToggleDebug: () => void = () => {};
  onToggleRenderer: () => void = () => {};

  private pointerId = -1;
  private startX = 0;
  private startY = 0;
  private startT = 0;
  private swiped = false;

  constructor(surface: HTMLElement) {
    window.addEventListener('keydown', this.onKey);
    surface.addEventListener('pointerdown', this.onDown);
    surface.addEventListener('pointermove', this.onMove);
    surface.addEventListener('pointerup', this.onUp);
    surface.addEventListener('pointercancel', () => (this.pointerId = -1));
    surface.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  private onKey = (e: KeyboardEvent): void => {
    if (e.repeat) return;
    const map: Record<string, Action> = {
      ArrowLeft: 'left', KeyA: 'left',
      ArrowRight: 'right', KeyD: 'right',
      ArrowUp: 'jump', KeyW: 'jump', Space: 'jump',
      ArrowDown: 'down', KeyS: 'down',
    };
    const action = map[e.code];
    if (action) {
      e.preventDefault();
      this.onAction(action);
    } else if (e.code === 'Escape' || e.code === 'KeyP') {
      this.onPause();
    } else if (e.code === 'KeyF') {
      this.onToggleDebug();
    } else if (e.code === 'KeyR') {
      this.onToggleRenderer();
    }
  };

  private onDown = (e: PointerEvent): void => {
    if (this.pointerId !== -1) return;
    this.pointerId = e.pointerId;
    this.startX = e.clientX;
    this.startY = e.clientY;
    this.startT = performance.now();
    this.swiped = false;
  };

  private onMove = (e: PointerEvent): void => {
    if (e.pointerId !== this.pointerId) return;
    const dx = e.clientX - this.startX;
    const dy = e.clientY - this.startY;
    if (Math.hypot(dx, dy) < SWIPE_PX) return;
    if (Math.abs(dx) > Math.abs(dy)) this.onAction(dx < 0 ? 'left' : 'right');
    else this.onAction(dy < 0 ? 'jump' : 'down');
    this.swiped = true;
    // Re-anchor so continuing the drag can trigger another swipe.
    this.startX = e.clientX;
    this.startY = e.clientY;
  };

  private onUp = (e: PointerEvent): void => {
    if (e.pointerId !== this.pointerId) return;
    this.pointerId = -1;
    if (!this.swiped && performance.now() - this.startT < TAP_MS) this.onAction('jump');
  };
}
