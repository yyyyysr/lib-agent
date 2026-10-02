import { useEffect, useState } from 'react';
import { ClipboardList, Download, Home, RefreshCcw, Star, Trash2 } from 'lucide-react';
import type { Retrospective } from '@yys/shared';
import { EditableText, Panel } from '../../../components/workflow';
import { Button, EmptyState, Field, IconButton, Input, Textarea } from '../../../components/ui';
import { countdown, formatDateTime } from '../../../lib/format';
import { useAppStore } from '../../../store/app-store';
import { act, type StepProps } from '../actions';
import { exportText } from './ProposalStep';

/** “5 很有收获”“4分：希望多互动”这类写法识别出评分，其余整行作为内容 */
export function parseFeedback(text: string): { rating: number | null; content: string }[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = /^([1-5])\s*(?:分|星)?\s*[,，:：、.\-\s]\s*(.+)$/.exec(line);
      return match
        ? { rating: Number(match[1]), content: match[2]!.trim() }
        : { rating: null, content: line };
    });
}

export function PublishStep({ detail, editable, goTo }: StepProps) {
  const navigate = useAppStore((s) => s.navigate);
  const published = detail.status === 'published' || detail.status === 'completed';
  const [execution, setExecution] = useState({
    heldOn: detail.execution.heldOn,
    participants: String(detail.execution.participants || ''),
    notes: detail.execution.notes,
  });
  const [feedbackText, setFeedbackText] = useState('');
  useEffect(
    () =>
      setExecution({
        heldOn: detail.execution.heldOn,
        participants: String(detail.execution.participants || ''),
        notes: detail.execution.notes,
      }),
    [detail.execution],
  );

  if (!published)
    return (
      <EmptyState
        title="书展尚未上线"
        description="上线审批通过后，书展会出现在首页，并可在这里录入活动执行情况与读者反馈。"
      />
    );

  const entries = parseFeedback(feedbackText);
  const when = countdown(detail.brief.eventDate);
  const rated = detail.feedback.filter((f) => f.rating !== null);
  const average = rated.length
    ? (rated.reduce((s, f) => s + f.rating!, 0) / rated.length).toFixed(1)
    : '—';

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3 rounded-2xl bg-accent-soft p-4">
        <Home className="size-5 text-success" />
        <div className="flex-1">
          <p className="text-[14px] font-medium text-success">
            书展已在首页上线{when ? ` · ${when.label}` : ''}
          </p>
          <p className="text-xs text-muted">
            上线于 {formatDateTime(detail.publishedAt)}
            。活动结束后录入执行记录与读者反馈，首页会同步展示活动成果。
          </p>
        </div>
        <Button size="sm" variant="primary" onClick={() => navigate({ name: 'home' })}>
          在首页查看
        </Button>
      </div>

      <Panel title="活动执行记录">
        <div className="grid grid-cols-[160px_120px_1fr] gap-3">
          <Field label="举办日期">
            <Input
              type="date"
              disabled={!editable}
              value={execution.heldOn}
              onChange={(e) => setExecution((x) => ({ ...x, heldOn: e.target.value }))}
            />
          </Field>
          <Field label="参与人数">
            <Input
              type="number"
              min={0}
              disabled={!editable}
              value={execution.participants}
              onChange={(e) => setExecution((x) => ({ ...x, participants: e.target.value }))}
            />
          </Field>
          <Field label="执行情况">
            <Input
              disabled={!editable}
              value={execution.notes}
              onChange={(e) => setExecution((x) => ({ ...x, notes: e.target.value }))}
              placeholder="现场情况、临时调整等"
            />
          </Field>
        </div>
        {editable && (
          <div className="mt-3 flex justify-end">
            <Button
              size="sm"
              variant="primary"
              onClick={() =>
                void act(
                  'exhibitions.updateExecution',
                  {
                    id: detail.id,
                    execution: {
                      heldOn: execution.heldOn,
                      participants: Number(execution.participants) || 0,
                      notes: execution.notes,
                    },
                  },
                  '已保存执行记录',
                )
              }
            >
              保存
            </Button>
          </div>
        )}
      </Panel>

      <Panel
        title="读者反馈"
        description={`共 ${detail.feedback.length} 条 · 平均评分 ${average}。只录入匿名内容；手机号、邮箱、学号等会被自动隐去。`}
      >
        {detail.package?.feedbackQuestions.length ? (
          <div className="mb-3 rounded-xl bg-surface p-3 text-xs text-muted">
            <p className="mb-1 flex items-center gap-1 font-medium text-fg">
              <ClipboardList className="size-3.5" /> 本期反馈问卷
            </p>
            {detail.package.feedbackQuestions.map((q, i) => (
              <p key={q}>
                {i + 1}. {q}
              </p>
            ))}
          </div>
        ) : null}
        {editable && (
          <div className="space-y-2">
            <Textarea
              rows={4}
              value={feedbackText}
              onChange={(e) => setFeedbackText(e.target.value)}
              placeholder={
                '每行一条反馈，可在开头写 1–5 分，例如：\n5 案例讨论很有收获\n4分：希望多一些实操练习'
              }
            />
            <div className="flex items-center justify-between">
              <span className="text-xs text-subtle">
                {entries.length
                  ? `将录入 ${entries.length} 条，其中 ${entries.filter((e) => e.rating).length} 条带评分`
                  : ''}
              </span>
              <Button
                size="sm"
                variant="primary"
                disabled={entries.length === 0}
                onClick={async () => {
                  if (
                    await act(
                      'feedback.add',
                      { id: detail.id, entries },
                      `已录入 ${entries.length} 条反馈`,
                    )
                  )
                    setFeedbackText('');
                }}
              >
                录入反馈
              </Button>
            </div>
          </div>
        )}
        <ul className="mt-3 divide-y divide-border">
          {detail.feedback.map((f) => (
            <li key={f.id} className="flex items-start gap-3 py-2.5 text-[13px]">
              <span className="flex w-10 shrink-0 items-center gap-0.5 text-warning">
                {f.rating ? (
                  <>
                    <Star className="size-3 fill-current" />
                    {f.rating}
                  </>
                ) : (
                  <span className="text-subtle">—</span>
                )}
              </span>
              <span data-selectable className="flex-1">
                {f.content}
              </span>
              {editable && (
                <IconButton
                  label="删除"
                  size="sm"
                  onClick={() => void act('feedback.delete', { id: detail.id, entryId: f.id })}
                >
                  <Trash2 className="size-3.5" />
                </IconButton>
              )}
            </li>
          ))}
        </ul>
      </Panel>

      <div className="flex items-center gap-3 rounded-2xl border border-border p-4">
        <div className="flex-1">
          <p className="text-[14px] font-medium">活动结束后进行复盘</p>
          <p className="text-xs text-muted">
            智能体会汇总哪些内容有效、哪些材料需要修改，作为下一期策展的依据。
          </p>
        </div>
        <Button
          variant={detail.retrospective ? 'outline' : 'primary'}
          onClick={() => goTo('retro')}
        >
          {detail.retrospective ? '查看复盘' : '前往复盘'}
        </Button>
      </div>
    </div>
  );
}

