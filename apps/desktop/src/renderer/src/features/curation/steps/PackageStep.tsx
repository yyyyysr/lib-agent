import { useRef } from 'react';
import { Download, Image, Package, RefreshCcw, Send } from 'lucide-react';
import { isEditable, type ActivityPackage, type ExhibitionDetail } from '@yys/shared';
import { Poster, posterTemplates } from '../../../components/Poster';
import { EditableText, Panel } from '../../../components/workflow';
import { Button, EmptyState } from '../../../components/ui';
import { cn } from '../../../lib/cn';
import { useBranding } from '../../../lib/use-branding';
import { toast } from '../../../store/app-store';
import { act, type StepProps } from '../actions';
import { packageMarkdown } from '../export';
import { exportText } from './ProposalStep';

function PromotionFields({
  detail,
  pkg,
  editable,
}: {
  detail: ExhibitionDetail;
  pkg: ActivityPackage;
  editable: boolean;
}) {
  const save = (next: ActivityPackage) =>
    act('exhibitions.updatePackage', { id: detail.id, package: next }).then(() => undefined);
  const promo = (key: keyof ActivityPackage['promotion'], label: string) => (
    <div>
      <p className="mb-1 text-xs font-medium text-subtle">{label}</p>
      <EditableText
        value={pkg.promotion[key]}
        readOnly={!editable}
        onSave={(v) => save({ ...pkg, promotion: { ...pkg.promotion, [key]: v } })}
      />
    </div>
  );
  return (
    <div className="space-y-4">
      {promo('postTitle', '推文标题')}
      {promo('postBody', '推文正文')}
      {promo('signupIntro', '报名介绍')}
      {promo('notice', '校园通知')}
      <div>
        <p className="mb-1 text-xs font-medium text-subtle">活动反馈问卷（每行一个问题）</p>
        <EditableText
          value={pkg.feedbackQuestions.join('\n')}
          readOnly={!editable}
          onSave={(v) =>
            save({
              ...pkg,
              feedbackQuestions: v
                .split('\n')
                .map((q) => q.trim())
                .filter(Boolean),
            })
          }
        />
      </div>
    </div>
  );
}

/** 审批人查看的只读版本 */
export function PackagePreview({ detail }: { detail: ExhibitionDetail }) {
  const pkg = detail.package!;
  const { organizer } = useBranding();
  return (
    <div className="flex gap-6">
      <Poster
        poster={pkg.poster}
        brief={detail.brief}
        bookTitles={detail.plan?.books.map((b) => b.book.title) ?? []}
        organizer={organizer}
        scale={0.75}
      />
      <div className="min-w-0 flex-1 rounded-2xl border border-border p-5">
        <PromotionFields detail={detail} pkg={pkg} editable={false} />
      </div>
    </div>
  );
}

