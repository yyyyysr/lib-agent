import type { ReactNode } from 'react';
import {
  ClipboardCheck,
  House,
  LibraryBig,
  LogIn,
  LogOut,
  PanelLeft,
  Settings,
  ShieldCheck,
  Sparkles,
  UserPlus,
  UserRound,
} from 'lucide-react';
import { roleLabels } from '@yys/shared';
import schoolLogoDark from '../assets/sysu-logo-dark.png';
import schoolLogo from '../assets/sysu-logo.png';
import { AppMark } from '../components/AppMark';
import {
  Badge,
  IconButton,
  Menu,
  MenuContent,
  MenuItem,
  MenuLabel,
  MenuSeparator,
  MenuTrigger,
} from '../components/ui';
import { cn } from '../lib/cn';
import { formatShortcut } from '../lib/platform';
import { useBranding } from '../lib/use-branding';
import { useRpc } from '../lib/use-rpc';
import { useAppStore, type View } from '../store/app-store';
import { useAuth, useRole } from '../store/auth-store';

function NavItem({
  icon,
  label,
  active,
  onClick,
  trailing,
}: {
  icon: ReactNode;
  label: string;
  active?: boolean;
  onClick: () => void;
  trailing?: ReactNode;
}) {
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

function PendingBadge() {
  const { data } = useRpc(
    'approvals.list',
    { status: 'pending' },
    { topics: ['approvals.changed', 'exhibitions.changed'] },
  );
  return data?.length ? <Badge tone="danger">{data.length}</Badge> : null;
}

export function Sidebar() {
  const { view, navigate, toggleSidebar } = useAppStore();
  const { user, signOut, openPrompt, accounts, switchTo } = useAuth();
  const others = accounts.filter((a) => a.username.toLowerCase() !== user?.username.toLowerCase());
  const isApprover = useRole('approver');
  const isAdmin = useRole('superadmin');
  const branding = useBranding();
  const go = (target: View) => () => navigate(target);
  const at = (name: View['name']): boolean => view.name === name;

  return (
    <aside className="flex w-[248px] shrink-0 flex-col border-r border-border bg-sidebar">
      <div
        className="drag-region flex h-(--titlebar-height) shrink-0 items-center justify-end px-2"
        style={{ paddingLeft: 'var(--titlebar-inset-left)' }}
      >
        <IconButton label={`收起侧栏 ${formatShortcut('b')}`} onClick={toggleSidebar}>
          <PanelLeft className="size-[18px]" />
        </IconButton>
      </div>

      <div className="px-4 pb-4">
        {/* 浅色模式用绿色校徽，深色模式换成白色版本 */}
        <img
          src={schoolLogo}
          alt={branding.schoolName}
          draggable={false}
          className="h-9 w-auto select-none dark:hidden"
        />
        <img
          src={schoolLogoDark}
          alt={branding.schoolName}
          draggable={false}
          className="hidden h-9 w-auto select-none dark:block"
        />
        <p className="mt-3 flex items-center gap-1.5 text-[15px] leading-tight font-semibold">
          <AppMark size="sm" />
          一页书展
        </p>
        <p className="mt-1 text-[11px] text-subtle">{branding.organizer} · AI 策展与运营智能体</p>
      </div>

      <nav className="space-y-0.5 px-2">
        <NavItem
          icon={<House className="size-4" />}
          label="首页"
          active={at('home') || at('showcase')}
          onClick={go({ name: 'home' })}
        />
        <NavItem
          icon={<Sparkles className="size-4" />}
          label="策展"
          active={at('curation') || at('exhibition')}
          onClick={go({ name: 'curation' })}
        />
        {isApprover && (
          <NavItem
            icon={<ClipboardCheck className="size-4" />}
            label="审批"
            active={at('approvals')}
            onClick={go({ name: 'approvals' })}
            trailing={<PendingBadge />}
          />
        )}
        <NavItem
          icon={<LibraryBig className="size-4" />}
          label="书库"
          active={at('library')}
          onClick={go({ name: 'library' })}
        />
        {isAdmin && (
          <NavItem
            icon={<ShieldCheck className="size-4" />}
            label="管理"
            active={at('admin')}
            onClick={go({ name: 'admin', tab: 'users' })}
          />
        )}
      </nav>

      <div className="flex-1" />

      <div className="space-y-0.5 border-t border-border p-2">
        <NavItem
          icon={<Settings className="size-4" />}
          label="设置"
          active={at('settings')}
          onClick={go({ name: 'settings', section: user ? 'account' : 'appearance' })}
          trailing={<span className="text-[11px] text-subtle">{formatShortcut(',')}</span>}
        />
        {user ? (
          <Menu>
            <MenuTrigger asChild>
              <button className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left hover:bg-surface-hover">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-surface-2 text-[13px] font-semibold">
                  {user.displayName.slice(0, 1)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium">{user.displayName}</span>
                  <span className="block truncate text-[11px] text-subtle">
                    {roleLabels[user.role]}
                  </span>
                </span>
              </button>
            </MenuTrigger>
            <MenuContent side="top" align="start">
              <MenuLabel>
                {user.username} · {user.memberNo}
              </MenuLabel>
              <MenuItem onSelect={go({ name: 'settings', section: 'account' })}>
                <UserRound className="size-3.5" /> 账号与资料
              </MenuItem>
              <MenuSeparator />
              <MenuLabel>切换账号</MenuLabel>
              {others.map((a) => (
                <MenuItem key={a.username} onSelect={() => void switchTo(a.username)}>
                  <span className="flex size-5 items-center justify-center rounded-full bg-surface-2 text-[10px] font-semibold">
                    {a.displayName.slice(0, 1)}
                  </span>
                  <span className="flex-1">{a.displayName}</span>
                  <span className="text-[11px] text-subtle">
                    {roleLabels[a.role]}
                    {a.rememberPassword ? '' : ' · 需输入密码'}
                  </span>
                </MenuItem>
              ))}
              <MenuItem onSelect={() => openPrompt('login')}>
                <UserPlus className="size-3.5" /> 登录其他账号…
              </MenuItem>
              <MenuSeparator />
              <MenuItem
                onSelect={() => {
                  void signOut();
                  navigate({ name: 'home' });
                }}
              >
                <LogOut className="size-3.5" /> 退出登录
              </MenuItem>
            </MenuContent>
          </Menu>
        ) : (
          <NavItem
            icon={<LogIn className="size-4" />}
            label="登录 / 注册"
            onClick={() => openPrompt('login')}
          />
        )}
      </div>
    </aside>
  );
}
