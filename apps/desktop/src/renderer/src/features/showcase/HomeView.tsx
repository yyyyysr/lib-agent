import {
  ArrowLeft,
  Landmark,
  BookOpen,
  CalendarDays,
  ExternalLink,
  MapPin,
  MessageSquareQuote,
  Sparkles,
  Star,
  Users,
} from 'lucide-react';
import { workflowSteps, type ShowcaseExhibition } from '@yys/shared';
import { TopBar } from '../../app/TopBar';
import { AppMark } from '../../components/AppMark';
import { Poster } from '../../components/Poster';
import { Badge, Button, EmptyState, Spinner } from '../../components/ui';
import { cn } from '../../lib/cn';
import { errorText } from '../../lib/core-client';
import { countdown, formatDate, formatDateTime } from '../../lib/format';
import { useBranding } from '../../lib/use-branding';
import { useRpc } from '../../lib/use-rpc';
import { useAppStore } from '../../store/app-store';
import { useAuth } from '../../store/auth-store';

function InfoRow({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <p className="flex items-center gap-2 text-[14px]">
      <span className="text-muted">{icon}</span>
      {children}
    </p>
  );
}

function SectionTitle({ children, hint }: { children: React.ReactNode; hint?: React.ReactNode }) {
  return (
    <div className="mb-4 flex items-baseline justify-between">
      <h2 className="text-lg font-semibold">{children}</h2>
      {hint && <span className="text-[13px] text-subtle">{hint}</span>}
    </div>
  );
}

