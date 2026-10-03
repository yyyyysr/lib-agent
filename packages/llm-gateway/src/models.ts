import { createAnthropic } from '@ai-sdk/anthropic';
import { createDeepSeek } from '@ai-sdk/deepseek';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAI } from '@ai-sdk/openai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { APICallError, type LanguageModel } from 'ai';
import { AppError, purposeForModel, type ModelInfo, type ProviderConfig } from '@yys/shared';
import { getPreset } from './presets';

export type FetchFunction = typeof globalThis.fetch;

export interface ProviderContext {
  config: ProviderConfig;
  preset: NonNullable<ReturnType<typeof getPreset>>;
  apiKey: string | null;
  baseURL: string;
  fetch?: FetchFunction;
}

/** 用户可能把 curl 里的完整路径贴进 Base URL，去掉末端具体接口名，只保留 /v1 */
export function normalizeProviderBaseURL(url: string): string {
  return url
    .trim()
    .replace(/\/+$/, '')
    .replace(/\/(image_generation|images\/generations|chat\/completions)$/i, '');
}

export function resolveProvider(
  config: ProviderConfig,
  apiKey: string | null,
  fetch?: FetchFunction,
): ProviderContext {
  const preset = getPreset(config.presetId);
  if (!preset) throw new AppError('not_configured', `未知的服务商类型：${config.presetId}`);
  const baseURL = normalizeProviderBaseURL(config.baseURL?.trim() || preset.defaultBaseURL || '');
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
  /embed|whisper|tts|dall-?e|moderation|rerank|audio|speech|transcri|vision-preview|ocr/i;

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

function idsFromModelList(json: unknown): { id: string; label?: string }[] {
  if (!json || typeof json !== 'object') return [];
  const root = json as {
    data?: unknown;
    models?: { name?: string; id?: string; displayName?: string; display_name?: string }[];
  };
  if (Array.isArray(root.data)) {
    return root.data
      .map((item) => {
        if (typeof item === 'string') return { id: item };
        if (item && typeof item === 'object' && 'id' in item && typeof item.id === 'string') {
          const row = item as { id: string; display_name?: string };
          return { id: row.id, label: row.display_name };
        }
        return { id: '' };
      })
      .filter((m) => m.id);
  }
  return (root.models ?? [])
    .map((m) => ({
      id: (m.id || m.name || '').replace(/^models\//, ''),
      label: m.displayName ?? m.display_name,
    }))
    .filter((m) => m.id);
}

/** 从服务商拉取可用模型列表；生图模型（如 image-01）不会出现在对话 /models 里，用预设补上 */
export async function listRemoteModels(
  ctx: ProviderContext,
  signal?: AbortSignal,
): Promise<ModelInfo[]> {
  const key = ctx.apiKey ?? '';
  let ids: { id: string; label?: string }[] = [];
  try {
    switch (ctx.preset.kind) {
      case 'anthropic': {
        const json = await getJson(
          ctx,
          `${ctx.baseURL}/models?limit=100`,
          { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
          signal,
        );
        ids = idsFromModelList(json);
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
        ids = idsFromModelList(await getJson(ctx, `${ctx.baseURL}/models`, headers, signal));
      }
    }
  } catch (error) {
    if (!ctx.preset.suggestedModels?.length) throw error;
    ids = [];
  }

  for (const suggested of ctx.preset.suggestedModels ?? []) {
    if (!ids.some((m) => m.id === suggested.id)) ids.push(suggested);
  }

  const seen = new Set<string>();
  return ids
    .filter((m) => m.id && !nonChatModel.test(m.id) && !seen.has(m.id) && seen.add(m.id))
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((m) => ({
      id: m.id,
      ...(m.label && m.label !== m.id ? { label: m.label } : {}),
      purpose: purposeForModel(m.id),
    }));
}
