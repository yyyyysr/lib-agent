import { useEffect, useState } from 'react';
import {
  ArrowLeft,
  CheckCircle2,
  CloudDownload,
  ExternalLink,
  Plus,
  X,
  XCircle,
} from 'lucide-react';
import type { ConnectionTestResult, ModelInfo, ProviderConfig, ProviderPreset } from '@yys/shared';
import { Badge, Button, Dialog, Field, Input } from '../../components/ui';
import { cn } from '../../lib/cn';
import { core, errorText } from '../../lib/core-client';
import { useRpc } from '../../lib/use-rpc';
import { toast } from '../../store/app-store';
import { useRole } from '../../store/auth-store';

const groupLabels: Record<ProviderPreset['group'], string> = {
  domestic: '国内服务商',
  international: '国际服务商',
  aggregator: '聚合平台',
  local: '本地模型',
  custom: '自定义',
};

export function CapabilityBadges({ model }: { model: ModelInfo }) {
  const caps = model.capabilities;
  if (!caps) return <Badge>未测试</Badge>;
  return (
    <>
      <Badge tone={caps.toolCalling === 'yes' ? 'success' : 'warning'}>
        {caps.toolCalling === 'yes' ? '工具调用 ✓' : '不支持工具调用'}
      </Badge>
      <Badge
        tone={
          caps.structuredOutput === 'native'
            ? 'success'
            : caps.structuredOutput === 'none'
              ? 'warning'
              : 'neutral'
        }
      >
        {caps.structuredOutput === 'native'
          ? '结构化输出 ✓'
          : caps.structuredOutput === 'none'
            ? '不支持结构化输出'
            : '结构化输出待确认'}
      </Badge>
    </>
  );
}

function TestResultView({ result }: { result: ConnectionTestResult }) {
  if (!result.ok) {
    return (
      <div className="flex gap-2.5 rounded-xl bg-danger-soft p-3">
        <XCircle className="mt-0.5 size-4 shrink-0 text-danger" />
        <div>
          <p className="text-[13px] text-danger">{result.error.message}</p>
          {result.error.hint && <p className="mt-0.5 text-xs text-muted">{result.error.hint}</p>}
        </div>
      </div>
    );
  }
  const usable =
    result.capabilities.toolCalling === 'yes' && result.capabilities.structuredOutput !== 'none';
  return (
    <div className="flex gap-2.5 rounded-xl bg-accent-soft p-3">
      <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" />
      <div className="min-w-0 space-y-1.5">
        <p className="text-[13px] text-success">
          连接成功 · 首次响应 {(result.latencyMs / 1000).toFixed(1)} 秒
        </p>
        <div className="flex flex-wrap gap-1.5">
          <CapabilityBadges model={{ id: '', capabilities: result.capabilities }} />
        </div>
        {!usable && (
          <p className="text-xs text-warning">
            该模型缺少部分能力，可以对话，但不建议作为主模型执行策展流程。
          </p>
        )}
      </div>
    </div>
  );
}

