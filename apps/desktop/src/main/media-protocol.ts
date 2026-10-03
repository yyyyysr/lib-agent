import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, statSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { net, protocol } from 'electron';
import log from 'electron-log/main';
import { MEDIA_SCHEME, mediaIdPattern } from '@yys/shared/ipc';
import { sniffImageType } from './image-type';

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

/** 封面地址的缓存键；随应用附带的封面（bundledCoverDir）也以此命名 */
export const coverKey = (source: string): string => createHash('sha1').update(source).digest('hex');

export function handleMediaProtocol(dataDir: string, bundledCoverDir?: string): void {
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
    if (bundledCoverDir) {
      for (const [ext, type] of Object.entries(MEDIA_TYPES)) {
        const file = join(bundledCoverDir, `${key}.${ext}`);
        if (existsSync(file)) return imageResponse(await readFile(file), type);
      }
    }
    if (existsSync(failFile) && Date.now() - statSync(failFile).mtimeMs < FAILURE_TTL_MS)
      return notFound();
    try {
      const response = await net.fetch(source, { signal: AbortSignal.timeout(COVER_TIMEOUT_MS) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const declared = Number(response.headers.get('content-length') ?? 0);
      if (declared > MAX_COVER_BYTES) throw new Error(`封面过大：${declared}`);
      const data = Buffer.from(await response.arrayBuffer());
      if (data.length === 0 || data.length > MAX_COVER_BYTES)
        throw new Error(`封面大小异常：${data.length}`);
      const type = sniffImageType(data);
      if (!type) throw new Error(`不是图片：${response.headers.get('content-type') ?? '未知类型'}`);
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
    const key = coverKey(source);
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
