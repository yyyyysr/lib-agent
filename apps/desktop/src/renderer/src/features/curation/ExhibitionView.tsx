import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, Trash2 } from 'lucide-react';
import { currentStep, type AgentTask, type WorkflowStepKey } from '@yys/shared';
import { TopBar } from '../../app/TopBar';
import { StatusBadge, Stepper } from '../../components/workflow';
import { Button, Dialog, EmptyState, IconButton, Spinner } from '../../components/ui';
import { cn } from '../../lib/cn';
import { errorText } from '../../lib/core-client';
import { formatDateTime } from '../../lib/format';
import { useRpc } from '../../lib/use-rpc';
import { useAppStore } from '../../store/app-store';
import { useAgentRuns, type AgentRun } from '../../store/agent-runs';
import { act, useRunner, type StepProps } from './actions';
import { RunProgress } from './RunProgress';
import { ApprovalStep } from './steps/ApprovalStep';
import { BriefStep, CurateStep } from './steps/BriefCurate';
import { PackageStep } from './steps/PackageStep';
import { ProposalStep } from './steps/ProposalStep';
import { PublishStep, RetroStep } from './steps/PublishRetro';
import { ReviewStep } from './steps/ReviewStep';

const taskStep: Record<AgentTask, WorkflowStepKey> = {
  curate: 'curate',
  proposal: 'proposal',
  package: 'package',
  retrospective: 'retro',
};

function SidePanel({
  detail,
  run,
  onCancel,
}: {
  detail: StepProps['detail'];
  run?: AgentRun;
  onCancel: () => void;
}) {
  return (
    <aside className="flex w-[320px] shrink-0 flex-col overflow-y-auto border-l border-border">
      {run && (
        <div className="border-b border-border p-4">
          <p className="mb-3 flex items-center justify-between text-[13px] font-semibold">
            智能体运行
            <span className="text-[11px] font-normal text-subtle">
              {formatDateTime(new Date(run.startedAt).toISOString())}
            </span>
          </p>
          <RunProgress run={run} onCancel={onCancel} />
        </div>
      )}
      <div className="p-4">
        <p className="mb-3 text-[13px] font-semibold">动态</p>
        <ol className="relative space-y-4 border-l border-border pl-4">
          {[...detail.timeline].reverse().map((event) => (
            <li key={event.id} className="relative">
              <span
                className={cn(
                  'absolute top-1.5 -left-[21px] size-2.5 rounded-full border-2 border-bg',
                  event.type === 'review'
                    ? 'bg-accent'
                    : event.type === 'publish'
                      ? 'bg-success'
                      : 'bg-border-strong',
                )}
              />
              <p className="text-[13px] leading-snug">{event.message}</p>
              <p className="mt-0.5 text-[11px] text-subtle">
                {event.actor?.name ? `${event.actor.name} · ` : ''}
                {formatDateTime(event.at)}
              </p>
            </li>
          ))}
        </ol>
      </div>
    </aside>
  );
}

export function ExhibitionView({ id, initialStep }: { id: string; initialStep?: WorkflowStepKey }) {
  const navigate = useAppStore((s) => s.navigate);
  const { data: detail, error } = useRpc(
    'exhibitions.get',
    { id },
    { topics: ['exhibitions.changed', 'approvals.changed'] },
  );
  const run = useAgentRuns((s) => s.runs[id]);
  const cancel = useAgentRuns((s) => s.cancel);
  const [step, setStep] = useState<WorkflowStepKey | null>(initialStep ?? null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const lastStatus = useRef<string | null>(null);
  // 打开页面前就已结束的运行不再触发跳转
  const handledRun = useRef<number | null>(run && run.status !== 'running' ? run.startedAt : null);

  // 状态推进后（例如审批结果返回）发起人自动切换到当前步骤；审批人留在原处查看审批结果
  useEffect(() => {
    if (!detail) return;
    if (detail.can.edit && lastStatus.current !== null && lastStatus.current !== detail.status)
      setStep(currentStep(detail.status));
    if (step === null) setStep(currentStep(detail.status));
    lastStatus.current = detail.status;
  }, [detail, step]);

  // 智能体完成后切换到结果所在步骤；每次运行只切换一次，之后用户可以自由回看
  useEffect(() => {
    if (run?.status !== 'done' || !run.finalStatus || handledRun.current === run.startedAt) return;
    handledRun.current = run.startedAt;
    setStep(currentStep(run.finalStatus));
  }, [run]);

  const onStart = useCallback((task: AgentTask) => setStep(taskStep[task]), []);
  const runTask = useRunner(id, onStart);

  if (error) {
    return (
      <div className="flex flex-1 flex-col">
        <TopBar />
        <EmptyState
          title="无法打开这个书展"
          description={errorText(error).message}
          action={<Button onClick={() => navigate({ name: 'curation' })}>返回策展列表</Button>}
        />
      </div>
    );
  }
  if (!detail || !step) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Spinner />
      </div>
    );
  }

  const busy = detail.running || run?.status === 'running';
  const props: StepProps = {
    detail,
    editable: detail.can.edit && !busy,
    goTo: setStep,
    run: runTask,
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <TopBar
        title={
          <>
            <IconButton
              label="返回策展列表"
              size="sm"
              onClick={() => navigate({ name: 'curation' })}
            >
              <ArrowLeft className="size-4" />
            </IconButton>
            <span className="truncate">{detail.title}</span>
            <StatusBadge status={detail.status} />
            {!detail.can.edit && (
              <span className="text-[13px] font-normal text-muted">· {detail.owner.name} 发起</span>
            )}
          </>
        }
        actions={
          detail.can.delete && (
            <IconButton label="删除书展" onClick={() => setConfirmDelete(true)}>
              <Trash2 className="size-4" />
            </IconButton>
          )
        }
      />
      <div className="border-b border-border">
        <Stepper status={detail.status} active={step} onSelect={setStep} />
      </div>
      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-[860px] px-8 py-6">
            {step === 'brief' && <BriefStep {...props} />}
            {step === 'curate' && <CurateStep {...props} />}
            {step === 'review' && <ReviewStep {...props} />}
            {step === 'proposal' && <ProposalStep {...props} />}
            {step === 'approval1' && <ApprovalStep {...props} kind="proposal" />}
            {step === 'package' && <PackageStep {...props} />}
            {step === 'approval2' && <ApprovalStep {...props} kind="package" />}
            {step === 'publish' && <PublishStep {...props} />}
            {step === 'retro' && <RetroStep {...props} />}
          </div>
        </div>
        <SidePanel detail={detail} run={run} onCancel={() => cancel(id)} />
      </div>

      <Dialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="删除这个书展？"
        description="方案、申请书、审批记录与反馈都会被删除，此操作无法撤销。"
        width="max-w-md"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmDelete(false)}>
              取消
            </Button>
            <Button
              variant="danger"
              onClick={async () => {
                setConfirmDelete(false);
                if ((await act('exhibitions.delete', { id }, '已删除')) !== null)
                  navigate({ name: 'curation' });
              }}
            >
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
