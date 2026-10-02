import { readFile, stat } from 'node:fs/promises';
import { basename } from 'node:path';
import {
  AppError,
  DEFAULT_SCHOOL,
  nowIso,
  organizerOf,
  schoolProfileSchema,
  type CampusConnectionStatus,
  type ImportReport,
  type SchoolBranding,
  type UserInfo,
} from '@yys/shared';
import { parseImport, SAMPLE_SOURCE_ID, type ParsedImport } from '@yys/book-sources';
import type { LibraryAccess } from '@yys/agent-core';
import type { RpcHandlers } from '../rpc-server';
import type { CoreDeps } from './context';

const MAX_IMPORT_BYTES = 20 * 1024 * 1024;
const SCHOOL_KEY = 'schoolProfile';

export function createBookServices(deps: CoreDeps) {
  const { repos } = deps;

  const finishImport = (
    user: UserInfo,
    parsed: ParsedImport,
    source: { name: string; kind: 'file' | 'manual'; meta: Record<string, unknown> },
  ): ImportReport => {
    if (parsed.drafts.length === 0) {
      const reasons = parsed.issues
        .slice(0, 3)
        .map((issue) => `第 ${issue.row} 行：${issue.message}`)
        .join('；');
      throw new AppError('import_failed', '没有可导入的书目', reasons || '请检查文件内容');
    }
    const sourceId = repos.db.transaction(() => {
      const id = repos.books.createSource({ ...source, createdBy: user.id });
      repos.books.insertDrafts(id, parsed.drafts);
      return id;
    });
    deps.emit('books.changed', { sourceId });
    return {
      sourceId,
      sourceName: source.name,
      format: parsed.format,
      totalRows: parsed.totalRows,
      imported: parsed.drafts.length,
      skipped: parsed.skipped,
      duplicates: parsed.duplicates,
      mapping: parsed.mapping,
      unmappedHeaders: parsed.unmappedHeaders,
      issues: parsed.issues,
    };
  };

  /** 学校名称未配置时默认显示中山大学 */
  const branding = (): SchoolBranding => {
    const schoolName =
      repos.settings.get(SCHOOL_KEY, schoolProfileSchema.nullable(), null)?.name.trim() ||
      DEFAULT_SCHOOL.name;
    return { schoolName, organizer: organizerOf(schoolName) };
  };

  const library: LibraryAccess = {
    count: (sourceIds) => repos.books.countIn(sourceIds),
    all: (sourceIds, limit) =>
      repos.books.search({ sourceIds: sourceIds.length ? sourceIds : undefined, limit }).items,
    search: (text, sourceIds, limit) =>
      repos.books.search({ text, sourceIds: sourceIds.length ? sourceIds : undefined, limit })
        .items,
  };

  const handlers: Pick<
    RpcHandlers,
    | 'books.sources'
    | 'books.search'
    | 'books.importFile'
    | 'books.importText'
    | 'books.deleteSource'
    | 'settings.getSchool'
    | 'settings.setSchool'
    | 'campus.status'
    | 'school.branding'
  > = {
    'books.sources': () => repos.books.listSources(),
    'books.search': (query) => repos.books.search(query),
    'books.importFile': async ({ path, sourceName }, { user }) => {
      const info = await stat(path).catch(() => null);
      if (!info?.isFile()) throw new AppError('not_found', '找不到要导入的文件');
      if (info.size > MAX_IMPORT_BYTES)
        throw new AppError('import_failed', '文件超过 20MB', '请拆分后分批导入');
      const bytes = new Uint8Array(await readFile(path));
      const fileName = basename(path);
      const parsed = await parseImport({ bytes, fileName }, nowIso());
      return finishImport(user, parsed, {
        kind: 'file',
        name: sourceName?.trim() || fileName.replace(/\.[^.]+$/, ''),
        meta: { fileName, format: parsed.format, encoding: parsed.encoding, importedAt: nowIso() },
      });
    },
    'books.importText': async ({ text, format, sourceName }, { user }) => {
      const parsed = await parseImport({ text, format }, nowIso());
      return finishImport(user, parsed, {
        kind: 'manual',
        name: sourceName.trim(),
        meta: { format, importedAt: nowIso() },
      });
    },
    'books.deleteSource': ({ id }, { user }) => {
      if (id === SAMPLE_SOURCE_ID) throw new AppError('invalid_params', '示例书库不能删除');
      const source = repos.books.listSources().find((s) => s.id === id);
      if (!source) throw new AppError('not_found', '书目来源不存在');
      if (source.createdBy !== user.id && user.role !== 'superadmin')
        throw new AppError('forbidden', '只能删除自己导入的书目来源');
      repos.books.deleteSource(id);
      deps.emit('books.changed', { sourceId: id });
    },
    'settings.getSchool': () =>
      repos.settings.get(SCHOOL_KEY, schoolProfileSchema.nullable(), null),
    'settings.setSchool': (profile) => {
      if (profile) repos.settings.set(SCHOOL_KEY, profile);
      else repos.settings.delete(SCHOOL_KEY);
      deps.emit('school.changed', {});
      return profile;
    },
    'school.branding': branding,
    'campus.status': (): CampusConnectionStatus => {
      const profile = repos.settings.get(SCHOOL_KEY, schoolProfileSchema.nullable(), null);
      if (!profile) return { state: 'not_configured' };
      if (profile.api && profile.auth) return { state: 'signed_out' };
      return { state: 'portal_only' };
    },
  };

  return { handlers, library, branding };
}
