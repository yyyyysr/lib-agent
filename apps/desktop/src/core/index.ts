import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { net } from 'electron';
import { openRepositories } from '@yys/db';
import { BUILTIN_ADMIN, type CoreToMain, type MainToCore } from '@yys/shared';
import { AuthService } from './auth';
import { MediaStore } from './media';
import { RpcServer, type PortLike } from './rpc-server';
import { SecretsClient } from './secrets-client';
import { seedDefaultSchool, seedSampleLibrary } from './seed';
import { createServices } from './services/index';

const parentPort = process.parentPort;
if (!parentPort) throw new Error('Core 必须在 Electron utilityProcess 中运行');

const post = (message: CoreToMain): void => parentPort.postMessage(message);

process.on('uncaughtException', (error) => {
  console.error('[core] uncaughtException', error);
  post({ type: 'fatal', message: String(error?.stack ?? error) });
  process.exit(1);
});
process.on('unhandledRejection', (reason) => {
  console.error('[core] unhandledRejection', reason);
});

const dataDir = process.env.YYS_DATA_DIR;
if (!dataDir) throw new Error('缺少 YYS_DATA_DIR');
mkdirSync(join(dataDir, 'data'), { recursive: true });

const repos = openRepositories(join(dataDir, 'data', 'yiyeshuzhan.db'));
if (seedSampleLibrary(repos)) console.log('[core] 示例书库已就绪');
if (seedDefaultSchool(repos)) console.log('[core] 已写入默认学校：中山大学');

const secrets = new SecretsClient(post);

// 走 Chromium 网络栈：自动遵循系统代理与证书配置
const appFetch: typeof globalThis.fetch = (input, init) =>
  net.fetch(input instanceof URL ? input.toString() : (input as string | Request), init);

// E2E 测试使用脚本化模型；主进程只在未打包的开发构建中传入该变量
const testing =
  process.env.YYS_E2E_SCRIPTED_MODEL === '1' ? await import('@yys/agent-core/testing') : null;
const scriptedModel = testing ? testing.createScriptedModel().model : null;
let artworkSeed = 0;

const auth = new AuthService(repos, {
  builtinAdmin: {
    username: process.env.YYS_ADMIN_USERNAME || BUILTIN_ADMIN.username,
    password: process.env.YYS_ADMIN_PASSWORD || BUILTIN_ADMIN.password,
  },
  secrets,
});
if (await auth.ensureBuiltinAdmin()) console.log('[core] 已创建内置超级管理员账号');
let server: RpcServer;
const { handlers, streams } = createServices({
  repos,
  auth,
  secrets,
  fetch: appFetch,
  media: new MediaStore(dataDir),
  createModel: scriptedModel ? () => scriptedModel : undefined,
  createImageGenerator: testing
    ? () => async () => ({
        data: testing.makeArtworkPng(600, 800, ++artworkSeed),
        mediaType: 'image/png',
      })
    : undefined,
  emit: (topic, payload) => server.emit(topic, payload),
  info: {
    version: process.env.YYS_APP_VERSION ?? '0.0.0',
    dataDir,
    platform: `${process.platform}-${process.arch}`,
    nodeVersion: process.versions.node,
    coreStartedAt: new Date().toISOString(),
  },
});
server = new RpcServer(
  handlers,
  streams,
  (token) => auth.authenticate(token),
  (error) => console.error('[core] handler error', error),
);

parentPort.on('message', (event) => {
  const message = event.data as MainToCore;
  switch (message.type) {
    case 'connect': {
      const port = event.ports[0];
      if (port) server.attach(port as unknown as PortLike);
      break;
    }
    case 'secret:result':
      secrets.resolve(message.id, message.value);
      break;
  }
});

process.on('exit', () => repos.db.close());
post({ type: 'ready' });
