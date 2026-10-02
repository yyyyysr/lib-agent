import { useEffect, useState } from 'react';
import { BookCopy, ChevronDown, ClipboardPaste, ExternalLink, FileUp, FolderInput, Library, Search, Trash2, University } from 'lucide-react';
import { assessCompleteness, bookFieldLabels, type BookRecord, type BookSourceInfo } from '@yys/shared';
import { TopBar } from '../../app/TopBar';
import { Badge, Button, Dialog, EmptyState, IconButton, Input, Menu, MenuContent, MenuItem, MenuTrigger, Spinner, Tooltip } from '../../components/ui';
import { cn } from '../../lib/cn';
import { core, errorText } from '../../lib/core-client';
import { useRpc } from '../../lib/use-rpc';
import { toast, useAppStore } from '../../store/app-store';
import { useImportBooks } from './useImportBooks';

const PAGE_SIZE = 50;

function useDebounced<T>(value: T, ms = 250): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return debounced;
}

function SourceItem({ source, active, onClick, onDelete }: { source: BookSourceInfo | null; active: boolean; onClick: () => void; onDelete?: () => void }) {
  const icon = !source ? <Library className="size-4" /> : source.kind === 'sample' ? <BookCopy className="size-4" /> : <FolderInput className="size-4" />;
  return (
    <div className={cn('group flex h-9 items-center rounded-lg pr-1', active ? 'bg-surface-2' : 'hover:bg-surface-hover')}>
      <button onClick={onClick} className="flex h-full min-w-0 flex-1 items-center gap-2.5 px-2.5 text-left text-sm">
        <span className="text-muted">{icon}</span>
        <span className="flex-1 truncate">{source ? source.name : '全部书目'}</span>
        {source?.kind === 'sample' && <Badge>示例</Badge>}
        {source && <span className="text-xs text-subtle">{source.bookCount}</span>}
      </button>
      {onDelete && (
        <IconButton label="删除这个来源" size="sm" onClick={onDelete} className="opacity-0 group-hover:opacity-100">
          <Trash2 className="size-3.5" />
        </IconButton>
      )}
    </div>
  );
}

function CompletenessBadge({ book }: { book: BookRecord }) {
  const { missingRequired, missingRecommended } = assessCompleteness(book);
  if (missingRequired.length === 0 && missingRecommended.length === 0) return <Badge tone="success">完整</Badge>;
  const missing = [...missingRequired, ...missingRecommended].map((f) => bookFieldLabels[f]).join('、');
  return (
    <Tooltip content={`缺少：${missing}`}>
      <span>
        <Badge tone={missingRequired.length ? 'danger' : 'warning'}>缺 {missingRequired.length + missingRecommended.length} 项</Badge>
      </span>
    </Tooltip>
  );
}

