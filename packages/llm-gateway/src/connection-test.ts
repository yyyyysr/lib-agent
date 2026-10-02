import { generateText, Output, tool, type LanguageModel } from 'ai';
import { z } from 'zod';
import type { ConnectionTestResult, ModelCapabilities } from '@yys/shared';
import { mapProviderError } from './errors';

const PROBE_TIMEOUT_MS = 45_000;

const signalFor = (outer?: AbortSignal): AbortSignal =>
  outer ? AbortSignal.any([outer, AbortSignal.timeout(PROBE_TIMEOUT_MS)]) : AbortSignal.timeout(PROBE_TIMEOUT_MS);

/**
 * 三步探测：基础对话（失败即判定连接失败）→ 结构化输出 → 工具调用。
 * 后两项决定该模型能否用于策展流程与对话 Agent。
 */
export async function testConnection(model: LanguageModel, signal?: AbortSignal): Promise<ConnectionTestResult> {
  const started = Date.now();
  let sample: string;
  try {
    const result = await generateText({
      model,
      prompt: '这是一次连接测试，请只回复两个字：你好',
      maxRetries: 1,
      abortSignal: signalFor(signal),
    });
    sample = result.text.trim().slice(0, 80);
  } catch (error) {
    return { ok: false, error: mapProviderError(error) };
  }
  const latencyMs = Date.now() - started;

  const capabilities: ModelCapabilities = { structuredOutput: 'unknown', toolCalling: 'unknown' };

  try {
    const result = await generateText({
      model,
      output: Output.object({
        schema: z.object({ theme: z.string(), bookCount: z.number().int() }),
      }),
      prompt: '从这句话中提取主题和书目数量：“为新生办一场关于信息辨别的书展，选 10 本书”。',
      maxRetries: 1,
      abortSignal: signalFor(signal),
    });
    capabilities.structuredOutput = result.output?.bookCount === 10 ? 'native' : 'json_mode';
  } catch {
    capabilities.structuredOutput = 'none';
  }

  try {
    const result = await generateText({
      model,
      tools: {
        search_library: tool({
          description: '在馆藏书目中检索图书',
          inputSchema: z.object({ keyword: z.string().describe('检索关键词') }),
        }),
      },
      toolChoice: 'required',
      prompt: '请检索馆藏中与“批判性思维”相关的图书。',
      maxRetries: 1,
      abortSignal: signalFor(signal),
    });
    capabilities.toolCalling = result.toolCalls.length > 0 ? 'yes' : 'no';
  } catch {
    capabilities.toolCalling = 'no';
  }

  return { ok: true, latencyMs, capabilities, sample };
}
