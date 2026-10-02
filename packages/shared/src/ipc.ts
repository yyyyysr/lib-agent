/**
 * Renderer ↔ Main 的系统能力接口（经 preload 暴露为 window.yys）。
 * 业务调用一律走 Core 的 MessagePort，这里只放操作系统相关能力。
 */
export type ThemeSource = 'system' | 'light' | 'dark';

/** 本地媒体协议：AI 生成的图片与封面缓存都经主进程提供，界面不直接访问文件系统 */
export const MEDIA_SCHEME = 'yys-media';
export const mediaUrl = (mediaId: string): string => `${MEDIA_SCHEME}://media/${mediaId}`;
/** 封面图经本地缓存加载：首次以普通请求下载，之后离线可用 */
export const coverUrlFor = (url: string): string =>
  `${MEDIA_SCHEME}://cover/?u=${encodeURIComponent(url)}`;
export const mediaIdPattern = /^img_[a-f0-9]{16}$/;

export const supportedImportExtensions = ['csv', 'tsv', 'txt', 'xlsx', 'xlsm', 'json', 'jsonl'];

export interface CaptureRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

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
  files: {
    /** 弹出保存对话框写入文本文件，返回保存路径；用户取消时返回 null */
    saveText(defaultName: string, content: string): Promise<string | null>;
    /** 截取当前窗口中的一块区域保存为 PNG（用于导出海报） */
    savePng(defaultName: string, rect: CaptureRect): Promise<string | null>;
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
  saveText: 'files:save-text',
  savePng: 'files:save-png',
  openExternal: 'shell:open-external',
  showDataDir: 'shell:show-data-dir',
  setTheme: 'theme:set',
} as const;

/** Main ↔ Core（utilityProcess parentPort）控制消息 */
export type MainToCore =
  { type: 'connect' } | { type: 'secret:result'; id: number; value: string | null };

export type CoreToMain =
  | { type: 'ready' }
  | { type: 'secret:get'; id: number; ref: string }
  | { type: 'secret:remove'; ref: string }
  | { type: 'fatal'; message: string };

export const secretRefForProvider = (providerId: string): string => `provider:${providerId}`;
