import Papa from 'papaparse';
import ExcelJS from 'exceljs';
import { AppError, type ImportFormat } from '@yys/shared';
import type { RawTable } from '../types';

export function detectFormat(fileName: string): ImportFormat | null {
  const ext = fileName.toLowerCase().split('.').pop() ?? '';
  switch (ext) {
    case 'csv':
      return 'csv';
    case 'tsv':
      return 'tsv';
    case 'txt':
      return 'txt';
    case 'xlsx':
    case 'xlsm':
      return 'xlsx';
    case 'json':
    case 'jsonl':
      return 'json';
    default:
      return null;
  }
}

function cleanHeaders(headers: string[]): string[] {
  const seen = new Map<string, number>();
  return headers.map((raw, index) => {
    const base = raw.replace(/^\ufeff/, '').trim() || `列${index + 1}`;
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    return count === 0 ? base : `${base}_${count + 1}`;
  });
}

function fromMatrix(matrix: string[][]): RawTable {
  const nonEmpty = matrix.filter((row) => row.some((cell) => cell.trim() !== ''));
  const [headerRow, ...dataRows] = nonEmpty;
  if (!headerRow) return { headers: [], rows: [] };
  const headers = cleanHeaders(headerRow);
  const rows = dataRows.map((cells) => {
    const row: Record<string, string> = {};
    headers.forEach((header, i) => {
      row[header] = (cells[i] ?? '').trim();
    });
    return row;
  });
  return { headers, rows };
}

export function parseDelimited(text: string, delimiter?: ',' | '\t'): RawTable {
  const result = Papa.parse<string[]>(text.replace(/^\ufeff/, ''), {
    delimiter: delimiter ?? '',
    skipEmptyLines: 'greedy',
  });
  const fatal = result.errors.find(
    (error) => error.type === 'Delimiter' && result.data.length === 0,
  );
  if (fatal) throw new AppError('import_failed', `无法识别分隔符：${fatal.message}`);
  return fromMatrix(result.data);
}

const bookTitlePattern = /《([^》]+)》\s*[,，/／\-—:：]?\s*(.*)$/;

/**
 * TXT：带制表符/逗号表头时按表格处理；否则每行一本书，
 * 支持"《书名》作者"与"书名 / 作者 / 出版社"等常见写法。
 */
export function parseTxt(text: string): RawTable {
  const lines = text
    .replace(/^\ufeff/, '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const first = lines[0] ?? '';
  if (first.includes('\t')) return parseDelimited(lines.join('\n'), '\t');
  if (/[,，]/.test(first) && /书名|题名|title/i.test(first))
    return parseDelimited(lines.join('\n'), ',');

  const headers = ['书名', '作者', '出版社'];
  const rows = lines.map((line) => {
    const cleaned = line.replace(/^(\d+[.、)\s]+|[-*•]\s+)/, '');
    const quoted = bookTitlePattern.exec(cleaned);
    if (quoted) {
      return { 书名: quoted[1]!.trim(), 作者: (quoted[2] ?? '').trim(), 出版社: '' };
    }
    const parts = cleaned.split(/\s*[/／|｜]\s*|\s+[-—]\s+/);
    return {
      书名: parts[0]?.trim() ?? '',
      作者: parts[1]?.trim() ?? '',
      出版社: parts[2]?.trim() ?? '',
    };
  });
  return { headers, rows };
}

function stringifyValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) return value.map(stringifyValue).filter(Boolean).join('；');
  if (typeof value === 'object') {
    const named =
      (value as Record<string, unknown>).name ?? (value as Record<string, unknown>).title;
    return named !== undefined ? stringifyValue(named) : JSON.stringify(value);
  }
  return String(value).trim();
}

const isRecordArray = (value: unknown): value is Record<string, unknown>[] =>
  Array.isArray(value) &&
  value.length > 0 &&
  value.every((item) => typeof item === 'object' && item !== null && !Array.isArray(item));

function findRecordArray(value: unknown, depth = 0): Record<string, unknown>[] | null {
  if (isRecordArray(value)) return value;
  if (depth > 3 || typeof value !== 'object' || value === null) return null;
  const obj = value as Record<string, unknown>;
  const preferred = ['books', 'items', 'records', 'data', 'list', 'results', 'rows'];
  for (const key of [...preferred, ...Object.keys(obj)]) {
    const found = findRecordArray(obj[key], depth + 1);
    if (found) return found;
  }
  return null;
}

