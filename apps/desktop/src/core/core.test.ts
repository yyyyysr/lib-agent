import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MockLanguageModelV4, convertArrayToReadableStream } from 'ai/test';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openRepositories, type Repositories } from '@yys/db';
import type { AppErrorShape, WireMessage } from '@yys/shared';
import { RpcServer, type PortLike } from './rpc-server';
import { seedSampleLibrary } from './seed';
import { createServices } from './services';

type StreamResult = Awaited<ReturnType<MockLanguageModelV4['doStream']>>;
type StreamPart = StreamResult['stream'] extends ReadableStream<infer P> ? P : never;

const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 5, text: 5, reasoning: 0 },
} as Extract<StreamPart, { type: 'finish' }>['usage'];

const streamOf = (parts: StreamPart[]): StreamResult => ({ stream: convertArrayToReadableStream(parts) });

/** 内存中的端口对：模拟 Renderer ↔ Core 的 MessagePort */
function createClient(server: RpcServer) {
  const serverListeners: ((e: { data: unknown }) => void)[] = [];
  const inbox: WireMessage[] = [];
  const waiters: (() => void)[] = [];
  const port: PortLike = {
    on: (event: 'message' | 'close', listener: never) => {
      if (event === 'message') serverListeners.push(listener);
      return port;
    },
    postMessage: (message) => {
      inbox.push(structuredClone(message) as WireMessage);
      waiters.splice(0).forEach((wake) => wake());
    },
    start: () => {},
  };
  server.attach(port);
  let seq = 0;
  const send = (message: WireMessage): void => serverListeners.forEach((l) => l({ data: structuredClone(message) }));
  const waitFor = async <T extends WireMessage>(match: (m: WireMessage) => m is T): Promise<T> => {
    for (;;) {
      const found = inbox.find(match);
      if (found) return found;
      await new Promise<void>((resolve) => waiters.push(resolve));
    }
  };
  return {
    inbox,
    async call(method: string, params?: unknown): Promise<{ result?: unknown; error?: AppErrorShape }> {
      const id = ++seq;
      send({ kind: 'req', id, method, params });
      return waitFor((m): m is Extract<WireMessage, { kind: 'res' }> => m.kind === 'res' && m.id === id);
    },
    async stream(method: string, params: unknown): Promise<{ chunks: Record<string, unknown>[]; error?: AppErrorShape }> {
      const id = ++seq;
      send({ kind: 'stream', id, method, params });
      const end = await waitFor((m): m is Extract<WireMessage, { kind: 'end' }> => m.kind === 'end' && m.id === id);
      const chunks = inbox
        .filter((m): m is Extract<WireMessage, { kind: 'chunk' }> => m.kind === 'chunk' && m.id === id)
        .map((m) => m.chunk as Record<string, unknown>);
      return { chunks, error: end.error };
    },
  };
}

