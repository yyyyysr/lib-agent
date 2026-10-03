import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { openRepositories, type Repositories } from '@yys/db';
import type { FetchFunction } from '@yys/llm-gateway';
import type { AppInfo } from '@yys/shared';
import { AuthService } from './auth';
import { MediaStore } from './media';
import { RpcServer } from './rpc-server';
import { seedDefaultSchool, seedSampleLibrary } from './seed';
import { createServices } from './services/index';
import type { CoreDeps } from './services/context';

/** 服务商 API Key 与“记住密码”的存取：桌面端由主进程保险箱实现，服务器由加密文件实现 */
export interface SecretStore {
  get(ref: string): Promise<string | null>;
  set(ref: string, value: string): Promise<void>;
  remove(ref: string): void;
}

export interface CoreOptions {
  dataDir: string;
  secrets: SecretStore;
  builtinAdmin: { username: string; password: string };
  /** 单机模式在登录页提示内置管理员的初始密码；服务器必须关闭 */
  revealDefaultPassword: boolean;
  info: Omit<AppInfo, 'sqliteVersion' | 'dataDir' | 'coreStartedAt'>;
  fetch?: FetchFunction;
  /** 测试用：替换模型与生图 */
  createModel?: CoreDeps['createModel'];
  createImageGenerator?: CoreDeps['createImageGenerator'];
  log?: (message: string) => void;
  onError?: (error: unknown) => void;
}

export interface Core {
  server: RpcServer;
  repos: Repositories;
  auth: AuthService;
  media: MediaStore;
  close(): void;
}

/** 组装后台服务：数据库、示例数据、内置管理员、业务服务与 RPC 分发 */
export async function createCore(options: CoreOptions): Promise<Core> {
  const log = options.log ?? console.log;
  mkdirSync(join(options.dataDir, 'data'), { recursive: true });
  const repos = openRepositories(join(options.dataDir, 'data', 'yiyeshuzhan.db'));
  if (seedSampleLibrary(repos)) log('示例书库已就绪');
  if (seedDefaultSchool(repos)) log('已写入默认学校：中山大学');

  const auth = new AuthService(repos, {
    builtinAdmin: options.builtinAdmin,
    secrets: options.secrets,
    revealDefaultPassword: options.revealDefaultPassword,
  });
  if (await auth.ensureBuiltinAdmin()) log('已创建内置超级管理员账号');

  const media = new MediaStore(options.dataDir);
  let server: RpcServer | undefined;
  const { handlers, streams } = createServices({
    repos,
    auth,
    secrets: options.secrets,
    fetch: options.fetch,
    media,
    createModel: options.createModel,
    createImageGenerator: options.createImageGenerator,
    emit: (topic, payload) => server?.emit(topic, payload),
    info: {
      ...options.info,
      dataDir: options.dataDir,
      coreStartedAt: new Date().toISOString(),
    },
  });
  server = new RpcServer(
    handlers,
    streams,
    (token) => auth.authenticate(token),
    options.onError ?? ((error) => console.error('[core] handler error', error)),
  );
  return { server, repos, auth, media, close: () => repos.db.close() };
}
