import { useState } from 'react';
import { CircleDashed, ClipboardCheck, FileText, ListChecks, Megaphone, NotebookPen, Presentation, Route, TriangleAlert } from 'lucide-react';
import type { LibraryToolBook } from '@yys/shared';
import { Badge, EmptyState } from '../../components/ui';
import { cn } from '../../lib/cn';
import { BookRow } from './MessageView';

const deliverables = [
  { key: 'curatorial', icon: NotebookPen, title: '策展说明', desc: '活动对象、目标、主题结构与选书逻辑' },
  { key: 'booklist', icon: ListChecks, title: '馆藏书单', desc: '书名、作者、索书号、来源链接与关联理由' },
  { key: 'copy', icon: FileText, title: '展示文案', desc: '书展标题、总导语、单本导读与展板短文' },
  { key: 'flow', icon: Presentation, title: '活动流程', desc: '约 30 分钟的导览或讨论活动设计' },
  { key: 'promo', icon: Megaphone, title: '推广材料', desc: '海报文字、推文初稿与报名介绍' },
  { key: 'checklist', icon: ClipboardCheck, title: '核对清单', desc: '缺失字段与需要馆员判断的表述' },
  { key: 'retro', icon: Route, title: '反馈与复盘', desc: '活动后的反馈汇总与改进建议' },
];

const steps = ['任务卡', '馆藏准备', '筛选', '编排', '撰写', '检查', '审核导出'];

type Tab = 'package' | 'books' | 'checks';

export function ArtifactPanel({ candidates }: { candidates: LibraryToolBook[] }) {
  const [tab, setTab] = useState<Tab>('package');
  const issues = candidates.filter((book) => book.missingFields.length > 0 || book.isSample);

  const tabs: { key: Tab; label: string; count?: number }[] = [
    { key: 'package', label: '活动包' },
    { key: 'books', label: '候选书目', count: candidates.length },
    { key: 'checks', label: '核对清单', count: issues.length },
  ];

  return (
    <aside className="flex w-[380px] shrink-0 flex-col border-l border-border">
      <div className="flex h-11 shrink-0 items-center gap-1 border-b border-border px-3">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              'flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[13px]',
              tab === t.key ? 'bg-surface-2 font-medium text-fg' : 'text-muted hover:bg-surface-hover hover:text-fg',
            )}
          >
            {t.label}
            {t.count ? <span className="text-[11px] text-subtle">{t.count}</span> : null}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {tab === 'package' && (
          <div className="p-4">
            <div className="mb-4 rounded-xl bg-surface p-3.5">
              <p className="text-[13px] font-medium">策展流程</p>
              <div className="mt-2.5 flex flex-wrap gap-1.5">
                {steps.map((step, i) => (
                  <span key={step} className="flex items-center gap-1 text-xs text-subtle">
                    <CircleDashed className="size-3" />
                    {step}
                    {i < steps.length - 1 && <span className="ml-0.5 text-border-strong">›</span>}
                  </span>
                ))}
              </div>
              <p className="mt-2.5 text-xs leading-relaxed text-muted">
                确认任务卡和书单后，智能体会按“筛选—编排—撰写—检查”逐项生成活动包。完整流程即将上线，目前可以先在对话中梳理主题、检索候选书目。
              </p>
            </div>
            <div className="space-y-1">
              {deliverables.map(({ key, icon: Icon, title, desc }) => (
                <div key={key} className="flex items-start gap-3 rounded-xl px-2.5 py-2.5">
                  <Icon className="mt-0.5 size-4 shrink-0 text-subtle" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-[13px] font-medium">{title}</span>
                      <Badge>待生成</Badge>
                    </div>
                    <p className="mt-0.5 text-xs text-muted">{desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {tab === 'books' &&
          (candidates.length === 0 ? (
            <EmptyState title="还没有候选书目" description="在对话中描述主题，智能体检索馆藏后，候选书目会汇总在这里。" />
          ) : (
            <div className="divide-y divide-border px-4">
              {candidates.map((book) => (
                <BookRow key={book.id} book={book} />
              ))}
            </div>
          ))}

        {tab === 'checks' &&
          (issues.length === 0 ? (
            <EmptyState title="暂无待核对项" description="候选书目缺少索书号、摘要或来源链接，或来自示例书库时，会列在这里。" />
          ) : (
            <div className="space-y-2 p-4">
              {issues.map((book) => (
                <div key={book.id} className="rounded-xl border border-border p-3">
                  <p className="text-[13px] font-medium">《{book.title}》</p>
                  <ul className="mt-1.5 space-y-1 text-xs text-muted">
                    {book.isSample && (
                      <li className="flex items-center gap-1.5">
                        <TriangleAlert className="size-3 text-warning" /> 示例数据，正式使用前需替换为学校真实馆藏
                      </li>
                    )}
                    {book.missingFields.map((field) => (
                      <li key={field} className="flex items-center gap-1.5">
                        <TriangleAlert className="size-3 text-warning" /> 缺少{field}，需馆员补充或核对
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          ))}
      </div>
    </aside>
  );
}
