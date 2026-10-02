import { z } from 'zod';
import {
  AppError,
  isAppErrorShape,
  rpcParamSchemas,
  streamParamSchemas,
  type AppErrorShape,
  type CoreEventTopic,
  type CoreEvents,
  type RpcMethod,
  type RpcResult,
  type StreamMethod,
  type WireMessage,
} from '@yys/shared';

/** MessagePortMain 的最小子集，便于在测试中替换 */
export interface PortLike {
  on(event: 'message', listener: (event: { data: unknown }) => void): unknown;
  on(event: 'close', listener: () => void): unknown;
  postMessage(message: unknown): void;
  start(): void;
}

export interface HandlerContext {
  signal: AbortSignal;
}

export type RpcHandlers = {
  [M in RpcMethod]: (
    params: z.output<(typeof rpcParamSchemas)[M]>,
    ctx: HandlerContext,
  ) => Promise<RpcResult<M>> | RpcResult<M>;
};

export type StreamHandlers = {
  [M in StreamMethod]: (
    params: z.output<(typeof streamParamSchemas)[M]>,
    ctx: HandlerContext,
  ) => Promise<AsyncIterable<unknown>>;
};

export function toErrorShape(error: unknown, log?: (error: unknown) => void): AppErrorShape {
  if (error instanceof AppError) return error.toJSON();
  if (error instanceof z.ZodError) {
    return { code: 'invalid_params', message: `参数不合法：${error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('；')}` };
  }
  if (isAppErrorShape(error)) return { code: error.code, message: error.message, hint: error.hint };
  log?.(error);
  return { code: 'internal', message: error instanceof Error ? error.message : String(error) };
}

export class RpcServer {
  private readonly ports = new Set<PortLike>();

  constructor(
    private readonly handlers: RpcHandlers,
    private readonly streams: StreamHandlers,
    private readonly log: (error: unknown) => void = console.error,
  ) {}

  attach(port: PortLike): void {
    const active = new Map<number, AbortController>();
    this.ports.add(port);
    port.on('message', (event) => void this.onMessage(port, event.data as WireMessage, active));
    port.on('close', () => {
      for (const controller of active.values()) controller.abort();
      active.clear();
      this.ports.delete(port);
    });
    port.start();
  }

  emit<T extends CoreEventTopic>(topic: T, payload: CoreEvents[T]): void {
    const message: WireMessage = { kind: 'evt', topic, payload };
    for (const port of this.ports) port.postMessage(message);
  }

  private async onMessage(port: PortLike, message: WireMessage, active: Map<number, AbortController>): Promise<void> {
    switch (message.kind) {
      case 'req':
        return this.handleRequest(port, message, active);
      case 'stream':
        return this.handleStream(port, message, active);
      case 'cancel':
        active.get(message.id)?.abort();
        return;
      default:
        return;
    }
  }

  private async handleRequest(
    port: PortLike,
    message: Extract<WireMessage, { kind: 'req' }>,
    active: Map<number, AbortController>,
  ): Promise<void> {
    const controller = new AbortController();
    active.set(message.id, controller);
    try {
      const method = message.method as RpcMethod;
      const schema = rpcParamSchemas[method];
      const handler = this.handlers[method] as (params: unknown, ctx: HandlerContext) => unknown;
      if (!schema || !handler) throw new AppError('invalid_params', `未知方法：${message.method}`);
      const params: unknown = schema.parse(message.params);
      const result = await handler(params, { signal: controller.signal });
      port.postMessage({ kind: 'res', id: message.id, result } satisfies WireMessage);
    } catch (error) {
      port.postMessage({ kind: 'res', id: message.id, error: toErrorShape(error, this.log) } satisfies WireMessage);
    } finally {
      active.delete(message.id);
    }
  }

  private async handleStream(
    port: PortLike,
    message: Extract<WireMessage, { kind: 'stream' }>,
    active: Map<number, AbortController>,
  ): Promise<void> {
    const controller = new AbortController();
    active.set(message.id, controller);
    try {
      const method = message.method as StreamMethod;
      const schema = streamParamSchemas[method];
      const handler = this.streams[method] as (params: unknown, ctx: HandlerContext) => Promise<AsyncIterable<unknown>>;
      if (!schema || !handler) throw new AppError('invalid_params', `未知流方法：${message.method}`);
      const params: unknown = schema.parse(message.params);
      const stream = await handler(params, { signal: controller.signal });
      for await (const chunk of stream) {
        port.postMessage({ kind: 'chunk', id: message.id, chunk } satisfies WireMessage);
      }
      port.postMessage({ kind: 'end', id: message.id } satisfies WireMessage);
    } catch (error) {
      port.postMessage({ kind: 'end', id: message.id, error: toErrorShape(error, this.log) } satisfies WireMessage);
    } finally {
      active.delete(message.id);
    }
  }
}
