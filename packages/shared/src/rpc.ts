import { z } from 'zod';
import {
  bookQuerySchema,
  type BookFieldKey,
  type BookRecord,
  type BookSourceInfo,
  type Page,
} from './book';
import type { AppErrorShape } from './errors';
import {
  approvalKindSchema,
  artStyles,
  briefSchema,
  checkItemSchema,
  executionSchema,
  packageSchema,
  planSchema,
  proposalSchema,
  retrospectiveSchema,
  type AgentProgress,
  type ApprovalRecord,
  type ExhibitionDetail,
  type ExhibitionStatus,
  type ExhibitionSummary,
  type ShowcaseExhibition,
} from './exhibition';
import {
  imageModelRefSchema,
  modelRolesSchema,
  providerInputSchema,
  type ConnectionTestResult,
  type ImageTestResult,
  type ModelInfo,
  type ModelRoles,
  type ProviderConfig,
  type ProviderPreset,
} from './provider';
import {
  schoolProfileSchema,
  type CampusConnectionStatus,
  type SchoolBranding,
  type SchoolProfile,
} from './school';
import {
  loginInputSchema,
  passwordSchema,
  profileSchema,
  registerInputSchema,
  roleSchema,
  type AuthResult,
  type AuthStatus,
  type Role,
  type UserInfo,
} from './user';

export const importFormatSchema = z.enum(['csv', 'tsv', 'txt', 'xlsx', 'json']);
export type ImportFormat = z.infer<typeof importFormatSchema>;
export interface ImportIssue {
  /** 数据行号（从 1 开始，不含表头） */
  row: number;
  message: string;
}

export interface ImportReport {
  sourceId: string;
  sourceName: string;
  format: ImportFormat;
  totalRows: number;
  imported: number;
  skipped: number;
  duplicates: number;
  mapping: Partial<Record<BookFieldKey, string>>;
  unmappedHeaders: string[];
  issues: ImportIssue[];
}

export interface AppInfo {
  version: string;
  dataDir: string;
  platform: string;
  nodeVersion: string;
  sqliteVersion: string;
  coreStartedAt: string;
}

export interface AdminStats {
  users: Record<Role, number>;
  exhibitions: Partial<Record<ExhibitionStatus, number>>;
  books: number;
  sources: number;
  pendingApprovals: number;
}

const id = z.object({ id: z.string().min(1) });

