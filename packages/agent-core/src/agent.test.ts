import { APICallError } from 'ai';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { sampleBookDrafts } from '@yys/book-sources';
import {
  briefSchema,
  type AgentProgress,
  type BookRecord,
  type Plan,
  type UserInfo,
} from '@yys/shared';
import {
  anonymize,
  feedbackMetrics,
  generateProposal,
  generateStructured,
  hasOpenBlockers,
  mergeChecks,
  ruleChecks,
  runCuration,
  type LibraryAccess,
} from './index';
import { createScriptedModel } from './testing';

const at = '2026-10-02T00:00:00.000Z';
const sampleBooks: BookRecord[] = sampleBookDrafts(at).map((d) => ({
  ...d,
  id: d.externalId,
  sourceId: 'src_sample',
  createdAt: at,
  updatedAt: at,
}));

function libraryOf(books: BookRecord[]): LibraryAccess {
  return {
    count: () => books.length,
    all: (_s, limit) => books.slice(0, limit),
    search: (text, _s, limit) =>
      books
        .filter((b) => `${b.title}${b.subjects?.join('')}${b.summary ?? ''}`.includes(text))
        .slice(0, limit),
  };
}

const brief = briefSchema.parse({
  theme: '新生如何识别 AI 生成的信息',
  audience: '大一新生',
  bookCount: 8,
});

async function curate(model: ReturnType<typeof createScriptedModel>['model'], books = sampleBooks) {
  const events: AgentProgress[] = [];
  const result = await runCuration({
    model,
    modelLabel: 'mock',
    brief,
    library: libraryOf(books),
    lessons: [],
    previousChecks: [],
    progress: (e) => events.push(e),
  });
  return { ...result, events };
}

describe('策展流水线', () => {
  it('从示例书库完成 选书 → 编排 → 撰写 → 检查', async () => {
    const { model, calls } = createScriptedModel();
    const { plan, checks, events } = await curate(model);

    expect(plan.books).toHaveLength(8);
    expect(plan.candidateCount).toBe(28);
    expect(plan.sections.length).toBe(2);
    // 每本书恰好属于一个存在的展区，并有导读
    const sectionIds = new Set(plan.sections.map((s) => s.id));
    expect(plan.books.every((b) => sectionIds.has(b.sectionId) && b.guide.length > 20)).toBe(true);
    expect(plan.sections.every((s) => s.panelText)).toBe(true);
    expect(plan.activity.durationMinutes).toBe(30);
    // 示例数据全部进入核对清单
    expect(checks.filter((c) => c.category === 'sample')).toHaveLength(8);
    // 小书库不需要生成检索词
    expect(calls.some((c) => c.task === 'keywords')).toBe(false);
    expect(
      events
        .filter((e) => e.type === 'stage' && e.status === 'done')
        .map((e) => (e as { stage: string }).stage),
    ).toEqual(['pool', 'select', 'structure', 'write', 'check']);
  });

  it('模型引用不存在的书目编号时，带着问题重试，绝不让编造的书入选', async () => {
    const { model, calls } = createScriptedModel({
      select: (prompt, call) =>
        call === 1
          ? {
              selections: [
                { ref: 'b999', reason: '编造', evidence: ['title'], confidence: 'high' },
              ],
              alternates: [],
            }
          : {
              selections: ['b1', 'b2', 'b3', 'b4', 'b5', 'b6', 'b7', 'b8'].map((ref) => ({
                ref,
                reason: '相关',
                evidence: ['summary'],
                confidence: 'high',
              })),
              alternates: [],
            },
    });
    const { plan } = await curate(model);
    const selectCalls = calls.filter((c) => c.task === 'select');
    expect(selectCalls).toHaveLength(2);
    expect(selectCalls[1]!.prompt).toContain('b999 不在候选列表中');
    expect(plan.books.map((b) => b.book.id)).toEqual(sampleBooks.slice(0, 8).map((b) => b.id));
  });

  it('声称依据摘要但书目没有摘要时，以实际字段为准并降低置信度', async () => {
    const noSummary = sampleBooks.map((b) => ({ ...b, summary: undefined, subjects: [] }));
    const { model, calls } = createScriptedModel({
      select: () => ({
        selections: Array.from({ length: 8 }, (_, i) => ({
          ref: `b${i + 1}`,
          reason: '相关',
          evidence: ['summary'],
          confidence: 'high',
        })),
        alternates: [],
      }),
    });
    const { plan, checks } = await curate(model, noSummary);
    expect(plan.books.every((b) => b.confidence === 'low' && b.evidence.join() === 'title')).toBe(
      true,
    );
    // 没有任何资料的书不调用模型写导读，改用待补充的模板文字
    expect(plan.books.every((b) => b.guideBasis === 'title_only')).toBe(true);
    expect(calls.some((c) => c.task === 'guide')).toBe(false);
    expect(checks.some((c) => c.key.startsWith('guide_basis:'))).toBe(true);
  });

  it('展区分配有遗漏或重复时自动修正', async () => {
    const { model } = createScriptedModel({
      structure: () => ({
        title: 'T',
        subtitle: '',
        sections: [
          { title: 'A', intent: 'a', refs: ['b1', 'b2', 'b2'] },
          { title: 'B', intent: 'b', refs: ['b1', 'b3'] },
          { title: '空', intent: '', refs: [] },
        ],
        statement: { goals: '', audienceNote: '', structureLogic: '', selectionLogic: '' },
      }),
    });
    const { plan } = await curate(model);
    expect(plan.books).toHaveLength(8);
    expect(plan.sections.map((s) => s.title)).toEqual(['A', 'B']);
    expect(plan.books.every((b) => plan.sections.some((s) => s.id === b.sectionId))).toBe(true);
  });

  it('大书库先生成检索词再召回候选', async () => {
    const big = Array.from({ length: 150 }, (_, i) => ({
      ...sampleBooks[i % sampleBooks.length]!,
      id: `x${i}`,
    }));
    const { model, calls } = createScriptedModel();
    const { plan } = await curate(model, big);
    expect(calls[0]!.task).toBe('keywords');
    expect(plan.candidateCount).toBeLessThanOrEqual(80);
  });

  it('书库为空时给出可操作的提示', async () => {
    const { model } = createScriptedModel();
    await expect(curate(model, [])).rejects.toMatchObject({
      code: 'invalid_state',
      hint: expect.stringContaining('导入'),
    });
  });
});

