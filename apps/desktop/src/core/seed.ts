import { z } from 'zod';
import { nowIso } from '@yys/shared';
import type { Repositories } from '@yys/db';
import { SAMPLE_LIBRARY_VERSION, SAMPLE_SOURCE_ID, SAMPLE_SOURCE_NAME, sampleBookDrafts } from '@yys/book-sources';

const VERSION_KEY = 'sampleLibraryVersion';

/** 首次启动或示例书库升级时重新灌入；用户自己的导入数据不受影响 */
export function seedSampleLibrary(repos: Repositories): boolean {
  const current = repos.settings.get(VERSION_KEY, z.number(), 0);
  const exists = repos.books.listSources().some((source) => source.id === SAMPLE_SOURCE_ID);
  if (exists && current >= SAMPLE_LIBRARY_VERSION) return false;
  repos.db.transaction(() => {
    repos.books.deleteSource(SAMPLE_SOURCE_ID);
    repos.books.createSource({ id: SAMPLE_SOURCE_ID, kind: 'sample', name: SAMPLE_SOURCE_NAME, meta: { version: SAMPLE_LIBRARY_VERSION } });
    repos.books.insertDrafts(SAMPLE_SOURCE_ID, sampleBookDrafts(nowIso()));
    repos.settings.set(VERSION_KEY, SAMPLE_LIBRARY_VERSION);
  });
  return true;
}
