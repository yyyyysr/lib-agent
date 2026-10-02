import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  app,
  dialog,
  ipcMain,
  nativeTheme,
  shell,
  BrowserWindow,
  type IpcMainInvokeEvent,
} from 'electron';
import { ipcChannels, supportedImportExtensions, type ThemeSource } from '@yys/shared/ipc';
import type { CoreHost } from './core-host';
import type { SecretVault } from './secrets';

const secretRefPattern = /^(provider|account):[A-Za-z0-9_.-]{1,64}$/;

/** 去掉 Windows / macOS 文件名中不允许的字符 */
const safeFileName = (name: string): string =>
  name
    .replace(/[\\/:*?"<>|\r\n]+/g, ' ')
    .trim()
    .slice(0, 120) || '一页书展';

/** 只接受来自本应用页面的调用 */
function assertTrusted(event: IpcMainInvokeEvent | Electron.IpcMainEvent): void {
  const url = event.senderFrame?.url ?? '';
  const devUrl = process.env.ELECTRON_RENDERER_URL;
  const trusted = url.startsWith('file://') || (devUrl !== undefined && url.startsWith(devUrl));
  if (!trusted) throw new Error(`拒绝来自不受信任页面的调用：${url}`);
}

function handle<T extends unknown[], R>(
  channel: string,
  fn: (event: IpcMainInvokeEvent, ...args: T) => R,
): void {
  ipcMain.handle(channel, (event, ...args) => {
    assertTrusted(event);
    return fn(event, ...(args as T));
  });
}

export function registerIpc(deps: { core: CoreHost; vault: SecretVault; dataDir: string }): void {
  ipcMain.on(ipcChannels.requestCorePort, (event) => {
    assertTrusted(event);
    deps.core.connect(event.sender);
  });

  handle(ipcChannels.secretsSet, (_e, ref: unknown, value: unknown) => {
    if (typeof ref !== 'string' || !secretRefPattern.test(ref)) throw new Error('无效的密钥引用');
    if (typeof value !== 'string' || value.length === 0 || value.length > 4096)
      throw new Error('无效的密钥内容');
    // 账号密码按原样保存；API Key 去除复制时带入的首尾空白
    deps.vault.set(ref, ref.startsWith('account:') ? value : value.trim());
  });
  handle(ipcChannels.secretsRemove, (_e, ref: unknown) => {
    if (typeof ref === 'string' && secretRefPattern.test(ref)) deps.vault.remove(ref);
  });
  handle(
    ipcChannels.secretsHas,
    (_e, ref: unknown) => typeof ref === 'string' && deps.vault.has(ref),
  );

  handle(ipcChannels.openBookFile, async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const options: Electron.OpenDialogOptions = {
      title: '导入书目',
      properties: ['openFile'],
      filters: [
        { name: '书目文件（Excel / CSV / TXT / JSON）', extensions: supportedImportExtensions },
        { name: '所有文件', extensions: ['*'] },
      ],
    };
    const result = win
      ? await dialog.showOpenDialog(win, options)
      : await dialog.showOpenDialog(options);
    return result.canceled ? null : (result.filePaths[0] ?? null);
  });

  handle(ipcChannels.saveText, async (event, defaultName: unknown, content: unknown) => {
    if (typeof defaultName !== 'string' || typeof content !== 'string')
      throw new Error('参数不合法');
    const win = BrowserWindow.fromWebContents(event.sender);
    const options: Electron.SaveDialogOptions = {
      defaultPath: join(app.getPath('documents'), safeFileName(defaultName)),
      filters: [
        { name: 'Markdown', extensions: ['md'] },
        { name: '文本', extensions: ['txt'] },
      ],
    };
    const result = win
      ? await dialog.showSaveDialog(win, options)
      : await dialog.showSaveDialog(options);
    if (result.canceled || !result.filePath) return null;
    await writeFile(result.filePath, content, 'utf8');
    return result.filePath;
  });

  handle(ipcChannels.savePng, async (event, defaultName: unknown, rect: unknown) => {
    const r = rect as { x?: unknown; y?: unknown; width?: unknown; height?: unknown };
    if (
      typeof defaultName !== 'string' ||
      ![r?.x, r?.y, r?.width, r?.height].every((v) => typeof v === 'number' && Number.isFinite(v))
    ) {
      throw new Error('参数不合法');
    }
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return null;
    const area = {
      x: Math.round(r.x as number),
      y: Math.round(r.y as number),
      width: Math.round(r.width as number),
      height: Math.round(r.height as number),
    };
    // 先截图再弹对话框，避免对话框遮挡被截区域
    const image = await win.webContents.capturePage(area);
    const result = await dialog.showSaveDialog(win, {
      defaultPath: join(app.getPath('pictures'), safeFileName(defaultName)),
      filters: [{ name: 'PNG 图片', extensions: ['png'] }],
    });
    if (result.canceled || !result.filePath) return null;
    await writeFile(result.filePath, image.toPNG());
    return result.filePath;
  });

  handle(ipcChannels.openExternal, async (_e, url: unknown) => {
    if (typeof url !== 'string' || !/^https?:\/\//i.test(url))
      throw new Error('只允许打开 http/https 链接');
    await shell.openExternal(url);
  });
  handle(ipcChannels.showDataDir, async () => {
    await shell.openPath(deps.dataDir);
  });
  handle(ipcChannels.setTheme, (_e, source: unknown) => {
    if (source === 'system' || source === 'light' || source === 'dark')
      nativeTheme.themeSource = source as ThemeSource;
  });

  app.on('web-contents-created', (_e, contents) => {
    contents.on('will-attach-webview', (event) => event.preventDefault());
  });
}
