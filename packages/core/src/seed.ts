import { z } from 'zod';
import { DEFAULT_SCHOOL, nowIso, schoolProfileSchema } from '@yys/shared';
import type { Repositories } from '@yys/db';
import {
  SAMPLE_LIBRARY_VERSION,
  SAMPLE_SOURCE_ID,
  SAMPLE_SOURCE_NAME,
  sampleBookDrafts,
} from '@yys/book-sources';

const VERSION_KEY = 'sampleLibraryVersion';

const SCHOOL_SEEDED_KEY = 'schoolSeeded';

/** 首次启动时写入默认学校（中山大学）；之后超级管理员修改或清空都不再覆盖 */
export function seedDefaultSchool(repos: Repositories): boolean {
  if (repos.settings.get(SCHOOL_SEEDED_KEY, z.boolean(), false)) return false;
  if (!repos.settings.get('schoolProfile', schoolProfileSchema.nullable(), null))
    repos.settings.set('schoolProfile', DEFAULT_SCHOOL);
  repos.settings.set(SCHOOL_SEEDED_KEY, true);
  return true;
}

/** 首次启动或示例书库升级时重新灌入；用户自己的导入数据不受影响 */
export function seedSampleLibrary(repos: Repositories): boolean {
  const current = repos.settings.get(VERSION_KEY, z.number(), 0);
  const exists = repos.books.listSources().some((source) => source.id === SAMPLE_SOURCE_ID);
  if (exists && current >= SAMPLE_LIBRARY_VERSION) return false;
  repos.db.transaction(() => {
    repos.books.deleteSource(SAMPLE_SOURCE_ID);
    repos.books.createSource({
      id: SAMPLE_SOURCE_ID,
      kind: 'sample',
      name: SAMPLE_SOURCE_NAME,
      meta: { version: SAMPLE_LIBRARY_VERSION },
    });
    repos.books.insertDrafts(SAMPLE_SOURCE_ID, sampleBookDrafts(nowIso()));
    repos.settings.set(VERSION_KEY, SAMPLE_LIBRARY_VERSION);
  });
  return true;
}
