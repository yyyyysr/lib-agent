import type {
  AppErrorShape,
  CoreEventTopic,
  CoreEvents,
  RpcMethod,
  RpcParams,
  RpcResult,
  StreamChunks,
  StreamMethod,
  StreamParams,
  WireMessage,
} from '@yys/shared';

const CORE_PORT_MESSAGE = 'yys:core-port';

export class CoreError extends Error implements AppErrorShape {
  readonly code: AppErrorShape['code'];
  readonly hint?: string;
  constructor(shape: AppErrorShape) {
    super(shape.message);
    this.name = 'CoreError';
    this.code = shape.code;
    this.hint = shape.hint;
  }
}

interface Pending {
  resolve: (value: unknown) => void;
  reject: (error: CoreError) => void;
}

/**
 * Renderer 侧的 Core 客户端：经 preload 转交的 MessagePort 与 Core 直连。
 * Core 重启后主进程会推送新端口，这里自动切换，并让进行中的请求以可重试错误结束。
 */
class CoreClient {
  private port: MessagePort | null = null;
  private seq = 0;
  private readonly pending = new Map<number, Pending>();
  private readonly streams = new Map<number, ReadableStreamDefaultController<unknown>>();
  private readonly outbox: WireMessage[] = [];
  private readonly topicListeners = new Map<string, Set<(payload: unknown) => void>>();
  private readonly connectListeners = new Set<() => void>();
  private started = false;
  private token: string | null = null;
  private onUnauthorized: (() => void) | null = null;

  /** 登录会话令牌：之后的每个请求都会携带 */
  setToken(token: string | null): void {
    this.token = token;
  }

  /** 会话失效（过期、被停用、在别处退出）时回调，用于跳转登录 */
  handleUnauthorized(listener: () => void): void {
    this.onUnauthorized = listener;
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    window.addEventListener('message', (event) => {
      if (event.source !== window || event.data !== CORE_PORT_MESSAGE) return;
      const port = event.ports[0];
      if (port) this.attach(port);
    });
    window.yys.requestCorePort();
  }

  get connected(): boolean {
    return this.port !== null;
  }

  private attach(port: MessagePort): void {
    const hadPort = this.port !== null;
    this.port?.close();
    if (hadPort) {
      const error = new CoreError({ code: 'core_unavailable', message: '后台服务已重启，请重试' });
      for (const pending of this.pending.values()) pending.reject(error);
      this.pending.clear();
      for (const controller of this.streams.values()) controller.error(error);
      this.streams.clear();
    }
    this.port = port;
    port.onmessage = (event: MessageEvent<WireMessage>) => this.onMessage(event.data);
    port.start();
    for (const message of this.outbox.splice(0)) port.postMessage(message);
    for (const listener of this.connectListeners) listener();
  }

  private send(message: WireMessage): void {
    if (this.port) this.port.postMessage(message);
    else this.outbox.push(message);
  }

  private onMessage(message: WireMessage): void {
    switch (message.kind) {
      case 'res': {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        if (message.error) {
          if (message.error.code === 'unauthorized' && this.token) this.onUnauthorized?.();
          pending.reject(new CoreError(message.error));
        } else pending.resolve(message.result);
        return;
      }
      case 'chunk':
        this.streams.get(message.id)?.enqueue(message.chunk);
        return;
      case 'end': {
        const controller = this.streams.get(message.id);
        if (!controller) return;
        this.streams.delete(message.id);
        if (message.error) controller.error(new CoreError(message.error));
        else controller.close();
        return;
      }
      case 'evt':
        this.topicListeners.get(message.topic)?.forEach((listener) => listener(message.payload));
        return;
      default:
        return;
    }
  }

  call<M extends RpcMethod>(
    method: M,
    ...args: RpcParams<M> extends void ? [] : [RpcParams<M>]
  ): Promise<RpcResult<M>> {
    const id = ++this.seq;
    return new Promise<RpcResult<M>>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
      this.send({ kind: 'req', id, method, params: args[0], token: this.token ?? undefined });
    });
  }

  stream<M extends StreamMethod>(
    method: M,
    params: StreamParams<M>,
    signal?: AbortSignal,
  ): ReadableStream<StreamChunks[M]> {
    const id = ++this.seq;
    return new ReadableStream<StreamChunks[M]>({
      start: (controller) => {
        this.streams.set(id, controller as ReadableStreamDefaultController<unknown>);
        this.send({ kind: 'stream', id, method, params, token: this.token ?? undefined });
        signal?.addEventListener(
          'abort',
          () => {
            if (!this.streams.has(id)) return;
            this.send({ kind: 'cancel', id });
            this.streams.delete(id);
            controller.close();
          },
          { once: true },
        );
      },
      cancel: () => {
        if (!this.streams.has(id)) return;
        this.send({ kind: 'cancel', id });
        this.streams.delete(id);
      },
    });
  }

  on<T extends CoreEventTopic>(topic: T, listener: (payload: CoreEvents[T]) => void): () => void {
    const set = this.topicListeners.get(topic) ?? new Set();
    set.add(listener as (payload: unknown) => void);
    this.topicListeners.set(topic, set);
    return () => set.delete(listener as (payload: unknown) => void);
  }

  onConnect(listener: () => void): () => void {
    this.connectListeners.add(listener);
    return () => this.connectListeners.delete(listener);
  }
}

export const core = new CoreClient();

export function errorText(error: unknown): { message: string; hint?: string } {
  if (error instanceof CoreError) return { message: error.message, hint: error.hint };
  if (error instanceof Error) return { message: error.message };
  return { message: String(error) };
}
