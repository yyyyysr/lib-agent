import { useEffect, useState, type ReactNode } from 'react';
import {
  Database,
  Info,
  KeyRound,
  Monitor,
  Moon,
  Pencil,
  Plus,
  School,
  Sun,
  Trash2,
  UserRound,
  Image as ImageIcon,
} from 'lucide-react';
import {
  newId,
  profileSchema,
  roleLabels,
  schoolProfileSchema,
  type ProviderConfig,
  type SchoolProfile,
  type ThemeSource,
  type ImageTestResult,
} from '@yys/shared';
import { mediaUrl } from '@yys/shared/ipc';
import { TopBar } from '../../app/TopBar';
import {
  Badge,
  Button,
  Dialog,
  EmptyState,
  Field,
  IconButton,
  Input,
  Textarea,
} from '../../components/ui';
import { cn } from '../../lib/cn';
import { core, errorText } from '../../lib/core-client';
import { getThemeSource, setThemeSource } from '../../lib/theme';
import { useRpc } from '../../lib/use-rpc';
import { toast, useAppStore, type SettingsSection } from '../../store/app-store';
import { useAuth, useRole } from '../../store/auth-store';
import { CapabilityBadges, ProviderDialog } from './ProviderDialog';
import { sameRef, useModels, type ModelOption } from './useModels';

const sections: { key: SettingsSection; label: string; icon: typeof KeyRound; login?: boolean }[] =
  [
    { key: 'account', label: '账号与资料', icon: UserRound, login: true },
    { key: 'models', label: '模型与密钥', icon: KeyRound, login: true },
    { key: 'school', label: '学校与馆藏', icon: School, login: true },
    { key: 'appearance', label: '外观', icon: Monitor },
    { key: 'data', label: '数据与隐私', icon: Database },
    { key: 'about', label: '关于', icon: Info },
  ];

