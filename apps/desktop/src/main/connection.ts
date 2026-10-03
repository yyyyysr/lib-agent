import { createHash } from 'node:crypto';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import log from 'electron-log/main';
import type { ConnectionInfo } from '@yys/shared/ipc';
import type { PinnedServer } from './server-tls';

export type StoredConnection =
  { mode: 'local' } | ({ mode: 'server'; name?: string } & PinnedServer);

export const scopeFor = (connection: StoredConnection): string =>
  connection.mode === 'local'
    ? 'local'
    : `s${createHash('sha256').update(connection.url).digest('hex').slice(0, 8)}`;

export const connectionInfo = (connection: StoredConnection): ConnectionInfo =>
  connection.mode === 'local'
    ? { mode: 'local', scope: 'local' }
    : { mode: 'server', url: connection.url, name: connection.name, scope: scopeFor(connection) };

/** 连接设置保存在数据目录下；文件损坏或内容不完整时回到本机模式 */
export class ConnectionStore {
  private readonly file: string;

  constructor(
    dataDir: string,
    /** 仅未打包的开发构建允许 E2E 测试经环境变量指定服务器 */
    private readonly allowEnvOverride = false,
  ) {
    this.file = join(dataDir, 'connection.json');
  }

  load(): StoredConnection {
    const fromEnv = this.allowEnvOverride ? process.env.YYS_SERVER_CONNECTION : undefined;
    if (fromEnv) return JSON.parse(fromEnv) as StoredConnection;
    if (!existsSync(this.file)) return { mode: 'local' };
    try {
      const value = JSON.parse(readFileSync(this.file, 'utf8')) as StoredConnection;
      if (value.mode === 'server' && value.url && value.fingerprint && value.certificate)
        return value;
    } catch (error) {
      log.warn('[connection] 读取连接设置失败，使用本机模式', error);
    }
    return { mode: 'local' };
  }

  save(connection: StoredConnection): void {
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(connection, null, 2), { encoding: 'utf8', mode: 0o600 });
    renameSync(tmp, this.file);
  }
}
