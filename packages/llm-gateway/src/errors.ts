import { APICallError } from 'ai';
import { AppError, type AppErrorShape } from '@yys/shared';

const networkPattern =
  /fetch failed|ENOTFOUND|ECONNREFUSED|ECONNRESET|EAI_AGAIN|ETIMEDOUT|ERR_NAME_NOT_RESOLVED|ERR_CONNECTION|ERR_INTERNET_DISCONNECTED|ERR_PROXY|ERR_TUNNEL|ERR_CERT|socket hang up|network/i;
const quotaPattern = /quota|insufficient|balance|billing|credit|余额|欠费|额度|arrear/i;
const regionPattern = /region|country|territory|location is not supported|unsupported_country/i;
const modelMissingPattern = /model.*(not.?found|not.?exist|does not exist|invalid)|模型.*不存在|no such model/i;

function unwrap(error: unknown): unknown {
  let current = error;
  for (let i = 0; i < 5 && current && typeof current === 'object'; i++) {
    const next = (current as { lastError?: unknown }).lastError ?? (current as { cause?: unknown }).cause;
    if (!next || APICallError.isInstance(current)) break;
    current = next;
  }
  return current;
}

function excerpt(text: string | undefined, max = 160): string {
  if (!text) return '';
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
}

/** 把各服务商五花八门的错误统一成中文可读的错误与处理建议 */
export function mapProviderError(error: unknown): AppErrorShape {
  if (error instanceof AppError) return error.toJSON();
  const root = unwrap(error);
  const name = (root as Error | undefined)?.name ?? '';
  const message = String((root as Error | undefined)?.message ?? root ?? '');

  if (name === 'AbortError' && !/timeout/i.test(message)) {
    return { code: 'cancelled', message: '已停止' };
  }
  if (name === 'TimeoutError' || /timed? ?out|timeout/i.test(message)) {
    return { code: 'timeout', message: '请求超时', hint: '模型服务响应过慢，请稍后重试，或在设置中换用响应更快的模型' };
  }

  if (APICallError.isInstance(root)) {
    const status = root.statusCode;
    const body = `${root.responseBody ?? ''} ${root.message}`;
    if (status === 401 || (status === 403 && !regionPattern.test(body))) {
      return { code: 'invalid_key', message: 'API Key 无效或没有权限', hint: '请在 设置 › 模型与密钥 中检查 Key 是否完整、是否属于该服务商' };
    }
    if (status === 403 && regionPattern.test(body)) {
      return { code: 'network', message: '该服务在当前网络所在地区不可用', hint: '可在设置中配置代理，或换用国内服务商' };
    }
    if (status === 402 || (status === 429 && quotaPattern.test(body)) || (status === 400 && quotaPattern.test(body))) {
      return { code: 'insufficient_quota', message: '账户余额或额度不足', hint: '请到服务商控制台充值或检查用量限制' };
    }
    if (status === 429) {
      return { code: 'rate_limited', message: '请求过于频繁，已被服务商限流', hint: '稍等片刻再试；如频繁出现，可降低并发或升级服务商套餐' };
    }
    if (status === 404 || ((status === 400 || status === 422) && modelMissingPattern.test(body))) {
      return { code: 'model_not_found', message: '模型不存在或接口地址有误', hint: '请确认模型名称拼写，并检查接口地址（Base URL）是否正确' };
    }
    if (status !== undefined && status >= 500) {
      return { code: 'network', message: `模型服务暂时不可用（HTTP ${status}）`, hint: '服务商故障或繁忙，请稍后重试' };
    }
    return { code: 'internal', message: `模型服务返回错误${status ? `（HTTP ${status}）` : ''}：${excerpt(root.responseBody ?? root.message)}` };
  }

  if (networkPattern.test(message) || networkPattern.test(name)) {
    return { code: 'network', message: '无法连接到模型服务', hint: '请检查网络、代理设置和接口地址；本地模型请确认服务已启动' };
  }
  return { code: 'internal', message: excerpt(message) || '未知错误' };
}
