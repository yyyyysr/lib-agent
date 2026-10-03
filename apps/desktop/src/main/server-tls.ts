import { createHash, X509Certificate } from 'node:crypto';
import { request } from 'node:https';
import type { PeerCertificate } from 'node:tls';
import { SERVER_INFO_PATH, type ServerProbe } from '@yys/shared/ipc';

const TIMEOUT_MS = 10_000;

/** 证书 DER 的 SHA-256，小写十六进制、无分隔符 */
export const fingerprintOf = (der: Buffer): string =>
  createHash('sha256').update(der).digest('hex');

/** 便于人工核对的分组格式：AB:CD:… */
export const formatFingerprint = (hex: string): string =>
  hex.toUpperCase().match(/.{2}/g)?.join(':') ?? hex;

const toPem = (der: Buffer): string =>
  `-----BEGIN CERTIFICATE-----\n${der
    .toString('base64')
    .match(/.{1,64}/g)
    ?.join('\n')}\n-----END CERTIFICATE-----\n`;

/** 只接受 https://主机[:端口]，去掉路径与结尾斜杠 */
export function normalizeServerUrl(input: string): string {
  const raw = input.trim();
  const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  if (url.protocol !== 'https:') throw new Error('服务器地址必须以 https:// 开头');
  if (url.username || url.password) throw new Error('服务器地址中不能包含账号密码');
  return `https://${url.host}`;
}

export interface PinnedServer {
  url: string;
  fingerprint: string;
  /** 首次确认时取得的服务器证书（PEM），之后作为唯一信任的根证书 */
  certificate: string;
}

/** 固定证书的 TLS 选项：只信任确认过的那张证书，并再次核对指纹（自签名证书没有域名，跳过主机名校验） */
export function pinnedTlsOptions(server: PinnedServer) {
  return {
    ca: server.certificate,
    rejectUnauthorized: true,
    checkServerIdentity: (_host: string, cert: PeerCertificate): Error | undefined =>
      fingerprintOf(cert.raw) === server.fingerprint
        ? undefined
        : new Error('服务器证书与之前确认的不一致，连接已中止'),
  };
}

/** 首次连接：读取服务器证书与基本信息，不发送任何账号数据 */
export function probeServer(input: string): Promise<ServerProbe & { certificate: string }> {
  const base = normalizeServerUrl(input);
  return new Promise((resolve, reject) => {
    const req = request(
      `${base}${SERVER_INFO_PATH}`,
      { method: 'GET', rejectUnauthorized: false, timeout: TIMEOUT_MS },
      (res) => {
        const cert = (res.socket as import('node:tls').TLSSocket).getPeerCertificate(true);
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.length < 64 && chunks.push(chunk));
        res.on('end', () => {
          try {
            if (!cert?.raw) throw new Error('服务器没有提供证书');
            if (res.statusCode !== 200) throw new Error(`服务器返回 HTTP ${res.statusCode}`);
            const info = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
              app?: string;
              name?: string;
              version?: string;
            };
            if (info.app !== 'yiyeshuzhan') throw new Error('这不是一页书展服务器');
            new X509Certificate(cert.raw);
            resolve({
              url: base,
              fingerprint: fingerprintOf(cert.raw),
              certificate: toPem(cert.raw),
              name: info.name ?? '一页书展服务器',
              version: info.version ?? '',
            });
          } catch (error) {
            reject(error instanceof SyntaxError ? new Error('服务器响应格式不正确') : error);
          }
        });
      },
    );
    req.on('timeout', () => req.destroy(new Error('连接超时，请检查地址、端口与服务器防火墙')));
    req.on('error', (error) => reject(friendlyNetworkError(error)));
    req.end();
  });
}

/** 经固定证书下载一个资源（远程模式下的生成图片） */
export function pinnedGet(
  server: PinnedServer,
  path: string,
  maxBytes: number,
): Promise<{ status: number; data: Buffer }> {
  return new Promise((resolve, reject) => {
    const req = request(
      `${server.url}${path}`,
      { method: 'GET', timeout: TIMEOUT_MS * 3, ...pinnedTlsOptions(server) },
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        res.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > maxBytes) req.destroy(new Error('文件过大'));
          else chunks.push(chunk);
        });
        res.on('end', () => resolve({ status: res.statusCode ?? 0, data: Buffer.concat(chunks) }));
      },
    );
    req.on('timeout', () => req.destroy(new Error('下载超时')));
    req.on('error', reject);
    req.end();
  });
}

export function friendlyNetworkError(error: unknown): Error {
  const code = (error as NodeJS.ErrnoException)?.code;
  const message = (error as Error)?.message ?? String(error);
  if (code === 'ECONNREFUSED') return new Error('服务器拒绝连接：服务未启动或端口不对');
  if (code === 'ENOTFOUND') return new Error('找不到这个服务器地址');
  if (code === 'ETIMEDOUT' || code === 'ECONNRESET')
    return new Error('连接服务器超时，请检查地址与服务器防火墙（安全组）是否放行端口');
  if (code === 'EPROTO' || /wrong version number/i.test(message))
    return new Error('对方不是 HTTPS 服务，请检查端口');
  return error instanceof Error ? error : new Error(message);
}
