import type { ReactNode } from 'react';
import { BookMarked, ExternalLink } from 'lucide-react';
import {
  assessCompleteness,
  bookFieldLabels,
  type BookFieldKey,
  type BookRecord,
  type FieldProvenance,
} from '@yys/shared';
import { BookCover } from './BookCover';
import { Badge, Button } from './ui';

export type DetailBook = Pick<BookRecord, 'id' | 'title' | 'authors' | 'isSample'> &
  Partial<Omit<BookRecord, 'id' | 'title' | 'authors' | 'isSample'>>;

const originLabels: Record<FieldProvenance['origin'], string> = {
  import: '文件导入',
  manual: '手动录入',
  api: '校园接口',
  sample: '示例书库',
};

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[84px_1fr] gap-3 py-1.5 text-[13px]">
      <dt className="text-subtle">{label}</dt>
      <dd data-selectable className="min-w-0 break-words">
        {children}
      </dd>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-4">
      <h4 className="mb-1 text-xs font-medium tracking-wide text-subtle">{title}</h4>
      <dl className="divide-y divide-border rounded-xl border border-border px-3">{children}</dl>
    </section>
  );
}

const linkable = (url?: string): url is string => Boolean(url && /^https?:\/\//i.test(url));
const open = (url: string): void => void window.yys.shell.openExternal(url);

function Link({ url }: { url: string }) {
  return (
    <button className="text-left break-all text-accent hover:underline" onClick={() => open(url)}>
      {url}
    </button>
  );
}

/** 一本书的完整信息：封面、题名与责任说明、著录字段、馆藏、简介、来源与核对状态 */
export function BookDetail({
  book,
  sourceName,
  extra,
}: {
  book: DetailBook;
  sourceName?: string;
  extra?: ReactNode;
}) {
  const { missingRequired, missingRecommended } = assessCompleteness(book);
  const missing = [...missingRequired, ...missingRecommended];
  const provenance = Object.entries(book.provenance ?? {}) as [BookFieldKey, FieldProvenance][];
  const origins = [...new Set(provenance.map(([, p]) => originLabels[p.origin]))];
  const verified = provenance
    .filter(([, p]) => p.verified)
    .map(([field]) => bookFieldLabels[field]);
  const sampleCallNumber = book.isSample && book.callNumber?.startsWith('示例-');
  // 书名已含副题名时不再重复显示
  const otherTitles = book.otherTitles
    ?.split('；')
    .filter((part) => !book.title.includes(part.split('：').pop() ?? part))
    .join('；');
  const hasCataloging = Boolean(
    book.responsibility ||
    book.isbn ||
    book.pubPlace ||
    book.keywords?.length ||
    book.language ||
    book.clcNumber ||
    book.extent,
  );

  return (
    <div className="flex gap-6">
      <div className="flex w-40 shrink-0 flex-col items-center gap-2">
        <BookCover book={book} size="lg" />
        {linkable(book.catalogUrl) && (
          <Button
            size="sm"
            variant="outline"
            className="w-full"
            onClick={() => open(book.catalogUrl!)}
          >
            <BookMarked className="size-3.5" /> 查看书目记录
          </Button>
        )}
        {linkable(book.sourceUrl) && (
          <Button
            size="sm"
            variant="outline"
            className="w-full"
            onClick={() => open(book.sourceUrl!)}
          >
            <ExternalLink className="size-3.5" /> 打开来源页面
          </Button>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <h3 data-selectable className="text-[17px] leading-snug font-semibold">
            《{book.title}》
          </h3>
          {book.isSample && <Badge>示例</Badge>}
          {missingRequired.length > 0 ? (
            <Badge tone="danger">缺必填字段</Badge>
          ) : missing.length > 0 ? (
            <Badge tone="warning">缺 {missing.length} 项</Badge>
          ) : (
            <Badge tone="success">信息完整</Badge>
          )}
        </div>
        {otherTitles && (
          <p data-selectable className="mt-0.5 text-[13px] text-muted">
            {otherTitles}
          </p>
        )}
        <dl className="mt-2">
          {book.docType && <Row label="文献类型">{book.docType}</Row>}
          <Row label="责任者">
            {book.authors.join('、') || <span className="text-warning">待核对</span>}
          </Row>
          {book.publisher && <Row label="出版发行者">{book.publisher}</Row>}
          {book.pubYear && <Row label="出版发行时间">{book.pubYear}</Row>}
          {book.catalogSource && <Row label="书目来源">{book.catalogSource}</Row>}
        </dl>

        {hasCataloging && (
          <Section title="详细信息">
            {book.responsibility && <Row label="所有责任者">{book.responsibility}</Row>}
            {book.isbn && <Row label="标识号">ISBN：{book.isbn}</Row>}
            {book.pubPlace && <Row label="出版发行地">{book.pubPlace}</Row>}
            {book.keywords && book.keywords.length > 0 && (
              <Row label="关键词">{book.keywords.join('；')}</Row>
            )}
            {book.language && <Row label="语种">{book.language}</Row>}
            {book.clcNumber && <Row label="分类">中图分类：{book.clcNumber}</Row>}
            {book.extent && <Row label="载体形态">{book.extent}</Row>}
          </Section>
        )}

        <Section title="馆藏信息">
          <Row label="索书号">
            {book.callNumber ??
              (book.isSample && book.catalogSource?.startsWith('中国国家图书馆') ? (
                <span className="text-warning">
                  国图索书号待获取
                  <span className="ml-1.5 text-xs text-subtle">
                    （可在书目记录的“馆藏信息”中查看）
                  </span>
                </span>
              ) : (
                <span className="text-warning">待核对</span>
              ))}
            {sampleCallNumber && (
              <span className="ml-1.5 text-xs text-subtle">（示例编号，非真实馆藏）</span>
            )}
          </Row>
          {book.location && <Row label="馆藏地点">{book.location}</Row>}
          {book.availability && <Row label="在架状态">{book.availability}</Row>}
        </Section>

        <Section title="内容与来源">
          <Row label="内容简介">
            {book.summary ? (
              <span className="leading-relaxed">{book.summary}</span>
            ) : (
              <span className="text-warning">暂无，导读只能依据书名，需馆员补充</span>
            )}
          </Row>
          {book.subjects && book.subjects.length > 0 && (
            <Row label="主题词">
              <span className="flex flex-wrap gap-1">
                {book.subjects.map((s) => (
                  <Badge key={s}>{s}</Badge>
                ))}
              </span>
            </Row>
          )}
          {linkable(book.catalogUrl) && (
            <Row label="书目记录">
              <Link url={book.catalogUrl} />
            </Row>
          )}
          <Row label="来源链接">
            {linkable(book.sourceUrl) ? (
              <Link url={book.sourceUrl} />
            ) : book.sourceUrl ? (
              <span className="text-danger">{book.sourceUrl}（格式无法识别）</span>
            ) : (
              <span className="text-danger">缺失</span>
            )}
          </Row>
          {(sourceName || origins.length > 0) && (
            <Row label="数据来源">
              {[sourceName, origins.join('、')].filter(Boolean).join(' · ')}
              {verified.length > 0 ? (
                <span className="ml-1.5 text-xs text-success">已核对：{verified.join('、')}</span>
              ) : (
                <span className="ml-1.5 text-xs text-subtle">尚未经馆员核对</span>
              )}
            </Row>
          )}
          {missing.length > 0 && (
            <Row label="待补充">{missing.map((f) => bookFieldLabels[f]).join('、')}</Row>
          )}
        </Section>
        {extra}
      </div>
    </div>
  );
}
