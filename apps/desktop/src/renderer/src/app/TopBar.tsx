import type { ReactNode } from 'react';
import { PanelLeft, SquarePen } from 'lucide-react';
import { IconButton } from '../components/ui';
import { formatShortcut } from '../lib/platform';
import { useAppStore } from '../store/app-store';

/** 每个页面顶部的标题栏：整条可拖动窗口，左右为系统窗口控件留出空间 */
export function TopBar({ title, actions }: { title?: ReactNode; actions?: ReactNode }) {
  const { sidebarOpen, toggleSidebar, navigate } = useAppStore();
  return (
    <header
      className="drag-region flex h-(--titlebar-height) shrink-0 items-center gap-1.5 pr-3"
      style={{
        paddingLeft: sidebarOpen ? 12 : 'calc(var(--titlebar-inset-left) + 8px)',
        paddingRight: 'calc(var(--titlebar-inset-right) + 12px)',
      }}
    >
      {!sidebarOpen && (
        <>
          <IconButton label={`展开侧栏 ${formatShortcut('b')}`} onClick={toggleSidebar}>
            <PanelLeft className="size-[18px]" />
          </IconButton>
          <IconButton label={`新建书展 ${formatShortcut('n')}`} onClick={() => navigate({ name: 'home' })}>
            <SquarePen className="size-[18px]" />
          </IconButton>
        </>
      )}
      <div className="min-w-0 flex-1 truncate px-1.5 text-[15px] font-medium">{title}</div>
      {actions && <div className="no-drag flex items-center gap-1">{actions}</div>}
    </header>
  );
}
