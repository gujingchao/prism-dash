const en = {
  tagline: 'Dodge. Jump. Chase the neon sun.',
  tapToStart: 'Tap to start',
  controlsDesktop: '← → / A D  switch lane  ·  ↑ / W / Space  jump  ·  ↓  dive',
  controlsTouch: 'Swipe ← →  switch lane  ·  Tap or swipe ↑  jump  ·  Swipe ↓  dive',
  best: 'Best',
  gameOver: 'Game Over',
  newBest: 'New best!',
  retry: 'Play again',
  paused: 'Paused',
  resume: 'Resume',
  gems: 'Gems',
  maxCombo: 'Max combo',
  soundOn: 'Sound on',
  soundOff: 'Sound off',
  nearMiss: 'NEAR MISS',
  shield: 'SHIELD',
  blocked: 'BLOCKED!',
};

type Strings = typeof en;
export type StringKey = keyof Strings;

const zh: Strings = {
  tagline: '闪避、跳跃，追逐霓虹落日。',
  tapToStart: '点击开始',
  controlsDesktop: '← → / A D 换道 · ↑ / W / 空格 跳跃 · ↓ 急降',
  controlsTouch: '左右滑动换道 · 点击或上滑跳跃 · 下滑急降',
  best: '最高分',
  gameOver: '游戏结束',
  newBest: '新纪录！',
  retry: '再来一局',
  paused: '已暂停',
  resume: '继续',
  gems: '宝石',
  maxCombo: '最高连击',
  soundOn: '声音：开',
  soundOff: '声音：关',
  nearMiss: '擦身而过',
  shield: '护盾',
  blocked: '已抵挡！',
};

const tables: Record<string, Strings> = { en, zh };
let current: Strings = en;

export function setLanguage(code: string): void {
  current = tables[code.toLowerCase().split(/[-_]/)[0]] ?? en;
  document.documentElement.lang = current === zh ? 'zh' : 'en';
}

export function t(key: StringKey): string {
  return current[key];
}

export function applyI18n(root: ParentNode): void {
  root.querySelectorAll<HTMLElement>('[data-i18n]').forEach((el) => {
    el.textContent = t(el.dataset.i18n as StringKey);
  });
}
