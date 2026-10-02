import { Download, FileText, RefreshCcw, Send } from 'lucide-react';
import { isEditable, type ExhibitionDetail, type Proposal } from '@yys/shared';
import { EditableText } from '../../../components/workflow';
import { Button, EmptyState } from '../../../components/ui';
import { formatDate, formatDateTime } from '../../../lib/format';
import { useBranding } from '../../../lib/use-branding';
import { toast } from '../../../store/app-store';
import { act, type StepProps } from '../actions';
import { proposalMarkdown } from '../export';

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <tr className="border-b border-border align-top">
      <th className="w-28 bg-surface px-3 py-2.5 text-left text-[13px] font-medium whitespace-nowrap">
        {label}
      </th>
      <td className="px-3 py-2.5 text-[14px]">{children}</td>
    </tr>
  );
}

/** 申请书正文：申请人与书单由系统填入，不可编辑 */
export function ProposalDocument({
  detail,
  proposal,
  editable,
}: {
  detail: ExhibitionDetail;
  proposal: Proposal;
  editable: boolean;
}) {
  const { organizer } = useBranding();
  const save = (patch: Partial<Proposal>) =>
    act('exhibitions.updateProposal', { id: detail.id, proposal: { ...proposal, ...patch } }).then(
      () => undefined,
    );
  const field = (key: 'purpose' | 'format' | 'expectedOutcomes' | 'support') => (
    <EditableText value={proposal[key]} readOnly={!editable} onSave={(v) => save({ [key]: v })} />
  );
  const when =
    [formatDate(proposal.schedule.date), proposal.schedule.time].filter(Boolean).join(' ') ||
    '待定';

  return (
    <article className="rounded-2xl border border-border bg-bg p-8">
      <p className="text-center text-xs tracking-[0.3em] text-subtle">
        {proposal.organizer || organizer} · 主题书展策展申请书
      </p>
      <h2 className="mt-2 text-center text-xl font-semibold">{proposal.title}</h2>
      <p className="mt-1 text-center text-xs text-subtle">
        生成于 {formatDateTime(proposal.generatedAt)}
      </p>
      <table className="mt-6 w-full overflow-hidden rounded-xl border border-border">
        <tbody>
          <Row label="书展主题">{proposal.theme}</Row>
          <Row label="目标读者">{proposal.audience}</Row>
          <Row label="拟开展形式">{field('format')}</Row>
          <Row label="活动时间">{when}</Row>
          <Row label="活动地点">{proposal.schedule.venue || '待定'}</Row>
          <Row label="申请人">
            {proposal.applicant.name}（学号/工号：{proposal.applicant.memberNo}）
            {proposal.applicant.department && ` · ${proposal.applicant.department}`}
          </Row>
          <Row label="目的与意义">{field('purpose')}</Row>
          <Row label="预期成果">{field('expectedOutcomes')}</Row>
          <Row label="所需支持">{field('support')}</Row>
        </tbody>
      </table>
      <h3 className="mt-6 mb-2 text-[14px] font-semibold">书单（{proposal.booklist.length} 本）</h3>
      <table className="w-full text-left text-[13px]">
        <thead className="text-xs text-subtle">
          <tr className="border-b border-border">
            <th className="py-2 pr-2 font-medium">序号</th>
            <th className="py-2 pr-2 font-medium">书名</th>
            <th className="py-2 pr-2 font-medium">作者</th>
            <th className="py-2 pr-2 font-medium">索书号</th>
            <th className="py-2 font-medium">展区</th>
          </tr>
        </thead>
        <tbody>
          {proposal.booklist.map((b, i) => (
            <tr key={`${b.title}-${i}`} className="border-b border-border">
              <td className="py-2 pr-2 text-muted">{i + 1}</td>
              <td className="py-2 pr-2">《{b.title}》</td>
              <td className="py-2 pr-2 text-muted">{b.authors}</td>
              <td
                className={
                  b.callNumber === '待核对' ? 'py-2 pr-2 text-warning' : 'py-2 pr-2 text-muted'
                }
              >
                {b.callNumber}
              </td>
              <td className="py-2 text-muted">{b.section}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </article>
  );
}

export async function exportText(name: string, content: string): Promise<void> {
  const path = await window.yys.files.saveText(name, content);
  if (path) toast({ tone: 'success', title: '已导出', description: path });
}

export function ProposalStep({ detail, editable, run, goTo }: StepProps) {
  const { proposal } = detail;
  const { organizer } = useBranding();
  if (!proposal) {
    return (
      <EmptyState
        icon={<FileText className="size-8" />}
        title="还没有策展申请书"
        description="在“核对”中处理完必须处理的问题并确认方案后，智能体会生成申请书。"
        action={
          <Button variant="primary" onClick={() => goTo('review')}>
            前往核对
          </Button>
        }
      />
    );
  }
  const canEdit = editable && isEditable('proposal', detail.status);
  const canSubmit =
    editable && (detail.status === 'proposal_draft' || detail.status === 'proposal_changes');
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <p className="flex-1 text-[13px] text-muted">
          {canEdit
            ? '可直接修改正文；申请人信息来自账号资料，书单来自已确认的方案。'
            : '申请书已提交，内容不可修改。'}
        </p>
        <Button
          size="sm"
          variant="ghost"
          onClick={() =>
            void exportText(
              `${proposal.title}-策展申请书.md`,
              proposalMarkdown(proposal, proposal.organizer || organizer),
            )
          }
        >
          <Download className="size-3.5" /> 导出
        </Button>
        {canEdit && (
          <Button size="sm" variant="outline" onClick={() => run('proposal')}>
            <RefreshCcw className="size-3.5" /> 重新生成
          </Button>
        )}
        {canSubmit && (
          <Button
            size="sm"
            variant="primary"
            onClick={() =>
              void act('exhibitions.submit', { id: detail.id, kind: 'proposal' }, '已提交立项审批')
            }
          >
            <Send className="size-3.5" /> 提交立项审批
          </Button>
        )}
      </div>
      <ProposalDocument detail={detail} proposal={proposal} editable={canEdit} />
    </div>
  );
}
