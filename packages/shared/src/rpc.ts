import { z } from 'zod';
import { bookQuerySchema, type BookFieldKey, type BookRecord, type BookSourceInfo, type Page } from './book';
import type { ConversationDetail, ConversationSummary } from './conversation';
import type { AppErrorShape } from './errors';
import {
  modelRolesSchema,
  providerInputSchema,
  type ConnectionTestResult,
  type ModelInfo,
  type ModelRoles,
  type ProviderConfig,
  type ProviderPreset,
} from './provider';
import { schoolProfileSchema, type CampusConnectionStatus, type SchoolProfile } from './school';

export const importFormatSchema = z.enum(['csv', 'tsv', 'txt', 'xlsx', 'json']);
export type ImportFormat = z.infer<typeof importFormatSchema>;
export const supportedImportExtensions = ['csv', 'tsv', 'txt', 'xlsx', 'xlsm', 'json', 'jsonl'];

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

const id = z.object({ id: z.string().min(1) });

/** 请求-响应方法：参数 schema 在 Core 入口做运行时校验 */
export const rpcParamSchemas = {
  'app.info': z.void(),

  'providers.presets': z.void(),
  'providers.list': z.void(),
  'providers.save': providerInputSchema,
  'providers.delete': id,
  'providers.listRemoteModels': z.object({ providerId: z.string() }),
  'providers.test': z.object({ providerId: z.string(), modelId: z.string() }),

  'settings.getModelRoles': z.void(),
  'settings.setModelRoles': modelRolesSchema,
  'settings.getSchool': z.void(),
  'settings.setSchool': schoolProfileSchema.nullable(),

  'campus.status': z.void(),

  'books.sources': z.void(),
  'books.search': bookQuerySchema,
  'books.importFile': z.object({ path: z.string().min(1), sourceName: z.string().optional() }),
  'books.importText': z.object({
    text: z.string().min(1),
    format: importFormatSchema.exclude(['xlsx']),
    sourceName: z.string().min(1),
  }),
  'books.deleteSource': id,

  'conversations.list': z.void(),
  'conversations.get': id,
  'conversations.rename': z.object({ id: z.string(), title: z.string().min(1).max(80) }),
  'conversations.delete': id,
} as const;

export interface RpcResults {
  'app.info': AppInfo;
  'providers.presets': ProviderPreset[];
  'providers.list': ProviderConfig[];
  'providers.save': ProviderConfig;
  'providers.delete': void;
  'providers.listRemoteModels': ModelInfo[];
  'providers.test': ConnectionTestResult;
  'settings.getModelRoles': ModelRoles;
  'settings.setModelRoles': ModelRoles;
  'settings.getSchool': SchoolProfile | null;
  'settings.setSchool': SchoolProfile | null;
  'campus.status': CampusConnectionStatus;
  'books.sources': BookSourceInfo[];
  'books.search': Page<BookRecord>;
  'books.importFile': ImportReport;
  'books.importText': ImportReport;
  'books.deleteSource': void;
  'conversations.list': ConversationSummary[];
  'conversations.get': ConversationDetail;
  'conversations.rename': ConversationSummary;
  'conversations.delete': void;
}

export type RpcMethod = keyof typeof rpcParamSchemas;
export type RpcParams<M extends RpcMethod> = z.input<(typeof rpcParamSchemas)[M]>;
export type RpcResult<M extends RpcMethod> = RpcResults[M];

/** 流式方法：返回 UIMessageChunk 流 */
export const streamParamSchemas = {
  'chat.send': z.object({
    conversationId: z.string().min(1),
    messages: z.array(z.unknown()),
  }),
} as const;
export type StreamMethod = keyof typeof streamParamSchemas;
export type StreamParams<M extends StreamMethod> = z.input<(typeof streamParamSchemas)[M]>;

/** Core 主动推送的事件 */
export interface CoreEvents {
  'conversations.changed': { id: string };
  'books.changed': { sourceId?: string };
  'providers.changed': Record<string, never>;
}
export type CoreEventTopic = keyof CoreEvents;

/** MessagePort 上的线协议 */
export type WireMessage =
  | { kind: 'req'; id: number; method: string; params: unknown }
  | { kind: 'res'; id: number; result?: unknown; error?: AppErrorShape }
  | { kind: 'stream'; id: number; method: string; params: unknown }
  | { kind: 'chunk'; id: number; chunk: unknown }
  | { kind: 'end'; id: number; error?: AppErrorShape }
  | { kind: 'cancel'; id: number }
  | { kind: 'evt'; topic: string; payload: unknown };
