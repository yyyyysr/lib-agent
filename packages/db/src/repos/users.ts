import { newId, nowIso, type Profile, type Role, type UserInfo } from '@yys/shared';
import type { AppDatabase } from '../database';

interface UserRow {
  id: string;
  username: string;
  password_hash: string;
  display_name: string;
  member_no: string;
  department: string;
  role: Role;
  status: 'active' | 'disabled';
  builtin: number;
  must_change_password: number;
  created_at: string;
  last_login_at: string | null;
}

const toInfo = (row: UserRow): UserInfo => ({
  id: row.id,
  username: row.username,
  displayName: row.display_name,
  memberNo: row.member_no,
  department: row.department,
  role: row.role,
  status: row.status,
  builtin: row.builtin === 1,
  mustChangePassword: row.must_change_password === 1,
  createdAt: row.created_at,
  lastLoginAt: row.last_login_at ?? undefined,
});

export class UserRepo {
  constructor(private readonly db: AppDatabase) {}

  count(): number {
    return Number(this.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM users')?.n ?? 0);
  }

  countByRole(): Record<Role, number> {
    const counts: Record<Role, number> = { user: 0, approver: 0, superadmin: 0 };
    for (const row of this.db.all<{ role: Role; n: number }>(
      "SELECT role, COUNT(*) AS n FROM users WHERE status = 'active' GROUP BY role",
    )) {
      counts[row.role] = Number(row.n);
    }
    return counts;
  }

  create(
    input: Profile & {
      username: string;
      passwordHash: string;
      role: Role;
      builtin?: boolean;
      mustChangePassword?: boolean;
    },
  ): UserInfo {
    const id = newId('user');
    this.db.run(
      `INSERT INTO users(id, username, password_hash, display_name, member_no, department, role, status, builtin, must_change_password, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)`,
      id,
      input.username,
      input.passwordHash,
      input.displayName,
      input.memberNo,
      input.department,
      input.role,
      input.builtin ? 1 : 0,
      input.mustChangePassword ? 1 : 0,
      nowIso(),
    );
    return this.get(id)!;
  }

  get(id: string): UserInfo | undefined {
    const row = this.db.get<UserRow>('SELECT * FROM users WHERE id = ?', id);
    return row ? toInfo(row) : undefined;
  }

  /** 登录用：同时返回密码哈希 */
  findForLogin(username: string): (UserInfo & { passwordHash: string }) | undefined {
    const row = this.db.get<UserRow>('SELECT * FROM users WHERE username = ?', username);
    return row ? { ...toInfo(row), passwordHash: row.password_hash } : undefined;
  }

  passwordHash(id: string): string | undefined {
    return this.db.get<{ password_hash: string }>(
      'SELECT password_hash FROM users WHERE id = ?',
      id,
    )?.password_hash;
  }

  list(): UserInfo[] {
    return this.db.all<UserRow>('SELECT * FROM users ORDER BY created_at').map(toInfo);
  }

  /** 按 id 批量取姓名，用于列表展示 */
  names(ids: string[]): Map<string, { name: string; department: string }> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return new Map();
    const rows = this.db.all<UserRow>(
      `SELECT * FROM users WHERE id IN (${unique.map(() => '?').join(',')})`,
      ...unique,
    );
    return new Map(
      rows.map((row) => [row.id, { name: row.display_name, department: row.department }]),
    );
  }

  updateProfile(id: string, profile: Profile): UserInfo | undefined {
    this.db.run(
      'UPDATE users SET display_name = ?, member_no = ?, department = ? WHERE id = ?',
      profile.displayName,
      profile.memberNo,
      profile.department,
      id,
    );
    return this.get(id);
  }

  updateAccess(
    id: string,
    patch: { role?: Role; status?: 'active' | 'disabled' },
  ): UserInfo | undefined {
    if (patch.role) this.db.run('UPDATE users SET role = ? WHERE id = ?', patch.role, id);
    if (patch.status) this.db.run('UPDATE users SET status = ? WHERE id = ?', patch.status, id);
    return this.get(id);
  }

  /** mustChange：管理员重置的密码需要用户自己再改一次 */
  setPassword(id: string, passwordHash: string, mustChange = false): void {
    this.db.run(
      'UPDATE users SET password_hash = ?, must_change_password = ? WHERE id = ?',
      passwordHash,
      mustChange ? 1 : 0,
      id,
    );
  }

  touchLogin(id: string): void {
    this.db.run('UPDATE users SET last_login_at = ? WHERE id = ?', nowIso(), id);
  }
}

export class SessionRepo {
  constructor(private readonly db: AppDatabase) {}

  create(tokenHash: string, userId: string, ttlMs: number): void {
    const now = Date.now();
    this.db.run(
      'INSERT INTO sessions(token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)',
      tokenHash,
      userId,
      new Date(now).toISOString(),
      new Date(now + ttlMs).toISOString(),
    );
  }

  /** 返回仍在有效期内的会话所属用户 id */
  userIdFor(tokenHash: string): string | undefined {
    return this.db.get<{ user_id: string }>(
      'SELECT user_id FROM sessions WHERE token_hash = ? AND expires_at > ?',
      tokenHash,
      nowIso(),
    )?.user_id;
  }

  delete(tokenHash: string): void {
    this.db.run('DELETE FROM sessions WHERE token_hash = ?', tokenHash);
  }

  deleteForUser(userId: string): void {
    this.db.run('DELETE FROM sessions WHERE user_id = ?', userId);
  }

  purgeExpired(): void {
    this.db.run('DELETE FROM sessions WHERE expires_at <= ?', nowIso());
  }
}
