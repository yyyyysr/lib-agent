import { useEffect, useState, type ReactNode } from 'react';
import { Check, Pencil, Sparkles, X } from 'lucide-react';
import {
  currentStep,
  statusLabels,
  stepIndex,
  workflowSteps,
  type ExhibitionStatus,
  type WorkflowStepKey,
} from '@yys/shared';
import { cn } from '../lib/cn';
import { Badge, Button, Input, Textarea } from './ui';

const statusTone: Record<
  ExhibitionStatus,
  'neutral' | 'accent' | 'warning' | 'danger' | 'success'
> = {
  draft: 'neutral',
  curating: 'accent',
  reviewing: 'warning',
  proposal_draft: 'warning',
  proposal_pending: 'accent',
  proposal_changes: 'danger',
  proposal_approved: 'success',
  package_draft: 'warning',
  package_pending: 'accent',
  package_changes: 'danger',
  published: 'success',
  completed: 'success',
};

export function StatusBadge({ status }: { status: ExhibitionStatus }) {
  return <Badge tone={statusTone[status]}>{statusLabels[status]}</Badge>;
}

/** 九步工作流：已完成的步骤可点击回看，当前步骤高亮 */
export function Stepper({
  status,
  active,
  onSelect,
}: {
  status: ExhibitionStatus;
  active: WorkflowStepKey;
  onSelect: (key: WorkflowStepKey) => void;
}) {
  const current = stepIndex(currentStep(status));
  return (
    <ol className="flex items-center gap-1 overflow-x-auto px-6 py-3">
      {workflowSteps.map((step, i) => {
        const done = i < current || status === 'completed';
        const isCurrent = i === current && status !== 'completed';
        // 上线后即可进入复盘：复盘是上线之后的下一步，不需要再等状态推进
        const reachable = i <= current || (status === 'published' && step.key === 'retro');
        return (
          <li key={step.key} className="flex shrink-0 items-center gap-1">
            <button
              disabled={!reachable}
              onClick={() => onSelect(step.key)}
              className={cn(
                'flex h-8 items-center gap-1.5 rounded-full px-2.5 text-[13px] disabled:cursor-not-allowed',
                active === step.key
                  ? 'bg-fg text-bg'
                  : reachable
                    ? 'hover:bg-surface-hover'
                    : 'text-subtle',
              )}
            >
              <span
                className={cn(
                  'flex size-5 items-center justify-center rounded-full text-[11px] font-semibold',
                  active === step.key
                    ? 'bg-bg text-fg'
                    : done
                      ? 'bg-accent text-accent-fg'
                      : isCurrent
                        ? 'border-2 border-accent text-accent'
                        : 'border border-border-strong',
                )}
              >
                {done ? <Check className="size-3" strokeWidth={3} /> : i + 1}
              </span>
              {step.label}
            </button>
            {i < workflowSteps.length - 1 && (
              <span className={cn('h-px w-4', i < current ? 'bg-accent' : 'bg-border-strong')} />
            )}
          </li>
        );
      })}
    </ol>
  );
}

export function Panel({
  title,
  description,
  actions,
  children,
  className,
}: {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn('rounded-2xl border border-border p-5', className)}>
      {(title || actions) && (
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            {title && <h3 className="text-[15px] font-semibold">{title}</h3>}
            {description && <p className="mt-0.5 text-[13px] text-muted">{description}</p>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-1.5">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

/**
 * 可就地编辑的文字：直接修改，或交给智能体按要求改写。
 * readOnly 时只展示。
 */
export function EditableText({
  value,
  onSave,
  onRewrite,
  readOnly,
  multiline = true,
  placeholder = '（空）',
  className,
}: {
  value: string;
  onSave: (value: string) => Promise<void>;
  onRewrite?: (instruction: string) => Promise<void>;
  readOnly?: boolean;
  multiline?: boolean;
  placeholder?: string;
  className?: string;
}) {
  const [mode, setMode] = useState<'view' | 'edit' | 'rewrite'>('view');
  const [draft, setDraft] = useState(value);
  const [instruction, setInstruction] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => setDraft(value), [value]);

  const run = async (work: () => Promise<void>): Promise<void> => {
    setBusy(true);
    try {
      await work();
      setMode('view');
      setInstruction('');
    } finally {
      setBusy(false);
    }
  };

  if (mode === 'edit') {
    return (
      <div className="space-y-2">
        {multiline ? (
          <Textarea
            autoFocus
            rows={Math.min(10, Math.max(3, Math.ceil(draft.length / 40)))}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
        ) : (
          <Input autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} />
        )}
        <div className="flex justify-end gap-1.5">
          <Button size="sm" variant="ghost" onClick={() => (setDraft(value), setMode('view'))}>
            取消
          </Button>
          <Button
            size="sm"
            variant="primary"
            loading={busy}
            onClick={() => void run(() => onSave(draft.trim()))}
          >
            保存
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className={cn('group relative', className)}>
      <p
        data-selectable
        className={cn('text-[14px] leading-relaxed whitespace-pre-wrap', !value && 'text-subtle')}
      >
        {value || placeholder}
      </p>
      {mode === 'rewrite' && (
        <div className="mt-2 flex gap-1.5">
          <Input
            autoFocus
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            onKeyDown={(e) =>
              e.key === 'Enter' &&
              !e.nativeEvent.isComposing &&
              instruction.trim() &&
              void run(() => onRewrite!(instruction.trim()))
            }
            placeholder="告诉智能体怎么改，例如：更口语化、控制在 80 字以内"
            className="h-8"
          />
          <Button
            size="sm"
            variant="primary"
            loading={busy}
            disabled={!instruction.trim()}
            onClick={() => void run(() => onRewrite!(instruction.trim()))}
          >
            改写
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setMode('view')}>
            <X className="size-3.5" />
          </Button>
        </div>
      )}
      {!readOnly && mode === 'view' && (
        <div className="absolute -top-1 right-0 flex gap-0.5 rounded-lg bg-bg opacity-0 shadow-sm group-hover:opacity-100">
          <button
            aria-label="编辑"
            onClick={() => setMode('edit')}
            className="flex h-7 items-center gap-1 rounded-md px-2 text-xs text-muted hover:bg-surface-hover hover:text-fg"
          >
            <Pencil className="size-3" /> 编辑
          </button>
          {onRewrite && (
            <button
              aria-label="AI 改写"
              onClick={() => setMode('rewrite')}
              className="flex h-7 items-center gap-1 rounded-md px-2 text-xs text-muted hover:bg-surface-hover hover:text-fg"
            >
              <Sparkles className="size-3" /> AI 改写
            </button>
          )}
        </div>
      )}
    </div>
  );
}