describe('核对规则', () => {
  const basePlan = (overrides: Partial<Plan['books'][number]['book']>[]): Plan => ({
    title: 'T',
    subtitle: '',
    statement: { goals: '', audienceNote: '', structureLogic: '', selectionLogic: '' },
    sections: [{ id: 's1', title: 'S', intent: '', panelText: '短文' }],
    books: overrides.map((o, i) => ({
      book: {
        id: `k${i}`,
        title: `书${i}`,
        authors: ['某人'],
        subjects: [],
        isSample: false,
        sourceUrl: 'https://lib.example.edu/1',
        callNumber: `C${i}`,
        ...o,
      },
      sectionId: 's1',
      reason: '',
      evidence: ['title'],
      confidence: 'high',
      guide: '导读',
      guideBasis: 'summary',
      edited: false,
    })),
    alternates: [],
    introduction: '',
    activity: { durationMinutes: 30, format: '', segments: [], questions: [] },
    candidateCount: 0,
    generatedAt: at,
    model: '',
  });

  it('识别缺少链接、链接格式错误、重复书目', () => {
    const plan = basePlan([
      { sourceUrl: undefined },
      { sourceUrl: 'http//bad' },
      { title: '算法霸权：数学杀伤性武器的威胁', callNumber: 'TP18' },
      { title: '算法霸权', callNumber: 'TP18' },
    ]);
    const checks = mergeChecks(ruleChecks(plan, { ...brief, bookCount: 4 }), []);
    expect(
      checks
        .filter((c) => c.severity === 'blocker')
        .map((c) => c.category)
        .sort(),
    ).toEqual(['duplicate', 'missing_field', 'source']);
    expect(hasOpenBlockers(checks)).toBe(true);
  });

  it('重新检查时保留用户已处理的状态', () => {
    const plan = basePlan([{ sourceUrl: undefined }]);
    const first = mergeChecks(ruleChecks(plan, { ...brief, bookCount: 1 }), []);
    first[0]!.status = 'dismissed';
    first[0]!.note = '馆员确认该书为新到馆，链接稍后补充';
    const second = mergeChecks(ruleChecks(plan, { ...brief, bookCount: 1 }), first);
    expect(second[0]).toMatchObject({
      id: first[0]!.id,
      status: 'dismissed',
      note: first[0]!.note,
    });
    expect(hasOpenBlockers(second)).toBe(false);
  });
});

describe('结构化生成', () => {
  it('连续解析失败后给出中文错误', async () => {
    const { model, calls } = createScriptedModel({ bad: () => 'not json' });
    await expect(
      generateStructured({
        model,
        task: 'bad',
        system: '',
        prompt: '',
        schema: z.object({ a: z.string() }),
      }),
    ).rejects.toMatchObject({
      message: expect.stringContaining('连续 3 次'),
    });
    expect(calls).toHaveLength(3);
  });

  it('鉴权等接口错误不重复请求', async () => {
    const { model, calls } = createScriptedModel({
      auth: () => {
        throw new APICallError({
          message: 'unauthorized',
          url: 'x',
          requestBodyValues: {},
          statusCode: 401,
          isRetryable: false,
        });
      },
    });
    await expect(
      generateStructured({
        model,
        task: 'auth',
        system: '',
        prompt: '',
        schema: z.object({ a: z.string() }),
      }),
    ).rejects.toBeInstanceOf(APICallError);
    expect(calls).toHaveLength(1);
  });
});

describe('申请书、反馈与匿名化', () => {
  it('申请人信息与书单由系统填入，缺失的索书号标注待核对', async () => {
    const { model } = createScriptedModel();
    const { plan } = await curate(model);
    plan.books[0]!.book.callNumber = undefined;
    const applicant = {
      id: 'u1',
      displayName: '李同学',
      memberNo: '2024010203',
      department: '图书馆学生阅读推广社',
    } as UserInfo;
    const proposal = await generateProposal(model, { brief, plan, applicant });
    expect(proposal.applicant).toEqual({
      userId: 'u1',
      name: '李同学',
      memberNo: '2024010203',
      department: '图书馆学生阅读推广社',
    });
    expect(proposal.booklist).toHaveLength(8);
    expect(proposal.booklist[0]!.callNumber).toBe('待核对');
  });

  it('反馈统计与匿名化', () => {
    expect(
      feedbackMetrics({ heldOn: '', participants: 30, notes: '' }, [
        { id: '1', rating: 5, content: '', createdAt: at },
        { id: '2', rating: 4, content: '', createdAt: at },
        { id: '3', rating: null, content: '', createdAt: at },
      ]),
    ).toEqual({ feedbackCount: 3, averageRating: 4.5, participants: 30 });
    expect(anonymize('我是 2023010101，电话 13812345678，邮箱 a.b@qq.com')).toBe(
      '我是 ［编号已隐去］，电话 ［手机号已隐去］，邮箱 ［邮箱已隐去］',
    );
  });
});