export function ProviderDialog({
  open,
  onOpenChange,
  editing,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing?: ProviderConfig;
}) {
  const { data: presets = [] } = useRpc('providers.presets', undefined);
  const { data: roles } = useRpc('settings.getModelRoles', undefined);
  const [presetId, setPresetId] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState('');
  const [baseURL, setBaseURL] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [keySaved, setKeySaved] = useState(false);
  const [shared, setShared] = useState(false);
  const isAdmin = useRole('superadmin');
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [newModel, setNewModel] = useState('');
  const [remoteModels, setRemoteModels] = useState<ModelInfo[] | null>(null);
  const [savedId, setSavedId] = useState<string | undefined>();
  const [testModel, setTestModel] = useState('');
  const [testResult, setTestResult] = useState<ConnectionTestResult | null>(null);
  const [busy, setBusy] = useState<'save' | 'test' | 'fetch' | null>(null);

  useEffect(() => {
    if (!open) return;
    setPresetId(editing?.presetId ?? null);
    setDisplayName(editing?.displayName ?? '');
    setBaseURL(editing?.baseURL ?? '');
    setApiKey('');
    setKeySaved(Boolean(editing?.hasKey));
    setShared(editing ? editing.ownerId === null : false);
    setModels(editing?.models ?? []);
    setNewModel('');
    setRemoteModels(null);
    setSavedId(editing?.id);
    setTestModel(editing?.models[0]?.id ?? '');
    setTestResult(null);
  }, [open, editing]);

  const preset = presets.find((p) => p.id === presetId);

  const addModel = (id: string): void => {
    const value = id.trim();
    if (!value || models.some((m) => m.id === value)) return;
    setModels((list) => [...list, { id: value }]);
    if (!testModel) setTestModel(value);
  };

  /** 保存配置与密钥；测试连接、拉取模型前都需要先保存，Core 才能取到 Key */
  const persist = async (): Promise<ProviderConfig> => {
    if (!preset) throw new Error('请选择服务商');
    if (preset.id === 'custom' && !baseURL.trim()) throw new Error('请填写接口地址（Base URL）');
    const pendingModel = newModel.trim();
    const allModels =
      pendingModel && !models.some((m) => m.id === pendingModel)
        ? [...models, { id: pendingModel }]
        : models;
    if (pendingModel) {
      setModels(allModels);
      setNewModel('');
    }
    const saved = await core.call('providers.save', {
      id: savedId,
      presetId: preset.id,
      displayName: displayName.trim(),
      baseURL: baseURL.trim() || undefined,
      models: allModels,
      enabled: editing?.enabled ?? true,
      shared,
    });
    if (apiKey.trim()) {
      await core.call('providers.setKey', { providerId: saved.id, apiKey: apiKey.trim() });
      setApiKey('');
      setKeySaved(true);
    }
    setSavedId(saved.id);
    if (!roles?.primary && allModels[0]) {
      await core.call('settings.setModelRoles', {
        primary: { providerId: saved.id, modelId: allModels[0].id },
        fast: roles?.fast ?? null,
      });
    }
    return saved;
  };

  const run = async (kind: 'save' | 'test' | 'fetch'): Promise<void> => {
    setBusy(kind);
    try {
      const saved = await persist();
      if (kind === 'save') {
        toast({ tone: 'success', title: `已保存“${saved.displayName}”` });
        onOpenChange(false);
      } else if (kind === 'fetch') {
        const list = await core.call('providers.listRemoteModels', { providerId: saved.id });
        setRemoteModels(list);
        if (list.length === 0)
          toast({
            tone: 'info',
            title: '服务商没有返回可用模型',
            description: '请手动填写模型名称',
          });
      } else {
        const modelId = testModel || models[0]?.id;
        if (!modelId) throw new Error('请先添加一个模型');
        setTestResult(null);
        const result = await core.call('providers.test', { providerId: saved.id, modelId });
        setTestResult(result);
        if (result.ok) {
          setModels((list) =>
            list.some((m) => m.id === modelId)
              ? list.map((m) =>
                  m.id === modelId
                    ? {
                        ...m,
                        capabilities: result.capabilities,
                        testedAt: new Date().toISOString(),
                      }
                    : m,
                )
              : [...list, { id: modelId, capabilities: result.capabilities }],
          );
        }
      }
    } catch (error) {
      const { message, hint } = errorText(error);
      toast({ tone: 'error', title: message, description: hint });
    } finally {
      setBusy(null);
    }
  };

  const grouped = presets.reduce<Record<string, ProviderPreset[]>>((acc, p) => {
    (acc[p.group] ??= []).push(p);
    return acc;
  }, {});

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      width="max-w-2xl"
      title={
        preset && !editing ? (
          <button
            onClick={() => setPresetId(null)}
            className="flex items-center gap-1.5 hover:text-muted"
          >
            <ArrowLeft className="size-4" /> {preset.name}
          </button>
        ) : editing ? (
          `编辑 ${editing.displayName}`
        ) : (
          '添加模型服务商'
        )
      }
      description={
        preset
          ? 'API Key 使用系统钥匙串加密保存在本机，请求直接发往服务商，不经过任何第三方服务器。'
          : '选择你已有账号的服务商，使用自己的 API Key（BYOK）。'
      }
      footer={
        preset && (
          <>
            <Button
              variant="outline"
              loading={busy === 'test'}
              disabled={busy !== null}
              onClick={() => void run('test')}
            >
              测试连接
            </Button>
            <Button
              variant="primary"
              loading={busy === 'save'}
              disabled={busy !== null}
              onClick={() => void run('save')}
            >
              保存
            </Button>
          </>
        )
      }
    >
      {!preset ? (
        <div className="space-y-5">
          {(Object.keys(groupLabels) as ProviderPreset['group'][])
            .filter((group) => grouped[group])
            .map((group) => (
              <div key={group}>
                <p className="mb-2 text-xs font-medium text-subtle">{groupLabels[group]}</p>
                <div className="grid grid-cols-3 gap-2">
                  {grouped[group]!.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => {
                        setPresetId(p.id);
                        setDisplayName(p.name);
                      }}
                      className="rounded-xl border border-border px-3 py-2.5 text-left text-[13px] hover:bg-surface-hover"
                    >
                      {p.name}
                      {!p.requiresKey && (
                        <span className="mt-0.5 block text-[11px] text-subtle">无需 API Key</span>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            ))}
        </div>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="显示名称">
              <Input
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder={preset.name}
              />
            </Field>
            {preset.editableBaseURL ? (
              <Field label="接口地址（Base URL）">
                <Input
                  value={baseURL}
                  onChange={(e) => setBaseURL(e.target.value)}
                  placeholder={preset.defaultBaseURL ?? 'https://…/v1'}
                />
              </Field>
            ) : (
              <Field label="接口地址">
                <Input value={preset.defaultBaseURL ?? ''} disabled />
              </Field>
            )}
          </div>

          <Field
            label={preset.requiresKey ? 'API Key' : 'API Key（可选）'}
            hint={
              preset.keyUrl ? (
                <button
                  onClick={() => void window.yys.shell.openExternal(preset.keyUrl!)}
                  className="inline-flex items-center gap-1 text-accent hover:underline"
                >
                  前往 {preset.name} 获取 Key <ExternalLink className="size-3" />
                </button>
              ) : undefined
            }
          >
            <Input
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={keySaved ? '已加密保存（留空表示不修改）' : 'sk-…'}
            />
          </Field>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[13px] font-medium">模型</span>
              <Button
                size="sm"
                variant="ghost"
                loading={busy === 'fetch'}
                disabled={busy !== null}
                onClick={() => void run('fetch')}
              >
                <CloudDownload className="size-3.5" /> 从服务商获取
              </Button>
            </div>
            {models.length > 0 && (
              <div className="divide-y divide-border rounded-xl border border-border">
                {models.map((model) => (
                  <div key={model.id} className="flex items-center gap-2 px-3 py-2">
                    <input
                      type="radio"
                      name="test-model"
                      aria-label={`用 ${model.id} 测试连接`}
                      checked={testModel === model.id}
                      onChange={() => setTestModel(model.id)}
                      className="accent-(--accent)"
                    />
                    <span className="min-w-0 flex-1 truncate font-mono text-[13px]">
                      {model.id}
                    </span>
                    <CapabilityBadges model={model} />
                    <button
                      aria-label={`移除 ${model.id}`}
                      onClick={() => setModels((list) => list.filter((m) => m.id !== model.id))}
                      className="text-subtle hover:text-fg"
                    >
                      <X className="size-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className="flex gap-2">
              <Input
                value={newModel}
                onChange={(e) => setNewModel(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                    addModel(newModel);
                    setNewModel('');
                  }
                }}
                placeholder="手动填写模型名称，如 deepseek-chat、qwen-plus"
                className="font-mono text-[13px]"
              />
              <Button
                variant="outline"
                onClick={() => (addModel(newModel), setNewModel(''))}
                disabled={!newModel.trim()}
              >
                <Plus className="size-3.5" /> 添加
              </Button>
            </div>
            {remoteModels && remoteModels.length > 0 && (
              <div className="max-h-40 overflow-y-auto rounded-xl bg-surface p-2">
                <p className="px-1 pb-1.5 text-[11px] text-subtle">
                  点击添加（共 {remoteModels.length} 个）
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {remoteModels.map((m) => {
                    const added = models.some((x) => x.id === m.id);
                    return (
                      <button
                        key={m.id}
                        disabled={added}
                        onClick={() => addModel(m.id)}
                        className={cn(
                          'rounded-md border px-2 py-0.5 font-mono text-xs',
                          added
                            ? 'border-accent text-accent'
                            : 'border-border bg-bg hover:border-border-strong',
                        )}
                      >
                        {m.id}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {isAdmin && (
            <label className="flex items-start gap-2.5 rounded-xl bg-surface p-3 text-[13px]">
              <input
                type="checkbox"
                checked={shared}
                onChange={(e) => setShared(e.target.checked)}
                className="mt-0.5 accent-(--accent)"
              />
              <span>
                <span className="font-medium">共享给全部用户</span>
                <span className="block text-xs text-muted">
                  普通用户未配置自己的模型时，智能体会使用这个服务商。费用计入你的账户。
                </span>
              </span>
            </label>
          )}

          {testResult && <TestResultView result={testResult} />}
        </div>
      )}
    </Dialog>
  );
}
