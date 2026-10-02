import type { LanguageModel } from 'ai';
import { z } from 'zod';
import {
  AppError,
  newId,
  nowIso,
  type AgentProgress,
  type BookRecord,
  type BookSnapshot,
  type Brief,
  type CheckItem,
  type Plan,
  type PlanBook,
} from '@yys/shared';
import { describeBook, formatLessons, toSnapshot } from './books';
import { groundingChecks, mergeChecks, ruleChecks } from './checks';
import { charLength, generateStructured, mapLimit } from './llm';

/** 小书库直接全部作为候选；超过该数量时先由模型给出检索词，再从本地索引召回 */
const FULL_POOL_LIMIT = 120;
const MAX_POOL = 80;

export interface LibraryAccess {
  count(sourceIds: string[]): number;
  all(sourceIds: string[], limit: number): BookRecord[];
  search(text: string, sourceIds: string[], limit: number): BookRecord[];
}

export interface CurationContext {
  model: LanguageModel;
  modelLabel: string;
  brief: Brief;
  library: LibraryAccess;
  lessons: string[];
  previousChecks: CheckItem[];
  signal?: AbortSignal;
  progress: (event: AgentProgress) => void;
}

const briefText = (brief: Brief): string =>
  [
    `主题：${brief.theme}`,
    `目标读者：${brief.audience}`,
    `期望书目数量：${brief.bookCount} 本`,
    brief.requirements.trim() ? `特殊要求：${brief.requirements.trim()}` : '',
  ]
    .filter(Boolean)
    .join('\n');

const GROUNDING_RULES =
  '只能依据给出的书目资料写作，不得编造情节、数据、人物经历或出版信息；资料不足时写得概括一些。不要写活动时间、地点、索书号、链接，这些信息由系统按模板填入。';

