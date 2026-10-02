import { create } from 'zustand';
import { hasRole, type AuthResult, type Role, type UserInfo } from '@yys/shared';
import { core } from '../lib/core-client';
import { useAgentRuns } from './agent-runs';
import { useToasts } from './app-store';

const TOKEN_KEY = 'yys-session';

/** 切换账号时停止并清除上一个账号的智能体运行记录与提示 */
const resetRuns = (): void => {
  for (const run of Object.values(useAgentRuns.getState().runs)) run.controller.abort();
  useAgentRuns.setState({ runs: {} });
  useToasts.setState({ toasts: [] });
};

interface AuthState {
  /** loading：正在用本地保存的令牌恢复会话 */
  status: 'loading' | 'ready';
  user: UserInfo | null;
  /** 登录弹窗：需要登录才能进入的页面会打开它 */
  prompt: { open: boolean; mode: 'login' | 'register' };
  restore: () => Promise<void>;
  signIn: (result: AuthResult) => void;
  signOut: () => Promise<void>;
  setUser: (user: UserInfo) => void;
  openPrompt: (mode?: 'login' | 'register') => void;
  closePrompt: () => void;
}

export const useAuth = create<AuthState>((set, get) => ({
  status: 'loading',
  user: null,
  prompt: { open: false, mode: 'login' },
  restore: async () => {
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) return set({ status: 'ready' });
    core.setToken(token);
    try {
      const user = await core.call('auth.me');
      if (!user) {
        localStorage.removeItem(TOKEN_KEY);
        core.setToken(null);
      }
      set({ user, status: 'ready' });
    } catch {
      set({ status: 'ready' });
    }
  },
  signIn: ({ token, user }) => {
    resetRuns();
    localStorage.setItem(TOKEN_KEY, token);
    core.setToken(token);
    set({ user, prompt: { ...get().prompt, open: false } });
  },
  signOut: async () => {
    resetRuns();
    await core.call('auth.logout').catch(() => undefined);
    localStorage.removeItem(TOKEN_KEY);
    core.setToken(null);
    set({ user: null });
  },
  setUser: (user) => set({ user }),
  openPrompt: (mode = 'login') => set({ prompt: { open: true, mode } }),
  closePrompt: () => set({ prompt: { ...get().prompt, open: false } }),
}));

/** 会话在服务端失效时（过期或账号被停用）清除本地登录状态 */
core.handleUnauthorized(() => {
  localStorage.removeItem(TOKEN_KEY);
  core.setToken(null);
  useAuth.setState({ user: null });
});

export const useRole = (required: Role): boolean => {
  const user = useAuth((s) => s.user);
  return Boolean(user && hasRole(user.role, required));
};
