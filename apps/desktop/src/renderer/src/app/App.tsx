import { useEffect } from 'react';
import { LockKeyhole } from 'lucide-react';
import { Toaster } from '../components/Toaster';
import { Button, EmptyState, Spinner, TooltipProvider } from '../components/ui';
import { AdminView } from '../features/admin/AdminView';
import { ApprovalsView } from '../features/approvals/ApprovalsView';
import { AuthDialog } from '../features/auth/AuthDialog';
import { CurationListView } from '../features/curation/CurationListView';
import { ExhibitionView } from '../features/curation/ExhibitionView';
import { LibraryView } from '../features/library/LibraryView';
import { SettingsView } from '../features/settings/SettingsView';
import { HomeView, ShowcasePage } from '../features/showcase/HomeView';
import { core } from '../lib/core-client';
import { isModKey } from '../lib/platform';
import { requiresLogin, useAppStore, type View } from '../store/app-store';
import { useAuth } from '../store/auth-store';
import { CoreStatusBanner } from './CoreStatusBanner';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';

function useGlobalShortcuts(): void {
  const { navigate, toggleSidebar } = useAppStore();
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (!isModKey(event) || event.altKey) return;
      const key = event.key.toLowerCase();
      if (key === 'b') {
        event.preventDefault();
        toggleSidebar();
      } else if (key === ',') {
        event.preventDefault();
        navigate({ name: 'settings', section: 'account' });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navigate, toggleSidebar]);
}

function LoginRequired() {
  const openPrompt = useAuth((s) => s.openPrompt);
  return (
    <div className="flex flex-1 flex-col">
      <TopBar />
      <EmptyState
        icon={<LockKeyhole className="size-8" />}
        title="登录后使用"
        description="策展、书库、审批与管理功能需要登录。首页的书展展示对所有人开放。"
        action={
          <div className="flex gap-2">
            <Button variant="primary" onClick={() => openPrompt('login')}>
              登录
            </Button>
            <Button variant="outline" onClick={() => openPrompt('register')}>
              注册账号
            </Button>
          </div>
        }
      />
    </div>
  );
}

function Page({ view }: { view: View }) {
  switch (view.name) {
    case 'home':
      return <HomeView />;
    case 'showcase':
      return <ShowcasePage id={view.id} />;
    case 'curation':
      return <CurationListView />;
    case 'exhibition':
      return <ExhibitionView key={view.id} id={view.id} initialStep={view.step} />;
    case 'approvals':
      return <ApprovalsView />;
    case 'library':
      return <LibraryView />;
    case 'admin':
      return <AdminView tab={view.tab} />;
    case 'settings':
      return <SettingsView section={view.section} />;
  }
}

export function App() {
  const { view, sidebarOpen, setCoreStatus } = useAppStore();
  const { status, user, restore } = useAuth();

  useEffect(() => {
    const off = window.yys.onCoreStatus(setCoreStatus);
    core.start();
    void restore();
    return off;
  }, [setCoreStatus, restore]);

  useGlobalShortcuts();

  return (
    <TooltipProvider delayDuration={400}>
      <div className="flex h-full">
        {sidebarOpen && <Sidebar />}
        <main className="flex min-w-0 flex-1 flex-col bg-bg">
          <CoreStatusBanner />
          {status === 'loading' ? (
            <div className="flex flex-1 items-center justify-center">
              <Spinner />
            </div>
          ) : requiresLogin(view) && !user ? (
            <LoginRequired />
          ) : (
            // 切换账号时整页重建，避免残留上一个账号的数据
            <Page key={user?.id ?? 'guest'} view={view} />
          )}
        </main>
      </div>
      <AuthDialog />
      <Toaster />
    </TooltipProvider>
  );
}
