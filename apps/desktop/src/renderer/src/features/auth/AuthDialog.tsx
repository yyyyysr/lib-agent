import { useEffect, useState, type FormEvent } from 'react';
import { ShieldCheck } from 'lucide-react';
import { registerInputSchema } from '@yys/shared';
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

export function AuthDialog() {
  const { prompt, closePrompt, openPrompt, signIn } = useAuth();
  /** null：正在确认本机是否已有账号，期间不渲染表单，避免标题在“登录”与“初始化”之间闪动 */
  const [needsSetup, setNeedsSetup] = useState<boolean | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const mode = needsSetup ? 'register' : prompt.mode;

  useEffect(() => {
    if (!prompt.open) return;
    setError(null);
    setForm(emptyForm);
    setNeedsSetup(null);
    void core
      .call('auth.status')
      .then((s) => setNeedsSetup(s.needsSetup))
      .catch(() => setNeedsSetup(false));
  }, [prompt.open]);

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
      signIn(result);
      toast({
        tone: 'success',
        title:
          mode === 'login'
            ? `欢迎回来，${result.user.displayName}`
            : needsSetup
              ? '已创建超级管理员账号'
              : '注册成功',
      });
    } catch (err) {
      setError(errorText(err).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={prompt.open}
      onOpenChange={(open) => !open && closePrompt()}
      width="max-w-md"
      title={
        needsSetup === null
          ? '一页书展'
          : needsSetup
            ? '初始化：创建超级管理员'
            : mode === 'login'
              ? '登录一页书展'
              : '注册账号'
      }
      description={
        needsSetup === null
          ? undefined
          : needsSetup
            ? '这是本机的第一个账号，将成为超级管理员，负责管理用户权限与全局数据。'
            : mode === 'login'
              ? '使用本机注册的账号登录。'
              : '注册后为普通用户，可浏览书展并发起策展；审批权限由超级管理员分配。'
      }
    >
      {needsSetup === null ? (
        <Spinner className="mx-auto my-8" />
      ) : (
        <form onSubmit={(e) => void submit(e)} className="space-y-3.5">
          {needsSetup && (
            <div className="flex items-center gap-2 rounded-xl bg-accent-soft px-3 py-2.5 text-[13px] text-accent">
              <ShieldCheck className="size-4" /> 请妥善保管超级管理员密码
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
          {error && (
            <p className="rounded-lg bg-danger-soft px-3 py-2 text-[13px] text-danger">{error}</p>
          )}
          <Button type="submit" variant="primary" size="lg" className="w-full" loading={busy}>
            {mode === 'login' ? '登录' : needsSetup ? '创建并登录' : '注册并登录'}
          </Button>
          {!needsSetup && (
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
          )}
        </form>
      )}
    </Dialog>
  );
}
