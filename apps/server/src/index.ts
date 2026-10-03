import { randomBytes, X509Certificate } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createCore } from '@yys/core';
import { BUILTIN_ADMIN } from '@yys/shared';
import { startServer } from './server';
import { FileVault } from './vault';

declare const __APP_VERSION__: string;

const env = process.env;
const dataDir = env.YYS_DATA_DIR || '/var/lib/yiyeshuzhan';
const certPath = env.YYS_TLS_CERT || join(dataDir, 'tls', 'server.crt');
const keyPath = env.YYS_TLS_KEY || join(dataDir, 'tls', 'server.key');
mkdirSync(dataDir, { recursive: true, mode: 0o700 });

if (!existsSync(certPath) || !existsSync(keyPath)) {
  console.error(
    `缺少 TLS 证书：${certPath} / ${keyPath}\n` +
      '可运行 deploy/setup-server.sh 生成自签名证书，或通过 YYS_TLS_CERT / YYS_TLS_KEY 指定证书路径。',
  );
  process.exit(1);
}

/** 初始管理员密码：优先取环境变量；否则首次启动时随机生成并写入只有服务账号可读的文件 */
function initialAdminPassword(): string {
  if (env.YYS_ADMIN_PASSWORD) return env.YYS_ADMIN_PASSWORD;
  const file = join(dataDir, 'initial-admin-password.txt');
  if (existsSync(file)) return readFileSync(file, 'utf8').trim();
  const password = randomBytes(12).toString('base64url');
  writeFileSync(file, `${password}\n`, { mode: 0o600 });
  console.log(`已生成初始管理员密码，保存在 ${file}（首次登录后会要求修改）`);
  return password;
}

const cert = readFileSync(certPath);
const fingerprint = new X509Certificate(cert).fingerprint256;

const core = await createCore({
  dataDir,
  secrets: new FileVault(dataDir, env.YYS_MASTER_KEY),
  builtinAdmin: {
    username: env.YYS_ADMIN_USERNAME || BUILTIN_ADMIN.username,
    password: initialAdminPassword(),
  },
  revealDefaultPassword: false,
  info: {
    version: __APP_VERSION__,
    platform: `${process.platform}-${process.arch}`,
    nodeVersion: process.versions.node,
  },
  log: (message) => console.log(message),
  onError: (error) => console.error('[rpc]', error),
});

const server = await startServer({
  core,
  tls: { cert, key: readFileSync(keyPath) },
  host: env.YYS_HOST || '0.0.0.0',
  port: Number(env.YYS_PORT || 443),
  name: env.YYS_SERVER_NAME || '一页书展服务器',
  version: __APP_VERSION__,
});
console.log(`证书指纹（SHA-256）：${fingerprint}`);

const shutdown = (signal: string): void => {
  console.log(`收到 ${signal}，正在停止服务…`);
  void server.close().then(() => {
    core.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 5000).unref();
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', (reason) => console.error('[server] unhandledRejection', reason));
