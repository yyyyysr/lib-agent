import { create } from 'zustand';
import type { CoreStatus } from '@yys/shared';

export type SettingsSection = 'models' | 'school' | 'appearance' | 'data' | 'about';

export type View =
  | { name: 'home' }
  | { name: 'chat'; id: string; pendingText?: string }
  | { name: 'library'; sourceId?: string }
  | { name: 'settings'; section: SettingsSection };

interface AppState {
  view: View;
  sidebarOpen: boolean;
  panelOpen: boolean;
  coreStatus: CoreStatus;
  navigate: (view: View) => void;
  toggleSidebar: () => void;
  togglePanel: () => void;
  setCoreStatus: (status: CoreStatus) => void;
}

export const useAppStore = create<AppState>((set) => ({
  view: { name: 'home' },
  sidebarOpen: true,
  panelOpen: true,
  coreStatus: { state: 'starting' },
  navigate: (view) => set({ view }),
  toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
  togglePanel: () => set((state) => ({ panelOpen: !state.panelOpen })),
  setCoreStatus: (coreStatus) => set({ coreStatus }),
}));

export interface Toast {
  id: number;
  tone: 'info' | 'success' | 'error';
  title: string;
  description?: string;
}

interface ToastState {
  toasts: Toast[];
  push: (toast: Omit<Toast, 'id'>) => void;
  dismiss: (id: number) => void;
}

let toastSeq = 0;
export const useToasts = create<ToastState>((set, get) => ({
  toasts: [],
  push: (toast) => {
    const id = ++toastSeq;
    set((state) => ({ toasts: [...state.toasts.slice(-3), { ...toast, id }] }));
    setTimeout(() => get().dismiss(id), toast.tone === 'error' ? 8000 : 4000);
  },
  dismiss: (id) => set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),
}));

export const toast = (toast: Omit<Toast, 'id'>): void => useToasts.getState().push(toast);
