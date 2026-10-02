import { useState } from 'react';
import {
  AlertOctagon,
  ArrowRightLeft,
  CheckCircle2,
  ExternalLink,
  Info,
  RotateCcw,
  Search,
  Sparkles,
  TriangleAlert,
} from 'lucide-react';
import {
  checkCategoryLabels,
  isEditable,
  type CheckItem,
  type ExhibitionDetail,
  type PlanBook,
} from '@yys/shared';
import { BookCover } from '../../../components/BookCover';
import { EditableText, Panel } from '../../../components/workflow';
import { Badge, Button, Dialog, EmptyState, Input, Spinner } from '../../../components/ui';
import { cn } from '../../../lib/cn';
import { useRpc } from '../../../lib/use-rpc';
import { act, savePlan, type StepProps } from '../actions';

const severityMeta = {
  blocker: { label: '必须处理', icon: AlertOctagon, tone: 'danger' as const },
  warning: { label: '需要核对', icon: TriangleAlert, tone: 'warning' as const },
  info: { label: '提示', icon: Info, tone: 'neutral' as const },
};

function CheckRow({
  item,
  detail,
  editable,
}: {
  item: CheckItem;
  detail: ExhibitionDetail;
  editable: boolean;
}) {
  const [noting, setNoting] = useState(false);
  const [note, setNote] = useState(item.note);
  const meta = severityMeta[item.severity];
  const Icon = meta.icon;
  const update = (status: CheckItem['status'], withNote = '') =>
    act('checks.update', { id: detail.id, itemId: item.id, status, note: withNote });

  return (
    <li
      className={cn(
        'rounded-xl border p-3',
        item.status === 'open' ? 'border-border' : 'border-transparent bg-surface opacity-75',
      )}
    >
      <div className="flex items-start gap-2.5">
        <Icon
          className={cn(
            'mt-0.5 size-4 shrink-0',
            item.status !== 'open'
              ? 'text-subtle'
              : item.severity === 'blocker'
                ? 'text-danger'
                : item.severity === 'warning'
                  ? 'text-warning'
                  : 'text-muted',
          )}
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className={cn('text-[13px]', item.status !== 'open' && 'line-through')}>
              {item.message}
            </span>
            <Badge tone={item.status === 'open' ? meta.tone : 'neutral'}>
              {checkCategoryLabels[item.category]}
            </Badge>
            {item.origin === 'ai' && <Badge>智能体核验</Badge>}
          </div>
          {item.suggestion && <p className="mt-0.5 text-xs text-muted">建议：{item.suggestion}</p>}
          {item.note && <p className="mt-0.5 text-xs text-accent">处理说明：{item.note}</p>}
          {noting && (
            <div className="mt-2 flex gap-1.5">
              <Input
                autoFocus
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="写明判断理由，例如：馆员已确认该书在架"
                className="h-8"
              />
              <Button
                size="sm"
                variant="primary"
                disabled={item.severity === 'blocker' && !note.trim()}
                onClick={() => void update('dismissed', note).then(() => setNoting(false))}
              >
                确认忽略
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setNoting(false)}>
                取消
              </Button>
            </div>
          )}
        </div>
        {editable && !noting && (
          <div className="flex shrink-0 gap-1">
            {item.status === 'open' ? (
              <>
                <Button size="sm" variant="outline" onClick={() => void update('resolved')}>
                  已处理
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setNoting(true)}>
                  忽略
                </Button>
              </>
            ) : (
              <Button size="sm" variant="ghost" onClick={() => void update('open')}>
                <RotateCcw className="size-3.5" /> 重新打开
              </Button>
            )}
          </div>
        )}
      </div>
    </li>
  );
}

