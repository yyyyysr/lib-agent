import { readFile, stat } from 'node:fs/promises';
import { basename } from 'node:path';
import type { UIMessage } from 'ai';
import {
  AppError,
  modelRolesSchema,
  newId,
  nowIso,
  schoolProfileSchema,
  secretRefForProvider,
  type AppInfo,
  type CampusConnectionStatus,
  type ImportReport,
  type ModelInfo,
  type ModelRoles,
  type ProviderConfig,
} from '@yys/shared';
import type { Repositories } from '@yys/db';
import { parseImport, SAMPLE_SOURCE_ID, type ParsedImport } from '@yys/book-sources';
import {
  createLanguageModel,
  getPreset,
  listRemoteModels,
  mapProviderError,
  providerPresets,
  resolveProvider,
  testConnection,
  type FetchFunction,
} from '@yys/llm-gateway';
import { streamChat, titleFromMessages } from './chat';
import type { RpcHandlers, StreamHandlers } from './rpc-server';

const MAX_IMPORT_BYTES = 20 * 1024 * 1024;
const MODEL_ROLES_KEY = 'modelRoles';
const SCHOOL_KEY = 'schoolProfile';
const emptyRoles: ModelRoles = { primary: null, fast: null };

export interface CoreDeps {
  repos: Repositories;
  secrets: { get(ref: string): Promise<string | null>; remove(ref: string): void };
  fetch?: FetchFunction;
  /** 测试时替换为 mock 模型 */
  createModel?: typeof createLanguageModel;
  emit: (topic: 'conversations.changed' | 'books.changed' | 'providers.changed', payload: Record<string, unknown>) => void;
  info: Omit<AppInfo, 'sqliteVersion'>;
}