/** 请求-响应方法：参数 schema 在 Core 入口做运行时校验 */
export const rpcParamSchemas = {
  'app.info': z.void(),

  'auth.status': z.void(),
  'auth.register': registerInputSchema,
  'auth.login': loginInputSchema,
  'auth.loginRemembered': z.object({ username: z.string().trim().min(1) }),
  'auth.me': z.void(),
  'auth.logout': z.void(),
  'auth.updateProfile': profileSchema,
  'auth.changePassword': z.object({ oldPassword: z.string().min(1), newPassword: passwordSchema }),

  'showcase.latest': z.void(),
  'showcase.list': z.void(),
  'showcase.get': id,

  'exhibitions.list': z.object({ scope: z.enum(['mine', 'all']).default('mine') }),
  'exhibitions.create': briefSchema,
  'exhibitions.get': id,
  'exhibitions.updateBrief': z.object({ id: z.string(), brief: briefSchema }),
  'exhibitions.updatePlan': z.object({ id: z.string(), plan: planSchema }),
  'exhibitions.updateProposal': z.object({ id: z.string(), proposal: proposalSchema }),
  'exhibitions.updatePackage': z.object({ id: z.string(), package: packageSchema }),
  'exhibitions.updateExecution': z.object({ id: z.string(), execution: executionSchema }),
  'exhibitions.updateRetrospective': z.object({
    id: z.string(),
    retrospective: retrospectiveSchema,
  }),
  'exhibitions.submit': z.object({ id: z.string(), kind: approvalKindSchema }),
  'exhibitions.delete': id,
  'exhibitions.unpublish': z.object({
    id: z.string(),
    comment: z.string().trim().min(1, '请说明下线原因'),
  }),

  'checks.run': id,
  'checks.update': z.object({
    id: z.string(),
    itemId: z.string(),
    status: checkItemSchema.shape.status,
    note: z.string().max(500).default(''),
  }),

  'plan.replaceBook': z.object({ id: z.string(), oldBookId: z.string(), newBookId: z.string() }),
  'plan.regenerateGuide': z.object({
    id: z.string(),
    bookId: z.string(),
    instruction: z.string().max(300).default(''),
  }),
  'poster.generateArt': z.object({
    id: z.string(),
    style: z.enum(artStyles),
    instruction: z.string().trim().max(300).default(''),
  }),
  'plan.rewrite': z.object({
    id: z.string(),
    target: z.enum(['introduction', 'statement', 'activity', 'section']),
    sectionId: z.string().optional(),
    instruction: z.string().trim().min(1, '请写明修改要求').max(300),
  }),

  'feedback.add': z.object({
    id: z.string(),
    entries: z
      .array(
        z.object({
          rating: z.number().int().min(1).max(5).nullable(),
          content: z.string().trim().min(1).max(1000),
        }),
      )
      .min(1)
      .max(500),
  }),
  'feedback.delete': z.object({ id: z.string(), entryId: z.string() }),

  'approvals.list': z.object({ status: z.enum(['pending', 'done']).default('pending') }),
  'approvals.decide': z.object({
    approvalId: z.string(),
    decision: z.enum(['approve', 'changes']),
    comment: z.string().trim().max(1000).default(''),
  }),

  'users.list': z.void(),
  'users.update': z.object({
    id: z.string(),
    role: roleSchema.optional(),
    status: z.enum(['active', 'disabled']).optional(),
  }),
  'users.resetPassword': z.object({ id: z.string(), password: passwordSchema }),
  'admin.stats': z.void(),

  'providers.presets': z.void(),
  'providers.list': z.void(),
  'providers.save': providerInputSchema,
  'providers.delete': id,
  'providers.setKey': z.object({
    providerId: z.string(),
    apiKey: z.string().trim().min(1).max(4096),
  }),
  'providers.listRemoteModels': z.object({ providerId: z.string() }),
  'providers.test': z.object({ providerId: z.string(), modelId: z.string() }),
  'providers.testImage': imageModelRefSchema,

  'settings.getModelRoles': z.void(),
  'settings.setModelRoles': modelRolesSchema,
  'settings.getSchool': z.void(),
  'settings.setSchool': schoolProfileSchema.nullable(),

  'campus.status': z.void(),
  'school.branding': z.void(),

  'books.sources': z.void(),
  'books.search': bookQuerySchema,
  /** 文件内容由客户端读取后以 base64 传入，后台服务（本机或服务器）不读取客户端的文件系统 */
  'books.importFile': z.object({
    fileName: z.string().min(1).max(255),
    data: z.string().min(1).max(28_000_000),
    sourceName: z.string().optional(),
  }),
  'books.importText': z.object({
    text: z.string().min(1),
    format: importFormatSchema.exclude(['xlsx']),
    sourceName: z.string().min(1),
  }),
  'books.deleteSource': id,
} as const;

export interface RpcResults {
  'app.info': AppInfo;
  'auth.status': AuthStatus;
  'auth.register': AuthResult;
  'auth.login': AuthResult;
  'auth.loginRemembered': AuthResult;
  'auth.me': UserInfo | null;
  'auth.logout': void;
  'auth.updateProfile': UserInfo;
  'auth.changePassword': UserInfo;
  'showcase.latest': ShowcaseExhibition | null;
  'showcase.list': ExhibitionSummary[];
  'showcase.get': ShowcaseExhibition;
  'exhibitions.list': ExhibitionSummary[];
  'exhibitions.create': ExhibitionDetail;
  'exhibitions.get': ExhibitionDetail;
  'exhibitions.updateBrief': ExhibitionDetail;
  'exhibitions.updatePlan': ExhibitionDetail;
  'exhibitions.updateProposal': ExhibitionDetail;
  'exhibitions.updatePackage': ExhibitionDetail;
  'exhibitions.updateExecution': ExhibitionDetail;
  'exhibitions.updateRetrospective': ExhibitionDetail;
  'exhibitions.submit': ExhibitionDetail;
  'exhibitions.delete': void;
  'exhibitions.unpublish': ExhibitionDetail;
  'checks.run': ExhibitionDetail;
  'checks.update': ExhibitionDetail;
  'plan.replaceBook': ExhibitionDetail;
  'plan.regenerateGuide': ExhibitionDetail;
  'plan.rewrite': ExhibitionDetail;
  'poster.generateArt': ExhibitionDetail;
  'feedback.add': ExhibitionDetail;
  'feedback.delete': ExhibitionDetail;
  'approvals.list': ApprovalRecord[];
  'approvals.decide': ApprovalRecord;
  'users.list': UserInfo[];
  'users.update': UserInfo;
  'users.resetPassword': void;
  'admin.stats': AdminStats;
  'providers.presets': ProviderPreset[];
  'providers.list': ProviderConfig[];
  'providers.save': ProviderConfig;
  'providers.delete': void;
  'providers.setKey': ProviderConfig;
  'providers.listRemoteModels': ModelInfo[];
  'providers.test': ConnectionTestResult;
  'providers.testImage': ImageTestResult;
  'settings.getModelRoles': ModelRoles;
  'settings.setModelRoles': ModelRoles;
  'settings.getSchool': SchoolProfile | null;
  'settings.setSchool': SchoolProfile | null;
  'campus.status': CampusConnectionStatus;
  'school.branding': SchoolBranding;
  'books.sources': BookSourceInfo[];
  'books.search': Page<BookRecord>;
  'books.importFile': ImportReport;
  'books.importText': ImportReport;
  'books.deleteSource': void;
}

