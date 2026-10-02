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
  createdAt: string;
  lastLoginAt?: string;
}

export interface AuthResult {
  token: string;
  user: UserInfo;
}