/** 按类别分组，保持组内既有顺序；有未处理必须项的类别排在前面 */
function groupChecks(items: CheckItem[]): [CheckItem['category'], CheckItem[]][] {
  const groups = new Map<CheckItem['category'], CheckItem[]>();
  for (const item of items) groups.set(item.category, [...(groups.get(item.category) ?? []), item]);
  const weight = (list: CheckItem[]): number =>
    list.some((c) => c.status === 'open' && c.severity === 'blocker')
      ? 0
      : list.some((c) => c.status === 'open')
        ? 1
        : 2;
  return [...groups.entries()].sort((a, b) => weight(a[1]) - weight(b[1]));
}

function CheckGroup({
  category,
  items,
  detail,
  editable,
}: {
  category: CheckItem['category'];
  items: CheckItem[];
  detail: ExhibitionDetail;
  editable: boolean;
}) {
  const [busy, setBusy] = useState(false);
  // 必须处理的问题需要逐条判断，批量操作只针对建议核对与提示
  const bulk = items.filter((c) => c.status === 'open' && c.severity !== 'blocker');
  const open = items.filter((c) => c.status === 'open').length;
  const resolveAll = async (): Promise<void> => {
    setBusy(true);
    for (const item of bulk)
      await act('checks.update', { id: detail.id, itemId: item.id, status: 'resolved', note: '' });
    setBusy(false);
  };
  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <span className="text-[13px] font-medium">{checkCategoryLabels[category]}</span>
        <span className="text-xs text-subtle">
          {open ? `${open} 项待处理` : '已全部处理'} · 共 {items.length} 项
        </span>
        <div className="flex-1" />
        {editable && bulk.length > 1 && (
          <Button size="sm" variant="ghost" loading={busy} onClick={() => void resolveAll()}>
            全部标记已处理
          </Button>
        )}
      </div>
      <ul className="space-y-2">
        {items.map((item) => (
          <CheckRow key={item.id} item={item} detail={detail} editable={editable} />
        ))}
      </ul>
    </div>
  );
}

function ReplaceDialog({
  detail,
  entry,
  onClose,
}: {
  detail: ExhibitionDetail;
  entry: PlanBook;
  onClose: () => void;
}) {
  const [text, setText] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const inPlan = new Set(detail.plan!.books.map((b) => b.book.id));
  const { data, loading } = useRpc('books.search', {
    text,
    sourceIds: detail.brief.sourceIds.length ? detail.brief.sourceIds : undefined,
    limit: 30,
  });
  const replace = async (newBookId: string): Promise<void> => {
    setBusyId(newBookId);
    const ok = await act(
      'plan.replaceBook',
      { id: detail.id, oldBookId: entry.book.id, newBookId },
      '已替换并重新生成导读',
    );
    setBusyId(null);
    if (ok) onClose();
  };
  const row = (
    book: { id: string; title: string; authors: string[]; callNumber?: string; isSample: boolean },
    reason?: string,
  ) => (
    <li key={book.id} className="flex items-center gap-3 py-2.5">
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-medium">
          《{book.title}》{book.isSample && <Badge className="ml-1">示例</Badge>}
        </p>
        <p className="truncate text-xs text-muted">
          {book.authors.join('、')}
          {book.callNumber ? ` · ${book.callNumber}` : ''}
          {reason ? ` · ${reason}` : ''}
        </p>
      </div>
      <Button
        size="sm"
        variant="outline"
        loading={busyId === book.id}
        disabled={busyId !== null || inPlan.has(book.id)}
        onClick={() => void replace(book.id)}
      >
        {inPlan.has(book.id) ? '已在书单' : '换成这本'}
      </Button>
    </li>
  );
  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={`替换《${entry.book.title}》`}
      description="新书沿用原来的展区，智能体会为它重新撰写导读。"
      width="max-w-xl"
    >
      {detail.plan!.alternates.length > 0 && (
        <>
          <p className="mb-1 text-xs font-medium text-subtle">智能体推荐的备选</p>
          <ul className="mb-4 divide-y divide-border">
            {detail.plan!.alternates.map((a) => row(a.book, a.reason))}
          </ul>
        </>
      )}
      <p className="mb-1.5 text-xs font-medium text-subtle">从书库中选择</p>
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-subtle" />
        <Input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="按书名、作者、主题词检索"
          className="pl-9"
        />
      </div>
      {loading && !data ? (
        <Spinner className="mx-auto mt-4" />
      ) : (
        <ul className="mt-1 divide-y divide-border">{data?.items.map((b) => row(b))}</ul>
      )}
    </Dialog>
  );
}

