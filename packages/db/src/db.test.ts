import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { modelRolesSchema, type BookDraft } from '@yys/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openRepositories, type Repositories } from './index';

const draft = (title: string, extra: Partial<BookDraft> = {}): BookDraft & { externalId?: string } => ({
  title,
  authors: ['作者甲'],
  isSample: false,
  provenance: {},
  ...extra,
});

describe('db', () => {
  let dir: string;
  let repos: Repositories;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'yys-db-'));
    repos = openRepositories(join(dir, 'test.db'));
  });
  afterEach(() => {
    repos.db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('迁移幂等：重复打开不报错，版本号不变', () => {
    const version = repos.db.schemaVersion;
    repos.db.close();
    repos = openRepositories(join(dir, 'test.db'));
    expect(repos.db.schemaVersion).toBe(version);
    expect(version).toBeGreaterThan(0);
  });

  it('嵌套事务：内层失败只回滚内层，外层失败全部回滚', () => {
    repos.db.transaction(() => {
      repos.settings.set('outer', 1);
      expect(() =>
        repos.db.transaction(() => {
          repos.settings.set('inner', 1);
          throw new Error('inner');
        }),
      ).toThrow('inner');
    });
    expect(repos.db.get('SELECT key FROM settings WHERE key = ?', 'outer')).toBeDefined();
    expect(repos.db.get('SELECT key FROM settings WHERE key = ?', 'inner')).toBeUndefined();

    expect(() =>
      repos.db.transaction(() => {
        repos.settings.set('all', 1);
        repos.db.transaction(() => repos.settings.set('nested', 1));
        throw new Error('outer');
      }),
    ).toThrow('outer');
    expect(repos.db.get('SELECT key FROM settings WHERE key IN (?, ?)', 'all', 'nested')).toBeUndefined();
  });

  it('settings：不符合 schema 的旧数据回退到默认值', () => {
    const fallback = { primary: null, fast: null };
    repos.settings.set('modelRoles', { primary: 'broken' });
    expect(repos.settings.get('modelRoles', modelRolesSchema, fallback)).toEqual(fallback);
    const valid = { primary: { providerId: 'p', modelId: 'm' }, fast: null };
    repos.settings.set('modelRoles', valid);
    expect(repos.settings.get('modelRoles', modelRolesSchema, fallback)).toEqual(valid);
  });

  describe('books', () => {
    let sourceId: string;
    beforeEach(() => {
      sourceId = repos.books.createSource({ kind: 'file', name: '测试导入' });
      repos.books.insertDrafts(sourceId, [
        draft('算法霸权：数学杀伤性武器的威胁', { subjects: ['算法', '大数据'], summary: '算法模型如何放大不公平', externalId: 'a' }),
        draft('思考，快与慢', { authors: ['丹尼尔·卡尼曼'], subjects: ['心理学'], externalId: 'b' }),
        draft('乡土中国', { authors: ['费孝通'], subjects: ['社会学'], externalId: 'c' }),
      ]);
    });

    it('来源列表带书目数量', () => {
      expect(repos.books.listSources()).toMatchObject([{ id: sourceId, name: '测试导入', bookCount: 3 }]);
    });

    it('三字以上走全文索引，两字词回退 LIKE，多词 AND', () => {
      expect(repos.books.search({ text: '数学杀伤' }).items.map((b) => b.title)).toEqual(['算法霸权：数学杀伤性武器的威胁']);
      expect(repos.books.search({ text: '卡尼曼' }).items.map((b) => b.title)).toEqual(['思考，快与慢']);
      expect(repos.books.search({ text: '算法' }).total).toBe(1);
      expect(repos.books.search({ text: '算法 社会学' }).total).toBe(0);
      expect(repos.books.search({}).total).toBe(3);
    });

    it('特殊字符不会破坏查询', () => {
      expect(() => repos.books.search({ text: '"%_\\ OR *' })).not.toThrow();
    });

    it('同来源 externalId 相同则更新，全文索引同步', () => {
      repos.books.insertDrafts(sourceId, [draft('乡土中国（修订版）', { authors: ['费孝通'], externalId: 'c' })]);
      expect(repos.books.search({}).total).toBe(3);
      expect(repos.books.search({ text: '修订版' }).items[0]?.title).toBe('乡土中国（修订版）');
    });

    it('删除来源级联删除书目与索引', () => {
      repos.books.deleteSource(sourceId);
      expect(repos.books.search({}).total).toBe(0);
      expect(repos.books.search({ text: '数学杀伤' }).total).toBe(0);
    });

    it('getByIds 保持传入顺序', () => {
      const ids = repos.books.search({}).items.map((b) => b.id).reverse();
      expect(repos.books.getByIds(ids).map((b) => b.id)).toEqual(ids);
    });
  });

  it('conversations：保存、保留改过的标题、按更新时间排序', async () => {
    const saved = repos.conversations.save('c1', [{ id: 'm1' }], '第一个');
    expect(saved).toMatchObject({ id: 'c1', title: '第一个', createdAt: expect.any(String), updatedAt: expect.any(String) });
    expect(repos.conversations.rename('c1', '改过的标题')).toMatchObject({ title: '改过的标题', createdAt: saved.createdAt });
    await new Promise((r) => setTimeout(r, 5));
    repos.conversations.save('c2', [], '第二个');
    await new Promise((r) => setTimeout(r, 5));
    repos.conversations.save('c1', [{ id: 'm1' }, { id: 'm2' }], '不应覆盖');
    expect(repos.conversations.list().map((c) => c.title)).toEqual(['改过的标题', '第二个']);
    expect(repos.conversations.get('c1')?.messages).toHaveLength(2);
  });
});