export function createServices(deps: CoreDeps): { handlers: RpcHandlers; streams: StreamHandlers } {
  const { repos, secrets } = deps;
  const createModel = deps.createModel ?? createLanguageModel;

  const requireProvider = (id: string): ProviderConfig => {
    const config = repos.providers.get(id);
    if (!config) throw new AppError('not_found', '服务商配置不存在，可能已被删除');
    return config;
  };

  const providerContext = async (config: ProviderConfig) =>
    resolveProvider(config, await secrets.get(config.secretRef), deps.fetch);

  const getRoles = (): ModelRoles => repos.settings.get(MODEL_ROLES_KEY, modelRolesSchema, emptyRoles);

  const resolvePrimaryModel = async () => {
    const roles = getRoles();
    const ref = roles.primary;
    if (!ref) throw new AppError('no_model', '还没有选择主模型', '请在 设置 › 模型与密钥 中添加服务商，并把一个模型设为主模型');
    const config = repos.providers.get(ref.providerId);
    if (!config || !config.enabled) {
      throw new AppError('no_model', '主模型所属的服务商不可用', '请在 设置 › 模型与密钥 中重新选择主模型');
    }
    return createModel(await providerContext(config), ref.modelId);
  };

  const finishImport = (parsed: ParsedImport, source: { name: string; kind: 'file' | 'manual'; meta: Record<string, unknown> }): ImportReport => {
    if (parsed.drafts.length === 0) {
      const reasons = parsed.issues.slice(0, 3).map((issue) => `第 ${issue.row} 行：${issue.message}`).join('；');
      throw new AppError('import_failed', '没有可导入的书目', reasons || '请检查文件内容');
    }
    const sourceId = repos.db.transaction(() => {
      const id = repos.books.createSource({ kind: source.kind, name: source.name, meta: source.meta });
      repos.books.insertDrafts(id, parsed.drafts);
      return id;
    });
    deps.emit('books.changed', { sourceId });
    return {
      sourceId,
      sourceName: source.name,
      format: parsed.format,
      totalRows: parsed.totalRows,
      imported: parsed.drafts.length,
      skipped: parsed.skipped,
      duplicates: parsed.duplicates,
      mapping: parsed.mapping,
      unmappedHeaders: parsed.unmappedHeaders,
      issues: parsed.issues,
    };
  };

  const withKeyStatus = async (config: ProviderConfig): Promise<ProviderConfig> => ({
    ...config,
    hasKey: (await secrets.get(config.secretRef)) !== null,
  });

  const handlers: RpcHandlers = {
    'app.info': () => ({ ...deps.info, sqliteVersion: repos.db.sqliteVersion }),

    'providers.presets': () => providerPresets,
    'providers.list': () => Promise.all(repos.providers.list().map(withKeyStatus)),
    'providers.save': async (input) => {
      const preset = getPreset(input.presetId);
      if (!preset) throw new AppError('invalid_params', `未知的服务商类型：${input.presetId}`);
      const existing = input.id ? repos.providers.get(input.id) : undefined;
      const id = existing?.id ?? newId('prov');
      const at = nowIso();
      const seen = new Set<string>();
      const models = input.models.filter((model) => model.id.trim() && !seen.has(model.id) && seen.add(model.id));
      const saved = repos.providers.upsert({
        id,
        presetId: preset.id,
        displayName: input.displayName.trim() || preset.name,
        baseURL: preset.editableBaseURL ? input.baseURL?.trim() || undefined : undefined,
        secretRef: existing?.secretRef ?? secretRefForProvider(id),
        hasKey: existing?.hasKey ?? false,
        models,
        enabled: input.enabled,
        createdAt: existing?.createdAt ?? at,
        updatedAt: at,
      });
      deps.emit('providers.changed', {});
      return withKeyStatus(saved);
    },
    'providers.delete': ({ id }) => {
      const config = requireProvider(id);
      repos.db.transaction(() => {
        repos.providers.delete(id);
        const roles = getRoles();
        repos.settings.set(MODEL_ROLES_KEY, {
          primary: roles.primary?.providerId === id ? null : roles.primary,
          fast: roles.fast?.providerId === id ? null : roles.fast,
        });
      });
      secrets.remove(config.secretRef);
      deps.emit('providers.changed', {});
    },
    'providers.listRemoteModels': async ({ providerId }, { signal }) => {
      const ctx = await providerContext(requireProvider(providerId));
      try {
        return await listRemoteModels(ctx, AbortSignal.any([signal, AbortSignal.timeout(20_000)]));
      } catch (error) {
        const shape = mapProviderError(error);
        throw new AppError(shape.code, `获取模型列表失败：${shape.message}`, shape.hint ?? '也可以直接手动填写模型名称');
      }
    },
    'providers.test': async ({ providerId, modelId }, { signal }) => {
      const config = requireProvider(providerId);
      let ctx;
      try {
        ctx = await providerContext(config);
      } catch (error) {
        return { ok: false, error: mapProviderError(error) };
      }
      const result = await testConnection(createModel(ctx, modelId), signal);
      if (result.ok) {
        const models: ModelInfo[] = config.models.some((m) => m.id === modelId)
          ? config.models.map((m) => (m.id === modelId ? { ...m, capabilities: result.capabilities, testedAt: nowIso() } : m))
          : [...config.models, { id: modelId, capabilities: result.capabilities, testedAt: nowIso() }];
        repos.providers.upsert({ ...config, models, updatedAt: nowIso() });
        deps.emit('providers.changed', {});
      }
      return result;
    },

    'settings.getModelRoles': getRoles,
    'settings.setModelRoles': (roles) => {
      for (const ref of [roles.primary, roles.fast]) {
        if (ref && !repos.providers.get(ref.providerId)) throw new AppError('not_found', '所选模型的服务商不存在');
      }
      repos.settings.set(MODEL_ROLES_KEY, roles);
      deps.emit('providers.changed', {});
      return roles;
    },
    'settings.getSchool': () => repos.settings.get(SCHOOL_KEY, schoolProfileSchema.nullable(), null),
    'settings.setSchool': (profile) => {
      if (profile) repos.settings.set(SCHOOL_KEY, profile);
      else repos.settings.delete(SCHOOL_KEY);
      return profile;
    },

    'campus.status': (): CampusConnectionStatus => {
      const profile = repos.settings.get(SCHOOL_KEY, schoolProfileSchema.nullable(), null);
      if (!profile) return { state: 'not_configured' };
      if (profile.api && profile.auth) return { state: 'signed_out' };
      return { state: 'portal_only' };
    },

    'books.sources': () => repos.books.listSources(),
    'books.search': (query) => repos.books.search(query),
    'books.importFile': async ({ path, sourceName }) => {
      const info = await stat(path).catch(() => null);
      if (!info?.isFile()) throw new AppError('not_found', '找不到要导入的文件');
      if (info.size > MAX_IMPORT_BYTES) throw new AppError('import_failed', '文件超过 20MB', '请拆分后分批导入');
      const bytes = new Uint8Array(await readFile(path));
      const fileName = basename(path);
      const parsed = await parseImport({ bytes, fileName }, nowIso());
      return finishImport(parsed, {
        kind: 'file',
        name: sourceName?.trim() || fileName.replace(/\.[^.]+$/, ''),
        meta: { fileName, format: parsed.format, encoding: parsed.encoding, importedAt: nowIso() },
      });
    },
    'books.importText': async ({ text, format, sourceName }) => {
      const parsed = await parseImport({ text, format }, nowIso());
      return finishImport(parsed, { kind: 'manual', name: sourceName.trim(), meta: { format, importedAt: nowIso() } });
    },
    'books.deleteSource': ({ id }) => {
      if (id === SAMPLE_SOURCE_ID) throw new AppError('invalid_params', '示例书库不能删除');
      repos.books.deleteSource(id);
      deps.emit('books.changed', { sourceId: id });
    },

    'conversations.list': () => repos.conversations.list(),
    'conversations.get': ({ id }) => {
      const conversation = repos.conversations.get(id);
      if (!conversation) throw new AppError('not_found', '对话不存在');
      return conversation;
    },
    'conversations.rename': ({ id, title }) => {
      const renamed = repos.conversations.rename(id, title.trim());
      if (!renamed) throw new AppError('not_found', '对话不存在');
      deps.emit('conversations.changed', { id });
      return renamed;
    },
    'conversations.delete': ({ id }) => {
      repos.conversations.delete(id);
      deps.emit('conversations.changed', { id });
    },
  };

  const streams: StreamHandlers = {
    'chat.send': async ({ conversationId, messages }, { signal }) => {
      const uiMessages = messages as UIMessage[];
      // 先落盘用户消息：模型未配置、请求失败或生成中途崩溃时，问题都不会丢失
      if (uiMessages.length > 0) {
        repos.conversations.save(conversationId, uiMessages, titleFromMessages(uiMessages));
        deps.emit('conversations.changed', { id: conversationId });
      }
      return streamChat({
        repos,
        model: await resolvePrimaryModel(),
        conversationId,
        messages: uiMessages,
        signal,
        onSaved: (id) => deps.emit('conversations.changed', { id }),
      });
    },
  };

  return { handlers, streams };
}