function BookEntry({
  detail,
  entry,
  issues,
  editable,
}: {
  detail: ExhibitionDetail;
  entry: PlanBook;
  issues: CheckItem[];
  editable: boolean;
}) {
  const [replacing, setReplacing] = useState(false);
  const { book } = entry;
  const sections = detail.plan!.sections;
  return (
    <div className="rounded-xl border border-border p-4">
      <div className="flex items-start gap-3">
        <BookCover book={book} size="xs" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="font-medium">《{book.title}》</span>
            {book.isSample && <Badge>示例</Badge>}
            {entry.confidence === 'low' && <Badge tone="warning">关联较弱</Badge>}
            {entry.guideBasis === 'title_only' && <Badge tone="warning">导读待补充</Badge>}
            {entry.edited && <Badge tone="accent">人工修改</Badge>}
            {issues.length > 0 && (
              <Badge tone={issues.some((i) => i.severity === 'blocker') ? 'danger' : 'warning'}>
                {issues.length} 项待核对
              </Badge>
            )}
          </div>
          <p className="mt-0.5 text-xs text-muted">
            {book.authors.join('、') || '作者待核对'} · 索书号 {book.callNumber ?? '待核对'}
          </p>
        </div>
        {book.sourceUrl && /^https?:\/\//.test(book.sourceUrl) && (
          <button
            aria-label="打开馆藏链接"
            onClick={() => void window.yys.shell.openExternal(book.sourceUrl!)}
            className="mt-0.5 text-subtle hover:text-fg"
          >
            <ExternalLink className="size-3.5" />
          </button>
        )}
      </div>
      <p className="mt-2 text-xs text-muted">
        <span className="text-subtle">
          入选理由（依据：
          {entry.evidence
            .map((e) => ({ title: '书名', subjects: '主题词', summary: '摘要' })[e])
            .join('、')}
          ）：
        </span>
        {entry.reason}
      </p>
      <div className="mt-2.5">
        <EditableText
          value={entry.guide}
          readOnly={!editable}
          onSave={(guide) =>
            savePlan(detail, (plan) => {
              const target = plan.books.find((b) => b.book.id === book.id)!;
              target.guide = guide;
              target.guideBasis = 'manual';
              target.edited = true;
            }).then(() => undefined)
          }
          onRewrite={(instruction) =>
            act('plan.regenerateGuide', { id: detail.id, bookId: book.id, instruction }).then(
              () => undefined,
            )
          }
        />
      </div>
      {editable && (
        <div className="mt-3 flex items-center gap-1.5">
          <Button size="sm" variant="ghost" onClick={() => setReplacing(true)}>
            <ArrowRightLeft className="size-3.5" /> 替换
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() =>
              void act(
                'plan.regenerateGuide',
                { id: detail.id, bookId: book.id, instruction: '' },
                '已重新生成导读',
              )
            }
          >
            <Sparkles className="size-3.5" /> 重新生成导读
          </Button>
          {sections.length > 1 && (
            <select
              aria-label="移动到展区"
              value={entry.sectionId}
              onChange={(e) =>
                void savePlan(
                  detail,
                  (plan) =>
                    (plan.books.find((b) => b.book.id === book.id)!.sectionId = e.target.value),
                )
              }
              className="h-8 rounded-lg border border-border bg-bg px-2 text-xs"
            >
              {sections.map((s) => (
                <option key={s.id} value={s.id}>
                  移至：{s.title}
                </option>
              ))}
            </select>
          )}
          <div className="flex-1" />
          {detail.plan!.books.length > 1 && (
            <Button
              size="sm"
              variant="ghost"
              className="text-danger"
              onClick={() =>
                void savePlan(detail, (plan) => {
                  plan.books = plan.books.filter((b) => b.book.id !== book.id);
                  plan.alternates = [{ book, reason: '从书单中移除' }, ...plan.alternates];
                })
              }
            >
              移出书单
            </Button>
          )}
        </div>
      )}
      {replacing && (
        <ReplaceDialog detail={detail} entry={entry} onClose={() => setReplacing(false)} />
      )}
    </div>
  );
}

