import { useEffect, useState } from 'react';
import { HardDrive, Server, ShieldAlert, ShieldCheck } from 'lucide-react';
import type { ServerProbe } from '@yys/shared';
import { Button, Dialog, Field, Input } from '../../components/ui';
import { cn } from '../../lib/cn';
import { useAppStore } from '../../store/app-store';

const groupFingerprint = (hex: string): string =>
  hex.toUpperCase().match(/.{2}/g)?.join(':') ?? hex;

const errorMessage = (error: unknown): string =>
  (error instanceof Error ? error.message : String(error)).replace(
    /^Error invoking remote method '[^']+': (Error: )?/,
    '',
  );

/** 选择后台服务：本机，或团队服务器（首次连接需核对证书指纹） */
export function ConnectionDialog() {
  const open = useAppStore((s) => s.connectionDialog);
  const setOpen = useAppStore((s) => s.setConnectionDialog);
  const current = window.yys.connection.current;
  const [mode, setMode] = useState<'local' | 'server'>(current.mode);
  const [url, setUrl] = useState(current.url ?? '');
  const [probe, setProbe] = useState<ServerProbe | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'probe' | 'use' | null>(null);

  useEffect(() => {
    if (!open) return;
    setMode(current.mode);
    setUrl(current.url ?? '');
    setProbe(null);
    setError(null);
  }, [open, current.mode, current.url]);

  const test = async (): Promise<void> => {
    setBusy('probe');
    setError(null);
    setProbe(null);
    try {
      setProbe(await window.yys.connection.probe(url));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const apply = async (): Promise<void> => {
    setBusy('use');
    setError(null);
    try {
      await window.yys.connection.use(
        mode === 'local'
          ? { mode: 'local' }
          : { mode: 'server', url: probe!.url, fingerprint: probe!.fingerprint, name: probe!.name },
      );
    } catch (err) {
      setError(errorMessage(err));
      setBusy(null);
    }
  };

  const options = [
    {
      key: 'local' as const,
      icon: HardDrive,
      title: '本机',
      text: '数据只保存在这台电脑上，离线也能使用',
    },
    {
      key: 'server' as const,
      icon: Server,
      title: '团队服务器',
      text: '多台电脑共用一份书展、审批与书库数据',
    },
  ];
  const unchanged = mode === 'local' && current.mode === 'local';

  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      width="max-w-lg"
      title="连接设置"
      description="切换后应用会重新加载，需要在新的位置重新登录；两边的数据互不影响。"
      footer={
        <>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            取消
          </Button>
          {mode === 'server' ? (
            <Button
              variant="primary"
              disabled={!probe}
              loading={busy === 'use'}
              onClick={() => void apply()}
            >
              信任并连接
            </Button>
          ) : (
            <Button
              variant="primary"
              disabled={unchanged}
              loading={busy === 'use'}
              onClick={() => void apply()}
            >
              切换到本机
            </Button>
          )}
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="后台服务位置">
          {options.map(({ key, icon: Icon, title, text }) => (
            <button
              key={key}
              type="button"
              role="radio"
              aria-checked={mode === key}
              onClick={() => {
                setMode(key);
                setError(null);
              }}
              className={cn(
                'rounded-xl border p-3 text-left transition-colors',
                mode === key
                  ? 'border-accent bg-accent-soft'
                  : 'border-border hover:bg-surface-hover',
              )}
            >
              <span className="flex items-center gap-2 text-[13px] font-medium">
                <Icon className="size-4" /> {title}
                {current.mode === key && <span className="text-xs text-subtle">（当前）</span>}
              </span>
              <span className="mt-1 block text-xs text-muted">{text}</span>
            </button>
          ))}
        </div>

        {mode === 'server' && (
          <>
            <Field label="服务器地址" hint="由服务器管理员提供，如 https://203.0.113.10">
              <div className="flex gap-2">
                <Input
                  value={url}
                  onChange={(e) => {
                    setUrl(e.target.value);
                    setProbe(null);
                  }}
                  placeholder="https://"
                  onKeyDown={(e) => e.key === 'Enter' && url.trim() && void test()}
                />
                <Button
                  variant="outline"
                  disabled={!url.trim()}
                  loading={busy === 'probe'}
                  onClick={() => void test()}
                >
                  测试连接
                </Button>
              </div>
            </Field>
            {probe && (
              <div className="space-y-2 rounded-xl border border-border p-3 text-[13px]">
                <p className="flex items-center gap-2 font-medium">
                  <ShieldCheck className="size-4 text-success" /> {probe.name}
                  <span className="text-xs font-normal text-subtle">版本 {probe.version}</span>
                </p>
                <div>
                  <p className="text-xs text-subtle">证书指纹（SHA-256）</p>
                  <p
                    data-selectable
                    className="mt-0.5 font-mono text-[11px] leading-relaxed break-all"
                  >
                    {groupFingerprint(probe.fingerprint)}
                  </p>
                </div>
                <p className="flex items-start gap-1.5 text-xs text-warning">
                  <ShieldAlert className="mt-0.5 size-3.5 shrink-0" />
                  请与服务器管理员提供的指纹核对，一致后再连接。确认后只信任这张证书，可防止有人冒充服务器。
                </p>
              </div>
            )}
          </>
        )}
        {error && (
          <p className="rounded-lg bg-danger-soft px-3 py-2 text-[13px] text-danger">{error}</p>
        )}
      </div>
    </Dialog>
  );
}
