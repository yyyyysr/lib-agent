import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { request } from 'node:https';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { createCore, type Core } from '@yys/core';
import type { AuthResult, ProviderConfig, WireMessage } from '@yys/shared';
import { RateLimiter } from './rate-limit';
import { startServer, type RunningServer } from './server';
import { FileVault } from './vault';

const hasOpenssl = (() => {
  try {
    execFileSync('openssl', ['version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

describe('FileVault', () => {
  it('加密保存、按引用解密；文件中没有明文，换主密钥无法解出', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'yys-vault-'));
    const vault = new FileVault(dir);
    await vault.set('provider:p1', 'sk-secret-value');
    expect(await vault.get('provider:p1')).toBe('sk-secret-value');
    expect(readFileSync(join(dir, 'secrets.json'), 'utf8')).not.toContain('sk-secret-value');
    expect(await new FileVault(dir).get('provider:p1')).toBe('sk-secret-value');
    const other = new FileVault(dir, Buffer.alloc(32, 1).toString('base64'));
    expect(await other.get('provider:p1')).toBeNull();
    vault.remove('provider:p1');
    expect(await vault.get('provider:p1')).toBeNull();
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('RateLimiter', () => {
  it('窗口内超过次数后拒绝，窗口过后恢复', () => {
    const limiter = new RateLimiter(2, 1000);
    expect(limiter.hit('ip', 0)).toBe(true);
    expect(limiter.hit('ip', 10)).toBe(true);
    expect(limiter.hit('ip', 20)).toBe(false);
    expect(limiter.hit('other', 20)).toBe(true);
    expect(limiter.hit('ip', 1500)).toBe(true);
  });
});

describe.skipIf(!hasOpenssl)('服务器（HTTPS + WebSocket RPC）', () => {
  let dir: string;
  let core: Core;
  let server: RunningServer;
  let cert: string;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'yys-server-'));
    execFileSync(
      'openssl',
      [
        'req',
        '-x509',
        '-newkey',
        'ec',
        '-pkeyopt',
        'ec_paramgen_curve:prime256v1',
        '-nodes',
        '-days',
        '2',
        '-subj',
        '/CN=yiyeshuzhan-test',
        '-addext',
        'subjectAltName=IP:127.0.0.1',
        '-keyout',
        join(dir, 'server.key'),
        '-out',
        join(dir, 'server.crt'),
      ],
      { stdio: 'ignore' },
    );
    cert = readFileSync(join(dir, 'server.crt'), 'utf8');
    core = await createCore({
      dataDir: dir,
      secrets: new FileVault(dir),
      builtinAdmin: { username: 'super_user', password: 'Server-Init-Pass-1' },
      revealDefaultPassword: false,
      info: { version: 'test', platform: 'test', nodeVersion: process.versions.node },
      log: () => {},
      onError: () => {},
    });
    server = await startServer({
      core,
      tls: { cert, key: readFileSync(join(dir, 'server.key')) },
      host: '127.0.0.1',
      port: 0,
      name: '测试服务器',
      version: 'test',
      log: () => {},
    });
  });

  afterAll(async () => {
    await server?.close();
    core?.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const get = (path: string): Promise<{ status: number; body: string }> =>
    new Promise((resolve, reject) => {
      const req = request(
        `https://127.0.0.1:${server.port}${path}`,
        { ca: cert, checkServerIdentity: () => undefined },
        (res) => {
          let body = '';
          res.on('data', (chunk) => (body += chunk));
          res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
        },
      );
      req.on('error', reject);
      req.end();
    });

  /** 与桌面端主进程一样：固定证书连接，按 id 收发 RPC */
  async function connect(headers?: Record<string, string>) {
    // 与桌面端一致：只信任这张证书；tls 要求 checkServerIdentity 通过时返回 undefined
    const ws = new WebSocket(`wss://127.0.0.1:${server.port}/rpc`, {
      ca: cert,
      headers,
      checkServerIdentity: () => undefined,
    } as unknown as WebSocket.ClientOptions);
    await new Promise<void>((resolve, reject) => {
      ws.once('open', () => resolve());
      ws.once('error', reject);
      ws.once('unexpected-response', (_req, res) => reject(new Error(`HTTP ${res.statusCode}`)));
    });
    let seq = 0;
    const call = <T>(method: string, params?: unknown, token?: string): Promise<T> => {
      const id = ++seq;
      return new Promise((resolve, reject) => {
        const onMessage = (raw: WebSocket.RawData): void => {
          const message = JSON.parse(raw.toString()) as WireMessage;
          if (message.kind !== 'res' || message.id !== id) return;
          ws.off('message', onMessage);
          if (message.error) reject(Object.assign(new Error(message.error.message), message.error));
          else resolve(message.result as T);
        };
        ws.on('message', onMessage);
        ws.send(JSON.stringify({ kind: 'req', id, method, params, token }));
      });
    };
    return { ws, call };
  }

  it('服务器信息与图片接口', async () => {
    expect(JSON.parse((await get('/api/info')).body)).toEqual({
      app: 'yiyeshuzhan',
      name: '测试服务器',
      version: 'test',
    });
    expect((await get('/media/img_0000000000000000')).status).toBe(404);
    expect((await get('/media/../data/yiyeshuzhan.db')).status).toBe(404);
    const id = core.media.save(new Uint8Array([0x89, 0x50, 0x4e, 0x47]), 'image/png');
    expect((await get(`/media/${id}`)).status).toBe(200);
  });

  it('拒绝浏览器发起的连接（带 Origin）', async () => {
    await expect(connect({ origin: 'https://evil.example' })).rejects.toThrow('HTTP 403');
  });

  it('不向客户端透露初始管理员密码；登录、保存服务商与 API Key', async () => {
    const { ws, call } = await connect();
    const status = await call<{ builtinAdmin: { defaultPassword?: string } }>('auth.status');
    expect(status.builtinAdmin.defaultPassword).toBeUndefined();
    await expect(
      call('auth.login', { username: 'super_user', password: 'wrong-pass' }),
    ).rejects.toMatchObject({
      code: 'unauthorized',
    });
    const admin = await call<AuthResult>('auth.login', {
      username: 'super_user',
      password: 'Server-Init-Pass-1',
    });
    expect(admin.user.mustChangePassword).toBe(true);
    const provider = await call<ProviderConfig>(
      'providers.save',
      { presetId: 'deepseek', models: [{ id: 'deepseek-chat' }], enabled: true, shared: true },
      admin.token,
    );
    expect(provider.hasKey).toBe(false);
    const withKey = await call<ProviderConfig>(
      'providers.setKey',
      { providerId: provider.id, apiKey: '  sk-test-1234  ' },
      admin.token,
    );
    expect(withKey.hasKey).toBe(true);
    expect(readFileSync(join(dir, 'secrets.json'), 'utf8')).not.toContain('sk-test-1234');
    const books = await call<{ total: number }>('books.search', { limit: 1 }, admin.token);
    expect(books.total).toBe(28);
    ws.close();
  });

  it('书目导入接收文件内容，不读取服务器上的路径', async () => {
    const { ws, call } = await connect();
    const admin = await call<AuthResult>('auth.login', {
      username: 'super_user',
      password: 'Server-Init-Pass-1',
    });
    const csv = '书名,作者,索书号,链接\n心流,米哈里,B84/62,https://example.edu/1\n';
    const report = await call<{ imported: number }>(
      'books.importFile',
      { fileName: '/etc/passwd/../馆藏.csv', data: Buffer.from(csv).toString('base64') },
      admin.token,
    );
    expect(report.imported).toBe(1);
    writeFileSync(join(dir, 'probe.txt'), 'x');
    await expect(
      call('books.importFile', { path: join(dir, 'probe.txt') }, admin.token),
    ).rejects.toMatchObject({ code: 'invalid_params' });
    ws.close();
  });
});
