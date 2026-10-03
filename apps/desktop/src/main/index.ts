import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { app, BrowserWindow } from 'electron';
import log from 'electron-log/main';
import { Backend } from './backend';
import { ConnectionStore } from './connection';
import { registerIpc } from './ipc';
import { handleMediaProtocol, registerMediaScheme } from './media-protocol';
import { installMenu } from './menu';
import { SecretVault } from './secrets';
import { createMainWindow } from './window';

// 用 ASCII 目录名存放数据，避免个别 Windows 环境下的路径编码问题；E2E 测试通过环境变量隔离数据目录
app.setPath(
  'userData',
  process.env.YYS_USER_DATA_DIR || join(app.getPath('appData'), 'YiyeShuzhan'),
);
const dataDir = app.getPath('userData');
mkdirSync(dataDir, { recursive: true });

registerMediaScheme();

log.initialize();
log.transports.file.resolvePathFn = () => join(dataDir, 'logs', 'main.log');
log.transports.file.maxSize = 5 * 1024 * 1024;
log.errorHandler.startCatching();

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  let mainWindow: BrowserWindow | null = null;
  let backend: Backend | null = null;

  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  void app.whenReady().then(() => {
    log.info(`[app] 启动 ${app.getVersion()} on ${process.platform}-${process.arch}`);
    // 示例书库的封面随应用附带，离线也能显示
    const bundledCovers = app.isPackaged
      ? join(process.resourcesPath, 'covers')
      : join(import.meta.dirname, '../../resources/covers');
    const vault = new SecretVault(dataDir);
    const current = new Backend({
      dataDir,
      appVersion: app.getVersion(),
      vault,
      store: new ConnectionStore(dataDir, !app.isPackaged),
    });
    backend = current;
    handleMediaProtocol(dataDir, bundledCovers, () => current.pinnedServer());
    registerIpc({ backend: current, vault, dataDir });
    installMenu();
    current.start();
    mainWindow = createMainWindow();
    mainWindow.on('closed', () => (mainWindow = null));

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        mainWindow = createMainWindow();
        mainWindow.on('closed', () => (mainWindow = null));
      }
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('before-quit', () => backend?.stop());
}
