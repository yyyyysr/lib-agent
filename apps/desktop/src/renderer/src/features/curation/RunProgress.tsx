import { CheckCircle2, Circle, Loader2, Square, XCircle } from 'lucide-react';
import { Button } from '../../components/ui';
import { cn } from '../../lib/cn';
import { durationText } from '../../lib/format';
import type { AgentRun } from '../../store/agent-runs';

export function RunProgress({
  run,
  onCancel,
  onRetry,
}: {
  run: AgentRun;
  onCancel?: () => void;
  onRetry?: () => void;
}) {
  return (
    <div className="space-y-3">
      <ol className="space-y-2">
        {run.stages.map((stage) => (
          <li key={stage.stage} className="flex items-start gap-2.5">
            {stage.status === 'running' ? (
              <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin text-accent" />
            ) : stage.status === 'done' ? (
              <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" />
            ) : stage.status === 'failed' ? (
              <XCircle className="mt-0.5 size-4 shrink-0 text-danger" />
            ) : (
              <Circle className="mt-0.5 size-4 shrink-0 text-subtle" />
            )}
            <div className="min-w-0 flex-1">
              <p className={cn('text-[13px]', stage.status === 'running' && 'text-shimmer')}>
                {stage.label}
              </p>
              {stage.detail && <p className="text-xs text-muted">{stage.detail}</p>}
            </div>
            {stage.endedAt && (
              <span className="text-[11px] text-subtle">
                {durationText(stage.endedAt - stage.startedAt)}
              </span>
            )}
          </li>
        ))}
        {run.status === 'running' && run.stages.length === 0 && (
          <li className="flex items-center gap-2.5 text-[13px] text-muted">
            <Loader2 className="size-4 animate-spin text-accent" /> 正在准备…
          </li>
        )}
      </ol>
      {run.logs.map((log, i) => (
        <p key={i} className="rounded-lg bg-surface px-2.5 py-1.5 text-xs text-muted">
          {log}
        </p>
      ))}
      {run.error && (
        <div className="rounded-xl bg-danger-soft p-3">
          <p className="text-[13px] text-danger">{run.error.message}</p>
          {run.error.hint && <p className="mt-0.5 text-xs text-muted">{run.error.hint}</p>}
        </div>
      )}
      <div className="flex gap-2">
        {run.status === 'running' && onCancel && (
          <Button size="sm" variant="outline" onClick={onCancel}>
            <Square className="size-3 fill-current" /> 停止
          </Button>
        )}
        {(run.status === 'failed' || run.status === 'cancelled') && onRetry && (
          <Button size="sm" variant="primary" onClick={onRetry}>
            重试
          </Button>
        )}
      </div>
    </div>
  );
}
