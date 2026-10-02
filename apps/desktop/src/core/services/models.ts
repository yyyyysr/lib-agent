import type { LanguageModel } from 'ai';
import {
  AppError,
  modelRolesSchema,
  newId,
  nowIso,
  secretRefForProvider,
  type ImageModelRef,
  type ModelInfo,
  type ModelRoles,
  type ProviderConfig,
  type UserInfo,
} from '@yys/shared';
import {
  createImageGenerator,
  createLanguageModel,
  getPreset,
  listRemoteModels,
  mapProviderError,
  providerPresets,
  resolveProvider,
  testConnection,
} from '@yys/llm-gateway';
import type { RpcHandlers } from '../rpc-server';
import type { CoreDeps } from './context';

const emptyRoles: ModelRoles = { primary: null, fast: null, image: null };
const TEST_IMAGE_PROMPT =
  'A simple, elegant watercolor illustration of an open book on a wooden desk beside a window, soft morning light, calm colors. No text, no letters, no watermark.';
const rolesKey = (userId: string): string => `modelRoles:${userId}`;

export function createModelServices(deps: CoreDeps) {
  const { repos, secrets } = deps;
  const createModel = deps.createModel ?? createLanguageModel;
  const createImageGen = deps.createImageGenerator ?? createImageGenerator;

  const accessible = (user: UserInfo, id: string): ProviderConfig => {
    const config = repos.providers.get(id);
    if (!config || (config.ownerId !== null && config.ownerId !== user.id)) {
      throw new AppError('not_found', '服务商配置不存在，可能已被删除');
    }
    return config;
  };

  const manageable = (user: UserInfo, id: string): ProviderConfig => {
    const config = accessible(user, id);
    if (config.ownerId === null && user.role !== 'superadmin')
      throw new AppError('forbidden', '共享服务商只能由超级管理员修改');
    return config;
  };

  const providerContext = async (config: ProviderConfig) =>
    resolveProvider(config, await secrets.get(config.secretRef), deps.fetch);

  const withKeyStatus = async (config: ProviderConfig): Promise<ProviderConfig> => ({
    ...config,
    hasKey: (await secrets.get(config.secretRef)) !== null,
  });

  const getRoles = (user: UserInfo): ModelRoles =>
    repos.settings.get(rolesKey(user.id), modelRolesSchema, emptyRoles);

  /**
   * 智能体使用的模型：用户选定的主模型；未选择时自动使用可用的共享服务商，
   * 这样超级管理员配置一次共享 Key，普通用户无需各自填写即可使用。
   */
  async function resolveModel(user: UserInfo): Promise<{ model: LanguageModel; label: string }> {
    const ref = getRoles(user).primary;
    const candidates: { config: ProviderConfig; modelId: string }[] = [];
    if (ref) {
      const config = repos.providers.get(ref.providerId);
      if (config && config.enabled && (config.ownerId === null || config.ownerId === user.id))
        candidates.push({ config, modelId: ref.modelId });
    }
    for (const config of repos.providers.listFor(user.id)) {
      const modelId = config.models[0]?.id;
      if (config.enabled && modelId) candidates.push({ config, modelId });
    }
    for (const candidate of candidates) {
      try {
        const ctx = await providerContext(candidate.config);
        return {
          model: createModel(ctx, candidate.modelId),
          label: `${candidate.config.displayName} · ${candidate.modelId}`,
        };
      } catch {
        // 缺 Key 或地址的服务商跳过，继续尝试下一个
      }
    }
    throw new AppError(
      'no_model',
      '还没有可用的模型',
      '请在 设置 › 模型与密钥 中添加服务商并填写 API Key，或请超级管理员配置共享模型',
    );
  }

  /**
   * 生图模型：先用用户自己选定的；没有时使用超级管理员配置在共享服务商上的生图模型。
   */
  async function resolveImageGenerator(user: UserInfo) {
    const candidates: ImageModelRef[] = [];
    const own = getRoles(user).image;
    if (own) candidates.push(own);
    for (const admin of repos.users.list()) {
      if (admin.role !== 'superadmin' || admin.status !== 'active' || admin.id === user.id)
        continue;
      const ref = getRoles(admin).image;
      if (ref && repos.providers.get(ref.providerId)?.ownerId === null) candidates.push(ref);
    }
    for (const ref of candidates) {
      const config = repos.providers.get(ref.providerId);
      if (!config?.enabled || (config.ownerId !== null && config.ownerId !== user.id)) continue;
      try {
        const ctx = await providerContext(config);
        return {
          generate: createImageGen(ctx, ref.modelId, ref.mode),
          label: `${config.displayName} · ${ref.modelId}`,
        };
      } catch {
        // 缺 Key 或地址的服务商跳过
      }
    }
    throw new AppError(
      'no_model',
      '还没有配置生图模型',
      '请在 设置 › 模型与密钥 › 模型分工 中选择“生图模型”，或请超级管理员在共享服务商上配置',
    );
  }

  const handlers: Pick<
    RpcHandlers,
    | 'providers.presets'
    | 'providers.list'
    | 'providers.save'
    | 'providers.delete'
    | 'providers.listRemoteModels'
    | 'providers.test'
    | 'providers.testImage'
    | 'settings.getModelRoles'
    | 'settings.setModelRoles'
  > = {
    'providers.presets': () => providerPresets,
    'providers.list': (_p, { user }) =>
      Promise.all(repos.providers.listFor(user.id).map(withKeyStatus)),
    'providers.save': async (input, { user }) => {
      const preset = getPreset(input.presetId);
      if (!preset) throw new AppError('invalid_params', `未知的服务商类型：${input.presetId}`);
      if (input.shared && user.role !== 'superadmin')
        throw new AppError('forbidden', '只有超级管理员可以配置共享服务商');
      const existing = input.id ? manageable(user, input.id) : undefined;
      const id = existing?.id ?? newId('prov');
      const at = nowIso();
      const seen = new Set<string>();
      const models = input.models.filter(
        (model) => model.id.trim() && !seen.has(model.id) && seen.add(model.id),
      );
      const saved = repos.providers.upsert({
        id,
        presetId: preset.id,
        displayName: input.displayName.trim() || preset.name,
        baseURL: preset.editableBaseURL ? input.baseURL?.trim() || undefined : undefined,
        secretRef: existing?.secretRef ?? secretRefForProvider(id),
        hasKey: existing?.hasKey ?? false,
        models,
        enabled: input.enabled,
        ownerId: input.shared ? null : user.id,
        createdAt: existing?.createdAt ?? at,
        updatedAt: at,
      });
      deps.emit('providers.changed', {});
      return withKeyStatus(saved);
    },
    'providers.delete': ({ id }, { user }) => {
      const config = manageable(user, id);
      repos.db.transaction(() => {
        repos.providers.delete(id);
        const roles = getRoles(user);
        repos.settings.set(rolesKey(user.id), {
          primary: roles.primary?.providerId === id ? null : roles.primary,
          fast: roles.fast?.providerId === id ? null : roles.fast,
          image: roles.image?.providerId === id ? null : roles.image,
        });
      });
      secrets.remove(config.secretRef);
      deps.emit('providers.changed', {});
    },
    'providers.listRemoteModels': async ({ providerId }, { user, signal }) => {
      const ctx = await providerContext(accessible(user, providerId));
      try {
        return await listRemoteModels(ctx, AbortSignal.any([signal, AbortSignal.timeout(20_000)]));
      } catch (error) {
        const shape = mapProviderError(error);
        throw new AppError(
          shape.code,
          `获取模型列表失败：${shape.message}`,
          shape.hint ?? '也可以直接手动填写模型名称',
        );
      }
    },
    'providers.test': async ({ providerId, modelId }, { user, signal }) => {
      const config = accessible(user, providerId);
      let ctx;
      try {
        ctx = await providerContext(config);
      } catch (error) {
        return { ok: false, error: mapProviderError(error) };
      }
      const result = await testConnection(createModel(ctx, modelId), signal);
      if (result.ok) {
        const tested = { capabilities: result.capabilities, testedAt: nowIso() };
        const models: ModelInfo[] = config.models.some((m) => m.id === modelId)
          ? config.models.map((m) => (m.id === modelId ? { ...m, ...tested } : m))
          : [...config.models, { id: modelId, ...tested }];
        repos.providers.upsert({ ...config, models, updatedAt: nowIso() });
        deps.emit('providers.changed', {});
      }
      return result;
    },
    'providers.testImage': async ({ providerId, modelId, mode }, { user, signal }) => {
      const started = Date.now();
      try {
        const ctx = await providerContext(accessible(user, providerId));
        const image = await createImageGen(ctx, modelId, mode)(TEST_IMAGE_PROMPT, { signal });
        return {
          ok: true,
          latencyMs: Date.now() - started,
          mediaId: deps.media.save(image.data, image.mediaType),
        };
      } catch (error) {
        return { ok: false, error: mapProviderError(error) };
      }
    },
    'settings.getModelRoles': (_p, { user }) => getRoles(user),
    'settings.setModelRoles': (roles, { user }) => {
      for (const ref of [roles.primary, roles.fast, roles.image])
        if (ref) accessible(user, ref.providerId);
      repos.settings.set(rolesKey(user.id), roles);
      deps.emit('providers.changed', {});
      return roles;
    },
  };

  return { handlers, resolveModel, resolveImageGenerator };
}
