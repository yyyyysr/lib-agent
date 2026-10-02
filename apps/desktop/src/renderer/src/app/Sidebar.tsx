import { useMemo, useState } from 'react';
import { BookMarked, Ellipsis, LibraryBig, PanelLeft, Pencil, Search, Settings, SquarePen, Trash2, University, X } from 'lucide-react';
import type { ConversationSummary } from '@yys/shared';
import { Badge, Button, Dialog, IconButton, Input, Menu, MenuContent, MenuItem, MenuTrigger } from '../components/ui';
import { core, errorText } from '../lib/core-client';
import { cn } from '../lib/cn';
import { formatShortcut } from '../lib/platform';
import { useRpc } from '../lib/use-rpc';
import { toast, useAppStore } from '../store/app-store';

function groupByDate(items: ConversationSummary[]): { label: string; items: ConversationSummary[] }[] {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const day = 86_400_000;
  const groups = [
    { label: '今天', min: startOfToday.getTime(), items: [] as ConversationSummary[] },
    { label: '昨天', min: startOfToday.getTime() - day, items: [] as ConversationSummary[] },
    { label: '近 7 天', min: startOfToday.getTime() - 7 * day, items: [] as ConversationSummary[] },
    { label: '更早', min: -Infinity, items: [] as ConversationSummary[] },
  ];
  for (const item of items) {
    const at = new Date(item.updatedAt).getTime();
    groups.find((g) => at >= g.min)!.items.push(item);
  }
  return groups.filter((g) => g.items.length > 0);
}

function NavItem({ icon, label, active, onClick, trailing }: { icon: React.ReactNode; label: string; active?: boolean; onClick: () => void; trailing?: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'no-drag flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-sm transition-colors',
        active ? 'bg-surface-2 font-medium' : 'hover:bg-surface-hover',
      )}
    >
      <span className="text-muted">{icon}</span>
      <span className="flex-1 truncate">{label}</span>
      {trailing}
    </button>
  );
}

function ConversationItem({ item, active }: { item: ConversationSummary; active: boolean }) {
  const navigate = useAppStore((s) => s.navigate);
  const view = useAppStore((s) => s.view);
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(item.title);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const commitRename = async (): Promise<void> => {
    setEditing(false);
    const next = title.trim();
    if (!next || next === item.title) return setTitle(item.title);
    try {
      await core.call('conversations.rename', { id: item.id, title: next });
    } catch (error) {
      setTitle(item.title);
      toast({ tone: 'error', title: '重命名失败', description: errorText(error).message });
    }
  };

  const remove = async (): Promise<void> => {
    setConfirmDelete(false);
    try {
      await core.call('conversations.delete', { id: item.id });
      if (view.name === 'chat' && view.id === item.id) navigate({ name: 'home' });
    } catch (error) {
      toast({ tone: 'error', title: '删除失败', description: errorText(error).message });
    }
  };

  if (editing) {
    return (
      <Input
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onBlur={() => void commitRename()}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.nativeEvent.isComposing) void commitRename();
          if (e.key === 'Escape') {
            setTitle(item.title);
            setEditing(false);
          }
        }}
        className="h-8 rounded-lg"
      />
    );
  }

  return (
    <div className={cn('group relative flex h-8 items-center rounded-lg', active ? 'bg-surface-2' : 'hover:bg-surface-hover')}>
      <button onClick={() => navigate({ name: 'chat', id: item.id })} className="h-full min-w-0 flex-1 truncate px-2.5 text-left text-sm">
        {item.title}
      </button>
      <Menu>
        <MenuTrigger asChild>
          <button
            aria-label="更多操作"
            className={cn(
              'mr-1 flex size-6 items-center justify-center rounded-md text-muted hover:text-fg data-[state=open]:opacity-100',
              active ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
            )}
          >
            <Ellipsis className="size-4" />
          </button>
        </MenuTrigger>
        <MenuContent align="start">
          <MenuItem onSelect={() => setEditing(true)}>
            <Pencil className="size-3.5" /> 重命名
          </MenuItem>
          <MenuItem danger onSelect={() => setConfirmDelete(true)}>
            <Trash2 className="size-3.5" /> 删除
          </MenuItem>
        </MenuContent>
      </Menu>
      <Dialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="删除这个书展任务？"
        description={`“${item.title}”的对话记录将被删除，此操作无法撤销。`}
        width="max-w-md"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmDelete(false)}>
              取消
            </Button>
            <Button variant="danger" onClick={() => void remove()}>
              删除
            </Button>
          </>
        }
      >
        {null}
      </Dialog>
    </div>
  );
}

