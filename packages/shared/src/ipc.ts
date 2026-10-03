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

/** 后台服务的位置：本机（默认，数据只在这台电脑上）或团队服务器（多台电脑共用一份数据） */
export type ConnectionConfig =
  | { mode: 'local' }
  | {
      mode: 'server';
      /** 如 https://203.0.113.10 */
      url: string;
      /** 服务器证书的 SHA-256 指纹（十六进制）；自签名证书靠它防止被冒充 */
      fingerprint: string;
      name?: string;
    };

export interface ConnectionInfo {
  mode: 'local' | 'server';
  url?: string;
  name?: string;
  /** 区分不同连接下的登录令牌与“记住密码”：local 或 s + 8 位十六进制 */
  scope: string;
}

/** 连接前探测服务器：证书指纹需用户确认后才保存 */
export interface ServerProbe {
  url: string;
  fingerprint: string;
  name: string;
  version: string;
}

export interface BookFile {
  name: string;
  /** base64 */
  data: string;
}

export interface DesktopBridge {
  platform: 'darwin' | 'win32' | 'linux';
  connection: {
    /** 窗口加载时确定；切换连接后窗口会重新加载 */
    current: ConnectionInfo;
    probe(url: string): Promise<ServerProbe>;
    use(config: ConnectionConfig): Promise<void>;
  };
  requestCorePort(): void;
  onCoreStatus(listener: (status: CoreStatus) => void): () => void;

  secrets: {
    set(ref: string, value: string): Promise<void>;
    remove(ref: string): Promise<void>;
    has(ref: string): Promise<boolean>;
  };
  dialog: {
    /** 选择书目文件并读取内容；用户取消时返回 null */
    openBookFile(): Promise<BookFile | null>;
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
  | { state: 'starting'; message?: string }
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
  connectionCurrent: 'connection:current',
  connectionProbe: 'connection:probe',
  connectionUse: 'connection:use',
} as const;

/** 服务器的 WebSocket RPC 路径与健康检查路径 */
export const SERVER_RPC_PATH = '/rpc';
export const SERVER_INFO_PATH = '/api/info';
export const serverMediaPath = (mediaId: string): string => `/media/${mediaId}`;

/** Main ↔ Core（utilityProcess parentPort）控制消息 */
export type MainToCore =
  { type: 'connect' } | { type: 'secret:result'; id: number; value: string | null };

export type CoreToMain =
  | { type: 'ready' }
  | { type: 'secret:get'; id: number; ref: string }
  | { type: 'secret:set'; ref: string; value: string }
  | { type: 'secret:remove'; ref: string }
  | { type: 'fatal'; message: string };

export const secretRefForProvider = (providerId: string): string => `provider:${providerId}`;
