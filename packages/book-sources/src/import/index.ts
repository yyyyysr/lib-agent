import {
  AppError,
  supportedImportExtensions,
  type BookDraft,
  type BookFieldKey,
  type ImportFormat,
  type ImportIssue,
} from '@yys/shared';
import type { RawTable } from '../types';
import { decodeText } from './decode';
import { suggestMapping } from './mapping';
import { normalizeRows } from './normalize';
import { detectFormat, parseDelimited, parseJson, parseTxt, parseXlsx } from './parsers';

export { decodeText } from './decode';
export { suggestMapping } from './mapping';
export { cleanUrl, dedupeKey, normalizeRows, splitAuthors } from './normalize';
export { detectFormat, parseDelimited, parseJson, parseTxt, parseXlsx } from './parsers';

export interface ParsedImport {
  format: ImportFormat;
  totalRows: number;
  drafts: BookDraft[];
  skipped: number;
  duplicates: number;
  mapping: Partial<Record<BookFieldKey, string>>;
  unmappedHeaders: string[];
  issues: ImportIssue[];
  encoding?: string;
}

export async function parseTable(
  input: { bytes: Uint8Array; format: ImportFormat } | { text: string; format: Exclude<ImportFormat, 'xlsx'> },
): Promise<{ table: RawTable; encoding?: string }> {
  if (input.format === 'xlsx') {
    if (!('bytes' in input)) throw new AppError('invalid_params', 'Excel 导入需要文件内容');
    return { table: await parseXlsx(input.bytes) };
  }
  const decoded = 'bytes' in input ? decodeText(input.bytes) : { text: input.text, encoding: undefined };
  const { text } = decoded;
  switch (input.format) {
    case 'csv':
      return { table: parseDelimited(text), encoding: decoded.encoding };
    case 'tsv':
      return { table: parseDelimited(text, '\t'), encoding: decoded.encoding };
    case 'txt':
      return { table: parseTxt(text), encoding: decoded.encoding };
    case 'json':
      return { table: parseJson(text), encoding: decoded.encoding };
  }
}

const LINK_HEADER = '__cellLink';

/**
 * Excel 超链接：来源链接列的单元格若是"查看"之类的文字，用其超链接替换；
 * 没有来源链接列时，取书名单元格（或该行第一个）的超链接。
 */
function applyCellLinks(table: RawTable, mapping: Partial<Record<BookFieldKey, string>>): Record<string, string>[] {
  const { links } = table;
  if (!links?.some((row) => Object.keys(row).length > 0)) return table.rows;
  const urlHeader = mapping.sourceUrl;
  if (!urlHeader) mapping.sourceUrl = LINK_HEADER;
  return table.rows.map((row, i) => {
    const rowLinks = links[i] ?? {};
    if (urlHeader) {
      const link = rowLinks[urlHeader];
      return link ? { ...row, [urlHeader]: link } : row;
    }
    const link = rowLinks[mapping.title!] ?? Object.values(rowLinks)[0] ?? '';
    return { ...row, [LINK_HEADER]: link };
  });
}

/** 解析 → 自动映射表头 → 规范化与同批去重。不触碰存储。 */
export async function parseImport(
  input: { bytes: Uint8Array; fileName: string } | { text: string; format: Exclude<ImportFormat, 'xlsx'> },
  at: string,
): Promise<ParsedImport> {
  let format: ImportFormat;
  let parsed: { table: RawTable; encoding?: string };
  if ('bytes' in input) {
    const detected = detectFormat(input.fileName);
    if (!detected) {
      throw new AppError(
        'unsupported_format',
        '不支持的文件格式',
        `请使用 ${supportedImportExtensions.map((ext) => `.${ext}`).join(' / ')} 文件`,
      );
    }
    format = detected;
    parsed = await parseTable({ bytes: input.bytes, format });
  } else {
    format = input.format;
    parsed = await parseTable(input);
  }

  const { table } = parsed;
  if (table.rows.length === 0) {
    throw new AppError('import_failed', '文件中没有可导入的数据行', '请确认第一行是表头，后面每行一本书');
  }
  const { mapping, unmappedHeaders } = suggestMapping(table.headers);
  if (!mapping.title) {
    throw new AppError(
      'import_failed',
      '没有找到"书名"列',
      `识别到的表头：${table.headers.slice(0, 12).join('、')}。请把书名所在列的表头改为"书名"或"题名"`,
    );
  }
  const rows = applyCellLinks(table, mapping);
  const normalized = normalizeRows(rows, mapping, { origin: 'import', at });
  return {
    format,
    totalRows: table.rows.length,
    mapping,
    unmappedHeaders,
    encoding: parsed.encoding,
    ...normalized,
  };
}
