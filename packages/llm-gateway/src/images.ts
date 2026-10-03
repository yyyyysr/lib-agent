import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAI } from '@ai-sdk/openai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { APICallError, generateImage, generateText, type ImageModel } from 'ai';
import { AppError } from '@yys/shared';
import { createLanguageModel, type ProviderContext } from './models';

export interface GeneratedImage {
  data: Uint8Array;
  mediaType: string;
}

export type ImageGenerator = (
  prompt: string,
  options?: { signal?: AbortSignal },
) => Promise<GeneratedImage>;

const IMAGE_TIMEOUT_MS = 180_000;
const POSTER_SIZE = '1024x1536' as const;
/** 海报竖版 3:4，对应 MiniMax / 同类原生生图接口的宽高比 */
const POSTER_ASPECT_RATIO = '3:4' as const;

const withTimeout = (signal?: AbortSignal): AbortSignal =>
  signal
    ? AbortSignal.any([signal, AbortSignal.timeout(IMAGE_TIMEOUT_MS)])
    : AbortSignal.timeout(IMAGE_TIMEOUT_MS);

/** MiniMax 等使用 /v1/image_generation，而非 OpenAI 的 /images/generations */
function usesNativeImageGeneration(ctx: ProviderContext): boolean {
  if (ctx.preset.id === 'minimax') return true;
  try {
    return /minimax/i.test(new URL(ctx.baseURL).hostname);
  } catch {
    return false;
  }
}

function sniffMediaType(bytes: Uint8Array): string {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return 'image/png';
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return 'image/webp';
  }
  return 'image/jpeg';
}

function decodeBase64Image(value: string): Uint8Array {
  const raw = value.includes(',') ? value.slice(value.indexOf(',') + 1) : value;
  return new Uint8Array(Buffer.from(raw, 'base64'));
}

/**
 * MiniMax 原生生图，对齐官方 curl：
 * POST {base}/image_generation
 * Authorization: Bearer
 * Content-Type: application/json
 * { model, prompt, aspect_ratio, response_format, n, prompt_optimizer }
 */
async function viaNativeImageGeneration(
  ctx: ProviderContext,
  modelId: string,
  prompt: string,
  signal?: AbortSignal,
): Promise<GeneratedImage> {
  const doFetch = ctx.fetch ?? globalThis.fetch;
  const url = `${ctx.baseURL}/image_generation`;
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    ...(ctx.apiKey ? { Authorization: `Bearer ${ctx.apiKey}` } : {}),
  };

  const request = async (responseFormat: 'url' | 'base64') => {
    const body = {
      model: modelId,
      prompt,
      aspect_ratio: POSTER_ASPECT_RATIO,
      response_format: responseFormat,
      n: 1,
      prompt_optimizer: true,
    };
    const response = await doFetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: withTimeout(signal),
    });
    const text = await response.text();
    let json: Record<string, unknown>;
    try {
      json = JSON.parse(text) as Record<string, unknown>;
    } catch {
      throw new APICallError({
        message: `HTTP ${response.status}`,
        url,
        requestBodyValues: body,
        statusCode: response.status,
        responseBody: text,
      });
    }
    const baseResp = json.base_resp as { status_code?: number; status_msg?: string } | undefined;
    const statusCode = baseResp?.status_code;
    if (!response.ok || (statusCode !== undefined && statusCode !== 0)) {
      throw new APICallError({
        message: baseResp?.status_msg || `HTTP ${response.status}`,
        url,
        requestBodyValues: body,
        statusCode:
          !response.ok
            ? response.status
            : statusCode === 1004 || statusCode === 2049
              ? 401
              : statusCode === 1008
                ? 402
                : statusCode === 1002
                  ? 429
                  : statusCode === 1026
                    ? 400
                    : 400,
        responseBody: text,
      });
    }
    return collectNativeImages(json);
  };

  let payload = await request('url');
  if (!payload.urls[0] && !payload.b64[0]) payload = await request('base64');

  if (payload.b64[0]) {
    const data = decodeBase64Image(payload.b64[0]);
    return { data, mediaType: sniffMediaType(data) };
  }

  const imageUrl = payload.urls[0];
  if (imageUrl) {
    const imgRes = await doFetch(imageUrl, { signal: withTimeout(signal) });
    if (!imgRes.ok) {
      throw new APICallError({
        message: `下载生成图片失败 HTTP ${imgRes.status}`,
        url: imageUrl,
        requestBodyValues: {},
        statusCode: imgRes.status,
        responseBody: await imgRes.text().catch(() => ''),
      });
    }
    const data = new Uint8Array(await imgRes.arrayBuffer());
    const mediaType =
      imgRes.headers.get('content-type')?.split(';')[0]?.trim() || sniffMediaType(data);
    return { data, mediaType };
  }

  throw new AppError(
    'internal',
    '生图接口没有返回图片',
    '请确认模型名称是 image-01 或 image-01-live，并检查账户余额与内容安全策略',
  );
}

