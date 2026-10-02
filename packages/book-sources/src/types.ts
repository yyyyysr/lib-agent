import type { BookDraft, BookRecord, BookSourceKind, Page } from '@yys/shared';

export interface BookSearchInput {
  text: string;
  limit: number;
  offset: number;
}

/**
 * 可检索的远程书目来源（校园数据库等）。
 * 示例书库与文件导入的数据入库后由本地存储检索，不需要实现此接口。
 */
export interface RemoteBookSource {
  readonly id: string;
  readonly kind: BookSourceKind;
  readonly name: string;
  search(input: BookSearchInput, signal?: AbortSignal): Promise<Page<BookDraft & { externalId: string }>>;
  fetchById?(externalId: string, signal?: AbortSignal): Promise<(BookDraft & { externalId: string }) | null>;
}

/** 解析后的二维表：表头 + 按表头取值的行 */
export interface RawTable {
  headers: string[];
  rows: Record<string, string>[];
  /** Excel 单元格超链接，与 rows 一一对应：表头 → URL */
  links?: Record<string, string>[];
}

export type { BookRecord };
