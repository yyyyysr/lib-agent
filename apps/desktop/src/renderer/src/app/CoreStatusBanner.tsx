import { AlertTriangle, Loader2 } from 'lucide-react';
import { useAppStore } from '../store/app-store';

export function CoreStatusBanner() {
  const status = useAppStore((s) => s.coreStatus);
  if (status.state === 'ready') return null;
  if (status.state === 'starting') {
    return (
      <div className="flex items-center justify-center gap-2 bg-surface px-4 py-1.5 text-xs text-muted">
        <Loader2 className="size-3.5 animate-spin" /> {status.message ?? '正在启动后台服务…'}
      </div>
    );
  }
  if (status.state === 'restarting') {
    return (
      <div className="flex items-center justify-center gap-2 bg-warning-soft px-4 py-1.5 text-xs text-warning">
        <Loader2 className="size-3.5 animate-spin" /> {status.reason}，正在自动恢复（第{' '}
        {status.attempt} 次）…
      </div>
    );
  }
  return (
    <div className="flex items-center justify-center gap-2 bg-danger-soft px-4 py-1.5 text-xs text-danger">
      <AlertTriangle className="size-3.5" /> {status.reason}
    </div>
  );
}
