import {
  bookFieldKeys,
  type BookDraft,
  type BookFieldKey,
  type FieldOrigin,
  type ImportIssue,
} from '@yys/shared';

const listSplit = /\s*[,，;；、|｜]\s*|\s+\/\s+|\s*／\s*/;
const roleSuffix = /\s*(等著|等编著|等编|等译|主编|编著|编译|编|著|译|绘|撰)\s*$/;
const etAl = /\s*等$/;

export function splitAuthors(value: string): string[] {
  return value
    .split(listSplit)
    .map((name) => name.replace(roleSuffix, '').replace(etAl, '').trim())
    .filter(Boolean);
}

export function splitList(value: string): string[] {
  return value
    .split(listSplit)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function cleanTitle(value: string): string {
  return value
    .trim()
    .replace(/^《(.+)》$/, '$1')
    .replace(/\s+/g, ' ');
}

export function parseYear(value: string): number | undefined {
  const match = /(1[5-9]\d{2}|20\d{2})/.exec(value);
  return match ? Number(match[1]) : undefined;
}

export function cleanIsbn(value: string): { isbn?: string; valid: boolean } {
  const digits = value.replace(/[^0-9Xx]/g, '').toUpperCase();
  if (!digits) return { valid: true };
  return { isbn: digits, valid: digits.length === 10 || digits.length === 13 };
}

export function cleanUrl(value: string): { url?: string; valid: boolean } {
  const raw = value.trim().replace(/^<(.+)>$/, '$1');
  if (!raw) return { valid: true };
  const withScheme = /^www\./i.test(raw) ? `https://${raw}` : raw;
  try {
    const url = new URL(withScheme);
    return { url: url.toString(), valid: url.protocol === 'http:' || url.protocol === 'https:' };
  } catch {
    return { url: raw, valid: false };
  }
}

const normKey = (value: string): string =>
  value.toLowerCase().replace(/[\s·・.,，:：《》"'“”()（）]/g, '');

/** 同批次去重键：优先 ISBN，否则书名 + 第一作者 */
export function dedupeKey(draft: Pick<BookDraft, 'isbn' | 'title' | 'authors'>): string {
  if (draft.isbn) return `isbn:${draft.isbn}`;
  return `t:${normKey(draft.title)}|a:${normKey(draft.authors[0] ?? '')}`;
}

export interface NormalizeOutput {
  drafts: BookDraft[];
  skipped: number;
  duplicates: number;
  issues: ImportIssue[];
}

const MAX_ISSUES = 50;

export function normalizeRows(
  rows: Record<string, string>[],
  mapping: Partial<Record<BookFieldKey, string>>,
  options: { origin: FieldOrigin; at: string; isSample?: boolean },
): NormalizeOutput {
  const drafts: BookDraft[] = [];
  const issues: ImportIssue[] = [];
  const seen = new Set<string>();
  let skipped = 0;
  let duplicates = 0;
  const pushIssue = (row: number, message: string): void => {
    if (issues.length < MAX_ISSUES) issues.push({ row, message });
  };

  rows.forEach((row, index) => {
    const rowNo = index + 1;
    const get = (field: BookFieldKey): string => {
      const header = mapping[field];
      return header ? (row[header] ?? '').trim() : '';
    };

    const title = cleanTitle(get('title'));
    if (!title) {
      skipped++;
      pushIssue(rowNo, '缺少书名，已跳过');
      return;
    }

    const draft: BookDraft = {
      title,
      authors: splitAuthors(get('authors')),
      isSample: options.isSample ?? false,
      provenance: {},
    };

    const publisher = get('publisher');
    if (publisher) draft.publisher = publisher;
    const year = parseYear(get('pubYear'));
    if (year) draft.pubYear = year;

    const isbn = cleanIsbn(get('isbn'));
    if (isbn.isbn) draft.isbn = isbn.isbn;
    if (!isbn.valid) pushIssue(rowNo, `ISBN 位数不正确：${get('isbn')}`);

    for (const field of [
      'callNumber',
      'location',
      'availability',
      'summary',
      'docType',
      'responsibility',
      'otherTitles',
      'pubPlace',
      'language',
      'clcNumber',
      'extent',
      'catalogSource',
    ] as const) {
      const value = get(field);
      if (value) draft[field] = value;
    }

    const subjects = splitList(get('subjects'));
    if (subjects.length) draft.subjects = subjects;
    const keywords = splitList(get('keywords'));
    if (keywords.length) draft.keywords = keywords;

    for (const field of ['sourceUrl', 'coverUrl', 'catalogUrl'] as const) {
      const value = get(field);
      if (!value) continue;
      const url = cleanUrl(value);
      if (url.url) draft[field] = url.url;
      if (!url.valid) pushIssue(rowNo, `链接格式无法识别：${value}`);
    }

    if (draft.authors.length === 0) pushIssue(rowNo, `《${title}》缺少作者`);

    const key = dedupeKey(draft);
    if (seen.has(key)) {
      duplicates++;
      pushIssue(rowNo, `《${title}》与前面的记录重复，已跳过`);
      return;
    }
    seen.add(key);

    for (const field of bookFieldKeys) {
      const value = draft[field];
      const present = Array.isArray(value) ? value.length > 0 : value !== undefined && value !== '';
      if (present)
        draft.provenance[field] = { origin: options.origin, at: options.at, verified: false };
    }
    drafts.push(draft);
  });

  return { drafts, skipped, duplicates, issues };
}