async function stage<T>(
  ctx: CurationContext,
  id: string,
  label: string,
  run: () => Promise<{ value: T; detail?: string }>,
): Promise<T> {
  ctx.progress({ type: 'stage', stage: id, label, status: 'running' });
  try {
    const { value, detail } = await run();
    ctx.progress({ type: 'stage', stage: id, label, status: 'done', detail });
    return value;
  } catch (error) {
    ctx.progress({
      type: 'stage',
      stage: id,
      label,
      status: 'failed',
      detail: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/* ───────────── 1. 候选书目 ───────────── */

async function buildPool(ctx: CurationContext): Promise<BookSnapshot[]> {
  const { brief, library } = ctx;
  const total = library.count(brief.sourceIds);
  if (total === 0)
    throw new AppError(
      'invalid_state',
      '所选书目来源中没有书',
      '请先在“书库”中导入馆藏书目，或在需求中选择其他来源',
    );
  if (total <= FULL_POOL_LIMIT)
    return library.all(brief.sourceIds, FULL_POOL_LIMIT).map(toSnapshot);

  const { keywords } = await generateStructured({
    model: ctx.model,
    task: 'keywords',
    temperature: 0.3,
    signal: ctx.signal,
    schema: z.object({ keywords: z.array(z.string()) }),
    system:
      '你是高校图书馆的检索馆员。根据书展需求给出用于检索馆藏的中文关键词，覆盖主题的不同侧面，每个关键词 2–6 个字。',
    prompt: `${briefText(brief)}\n\n请给出 6–10 个检索关键词。`,
    validate: (v) =>
      v.keywords.filter((k) => k.trim()).length < 3 ? '关键词太少，至少给出 3 个' : null,
  });
  ctx.progress({ type: 'log', message: `检索关键词：${keywords.join('、')}` });

  const scored = new Map<string, { book: BookRecord; score: number }>();
  for (const keyword of keywords) {
    for (const book of library.search(keyword.trim(), brief.sourceIds, 40)) {
      const hit = scored.get(book.id);
      scored.set(book.id, { book, score: (hit?.score ?? 0) + 1 });
    }
  }
  const pool = [...scored.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_POOL)
    .map((s) => toSnapshot(s.book));
  if (pool.length === 0)
    throw new AppError(
      'invalid_state',
      '没有检索到与主题相关的馆藏',
      '请换一种方式描述主题，或导入更多相关书目',
    );
  return pool;
}

/* ───────────── 2. 筛选 ───────────── */

const selectionSchema = z.object({
  selections: z.array(
    z.object({
      ref: z.string(),
      reason: z.string().describe('这本书与主题、目标读者的关联理由，40–80 字'),
      evidence: z.array(z.enum(['title', 'subjects', 'summary'])).describe('理由依据了哪些字段'),
      confidence: z.enum(['high', 'medium', 'low']),
    }),
  ),
  alternates: z.array(z.object({ ref: z.string(), reason: z.string() })),
});

interface Selected {
  book: BookSnapshot;
  reason: string;
  evidence: PlanBook['evidence'];
  confidence: PlanBook['confidence'];
}

async function selectBooks(
  ctx: CurationContext,
  pool: BookSnapshot[],
): Promise<{ selected: Selected[]; alternates: Plan['alternates'] }> {
  const refs = new Map(pool.map((book, i) => [`b${i + 1}`, book]));
  const target = Math.min(ctx.brief.bookCount, pool.length);
  const listing = [...refs.entries()].map(([ref, book]) => describeBook(ref, book)).join('\n');

  const result = await generateStructured({
    model: ctx.model,
    task: 'select',
    temperature: 0.2,
    signal: ctx.signal,
    schema: selectionSchema,
    system: `你是高校图书馆的阅读推广馆员，正在为一场主题微书展选书。只能从给出的候选馆藏中选择，用编号引用。优先选择与主题直接相关、适合目标读者阅读水平的书；同一本书的不同版本只选一个。evidence 只能填写该书确实具备的字段（没有摘要就不能填 summary）。${formatLessons(ctx.lessons)}`,
    prompt: `${briefText(ctx.brief)}\n\n候选馆藏（共 ${pool.length} 本）：\n${listing}\n\n请选出 ${target} 本入选书目，另给出 3–5 本备选。`,
    validate: (value) => {
      const unknown = [...value.selections, ...value.alternates]
        .map((s) => s.ref)
        .filter((ref) => !refs.has(ref));
      if (unknown.length)
        return `编号 ${[...new Set(unknown)].join('、')} 不在候选列表中，只能使用列表中的编号`;
      const unique = new Set(value.selections.map((s) => s.ref)).size;
      if (unique < Math.min(target, Math.max(3, target - 2)))
        return `只选出了 ${unique} 本，需要选出 ${target} 本左右`;
      return null;
    },
  });

  const used = new Set<string>();
  const selected: Selected[] = [];
  for (const s of result.selections) {
    if (used.has(s.ref)) continue;
    used.add(s.ref);
    const book = refs.get(s.ref)!;
    // 模型声称的依据与书目实际字段不符时以实际为准
    const evidence = s.evidence.filter(
      (field) =>
        field === 'title' ||
        (field === 'summary' ? Boolean(book.summary) : book.subjects.length > 0),
    );
    selected.push({
      book,
      reason: s.reason.trim(),
      evidence: evidence.length ? [...new Set(evidence)] : ['title'],
      confidence:
        evidence.length === 0 || (evidence.length === 1 && evidence[0] === 'title')
          ? 'low'
          : s.confidence,
    });
  }
  const alternates = result.alternates
    .filter((a) => !used.has(a.ref) && (used.add(a.ref), true))
    .map((a) => ({ book: refs.get(a.ref)!, reason: a.reason.trim() }));
  return { selected, alternates };
}

/* ───────────── 3. 编排 ───────────── */

const structureSchema = z.object({
  title: z.string().describe('书展标题，不超过 16 字'),
  subtitle: z.string().describe('副标题，不超过 24 字'),
  sections: z.array(
    z.object({
      title: z.string(),
      intent: z.string().describe('该展区想引导读者思考什么，30–60 字'),
      refs: z.array(z.string()),
    }),
  ),
  statement: z.object({
    goals: z.string().describe('活动目标'),
    audienceNote: z.string().describe('面向读者的特点与需求'),
    structureLogic: z.string().describe('展区划分的逻辑'),
    selectionLogic: z.string().describe('选书逻辑'),
  }),
});

async function planStructure(ctx: CurationContext, selected: Selected[]) {
  const refs = new Map(selected.map((s, i) => [`b${i + 1}`, s]));
  const listing = [...refs.entries()]
    .map(([ref, s]) => `${ref}｜《${s.book.title}》｜入选理由：${s.reason}`)
    .join('\n');
  const result = await generateStructured({
    model: ctx.model,
    task: 'structure',
    temperature: 0.5,
    signal: ctx.signal,
    schema: structureSchema,
    system: `你是书展策展人。把入选书目编排为 2–4 个展区，每本书只放入一个展区，展区之间形成递进或对照的叙事。${GROUNDING_RULES}`,
    prompt: `${briefText(ctx.brief)}\n\n入选书目：\n${listing}\n\n请给出书展标题、展区结构与策展说明。`,
    validate: (value) => {
      if (value.sections.length === 0) return '至少需要一个展区';
      const unknown = value.sections.flatMap((s) => s.refs).filter((ref) => !refs.has(ref));
      return unknown.length ? `编号 ${[...new Set(unknown)].join('、')} 不在入选书目中` : null;
    },
  });

  // 自动修正：重复分配只保留第一次；漏掉的书放进已有书目中最少的展区（模型给出的空展区视为多余）
  const assigned = new Map<string, number>();
  result.sections.forEach((section, index) => {
    for (const ref of section.refs) if (!assigned.has(ref)) assigned.set(ref, index);
  });
  for (const ref of refs.keys()) {
    if (assigned.has(ref)) continue;
    const counts = result.sections.map(
      (_, i) => [...assigned.values()].filter((v) => v === i).length,
    );
    const candidates = counts
      .map((count, i) => ({ count, i }))
      .filter((c) => c.count > 0 || assigned.size === 0);
    assigned.set(ref, candidates.reduce((min, c) => (c.count < min.count ? c : min)).i);
  }
  const sections = result.sections.map((s) => ({
    id: newId('sec'),
    title: s.title.trim(),
    intent: s.intent.trim(),
    panelText: '',
  }));
  const books = [...refs.entries()].map(([ref, s]) => ({
    ...s,
    sectionId: sections[assigned.get(ref)!]!.id,
  }));
  // 移除没有分到书的空展区
  const nonEmpty = sections.filter((section) => books.some((b) => b.sectionId === section.id));
  return {
    title: result.title.trim(),
    subtitle: result.subtitle.trim(),
    statement: result.statement,
    sections: nonEmpty,
    books,
  };
}

/* ───────────── 4. 撰写 ───────────── */

export function titleOnlyGuide(book: BookSnapshot): string {
  return `《${book.title}》${book.authors.length ? `（${book.authors.join('、')} 著）` : ''}。馆藏记录暂无内容简介，导读待馆员根据原书补充。`;
}

export async function writeGuide(
  model: LanguageModel,
  input: {
    book: BookSnapshot;
    brief: Brief;
    sectionTitle: string;
    reason: string;
    instruction?: string;
    signal?: AbortSignal;
  },
): Promise<Pick<PlanBook, 'guide' | 'guideBasis'>> {
  const { book } = input;
  if (!book.summary && book.subjects.length === 0)
    return { guide: titleOnlyGuide(book), guideBasis: 'title_only' };
  const { guide } = await generateStructured({
    model,
    task: 'guide',
    temperature: 0.7,
    signal: input.signal,
    schema: z.object({ guide: z.string() }),
    system: `你为书展撰写单本导读（展签文字），80–150 字，语气亲切，写给${input.brief.audience}，说明这本书能带给读者什么、与展区主题的关系。${GROUNDING_RULES}`,
    prompt: `书展主题：${input.brief.theme}\n所在展区：${input.sectionTitle}\n入选理由：${input.reason}\n书目资料：${describeBook('本书', book, 400)}${
      input.instruction ? `\n修改要求：${input.instruction}` : ''
    }`,
    validate: (v) => (charLength(v.guide.trim()) < 20 ? '导读太短' : null),
  });
  return { guide: guide.trim(), guideBasis: book.summary ? 'summary' : 'subjects' };
}

const materialsSchema = z.object({
  introduction: z.string().describe('书展总导语，150–300 字'),
  panels: z.array(
    z.object({
      index: z.number().int(),
      panelText: z.string().describe('展板短文，不超过 150 字'),
    }),
  ),
  activity: z.object({
    format: z.string().describe('活动形式，如“主题导览 + 小组讨论”'),
    segments: z.array(
      z.object({ minutes: z.number().int(), title: z.string(), description: z.string() }),
    ),
    questions: z.array(z.string()).describe('讨论问题 3–5 个'),
  }),
});

async function writeMaterials(
  ctx: CurationContext,
  structure: Awaited<ReturnType<typeof planStructure>>,
) {
  const sectionsText = structure.sections
    .map((s, i) => {
      const titles = structure.books
        .filter((b) => b.sectionId === s.id)
        .map((b) => `《${b.book.title}》`);
      return `${i + 1}. ${s.title}：${s.intent}（${titles.join('、')}）`;
    })
    .join('\n');
  return generateStructured({
    model: ctx.model,
    task: 'materials',
    temperature: 0.7,
    signal: ctx.signal,
    schema: materialsSchema,
    system: `你为高校图书馆书展撰写展示文案与一场约 30 分钟的导览/讨论活动方案。${GROUNDING_RULES}${formatLessons(ctx.lessons)}`,
    prompt: `${briefText(ctx.brief)}\n书展标题：${structure.title}\n展区：\n${sectionsText}\n\n请为每个展区写展板短文（index 对应展区序号），并设计活动流程，各环节分钟数合计约 30 分钟。`,
    validate: (v) => {
      const total = v.activity.segments.reduce((sum, s) => sum + s.minutes, 0);
      if (v.activity.segments.length === 0) return '活动流程至少需要一个环节';
      if (total < 15 || total > 60) return `活动各环节合计 ${total} 分钟，需要控制在 30 分钟左右`;
      return null;
    },
  });
}

/* ───────────── 流水线 ───────────── */

export async function runCuration(
  ctx: CurationContext,
): Promise<{ plan: Plan; checks: CheckItem[] }> {
  const pool = await stage(ctx, 'pool', '整理候选馆藏', async () => {
    const value = await buildPool(ctx);
    return { value, detail: `${value.length} 本候选` };
  });

  const { selected, alternates } = await stage(ctx, 'select', '筛选书目', async () => {
    const value = await selectBooks(ctx, pool);
    return {
      value,
      detail: `入选 ${value.selected.length} 本，备选 ${value.alternates.length} 本`,
    };
  });

  const structure = await stage(ctx, 'structure', '规划展览结构', async () => {
    const value = await planStructure(ctx, selected);
    return { value, detail: `${value.sections.length} 个展区` };
  });

  const { books, materials } = await stage(ctx, 'write', '撰写导读与活动材料', async () => {
    const sectionTitle = new Map(structure.sections.map((s) => [s.id, s.title]));
    const [guides, materialsResult] = await Promise.all([
      mapLimit(structure.books, 3, (b) =>
        writeGuide(ctx.model, {
          book: b.book,
          brief: ctx.brief,
          sectionTitle: sectionTitle.get(b.sectionId)!,
          reason: b.reason,
          signal: ctx.signal,
        }),
      ),
      writeMaterials(ctx, structure),
    ]);
    const value = {
      books: structure.books.map((b, i): PlanBook => ({ ...b, ...guides[i]!, edited: false })),
      materials: materialsResult,
    };
    return {
      value,
      detail: `${value.books.length} 篇导读、${structure.sections.length} 篇展板短文、活动流程`,
    };
  });

  const plan: Plan = {
    title: structure.title,
    subtitle: structure.subtitle,
    statement: structure.statement,
    sections: structure.sections.map((s, i) => ({
      ...s,
      panelText: materials.panels.find((p) => p.index === i + 1)?.panelText.trim() ?? '',
    })),
    books,
    alternates,
    introduction: materials.introduction.trim(),
    activity: {
      durationMinutes: materials.activity.segments.reduce((sum, s) => sum + s.minutes, 0),
      format: materials.activity.format.trim(),
      segments: materials.activity.segments,
      questions: materials.activity.questions,
    },
    candidateCount: pool.length,
    generatedAt: nowIso(),
    model: ctx.modelLabel,
  };

  const checks = await stage(ctx, 'check', '检查来源、字段与表述', async () => {
    const rules = ruleChecks(plan, ctx.brief);
    let ai: typeof rules = [];
    try {
      ai = await groundingChecks(ctx.model, plan, ctx.signal);
    } catch (error) {
      if (ctx.signal?.aborted) throw error;
      ctx.progress({
        type: 'log',
        message: `导读核验未完成（${error instanceof Error ? error.message : '未知错误'}），已跳过，可稍后重新检查`,
      });
    }
    const value = mergeChecks([...rules, ...ai], ctx.previousChecks);
    const blockers = value.filter((c) => c.severity === 'blocker').length;
    return {
      value,
      detail: `${value.length} 项待核对${blockers ? `，其中 ${blockers} 项必须处理` : ''}`,
    };
  });

  return { plan, checks };
}
