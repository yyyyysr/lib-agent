import { MessageChannelMain, utilityProcess, type UtilityProcess, type WebContents } from 'electron';
import log from 'electron-log/main';
import { ipcChannels, type CoreStatus, type CoreToMain, type MainToCore } from '@yys/shared';
import coreEntry from '../core/index?modulePath';
import type { SecretVault } from './secrets';

const MAX_RESTARTS = 5;
const RESTART_WINDOW_MS = 60_000;

/**
 * 守护 Core utilityProcess：启动、崩溃后指数退避重启、为每个窗口分发直连 Core 的 MessagePort。
 */
export class CoreHost {
  private child: UtilityProcess | null = null;
  private ready = false;
  private stopping = false;
  private restarts: number[] = [];
  private status: CoreStatus = { state: 'starting' };
  private readonly clients = new Set<WebContents>();

  constructor(
    private readonly options: { dataDir: string; appVersion: string; vault: SecretVault },
  ) {}

  start(): void {
    this.ready = false;
    const child = utilityProcess.fork(coreEntry, [], {
      serviceName: 'YiyeShuzhan Core',
      stdio: 'pipe',
      env: {
        ...process.env,
        YYS_DATA_DIR: this.options.dataDir,
        YYS_APP_VERSION: this.options.appVersion,
      },
    });
    this.child = child;

    child.stdout?.on('data', (chunk: Buffer) => log.info(`[core] ${chunk.toString().trimEnd()}`));
    child.stderr?.on('data', (chunk: Buffer) => log.warn(`[core] ${chunk.toString().trimEnd()}`));

    child.on('message', (message: CoreToMain) => this.onMessage(child, message));
    child.on('exit', (code) => {
      if (this.child !== child) return;
      this.child = null;
      this.ready = false;
      if (this.stopping) return;
      log.error(`[core] 进程退出，code=${code}`);
      this.scheduleRestart(`后台服务意外退出（code ${code}）`);
    });
  }

  stop(): void {
    this.stopping = true;
    this.child?.kill();
    this.child = null;
  }

  /** 为窗口建立到 Core 的直连通道；Core 未就绪时在就绪后补发 */
  connect(webContents: WebContents): void {
    if (!this.clients.has(webContents)) {
      this.clients.add(webContents);
      webContents.once('destroyed', () => this.clients.delete(webContents));
    }
    webContents.send(ipcChannels.coreStatus, this.status);
    if (this.ready) this.sendPort(webContents);
  }

  private onMessage(child: UtilityProcess, message: CoreToMain): void {
    switch (message.type) {
      case 'ready':
        this.ready = true;
        this.setStatus({ state: 'ready' });
        for (const client of this.clients) this.sendPort(client);
        break;
      case 'secret:get': {
        const reply: MainToCore = { type: 'secret:result', id: message.id, value: this.options.vault.get(message.ref) };
        child.postMessage(reply);
        break;
      }
      case 'secret:remove':
        this.options.vault.remove(message.ref);
        break;
      case 'fatal':
        log.error(`[core] 致命错误：${message.message}`);
        break;
    }
  }

  private sendPort(webContents: WebContents): void {
    if (!this.child || webContents.isDestroyed()) return;
    const { port1, port2 } = new MessageChannelMain();
    const connect: MainToCore = { type: 'connect' };
    this.child.postMessage(connect, [port1]);
    webContents.postMessage(ipcChannels.corePort, null, [port2]);
  }

  private scheduleRestart(reason: string): void {
    const now = Date.now();
    this.restarts = this.restarts.filter((t) => now - t < RESTART_WINDOW_MS);
    if (this.restarts.length >= MAX_RESTARTS) {
      this.setStatus({ state: 'failed', reason: `${reason}；短时间内多次重启失败，请重新打开应用或导出诊断日志` });
      return;
    }
    this.restarts.push(now);
    const attempt = this.restarts.length;
    this.setStatus({ state: 'restarting', attempt, reason });
    setTimeout(() => {
      if (!this.stopping) this.start();
    }, 500 * 2 ** (attempt - 1));
  }

  private setStatus(status: CoreStatus): void {
    this.status = status;
    for (const client of this.clients) {
      if (!client.isDestroyed()) client.send(ipcChannels.coreStatus, status);
    }
  }
}