function retroMarkdown(title: string, r: Retrospective): string {
  return [
    `# ${title} · 复盘总结`,
    '',
    `参与 ${r.metrics.participants} 人 · 反馈 ${r.metrics.feedbackCount} 条 · 平均评分 ${r.metrics.averageRating ?? '无'}`,
    '',
    r.summary,
    '',
    '## 有效的做法',
    ...r.worked.map((w) => `- ${w}`),
    '',
    '## 需要修改的材料',
    ...r.improve.map((i) => `- **${i.target}**：${i.issue} → ${i.suggestion}`),
    '',
    '## 读者需求',
    ...r.audienceInsights.map((w) => `- ${w}`),
    '',
    '## 给下一期的建议',
    ...r.nextTime.map((w) => `- ${w}`),
    '',
  ].join('\n');
}

export function RetroStep({ detail, editable, run }: StepProps) {
  const r = detail.retrospective;
  const published = detail.status === 'published' || detail.status === 'completed';
  if (!r) {
    return (
      <EmptyState
        title="还没有复盘总结"
        description={
          published
            ? `已录入 ${detail.feedback.length} 条反馈。智能体会汇总哪些内容有效、哪些材料需要修改，并作为下一期策展的参考。`
            : '书展上线并完成活动后再进行复盘。'
        }
        action={
          published &&
          editable && (
            <Button variant="primary" onClick={() => run('retrospective')}>
              生成复盘总结
            </Button>
          )
        }
      />
    );
  }
  const save = (patch: Partial<Retrospective>) =>
    act('exhibitions.updateRetrospective', {
      id: detail.id,
      retrospective: { ...r, ...patch },
    }).then(() => undefined);
  const list = (key: 'worked' | 'audienceInsights' | 'nextTime', label: string) => (
    <div>
      <p className="mb-1 text-xs font-medium text-subtle">{label}（每行一条）</p>
      <EditableText
        value={r[key].join('\n')}
        readOnly={!editable}
        onSave={(v) =>
          save({
            [key]: v
              .split('\n')
              .map((x) => x.trim())
              .filter(Boolean),
          })
        }
      />
    </div>
  );
  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        <p className="flex-1 text-[13px] text-muted">
          参与 {r.metrics.participants} 人 · 反馈 {r.metrics.feedbackCount} 条 · 平均评分{' '}
          {r.metrics.averageRating ?? '—'}。“给下一期的建议”会自动作为之后策展的参考。
        </p>
        <Button
          size="sm"
          variant="ghost"
          onClick={() =>
            void exportText(`${detail.title}-复盘总结.md`, retroMarkdown(detail.title, r))
          }
        >
          <Download className="size-3.5" /> 导出
        </Button>
        {editable && (
          <Button size="sm" variant="outline" onClick={() => run('retrospective')}>
            <RefreshCcw className="size-3.5" /> 重新生成
          </Button>
        )}
      </div>
      <Panel title="复盘总结">
        <EditableText value={r.summary} readOnly={!editable} onSave={(v) => save({ summary: v })} />
      </Panel>
      <Panel title="有效与改进">
        <div className="space-y-4">
          {list('worked', '有效的做法')}
          <div>
            <p className="mb-1 text-xs font-medium text-subtle">需要修改的材料</p>
            <ul className="space-y-1.5 text-[13px]">
              {r.improve.map((i) => (
                <li key={i.target + i.issue} className="rounded-lg bg-surface px-3 py-2">
                  <span className="font-medium">{i.target}</span>：{i.issue}
                  <span className="block text-muted">建议：{i.suggestion}</span>
                </li>
              ))}
            </ul>
          </div>
          {list('audienceInsights', '读者需求')}
          {list('nextTime', '给下一期的建议')}
        </div>
      </Panel>
    </div>
  );
}
