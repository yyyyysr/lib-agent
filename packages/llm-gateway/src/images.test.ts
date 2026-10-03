import { describe, expect, it, vi } from 'vitest';
import type { ProviderConfig } from '@yys/shared';
import { createImageGenerator } from './images';
import { resolveProvider } from './models';

const config = (presetId: string, baseURL?: string): ProviderConfig => ({
  id: 'p1',
  presetId,
  displayName: presetId,
  baseURL,
  secretRef: 'provider:p1',
  hasKey: true,
  models: [],
  enabled: true,
  ownerId: null,
  createdAt: '',
  updatedAt: '',
});

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
const jpeg = Buffer.from(
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAn/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCwAA//2Q==',
  'base64',
);

describe('createImageGenerator', () => {
  it('兼容接口拒绝海报尺寸时去掉尺寸重试', async () => {
    const bodies: Record<string, unknown>[] = [];
    const fetch = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      bodies.push(body);
      if (body.size)
        return new Response(JSON.stringify({ error: { message: 'invalid size 1024x1536' } }), {
          status: 400,
          headers: { 'content-type': 'application/json' },
        });
      return Response.json({ data: [{ b64_json: png.toString('base64') }] });
    });
    const ctx = resolveProvider(
      config('siliconflow'),
      'sk',
      fetch as unknown as typeof globalThis.fetch,
    );
    const image = await createImageGenerator(
      ctx,
      'Kwai-Kolors/Kolors',
      'image',
    )('a library poster');
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(String(fetch.mock.calls[0]![0])).toBe(
      'https://api.siliconflow.cn/v1/images/generations',
    );
    expect(bodies[0]).toMatchObject({ prompt: 'a library poster', size: '1024x1536' });
    expect(bodies[1]!.size).toBeUndefined();
    expect(Buffer.from(image.data).equals(png)).toBe(true);
  });

  it('MiniMax 走原生 /image_generation 接口', async () => {
    const fetch = vi.fn(async (url: string, init?: RequestInit) => {
      expect(String(url)).toBe('https://api.minimax.cn/v1/image_generation');
      expect((init?.headers as Record<string, string>).authorization).toBe('Bearer sk-mm');
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      expect(body).toMatchObject({
        model: 'image-01',
        prompt: 'library poster art',
        aspect_ratio: '3:4',
        response_format: 'base64',
        n: 1,
      });
      return Response.json({
        data: { image_base64: [jpeg.toString('base64')] },
        base_resp: { status_code: 0, status_msg: 'success' },
      });
    });
    const ctx = resolveProvider(
      config('minimax'),
      'sk-mm',
      fetch as unknown as typeof globalThis.fetch,
    );
    const image = await createImageGenerator(ctx, 'image-01', 'image')('library poster art');
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(image.mediaType).toBe('image/jpeg');
    expect(Buffer.from(image.data).equals(jpeg)).toBe(true);
  });

  it('自定义接口指向 MiniMax 域名时同样走原生生图', async () => {
    const fetch = vi.fn(async () =>
      Response.json({
        data: { image_base64: [jpeg.toString('base64')] },
        base_resp: { status_code: 0, status_msg: 'success' },
      }),
    );
    const ctx = resolveProvider(
      config('custom', 'https://api.minimax.io/v1'),
      'sk',
      fetch as unknown as typeof globalThis.fetch,
    );
    await createImageGenerator(ctx, 'image-01', 'image')('x');
    expect(String(fetch.mock.calls[0]![0])).toBe('https://api.minimax.io/v1/image_generation');
  });

  it('MiniMax 业务错误码映射为可读错误', async () => {
    const fetch = vi.fn(async () =>
      Response.json({
        base_resp: { status_code: 1004, status_msg: 'login fail' },
      }),
    );
    const ctx = resolveProvider(
      config('minimax'),
      'bad',
      fetch as unknown as typeof globalThis.fetch,
    );
    await expect(createImageGenerator(ctx, 'image-01', 'image')('x')).rejects.toMatchObject({
      statusCode: 401,
    });
  });

  it('不提供生图接口的服务商给出可操作的提示', async () => {
    const ctx = resolveProvider(config('anthropic'), 'sk');
    await expect(createImageGenerator(ctx, 'claude', 'image')('x')).rejects.toMatchObject({
      message: expect.stringContaining('不提供图像生成接口'),
    });
  });
});
