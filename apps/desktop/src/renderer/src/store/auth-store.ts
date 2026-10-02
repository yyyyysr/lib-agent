import { create } from 'zustand';
import {
  hasRole,
  secretRefForAccount,
  type AuthResult,
  type Role,
  type UserInfo,
} from '@yys/shared';
import { core, errorText } from '../lib/core-client';
import { useAgentRuns } from './agent-runs';
import { toast, useToasts } from './app-store';

const TOKEN_KEY = 'yys-session';
const ACCOUNTS_KEY = 'yys-accounts';

/** 本机登录过的账号；只保存用于展示的信息，密码（若记住）加密保存在主进程保险箱 */
export interface SavedAccount {
  username: string;
  displayName: string;
  role: Role;
  rememberPassword: boolean;
  lastUsedAt: string;
}

const loadAccounts = (): SavedAccount[] => {
  try {
    const parsed = JSON.parse(localStorage.getItem(ACCOUNTS_KEY) ?? '[]') as SavedAccount[];
    return Array.isArray(parsed) ? parsed.filter((a) => typeof a?.username === 'string') : [];
  } catch {
    return [];
  }
};

const persistAccounts = (accounts: SavedAccount[]): SavedAccount[] => {
  const sorted = [...accounts]
    .sort((a, b) => b.lastUsedAt.localeCompare(a.lastUsedAt))
    .slice(0, 12);
  localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(sorted));
  return sorted;
};

const sameUser = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();

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
  accounts: SavedAccount[];
  /** 登录弹窗；username 用于切换到未记住密码的账号时预填 */
  prompt: { open: boolean; mode: 'login' | 'register'; username?: string };
  restore: () => Promise<void>;
  /** remember 为 undefined 时保持该账号原有的“记住密码”设置 */
  signIn: (
    result: AuthResult,
    options?: { password?: string; remember?: boolean },
  ) => Promise<void>;
  signOut: () => Promise<void>;
  /** 用本机保存的密码登录；没有保存或已失效时打开登录框 */
  quickLogin: (username: string) => Promise<boolean>;
  switchTo: (username: string) => Promise<void>;
  forgetAccount: (username: string) => Promise<void>;
  /** 修改密码后同步更新已记住的密码 */
  passwordChanged: (user: UserInfo, newPassword: string) => Promise<void>;
  setUser: (user: UserInfo) => void;
  openPrompt: (mode?: 'login' | 'register', username?: string) => void;
  closePrompt: () => void;
}

export const useAuth = create<AuthState>((set, get) => {
  const upsertAccount = (user: UserInfo, rememberPassword?: boolean): void => {
    const existing = get().accounts.find((a) => sameUser(a.username, user.username));
    const entry: SavedAccount = {
      username: user.username,
      displayName: user.displayName,
      role: user.role,
      rememberPassword: rememberPassword ?? existing?.rememberPassword ?? false,
      lastUsedAt: new Date().toISOString(),
    };
    set({
      accounts: persistAccounts([
        entry,
        ...get().accounts.filter((a) => !sameUser(a.username, user.username)),
      ]),
    });
  };

  const setRemembered = (username: string, rememberPassword: boolean): void =>
    set({
      accounts: persistAccounts(
        get().accounts.map((a) =>
          sameUser(a.username, username) ? { ...a, rememberPassword } : a,
        ),
      ),
    });

  return {
    status: 'loading',
    user: null,
    accounts: loadAccounts(),
    prompt: { open: false, mode: 'login' },

    restore: async () => {
      const token = localStorage.getItem(TOKEN_KEY);
      if (!token) return set({ status: 'ready' });
      core.setToken(token);
      try {
        const user = await core.call('auth.me');
        if (user) upsertAccount(user);
        else {
          localStorage.removeItem(TOKEN_KEY);
          core.setToken(null);
        }
        set({ user, status: 'ready' });
      } catch {
        set({ status: 'ready' });
      }
    },

    signIn: async ({ token, user }, options = {}) => {
      resetRuns();
      // 先注销上一个会话，再启用新令牌
      if (get().user) await core.call('auth.logout').catch(() => undefined);
      localStorage.setItem(TOKEN_KEY, token);
      core.setToken(token);
      const ref = secretRefForAccount(user.username);
      if (options.remember === true && options.password)
        await window.yys.secrets.set(ref, options.password);
      if (options.remember === false) await window.yys.secrets.remove(ref);
      upsertAccount(user, options.remember);
      set({ user, prompt: { ...get().prompt, open: false, username: undefined } });
    },

    signOut: async () => {
      resetRuns();
      await core.call('auth.logout').catch(() => undefined);
      localStorage.removeItem(TOKEN_KEY);
      core.setToken(null);
      set({ user: null });
    },

    quickLogin: async (username) => {
      const account = get().accounts.find((a) => sameUser(a.username, username));
      if (!account?.rememberPassword) {
        get().openPrompt('login', username);
        return false;
      }
      try {
        const result = await core.call('auth.loginRemembered', { username });
        await get().signIn(result);
        toast({ tone: 'success', title: `已切换到 ${result.user.displayName}` });
        return true;
      } catch (error) {
        const { message, hint } = errorText(error);
        setRemembered(username, false);
        toast({ tone: 'error', title: message, description: hint });
        get().openPrompt('login', username);
        return false;
      }
    },

    switchTo: async (username) => {
      const current = get().user;
      if (current && sameUser(current.username, username)) return;
      await get().quickLogin(username);
    },

    forgetAccount: async (username) => {
      await window.yys.secrets.remove(secretRefForAccount(username));
      set({
        accounts: persistAccounts(get().accounts.filter((a) => !sameUser(a.username, username))),
      });
    },

    passwordChanged: async (user, newPassword) => {
      const account = get().accounts.find((a) => sameUser(a.username, user.username));
      if (account?.rememberPassword)
        await window.yys.secrets.set(secretRefForAccount(user.username), newPassword);
      set({ user });
      upsertAccount(user);
    },

    setUser: (user) => {
      set({ user });
      upsertAccount(user);
    },
    openPrompt: (mode = 'login', username) => set({ prompt: { open: true, mode, username } }),
    closePrompt: () => set({ prompt: { ...get().prompt, open: false, username: undefined } }),
  };
});

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
