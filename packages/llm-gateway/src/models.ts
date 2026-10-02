import { createAnthropic } from '@ai-sdk/anthropic';
import { createDeepSeek } from '@ai-sdk/deepseek';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAI } from '@ai-sdk/openai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { APICallError, type LanguageModel } from 'ai';
import { AppError, type ModelInfo, type ProviderConfig, type ProviderPreset } from '@yys/shared';
import { getPreset } from './presets';

export type FetchFunction = typeof globalThis.fetch;

export interface ProviderContext {
  config: ProviderConfig;
  preset: ProviderPreset;
  apiKey: string | null;
  baseURL: string;
  fetch?: FetchFunction;
}

export function resolveProvider(
  config: ProviderConfig,
  apiKey: string | null,
  fetch?: FetchFunction,
): ProviderContext {
  const preset = getPreset(config.presetId);
  if (!preset) throw new AppError('not_configured', `未知的服务商类型：${config.presetId}`);
  const baseURL = (config.baseURL?.trim() || preset.defaultBaseURL || '').replace(/\/+$/, '');
  if (!baseURL)
    throw new AppError(
      'not_configured',
      `${config.displayName} 缺少接口地址`,
      '请在设置中填写 Base URL',
    );
  if (preset.requiresKey && !apiKey) {
    throw new AppError(
      'invalid_key',
      `${config.displayName} 尚未填写 API Key`,
      '请在 设置 › 模型与密钥 中填写',
    );
  }
  return { config, preset, apiKey, baseURL, fetch };
}

export function createLanguageModel(ctx: ProviderContext, modelId: string): LanguageModel {
  const apiKey = ctx.apiKey ?? undefined;
  const { baseURL, fetch } = ctx;
  switch (ctx.preset.kind) {
    case 'openai': {
      const provider = createOpenAI({ apiKey, baseURL, fetch });
      // 官方地址走 Responses API；自定义地址多为第三方转发，只保证 Chat Completions
      return baseURL === ctx.preset.defaultBaseURL ? provider(modelId) : provider.chat(modelId);
    }
    case 'anthropic':
      return createAnthropic({ apiKey, baseURL, fetch })(modelId);
    case 'google':
      return createGoogleGenerativeAI({ apiKey, baseURL, fetch })(modelId);
    case 'deepseek':
      return createDeepSeek({ apiKey, baseURL, fetch })(modelId);
    case 'openai-compatible':
      return createOpenAICompatible({
        name: ctx.preset.id,
        apiKey,
        baseURL,
        fetch,
        includeUsage: true,
      })(modelId);
  }
}

const nonChatModel =
  /embed|whisper|tts|dall-?e|moderation|rerank|image|audio|speech|transcri|vision-preview|ocr/i;

async function getJson(
  ctx: ProviderContext,
  url: string,
  headers: Record<string, string>,
  signal?: AbortSignal,
): Promise<unknown> {
  const doFetch = ctx.fetch ?? globalThis.fetch;
  const response = await doFetch(url, {
    headers: { accept: 'application/json', ...headers },
    signal,
  });
  const text = await response.text();
  if (!response.ok) {
    throw new APICallError({
      message: `HTTP ${response.status}`,
      url,
      requestBodyValues: {},
      statusCode: response.status,
      responseBody: text,
    });
  }
  return JSON.parse(text) as unknown;
}

/** 从服务商拉取可用模型列表；部分服务商不提供该接口时由用户手动填写 */
export async function listRemoteModels(
  ctx: ProviderContext,
  signal?: AbortSignal,
): Promise<ModelInfo[]> {
  const key = ctx.apiKey ?? '';
  let ids: { id: string; label?: string }[];
  switch (ctx.preset.kind) {
    case 'anthropic': {
      const json = (await getJson(
        ctx,
        `${ctx.baseURL}/models?limit=100`,
        { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
        signal,
      )) as {
        data?: { id: string; display_name?: string }[];
      };
      ids = (json.data ?? []).map((m) => ({ id: m.id, label: m.display_name }));
      break;
    }
    case 'google': {
      const json = (await getJson(
        ctx,
        `${ctx.baseURL}/models?pageSize=200`,
        { 'x-goog-api-key': key },
        signal,
      )) as {
        models?: { name: string; displayName?: string; supportedGenerationMethods?: string[] }[];
      };
      ids = (json.models ?? [])
        .filter(
          (m) =>
            !m.supportedGenerationMethods ||
            m.supportedGenerationMethods.includes('generateContent'),
        )
        .map((m) => ({ id: m.name.replace(/^models\//, ''), label: m.displayName }));
      break;
    }
    default: {
      const headers: Record<string, string> = key ? { authorization: `Bearer ${key}` } : {};
      const json = (await getJson(ctx, `${ctx.baseURL}/models`, headers, signal)) as {
        data?: { id: string }[];
      };
      ids = (json.data ?? []).map((m) => ({ id: m.id }));
    }
  }
  const seen = new Set<string>();
  return ids
    .filter((m) => m.id && !nonChatModel.test(m.id) && !seen.has(m.id) && seen.add(m.id))
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((m) => (m.label && m.label !== m.id ? { id: m.id, label: m.label } : { id: m.id }));
}
