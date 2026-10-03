import { createReadStream } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createServer, type Server } from 'node:https';
import type { AddressInfo } from 'node:net';
import { WebSocketServer, WebSocket } from 'ws';
import type { Core, PortLike } from '@yys/core';
import {
  SERVER_INFO_PATH,
  SERVER_RPC_PATH,
  type AppErrorShape,
  type WireMessage,
} from '@yys/shared';
import { RateLimiter } from './rate-limit';

const MAX_MESSAGE_BYTES = 32 * 1024 * 1024;
const HEARTBEAT_MS = 30_000;
const MAX_CONNECTIONS_PER_IP = 30;
/** 每个 IP 10 分钟内最多 30 次登录 / 注册请求（单个账号另有连续输错锁定） */
const AUTH_METHODS = new Set(['auth.login', 'auth.register']);

export interface ServerOptions {
  core: Core;
  tls: { cert: string | Buffer; key: string | Buffer };
  host: string;
  port: number;
  name: string;
  version: string;
  log?: (message: string) => void;
}

export interface RunningServer {
  port: number;
  close(): Promise<void>;
}

const securityHeaders = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'strict-transport-security': 'max-age=31536000',
};

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { ...securityHeaders, 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

const clientIp = (req: IncomingMessage): string => req.socket.remoteAddress ?? 'unknown';

/** 一页书展服务器：HTTPS 提供服务器信息与生成图片，WebSocket 承载与桌面端相同的 RPC 协议 */
export function startServer(options: ServerOptions): Promise<RunningServer> {
  const log = options.log ?? console.log;
  const { core } = options;
  const authLimiter = new RateLimiter(30, 10 * 60_000);
  const connections = new Map<string, number>();

  const handle = (req: IncomingMessage, res: ServerResponse): void => {
    const url = new URL(req.url ?? '/', 'https://localhost');
    if (req.method !== 'GET' && req.method !== 'HEAD')
      return send(res, 405, { error: 'method_not_allowed' });
    if (url.pathname === SERVER_INFO_PATH)
      return send(res, 200, { app: 'yiyeshuzhan', name: options.name, version: options.version });
    const media = /^\/media\/([^/]+)$/.exec(url.pathname);
    if (media) {
      // 编号为 64 位随机数，无法猜测；与书展页面中的图片一样视为可公开的资源
      const found = core.media.find(media[1]!);
      if (!found) return send(res, 404, { error: 'not_found' });
      res.writeHead(200, {
        ...securityHeaders,
        'content-type': found.mediaType,
        'cache-control': 'public, max-age=31536000, immutable',
      });
      if (req.method === 'HEAD') return void res.end();
      createReadStream(found.path).pipe(res);
      return;
    }
    send(res, 404, { error: 'not_found' });
  };

  const https: Server = createServer(
    { cert: options.tls.cert, key: options.tls.key, minVersion: 'TLSv1.2' },
    handle,
  );
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: MAX_MESSAGE_BYTES,
    perMessageDeflate: true,
  });

  https.on('upgrade', (req, socket, head) => {
    const ip = clientIp(req);
    const path = new URL(req.url ?? '/', 'https://localhost').pathname;
    // 只服务桌面客户端：浏览器发起的跨站 WebSocket 一定带 Origin，直接拒绝
    if (path !== SERVER_RPC_PATH || req.headers.origin) {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      return socket.destroy();
    }
    if ((connections.get(ip) ?? 0) >= MAX_CONNECTIONS_PER_IP) {
      socket.write('HTTP/1.1 429 Too Many Requests\r\n\r\n');
      return socket.destroy();
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });

  wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    const ip = clientIp(req);
    connections.set(ip, (connections.get(ip) ?? 0) + 1);
    let alive = true;
    ws.on('pong', () => (alive = true));
    const heartbeat = setInterval(() => {
      if (!alive) return ws.terminate();
      alive = false;
      ws.ping();
    }, HEARTBEAT_MS);

    const messageListeners: ((event: { data: unknown }) => void)[] = [];
    const closeListeners: (() => void)[] = [];
    const port: PortLike = {
      on(event: 'message' | 'close', listener: never) {
        if (event === 'message') messageListeners.push(listener);
        else closeListeners.push(listener);
        return port;
      },
      postMessage(message: unknown) {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
      },
      start() {},
    };

    ws.on('message', (raw) => {
      let message: WireMessage;
      try {
        message = JSON.parse(raw.toString()) as WireMessage;
      } catch {
        return;
      }
      if (message.kind === 'req' && AUTH_METHODS.has(message.method) && !authLimiter.hit(ip)) {
        const error: AppErrorShape = {
          code: 'forbidden',
          message: '登录尝试过于频繁，请 10 分钟后再试',
        };
        port.postMessage({ kind: 'res', id: message.id, error } satisfies WireMessage);
        return;
      }
      for (const listener of messageListeners) listener({ data: message });
    });
    ws.on('close', () => {
      clearInterval(heartbeat);
      const left = (connections.get(ip) ?? 1) - 1;
      if (left > 0) connections.set(ip, left);
      else connections.delete(ip);
      for (const listener of closeListeners) listener();
    });
    core.server.attach(port);
  });

  const sweeper = setInterval(() => authLimiter.sweep(), 60_000);

  return new Promise((resolve, reject) => {
    https.once('error', reject);
    https.listen(options.port, options.host, () => {
      const { port } = https.address() as AddressInfo;
      log(`一页书展服务器已启动：https://${options.host}:${port}`);
      resolve({
        port,
        close: () =>
          new Promise((done) => {
            clearInterval(sweeper);
            for (const client of wss.clients) client.terminate();
            wss.close();
            https.close(() => done());
          }),
      });
    });
  });
}
