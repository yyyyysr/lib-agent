import { assessCompleteness, bookRecordSchema } from '@yys/shared';
import { describe, expect, it } from 'vitest';
import { cleanUrl, dedupeKey } from '../import/normalize';
import { sampleBookDrafts } from './books';

const at = '2026-10-02T00:00:00.000Z';
const mainTitle = (title: string): string => title.split(/[：:]/)[0]!.trim();

describe('示例书库', () => {
  const drafts = sampleBookDrafts(at);
  const byId = new Map(drafts.map((d) => [d.externalId, d]));

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

  it('每本书都有实体书封面、可打开的豆瓣读书页面与 ISBN', () => {
    for (const draft of drafts) {
      expect(draft.sourceUrl, draft.title).toMatch(/^https:\/\/book\.douban\.com\/subject\/\d+\/$/);
      expect(cleanUrl(draft.sourceUrl!).valid).toBe(true);
      expect(draft.coverUrl, draft.title).toMatch(/^https?:\/\//);
      if (draft.externalId !== 'sample-0028')
        // 国图记录保留书上印的 ISBN：2007 年以前出版的为 10 位
        expect(draft.isbn?.replaceAll('-', ''), draft.title).toMatch(/^(9787\d{9}|7\d{8}[\dX])$/);
    }
  });

  it('有国图书目记录的书带著录字段与可打开的记录链接', () => {
    const fromNlc = drafts.filter((d) => d.catalogSource?.startsWith('中国国家图书馆'));
    expect(fromNlc.length).toBeGreaterThan(0);
    for (const draft of fromNlc) {
      expect(draft.catalogUrl, draft.title).toMatch(
        /^http:\/\/find\.nlc\.cn\/search\/showDocDetails\?docId=-?\d+/,
      );
      expect(draft.clcNumber, draft.title).toMatch(/^[A-Z]/);
      expect(draft.publisher, draft.title).toBeTruthy();
      expect(draft.pubYear, draft.title).toBeGreaterThan(1900);
    }
    const thinking = byId.get('sample-0007')!;
    expect(thinking).toMatchObject({
      isbn: '978-7-5086-3355-8',
      clcNumber: 'F069.9-49',
      docType: '专著',
      pubPlace: '北京',
    });
  });

  it('保留了用于演示核对清单的缺陷', () => {
    expect(assessCompleteness(byId.get('sample-0012')!).missingRecommended).toContain('callNumber');
    expect(assessCompleteness(byId.get('sample-0016')!).missingRecommended).toContain('callNumber');
    expect(assessCompleteness(byId.get('sample-0013')!).missingRecommended).toContain('summary');
    expect(assessCompleteness(byId.get('sample-0015')!).missingRecommended).toContain('summary');
    const duplicate = byId.get('sample-0028')!;
    const original = byId.get('sample-0003')!;
    // 导入时不会被当作重复（字段不同），由核对清单按主书名发现
    expect(dedupeKey(duplicate)).not.toBe(dedupeKey(original));
    expect(mainTitle(duplicate.title)).toBe(mainTitle(original.title));
    expect(duplicate.sourceUrl).toBe(original.sourceUrl);
  });
});
