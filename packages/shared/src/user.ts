import { z } from 'zod';

/**
 * user：普通用户，浏览书展、发起策展
 * approver：管理员（上级审批），审核策展申请与上线申请
 * superadmin：超级管理员，管理用户权限与全局数据
 */
export const roleSchema = z.enum(['user', 'approver', 'superadmin']);
export type Role = z.infer<typeof roleSchema>;

export const roleLabels: Record<Role, string> = {
  user: '普通用户',
  approver: '审批管理员',
  superadmin: '超级管理员',
};

const roleRank: Record<Role, number> = { user: 0, approver: 1, superadmin: 2 };
export const hasRole = (role: Role, required: Role): boolean =>
  roleRank[role] >= roleRank[required];

export const usernameSchema = z
  .string()
  .trim()
  .min(3, '用户名至少 3 个字符')
  .max(32, '用户名最多 32 个字符')
  .regex(/^[A-Za-z0-9_.-]+$/, '用户名只能包含字母、数字、下划线、点和短横线');

export const passwordSchema = z.string().min(8, '密码至少 8 位').max(128, '密码过长');

export const profileSchema = z.object({
  displayName: z.string().trim().min(1, '请填写姓名').max(40),
  /** 学号或工号，写入策展申请书 */
  memberNo: z.string().trim().min(1, '请填写学号或工号').max(32),
  department: z.string().trim().max(60).default(''),
});
export type Profile = z.infer<typeof profileSchema>;

export const registerInputSchema = profileSchema.extend({
  username: usernameSchema,
  password: passwordSchema,
});
export type RegisterInput = z.input<typeof registerInputSchema>;

export const loginInputSchema = z.object({
  username: z.string().trim().min(1, '请输入用户名'),
  password: z.string().min(1, '请输入密码'),
});

export interface UserInfo extends Profile {
  id: string;
  username: string;
  role: Role;
  status: 'active' | 'disabled';
  /** 内置超级管理员：初始化时创建，不能降级或停用 */
  builtin: boolean;
  /** 仍在使用初始密码或被管理员重置过的密码 */
  mustChangePassword: boolean;
  createdAt: string;
  lastLoginAt?: string;
}

/** 内置超级管理员的默认账号；可用环境变量 YYS_ADMIN_USERNAME / YYS_ADMIN_PASSWORD 覆盖 */
export const BUILTIN_ADMIN = { username: 'super_user', password: '12345678' } as const;

export interface AuthStatus {
  builtinAdmin: {
    username: string;
    /** 仍为初始密码时才返回，用于登录框提示 */
    defaultPassword?: string;
  };
}

/** 本机“记住密码”的账号在密钥保险箱中的引用 */
export const secretRefForAccount = (username: string): string =>
  `account:${username.toLowerCase()}`;

export interface AuthResult {
  token: string;
  user: UserInfo;
}
