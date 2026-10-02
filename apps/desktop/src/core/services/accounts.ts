import { AppError } from '@yys/shared';
import type { RpcHandlers } from '../rpc-server';
import type { CoreDeps } from './context';

export function createAccountServices(deps: CoreDeps) {
  const { repos, auth } = deps;

  const handlers: Pick<
    RpcHandlers,
    | 'app.info'
    | 'auth.status'
    | 'auth.register'
    | 'auth.login'
    | 'auth.loginRemembered'
    | 'auth.me'
    | 'auth.logout'
    | 'auth.updateProfile'
    | 'auth.changePassword'
    | 'users.list'
    | 'users.update'
    | 'users.resetPassword'
    | 'admin.stats'
  > = {
    'app.info': () => ({ ...deps.info, sqliteVersion: repos.db.sqliteVersion }),

    'auth.status': () => auth.status(),
    'auth.register': async (input) => {
      const result = await auth.register(input);
      deps.emit('users.changed', {});
      return result;
    },
    'auth.login': ({ username, password }) => auth.login(username, password),
    'auth.loginRemembered': ({ username }) => auth.loginRemembered(username),
    'auth.me': (_p, { user }) => user,
    'auth.logout': (_p, { token }) => auth.logout(token),
    'auth.updateProfile': (profile, { user }) => {
      const updated = repos.users.updateProfile(user.id, profile)!;
      deps.emit('users.changed', {});
      return updated;
    },
    'auth.changePassword': ({ oldPassword, newPassword }, { user }) =>
      auth.changePassword(user, oldPassword, newPassword),

    'users.list': () => repos.users.list(),
    'users.update': ({ id, role, status }, { user }) => {
      const target = repos.users.get(id);
      if (!target) throw new AppError('not_found', '用户不存在');
      if (target.builtin && ((role && role !== 'superadmin') || status === 'disabled')) {
        throw new AppError('invalid_state', '内置超级管理员不能降级或停用');
      }
      const losesAdmin =
        target.role === 'superadmin' && ((role && role !== 'superadmin') || status === 'disabled');
      if (losesAdmin && repos.users.countByRole().superadmin <= 1) {
        throw new AppError('invalid_state', '至少需要保留一名启用中的超级管理员');
      }
      if (id === user.id && status === 'disabled')
        throw new AppError('invalid_state', '不能停用自己的账号');
      const updated = repos.users.updateAccess(id, { role, status })!;
      if (status === 'disabled') repos.sessions.deleteForUser(id);
      deps.emit('users.changed', {});
      return updated;
    },
    'users.resetPassword': async ({ id, password }) => {
      if (!repos.users.get(id)) throw new AppError('not_found', '用户不存在');
      await auth.resetPassword(id, password);
    },
    'admin.stats': () => ({
      users: repos.users.countByRole(),
      exhibitions: repos.exhibitions.countByStatus(),
      books: repos.books.totalBooks(),
      sources: repos.books.listSources().length,
      pendingApprovals: repos.approvals.pendingCount(),
    }),
  };

  return { handlers };
}
