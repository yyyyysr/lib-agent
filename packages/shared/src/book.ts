import { z } from 'zod';

export const bookFieldKeys = [
  'title',
  'authors',
  'publisher',
  'pubYear',
  'isbn',
  'callNumber',
  'location',
  'availability',
  'subjects',
  'summary',
  'sourceUrl',
  'coverUrl',
] as const;
export type BookFieldKey = (typeof bookFieldKeys)[number];

export const bookFieldLabels: Record<BookFieldKey, string> = {
  title: '书名',
  authors: '作者',
  publisher: '出版社',
  pubYear: '出版年',
  isbn: 'ISBN',
  callNumber: '索书号',
  location: '馆藏地点',
  availability: '在架状态',
  subjects: '主题词',
  summary: '摘要',
  sourceUrl: '来源链接',
  coverUrl: '封面',
};

/** 缺失即不能入选书单 */
export const requiredBookFields: BookFieldKey[] = ['title', 'authors', 'sourceUrl'];
/** 影响筛选置信度与核对清单 */
export const recommendedBookFields: BookFieldKey[] = ['callNumber', 'summary', 'subjects'];

export const fieldOriginSchema = z.enum(['import', 'manual', 'api', 'sample']);
export type FieldOrigin = z.infer<typeof fieldOriginSchema>;

export const fieldProvenanceSchema = z.object({
  origin: fieldOriginSchema,
  at: z.string(),
  verified: z.boolean(),
  verifiedBy: z.string().optional(),
});
export type FieldProvenance = z.infer<typeof fieldProvenanceSchema>;

export const bookRecordSchema = z.object({
  id: z.string(),
  sourceId: z.string(),
  externalId: z.string().optional(),
  title: z.string().min(1),
  authors: z.array(z.string()),
  publisher: z.string().optional(),
  pubYear: z.number().int().optional(),
  isbn: z.string().optional(),
  callNumber: z.string().optional(),
  location: z.string().optional(),
  availability: z.string().optional(),
  subjects: z.array(z.string()).optional(),
  summary: z.string().optional(),
  sourceUrl: z.string().optional(),
  coverUrl: z.string().optional(),
  isSample: z.boolean(),
  provenance: z.partialRecord(z.enum(bookFieldKeys), fieldProvenanceSchema),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type BookRecord = z.infer<typeof bookRecordSchema>;

/** 导入或示例数据在入库前的形态，id 与时间戳由存储层补齐 */
export type BookDraft = Omit<BookRecord, 'id' | 'sourceId' | 'createdAt' | 'updatedAt'>;

export const bookSourceKindSchema = z.enum(['sample', 'file', 'manual', 'campus']);
export type BookSourceKind = z.infer<typeof bookSourceKindSchema>;

export const bookSourceInfoSchema = z.object({
  id: z.string(),
  kind: bookSourceKindSchema,
  name: z.string(),
  bookCount: z.number().int(),
  createdAt: z.string(),
  /** 文件导入时记录原始文件名与格式 */
  meta: z.record(z.string(), z.unknown()).optional(),
});
export type BookSourceInfo = z.infer<typeof bookSourceInfoSchema>;

export const bookQuerySchema = z.object({
  text: z.string().optional(),
  sourceIds: z.array(z.string()).optional(),
  limit: z.number().int().min(1).max(500).default(50),
  offset: z.number().int().min(0).default(0),
});
export type BookQuery = z.input<typeof bookQuerySchema>;

/** search_library 工具返回给模型、同时渲染在界面上的书目摘要 */
export interface LibraryToolBook {
  id: string;
  title: string;
  authors: string[];
  callNumber: string | null;
  subjects: string[];
  summary: string | null;
  sourceUrl: string | null;
  isSample: boolean;
  /** 缺失字段的中文名 */
  missingFields: string[];
}

export interface LibrarySearchOutput {
  total: number;
  books: LibraryToolBook[];
}

export interface Page<T> {
  items: T[];
  total: number;
}

export type Completeness = {
  /** 0–100 */
  score: number;
  missingRequired: BookFieldKey[];
  missingRecommended: BookFieldKey[];
};

export function assessCompleteness(book: Pick<BookRecord, BookFieldKey>): Completeness {
  const has = (key: BookFieldKey): boolean => {
    const value = book[key];
    if (value === undefined || value === null) return false;
    if (Array.isArray(value)) return value.length > 0;
    if (typeof value === 'string') return value.trim().length > 0;
    return true;
  };
  const missingRequired = requiredBookFields.filter((key) => !has(key));
  const missingRecommended = recommendedBookFields.filter((key) => !has(key));
  const total = requiredBookFields.length * 2 + recommendedBookFields.length;
  const got =
    (requiredBookFields.length - missingRequired.length) * 2 +
    (recommendedBookFields.length - missingRecommended.length);
  return { score: Math.round((got / total) * 100), missingRequired, missingRecommended };
}
