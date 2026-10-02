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
  type AccessLevel,
  type AuthResult,
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

export class AuthService {
  private readonly failures = new Map<string, { count: number; lockedUntil: number }>();

  constructor(private readonly repos: Repositories) {}

  needsSetup(): boolean {
    return this.repos.users.count() === 0;
  }

  /** 首个注册的账号自动成为超级管理员，之后注册的都是普通用户 */
  async register(input: Profile & { username: string; password: string }): Promise<AuthResult> {
    if (this.repos.users.findForLogin(input.username))
      throw new AppError('conflict', '用户名已被使用', '换一个用户名试试');
    const passwordHash = await hashPassword(input.password);
    const user = this.repos.db.transaction(() =>
      this.repos.users.create({
        ...input,
        passwordHash,
        role: this.needsSetup() ? 'superadmin' : 'user',
      }),
    );
    return this.issue(user);
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

  async changePassword(user: UserInfo, oldPassword: string, newPassword: string): Promise<void> {
    const stored = this.repos.users.passwordHash(user.id);
    if (!stored || !(await verifyPassword(oldPassword, stored)))
      throw new AppError('unauthorized', '原密码不正确');
    this.repos.users.setPassword(user.id, await hashPassword(newPassword));
  }

  async resetPassword(userId: string, password: string): Promise<void> {
    this.repos.users.setPassword(userId, await hashPassword(password));
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
