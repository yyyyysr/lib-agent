import { schoolProfileSchema } from '@yys/shared';
import { describe, expect, it, vi } from 'vitest';
import { HttpJsonCampusSource } from './http-json-source';

const profile = schoolProfileSchema.parse({
  id: 'demo',
  name: '示例大学图书馆',
  api: {
    baseUrl: 'https://cms.example.edu',
    searchPath: '/api/books',
    queryParam: 'keyword',
    itemsPath: 'data.list',
    totalPath: 'data.total',
    fieldMap: { title: 'name', authors: 'writer', callNumber: 'holding.callNo', sourceUrl: 'link' },
  },
});

describe('HttpJsonCampusSource', () => {
  it('按配置拼接检索地址、携带 token，并映射字段', async () => {
    const fetch = vi.fn(async (_url: string, _init?: RequestInit) =>
      Response.json({
        data: {
          total: 41,
          list: [
            { id: 'b1', name: '乡土中国', writer: '费孝通', holding: { callNo: 'C912/2' }, link: 'https://cms.example.edu/b1' },
            { id: 'b2', name: '', writer: '缺书名' },
          ],
        },
      }),
    );
    const source = new HttpJsonCampusSource(profile, { fetch, getAccessToken: async () => 'tok' });
    const page = await source.search({ text: '乡土', limit: 20, offset: 0 });

    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe('https://cms.example.edu/api/books?keyword=%E4%B9%A1%E5%9C%9F');
    expect((init?.headers as Record<string, string>).authorization).toBe('Bearer tok');
    expect(page.total).toBe(41);
    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({ externalId: 'b1', title: '乡土中国', authors: ['费孝通'], callNumber: 'C912/2' });
    expect(page.items[0]?.provenance.title?.origin).toBe('api');
  });

  it('401 提示重新登录', async () => {
    const source = new HttpJsonCampusSource(profile, { fetch: async () => new Response('', { status: 401 }) });
    await expect(source.search({ text: 'x', limit: 10, offset: 0 })).rejects.toMatchObject({ code: 'not_configured' });
  });

  it('未配置接口时拒绝创建', () => {
    expect(() => new HttpJsonCampusSource({ id: 'x', name: 'X' }, { fetch })).toThrow(/尚未配置/);
  });
});
