/**
 * Renderer ↔ Main 的系统能力接口（经 preload 暴露为 window.yys）。
 * 业务调用一律走 Core 的 MessagePort，这里只放操作系统相关能力。
 */
export type ThemeSource = 'system' | 'light' | 'dark';

export interface DesktopBridge {
  platform: 'darwin' | 'win32' | 'linux';
  requestCorePort(): void;
  onCoreStatus(listener: (status: CoreStatus) => void): () => void;

  secrets: {
    set(ref: string, value: string): Promise<void>;
    remove(ref: string): Promise<void>;
    has(ref: string): Promise<boolean>;
  };
  dialog: {
    openBookFile(): Promise<string | null>;
  };
  shell: {
    openExternal(url: string): Promise<void>;
    showDataDir(): Promise<void>;
  };
  theme: {
    set(source: ThemeSource): Promise<void>;
  };
}

export type CoreStatus =
  | { state: 'starting' }
  | { state: 'ready' }
  | { state: 'restarting'; attempt: number; reason: string }
  | { state: 'failed'; reason: string };

export const ipcChannels = {
  requestCorePort: 'core:request-port',
  corePort: 'core:port',
  coreStatus: 'core:status',
  secretsSet: 'secrets:set',
  secretsRemove: 'secrets:remove',
  secretsHas: 'secrets:has',
  openBookFile: 'dialog:open-book-file',
  openExternal: 'shell:open-external',
  showDataDir: 'shell:show-data-dir',
  setTheme: 'theme:set',
} as const;

/** Main ↔ Core（utilityProcess parentPort）控制消息 */
export type MainToCore =
  | { type: 'connect' }
  | { type: 'secret:result'; id: number; value: string | null };

export type CoreToMain =
  | { type: 'ready' }
  | { type: 'secret:get'; id: number; ref: string }
  | { type: 'secret:remove'; ref: string }
  | { type: 'fatal'; message: string };

export const secretRefForProvider = (providerId: string): string => `provider:${providerId}`;