export function Sidebar() {
  const { view, navigate, toggleSidebar } = useAppStore();
  const { data: conversations = [] } = useRpc('conversations.list', undefined, { topics: ['conversations.changed'] });
  const { data: campus } = useRpc('campus.status', undefined);
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    return groupByDate(q ? conversations.filter((c) => c.title.toLowerCase().includes(q)) : conversations);
  }, [conversations, query]);

  const campusLabel = campus?.state === 'connected' ? '已连接' : campus?.state === 'not_configured' || !campus ? '未配置' : '未接入';

  return (
    <aside className="flex w-[260px] shrink-0 flex-col border-r border-border bg-sidebar">
      <div className="drag-region flex h-(--titlebar-height) shrink-0 items-center justify-end gap-0.5 px-2" style={{ paddingLeft: 'var(--titlebar-inset-left)' }}>
        <IconButton label={`收起侧栏 ${formatShortcut('b')}`} onClick={toggleSidebar}>
          <PanelLeft className="size-[18px]" />
        </IconButton>
        <IconButton label={`新建书展 ${formatShortcut('n')}`} onClick={() => navigate({ name: 'home' })}>
          <SquarePen className="size-[18px]" />
        </IconButton>
      </div>

      <nav className="space-y-0.5 px-2 pb-2">
        <NavItem icon={<SquarePen className="size-4" />} label="新建书展" active={view.name === 'home'} onClick={() => navigate({ name: 'home' })} />
        <NavItem icon={<LibraryBig className="size-4" />} label="书库" active={view.name === 'library'} onClick={() => navigate({ name: 'library' })} />
        {searching ? (
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-subtle" />
            <Input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Escape' && (setQuery(''), setSearching(false))}
              placeholder="搜索书展任务"
              className="h-9 rounded-lg pl-8"
            />
            <button aria-label="清除搜索" onClick={() => (setQuery(''), setSearching(false))} className="absolute top-1/2 right-2 -translate-y-1/2 text-subtle hover:text-fg">
              <X className="size-3.5" />
            </button>
          </div>
        ) : (
          <NavItem icon={<Search className="size-4" />} label="搜索" onClick={() => setSearching(true)} />
        )}
      </nav>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {groups.length === 0 ? (
          <p className="px-2.5 pt-4 text-[13px] text-subtle">{query ? '没有匹配的任务' : '还没有书展任务'}</p>
        ) : (
          groups.map((group) => (
            <div key={group.label} className="pt-3">
              <p className="px-2.5 pb-1 text-xs font-medium text-subtle">{group.label}</p>
              {group.items.map((item) => (
                <ConversationItem key={item.id} item={item} active={view.name === 'chat' && view.id === item.id} />
              ))}
            </div>
          ))
        )}
      </div>

      <div className="space-y-0.5 border-t border-border p-2">
        <NavItem
          icon={<University className="size-4" />}
          label="校园数据库"
          onClick={() => navigate({ name: 'settings', section: 'school' })}
          trailing={<Badge tone={campus?.state === 'connected' ? 'success' : 'neutral'}>{campusLabel}</Badge>}
        />
        <NavItem
          icon={<Settings className="size-4" />}
          label="设置"
          active={view.name === 'settings'}
          onClick={() => navigate({ name: 'settings', section: 'models' })}
          trailing={<span className="text-[11px] text-subtle">{formatShortcut(',')}</span>}
        />
        <div className="flex items-center gap-2 px-2.5 pt-1.5 text-[11px] text-subtle">
          <BookMarked className="size-3.5" /> 一页书展 · AI 策展助手
        </div>
      </div>
    </aside>
  );
}
