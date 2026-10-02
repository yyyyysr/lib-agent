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

const withTimeout = (signal?: AbortSignal): AbortSignal =>
  signal
    ? AbortSignal.any([signal, AbortSignal.timeout(IMAGE_TIMEOUT_MS)])
    : AbortSignal.timeout(IMAGE_TIMEOUT_MS);

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
        '请选择 OpenAI、Gemini、火山方舟、硅基流动等支持生图的服务商，或改用“多模态模型”方式',
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