function collectNativeImages(json: Record<string, unknown>): { b64: string[]; urls: string[] } {
  const b64: string[] = [];
  const urls: string[] = [];
  const push = (value: unknown, into: string[]) => {
    if (typeof value === 'string' && value) into.push(value);
    else if (Array.isArray(value)) for (const item of value) push(item, into);
  };
  const data = json.data;
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    const row = data as Record<string, unknown>;
    push(row.image_base64, b64);
    push(row.image_urls, urls);
    push(row.images, urls);
  }
  if (Array.isArray(data)) {
    for (const item of data) {
      if (!item || typeof item !== 'object') continue;
      const row = item as Record<string, unknown>;
      if (typeof row.b64_json === 'string') b64.push(row.b64_json);
      if (typeof row.url === 'string') urls.push(row.url);
    }
  }
  return { b64, urls };
}

function imageModelFor(ctx: ProviderContext, modelId: string): ImageModel {
  const apiKey = ctx.apiKey ?? undefined;
  const { baseURL, fetch } = ctx;
  switch (ctx.preset.kind) {
    case 'openai':
      return createOpenAI({ apiKey, baseURL, fetch }).image(modelId);
    case 'google':
      return createGoogleGenerativeAI({ apiKey, baseURL, fetch }).image(modelId);
    case 'openai-compatible':
      return createOpenAICompatible({ name: ctx.preset.id, apiKey, baseURL, fetch }).imageModel(
        modelId,
      );
    default:
      throw new AppError(
        'invalid_params',
        `${ctx.config.displayName} 不提供图像生成接口`,
        '请选择 OpenAI、Gemini、MiniMax、火山方舟、硅基流动等支持生图的服务商，或改用“多模态模型”方式',
      );
  }
}

/**
 * 海报为竖版 3:4。Gemini/Imagen 用宽高比，其余用尺寸；
 * 部分兼容接口不接受该尺寸时去掉尺寸参数重试一次，交给服务商默认值。
 */
async function viaImageApi(
  ctx: ProviderContext,
  modelId: string,
  prompt: string,
  signal?: AbortSignal,
): Promise<GeneratedImage> {
  if (usesNativeImageGeneration(ctx)) {
    return viaNativeImageGeneration(ctx, modelId, prompt, signal);
  }

  const model = imageModelFor(ctx, modelId);
  const sizing =
    ctx.preset.kind === 'google' ? { aspectRatio: '3:4' as const } : { size: POSTER_SIZE };
  const run = (withSize: boolean) =>
    generateImage({
      model,
      prompt,
      n: 1,
      maxRetries: 1,
      abortSignal: withTimeout(signal),
      ...(withSize ? sizing : {}),
    });
  let result;
  try {
    result = await run(true);
  } catch (error) {
    const rejectedSize =
      APICallError.isInstance(error) &&
      error.statusCode === 400 &&
      /size|aspect|ratio|尺寸|分辨率/i.test(`${error.responseBody ?? ''}${error.message}`);
    if (!rejectedSize) throw error;
    result = await run(false);
  }
  return { data: result.image.uint8Array, mediaType: result.image.mediaType || 'image/png' };
}

/** 多模态对话模型（如 Gemini 图像模型）：要求同时输出文字与图片，取第一张图片 */
async function viaMultimodal(
  ctx: ProviderContext,
  modelId: string,
  prompt: string,
  signal?: AbortSignal,
): Promise<GeneratedImage> {
  const result = await generateText({
    model: createLanguageModel(ctx, modelId),
    prompt: `${prompt}\n\nGenerate the image now. Output a single vertical 3:4 image.`,
    providerOptions: { google: { responseModalities: ['TEXT', 'IMAGE'] } },
    maxRetries: 1,
    abortSignal: withTimeout(signal),
  });
  const image = result.files.find((file) => file.mediaType.startsWith('image/'));
  if (!image) {
    throw new AppError(
      'internal',
      '模型没有返回图片',
      '请确认所选模型支持图片输出，或改用“生图接口”方式选择专门的生图模型',
    );
  }
  return { data: image.uint8Array, mediaType: image.mediaType };
}

export function createImageGenerator(
  ctx: ProviderContext,
  modelId: string,
  mode: 'image' | 'multimodal',
): ImageGenerator {
  return (prompt, options = {}) =>
    mode === 'image'
      ? viaImageApi(ctx, modelId, prompt, options.signal)
      : viaMultimodal(ctx, modelId, prompt, options.signal);
}
