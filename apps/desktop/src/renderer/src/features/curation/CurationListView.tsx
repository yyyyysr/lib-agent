import { useState } from 'react';
import { Plus, Sparkles } from 'lucide-react';
import { currentStep, stepIndex, workflowSteps } from '@yys/shared';
import { TopBar } from '../../app/TopBar';
import { StatusBadge } from '../../components/workflow';
import { Button, Dialog, EmptyState, Spinner } from '../../components/ui';
import { cn } from '../../lib/cn';
import { core, errorText } from '../../lib/core-client';
import { formatDate, formatDateTime } from '../../lib/format';
import { useRpc } from '../../lib/use-rpc';
import { toast, useAppStore } from '../../store/app-store';
import { useAgentRuns } from '../../store/agent-runs';
import { useRole } from '../../store/auth-store';
import { BriefForm } from './BriefForm';

export function CurationListView() {
  const navigate = useAppStore((s) => s.navigate);
  const isApprover = useRole('approver');
  const [scope, setScope] = useState<'mine' | 'all'>('mine');
  const [creating, setCreating] = useState(false);
  const startRun = useAgentRuns((s) => s.start);
  const { data = [], loading } = useRpc(
    'exhibitions.list',
    { scope },
    { topics: ['exhibitions.changed'] },
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <TopBar
        title="策展"
        actions={
          <Button variant="primary" size="sm" onClick={() => setCreating(true)}>
            <Plus className="size-3.5" /> 发起策展
          </Button>
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[960px] px-8 pt-2 pb-10">
          {isApprover && (
            <div className="mb-4 flex gap-1">
              {(['mine', 'all'] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => setScope(s)}
                  className={cn(
                    'h-8 rounded-lg px-3 text-[13px]',
                    scope === s ? 'bg-surface-2 font-medium' : 'text-muted hover:bg-surface-hover',
                  )}
                >
                  {s === 'mine' ? '我发起的' : '全部书展'}
                </button>
              ))}
            </div>
          )}
          {loading && data.length === 0 ? (
            <Spinner className="mx-auto mt-10" />
          ) : data.length === 0 ? (
            <div className="mt-6 rounded-3xl border border-dashed border-border-strong">
              <EmptyState
                icon={<Sparkles className="size-8" />}
                title="还没有策展任务"
                description="填写主题、目标读者、活动时间与场地，智能体会从书库中选书、规划展区、撰写导读与活动材料，并列出需要你核对的内容。"
                action={
                  <Button variant="primary" onClick={() => setCreating(true)}>
                    发起第一场策展
                  </Button>
                }
              />
            </div>
          ) : (
            <div className="space-y-2">
              {data.map((e) => {
                const progress =
                  stepIndex(currentStep(e.status)) + (e.status === 'completed' ? 1 : 0);
                return (
                  <button
                    key={e.id}
                    onClick={() => navigate({ name: 'exhibition', id: e.id })}
                    className="w-full rounded-2xl border border-border p-4 text-left transition-colors hover:bg-surface-hover"
                  >
                    <div className="flex items-center gap-2">
                      <span className="flex-1 truncate font-medium">{e.title}</span>
                      <StatusBadge status={e.status} />
                    </div>
                    <p className="mt-1 text-xs text-muted">
                      {scope === 'all' && `${e.owner.name} · `}
                      {e.eventDate ? `活动 ${formatDate(e.eventDate)} · ` : ''}更新于{' '}
                      {formatDateTime(e.updatedAt)}
                    </p>
                    <div className="mt-3 flex gap-1">
                      {workflowSteps.map((step, i) => (
                        <span
                          key={step.key}
                          title={step.label}
                          className={cn(
                            'h-1 flex-1 rounded-full',
                            i < progress ? 'bg-accent' : 'bg-surface-2',
                          )}
                        />
                      ))}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <Dialog
        open={creating}
        onOpenChange={setCreating}
        title="发起策展"
        description="填写活动需求。提交后智能体会立即开始策展，你可以在工作台中查看每一步的进度。"
        width="max-w-3xl"
      >
        <BriefForm
          submitLabel="创建并开始策展"
          onSubmit={async (brief) => {
            try {
              const created = await core.call('exhibitions.create', brief);
              setCreating(false);
              navigate({ name: 'exhibition', id: created.id, step: 'curate' });
              void startRun(created.id, 'curate');
            } catch (error) {
              toast({ tone: 'error', title: '创建失败', description: errorText(error).message });
            }
          }}
        />
      </Dialog>
    </div>
  );
}