export type RpcMethod = keyof typeof rpcParamSchemas;
export type RpcParams<M extends RpcMethod> = z.input<(typeof rpcParamSchemas)[M]>;
export type RpcResult<M extends RpcMethod> = RpcResults[M];

export type AccessLevel = 'public' | Role;

/** 每个方法所需的最低角色；所有权等细粒度校验在服务内完成 */
export const methodAccess = {
  'app.info': 'public',
  'auth.status': 'public',
  'auth.register': 'public',
  'auth.login': 'public',
  'auth.loginRemembered': 'public',
  'auth.me': 'public',
  'auth.logout': 'public',
  'auth.updateProfile': 'user',
  'auth.changePassword': 'user',
  'showcase.latest': 'public',
  'showcase.list': 'public',
  'showcase.get': 'public',
  'exhibitions.list': 'user',
  'exhibitions.create': 'user',
  'exhibitions.get': 'user',
  'exhibitions.updateBrief': 'user',
  'exhibitions.updatePlan': 'user',
  'exhibitions.updateProposal': 'user',
  'exhibitions.updatePackage': 'user',
  'exhibitions.updateExecution': 'user',
  'exhibitions.updateRetrospective': 'user',
  'exhibitions.submit': 'user',
  'exhibitions.delete': 'user',
  'exhibitions.unpublish': 'superadmin',
  'checks.run': 'user',
  'checks.update': 'user',
  'plan.replaceBook': 'user',
  'plan.regenerateGuide': 'user',
  'plan.rewrite': 'user',
  'poster.generateArt': 'user',
  'feedback.add': 'user',
  'feedback.delete': 'user',
  'approvals.list': 'approver',
  'approvals.decide': 'approver',
  'users.list': 'superadmin',
  'users.update': 'superadmin',
  'users.resetPassword': 'superadmin',
  'admin.stats': 'superadmin',
  'providers.presets': 'public',
  'providers.list': 'user',
  'providers.save': 'user',
  'providers.delete': 'user',
  'providers.setKey': 'user',
  'providers.listRemoteModels': 'user',
  'providers.test': 'user',
  'providers.testImage': 'user',
  'settings.getModelRoles': 'user',
  'settings.setModelRoles': 'user',
  'settings.getSchool': 'user',
  'settings.setSchool': 'superadmin',
  'campus.status': 'user',
  'school.branding': 'public',
  'books.sources': 'user',
  'books.search': 'user',
  'books.importFile': 'user',
  'books.importText': 'user',
  'books.deleteSource': 'user',
  'agent.run': 'user',
} as const satisfies Record<RpcMethod | StreamMethod, AccessLevel>;

/** 流式方法：智能体运行进度 */
export const streamParamSchemas = {
  'agent.run': z.object({
    id: z.string(),
    task: z.enum(['curate', 'proposal', 'package', 'retrospective']),
  }),
} as const;
export type StreamMethod = keyof typeof streamParamSchemas;
export type StreamParams<M extends StreamMethod> = z.input<(typeof streamParamSchemas)[M]>;
export interface StreamChunks {
  'agent.run': AgentProgress;
}

/** Core 主动推送的事件 */
export interface CoreEvents {
  'exhibitions.changed': { id: string };
  'approvals.changed': Record<string, never>;
  'showcase.changed': Record<string, never>;
  'books.changed': { sourceId?: string };
  'providers.changed': Record<string, never>;
  'users.changed': Record<string, never>;
  'school.changed': Record<string, never>;
}
export type CoreEventTopic = keyof CoreEvents;

/** MessagePort 上的线协议；token 为登录会话凭证，每个请求都携带，服务端无状态校验 */
export type WireMessage =
  | { kind: 'req'; id: number; method: string; params: unknown; token?: string }
  | { kind: 'res'; id: number; result?: unknown; error?: AppErrorShape }
  | { kind: 'stream'; id: number; method: string; params: unknown; token?: string }
  | { kind: 'chunk'; id: number; chunk: unknown }
  | { kind: 'end'; id: number; error?: AppErrorShape }
  | { kind: 'cancel'; id: number }
  | { kind: 'evt'; topic: string; payload: unknown };
