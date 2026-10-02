import { useState } from 'react';
import type { UIMessage } from 'ai';
import { Brain, Check, ChevronRight, ExternalLink, Loader2, Search, TriangleAlert } from 'lucide-react';
import type { LibrarySearchOutput, LibraryToolBook } from '@yys/shared';
import { Badge } from '../../components/ui';
import { cn } from '../../lib/cn';
import { Markdown } from './Markdown';

type Part = UIMessage['parts'][number];

interface ToolPart {
  type: string;
  toolCallId: string;
  state: 'input-streaming' | 'input-available' | 'output-available' | 'output-error' | string;
  input?: unknown;
  output?: unknown;
  errorText?: string;
}

const isToolPart = (part: Part): part is Part & ToolPart => part.type.startsWith('tool-') || part.type === 'dynamic-tool';

export function BookRow({ book }: { book: LibraryToolBook }) {
  return (
    <div className="flex items-start gap-3 py-2">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[13px] font-medium">《{book.title}》</span>
          {book.isSample && <Badge>示例</Badge>}
          {book.missingFields.length > 0 && <Badge tone="warning">缺 {book.missingFields.join('、')}</Badge>}
        </div>
        <p className="mt-0.5 truncate text-xs text-muted">
          {book.authors.join('、') || '作者待核对'}
          {book.callNumber ? ` · ${book.callNumber}` : ''}
        </p>
      </div>
      {book.sourceUrl && /^https?:\/\//.test(book.sourceUrl) && (
        <button
          aria-label="打开来源链接"
          onClick={() => void window.yys.shell.openExternal(book.sourceUrl!)}
          className="mt-0.5 text-subtle hover:text-fg"
        >
          <ExternalLink className="size-3.5" />
        </button>
      )}
    </div>
  );
}

function ToolCallCard({ part }: { part: ToolPart }) {
  const [open, setOpen] = useState(false);
  const running = part.state === 'input-streaming' || part.state === 'input-available';
  const failed = part.state === 'output-error';
  const keyword = (part.input as { keyword?: string } | undefined)?.keyword;
  const output = part.state === 'output-available' ? (part.output as LibrarySearchOutput | undefined) : undefined;
  const isSearch = part.type === 'tool-search_library';

  const summary = isSearch
    ? running
      ? `正在检索馆藏${keyword ? `：${keyword}` : ''}`
      : failed
        ? '检索失败'
        : `检索馆藏${keyword ? `“${keyword}”` : ''} · ${output?.total ?? 0} 条结果`
    : running
      ? `正在调用 ${part.type.replace(/^tool-/, '')}`
      : `已调用 ${part.type.replace(/^tool-/, '')}`;

  return (
    <div className="my-1.5">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 rounded-md py-0.5 text-[13px] text-muted hover:text-fg"
      >
        {running ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : failed ? (
          <TriangleAlert className="size-3.5 text-danger" />
        ) : isSearch ? (
          <Search className="size-3.5" />
        ) : (
          <Check className="size-3.5" />
        )}
        <span className={cn(running && 'text-shimmer')}>{summary}</span>
        {!running && <ChevronRight className={cn('size-3.5 transition-transform', open && 'rotate-90')} />}
      </button>
      {open && !running && (
        <div className="mt-1.5 ml-5 rounded-xl border border-border px-3.5 py-1.5">
          {failed && <p className="py-2 text-xs text-danger">{part.errorText}</p>}
          {output?.books.length === 0 && <p className="py-2 text-xs text-muted">没有找到匹配的馆藏记录</p>}
          {output && output.books.length > 0 && (
            <div className="divide-y divide-border">
              {output.books.map((book) => (
                <BookRow key={book.id} book={book} />
              ))}
            </div>
          )}
          {!isSearch && !failed && <pre className="overflow-x-auto py-2 text-xs text-muted">{JSON.stringify(part.output, null, 2)}</pre>}
        </div>
      )}
    </div>
  );
}

function ReasoningBlock({ text, streaming }: { text: string; streaming: boolean }) {
  const [open, setOpen] = useState(false);
  if (!text.trim()) return null;
  return (
    <div className="my-1.5">
      <button onClick={() => setOpen((v) => !v)} className="flex items-center gap-1.5 text-[13px] text-muted hover:text-fg">
        <Brain className="size-3.5" />
        <span className={cn(streaming && 'text-shimmer')}>{streaming ? '思考中' : '思考过程'}</span>
        <ChevronRight className={cn('size-3.5 transition-transform', open && 'rotate-90')} />
      </button>
      {open && <p className="mt-1.5 ml-5 border-l-2 border-border pl-3 text-[13px] leading-relaxed whitespace-pre-wrap text-muted">{text}</p>}
    </div>
  );
}

export function MessageView({ message, streaming }: { message: UIMessage; streaming: boolean }) {
  if (message.role === 'user') {
    const text = message.parts.map((p) => (p.type === 'text' ? p.text : '')).join('');
    return (
      <div className="flex justify-end">
        <div data-selectable className="max-w-[75%] rounded-3xl bg-surface px-4 py-2.5 whitespace-pre-wrap">
          {text}
        </div>
      </div>
    );
  }

  return (
    <div data-selectable className="min-w-0">
      {message.parts.map((part, index) => {
        if (part.type === 'text') return <Markdown key={index} text={part.text} />;
        if (part.type === 'reasoning') return <ReasoningBlock key={index} text={part.text} streaming={streaming && part.state === 'streaming'} />;
        if (isToolPart(part)) return <ToolCallCard key={part.toolCallId ?? index} part={part} />;
        return null;
      })}
    </div>
  );
}

/** 汇总一段对话里所有检索结果，供右侧面板展示候选书目 */
export function collectCandidateBooks(messages: UIMessage[]): LibraryToolBook[] {
  const byId = new Map<string, LibraryToolBook>();
  for (const message of messages) {
    for (const part of message.parts) {
      if (part.type !== 'tool-search_library') continue;
      const toolPart = part as unknown as ToolPart;
      if (toolPart.state !== 'output-available') continue;
      for (const book of (toolPart.output as LibrarySearchOutput).books ?? []) byId.set(book.id, book);
    }
  }
  return [...byId.values()];
}
