import { useEffect, useState, type FormEvent } from 'react';
import { KeyRound, ShieldCheck, X } from 'lucide-react';
import { registerInputSchema, roleLabels, type AuthStatus } from '@yys/shared';
import { Button, Dialog, Field, Input, Spinner } from '../../components/ui';
import { core, errorText } from '../../lib/core-client';
import { toast } from '../../store/app-store';
import { useAuth } from '../../store/auth-store';

const emptyForm = {
  username: '',
  password: '',
  confirm: '',
  displayName: '',
  memberNo: '',
  department: '',
};

function SavedAccounts({ onPick }: { onPick: (username: string) => void }) {
  const { accounts, quickLogin, forgetAccount } = useAuth();
  const [busy, setBusy] = useState<string | null>(null);
  if (accounts.length === 0) return null;
  return (
    <div>
      <p className="mb-1.5 text-xs font-medium text-subtle">本机账号</p>
      <ul className="space-y-1">
        {accounts.map((a) => (
          <li
            key={a.username}
            className="group flex items-center gap-2.5 rounded-xl border border-border px-3 py-2"
          >
            <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-surface-2 text-[13px] font-semibold">
              {a.displayName.slice(0, 1)}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-medium">{a.displayName}</span>
              <span className="block truncate text-[11px] text-subtle">
                {a.username} · {roleLabels[a.role]}
                {a.rememberPassword && ' · 已记住密码'}
              </span>
            </span>
            <Button
              type="button"
              size="sm"
              variant={a.rememberPassword ? 'primary' : 'outline'}
              loading={busy === a.username}
              disabled={busy !== null}
              aria-label={`以 ${a.displayName} 登录`}
              onClick={async () => {
                if (!a.rememberPassword) return onPick(a.username);
                setBusy(a.username);
                await quickLogin(a.username);
                setBusy(null);
              }}
            >
              {a.rememberPassword ? '一键登录' : '输入密码'}
            </Button>
            <button
              type="button"
              aria-label={`从本机移除 ${a.displayName}`}
              onClick={() => void forgetAccount(a.username)}
              className="text-subtle opacity-0 group-hover:opacity-100 hover:text-fg"
            >
              <X className="size-3.5" />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function AuthDialog() {
  const { prompt, closePrompt, openPrompt, signIn, accounts } = useAuth();
  const [status, setStatus] = useState<AuthStatus | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [remember, setRemember] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const mode = prompt.mode;

  useEffect(() => {
    if (!prompt.open) return;
    setError(null);
    setForm({ ...emptyForm, username: prompt.username ?? '' });
    setRemember(
      Boolean(
        prompt.username && accounts.find((a) => a.username === prompt.username)?.rememberPassword,
      ),
    );
    setStatus(null);
    void core
      .call('auth.status')
      .then(setStatus)
      .catch(() => setStatus({ builtinAdmin: { username: '' } }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prompt.open, prompt.username]);

  const set = (key: keyof typeof emptyForm) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setError(null);
    if (mode === 'register') {
      if (form.password !== form.confirm) return setError('两次输入的密码不一致');
      const parsed = registerInputSchema.safeParse(form);
      if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? '请检查填写内容');
    }
    setBusy(true);
    try {
      const result =
        mode === 'login'
          ? await core.call('auth.login', { username: form.username, password: form.password })
          : await core.call('auth.register', {
              username: form.username,
              password: form.password,
              displayName: form.displayName,
              memberNo: form.memberNo,
              department: form.department,
            });
      await signIn(result, { password: form.password, remember });
      toast({
        tone: 'success',
        title: mode === 'login' ? `欢迎回来，${result.user.displayName}` : '注册成功',
      });
    } catch (err) {
      setError(errorText(err).message);
    } finally {
      setBusy(false);
    }
  };

  const admin = status?.builtinAdmin;

  return (
    <Dialog
      open={prompt.open}
      onOpenChange={(open) => !open && closePrompt()}
      width="max-w-md"
      title={mode === 'login' ? '登录一页书展' : '注册账号'}
      description={
        mode === 'login'
          ? '选择本机账号快速登录，或输入用户名和密码。'
          : '注册后为普通用户，可浏览书展并发起策展；审批权限由超级管理员分配。'
      }
    >
      {!status ? (
        <Spinner className="mx-auto my-8" />
      ) : (
        <form onSubmit={(e) => void submit(e)} className="space-y-3.5">
          {mode === 'login' && (
            <SavedAccounts
              onPick={(username) => setForm((f) => ({ ...f, username, password: '' }))}
            />
          )}
          {mode === 'login' && admin?.defaultPassword && (
            <div className="flex items-start gap-2.5 rounded-xl bg-accent-soft px-3 py-2.5 text-[13px]">
              <ShieldCheck className="mt-0.5 size-4 shrink-0 text-accent" />
              <div className="flex-1">
                <p className="text-accent">
                  超级管理员：<span className="font-mono">{admin.username}</span>，初始密码{' '}
                  <span className="font-mono">{admin.defaultPassword}</span>
                </p>
                <p className="text-xs text-muted">
                  首次登录后请在“账号与资料”中修改密码，修改后此提示不再显示。
                </p>
              </div>
              <button
                type="button"
                className="text-xs text-accent hover:underline"
                onClick={() =>
                  setForm((f) => ({
                    ...f,
                    username: admin.username,
                    password: admin.defaultPassword!,
                  }))
                }
              >
                填入
              </button>
            </div>
          )}
          <Field label="用户名">
            <Input
              autoFocus
              autoComplete="username"
              value={form.username}
              onChange={set('username')}
              placeholder="字母、数字、下划线"
            />
          </Field>
          <Field label="密码" hint={mode === 'register' ? '至少 8 位' : undefined}>
            <Input
              type="password"
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              value={form.password}
              onChange={set('password')}
            />
          </Field>
          {mode === 'register' && (
            <>
              <Field label="确认密码">
                <Input
                  type="password"
                  autoComplete="new-password"
                  value={form.confirm}
                  onChange={set('confirm')}
                />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="姓名">
                  <Input value={form.displayName} onChange={set('displayName')} />
                </Field>
                <Field label="学号 / 工号">
                  <Input value={form.memberNo} onChange={set('memberNo')} />
                </Field>
              </div>
              <Field label="学院 / 部门（可选）" hint="姓名、学号/工号与部门会写入策展申请书">
                <Input value={form.department} onChange={set('department')} />
              </Field>
            </>
          )}
          <label className="flex items-start gap-2 text-[13px]">
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
              className="mt-0.5 accent-(--accent)"
            />
            <span>
              记住密码
              <span className="flex items-center gap-1 text-xs text-subtle">
                <KeyRound className="size-3" />{' '}
                用系统钥匙串加密保存在本机，可一键登录和切换账号；共用电脑请勿勾选
              </span>
            </span>
          </label>
          {error && (
            <p className="rounded-lg bg-danger-soft px-3 py-2 text-[13px] text-danger">{error}</p>
          )}
          <Button type="submit" variant="primary" size="lg" className="w-full" loading={busy}>
            {mode === 'login' ? '登录' : '注册并登录'}
          </Button>
          <p className="text-center text-[13px] text-muted">
            {mode === 'login' ? '还没有账号？' : '已有账号？'}
            <button
              type="button"
              className="ml-1 text-accent hover:underline"
              onClick={() => openPrompt(mode === 'login' ? 'register' : 'login')}
            >
              {mode === 'login' ? '注册' : '登录'}
            </button>
          </p>
        </form>
      )}
    </Dialog>
  );
}