describe('Core 服务（经 RPC 调用）', () => {
  let dir: string;
  let repos: Repositories;
  let vault: Map<string, string>;
  let model: MockLanguageModelV4;
  let client: ReturnType<typeof createClient>;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'yys-core-'));
    repos = openRepositories(join(dir, 'core.db'));
    seedSampleLibrary(repos);
    vault = new Map();
    model = new MockLanguageModelV4();
    let server: RpcServer;
    const { handlers, streams } = createServices({
      repos,
      secrets: { get: async (ref) => vault.get(ref) ?? null, remove: (ref) => vault.delete(ref) },
      createModel: () => model,
      emit: (topic, payload) => server.emit(topic, payload as never),
      info: { version: 'test', dataDir: dir, platform: 'test', nodeVersion: process.versions.node, coreStartedAt: '' },
    });
    server = new RpcServer(handlers, streams, () => {});
    client = createClient(server);
  });
  afterEach(() => {
    repos.db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('示例书库只灌入一次', () => {
    expect(seedSampleLibrary(repos)).toBe(false);
    expect(repos.books.search({}).total).toBe(28);
  });

  it('参数校验失败与未知方法返回结构化错误', async () => {
    expect((await client.call('books.search', { limit: 9999 })).error?.code).toBe('invalid_params');
    expect((await client.call('nope.method')).error?.code).toBe('invalid_params');
  });

  it('检索示例书库', async () => {
    const { result } = await client.call('books.search', { text: '人工智能' });
    expect((result as { total: number }).total).toBeGreaterThanOrEqual(3);
  });

  it('文件导入生成新的书目来源，示例书库不可删除', async () => {
    const file = join(dir, '学院资料室.csv');
    writeFileSync(file, '题名,责任者,索书号\n乡土中国,费孝通,C912/2\n心流,米哈里·契克森米哈赖,B84/62\n');
    const { result } = await client.call('books.importFile', { path: file });
    expect(result).toMatchObject({ sourceName: '学院资料室', imported: 2, format: 'csv' });
    expect((await client.call('books.deleteSource', { id: 'src_sample' })).error?.code).toBe('invalid_params');
  });

  it('服务商：保存后按密钥实际存在与否返回 hasKey，删除时清理模型角色与密钥', async () => {
    const saved = (await client.call('providers.save', { presetId: 'deepseek', displayName: '', models: [{ id: 'deepseek-chat' }], enabled: true }))
      .result as { id: string; secretRef: string; hasKey: boolean; displayName: string };
    expect(saved).toMatchObject({ hasKey: false, displayName: 'DeepSeek 深度求索' });
    vault.set(saved.secretRef, 'sk-test');
    const list = (await client.call('providers.list')).result as { hasKey: boolean }[];
    expect(list[0]?.hasKey).toBe(true);

    await client.call('settings.setModelRoles', { primary: { providerId: saved.id, modelId: 'deepseek-chat' }, fast: null });
    await client.call('providers.delete', { id: saved.id });
    expect((await client.call('settings.getModelRoles')).result).toEqual({ primary: null, fast: null });
    expect(vault.has(saved.secretRef)).toBe(false);
  });

  it('未配置主模型时对话给出可操作的错误，且用户消息已保存', async () => {
    const userMessage = { id: 'u1', role: 'user', parts: [{ type: 'text', text: '找几本信息素养的书' }] };
    const { error } = await client.stream('chat.send', { conversationId: 'c1', messages: [userMessage] });
    expect(error).toMatchObject({ code: 'no_model', hint: expect.stringContaining('设置') });
    expect(repos.conversations.get('c1')).toMatchObject({ title: '找几本信息素养的书', messages: [userMessage] });
  });

  it('对话：Agent 调用检索工具后作答，用户消息与回复都落盘', async () => {
    const saved = (await client.call('providers.save', { presetId: 'ollama', displayName: '本地', models: [{ id: 'qwen3' }], enabled: true }))
      .result as { id: string };
    await client.call('settings.setModelRoles', { primary: { providerId: saved.id, modelId: 'qwen3' }, fast: null });

    model = new MockLanguageModelV4({
      doStream: [
        streamOf([
          { type: 'stream-start', warnings: [] },
          { type: 'tool-call', toolCallId: 'call_1', toolName: 'search_library', input: '{"keyword":"批判性思维","limit":5}' },
          { type: 'finish', finishReason: { unified: 'tool-calls', raw: 'tool_calls' }, usage },
        ]),
        streamOf([
          { type: 'stream-start', warnings: [] },
          { type: 'text-start', id: 't1' },
          { type: 'text-delta', id: 't1', delta: '推荐《学会提问》（示例数据）。' },
          { type: 'text-end', id: 't1' },
          { type: 'finish', finishReason: { unified: 'stop', raw: 'stop' }, usage },
        ]),
      ],
    });

    const userMessage = { id: 'u1', role: 'user', parts: [{ type: 'text', text: '帮我找几本关于批判性思维的书，面向大一新生' }] };
    const { chunks, error } = await client.stream('chat.send', { conversationId: 'conv_1', messages: [userMessage] });
    expect(error).toBeUndefined();

    const toolOutput = chunks.find((c) => c.type === 'tool-output-available') as { output: { books: { title: string; isSample: boolean }[] } };
    expect(toolOutput.output.books.map((b) => b.title)).toContain('学会提问');
    expect(toolOutput.output.books.every((b) => b.isSample)).toBe(true);
    expect(chunks.some((c) => c.type === 'text-delta')).toBe(true);

    const conversation = repos.conversations.get('conv_1');
    expect(conversation?.title).toBe('帮我找几本关于批判性思维的书，面向大一新生');
    expect(conversation?.messages).toHaveLength(2);
    expect(client.inbox.some((m) => m.kind === 'evt' && m.topic === 'conversations.changed')).toBe(true);
  });
});
