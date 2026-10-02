import { useEffect } from 'react';
import { Toaster } from '../components/Toaster';
import { TooltipProvider } from '../components/ui';
import { ChatView } from '../features/chat/ChatView';
import { HomeView } from '../features/chat/HomeView';
import { LibraryView } from '../features/library/LibraryView';
import { SettingsView } from '../features/settings/SettingsView';
import { core } from '../lib/core-client';
import { isModKey } from '../lib/platform';
import { useAppStore } from '../store/app-store';
import { CoreStatusBanner } from './CoreStatusBanner';
import { Sidebar } from './Sidebar';

function useGlobalShortcuts(): void {
  const { navigate, toggleSidebar } = useAppStore();
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (!isModKey(event) || event.altKey) return;
      const key = event.key.toLowerCase();
      if (key === 'n' && !event.shiftKey) {
        event.preventDefault();
        navigate({ name: 'home' });
      } else if (key === 'b') {
        event.preventDefault();
        toggleSidebar();
      } else if (key === ',') {
        event.preventDefault();
        navigate({ name: 'settings', section: 'models' });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navigate, toggleSidebar]);
}

export function App() {
  const { view, sidebarOpen, setCoreStatus } = useAppStore();

  useEffect(() => {
    const off = window.yys.onCoreStatus(setCoreStatus);
    core.start();
    return off;
  }, [setCoreStatus]);

  useGlobalShortcuts();

  return (
    <TooltipProvider delayDuration={400}>
      <div className="flex h-full">
        {sidebarOpen && <Sidebar />}
        <main className="flex min-w-0 flex-1 flex-col bg-bg">
          <CoreStatusBanner />
          {view.name === 'home' && <HomeView />}
          {view.name === 'chat' && <ChatView key={view.id} conversationId={view.id} pendingText={view.pendingText} />}
          {view.name === 'library' && <LibraryView />}
          {view.name === 'settings' && <SettingsView section={view.section} />}
        </main>
      </div>
      <Toaster />
    </TooltipProvider>
  );
}
