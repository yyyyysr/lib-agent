import { describe, expect, it, vi } from 'vitest';
import type { ProviderConfig } from '@yys/shared';
import { createImageGenerator } from './images';
import { resolveProvider } from './models';

const config = (presetId: string): ProviderConfig => ({
  id: 'p1',
  presetId,
  displayName: presetId,
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

  it('不提供生图接口的服务商给出可操作的提示', async () => {
    const ctx = resolveProvider(config('anthropic'), 'sk');
    await expect(createImageGenerator(ctx, 'claude', 'image')('x')).rejects.toMatchObject({
      message: expect.stringContaining('不提供图像生成接口'),
    });
  });
});
