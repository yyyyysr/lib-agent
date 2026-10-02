import type { ReactNode } from 'react';
import { ExternalLink } from 'lucide-react';
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
  Partial<
    Pick<
      BookRecord,
      | 'publisher'
      | 'pubYear'
      | 'isbn'
      | 'callNumber'
      | 'location'
      | 'availability'
      | 'subjects'
      | 'summary'
      | 'sourceUrl'
      | 'coverUrl'
      | 'provenance'
    >
  >;

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

const linkable = (url?: string): url is string => Boolean(url && /^https?:\/\//i.test(url));

/** 一本书的完整信息：封面、书目字段、字段来源与核对状态、完整度 */
export function BookDetail({
  book,
  sourceName,
  extra,
}: {
  book: DetailBook;
  sourceName?: string;
  extra?: ReactNode;
}) {
  const { missingRequired, missingRecommended } = assessCompleteness({
    title: book.title,
    authors: book.authors,
    publisher: book.publisher,
    pubYear: book.pubYear,
    isbn: book.isbn,
    callNumber: book.callNumber,
    location: book.location,
    availability: book.availability,
    subjects: book.subjects,
    summary: book.summary,
    sourceUrl: book.sourceUrl,
    coverUrl: book.coverUrl,
  });
  const missing = [...missingRequired, ...missingRecommended];
  const provenance = Object.entries(book.provenance ?? {}) as [BookFieldKey, FieldProvenance][];
  const origins = [...new Set(provenance.map(([, p]) => originLabels[p.origin]))];
  const verified = provenance
    .filter(([, p]) => p.verified)
    .map(([field]) => bookFieldLabels[field]);

  return (
    <div className="flex gap-6">
      <div className="flex shrink-0 flex-col items-center gap-3">
        <BookCover book={book} size="lg" />
        {linkable(book.sourceUrl) && (
          <Button
            size="sm"
            variant="outline"
            className="w-full"
            onClick={() => void window.yys.shell.openExternal(book.sourceUrl!)}
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
        <dl className="mt-2 divide-y divide-border">
          <Row label="作者">
            {book.authors.join('、') || <span className="text-warning">待核对</span>}
          </Row>
          {(book.publisher || book.pubYear) && (
            <Row label="出版">
              {[book.publisher, book.pubYear && `${book.pubYear} 年`].filter(Boolean).join(' · ')}
            </Row>
          )}
          {book.isbn && <Row label="ISBN">{book.isbn}</Row>}
          <Row label="索书号">
            {book.callNumber ?? <span className="text-warning">待核对</span>}
            {book.isSample && book.callNumber && (
              <span className="ml-1.5 text-xs text-subtle">（示例编号，非真实馆藏）</span>
            )}
          </Row>
          {(book.location || book.availability) && (
            <Row label="馆藏">{[book.location, book.availability].filter(Boolean).join(' · ')}</Row>
          )}
          {book.subjects && book.subjects.length > 0 && (
            <Row label="主题词">
              <span className="flex flex-wrap gap-1">
                {book.subjects.map((s) => (
                  <Badge key={s}>{s}</Badge>
                ))}
              </span>
            </Row>
          )}
          <Row label="内容简介">
            {book.summary ? (
              <span className="leading-relaxed">{book.summary}</span>
            ) : (
              <span className="text-warning">暂无，导读只能依据书名，需馆员补充</span>
            )}
          </Row>
          {linkable(book.sourceUrl) ? (
            <Row label="来源链接">
              <button
                className="text-left text-accent hover:underline"
                onClick={() => void window.yys.shell.openExternal(book.sourceUrl!)}
              >
                {book.sourceUrl}
              </button>
            </Row>
          ) : (
            <Row label="来源链接">
              {book.sourceUrl ? (
                <span className="text-danger">{book.sourceUrl}（格式无法识别）</span>
              ) : (
                <span className="text-danger">缺失</span>
              )}
            </Row>
          )}
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
        </dl>
        {extra}
      </div>
    </div>
  );
}
