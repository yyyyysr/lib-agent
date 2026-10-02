import { BookOpen, LayoutGrid, ListChecks, Sparkles } from 'lucide-react';
import { isEditable } from '@yys/shared';
import { Panel } from '../../../components/workflow';
import { Button, EmptyState } from '../../../components/ui';
import { formatDateTime } from '../../../lib/format';
import { useAgentRuns } from '../../../store/agent-runs';
import { act, type StepProps } from '../actions';
import { BriefForm } from '../BriefForm';
import { RunProgress } from '../RunProgress';

export function BriefStep({ detail, editable, run }: StepProps) {
  const canEdit = editable && isEditable('brief', detail.status);
  return (
    <Panel
      title="策展需求"
      description={
        canEdit
          ? detail.plan
            ? '修改需求后重新策展，智能体会生成新的方案并替换当前方案。'
            : '填写完成后，智能体会依次完成选书、展区编排、导读与活动材料撰写，并列出需要你核对的内容。'
          : '方案已进入审批流程，需求不可修改。'
      }
    >
      <BriefForm
        initial={detail.brief}
        readOnly={!canEdit}
        submitLabel={detail.plan ? '保存并重新策展' : '保存并开始策展'}
        onSubmit={async (brief) => {
          if ((await act('exhibitions.updateBrief', { id: detail.id, brief })) !== null)
            run('curate');
        }}
      />
    </Panel>
  );
}

export function CurateStep({ detail, editable, goTo, run }: StepProps) {
  const agentRun = useAgentRuns((s) => s.runs[detail.id]);
  const cancel = useAgentRuns((s) => s.cancel);
  const curateRun = agentRun?.task === 'curate' ? agentRun : undefined;
  const plan = detail.plan;

  if (curateRun && curateRun.status !== 'done') {
    return (
      <Panel
        title="智能体策展中"
        description="依次完成：整理候选馆藏 → 筛选书目 → 规划展览结构 → 撰写导读与活动材料 → 检查来源、字段与表述。"
      >
        <RunProgress
          run={curateRun}
          onCancel={() => cancel(detail.id)}
          onRetry={editable ? () => run('curate') : undefined}
        />
      </Panel>
    );
  }

  if (!plan) {
    return (
      <EmptyState
        icon={<Sparkles className="size-8" />}
        title={detail.status === 'curating' ? '上次策展没有完成' : '还没有开始策展'}
        description="确认需求后，智能体会从书库中挑选适合目标读者与主题的书目。"
        action={
          editable && (
            <Button variant="primary" onClick={() => run('curate')}>
              开始策展
            </Button>
          )
        }
      />
    );
  }

  const blockers = detail.checks.filter(
    (c) => c.severity === 'blocker' && c.status === 'open',
  ).length;
  const open = detail.checks.filter((c) => c.status === 'open').length;
  return (
    <div className="space-y-4">
      <Panel
        title="策展结果"
        description={`${formatDateTime(plan.generatedAt)} · ${plan.model}`}
        actions={
          editable && (
            <Button size="sm" variant="outline" onClick={() => run('curate')}>
              重新策展
            </Button>
          )
        }
      >
        <div className="grid grid-cols-3 gap-3">
          {[
            {
              icon: BookOpen,
              label: '入选书目',
              value: `${plan.books.length} 本`,
              sub: `从 ${plan.candidateCount} 本候选中筛选`,
            },
            {
              icon: LayoutGrid,
              label: '展区',
              value: `${plan.sections.length} 个`,
              sub: plan.sections.map((s) => s.title).join('、'),
            },
            {
              icon: ListChecks,
              label: '待核对',
              value: `${open} 项`,
              sub: blockers ? `${blockers} 项必须处理` : '无必须处理项',
            },
          ].map(({ icon: Icon, label, value, sub }) => (
            <div key={label} className="rounded-xl bg-surface p-3.5">
              <Icon className="size-4 text-accent" />
              <p className="mt-2 text-lg font-semibold">{value}</p>
              <p className="text-xs text-muted">{label}</p>
              <p className="mt-1 line-clamp-2 text-[11px] text-subtle">{sub}</p>
            </div>
          ))}
        </div>
        <div className="mt-4 rounded-xl border border-border p-4">
          <p className="text-[17px] font-semibold">{plan.title}</p>
          {plan.subtitle && <p className="text-[13px] text-muted">{plan.subtitle}</p>}
          <p className="mt-2 text-[13px] leading-relaxed text-muted">
            {plan.statement.selectionLogic}
          </p>
        </div>
        <div className="mt-4 flex justify-end">
          <Button variant="primary" onClick={() => goTo('review')}>
            前往核对
          </Button>
        </div>
      </Panel>
    </div>
  );
}