export function LibraryView() {
  const navigate = useAppStore((s) => s.navigate);
  const [sourceId, setSourceId] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [pendingDelete, setPendingDelete] = useState<BookSourceInfo | null>(null);
  const query = useDebounced(text);
  const { importFromFile, openPaste, dialogs, busy } = useImportBooks();

  const sources = useRpc('books.sources', undefined, { topics: ['books.changed'] });
  const books = useRpc('books.search', { text: query, sourceIds: sourceId ? [sourceId] : undefined, limit }, { topics: ['books.changed'] });

  useEffect(() => setLimit(PAGE_SIZE), [query, sourceId]);

  const removeSource = async (): Promise<void> => {
    if (!pendingDelete) return;
    const target = pendingDelete;
    setPendingDelete(null);
    try {
      await core.call('books.deleteSource', { id: target.id });
      if (sourceId === target.id) setSourceId(null);
      toast({ tone: 'success', title: `已删除“${target.name}”` });
    } catch (error) {
      toast({ tone: 'error', title: '删除失败', description: errorText(error).message });
    }
  };

  const items = books.data?.items ?? [];
  const total = books.data?.total ?? 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <TopBar
        title="书库"
        actions={
          <Menu>
            <MenuTrigger asChild>
              <Button variant="primary" size="sm" loading={busy}>
                导入书目 <ChevronDown className="size-3.5" />
              </Button>
            </MenuTrigger>
            <MenuContent align="end">
              <MenuItem onSelect={() => void importFromFile()}>
                <FileUp className="size-3.5" /> 从文件导入（Excel / CSV / TXT / JSON）
              </MenuItem>
              <MenuItem onSelect={openPaste}>
                <ClipboardPaste className="size-3.5" /> 粘贴文本
              </MenuItem>
            </MenuContent>
          </Menu>
        }
      />
      <div className="flex min-h-0 flex-1 border-t border-border">
        <div className="flex w-60 shrink-0 flex-col border-r border-border p-2">
          <SourceItem source={null} active={sourceId === null} onClick={() => setSourceId(null)} />
          {(sources.data ?? []).map((source) => (
            <SourceItem
              key={source.id}
              source={source}
              active={sourceId === source.id}
              onClick={() => setSourceId(source.id)}
              onDelete={source.kind === 'sample' ? undefined : () => setPendingDelete(source)}
            />
          ))}
          <div className="mt-auto rounded-xl border border-dashed border-border-strong p-3">
            <div className="flex items-center gap-2 text-[13px] font-medium">
              <University className="size-4 text-muted" /> 校园馆藏数据库
            </div>
            <p className="mt-1 text-xs leading-relaxed text-muted">学校授权后可登录直接检索馆藏。目前请在学校系统中导出后导入。</p>
            <Button size="sm" variant="outline" className="mt-2.5 w-full" onClick={() => navigate({ name: 'settings', section: 'school' })}>
              学校设置
            </Button>
          </div>
        </div>

        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center gap-3 px-5 py-3">
            <div className="relative max-w-md flex-1">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-subtle" />
              <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="按书名、作者、主题词、摘要检索" className="pl-9" />
            </div>
            <span className="text-[13px] text-muted">{books.loading && !books.data ? '加载中…' : `共 ${total} 本`}</span>
          </div>

          <div className="min-h-0 flex-1 overflow-auto px-5 pb-5">
            {books.error ? (
              <EmptyState title="加载失败" description={errorText(books.error).message} action={<Button onClick={books.reload}>重试</Button>} />
            ) : items.length === 0 && !books.loading ? (
              <EmptyState
                icon={<Library className="size-8" />}
                title={query ? '没有匹配的书目' : '这个来源还没有书目'}
                description={query ? '换个关键词试试；两个字的关键词也可以检索。' : '从学校系统导出 Excel / CSV / TXT / JSON 后导入。'}
              />
            ) : (
              <table data-selectable className="w-full text-left text-[13px]">
                <thead className="sticky top-0 bg-bg text-xs text-subtle">
                  <tr className="border-b border-border">
                    <th className="py-2 pr-3 font-medium">书名</th>
                    <th className="py-2 pr-3 font-medium">作者</th>
                    <th className="py-2 pr-3 font-medium">索书号</th>
                    <th className="py-2 pr-3 font-medium">主题词</th>
                    <th className="py-2 pr-3 font-medium">完整度</th>
                    <th className="w-8 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {items.map((book) => (
                    <tr key={book.id} className="border-b border-border align-top hover:bg-surface-hover/60">
                      <td className="py-2.5 pr-3">
                        <div className="flex items-center gap-1.5 font-medium">
                          {book.title}
                          {book.isSample && <Badge>示例</Badge>}
                        </div>
                        {book.summary && <p className="mt-0.5 line-clamp-1 text-xs text-muted">{book.summary}</p>}
                      </td>
                      <td className="py-2.5 pr-3 text-muted">{book.authors.join('、') || '—'}</td>
                      <td className="py-2.5 pr-3 whitespace-nowrap text-muted">{book.callNumber ?? '—'}</td>
                      <td className="py-2.5 pr-3 text-muted">{book.subjects?.slice(0, 3).join('、') || '—'}</td>
                      <td className="py-2.5 pr-3">
                        <CompletenessBadge book={book} />
                      </td>
                      <td className="py-2.5">
                        {book.sourceUrl && /^https?:\/\//.test(book.sourceUrl) && (
                          <IconButton label="打开来源链接" size="sm" onClick={() => void window.yys.shell.openExternal(book.sourceUrl!)}>
                            <ExternalLink className="size-3.5" />
                          </IconButton>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {items.length < total && (
              <div className="flex justify-center pt-4">
                <Button variant="outline" size="sm" onClick={() => setLimit((l) => l + PAGE_SIZE)} disabled={books.loading}>
                  {books.loading ? <Spinner /> : '加载更多'}
                </Button>
              </div>
            )}
          </div>
        </div>
      </div>

      <Dialog
        open={pendingDelete !== null}
        onOpenChange={(open) => !open && setPendingDelete(null)}
        title={`删除“${pendingDelete?.name ?? ''}”？`}
        description={`将删除该来源下的 ${pendingDelete?.bookCount ?? 0} 本书目记录，原始文件不受影响。`}
        width="max-w-md"
        footer={
          <>
            <Button variant="ghost" onClick={() => setPendingDelete(null)}>
              取消
            </Button>
            <Button variant="danger" onClick={() => void removeSource()}>
              删除
            </Button>
          </>
        }
      >
        {null}
      </Dialog>
      {dialogs}
    </div>
  );
}
