/// <reference lib="dom" />
import { contextBridge, ipcRenderer } from 'electron';
import { ipcChannels, type CoreStatus, type DesktopBridge, type ThemeSource } from '@yys/shared/ipc';

export const CORE_PORT_MESSAGE = 'yys:core-port';

// MessagePort 不能经 contextBridge 传递，只能用 window.postMessage 转交给页面主世界
ipcRenderer.on(ipcChannels.corePort, (event) => {
  window.postMessage(CORE_PORT_MESSAGE, window.location.origin === 'null' ? '*' : window.location.origin, event.ports);
});

const bridge: DesktopBridge = {
  platform: process.platform as DesktopBridge['platform'],
  requestCorePort: () => ipcRenderer.send(ipcChannels.requestCorePort),
  onCoreStatus: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, status: CoreStatus): void => listener(status);
    ipcRenderer.on(ipcChannels.coreStatus, handler);
    return () => ipcRenderer.off(ipcChannels.coreStatus, handler);
  },
  secrets: {
    set: (ref, value) => ipcRenderer.invoke(ipcChannels.secretsSet, ref, value),
    remove: (ref) => ipcRenderer.invoke(ipcChannels.secretsRemove, ref),
    has: (ref) => ipcRenderer.invoke(ipcChannels.secretsHas, ref),
  },
  dialog: {
    openBookFile: () => ipcRenderer.invoke(ipcChannels.openBookFile),
  },
  shell: {
    openExternal: (url) => ipcRenderer.invoke(ipcChannels.openExternal, url),
    showDataDir: () => ipcRenderer.invoke(ipcChannels.showDataDir),
  },
  theme: {
    set: (source: ThemeSource) => ipcRenderer.invoke(ipcChannels.setTheme, source),
  },
};

contextBridge.exposeInMainWorld('yys', bridge);
