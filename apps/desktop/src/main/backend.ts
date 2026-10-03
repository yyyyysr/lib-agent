import { BrowserWindow, type WebContents } from 'electron';
import log from 'electron-log/main';
import type { ConnectionConfig, ConnectionInfo, ServerProbe } from '@yys/shared/ipc';
import {
  connectionInfo,
  scopeFor,
  type ConnectionStore,
  type StoredConnection,
} from './connection';
import { CoreHost } from './core-host';
import { RemoteHost, type BackendHost } from './remote-host';
import type { SecretVault } from './secrets';
import { normalizeServerUrl, probeServer, type PinnedServer } from './server-tls';

/** 当前后台服务：本机 Core 或团队服务器；切换后重新加载所有窗口 */
export class Backend {
  private connection: StoredConnection;
  private host: BackendHost;
  /** 探测过的服务器证书：只有用户在界面上确认过的指纹才能保存 */
  private readonly probes = new Map<string, PinnedServer>();

  constructor(
    private readonly deps: {
      dataDir: string;
      appVersion: string;
      vault: SecretVault;
      store: ConnectionStore;
    },
  ) {
    this.connection = deps.store.load();
    this.host = this.createHost();
  }

  get info(): ConnectionInfo {
    return connectionInfo(this.connection);
  }

  /** 远程模式下供图片下载使用 */
  pinnedServer(): PinnedServer | null {
    return this.connection.mode === 'server' ? this.connection : null;
  }

  start(): void {
    log.info(
      this.connection.mode === 'server'
        ? `[backend] 连接服务器 ${this.connection.url}`
        : '[backend] 使用本机后台服务',
    );
    this.host.start();
  }

  stop(): void {
    this.host.stop();
  }

  connect(webContents: WebContents): void {
    this.host.connect(webContents);
  }

  async probe(url: string): Promise<ServerProbe> {
    const { certificate, ...probe } = await probeServer(url);
    this.probes.set(probe.url, { url: probe.url, fingerprint: probe.fingerprint, certificate });
    return probe;
  }

  use(config: ConnectionConfig): void {
    let next: StoredConnection;
    if (config.mode === 'local') next = { mode: 'local' };
    else {
      const url = normalizeServerUrl(config.url);
      const probed = this.probes.get(url);
      if (!probed || probed.fingerprint !== config.fingerprint.toLowerCase())
        throw new Error('请先测试连接并确认服务器证书');
      next = { mode: 'server', name: config.name, ...probed };
    }
    this.deps.store.save(next);
    // 先让界面收到回复，再切换并重新加载窗口
    setImmediate(() => {
      this.host.stop();
      this.connection = next;
      this.host = this.createHost();
      this.start();
      for (const win of BrowserWindow.getAllWindows()) win.webContents.reload();
    });
  }

  private createHost(): BackendHost {
    const { connection } = this;
    return connection.mode === 'server'
      ? new RemoteHost({ ...connection, scope: scopeFor(connection) }, this.deps.vault)
      : new CoreHost({
          dataDir: this.deps.dataDir,
          appVersion: this.deps.appVersion,
          vault: this.deps.vault,
        });
  }
}
