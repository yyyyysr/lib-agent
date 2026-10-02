import type { ThemeSource } from '@yys/shared';

const STORAGE_KEY = 'yys-theme';
const media = window.matchMedia('(prefers-color-scheme: dark)');

export function getThemeSource(): ThemeSource {
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored === 'light' || stored === 'dark' ? stored : 'system';
}

function apply(source: ThemeSource): void {
  const dark = source === 'dark' || (source === 'system' && media.matches);
  document.documentElement.classList.toggle('dark', dark);
}

export function setThemeSource(source: ThemeSource): void {
  localStorage.setItem(STORAGE_KEY, source);
  // 同步给主进程：Windows 标题栏按钮颜色与窗口底色跟随主题
  void window.yys.theme.set(source);
  apply(source);
}

export function initTheme(): void {
  const source = getThemeSource();
  void window.yys.theme.set(source);
  apply(source);
  media.addEventListener('change', () => apply(getThemeSource()));
}
