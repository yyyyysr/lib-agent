import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useChat } from '@ai-sdk/react';
import type { UIMessage } from 'ai';
import { PanelRight, RotateCcw, TriangleAlert } from 'lucide-react';
import { TopBar } from '../../app/TopBar';
import { Button, EmptyState, IconButton, Spinner } from '../../components/ui';
import { core, errorText } from '../../lib/core-client';
import { chatTransport } from '../../lib/ipc-chat-transport';
import { useRpc } from '../../lib/use-rpc';
import { useAppStore } from '../../store/app-store';
import { ArtifactPanel } from './ArtifactPanel';
import { Composer } from './Composer';
import { collectCandidateBooks, MessageView } from './MessageView';

/** 首页发起的第一条消息只发送一次（React StrictMode 下组件会挂载两次） */
const sentPending = new Set<string>();

function ChatSession({ conversationId, initialMessages, pendingText }: { conversationId: string; initialMessages: UIMessage[]; pendingText?: string }) {
  const { panelOpen, togglePanel } = useAppStore();
  const { data: conversations } = useRpc('conversations.list', undefined, { topics: ['conversations.changed'] });
  const { messages, sendMessage, status, stop, error, regenerate, clearError } = useChat({
    id: conversationId,
    messages: initialMessages,
    transport: chatTransport,
  });
  const [input, setInput] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);

  useEffect(() => {
    if (pendingText && !sentPending.has(conversationId)) {
      sentPending.add(conversationId);
      void sendMessage({ text: pendingText });
    }
  }, [conversationId, pendingText, sendMessage]);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [messages, status]);

  const busy = status === 'submitted' || status === 'streaming';
  const candidates = useMemo(() => collectCandidateBooks(messages), [messages]);
  const title = conversations?.find((c) => c.id === conversationId)?.title ?? '新的书展';
  const err = error ? errorText(error) : null;
  const lastIsUser = messages.at(-1)?.role === 'user';

  const submit = (): void => {
    const text = input.trim();
    if (!text) return;
    setInput('');
    stickToBottom.current = true;
    if (error) clearError();
    void sendMessage({ text });
  };

  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar
          title={title}
          actions={
            <IconButton label={panelOpen ? '收起活动包面板' : '展开活动包面板'} onClick={togglePanel}>
              <PanelRight className="size-[18px]" />
            </IconButton>
          }
        />
        <div
          ref={scrollRef}
          onScroll={(e) => {
            const el = e.currentTarget;
            stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
          }}
          className="min-h-0 flex-1 overflow-y-auto"
        >
          <div className="mx-auto w-full max-w-[760px] space-y-6 px-6 pt-4 pb-8">
            {messages.map((message, index) => (
              <MessageView key={message.id} message={message} streaming={busy && index === messages.length - 1} />
            ))}
            {status === 'submitted' && lastIsUser && <p className="text-shimmer text-[15px]">正在思考…</p>}
            {err && (
              <div className="flex items-start gap-3 rounded-2xl border border-danger/30 bg-danger-soft px-4 py-3">
                <TriangleAlert className="mt-0.5 size-4 shrink-0 text-danger" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-danger">{err.message}</p>
                  {err.hint && <p className="mt-0.5 text-xs text-muted">{err.hint}</p>}
                </div>
                <Button size="sm" variant="outline" onClick={() => (clearError(), void regenerate())}>
                  <RotateCcw className="size-3.5" /> 重试
                </Button>
              </div>
            )}
          </div>
        </div>
        <div className="mx-auto w-full max-w-[760px] px-6 pb-5">
          <Composer value={input} onChange={setInput} onSubmit={submit} onStop={() => void stop()} busy={busy} autoFocus />
          <p className="mt-2 text-center text-[11px] text-subtle">智能体生成的是草案，书目信息与文案需馆员核对后使用。</p>
        </div>
      </div>
      {panelOpen && <ArtifactPanel candidates={candidates} />}
    </div>
  );
}

export function ChatView({ conversationId, pendingText }: { conversationId: string; pendingText?: string }) {
  const [initial, setInitial] = useState<UIMessage[] | null>(pendingText ? [] : null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const navigate = useAppStore((s) => s.navigate);

  useEffect(() => {
    if (initial) return;
    core
      .call('conversations.get', { id: conversationId })
      .then((conversation) => setInitial(conversation.messages as UIMessage[]))
      .catch((error: unknown) => setLoadError(errorText(error).message));
    // 只在挂载时加载一次；之后由 useChat 维护消息
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loadError) {
    return (
      <div className="flex flex-1 flex-col">
        <TopBar />
        <EmptyState title="无法打开这个书展任务" description={loadError} action={<Button onClick={() => navigate({ name: 'home' })}>返回首页</Button>} />
      </div>
    );
  }
  if (!initial) {
    return (
      <div className="flex flex-1 flex-col">
        <TopBar />
        <div className="flex flex-1 items-center justify-center">
          <Spinner />
        </div>
      </div>
    );
  }
  return <ChatSession conversationId={conversationId} initialMessages={initial} pendingText={pendingText} />;
}
