import { assessCompleteness, bookRecordSchema } from '@yys/shared';
import { describe, expect, it } from 'vitest';
import { cleanUrl, dedupeKey } from '../import/normalize';
import { sampleBookDrafts } from './books';

const at = '2026-10-02T00:00:00.000Z';

describe('示例书库', () => {
  const drafts = sampleBookDrafts(at);

  it('每条记录都符合书目 schema 且标记为示例', () => {
    for (const draft of drafts) {
      expect(draft.isSample).toBe(true);
      const parsed = bookRecordSchema.safeParse({
        ...draft,
        id: 'x',
        sourceId: 's',
        createdAt: at,
        updatedAt: at,
      });
      expect(parsed.success, draft.title).toBe(true);
    }
  });

  it('externalId 唯一', () => {
    expect(new Set(drafts.map((d) => d.externalId)).size).toBe(drafts.length);
  });

  it('索书号带"示例-"前缀；每本书都有可打开的豆瓣读书页面链接', () => {
    for (const draft of drafts) {
      if (draft.callNumber) expect(draft.callNumber.startsWith('示例-')).toBe(true);
      expect(draft.sourceUrl, draft.title).toMatch(/^https:\/\/book\.douban\.com\/subject\/\d+\/$/);
      expect(cleanUrl(draft.sourceUrl!).valid).toBe(true);
    }
  });

  it('保留了用于演示核对清单的缺陷', () => {
    const byId = new Map(drafts.map((d) => [d.externalId, d]));
    expect(assessCompleteness(byId.get('sample-0012')!).missingRecommended).toContain('callNumber');
    expect(assessCompleteness(byId.get('sample-0015')!).missingRecommended).toContain('summary');
    expect(dedupeKey(byId.get('sample-0028')!)).not.toBe(dedupeKey(byId.get('sample-0003')!));
    expect(byId.get('sample-0028')!.callNumber).toBe(byId.get('sample-0003')!.callNumber);
  });
});
