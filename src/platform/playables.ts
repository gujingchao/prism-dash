/**
 * Thin, typed wrapper around the YouTube Playables SDK (`window.ytgame`, loaded from
 * https://www.youtube.com/game_api/v1). Outside YouTube every call degrades gracefully to
 * browser equivalents (localStorage, navigator.language, document visibility).
 */

interface YtGame {
  IN_PLAYABLES_ENV: boolean;
  SDK_VERSION: string;
  game: {
    firstFrameReady(): void;
    gameReady(): void;
    loadData(): Promise<string>;
    saveData(data: string): Promise<void>;
  };
  engagement: {
    sendScore(score: { value: number }): Promise<void>;
  };
  system: {
    isAudioEnabled(): boolean;
    onAudioEnabledChange(cb: (enabled: boolean) => void): () => void;
    onPause(cb: () => void): () => void;
    onResume(cb: () => void): () => void;
    getLanguage(): Promise<string>;
  };
  health: {
    logError(): void;
    logWarning(): void;
  };
}

declare global {
  interface Window {
    ytgame?: YtGame;
  }
}

const STORAGE_KEY = 'prism-dash-save';

export class Platform {
  private readonly yt?: YtGame;
  readonly inPlayables: boolean;

  constructor() {
    this.yt = window.ytgame;
    this.inPlayables = !!this.yt?.IN_PLAYABLES_ENV;
  }

  /** Call once the first frame has actually been drawn (Playables loading metric). */
  firstFrameReady(): void {
    if (this.inPlayables) this.yt!.game.firstFrameReady();
  }

  /** Call once the game is interactive. */
  gameReady(): void {
    if (this.inPlayables) this.yt!.game.gameReady();
  }

  async language(): Promise<string> {
    if (this.inPlayables) {
      try { return await this.yt!.system.getLanguage(); } catch { /* fall through */ }
    }
    return navigator.language || 'en';
  }

  async load(): Promise<string> {
    if (this.inPlayables) {
      try { return await this.yt!.game.loadData(); } catch (e) { this.warn(e); return ''; }
    }
    try { return localStorage.getItem(STORAGE_KEY) ?? ''; } catch { return ''; }
  }

  async save(data: string): Promise<void> {
    if (this.inPlayables) {
      try { await this.yt!.game.saveData(data); } catch (e) { this.warn(e); }
      return;
    }
    try { localStorage.setItem(STORAGE_KEY, data); } catch { /* private mode etc. */ }
  }

  sendScore(value: number): void {
    if (!this.inPlayables) return;
    this.yt!.engagement.sendScore({ value: Math.floor(value) }).catch((e) => this.warn(e));
  }

  isAudioEnabled(): boolean {
    return this.inPlayables ? this.yt!.system.isAudioEnabled() : true;
  }

  onAudioEnabledChange(cb: (enabled: boolean) => void): void {
    if (this.inPlayables) this.yt!.system.onAudioEnabledChange(cb);
  }

  /** Host pause/resume (YouTube) plus tab visibility everywhere. */
  onPause(cb: () => void): void {
    if (this.inPlayables) this.yt!.system.onPause(cb);
    document.addEventListener('visibilitychange', () => { if (document.hidden) cb(); });
  }

  onResume(cb: () => void): void {
    if (this.inPlayables) this.yt!.system.onResume(cb);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) cb(); });
  }

  error(err: unknown): void {
    console.error(err);
    if (this.inPlayables) this.yt!.health.logError();
  }

  warn(err: unknown): void {
    console.warn(err);
    if (this.inPlayables) this.yt!.health.logWarning();
  }
}
