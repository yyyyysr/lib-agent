import {
  newId,
  nowIso,
  type BookDraft,
  type BookQuery,
  type BookRecord,
  type BookSourceInfo,
  type BookSourceKind,
  type Page,
} from '@yys/shared';
import { fromJson, toJson, type AppDatabase, type Params } from '../database';

interface BookRow {
  id: string;
  source_id: string;
  external_id: string | null;
  title: string;
  authors: string;
  publisher: string | null;
  pub_year: number | null;
  isbn: string | null;
  call_number: string | null;
  location: string | null;
  availability: string | null;
  subjects: string | null;
  summary: string | null;
  source_url: string | null;
  cover_url: string | null;
  doc_type: string | null;
  responsibility: string | null;
  other_titles: string | null;
  pub_place: string | null;
  keywords: string | null;
  language: string | null;
  clc_number: string | null;
  extent: string | null;
  catalog_source: string | null;
  catalog_url: string | null;
  is_sample: number;
  provenance: string;
  created_at: string;
  updated_at: string;
}

const opt = <T>(value: T | null): T | undefined => (value === null ? undefined : value);

const toRecord = (row: BookRow): BookRecord => ({
  id: row.id,
  sourceId: row.source_id,
  externalId: opt(row.external_id),
  title: row.title,
  authors: fromJson<string[]>(row.authors, []),
  publisher: opt(row.publisher),
  pubYear: opt(row.pub_year),
  isbn: opt(row.isbn),
  callNumber: opt(row.call_number),
  location: opt(row.location),
  availability: opt(row.availability),
  subjects: row.subjects ? fromJson<string[]>(row.subjects, []) : undefined,
  summary: opt(row.summary),
  sourceUrl: opt(row.source_url),
  coverUrl: opt(row.cover_url),
  docType: opt(row.doc_type),
  responsibility: opt(row.responsibility),
  otherTitles: opt(row.other_titles),
  pubPlace: opt(row.pub_place),
  keywords: row.keywords ? fromJson<string[]>(row.keywords, []) : undefined,
  language: opt(row.language),
  clcNumber: opt(row.clc_number),
  extent: opt(row.extent),
  catalogSource: opt(row.catalog_source),
  catalogUrl: opt(row.catalog_url),
  isSample: row.is_sample === 1,
  provenance: fromJson(row.provenance, {}),
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const escapeLike = (value: string): string => value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
const ftsPhrase = (value: string): string => `"${value.replaceAll('"', '""')}"`;

export class BookRepo {
  constructor(private readonly db: AppDatabase) {}

  listSources(): BookSourceInfo[] {
    return this.db
      .all<{
        id: string;
        kind: BookSourceKind;
        name: string;
        meta: string | null;
        created_by: string | null;
        created_at: string;
        book_count: number;
      }>(
        `SELECT s.*, (SELECT COUNT(*) FROM books b WHERE b.source_id = s.id) AS book_count
         FROM book_sources s ORDER BY CASE s.kind WHEN 'sample' THEN 0 ELSE 1 END, s.created_at DESC`,
      )
      .map((row) => ({
        id: row.id,
        kind: row.kind,
        name: row.name,
        bookCount: Number(row.book_count),
        createdBy: row.created_by ?? undefined,
        createdAt: row.created_at,
        meta: row.meta ? fromJson<Record<string, unknown>>(row.meta, {}) : undefined,
      }));
  }

  createSource(input: {
    id?: string;
    kind: BookSourceKind;
    name: string;
    meta?: Record<string, unknown>;
    createdBy?: string;
  }): string {
    const id = input.id ?? newId('src');
    this.db.run(
      'INSERT INTO book_sources(id, kind, name, meta, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      id,
      input.kind,
      input.name,
      input.meta ? toJson(input.meta) : null,
      input.createdBy ?? null,
      nowIso(),
    );
    return id;
  }

  totalBooks(): number {
    return Number(this.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM books')?.n ?? 0);
  }

  countIn(sourceIds: string[]): number {
    if (sourceIds.length === 0) return this.totalBooks();
    return Number(
      this.db.get<{ n: number }>(
        `SELECT COUNT(*) AS n FROM books WHERE source_id IN (${sourceIds.map(() => '?').join(',')})`,
        ...sourceIds,
      )?.n ?? 0,
    );
  }

  deleteSource(id: string): void {
    this.db.run('DELETE FROM book_sources WHERE id = ?', id);
  }

  /** 同一来源内 externalId 相同则更新，否则插入 */
  insertDrafts(sourceId: string, drafts: (BookDraft & { externalId?: string })[]): number {
    const at = nowIso();
    const stmt = this.db.raw.prepare(
      `INSERT INTO books(id, source_id, external_id, title, authors, publisher, pub_year, isbn, call_number, location,
         availability, subjects, summary, source_url, cover_url, doc_type, responsibility, other_titles, pub_place,
         keywords, language, clc_number, extent, catalog_source, catalog_url, is_sample, provenance, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(source_id, external_id) DO UPDATE SET
         title = excluded.title, authors = excluded.authors, publisher = excluded.publisher, pub_year = excluded.pub_year,
         isbn = excluded.isbn, call_number = excluded.call_number, location = excluded.location,
         availability = excluded.availability, subjects = excluded.subjects, summary = excluded.summary,
         source_url = excluded.source_url, cover_url = excluded.cover_url, doc_type = excluded.doc_type,
         responsibility = excluded.responsibility, other_titles = excluded.other_titles, pub_place = excluded.pub_place,
         keywords = excluded.keywords, language = excluded.language, clc_number = excluded.clc_number,
         extent = excluded.extent, catalog_source = excluded.catalog_source, catalog_url = excluded.catalog_url,
         is_sample = excluded.is_sample,
         provenance = excluded.provenance, updated_at = excluded.updated_at`,
    );
    return this.db.transaction(() => {
      for (const d of drafts) {
        stmt.run(
          newId('book'),
          sourceId,
          d.externalId ?? null,
          d.title,
          toJson(d.authors),
          d.publisher ?? null,
          d.pubYear ?? null,
          d.isbn ?? null,
          d.callNumber ?? null,
          d.location ?? null,
          d.availability ?? null,
          d.subjects ? toJson(d.subjects) : null,
          d.summary ?? null,
          d.sourceUrl ?? null,
          d.coverUrl ?? null,
          d.docType ?? null,
          d.responsibility ?? null,
          d.otherTitles ?? null,
          d.pubPlace ?? null,
          d.keywords ? toJson(d.keywords) : null,
          d.language ?? null,
          d.clcNumber ?? null,
          d.extent ?? null,
          d.catalogSource ?? null,
          d.catalogUrl ?? null,
          d.isSample ? 1 : 0,
          toJson(d.provenance),
          at,
          at,
        );
      }
      return drafts.length;
    });
  }

  getByIds(ids: string[]): BookRecord[] {
    if (ids.length === 0) return [];
    const rows = this.db.all<BookRow>(
      `SELECT * FROM books WHERE id IN (${ids.map(() => '?').join(',')})`,
      ...ids,
    );
    const byId = new Map(rows.map((row) => [row.id, toRecord(row)]));
    return ids.map((id) => byId.get(id)).filter((book): book is BookRecord => Boolean(book));
  }

  /**
   * 空格分隔的多个关键词按 AND 组合；≥3 个字的词走 FTS5 trigram 索引，
   * 更短的词（中文常见的两字词）回退到 LIKE。
   */
  search(query: BookQuery): Page<BookRecord> {
    const where: string[] = [];
    const params: Params = [];
    const terms = (query.text ?? '').trim().split(/\s+/).filter(Boolean).slice(0, 8);
    for (const term of terms) {
      const like = `%${escapeLike(term)}%`;
      const isbnLike = `%${escapeLike(term.replaceAll('-', ''))}%`;
      // 著录字段不在全文索引中，按 ISBN（忽略连字符）、索书号、中图分类号、关键词单独匹配
      const catalog =
        "REPLACE(b.isbn, '-', '') LIKE ? ESCAPE '\\' OR b.call_number LIKE ? ESCAPE '\\' OR b.clc_number LIKE ? ESCAPE '\\' OR b.keywords LIKE ? ESCAPE '\\'";
      if ([...term].length >= 3) {
        where.push(
          `(b.rowid IN (SELECT rowid FROM books_fts WHERE books_fts MATCH ?) OR ${catalog})`,
        );
        params.push(ftsPhrase(term), isbnLike, like, like, like);
      } else {
        where.push(
          `(b.title LIKE ? ESCAPE '\\' OR b.authors LIKE ? ESCAPE '\\' OR b.subjects LIKE ? ESCAPE '\\' OR b.summary LIKE ? ESCAPE '\\' OR ${catalog})`,
        );
        params.push(like, like, like, like, isbnLike, like, like, like);
      }
    }
    if (query.sourceIds?.length) {
      where.push(`b.source_id IN (${query.sourceIds.map(() => '?').join(',')})`);
      params.push(...query.sourceIds);
    }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const total = Number(
      this.db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM books b ${clause}`, ...params)?.n ?? 0,
    );

    const first = terms[0];
    const order = first
      ? "ORDER BY (b.title LIKE ? ESCAPE '\\') DESC, b.external_id, b.created_at"
      : 'ORDER BY b.external_id, b.created_at';
    const orderParams: Params = first ? [`%${escapeLike(first)}%`] : [];
    const limit = query.limit ?? 50;
    const offset = query.offset ?? 0;
    const rows = this.db.all<BookRow>(
      `SELECT b.* FROM books b ${clause} ${order} LIMIT ? OFFSET ?`,
      ...params,
      ...orderParams,
      limit,
      offset,
    );
    return { items: rows.map(toRecord), total };
  }
}