export function ShowcaseDetail({
  exhibition,
  latest,
}: {
  exhibition: ShowcaseExhibition;
  latest?: boolean;
}) {
  const { brief, package: pkg } = exhibition;
  const { organizer } = useBranding();
  const when = countdown(brief.eventDate);
  const allBooks = exhibition.sections.flatMap((s) => s.books);
  const hasResults =
    exhibition.execution.participants > 0 ||
    exhibition.feedbackStats.count > 0 ||
    exhibition.retrospective;

  return (
    <div className="mx-auto w-full max-w-[1080px] space-y-12 px-8 pt-4 pb-16">
      {/* 海报与活动预告 */}
      <section className="flex gap-10">
        <Poster
          poster={pkg.poster}
          brief={brief}
          bookTitles={allBooks.map((b) => b.book.title)}
          organizer={organizer}
          scale={0.82}
        />
        <div className="min-w-0 flex-1 pt-2">
          <div className="flex flex-wrap items-center gap-2">
            {latest && <Badge tone="accent">最新一期</Badge>}
            {when && (
              <Badge tone={when.tone === 'past' ? 'neutral' : 'warning'}>{when.label}</Badge>
            )}
            {exhibition.status === 'completed' && <Badge tone="success">已复盘</Badge>}
          </div>
          <h1 className="mt-3 text-[32px] leading-tight font-semibold tracking-tight">
            {exhibition.title}
          </h1>
          {exhibition.subtitle && (
            <p className="mt-1.5 text-lg text-muted">{exhibition.subtitle}</p>
          )}
          <div className="mt-5 space-y-2">
            <InfoRow icon={<CalendarDays className="size-4" />}>
              {[formatDate(brief.eventDate), brief.eventTime].filter(Boolean).join(' ') ||
                '时间待定'}
            </InfoRow>
            <InfoRow icon={<MapPin className="size-4" />}>{brief.venue || '地点待定'}</InfoRow>
            <InfoRow icon={<Landmark className="size-4" />}>主办：{organizer}</InfoRow>
            <InfoRow icon={<Users className="size-4" />}>面向 {brief.audience}</InfoRow>
            <InfoRow icon={<BookOpen className="size-4" />}>
              {allBooks.length} 本馆藏 · {exhibition.sections.length} 个展区 · 策展：
              {exhibition.owner.name}
              {exhibition.owner.department ? `（${exhibition.owner.department}）` : ''}
            </InfoRow>
          </div>
          <p data-selectable className="mt-5 text-[15px] leading-relaxed whitespace-pre-wrap">
            {exhibition.introduction}
          </p>
          <div className="mt-5 rounded-2xl bg-surface p-4">
            <p className="text-[13px] font-medium">活动报名</p>
            <p
              data-selectable
              className="mt-1 text-[13px] leading-relaxed whitespace-pre-wrap text-muted"
            >
              {pkg.promotion.signupIntro}
            </p>
          </div>
        </div>
      </section>

      {/* 展览内容 */}
      <section>
        <SectionTitle hint={`上线于 ${formatDateTime(exhibition.publishedAt)}`}>
          展览内容
        </SectionTitle>
        <div className="space-y-8">
          {exhibition.sections.map((section, i) => (
            <div key={section.id}>
              <div className="mb-3 flex items-baseline gap-3">
                <span className="text-[13px] font-semibold text-accent">第 {i + 1} 展区</span>
                <h3 className="text-[17px] font-semibold">{section.title}</h3>
              </div>
              {section.panelText && (
                <p
                  data-selectable
                  className="mb-4 max-w-3xl text-[14px] leading-relaxed text-muted"
                >
                  {section.panelText}
                </p>
              )}
              <div className="grid grid-cols-2 gap-3">
                {section.books.map(({ book, guide }) => (
                  <article key={book.id} className="rounded-2xl border border-border p-4">
                    <div className="flex items-start gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="font-medium">《{book.title}》</p>
                        <p className="mt-0.5 text-xs text-muted">
                          {book.authors.join('、')}
                          {book.callNumber && ` · 索书号 ${book.callNumber}`}
                        </p>
                      </div>
                      {book.isSample && <Badge>示例</Badge>}
                      {book.sourceUrl && /^https?:\/\//.test(book.sourceUrl) && (
                        <button
                          aria-label="查看馆藏"
                          onClick={() => void window.yys.shell.openExternal(book.sourceUrl!)}
                          className="text-subtle hover:text-fg"
                        >
                          <ExternalLink className="size-3.5" />
                        </button>
                      )}
                    </div>
                    <p data-selectable className="mt-2.5 text-[13px] leading-relaxed">
                      {guide}
                    </p>
                  </article>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* 活动安排 */}
      <section>
        <SectionTitle hint={`约 ${exhibition.activity.durationMinutes} 分钟`}>
          线下活动：{exhibition.activity.format}
        </SectionTitle>
        <div className="grid grid-cols-[1fr_320px] gap-6">
          <ol className="space-y-3">
            {exhibition.activity.segments.map((segment, i) => (
              <li key={i} className="flex gap-4 rounded-2xl border border-border p-4">
                <span className="w-14 shrink-0 text-[13px] font-semibold text-accent">
                  {segment.minutes} 分钟
                </span>
                <div>
                  <p className="font-medium">{segment.title}</p>
                  <p className="mt-0.5 text-[13px] text-muted">{segment.description}</p>
                </div>
              </li>
            ))}
          </ol>
          <div className="rounded-2xl bg-surface p-4">
            <p className="text-[13px] font-medium">讨论问题</p>
            <ul className="mt-2 space-y-2 text-[13px] text-muted">
              {exhibition.activity.questions.map((q) => (
                <li key={q}>· {q}</li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* 活动成果 */}
      <section>
        <SectionTitle>活动成果</SectionTitle>
        {hasResults ? (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-3">
              {[
                { icon: Users, label: '参与人数', value: exhibition.execution.participants || '—' },
                {
                  icon: MessageSquareQuote,
                  label: '读者反馈',
                  value: `${exhibition.feedbackStats.count} 条`,
                },
                {
                  icon: Star,
                  label: '平均评分',
                  value: exhibition.feedbackStats.averageRating
                    ? `${exhibition.feedbackStats.averageRating} / 5`
                    : '—',
                },
              ].map(({ icon: Icon, label, value }) => (
                <div key={label} className="rounded-2xl border border-border p-4">
                  <Icon className="size-4 text-accent" />
                  <p className="mt-2 text-2xl font-semibold">{value}</p>
                  <p className="text-xs text-muted">{label}</p>
                </div>
              ))}
            </div>
            {exhibition.feedbackStats.highlights.length > 0 && (
              <div className="grid grid-cols-3 gap-3">
                {exhibition.feedbackStats.highlights.map((quote) => (
                  <blockquote
                    key={quote}
                    className="rounded-2xl bg-surface p-4 text-[13px] leading-relaxed"
                  >
                    “{quote}”
                  </blockquote>
                ))}
              </div>
            )}
            {exhibition.retrospective && (
              <div className="rounded-2xl border border-border p-5">
                <p className="text-[13px] font-medium">复盘总结</p>
                <p data-selectable className="mt-1.5 text-[14px] leading-relaxed">
                  {exhibition.retrospective.summary}
                </p>
                <div className="mt-4 grid grid-cols-2 gap-6 text-[13px]">
                  <div>
                    <p className="font-medium text-success">有效的做法</p>
                    <ul className="mt-1.5 space-y-1 text-muted">
                      {exhibition.retrospective.worked.map((w) => (
                        <li key={w}>· {w}</li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <p className="font-medium text-accent">下一期改进</p>
                    <ul className="mt-1.5 space-y-1 text-muted">
                      {exhibition.retrospective.nextTime.map((w) => (
                        <li key={w}>· {w}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>
            )}
          </div>
        ) : (
          <p className="rounded-2xl border border-dashed border-border-strong p-6 text-center text-[13px] text-muted">
            活动结束后，参与情况、读者反馈与复盘总结会展示在这里。
          </p>
        )}
      </section>
    </div>
  );
}

function PastExhibitions({ excludeId }: { excludeId?: string }) {
  const navigate = useAppStore((s) => s.navigate);
  const { data = [] } = useRpc('showcase.list', undefined, { topics: ['showcase.changed'] });
  const past = data.filter((e) => e.id !== excludeId);
  if (past.length === 0) return null;
  return (
    <section className="mx-auto w-full max-w-[1080px] px-8 pb-16">
      <SectionTitle>往期书展</SectionTitle>
      <div className="grid grid-cols-3 gap-3">
        {past.map((e) => (
          <button
            key={e.id}
            onClick={() => navigate({ name: 'showcase', id: e.id })}
            className="rounded-2xl border border-border p-4 text-left hover:bg-surface-hover"
          >
            <p className="font-medium">{e.title}</p>
            <p className="mt-1 text-xs text-muted">
              {e.owner.name} · {formatDate(e.eventDate) || formatDateTime(e.publishedAt)}
            </p>
          </button>
        ))}
      </div>
    </section>
  );
}

function Welcome() {
  const navigate = useAppStore((s) => s.navigate);
  const { organizer } = useBranding();
  const { user, openPrompt } = useAuth();
  return (
    <div className="mx-auto w-full max-w-[860px] px-8 py-12">
      <div className="rounded-3xl bg-surface p-10">
        <Sparkles className="size-6 text-accent" />
        <h1 className="mt-4 text-[28px] font-semibold tracking-tight">还没有上线的书展</h1>
        <p className="mt-2 max-w-xl text-[15px] leading-relaxed text-muted">
          一页书展帮助{organizer}馆员与学生团队，围绕真实馆藏快速完成一场 8–12
          本书的主题微书展：智能体负责选书、编排、撰写与检查，馆员核对，上级审批后在这里上线展示。
        </p>
        <div className="mt-6 flex gap-2">
          <Button
            variant="primary"
            size="lg"
            onClick={() => (user ? navigate({ name: 'curation' }) : openPrompt('register'))}
          >
            发起第一场策展
          </Button>
          {!user && (
            <Button variant="outline" size="lg" onClick={() => openPrompt('login')}>
              登录
            </Button>
          )}
        </div>
      </div>
      <ol className="mt-8 grid grid-cols-3 gap-3">
        {workflowSteps.map((step, i) => (
          <li
            key={step.key}
            className="flex items-center gap-3 rounded-2xl border border-border p-4"
          >
            <span
              className={cn(
                'flex size-7 items-center justify-center rounded-full bg-accent-soft text-[13px] font-semibold text-accent',
              )}
            >
              {i + 1}
            </span>
            <span className="text-[14px]">{step.label}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

export function HomeView() {
  const { organizer } = useBranding();
  const { data, loading, error } = useRpc('showcase.latest', undefined, {
    topics: ['showcase.changed'],
  });
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <TopBar
        title={
          <>
            <AppMark />
            <span>一页书展</span>
            <span className="text-[13px] font-normal text-subtle">{organizer} · 主题书展</span>
          </>
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        {loading && !data ? (
          <div className="flex h-full items-center justify-center">
            <Spinner />
          </div>
        ) : error ? (
          <EmptyState title="加载失败" description={errorText(error).message} />
        ) : data ? (
          <>
            <ShowcaseDetail exhibition={data} latest />
            <PastExhibitions excludeId={data.id} />
          </>
        ) : (
          <Welcome />
        )}
      </div>
    </div>
  );
}

export function ShowcasePage({ id }: { id: string }) {
  const navigate = useAppStore((s) => s.navigate);
  const { data, error } = useRpc('showcase.get', { id }, { topics: ['showcase.changed'] });
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <TopBar
        title={
          <button
            onClick={() => navigate({ name: 'home' })}
            className="no-drag flex items-center gap-1.5 hover:text-muted"
          >
            <ArrowLeft className="size-4" /> 往期书展
          </button>
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        {error ? (
          <EmptyState title="无法打开" description={errorText(error).message} />
        ) : data ? (
          <ShowcaseDetail exhibition={data} />
        ) : (
          <Spinner className="m-auto" />
        )}
      </div>
    </div>
  );
}
