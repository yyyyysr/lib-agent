import { useState } from 'react';
import { briefSchema, type Brief } from '@yys/shared';
import { Badge, Button, Field, Input, Textarea } from '../../components/ui';
import { cn } from '../../lib/cn';
import { useRpc } from '../../lib/use-rpc';

export const emptyBrief: Brief = briefSchema.parse({ theme: '待填写', audience: '待填写' });

/** 策展需求表单：主题、目标读者、活动时间、场地、期望书目数量、特殊要求、选书来源 */
export function BriefForm({
  initial,
  readOnly,
  submitLabel,
  onSubmit,
  secondary,
}: {
  initial?: Brief;
  readOnly?: boolean;
  submitLabel: string;
  onSubmit: (brief: Brief) => Promise<void>;
  secondary?: React.ReactNode;
}) {
  const [form, setForm] = useState(() => {
    const base = initial ?? { ...emptyBrief, theme: '', audience: '' };
    return { ...base, bookCount: String(base.bookCount) };
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { data: sources = [] } = useRpc('books.sources', undefined, { topics: ['books.changed'] });

  const set =
    (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm((f) => ({ ...f, [key]: e.target.value }));
  const toggleSource = (id: string): void =>
    setForm((f) => ({
      ...f,
      sourceIds: f.sourceIds.includes(id)
        ? f.sourceIds.filter((s) => s !== id)
        : [...f.sourceIds, id],
    }));

  const submit = async (): Promise<void> => {
    setError(null);
    const parsed = briefSchema.safeParse({ ...form, bookCount: Number(form.bookCount) });
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? '请检查填写内容');
    setBusy(true);
    try {
      await onSubmit(parsed.data);
    } finally {
      setBusy(false);
    }
  };

  const selectedCount = form.sourceIds.length
    ? sources.filter((s) => form.sourceIds.includes(s.id)).reduce((n, s) => n + s.bookCount, 0)
    : sources.reduce((n, s) => n + s.bookCount, 0);

  return (
    <fieldset disabled={readOnly} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <Field label="主题" hint="例如：新生如何识别 AI 生成的信息">
          <Input value={form.theme} onChange={set('theme')} placeholder="书展想讨论什么" />
        </Field>
        <Field label="目标读者" hint="例如：大一新生、求职季的大四学生">
          <Input value={form.audience} onChange={set('audience')} placeholder="写给谁看" />
        </Field>
      </div>
      <div className="grid grid-cols-4 gap-4">
        <Field label="活动日期">
          <Input type="date" value={form.eventDate} onChange={set('eventDate')} />
        </Field>
        <Field label="活动时间">
          <Input value={form.eventTime} onChange={set('eventTime')} placeholder="14:00–15:00" />
        </Field>
        <Field label="场地">
          <Input value={form.venue} onChange={set('venue')} placeholder="图书馆一楼大厅" />
        </Field>
        <Field label="期望书目数量">
          <Input
            type="number"
            min={3}
            max={30}
            value={form.bookCount}
            onChange={set('bookCount')}
          />
        </Field>
      </div>
      <Field
        label="特殊要求（可选）"
        hint="例如：避免过于学术的书；需要包含一本本校教师的著作；配合新生入学教育"
      >
        <Textarea rows={3} value={form.requirements} onChange={set('requirements')} />
      </Field>
      <div>
        <p className="mb-1.5 text-[13px] font-medium">从哪些书目来源中选书</p>
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => setForm((f) => ({ ...f, sourceIds: [] }))}
            className={cn(
              'rounded-full border px-3 py-1 text-xs',
              form.sourceIds.length === 0
                ? 'border-fg bg-fg text-bg'
                : 'border-border hover:bg-surface-hover',
            )}
          >
            全部书目
          </button>
          {sources.map((source) => (
            <button
              type="button"
              key={source.id}
              onClick={() => toggleSource(source.id)}
              className={cn(
                'flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs',
                form.sourceIds.includes(source.id)
                  ? 'border-fg bg-fg text-bg'
                  : 'border-border hover:bg-surface-hover',
              )}
            >
              {source.name} <span className="opacity-60">{source.bookCount}</span>
              {source.kind === 'sample' && <Badge className="ml-0.5">示例</Badge>}
            </button>
          ))}
        </div>
        <p className="mt-1.5 text-xs text-subtle">
          共 {selectedCount} 本可选。正式活动请先在“书库”导入学校真实馆藏。
        </p>
      </div>
      {error && (
        <p className="rounded-lg bg-danger-soft px-3 py-2 text-[13px] text-danger">{error}</p>
      )}
      {!readOnly && (
        <div className="flex items-center justify-end gap-2 pt-1">
          {secondary}
          <Button variant="primary" loading={busy} onClick={() => void submit()}>
            {submitLabel}
          </Button>
        </div>
      )}
    </fieldset>
  );
}
