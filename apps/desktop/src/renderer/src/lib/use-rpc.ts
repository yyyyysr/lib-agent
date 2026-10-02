import { useCallback, useEffect, useRef, useState } from 'react';
import type { CoreEventTopic, RpcMethod, RpcParams, RpcResult } from '@yys/shared';
import { core } from './core-client';

interface RpcState<T> {
  data: T | undefined;
  error: unknown;
  loading: boolean;
  reload: () => void;
}

/**
 * 读取型 RPC：参数变化、订阅的 Core 事件触发、Core 重连后自动重新加载。
 * 旧请求的结果晚到时会被丢弃，避免覆盖新结果。
 */
export function useRpc<M extends RpcMethod>(
  method: M,
  params: RpcParams<M>,
  options: { topics?: CoreEventTopic[]; enabled?: boolean } = {},
): RpcState<RpcResult<M>> {
  const { topics = [], enabled = true } = options;
  const [data, setData] = useState<RpcResult<M>>();
  const [error, setError] = useState<unknown>();
  const [loading, setLoading] = useState(enabled);
  const [tick, setTick] = useState(0);
  const latest = useRef(0);
  const paramsKey = JSON.stringify(params ?? null);
  const topicsKey = topics.join(',');

  const reload = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    if (!enabled) return;
    const requestId = ++latest.current;
    setLoading(true);
    const call = core.call.bind(core) as (m: RpcMethod, p?: unknown) => Promise<RpcResult<M>>;
    call(method, params)
      .then((result) => {
        if (requestId !== latest.current) return;
        setData(result);
        setError(undefined);
      })
      .catch((err: unknown) => {
        if (requestId === latest.current) setError(err);
      })
      .finally(() => {
        if (requestId === latest.current) setLoading(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [method, paramsKey, enabled, tick]);

  useEffect(() => {
    if (!enabled) return;
    const offs = topicsKey ? topicsKey.split(',').map((topic) => core.on(topic as CoreEventTopic, reload)) : [];
    offs.push(core.onConnect(reload));
    return () => offs.forEach((off) => off());
  }, [topicsKey, enabled, reload]);

  return { data, error, loading, reload };
}
