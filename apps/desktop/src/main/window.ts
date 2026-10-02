import { join } from 'node:path';
import { BrowserWindow, nativeTheme, shell } from 'electron';

const isMac = process.platform === 'darwin';
export const TITLE_BAR_HEIGHT = 48;

/** 与 renderer 中的设计令牌保持一致：主区背景 / 文字 */
const palette = {
  light: { bg: '#ffffff', fg: '#0d0d0d' },
  dark: { bg: '#212121', fg: '#ececec' },
};

const currentPalette = (): (typeof palette)['light'] => (nativeTheme.shouldUseDarkColors ? palette.dark : palette.light);

export function createMainWindow(): BrowserWindow {
  const colors = currentPalette();
  const win = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 960,
    minHeight: 600,
    show: false,
    title: '一页书展',
    backgroundColor: colors.bg,
    titleBarStyle: 'hidden',
    ...(isMac
      ? { trafficLightPosition: { x: 18, y: 17 } }
      : { titleBarOverlay: { color: colors.bg, symbolColor: colors.fg, height: TITLE_BAR_HEIGHT } }),
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.cjs'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });

  win.once('ready-to-show', () => win.show());

  // 外部链接一律交给系统浏览器；应用窗口内不打开任何第三方页面（包括学校登录页）
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (url !== win.webContents.getURL()) {
      event.preventDefault();
      if (/^https?:\/\//i.test(url) && !url.startsWith(process.env.ELECTRON_RENDERER_URL ?? '\0')) {
        void shell.openExternal(url);
      }
    }
  });

  const onTheme = (): void => {
    if (isMac || win.isDestroyed()) return;
    const next = currentPalette();
    win.setTitleBarOverlay({ color: next.bg, symbolColor: next.fg, height: TITLE_BAR_HEIGHT });
    win.setBackgroundColor(next.bg);
  };
  nativeTheme.on('updated', onTheme);
  win.on('closed', () => nativeTheme.off('updated', onTheme));

  if (process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void win.loadFile(join(import.meta.dirname, '../renderer/index.html'));
  }
  return win;
}