export function ReviewStep({ detail, editable, run }: StepProps) {
  const plan = detail.plan;
  if (!plan)
    return (
      <EmptyState
        title="还没有策展方案"
        description="完成策展后，在这里核对书目、导读与活动材料。"
      />
    );
  const canEdit = editable && isEditable('plan', detail.status);
  const open = detail.checks.filter((c) => c.status === 'open');
  const blockers = open.filter((c) => c.severity === 'blocker');
  const sorted = [...detail.checks].sort((a, b) => {
    const order = { blocker: 0, warning: 1, info: 2 };
    return (
      Number(a.status !== 'open') - Number(b.status !== 'open') ||
      order[a.severity] - order[b.severity]
    );
  });
  const rewrite = (
    target: 'introduction' | 'statement' | 'activity' | 'section',
    instruction: string,
    sectionId?: string,
  ) => act('plan.rewrite', { id: detail.id, target, instruction, sectionId }).then(() => undefined);

  return (
    <div className="space-y-5">
      {/* 确认栏 */}
      <div
        className={cn(
          'flex items-center gap-4 rounded-2xl p-4',
          blockers.length ? 'bg-danger-soft' : open.length ? 'bg-warning-soft' : 'bg-accent-soft',
        )}
      >
        {blockers.length ? (
          <AlertOctagon className="size-5 text-danger" />
        ) : open.length ? (
          <TriangleAlert className="size-5 text-warning" />
        ) : (
          <CheckCircle2 className="size-5 text-success" />
        )}
        <div className="flex-1">
          <p className="text-[14px] font-medium">
            {blockers.length
              ? `还有 ${blockers.length} 项必须处理`
              : open.length
                ? `还有 ${open.length} 项建议核对`
                : '核对清单已全部处理'}
          </p>
          <p className="text-xs text-muted">
            请逐项判断：修改方案、标记已处理，或写明理由后忽略。确认无误后，智能体会生成策展申请书。
          </p>
        </div>
        {canEdit && (
          <>
            <Button
              size="sm"
              variant="outline"
              onClick={() => void act('checks.run', { id: detail.id }, '已重新检查')}
            >
              重新检查
            </Button>
            <Button
              size="sm"
              variant="primary"
              disabled={blockers.length > 0}
              onClick={() => run('proposal')}
            >
              确认无误，生成策展申请书
            </Button>
          </>
        )}
      </div>

      <Panel title="核对清单" description="来源不清、字段缺失、需要人工判断的内容">
        {sorted.length === 0 ? (
          <p className="text-[13px] text-muted">没有发现问题。</p>
        ) : (
          <div className="space-y-4">
            {groupChecks(sorted).map(([category, items]) => (
              <CheckGroup
                key={category}
                category={category}
                items={items}
                detail={detail}
                editable={canEdit}
              />
            ))}
          </div>
        )}
      </Panel>

      <Panel title={plan.title} description={plan.subtitle}>
        <div className="grid grid-cols-2 gap-4 text-[13px]">
          {(
            [
              ['goals', '活动目标'],
              ['audienceNote', '读者特点'],
              ['structureLogic', '展区结构'],
              ['selectionLogic', '选书逻辑'],
            ] as const
          ).map(([key, label]) => (
            <div key={key}>
              <p className="mb-1 text-xs font-medium text-subtle">{label}</p>
              <EditableText
                value={plan.statement[key]}
                readOnly={!canEdit}
                onSave={(v) =>
                  savePlan(detail, (p) => (p.statement[key] = v)).then(() => undefined)
                }
              />
            </div>
          ))}
        </div>
        {canEdit && (
          <InstructionBar
            placeholder="改写策展说明，例如：更突出新生入学教育的目标"
            onSubmit={(i) => rewrite('statement', i)}
          />
        )}
      </Panel>

      <Panel title="总导语">
        <EditableText
          value={plan.introduction}
          readOnly={!canEdit}
          onSave={(v) => savePlan(detail, (p) => (p.introduction = v)).then(() => undefined)}
          onRewrite={(i) => rewrite('introduction', i)}
        />
      </Panel>

      {plan.sections.map((section, i) => (
        <Panel
          key={section.id}
          title={`第 ${i + 1} 展区：${section.title}`}
          description={section.intent}
        >
          <p className="mb-1 text-xs font-medium text-subtle">展板短文</p>
          <EditableText
            value={section.panelText}
            readOnly={!canEdit}
            onSave={(v) =>
              savePlan(
                detail,
                (p) => (p.sections.find((s) => s.id === section.id)!.panelText = v),
              ).then(() => undefined)
            }
            onRewrite={(instruction) => rewrite('section', instruction, section.id)}
          />
          <div className="mt-4 space-y-3">
            {plan.books
              .filter((b) => b.sectionId === section.id)
              .map((entry) => (
                <BookEntry
                  key={entry.book.id}
                  detail={detail}
                  entry={entry}
                  issues={open.filter((c) => c.bookId === entry.book.id)}
                  editable={canEdit}
                />
              ))}
          </div>
        </Panel>
      ))}

      <Panel
        title={`线下活动：${plan.activity.format}`}
        description={`约 ${plan.activity.durationMinutes} 分钟`}
      >
        <ol className="space-y-2">
          {plan.activity.segments.map((s, i) => (
            <li key={i} className="flex gap-3 text-[13px]">
              <span className="w-14 shrink-0 font-medium text-accent">{s.minutes} 分钟</span>
              <span>
                <span className="font-medium">{s.title}</span>
                <span className="text-muted">：{s.description}</span>
              </span>
            </li>
          ))}
        </ol>
        <p className="mt-3 text-xs font-medium text-subtle">讨论问题</p>
        <ul className="mt-1 space-y-0.5 text-[13px] text-muted">
          {plan.activity.questions.map((q) => (
            <li key={q}>· {q}</li>
          ))}
        </ul>
        {canEdit && (
          <InstructionBar
            placeholder="调整活动流程，例如：增加 5 分钟现场核实练习"
            onSubmit={(i) => rewrite('activity', i)}
          />
        )}
      </Panel>
    </div>
  );
}

/** 一句话交给智能体修改整块内容 */
function InstructionBar({
  placeholder,
  onSubmit,
}: {
  placeholder: string;
  onSubmit: (instruction: string) => Promise<void>;
}) {
  const [instruction, setInstruction] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (): Promise<void> => {
    if (!instruction.trim()) return;
    setBusy(true);
    await onSubmit(instruction.trim());
    setBusy(false);
    setInstruction('');
  };
  return (
    <div className="mt-4 flex gap-1.5">
      <Input
        value={instruction}
        onChange={(e) => setInstruction(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && !e.nativeEvent.isComposing && void submit()}
        placeholder={placeholder}
        className="h-8"
      />
      <Button
        size="sm"
        variant="outline"
        loading={busy}
        disabled={!instruction.trim()}
        onClick={() => void submit()}
      >
        <Sparkles className="size-3.5" /> AI 调整
      </Button>
    </div>
  );
}
