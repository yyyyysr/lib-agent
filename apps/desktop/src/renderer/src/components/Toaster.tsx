import { CheckCircle2, Info, X, XCircle } from 'lucide-react';
import { useToasts } from '../store/app-store';
import { cn } from '../lib/cn';

const icons = { info: Info, success: CheckCircle2, error: XCircle };

export function Toaster() {
  const { toasts, dismiss } = useToasts();
  return (
    <div className="pointer-events-none fixed right-5 bottom-5 z-[60] flex w-80 flex-col gap-2">
      {toasts.map((t) => {
        const Icon = icons[t.tone];
        return (
          <div key={t.id} className="pointer-events-auto flex gap-3 rounded-xl border border-border bg-bg p-3.5 shadow-xl">
            <Icon className={cn('mt-0.5 size-4 shrink-0', t.tone === 'error' ? 'text-danger' : t.tone === 'success' ? 'text-success' : 'text-muted')} />
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-medium">{t.title}</p>
              {t.description && <p className="mt-0.5 text-xs leading-relaxed text-muted">{t.description}</p>}
            </div>
            <button aria-label="关闭" onClick={() => dismiss(t.id)} className="text-subtle hover:text-fg">
              <X className="size-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
