import { useState } from 'react';
import { CheckCircle2, Clock, Home, MessageSquareWarning, Send } from 'lucide-react';
import { approvalKindLabels, type ApprovalKind } from '@yys/shared';
import { Panel } from '../../../components/workflow';
import { Badge, Button, EmptyState, Textarea } from '../../../components/ui';
import { formatDateTime } from '../../../lib/format';
import { useAppStore } from '../../../store/app-store';
import { act, type StepProps } from '../actions';
import { PackagePreview } from './PackageStep';
import { ProposalDocument } from './ProposalStep';

function DecisionPanel({ approvalId, kind }: { approvalId: string; kind: ApprovalKind }) {
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState<'approve' | 'changes' | null>(null);
  const decide = async (decision: 'approve' | 'changes'): Promise<void> => {
    setBusy(decision);
    await act(
      'approvals.decide',
      { approvalId, decision, comment },
      decision === 'approve' ? '已同意' : '已退回修改',
    );
    setBusy(null);
  };
  return (
    <Panel
      title="审批意见"
      description={
        kind === 'proposal'
          ? '同意后，策展人可继续生成海报与完整活动包。'
          : '同意后，书展立即在首页上线。'
      }
      className="border-accent"
    >
      <Textarea
        rows={3}
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        placeholder="填写意见。退回修改时必须写明需要修改的地方。"
      />
      <div className="mt-3 flex justify-end gap-2">
        <Button
          variant="outline"
          loading={busy === 'changes'}
          disabled={busy !== null || !comment.trim()}
          onClick={() => void decide('changes')}
        >
          退回修改
        </Button>
        <Button
          variant="primary"
          loading={busy === 'approve'}
          disabled={busy !== null}
          onClick={() => void decide('approve')}
        >
          同意
        </Button>
      </div>
    </Panel>
  );
}

export function ApprovalStep({
  detail,
  editable,
  goTo,
  run,
  kind,
}: StepProps & { kind: ApprovalKind }) {
  const navigate = useAppStore((s) => s.navigate);
  const records = detail.approvals.filter((a) => a.kind === kind);
  const latest = records[0];
  const label = approvalKindLabels[kind];
  const editStep = kind === 'proposal' ? 'proposal' : 'package';

  if (!latest) {
    return (
      <EmptyState
        icon={<Send className="size-8" />}
        title={`尚未提交${label}`}
        description={
          kind === 'proposal' ? '生成并核对策展申请书后提交。' : '生成并核对海报与活动包后提交。'
        }
      />
    );
  }

  return (
    <div className="space-y-4">
      {latest.status === 'pending' && (
        <div className="flex items-center gap-3 rounded-2xl bg-surface p-4">
          <Clock className="size-5 text-accent" />
          <div className="flex-1">
            <p className="text-[14px] font-medium">{label}中</p>
            <p className="text-xs text-muted">
              {latest.submittedBy.name} 于 {formatDateTime(latest.submittedAt)}{' '}
              提交，等待审批管理员处理
            </p>
          </div>
        </div>
      )}
      {latest.status === 'changes_requested' && (
        <div className="rounded-2xl bg-danger-soft p-4">
          <div className="flex items-center gap-3">
            <MessageSquareWarning className="size-5 text-danger" />
            <div className="flex-1">
              <p className="text-[14px] font-medium text-danger">{label}：需修改</p>
              <p className="text-xs text-muted">
                {latest.reviewer?.name} · {formatDateTime(latest.reviewedAt)}
              </p>
            </div>
            {editable && (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => goTo(kind === 'proposal' ? 'review' : 'package')}
                >
                  {kind === 'proposal' ? '修改方案' : '修改活动包'}
                </Button>
                {kind === 'proposal' && (
                  <Button size="sm" variant="outline" onClick={() => goTo(editStep)}>
                    修改申请书
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="primary"
                  onClick={() =>
                    void act('exhibitions.submit', { id: detail.id, kind }, '已重新提交')
                  }
                >
                  修改完成，重新提交
                </Button>
              </>
            )}
          </div>
          <p className="mt-3 rounded-xl bg-bg p-3 text-[14px] whitespace-pre-wrap">
            {latest.comment}
          </p>
        </div>
      )}
      {latest.status === 'approved' && (
        <div className="rounded-2xl bg-accent-soft p-4">
          <div className="flex items-center gap-3">
            <CheckCircle2 className="size-5 text-success" />
            <div className="flex-1">
              <p className="text-[14px] font-medium text-success">{label}：同意</p>
              <p className="text-xs text-muted">
                {latest.reviewer?.name} · {formatDateTime(latest.reviewedAt)}
              </p>
            </div>
            {kind === 'proposal' && editable && detail.status === 'proposal_approved' && (
              <Button size="sm" variant="primary" onClick={() => run('package')}>
                生成海报与完整活动包
              </Button>
            )}
            {kind === 'package' && (
              <Button size="sm" variant="primary" onClick={() => navigate({ name: 'home' })}>
                <Home className="size-3.5" /> 在首页查看
              </Button>
            )}
          </div>
          {latest.comment && (
            <p className="mt-3 rounded-xl bg-bg p-3 text-[14px] whitespace-pre-wrap">
              {latest.comment}
            </p>
          )}
        </div>
      )}

      {detail.can.review && latest.status === 'pending' && (
        <DecisionPanel approvalId={latest.id} kind={kind} />
      )}

      {/* 审批对象 */}
      {kind === 'proposal' && detail.proposal && (
        <ProposalDocument detail={detail} proposal={detail.proposal} editable={false} />
      )}
      {kind === 'package' && detail.package && <PackagePreview detail={detail} />}

      {records.length > 1 && (
        <Panel title="审批记录">
          <ol className="space-y-2">
            {records.map((r) => (
              <li key={r.id} className="flex items-start gap-2 text-[13px]">
                <Badge
                  tone={
                    r.status === 'approved'
                      ? 'success'
                      : r.status === 'pending'
                        ? 'accent'
                        : 'danger'
                  }
                >
                  {r.status === 'approved' ? '同意' : r.status === 'pending' ? '待审批' : '退回'}
                </Badge>
                <span className="flex-1">
                  {formatDateTime(r.submittedAt)} 提交
                  {r.reviewer && ` · ${r.reviewer.name} ${formatDateTime(r.reviewedAt)}`}
                  {r.comment && <span className="block text-muted">{r.comment}</span>}
                </span>
              </li>
            ))}
          </ol>
        </Panel>
      )}
    </div>
  );
}
