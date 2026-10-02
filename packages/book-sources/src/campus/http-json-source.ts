import { AppError, bookFieldKeys, type BookDraft, type Page, type SchoolProfile } from '@yys/shared';
import { normalizeRows } from '../import/normalize';
import type { BookSearchInput, RemoteBookSource } from '../types';

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export function getByPath(value: unknown, path: string): unknown {
  return path
    .split('.')
    .filter(Boolean)
    .reduce<unknown>((acc, key) => (acc && typeof acc === 'object' ? (acc as Record<string, unknown>)[key] : undefined), value);
}

/**
 * 学校自建内容管理系统的通用 HTTP JSON 检索适配器（预留，学校授权后启用）。
 * 通过 SchoolProfile.api 配置检索地址、结果数组路径和字段映射，无需为每所学校写代码。
 */
export class HttpJsonCampusSource implements RemoteBookSource {
  readonly kind = 'campus' as const;
  readonly id: string;
  readonly name: string;

  constructor(
    private readonly profile: SchoolProfile,
    private readonly deps: { fetch: FetchLike; getAccessToken?: () => Promise<string | null> },
  ) {
    if (!profile.api) throw new AppError('not_configured', `${profile.name} 尚未配置馆藏检索接口`);
    this.id = `src_campus_${profile.id}`;
    this.name = `${profile.name} 馆藏`;
  }

  async search(input: BookSearchInput, signal?: AbortSignal): Promise<Page<BookDraft & { externalId: string }>> {
    const api = this.profile.api!;
    const url = new URL(api.searchPath, api.baseUrl);
    url.searchParams.set(api.queryParam, input.text);
    if (api.pageSizeParam) url.searchParams.set(api.pageSizeParam, String(input.limit));

    const headers: Record<string, string> = { accept: 'application/json' };
    const token = await this.deps.getAccessToken?.();
    if (token) headers.authorization = `Bearer ${token}`;

    const response = await this.deps.fetch(url.toString(), { headers, signal });
    if (response.status === 401 || response.status === 403) {
      throw new AppError('not_configured', '学校登录已过期或未授权', '请在 设置 › 学校 中重新登录');
    }
    if (!response.ok) throw new AppError('network', `学校接口返回错误：HTTP ${response.status}`);
    const json = (await response.json()) as unknown;

    const items = getByPath(json, api.itemsPath);
    if (!Array.isArray(items)) throw new AppError('import_failed', `学校接口响应中没有找到 ${api.itemsPath} 数组`);

    const fieldMap = api.fieldMap;
    const rows = items.map((item) => {
      const row: Record<string, string> = {};
      for (const field of bookFieldKeys) {
        const path = fieldMap[field];
        if (!path) continue;
        const value = getByPath(item, path);
        row[field] = Array.isArray(value) ? value.join('；') : value === undefined || value === null ? '' : String(value);
      }
      row.__externalId = String(getByPath(item, 'id') ?? '');
      return row;
    });
    const mapping = Object.fromEntries(bookFieldKeys.filter((field) => fieldMap[field]).map((field) => [field, field]));
    const at = new Date().toISOString();
    const results: (BookDraft & { externalId: string })[] = [];
    rows.forEach((row, index) => {
      const [draft] = normalizeRows([row], mapping, { origin: 'api', at }).drafts;
      if (draft) results.push({ ...draft, externalId: row.__externalId || `${this.id}:${input.offset + index}` });
    });
    const total = api.totalPath ? Number(getByPath(json, api.totalPath)) : results.length;

    return { items: results, total: Number.isFinite(total) ? total : results.length };
  }
}