function Section({
  title,
  description,
  children,
  action,
}: {
  title: string;
  description?: ReactNode;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <section className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold">{title}</h2>
          {description && (
            <p className="mt-1 text-[13px] leading-relaxed text-muted">{description}</p>
          )}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function ModelSelect({
  label,
  hint,
  value,
  options,
  onChange,
  allowEmpty,
}: {
  label: string;
  hint: string;
  value: ModelOption | null;
  options: ModelOption[];
  onChange: (option: ModelOption | null) => void;
  allowEmpty?: boolean;
}) {
  const key = (o: ModelOption): string => `${o.providerId}::${o.modelId}`;
  return (
    <Field label={label} hint={hint}>
      <select
        value={value ? key(value) : ''}
        onChange={(e) => onChange(options.find((o) => key(o) === e.target.value) ?? null)}
        className="h-9 w-full rounded-xl border border-border bg-bg px-3 text-sm text-fg focus:border-border-strong focus:outline-none"
      >
        {(allowEmpty || !value) && (
          <option value="">{allowEmpty ? '与主模型相同' : '请选择'}</option>
        )}
        {options.map((o) => (
          <option key={key(o)} value={key(o)}>
            {o.providerName} · {o.label}
          </option>
        ))}
      </select>
    </Field>
  );
}

/** 生图模型单独接入：图像生成接口或能输出图片的多模态模型；可直接测试并预览 */
function ImageModelPanel({ options }: { options: ModelOption[] }) {
  const { roles, setRoles } = useModels();
  const isAdmin = useRole('superadmin');
  const image = roles?.image ?? null;
  const selected = options.find((o) => sameRef(o, image)) ?? null;
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<ImageTestResult | null>(null);
  const key = (o: ModelOption): string => `${o.providerId}::${o.modelId}`;
  const mode = image?.mode ?? 'image';

  const test = async (): Promise<void> => {
    if (!image) return;
    setTesting(true);
    setResult(null);
    try {
      setResult(await core.call('providers.testImage', image));
    } catch (error) {
      setResult({
        ok: false,
        error: errorText(error) as { code: string; message: string; hint?: string },
      });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="mt-2 rounded-2xl border border-border p-4">
      <div className="flex items-start gap-3">
        <ImageIcon className="mt-0.5 size-4 text-accent" />
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-medium">生图模型</p>
          <p className="mt-0.5 text-xs leading-relaxed text-muted">
            用于 AI 绘制海报画面。可选专门的生图接口（如 gpt-image-1、Imagen、豆包
            Seedream、硅基流动 Kolors/FLUX），或能输出图片的多模态模型（如
            gemini-2.5-flash-image）。先在上方服务商中添加对应的模型名称。
            {isAdmin && ' 配置在“全员共享”服务商上的生图模型，其他用户未配置时也能使用。'}
          </p>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-[1fr_200px_auto] items-end gap-3">
        <Field label="模型">
          <select
            value={selected ? key(selected) : ''}
            onChange={(e) => {
              const option = options.find((o) => key(o) === e.target.value);
              setResult(null);
              void setRoles({
                image: option
                  ? { providerId: option.providerId, modelId: option.modelId, mode }
                  : null,
              });
            }}
            className="h-9 w-full rounded-xl border border-border bg-bg px-3 text-sm text-fg focus:border-border-strong focus:outline-none"
          >
            <option value="">不使用 AI 绘图</option>
            {options.map((o) => (
              <option key={key(o)} value={key(o)}>
                {o.providerName} · {o.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="接入方式">
          <select
            disabled={!image}
            value={mode}
            onChange={(e) =>
              image &&
              void setRoles({ image: { ...image, mode: e.target.value as 'image' | 'multimodal' } })
            }
            className="h-9 w-full rounded-xl border border-border bg-bg px-3 text-sm text-fg focus:border-border-strong focus:outline-none disabled:opacity-60"
          >
            <option value="image">生图接口</option>
            <option value="multimodal">多模态模型</option>
          </select>
        </Field>
        <Button variant="outline" disabled={!image} loading={testing} onClick={() => void test()}>
          测试生图
        </Button>
      </div>
      {result && (
        <div
          className={cn(
            'mt-3 flex gap-3 rounded-xl p-3',
            result.ok ? 'bg-accent-soft' : 'bg-danger-soft',
          )}
        >
          {result.ok ? (
            <>
              <img
                src={mediaUrl(result.mediaId)}
                alt="测试生成的图片"
                className="h-24 w-auto rounded-lg object-cover"
              />
              <p className="text-[13px] text-success">
                生成成功 · 用时 {(result.latencyMs / 1000).toFixed(1)} 秒
              </p>
            </>
          ) : (
            <div>
              <p className="text-[13px] text-danger">{result.error.message}</p>
              {result.error.hint && (
                <p className="mt-0.5 text-xs text-muted">{result.error.hint}</p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ModelsSection() {
  const { data: providers = [], loading } = useRpc('providers.list', undefined, {
    topics: ['providers.changed'],
  });
  const { options, roles, setRoles } = useModels();
  const isAdmin = useRole('superadmin');
  const { data: presets = [] } = useRpc('providers.presets', undefined);
  const [dialog, setDialog] = useState<{ open: boolean; editing?: ProviderConfig }>({
    open: false,
  });
  const [pendingDelete, setPendingDelete] = useState<ProviderConfig | null>(null);

  const primary = options.find((o) => sameRef(o, roles?.primary)) ?? null;
  const fast = options.find((o) => sameRef(o, roles?.fast)) ?? null;

  const remove = async (): Promise<void> => {
    if (!pendingDelete) return;
    const target = pendingDelete;
    setPendingDelete(null);
    try {
      await core.call('providers.delete', { id: target.id });
      toast({ tone: 'success', title: `已删除“${target.displayName}”及其密钥` });
    } catch (error) {
      toast({ tone: 'error', title: '删除失败', description: errorText(error).message });
    }
  };

  return (
    <div className="space-y-10">
      <Section
        title="模型服务商"
        description={`使用你自己的 API Key（BYOK），Key 通过系统钥匙串（macOS）或 DPAPI（Windows）加密保存在本机，界面无法读回明文。${
          isAdmin
            ? '作为超级管理员，你可以把服务商设为全员共享，普通用户无需各自填写 Key。'
            : '没有选择主模型时，智能体会自动使用超级管理员共享的模型。'
        }`}
        action={
          <Button variant="primary" size="sm" onClick={() => setDialog({ open: true })}>
            <Plus className="size-3.5" /> 添加服务商
          </Button>
        }
      >
        {!loading && providers.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border-strong">
            <EmptyState
              icon={<KeyRound className="size-7" />}
              title="还没有配置模型"
              description="支持 DeepSeek、通义千问、Kimi、智谱、豆包、OpenAI、Claude、Gemini、OpenRouter，以及 Ollama 等本地模型和任意 OpenAI 兼容接口。"
              action={
                <Button variant="primary" onClick={() => setDialog({ open: true })}>
                  添加第一个服务商
                </Button>
              }
            />
          </div>
        ) : (
          <div className="space-y-2">
            {providers.map((p) => (
              <div key={p.id} className="rounded-2xl border border-border p-4">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{p.displayName}</span>
                  {p.ownerId === null && <Badge tone="accent">全员共享</Badge>}
                  {!p.hasKey && presets.find((x) => x.id === p.presetId)?.requiresKey === false ? (
                    <Badge>无需 Key</Badge>
                  ) : p.hasKey ? (
                    <Badge tone="success">Key 已保存</Badge>
                  ) : (
                    <Badge tone="warning">未填写 Key</Badge>
                  )}
                  <div className="flex-1" />
                  {(p.ownerId !== null || isAdmin) && (
                    <>
                      <IconButton
                        label="编辑"
                        size="sm"
                        onClick={() => setDialog({ open: true, editing: p })}
                      >
                        <Pencil className="size-3.5" />
                      </IconButton>
                      <IconButton label="删除" size="sm" onClick={() => setPendingDelete(p)}>
                        <Trash2 className="size-3.5" />
                      </IconButton>
                    </>
                  )}
                </div>
                {p.baseURL && <p className="mt-1 font-mono text-xs text-subtle">{p.baseURL}</p>}
                <div className="mt-3 space-y-1.5">
                  {p.models.length === 0 ? (
                    <p className="text-xs text-warning">还没有添加模型</p>
                  ) : (
                    p.models.map((m) => (
                      <div key={m.id} className="flex flex-wrap items-center gap-1.5">
                        <span className="mr-1 font-mono text-[13px]">{m.id}</span>
                        <CapabilityBadges model={m} />
                        {sameRef({ providerId: p.id, modelId: m.id }, roles?.primary) && (
                          <Badge tone="accent">主模型</Badge>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>

      {options.length > 0 && (
        <Section
          title="模型分工"
          description="主模型负责选书、编排、撰写与对话；快速模型用于生成标题、摘要等轻量任务，可节省费用。"
        >
          <div className="grid grid-cols-2 gap-4">
            <ModelSelect
              label="主模型"
              hint="建议选择通过测试、支持工具调用与结构化输出的模型"
              value={primary}
              options={options}
              onChange={(o) =>
                o && void setRoles({ primary: { providerId: o.providerId, modelId: o.modelId } })
              }
            />
            <ModelSelect
              label="快速模型"
              hint="留空则使用主模型"
              value={fast}
              options={options}
              allowEmpty
              onChange={(o) =>
                void setRoles({ fast: o ? { providerId: o.providerId, modelId: o.modelId } : null })
              }
            />
          </div>
          <ImageModelPanel options={options} />
        </Section>
      )}

      <ProviderDialog
        open={dialog.open}
        editing={dialog.editing}
        onOpenChange={(open) => setDialog((d) => ({ ...d, open }))}
      />
      <Dialog
        open={pendingDelete !== null}
        onOpenChange={(open) => !open && setPendingDelete(null)}
        title={`删除“${pendingDelete?.displayName ?? ''}”？`}
        description="该服务商的配置与本机保存的 API Key 都会被删除。"
        width="max-w-md"
        footer={
          <>
            <Button variant="ghost" onClick={() => setPendingDelete(null)}>
              取消
            </Button>
            <Button variant="danger" onClick={() => void remove()}>
              删除
            </Button>
          </>
        }
      >
        {null}
      </Dialog>
    </div>
  );
}

const apiTemplate = JSON.stringify(
  {
    api: {
      baseUrl: 'https://cms.example.edu',
      searchPath: '/api/books/search',
      queryParam: 'q',
      itemsPath: 'data.items',
      totalPath: 'data.total',
      fieldMap: {
        title: 'title',
        authors: 'author',
        callNumber: 'callNo',
        summary: 'abstract',
        sourceUrl: 'url',
      },
    },
    auth: {
      type: 'oidc',
      issuer: 'https://sso.example.edu',
      clientId: '由学校分配',
      scopes: ['openid', 'library.read'],
      redirect: 'loopback',
    },
  },
  null,
  2,
);

function SchoolSection() {
  const { data: profile, reload } = useRpc('settings.getSchool', undefined);
  const { data: status } = useRpc('campus.status', undefined);
  const [name, setName] = useState('');
  const [portalUrl, setPortalUrl] = useState('');
  const [searchTemplate, setSearchTemplate] = useState('');
  const [advanced, setAdvanced] = useState('');
  const [keyword, setKeyword] = useState('');
  const [saving, setSaving] = useState(false);
  const isAdmin = useRole('superadmin');

  useEffect(() => {
    setName(profile?.name ?? '');
    setPortalUrl(profile?.portalUrl ?? '');
    setSearchTemplate(profile?.searchUrlTemplate ?? '');
    setAdvanced(
      profile?.api || profile?.auth
        ? JSON.stringify({ api: profile.api, auth: profile.auth }, null, 2)
        : '',
    );
  }, [profile]);

  const save = async (): Promise<void> => {
    setSaving(true);
    try {
      let extra: Partial<SchoolProfile> = {};
      if (advanced.trim()) {
        try {
          extra = JSON.parse(advanced) as Partial<SchoolProfile>;
        } catch {
          throw new Error('馆藏接口配置不是合法的 JSON');
        }
      }
      const parsed = schoolProfileSchema.safeParse({
        id: profile?.id ?? newId('school'),
        name: name.trim(),
        portalUrl: portalUrl.trim() || undefined,
        searchUrlTemplate: searchTemplate.trim() || undefined,
        api: extra.api,
        auth: extra.auth,
      });
      if (!parsed.success)
        throw new Error(
          `配置有误：${parsed.error.issues.map((i) => `${i.path.join('.') || '名称'} ${i.message}`).join('；')}`,
        );
      await core.call('settings.setSchool', parsed.data);
      reload();
      toast({ tone: 'success', title: '学校配置已保存' });
    } catch (error) {
      toast({ tone: 'error', title: '保存失败', description: errorText(error).message });
    } finally {
      setSaving(false);
    }
  };

  const openSearch = (): void => {
    if (!searchTemplate.includes('{query}')) return;
    void window.yys.shell.openExternal(
      searchTemplate.replace('{query}', encodeURIComponent(keyword.trim())),
    );
  };

  return (
    <div className="space-y-10">
      <Section
        title="学校与数字图书馆"
        description={`账号密码始终在学校官方页面输入。本应用用系统浏览器打开学校页面，不接触、不保存任何登录信息。${isAdmin ? '' : '学校配置由超级管理员维护。'}`}
      >
        <div className="space-y-4">
          <Field label="学校 / 图书馆名称">
            <Input
              disabled={!isAdmin}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例如：某某大学图书馆"
            />
          </Field>
          <Field label="数字图书馆入口" hint="学校统一身份认证或图书馆内容管理系统的首页地址">
            <Input
              disabled={!isAdmin}
              value={portalUrl}
              onChange={(e) => setPortalUrl(e.target.value)}
              placeholder="https://lib.example.edu"
            />
          </Field>
          <Field
            label="检索页地址模板（可选）"
            hint="把检索结果页 URL 中的关键词替换为 {query}，即可从这里直接跳转检索"
          >
            <Input
              disabled={!isAdmin}
              value={searchTemplate}
              onChange={(e) => setSearchTemplate(e.target.value)}
              placeholder="https://lib.example.edu/search?q={query}"
            />
          </Field>
          <div className="flex flex-wrap items-center gap-2">
            {isAdmin && (
              <Button
                variant="primary"
                loading={saving}
                disabled={!name.trim()}
                onClick={() => void save()}
              >
                保存
              </Button>
            )}
            <Button
              variant="outline"
              disabled={!/^https?:\/\//.test(portalUrl)}
              onClick={() => void window.yys.shell.openExternal(portalUrl)}
            >
              前往学校图书馆登录
            </Button>
          </div>
          {searchTemplate.includes('{query}') && (
            <div className="flex gap-2">
              <Input
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                placeholder="输入关键词，在学校系统中检索"
              />
              <Button variant="outline" disabled={!keyword.trim()} onClick={openSearch}>
                在学校系统中检索
              </Button>
            </div>
          )}
        </div>
      </Section>

      <Section
        title="校园馆藏数据库"
        description="学校自建内容管理系统授权开放检索接口后，登录即可直接获取授权范围内的书目，无需手动导出。"
        action={
          <Badge tone={status?.state === 'connected' ? 'success' : 'neutral'}>
            {status?.state === 'connected' ? '已连接' : '未接入'}
          </Badge>
        }
      >
        <div className="rounded-2xl bg-surface p-4 text-[13px] leading-relaxed text-muted">
          <p className="font-medium text-fg">当前：跳转登录 + 导出导入</p>
          <p className="mt-1">
            在学校系统检索后导出结果，到“书库”中导入。支持
            Excel（.xlsx）、CSV、TXT、JSON，自动识别中文表头与 GBK 编码。
          </p>
          <p className="mt-3 font-medium text-fg">学校授权后：登录直连</p>
          <p className="mt-1">
            按 OIDC / CAS 标准授权（系统浏览器 + PKCE），通过学校提供的 HTTP JSON
            接口检索馆藏。只需在下方填写接口配置，无需修改程序。
          </p>
        </div>
        <Field
          label="馆藏接口配置（学校授权后填写）"
          hint="JSON 格式；fieldMap 把学校字段名映射到本系统字段。保存前会校验格式。"
        >
          <Textarea
            disabled={!isAdmin}
            rows={8}
            value={advanced}
            onChange={(e) => setAdvanced(e.target.value)}
            placeholder={apiTemplate}
            className="font-mono text-xs"
          />
        </Field>
      </Section>
    </div>
  );
}

function AppearanceSection() {
  const [source, setSource] = useState<ThemeSource>(getThemeSource());
  const choices: { key: ThemeSource; label: string; icon: typeof Sun }[] = [
    { key: 'system', label: '跟随系统', icon: Monitor },
    { key: 'light', label: '浅色', icon: Sun },
    { key: 'dark', label: '深色', icon: Moon },
  ];
  return (
    <Section title="外观" description="macOS 与 Windows 使用同一套界面与内置字体。">
      <div className="grid max-w-md grid-cols-3 gap-2">
        {choices.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => (setSource(key), setThemeSource(key))}
            className={cn(
              'flex flex-col items-center gap-2 rounded-2xl border py-4 text-[13px]',
              source === key ? 'border-fg' : 'border-border hover:bg-surface-hover',
            )}
          >
            <Icon className="size-5" />
            {label}
          </button>
        ))}
      </div>
    </Section>
  );
}

function DataSection() {
  const { data: info } = useRpc('app.info', undefined);
  return (
    <div className="space-y-10">
      <Section
        title="数据存储"
        description="书目、对话与配置保存在本机 SQLite 数据库中，可随时备份或删除。"
      >
        <div className="flex items-center gap-3 rounded-2xl border border-border p-4">
          <code className="min-w-0 flex-1 truncate text-xs text-muted">{info?.dataDir ?? '…'}</code>
          <Button size="sm" variant="outline" onClick={() => void window.yys.shell.showDataDir()}>
            打开数据目录
          </Button>
        </div>
      </Section>
      <Section title="数据流向">
        <ul className="list-disc space-y-2 pl-5 text-[13px] leading-relaxed text-muted">
          <li>
            对话内容与完成任务所需的书目字段（书名、作者、索书号、主题词、摘要等）会发送给你选择的模型服务商；请求直接从本机发出，不经过第三方服务器。
          </li>
          <li>不收集、不上传学校账号密码与读者借阅记录。</li>
          <li>对数据外发有严格要求时，可使用 Ollama / LM Studio 本地模型，数据不离开本机。</li>
          <li>示例书库中的索书号与链接为虚构示例，正式活动前需替换为学校真实馆藏。</li>
        </ul>
      </Section>
    </div>
  );
}

function AboutSection() {
  const { data: info } = useRpc('app.info', undefined);
  const rows: [string, string | undefined][] = [
    ['版本', info?.version],
    ['平台', info?.platform],
    ['Node.js', info?.nodeVersion],
    ['SQLite', info?.sqliteVersion],
    [
      '后台服务启动时间',
      info?.coreStartedAt ? new Date(info.coreStartedAt).toLocaleString('zh-CN') : undefined,
    ],
  ];
  return (
    <Section title="一页书展" description="面向高校图书馆阅读推广的 AI 策展与运营智能体。">
      <dl className="divide-y divide-border rounded-2xl border border-border">
        {rows.map(([label, value]) => (
          <div key={label} className="flex justify-between px-4 py-2.5 text-[13px]">
            <dt className="text-muted">{label}</dt>
            <dd className="font-mono text-xs">{value ?? '…'}</dd>
          </div>
        ))}
      </dl>
    </Section>
  );
}

function SavedAccountsSection() {
  const { accounts, forgetAccount, user } = useAuth();
  if (accounts.length === 0) return null;
  return (
    <Section
      title="本机保存的账号"
      description="用于快速登录与切换账号。“记住密码”的账号密码用系统钥匙串加密保存，移除后需重新输入。"
    >
      <ul className="divide-y divide-border rounded-2xl border border-border">
        {accounts.map((a) => (
          <li key={a.username} className="flex items-center gap-3 px-4 py-2.5">
            <span className="min-w-0 flex-1">
              <span className="block text-[13px] font-medium">
                {a.displayName} {a.username === user?.username && <Badge>当前</Badge>}
              </span>
              <span className="block text-xs text-subtle">
                {a.username} · {roleLabels[a.role]} ·{' '}
                {a.rememberPassword ? '已记住密码' : '未记住密码'}
              </span>
            </span>
            <Button size="sm" variant="ghost" onClick={() => void forgetAccount(a.username)}>
              从本机移除
            </Button>
          </li>
        ))}
      </ul>
    </Section>
  );
}

function AccountSection() {
  const { user, setUser, passwordChanged } = useAuth();
  const [profile, setProfile] = useState({
    displayName: user?.displayName ?? '',
    memberNo: user?.memberNo ?? '',
    department: user?.department ?? '',
  });
  const [passwords, setPasswords] = useState({ oldPassword: '', newPassword: '' });
  const [busy, setBusy] = useState<'profile' | 'password' | null>(null);
  if (!user) return null;

  const saveProfile = async (): Promise<void> => {
    const parsed = profileSchema.safeParse(profile);
    if (!parsed.success)
      return void toast({
        tone: 'error',
        title: parsed.error.issues[0]?.message ?? '请检查填写内容',
      });
    setBusy('profile');
    try {
      setUser(await core.call('auth.updateProfile', parsed.data));
      toast({ tone: 'success', title: '资料已保存' });
    } catch (error) {
      toast({ tone: 'error', title: '保存失败', description: errorText(error).message });
    } finally {
      setBusy(null);
    }
  };

  const changePassword = async (): Promise<void> => {
    setBusy('password');
    try {
      const updated = await core.call('auth.changePassword', passwords);
      await passwordChanged(updated, passwords.newPassword);
      setPasswords({ oldPassword: '', newPassword: '' });
      toast({ tone: 'success', title: '密码已修改' });
    } catch (error) {
      toast({ tone: 'error', title: '修改失败', description: errorText(error).message });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-10">
      <Section
        title="账号资料"
        description="姓名、学号/工号与部门会写入策展申请书，供审批人核对。"
        action={<Badge tone="accent">{roleLabels[user.role]}</Badge>}
      >
        <div className="grid grid-cols-3 gap-4">
          <Field label="姓名">
            <Input
              value={profile.displayName}
              onChange={(e) => setProfile((p) => ({ ...p, displayName: e.target.value }))}
            />
          </Field>
          <Field label="学号 / 工号">
            <Input
              value={profile.memberNo}
              onChange={(e) => setProfile((p) => ({ ...p, memberNo: e.target.value }))}
            />
          </Field>
          <Field label="学院 / 部门">
            <Input
              value={profile.department}
              onChange={(e) => setProfile((p) => ({ ...p, department: e.target.value }))}
            />
          </Field>
        </div>
        <div className="flex items-center justify-between">
          <p className="text-xs text-subtle">用户名：{user.username}</p>
          <Button variant="primary" loading={busy === 'profile'} onClick={() => void saveProfile()}>
            保存资料
          </Button>
        </div>
      </Section>
      <Section title="修改密码">
        <div className="grid grid-cols-2 gap-4">
          <Field label="原密码">
            <Input
              type="password"
              autoComplete="current-password"
              value={passwords.oldPassword}
              onChange={(e) => setPasswords((p) => ({ ...p, oldPassword: e.target.value }))}
            />
          </Field>
          <Field label="新密码" hint="至少 8 位">
            <Input
              type="password"
              autoComplete="new-password"
              value={passwords.newPassword}
              onChange={(e) => setPasswords((p) => ({ ...p, newPassword: e.target.value }))}
            />
          </Field>
        </div>
        <div className="flex justify-end">
          <Button
            variant="outline"
            loading={busy === 'password'}
            disabled={!passwords.oldPassword || passwords.newPassword.length < 8}
            onClick={() => void changePassword()}
          >
            修改密码
          </Button>
        </div>
      </Section>
      <SavedAccountsSection />
    </div>
  );
}

export function SettingsView({ section }: { section: SettingsSection }) {
  const navigate = useAppStore((s) => s.navigate);
  const user = useAuth((s) => s.user);
  const visible = sections.filter((s) => user || !s.login);
  const current = visible.some((s) => s.key === section) ? section : 'appearance';
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <TopBar title="设置" />
      <div className="flex min-h-0 flex-1 border-t border-border">
        <nav className="w-52 shrink-0 space-y-0.5 border-r border-border p-2">
          {visible.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => navigate({ name: 'settings', section: key })}
              className={cn(
                'flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-sm',
                current === key ? 'bg-surface-2 font-medium' : 'hover:bg-surface-hover',
              )}
            >
              <Icon className="size-4 text-muted" />
              {label}
            </button>
          ))}
        </nav>
        <div className="min-w-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-3xl px-8 py-8">
            {current === 'account' && <AccountSection />}
            {current === 'models' && <ModelsSection />}
            {current === 'school' && <SchoolSection />}
            {current === 'appearance' && <AppearanceSection />}
            {current === 'data' && <DataSection />}
            {current === 'about' && <AboutSection />}
          </div>
        </div>
      </div>
    </div>
  );
}
