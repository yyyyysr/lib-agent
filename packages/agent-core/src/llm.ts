import { APICallError, generateText, Output, RetryError, type LanguageModel } from 'ai';
import type { z } from 'zod';
import { AppError } from '@yys/shared';

const CALL_TIMEOUT_MS = 120_000;

export interface StructuredCall<S extends z.ZodType> {
  model: LanguageModel;
  /** 任务代号写在系统提示开头，便于日志定位，也供测试中的 mock 模型分派 */
  task: string;
  system: string;
  prompt: string;
  schema: S;
  /** 业务校验：返回问题描述则带着问题让模型重写，返回 null 表示通过 */
  validate?: (value: z.output<S>) => string | null;
  temperature?: number;
  attempts?: number;
  signal?: AbortSignal;
}

const isTransportError = (error: unknown): boolean =>
  APICallError.isInstance(error) || RetryError.isInstance(error);

function withTimeout(signal: AbortSignal | undefined): AbortSignal {
  const timeout = AbortSignal.timeout(CALL_TIMEOUT_MS);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

export const taskTag = (task: string): string => `【任务：${task}】`;

/**
 * 结构化生成：schema 解析失败或业务校验不通过时，把问题反馈给模型重试。
 * 鉴权、额度、网络等错误不在这里重试（SDK 已对可重试的状态码做过退避），直接抛给上层映射为中文提示。
 */
export async function generateStructured<S extends z.ZodType>(
  call: StructuredCall<S>,
): Promise<z.output<S>> {
  const attempts = call.attempts ?? 3;
  let feedback = '';
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const result = await generateText({
        model: call.model,
        system: `${taskTag(call.task)}\n${call.system}`,
        prompt: feedback ? `${call.prompt}\n\n${feedback}` : call.prompt,
        output: Output.object({ schema: call.schema }),
        temperature: call.temperature,
        maxRetries: 2,
        abortSignal: withTimeout(call.signal),
      });
      const value = result.output as z.output<S>;
      const problem = call.validate?.(value) ?? null;
      if (!problem) return value;
      lastError = new AppError('internal', `模型输出未通过校验：${problem}`);
      feedback = `【上一次输出的问题】${problem}\n请修正上述问题，重新输出完整的 JSON。`;
    } catch (error) {
      if (call.signal?.aborted || isTransportError(error)) throw error;
      lastError = error;
      const reason = error instanceof Error ? error.message.slice(0, 120) : '格式错误';
      feedback = `【上一次输出的问题】无法解析为符合要求的 JSON（${reason}）。请只输出一个符合 schema 的 JSON 对象，不要输出其他文字。`;
    }
  }
  if (lastError instanceof AppError) throw lastError;
  throw new AppError(
    'internal',
    `模型连续 ${attempts} 次未能输出符合要求的结果`,
    '可以重试一次；若仍失败，请在设置中换用支持结构化输出的模型',
  );
}

export async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]!, index);
    }
  });
  await Promise.all(workers);
  return results;
}

export const charLength = (text: string): number => [...text].length;
