import { app, dialog, ipcMain, nativeTheme, shell, BrowserWindow, type IpcMainInvokeEvent } from 'electron';
import { ipcChannels, supportedImportExtensions, type ThemeSource } from '@yys/shared';
import type { CoreHost } from './core-host';
import type { SecretVault } from './secrets';

const secretRefPattern = /^provider:[A-Za-z0-9_-]{1,64}$/;

/** 只接受来自本应用页面的调用 */
function assertTrusted(event: IpcMainInvokeEvent | Electron.IpcMainEvent): void {
  const url = event.senderFrame?.url ?? '';
  const devUrl = process.env.ELECTRON_RENDERER_URL;
  const trusted = url.startsWith('file://') || (devUrl !== undefined && url.startsWith(devUrl));
  if (!trusted) throw new Error(`拒绝来自不受信任页面的调用：${url}`);
}

function handle<T extends unknown[], R>(channel: string, fn: (event: IpcMainInvokeEvent, ...args: T) => R): void {
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
    if (typeof value !== 'string' || value.length === 0 || value.length > 4096) throw new Error('无效的 API Key');
    deps.vault.set(ref, value.trim());
  });
  handle(ipcChannels.secretsRemove, (_e, ref: unknown) => {
    if (typeof ref === 'string' && secretRefPattern.test(ref)) deps.vault.remove(ref);
  });
  handle(ipcChannels.secretsHas, (_e, ref: unknown) => typeof ref === 'string' && deps.vault.has(ref));

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
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
    return result.canceled ? null : (result.filePaths[0] ?? null);
  });

  handle(ipcChannels.openExternal, async (_e, url: unknown) => {
    if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) throw new Error('只允许打开 http/https 链接');
    await shell.openExternal(url);
  });
  handle(ipcChannels.showDataDir, async () => {
    await shell.openPath(deps.dataDir);
  });
  handle(ipcChannels.setTheme, (_e, source: unknown) => {
    if (source === 'system' || source === 'light' || source === 'dark') nativeTheme.themeSource = source as ThemeSource;
  });

  app.on('web-contents-created', (_e, contents) => {
    contents.on('will-attach-webview', (event) => event.preventDefault());
  });
}