/** JSON：对象数组、包在 books/items/data 等字段里的数组，或 JSON Lines */
export function parseJson(text: string): RawTable {
  const trimmed = text.replace(/^\ufeff/, '').trim();
  let records: Record<string, unknown>[] | null = null;
  try {
    records = findRecordArray(JSON.parse(trimmed));
  } catch {
    const lines = trimmed.split(/\r?\n/).filter((line) => line.trim());
    try {
      const parsed = lines.map((line) => JSON.parse(line) as unknown);
      records = isRecordArray(parsed) ? parsed : null;
    } catch {
      throw new AppError(
        'import_failed',
        'JSON 格式有误，无法解析',
        '请确认文件是标准 JSON 或每行一条记录的 JSON Lines',
      );
    }
  }
  if (!records) {
    throw new AppError(
      'import_failed',
      '没有在 JSON 中找到书目列表',
      '需要一个对象数组，例如 [{"书名": "...", "作者": "..."}]',
    );
  }
  const headers: string[] = [];
  for (const record of records) {
    for (const key of Object.keys(record)) if (!headers.includes(key)) headers.push(key);
  }
  const rows = records.map((record) => {
    const row: Record<string, string> = {};
    for (const header of headers) row[header] = stringifyValue(record[header]);
    return row;
  });
  return { headers, rows };
}

function cellLink(cell: ExcelJS.Cell): string | undefined {
  const value = cell.value;
  if (
    value &&
    typeof value === 'object' &&
    'hyperlink' in value &&
    typeof value.hyperlink === 'string'
  ) {
    return value.hyperlink;
  }
  return undefined;
}

function cellText(cell: ExcelJS.Cell): string {
  const value = cell.value;
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'object') {
    if ('hyperlink' in value && typeof value.hyperlink === 'string') {
      return ('text' in value ? stringifyRich(value.text) : '').trim() || value.hyperlink;
    }
    if ('richText' in value) return value.richText.map((part) => part.text).join('');
    if ('result' in value) return value.result === undefined ? '' : String(value.result);
    if ('error' in value) return '';
  }
  return String(value).trim();
}

function stringifyRich(text: unknown): string {
  if (typeof text === 'string') return text;
  if (text && typeof text === 'object' && 'richText' in text) {
    return (text as { richText: { text: string }[] }).richText.map((part) => part.text).join('');
  }
  return '';
}

/** Excel：读取第一个有数据的工作表，首个非空行作为表头；单元格超链接保留为 URL */
export async function parseXlsx(bytes: Uint8Array): Promise<RawTable> {
  if (bytes[0] === 0xd0 && bytes[1] === 0xcf) {
    throw new AppError(
      'unsupported_format',
      '暂不支持旧版 .xls 文件',
      '请在 Excel 中另存为 .xlsx 或 .csv 后再导入',
    );
  }
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(bytes as unknown as ArrayBuffer);
  } catch (error) {
    throw new AppError('import_failed', `无法读取 Excel 文件：${(error as Error).message}`);
  }
  const sheet = workbook.worksheets.find((ws) => ws.actualRowCount > 0);
  if (!sheet) return { headers: [], rows: [] };
  const matrix: string[][] = [];
  const linkMatrix: (string | undefined)[][] = [];
  sheet.eachRow({ includeEmpty: false }, (row) => {
    const cells: string[] = [];
    const links: (string | undefined)[] = [];
    for (let col = 1; col <= sheet.columnCount; col++) {
      const cell = row.getCell(col);
      cells.push(cellText(cell));
      links.push(cellLink(cell));
    }
    if (cells.some((cell) => cell.trim() !== '')) {
      matrix.push(cells);
      linkMatrix.push(links);
    }
  });
  const table = fromMatrix(matrix);
  table.links = linkMatrix.slice(1).map((links) => {
    const row: Record<string, string> = {};
    table.headers.forEach((header, i) => {
      const link = links[i];
      if (link) row[header] = link;
    });
    return row;
  });
  return table;
}
