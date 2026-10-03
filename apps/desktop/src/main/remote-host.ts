import { MessageChannelMain, type MessagePortMain, type WebContents } from 'electron';
import log from 'electron-log/main';
import WebSocket from 'ws';
import {
  secretRefForAccount,
  SERVER_RPC_PATH,
  type AppErrorShape,
  type WireMessage,
} from '@yys/shared';
import { ipcChannels, type CoreStatus } from '@yys/shared/ipc';
import { pinnedTlsOptions, type PinnedServer } from './server-tls';
import type { SecretVault } from './secrets';

const HEARTBEAT_MS = 25_000;
const MAX_BACKOFF_MS = 30_000;
const MAX_MESSAGE_BYTES = 32 * 1024 * 1024;

export interface BackendHost {
  start(): void;
  stop(): void;
  connect(webContents: WebContents): void;
}

interface Link {
  socket: WebSocket | null;
  port: MessagePortMain | null;
  attempt: number;
  connectedOnce: boolean;
  timer: NodeJS.Timeout | null;
  heartbeat: NodeJS.Timeout | null;
  /** 改写为 auth.login 的“记住密码”登录：请求 id → 保险箱引用 */
  remembered: Map<number, string>;
}

/**
 * 连接团队服务器：每个窗口一条 WebSocket，与窗口之间仍用 MessagePort，界面代码与本机模式完全相同。
 * 断线后指数退避重连，重连成功后给窗口换新端口（进行中的请求以可重试错误结束）。
 */
export class RemoteHost implements BackendHost {
  private readonly links = new Map<WebContents, Link>();
  private stopped = false;
  private status: CoreStatus = { state: 'starting', message: '正在连接服务器…' };

  constructor(
    private readonly server: PinnedServer & { scope: string },
    private readonly vault: SecretVault,
  ) {}

  start(): void {
    this.stopped = false;
  }

  stop(): void {
    this.stopped = true;
    for (const [webContents] of this.links) this.close(webContents);
    this.links.clear();
  }

  connect(webContents: WebContents): void {
    webContents.send(ipcChannels.coreStatus, this.status);
    if (this.links.has(webContents)) this.close(webContents);
    const link: Link = {
      socket: null,
      port: null,
      attempt: 0,
      connectedOnce: false,
      timer: null,
      heartbeat: null,
      remembered: new Map(),
    };
    this.links.set(webContents, link);
    webContents.once('destroyed', () => {
      this.close(webContents);
      this.links.delete(webContents);
    });
    this.open(webContents, link);
  }

  private open(webContents: WebContents, link: Link): void {
    if (this.stopped || webContents.isDestroyed()) return;
    const url = `${this.server.url.replace(/^https:/, 'wss:')}${SERVER_RPC_PATH}`;
    // ws 把 TLS 选项原样交给 tls.connect；其类型定义中的 checkServerIdentity 签名过时
    const socket = new WebSocket(url, {
      ...(pinnedTlsOptions(this.server) as unknown as WebSocket.ClientOptions),
      handshakeTimeout: 10_000,
      maxPayload: MAX_MESSAGE_BYTES,
      perMessageDeflate: true,
    });
    link.socket = socket;

    socket.on('open', () => {
      link.attempt = 0;
      link.connectedOnce = true;
      const { port1, port2 } = new MessageChannelMain();
      link.port?.close();
      link.port = port1;
      link.remembered.clear();
      port1.on('message', (event) => this.forward(link, event.data as WireMessage));
      port1.start();
      if (!webContents.isDestroyed()) webContents.postMessage(ipcChannels.corePort, null, [port2]);
      link.heartbeat = setInterval(() => socket.ping(), HEARTBEAT_MS);
      this.setStatus({ state: 'ready' });
    });

    socket.on('message', (raw) => {
      let message: WireMessage;
      try {
        message = JSON.parse(raw.toString()) as WireMessage;
      } catch {
        return;
      }
      link.port?.postMessage(this.inbound(link, message));
    });

    socket.on('error', (error) => {
      log.warn(`[remote] ${error.message}`);
      if (/证书/.test(error.message))
        this.setStatus({
          state: 'failed',
          reason: error.message + '；如服务器更换了证书，请在设置中重新连接',
        });
    });

    socket.on('close', () => {
      if (link.heartbeat) clearInterval(link.heartbeat);
      link.heartbeat = null;
      if (link.socket !== socket || this.stopped || webContents.isDestroyed()) return;
      if (this.status.state === 'failed' && /证书/.test(this.status.reason)) return;
      link.attempt += 1;
      const delay = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** (link.attempt - 1));
      this.setStatus({
        state: 'restarting',
        attempt: link.attempt,
        reason:
          link.connectedOnce && link.attempt === 1 ? '与服务器的连接已断开' : '暂时连不上服务器',
      });
      link.timer = setTimeout(() => this.open(webContents, link), delay);
    });

    socket.on('unexpected-response', (_req, res) => {
      socket.terminate();
      log.warn(`[remote] 服务器拒绝了连接：HTTP ${res.statusCode}`);
    });
  }

  /** 发往服务器；“记住密码”登录在本机取出密码后改写为普通登录 */
  private forward(link: Link, message: WireMessage): void {
    const socket = link.socket;
    if (message.kind === 'req' && message.method === 'auth.loginRemembered') {
      const username = (message.params as { username?: unknown } | undefined)?.username;
      const ref =
        typeof username === 'string' ? secretRefForAccount(username, this.server.scope) : null;
      const password = ref ? this.vault.get(ref) : null;
      if (!ref || !password) {
        const error: AppErrorShape = {
          code: 'not_found',
          message: '本机没有保存这个账号的密码',
          hint: '请输入密码登录',
        };
        link.port?.postMessage({ kind: 'res', id: message.id, error } satisfies WireMessage);
        return;
      }
      link.remembered.set(message.id, ref);
      message = { ...message, method: 'auth.login', params: { username, password } };
    }
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
    else if (message.kind === 'req')
      link.port?.postMessage({
        kind: 'res',
        id: message.id,
        error: { code: 'core_unavailable', message: '暂时连不上服务器，请稍后重试' },
      } satisfies WireMessage);
  }

  private inbound(link: Link, message: WireMessage): WireMessage {
    if (message.kind !== 'res') return message;
    const ref = link.remembered.get(message.id);
    if (!ref) return message;
    link.remembered.delete(message.id);
    if (message.error?.code !== 'unauthorized') return message;
    this.vault.remove(ref);
    return {
      ...message,
      error: {
        code: 'unauthorized',
        message: '保存的密码已失效',
        hint: '密码可能已被修改或重置，请重新输入',
      },
    };
  }

  private close(webContents: WebContents): void {
    const link = this.links.get(webContents);
    if (!link) return;
    if (link.timer) clearTimeout(link.timer);
    if (link.heartbeat) clearInterval(link.heartbeat);
    const socket = link.socket;
    link.socket = null;
    socket?.close();
    link.port?.close();
    link.port = null;
  }

  private setStatus(status: CoreStatus): void {
    this.status = status;
    for (const webContents of this.links.keys()) {
      if (!webContents.isDestroyed()) webContents.send(ipcChannels.coreStatus, status);
    }
  }
}
