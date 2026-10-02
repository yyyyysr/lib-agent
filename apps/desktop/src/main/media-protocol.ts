import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, statSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { net, protocol } from 'electron';
import log from 'electron-log/main';
import { MEDIA_SCHEME, mediaIdPattern } from '@yys/shared/ipc';

const MEDIA_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  webp: 'image/webp',
};
const MAX_COVER_BYTES = 5 * 1024 * 1024;
const COVER_TIMEOUT_MS = 10_000;
const FAILURE_TTL_MS = 86_400_000;

/** 必须在 app ready 之前调用 */
export function registerMediaScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: MEDIA_SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
    },
  ]);
}

const notFound = (): Response => new Response(null, { status: 404 });

const imageResponse = (data: Buffer, type: string): Response =>
  new Response(new Uint8Array(data), {
    headers: { 'content-type': type, 'cache-control': 'max-age=31536000, immutable' },
  });

export function handleMediaProtocol(dataDir: string): void {
  const mediaDir = join(dataDir, 'media');
  const coverDir = join(dataDir, 'covers');
  mkdirSync(coverDir, { recursive: true });
  const inflight = new Map<string, Promise<Response>>();

  async function serveMedia(id: string): Promise<Response> {
    if (!mediaIdPattern.test(id)) return notFound();
    for (const [ext, type] of Object.entries(MEDIA_TYPES)) {
      const file = join(mediaDir, `${id}.${ext}`);
      if (existsSync(file)) return imageResponse(await readFile(file), type);
    }
    return notFound();
  }

  /** 首次以普通请求下载并缓存；失败的地址一天内不再重试，避免拖慢列表 */
  async function fetchCover(source: string, key: string): Promise<Response> {
    const dataFile = join(coverDir, `${key}.bin`);
    const typeFile = join(coverDir, `${key}.type`);
    const failFile = join(coverDir, `${key}.fail`);
    if (existsSync(dataFile) && existsSync(typeFile))
      return imageResponse(await readFile(dataFile), (await readFile(typeFile, 'utf8')).trim());
    if (existsSync(failFile) && Date.now() - statSync(failFile).mtimeMs < FAILURE_TTL_MS)
      return notFound();
    try {
      const response = await net.fetch(source, { signal: AbortSignal.timeout(COVER_TIMEOUT_MS) });
      const type = response.headers.get('content-type')?.split(';')[0]?.trim() ?? '';
      if (!response.ok || !type.startsWith('image/'))
        throw new Error(`HTTP ${response.status} ${type}`);
      const data = Buffer.from(await response.arrayBuffer());
      if (data.length === 0 || data.length > MAX_COVER_BYTES)
        throw new Error(`封面大小异常：${data.length}`);
      await writeFile(dataFile, data);
      await writeFile(typeFile, type);
      return imageResponse(data, type);
    } catch (error) {
      log.warn(`[cover] 无法加载 ${source}：${(error as Error).message}`);
      await writeFile(failFile, '').catch(() => undefined);
      return notFound();
    }
  }

  async function serveCover(source: string | null): Promise<Response> {
    if (!source || source.length > 2048 || !/^https?:\/\//i.test(source)) return notFound();
    const key = createHash('sha1').update(source).digest('hex');
    let pending = inflight.get(key);
    if (!pending) {
      pending = fetchCover(source, key).finally(() => inflight.delete(key));
      inflight.set(key, pending);
    }
    return (await pending).clone();
  }

  protocol.handle(MEDIA_SCHEME, (request) => {
    const url = new URL(request.url);
    if (url.hostname === 'media') return serveMedia(url.pathname.replace(/^\/+/, ''));
    if (url.hostname === 'cover') return serveCover(url.searchParams.get('u'));
    return notFound();
  });
}
