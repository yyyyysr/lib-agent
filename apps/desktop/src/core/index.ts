import { readFileSync } from 'node:fs';
import { net } from 'electron';
import { createCore } from '@yys/core';
import { BUILTIN_ADMIN, type CoreToMain, type MainToCore } from '@yys/shared';
import type { PortLike } from '@yys/core';
import { SecretsClient } from './secrets-client';

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

const secrets = new SecretsClient(post);

// 走 Chromium 网络栈：自动遵循系统代理与证书配置
const appFetch: typeof globalThis.fetch = (input, init) =>
  net.fetch(input instanceof URL ? input.toString() : (input as string | Request), init);

// E2E 测试使用脚本化模型（demo 为截图用的演示内容）；主进程只在未打包的开发构建中传入该变量
const scriptMode = process.env.YYS_E2E_SCRIPTED_MODEL;
const testing =
  scriptMode === '1' || scriptMode === 'demo' ? await import('@yys/agent-core/testing') : null;
const scriptedModel = testing
  ? testing.createScriptedModel(scriptMode === 'demo' ? testing.demoScript : {}).model
  : null;
const demoArtwork =
  scriptMode === 'demo' && process.env.YYS_DEMO_ARTWORK
    ? new Uint8Array(readFileSync(process.env.YYS_DEMO_ARTWORK))
    : null;
let artworkSeed = 0;

const core = await createCore({
  dataDir,
  secrets,
  builtinAdmin: {
    username: process.env.YYS_ADMIN_USERNAME || BUILTIN_ADMIN.username,
    password: process.env.YYS_ADMIN_PASSWORD || BUILTIN_ADMIN.password,
  },
  revealDefaultPassword: true,
  fetch: appFetch,
  createModel: scriptedModel ? () => scriptedModel : undefined,
  createImageGenerator: testing
    ? () => async () =>
        demoArtwork
          ? { data: demoArtwork, mediaType: 'image/jpeg' }
          : { data: testing.makeArtworkPng(600, 800, ++artworkSeed), mediaType: 'image/png' }
    : undefined,
  info: {
    version: process.env.YYS_APP_VERSION ?? '0.0.0',
    platform: `${process.platform}-${process.arch}`,
    nodeVersion: process.versions.node,
  },
  log: (message) => console.log(message),
});

parentPort.on('message', (event) => {
  const message = event.data as MainToCore;
  switch (message.type) {
    case 'connect': {
      const port = event.ports[0];
      if (port) core.server.attach(port as unknown as PortLike);
      break;
    }
    case 'secret:result':
      secrets.resolve(message.id, message.value);
      break;
  }
});

process.on('exit', () => core.close());
post({ type: 'ready' });
