import { z } from 'zod';
import {
  AppError,
  isAppErrorShape,
  methodAccess,
  rpcParamSchemas,
  streamParamSchemas,
  type AccessLevel,
  type AppErrorShape,
  type CoreEventTopic,
  type CoreEvents,
  type RpcMethod,
  type RpcResult,
  type StreamChunks,
  type StreamMethod,
  type UserInfo,
  type WireMessage,
} from '@yys/shared';
import { checkAccess } from './auth';

/** MessagePortMain 的最小子集，便于在测试中替换 */
export interface PortLike {
  on(event: 'message', listener: (event: { data: unknown }) => void): unknown;
  on(event: 'close', listener: () => void): unknown;
  postMessage(message: unknown): void;
  start(): void;
}

export interface HandlerContext {
  signal: AbortSignal;
  user: UserInfo | null;
  token?: string;
}

/** 非公开方法的处理函数拿到的一定是已登录用户 */
export interface AuthedContext extends HandlerContext {
  user: UserInfo;
}

type Ctx<M extends RpcMethod | StreamMethod> = (typeof methodAccess)[M] extends 'public'
  ? HandlerContext
  : AuthedContext;

export type RpcHandlers = {
  [M in RpcMethod]: (
    params: z.output<(typeof rpcParamSchemas)[M]>,
    ctx: Ctx<M>,
  ) => Promise<RpcResult<M>> | RpcResult<M>;
};

export type StreamHandlers = {
  [M in StreamMethod]: (
    params: z.output<(typeof streamParamSchemas)[M]>,
    ctx: Ctx<M>,
  ) => Promise<AsyncIterable<StreamChunks[M]>>;
};

export function toErrorShape(error: unknown, log?: (error: unknown) => void): AppErrorShape {
  if (error instanceof AppError) return error.toJSON();
  if (error instanceof z.ZodError) {
    return { code: 'invalid_params', message: error.issues.map((i) => i.message).join('；') };
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
    private readonly authenticate: (token: string | undefined) => UserInfo | null,
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

  private async onMessage(
    port: PortLike,
    message: WireMessage,
    active: Map<number, AbortController>,
  ): Promise<void> {
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

  private context(
    method: RpcMethod | StreamMethod,
    token: string | undefined,
    signal: AbortSignal,
  ): HandlerContext {
    const level = (methodAccess as Record<string, AccessLevel | undefined>)[method];
    if (!level) throw new AppError('invalid_params', `未知方法：${method}`);
    const user = this.authenticate(token);
    checkAccess(level, user);
    return { signal, user, token };
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
      const ctx = this.context(method, message.token, controller.signal);
      const params: unknown = schema.parse(message.params);
      const result = await handler(params, ctx);
      port.postMessage({ kind: 'res', id: message.id, result } satisfies WireMessage);
    } catch (error) {
      port.postMessage({
        kind: 'res',
        id: message.id,
        error: toErrorShape(error, this.log),
      } satisfies WireMessage);
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
      const handler = this.streams[method] as (
        params: unknown,
        ctx: HandlerContext,
      ) => Promise<AsyncIterable<unknown>>;
      if (!schema || !handler)
        throw new AppError('invalid_params', `未知流方法：${message.method}`);
      const ctx = this.context(method, message.token, controller.signal);
      const params: unknown = schema.parse(message.params);
      const stream = await handler(params, ctx);
      for await (const chunk of stream) {
        port.postMessage({ kind: 'chunk', id: message.id, chunk } satisfies WireMessage);
      }
      port.postMessage({ kind: 'end', id: message.id } satisfies WireMessage);
    } catch (error) {
      port.postMessage({
        kind: 'end',
        id: message.id,
        error: toErrorShape(error, this.log),
      } satisfies WireMessage);
    } finally {
      active.delete(message.id);
    }
  }
}
