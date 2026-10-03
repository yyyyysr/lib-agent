import { APICallError } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import { describe, expect, it, vi } from 'vitest';
import type { ProviderConfig } from '@yys/shared';
import { mapProviderError } from './errors';
import { listRemoteModels, resolveProvider } from './models';
import { providerPresets } from './presets';
import { testConnection } from './connection-test';

type GenerateResult = Awaited<ReturnType<MockLanguageModelV4['doGenerate']>>;
type CallOptions = Parameters<MockLanguageModelV4['doGenerate']>[0];

const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 5, text: 5, reasoning: 0 },
} as GenerateResult['usage'];

const textResult = (text: string): GenerateResult => ({
  content: [{ type: 'text', text }],
  finishReason: { unified: 'stop', raw: 'stop' },
  usage,
  warnings: [],
});

const apiError = (statusCode: number, responseBody = ''): APICallError =>
  new APICallError({
    message: `HTTP ${statusCode}`,
    url: 'https://x',
    requestBodyValues: {},
    statusCode,
    responseBody,
  });

const config = (presetId: string, extra: Partial<ProviderConfig> = {}): ProviderConfig => ({
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
  ...extra,
});

describe('presets', () => {
  it('id 唯一，需要 Key 的预设都有默认地址', () => {
    expect(providerPresets.some((p) => p.id === 'minimax' && p.name.includes('海螺'))).toBe(true);
    expect(new Set(providerPresets.map((p) => p.id)).size).toBe(providerPresets.length);
    for (const preset of providerPresets) {
      if (preset.id !== 'custom') expect(preset.defaultBaseURL, preset.id).toMatch(/^https?:\/\//);
    }
  });
});

describe('resolveProvider', () => {
  it('缺 Key 时给出可操作的提示', () => {
    expect(() => resolveProvider(config('deepseek'), null)).toThrow(/尚未填写 API Key/);
  });
  it('本地模型不需要 Key，地址去掉末尾斜杠', () => {
    expect(
      resolveProvider(config('ollama', { baseURL: 'http://127.0.0.1:11434/v1/' }), null).baseURL,
    ).toBe('http://127.0.0.1:11434/v1');
  });
  it('自定义接口必须填写地址', () => {
    expect(() => resolveProvider(config('custom'), 'k')).toThrow(/缺少接口地址/);
  });
});

describe('mapProviderError', () => {
  it.each([
    [apiError(401), 'invalid_key'],
    [apiError(403, '{"error":"unsupported_country_region_territory"}'), 'network'],
    [apiError(402), 'insufficient_quota'],
    [apiError(429, 'You exceeded your current quota'), 'insufficient_quota'],
    [apiError(429, 'Rate limit reached'), 'rate_limited'],
    [apiError(404), 'model_not_found'],
    [apiError(400, 'Model Not Exist'), 'model_not_found'],
    [apiError(503), 'network'],
    [new TypeError('fetch failed'), 'network'],
    [Object.assign(new Error('The operation timed out'), { name: 'TimeoutError' }), 'timeout'],
    [Object.assign(new Error('aborted'), { name: 'AbortError' }), 'cancelled'],
  ])('%s → %s', (error, code) => {
    expect(mapProviderError(error).code).toBe(code);
  });

  it('解开 RetryError 一类的包装错误', () => {
    const wrapped = Object.assign(new Error('Failed after 3 attempts'), {
      lastError: apiError(401),
    });
    expect(mapProviderError(wrapped).code).toBe('invalid_key');
  });
});

describe('listRemoteModels', () => {
  it('OpenAI 兼容接口：过滤非对话模型并排序', async () => {
    const fetch = vi.fn(async () =>
      Response.json({
        data: [
          { id: 'qwen-plus' },
          { id: 'text-embedding-v3' },
          { id: 'deepseek-v3' },
          { id: 'qwen-plus' },
        ],
      }),
    );
    const ctx = resolveProvider(
      config('dashscope'),
      'sk-x',
      fetch as unknown as typeof globalThis.fetch,
    );
    expect(await listRemoteModels(ctx)).toEqual([{ id: 'deepseek-v3' }, { id: 'qwen-plus' }]);
    expect(fetch).toHaveBeenCalledWith(
      'https://dashscope.aliyuncs.com/compatible-mode/v1/models',
      expect.objectContaining({
        headers: expect.objectContaining({ authorization: 'Bearer sk-x' }),
      }),
    );
  });

  it('接口报错时抛出可映射的 APICallError', async () => {
    const fetch = async () => new Response('unauthorized', { status: 401 });
    const ctx = resolveProvider(
      config('moonshot'),
      'bad',
      fetch as unknown as typeof globalThis.fetch,
    );
    const error = await listRemoteModels(ctx).catch((e: unknown) => e);
    expect(mapProviderError(error).code).toBe('invalid_key');
  });
});

describe('testConnection', () => {
  it('三项探测全部通过', async () => {
    const model = new MockLanguageModelV4({
      doGenerate: async (options: CallOptions) => {
        if (options.responseFormat?.type === 'json')
          return textResult('{"theme":"信息辨别","bookCount":10}');
        if (options.tools?.length) {
          return {
            ...textResult(''),
            content: [
              {
                type: 'tool-call',
                toolCallId: 't1',
                toolName: 'search_library',
                input: '{"keyword":"批判性思维"}',
              },
            ],
            finishReason: { unified: 'tool-calls', raw: 'tool_calls' },
          };
        }
        return textResult('你好');
      },
    });
    const result = await testConnection(model);
    expect(result).toMatchObject({
      ok: true,
      sample: '你好',
      capabilities: { structuredOutput: 'native', toolCalling: 'yes' },
    });
  });

  it('基础对话失败即判定连接失败，并返回中文错误', async () => {
    const model = new MockLanguageModelV4({
      doGenerate: async () => {
        throw apiError(401);
      },
    });
    const result = await testConnection(model);
    expect(result).toMatchObject({ ok: false, error: { code: 'invalid_key' } });
  });

  it('不支持工具调用与结构化输出的模型被如实标注', async () => {
    const model = new MockLanguageModelV4({
      doGenerate: async (options: CallOptions) => {
        if (options.tools?.length) throw apiError(400, 'tools is not supported');
        if (options.responseFormat?.type === 'json') return textResult('抱歉我不会输出 JSON');
        return textResult('你好');
      },
    });
    const result = await testConnection(model);
    expect(result).toMatchObject({
      ok: true,
      capabilities: { structuredOutput: 'none', toolCalling: 'no' },
    });
  });
});
