import {
  createHash,
  randomBytes,
  scrypt as scryptCb,
  timingSafeEqual,
  type ScryptOptions,
} from 'node:crypto';
import {
  AppError,
  hasRole,
  secretRefForAccount,
  type AccessLevel,
  type AuthResult,
  type AuthStatus,
  type Profile,
  type UserInfo,
} from '@yys/shared';
import type { Repositories } from '@yys/db';

const SESSION_TTL_MS = 30 * 86_400_000;
const MAX_FAILURES = 5;
const LOCK_MS = 60_000;
const SCRYPT = { N: 16_384, r: 8, p: 1, keylen: 64 };

const scrypt = (
  password: string,
  salt: Buffer,
  keylen: number,
  options: ScryptOptions,
): Promise<Buffer> =>
  new Promise((resolve, reject) =>
    scryptCb(password, salt, keylen, options, (error, key) =>
      error ? reject(error) : resolve(key),
    ),
  );

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, SCRYPT.keylen, {
    N: SCRYPT.N,
    r: SCRYPT.r,
    p: SCRYPT.p,
  });
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, n, r, p, salt, hash] = stored.split('$');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64');
  const key = await scrypt(password, Buffer.from(salt, 'base64'), expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
  });
  return key.length === expected.length && timingSafeEqual(key, expected);
}

const tokenHash = (token: string): string => createHash('sha256').update(token).digest('hex');

export interface AuthOptions {
  builtinAdmin: { username: string; password: string };
  /** 读取 / 删除“记住密码”保存在主进程保险箱中的密码 */
  secrets: { get(ref: string): Promise<string | null>; remove(ref: string): void };
}

export class AuthService {
  private readonly failures = new Map<string, { count: number; lockedUntil: number }>();

  constructor(
    private readonly repos: Repositories,
    private readonly options: AuthOptions,
  ) {}

  /** 启动时确保内置超级管理员存在；已存在时不改动其密码 */
  async ensureBuiltinAdmin(): Promise<UserInfo | null> {
    const { username, password } = this.options.builtinAdmin;
    const existing = this.repos.users.findForLogin(username);
    if (existing) return null;
    const passwordHash = await hashPassword(password);
    return this.repos.users.create({
      username,
      passwordHash,
      displayName: '超级管理员',
      memberNo: 'ADMIN',
      department: '',
      role: 'superadmin',
      builtin: true,
      mustChangePassword: true,
    });
  }

  status(): AuthStatus {
    const { username, password } = this.options.builtinAdmin;
    const admin = this.repos.users.findForLogin(username);
    return {
      builtinAdmin: {
        username,
        defaultPassword: admin?.mustChangePassword && admin.builtin ? password : undefined,
      },
    };
  }

  /** 注册一律为普通用户；审批与管理权限由超级管理员分配 */
  async register(input: Profile & { username: string; password: string }): Promise<AuthResult> {
    if (this.repos.users.findForLogin(input.username))
      throw new AppError('conflict', '用户名已被使用', '换一个用户名试试');
    const passwordHash = await hashPassword(input.password);
    return this.issue(this.repos.users.create({ ...input, passwordHash, role: 'user' }));
  }

  async login(username: string, password: string): Promise<AuthResult> {
    const key = username.toLowerCase();
    const failure = this.failures.get(key);
    if (failure && failure.lockedUntil > Date.now()) {
      const seconds = Math.ceil((failure.lockedUntil - Date.now()) / 1000);
      throw new AppError('forbidden', `密码错误次数过多，请 ${seconds} 秒后再试`);
    }
    const found = this.repos.users.findForLogin(username);
    const ok = found ? await verifyPassword(password, found.passwordHash) : false;
    if (!found || !ok) {
      const count = (failure?.count ?? 0) + 1;
      this.failures.set(key, {
        count,
        lockedUntil: count >= MAX_FAILURES ? Date.now() + LOCK_MS : 0,
      });
      throw new AppError('unauthorized', '用户名或密码错误');
    }
    if (found.status === 'disabled')
      throw new AppError('forbidden', '该账号已被停用', '请联系超级管理员');
    this.failures.delete(key);
    const { passwordHash: _omit, ...user } = found;
    return this.issue(user);
  }

  /**
   * 用本机保存的密码登录：密码只在主进程保险箱与 Core 之间传递，不回到界面。
   * 密码已被修改或重置时删除失效的记录，让用户重新输入。
   */
  async loginRemembered(username: string): Promise<AuthResult> {
    const ref = secretRefForAccount(username);
    const password = await this.options.secrets.get(ref);
    if (!password) throw new AppError('not_found', '本机没有保存这个账号的密码', '请输入密码登录');
    try {
      return await this.login(username, password);
    } catch (error) {
      if (error instanceof AppError && error.code === 'unauthorized') {
        this.options.secrets.remove(ref);
        throw new AppError(
          'unauthorized',
          '保存的密码已失效',
          '密码可能已被修改或重置，请重新输入',
        );
      }
      throw error;
    }
  }

  /** 每个请求都据令牌查用户：服务端无状态，Core 重启或将来迁移到服务器都不受影响 */
  authenticate(token: string | undefined): UserInfo | null {
    if (!token) return null;
    const userId = this.repos.sessions.userIdFor(tokenHash(token));
    const user = userId ? this.repos.users.get(userId) : undefined;
    return user && user.status === 'active' ? user : null;
  }

  logout(token: string | undefined): void {
    if (token) this.repos.sessions.delete(tokenHash(token));
  }

  async changePassword(
    user: UserInfo,
    oldPassword: string,
    newPassword: string,
  ): Promise<UserInfo> {
    const stored = this.repos.users.passwordHash(user.id);
    if (!stored || !(await verifyPassword(oldPassword, stored)))
      throw new AppError('unauthorized', '原密码不正确');
    if (oldPassword === newPassword) throw new AppError('invalid_params', '新密码不能与原密码相同');
    this.repos.users.setPassword(user.id, await hashPassword(newPassword));
    return this.repos.users.get(user.id)!;
  }

  /** 管理员重置：其他设备上的登录全部失效，该用户下次需自行修改密码 */
  async resetPassword(userId: string, password: string): Promise<void> {
    this.repos.users.setPassword(userId, await hashPassword(password), true);
    this.repos.sessions.deleteForUser(userId);
  }

  private issue(user: UserInfo): AuthResult {
    const token = randomBytes(32).toString('base64url');
    this.repos.sessions.create(tokenHash(token), user.id, SESSION_TTL_MS);
    this.repos.users.touchLogin(user.id);
    this.repos.sessions.purgeExpired();
    return { token, user: this.repos.users.get(user.id)! };
  }
}

export function checkAccess(level: AccessLevel, user: UserInfo | null): void {
  if (level === 'public') return;
  if (!user) throw new AppError('unauthorized', '请先登录');
  if (!hasRole(user.role, level)) throw new AppError('forbidden', '当前账号没有权限执行此操作');
}