export function PackageStep({ detail, editable, run }: StepProps) {
  const posterRef = useRef<HTMLDivElement>(null);
  const { organizer } = useBranding();
  const pkg = detail.package;
  const canEdit = editable && isEditable('package', detail.status);
  const canSubmit =
    editable && (detail.status === 'package_draft' || detail.status === 'package_changes');

  if (!pkg) {
    const ready = detail.status === 'proposal_approved';
    return (
      <EmptyState
        icon={<Package className="size-8" />}
        title={ready ? '立项已同意，可以生成海报与完整活动包' : '立项审批通过后才能生成活动包'}
        description="智能体会撰写海报文案、推文、报名介绍、校园通知和反馈问卷；时间、地点与书目信息直接取自已审批的方案。"
        action={
          ready &&
          editable && (
            <Button variant="primary" onClick={() => run('package')}>
              生成海报与完整活动包
            </Button>
          )
        }
      />
    );
  }

  const save = (next: ActivityPackage) =>
    act('exhibitions.updatePackage', { id: detail.id, package: next }).then(() => undefined);
  const poster = (key: 'headline' | 'subheadline' | 'tagline' | 'callToAction', label: string) => (
    <div>
      <p className="mb-1 text-xs font-medium text-subtle">{label}</p>
      <EditableText
        multiline={false}
        value={pkg.poster[key]}
        readOnly={!canEdit}
        onSave={(v) => save({ ...pkg, poster: { ...pkg.poster, [key]: v } })}
      />
    </div>
  );

  const exportPoster = async (): Promise<void> => {
    const el = posterRef.current;
    if (!el) return;
    el.scrollIntoView({ block: 'nearest' });
    const rect = el.getBoundingClientRect();
    const path = await window.yys.files.savePng(`${detail.title}-海报.png`, {
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
    });
    if (path) toast({ tone: 'success', title: '海报已导出', description: path });
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        <p className="flex-1 text-[13px] text-muted">
          {canSubmit
            ? '核对海报与推广材料，确认后提交上线审批。审批通过后首页会更新为本期书展。'
            : '活动包已提交或已上线，内容不可修改。'}
        </p>
        <Button
          size="sm"
          variant="ghost"
          onClick={() =>
            void exportText(`${detail.title}-完整活动包.md`, packageMarkdown(detail, organizer))
          }
        >
          <Download className="size-3.5" /> 导出完整活动包
        </Button>
        {canEdit && (
          <Button size="sm" variant="outline" onClick={() => run('package')}>
            <RefreshCcw className="size-3.5" /> 重新生成
          </Button>
        )}
        {canSubmit && (
          <Button
            size="sm"
            variant="primary"
            onClick={() =>
              void act('exhibitions.submit', { id: detail.id, kind: 'package' }, '已提交上线审批')
            }
          >
            <Send className="size-3.5" /> 提交上线审批
          </Button>
        )}
      </div>

      <Panel title="海报">
        <div className="flex gap-6">
          <div className="space-y-3">
            <Poster
              ref={posterRef}
              poster={pkg.poster}
              brief={detail.brief}
              bookTitles={detail.plan?.books.map((b) => b.book.title) ?? []}
              organizer={organizer}
            />
            <div className="flex items-center gap-1.5">
              {posterTemplates.map((t) => (
                <button
                  key={t.key}
                  disabled={!canEdit}
                  onClick={() => void save({ ...pkg, poster: { ...pkg.poster, template: t.key } })}
                  className={cn(
                    'h-8 rounded-lg px-3 text-[13px] disabled:opacity-60',
                    pkg.poster.template === t.key
                      ? 'bg-fg text-bg'
                      : 'bg-surface hover:bg-surface-2',
                  )}
                >
                  {t.label}
                </button>
              ))}
              <div className="flex-1" />
              <Button size="sm" variant="outline" onClick={() => void exportPoster()}>
                <Image className="size-3.5" /> 导出 PNG
              </Button>
            </div>
          </div>
          <div className="min-w-0 flex-1 space-y-4">
            {poster('headline', '主标题')}
            {poster('subheadline', '副标题')}
            {poster('tagline', '宣传语')}
            <div>
              <p className="mb-1 text-xs font-medium text-subtle">亮点（每行一个）</p>
              <EditableText
                value={pkg.poster.highlights.join('\n')}
                readOnly={!canEdit}
                onSave={(v) =>
                  save({
                    ...pkg,
                    poster: {
                      ...pkg.poster,
                      highlights: v
                        .split('\n')
                        .map((h) => h.trim())
                        .filter(Boolean)
                        .slice(0, 3),
                    },
                  })
                }
              />
            </div>
            {poster('callToAction', '行动号召')}
            <p className="text-xs text-subtle">
              时间、地点与面向读者取自需求，如需修改请联系管理员退回。
            </p>
          </div>
        </div>
      </Panel>

      <Panel title="推广材料与反馈问卷">
        <PromotionFields detail={detail} pkg={pkg} editable={canEdit} />
      </Panel>

      <Panel title="完整活动包包含" description="导出为 Markdown 后可粘贴到校园平台或打印">
        <ul className="grid grid-cols-2 gap-2 text-[13px] text-muted">
          {[
            '策展说明',
            `书单与导读（${detail.plan?.books.length ?? 0} 本）`,
            `展板短文（${detail.plan?.sections.length ?? 0} 篇）`,
            '总导语',
            '活动流程与讨论问题',
            '海报文字、推文、报名介绍、校园通知',
            `核对清单（${detail.checks.length} 项）`,
            '匿名反馈问卷',
          ].map((item) => (
            <li key={item} className="rounded-lg bg-surface px-3 py-2">
              {item}
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}
