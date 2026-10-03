import type { LanguageModel } from 'ai';
import { z } from 'zod';
import { cleanUrl } from '@yys/book-sources';
import { newId, type Brief, type CheckItem, type Plan } from '@yys/shared';
import { describeBook } from './books';
import { charLength, generateStructured } from './llm';

type Draft = Omit<CheckItem, 'id' | 'status' | 'note'>;

const LIMITS = { guide: 200, panelText: 150, introduction: 400 };

const mainTitle = (title: string): string =>
  title
    .split(/[：:（(]/)[0]!
    .replace(/\s+/g, '')
    .toLowerCase();

/** 确定性规则检查：结果可复现，不依赖模型 */
export function ruleChecks(plan: Plan, brief: Brief): Draft[] {
  const items: Draft[] = [];
  const add = (item: Omit<Draft, 'origin' | 'suggestion'> & { suggestion?: string }): void => {
    items.push({ origin: 'rule', suggestion: '', ...item });
  };

  for (const entry of plan.books) {
    const { book } = entry;
    const name = `《${book.title}》`;
    if (!book.sourceUrl) {
      add({
        key: `no_url:${book.id}`,
        severity: 'blocker',
        category: 'missing_field',
        bookId: book.id,
        message: `${name}缺少馆藏来源链接`,
        suggestion: '在学校系统中找到该书记录，补充链接后重新导入，或更换为其他书目',
      });
    } else if (!cleanUrl(book.sourceUrl).valid) {
      add({
        key: `bad_url:${book.id}`,
        severity: 'blocker',
        category: 'source',
        bookId: book.id,
        message: `${name}的来源链接格式无法识别：${book.sourceUrl}`,
        suggestion: '核对并修正来源链接',
      });
    }
    if (!book.callNumber) {
      add({
        key: `no_callno:${book.id}`,
        severity: 'warning',
        category: 'missing_field',
        bookId: book.id,
        message: `${name}缺少索书号`,
        suggestion: '请馆员核对并补充索书号，读者需要据此在架上找书',
      });
    }
    if (book.authors.length === 0) {
      add({
        key: `no_author:${book.id}`,
        severity: 'warning',
        category: 'missing_field',
        bookId: book.id,
        message: `${name}缺少作者信息`,
      });
    }
    if (book.isSample) {
      add({
        key: `sample:${book.id}`,
        severity: 'warning',
        category: 'sample',
        bookId: book.id,
        message: `${name}来自示例书库，书目信息取自国家图书馆，不代表本校馆藏`,
        suggestion: '正式活动前请换成学校馆藏中的记录，确认读者能在本馆借到',
      });
    }
    if (entry.guideBasis === 'title_only') {
      add({
        key: `guide_basis:${book.id}`,
        severity: 'warning',
        category: 'judgment',
        bookId: book.id,
        message: `${name}没有内容简介，导读仅能依据书名撰写`,
        suggestion: '请馆员根据原书补写导读，或补充摘要后重新生成',
      });
    }
    if (entry.confidence === 'low') {
      add({
        key: `low_conf:${book.id}`,
        severity: 'warning',
        category: 'judgment',
        bookId: book.id,
        message: `${name}与主题的关联依据较弱`,
        suggestion: '请判断是否保留，或从备选书目中替换',
      });
    }
    if (charLength(entry.guide) > LIMITS.guide) {
      add({
        key: `guide_len:${book.id}`,
        severity: 'info',
        category: 'length',
        bookId: book.id,
        message: `${name}的导读超过 ${LIMITS.guide} 字，展签可能放不下`,
      });
    }
  }

  // 重复：ISBN 相同、索书号相同，或主书名相同
  const seen = new Map<string, string>();
  for (const { book } of plan.books) {
    const keys = [
      book.isbn && `isbn:${book.isbn}`,
      book.callNumber && `call:${book.callNumber}`,
      `title:${mainTitle(book.title)}`,
    ].filter(Boolean) as string[];
    const hit = keys.map((k) => seen.get(k)).find(Boolean);
    if (hit) {
      const first = plan.books.find((b) => b.book.id === hit)!.book;
      add({
        key: `dup:${[hit, book.id].sort().join('+')}`,
        severity: 'blocker',
        category: 'duplicate',
        bookId: book.id,
        message: `《${book.title}》与《${first.title}》疑似同一本书`,
        suggestion: '保留一条记录，另一条替换为备选书目',
      });
    }
    for (const k of keys) if (!seen.has(k)) seen.set(k, book.id);
  }

  const count = plan.books.length;
  if (count < brief.bookCount - 2 || count > brief.bookCount + 2) {
    add({
      key: 'count',
      severity: 'warning',
      category: 'count',
      message: `入选 ${count} 本，与期望的 ${brief.bookCount} 本相差较多`,
      suggestion: count < brief.bookCount ? '可导入更多相关馆藏后重新策展' : '可删减关联较弱的书目',
    });
  }
  for (const section of plan.sections) {
    if (charLength(section.panelText) > LIMITS.panelText) {
      add({
        key: `panel_len:${section.id}`,
        severity: 'info',
        category: 'length',
        message: `展区“${section.title}”的展板短文超过 ${LIMITS.panelText} 字`,
      });
    }
  }
  if (charLength(plan.introduction) > LIMITS.introduction) {
    add({
      key: 'intro_len',
      severity: 'info',
      category: 'length',
      message: `总导语超过 ${LIMITS.introduction} 字`,
    });
  }
  return items;
}

/** 合并新旧检查结果：同一问题保留用户已做的处理；已经不存在的问题自动移除 */
export function mergeChecks(next: Draft[], previous: CheckItem[]): CheckItem[] {
  const byKey = new Map(previous.map((item) => [item.key, item]));
  return next.map((draft) => {
    const old = byKey.get(draft.key);
    return {
      ...draft,
      id: old?.id ?? newId('chk'),
      status: old?.status ?? 'open',
      note: old?.note ?? '',
    };
  });
}

const groundingSchema = z.object({
  issues: z.array(
    z.object({
      ref: z.string().describe('书目编号'),
      quote: z.string().describe('导读中有问题的原句'),
      problem: z.string().describe('问题说明'),
    }),
  ),
});

/** 语义核验：导读是否出现了书目资料中没有的具体事实 */
export async function groundingChecks(
  model: LanguageModel,
  plan: Plan,
  signal?: AbortSignal,
): Promise<Draft[]> {
  const targets = plan.books.filter(
    (b) => b.guideBasis !== 'manual' && b.guideBasis !== 'title_only' && b.guide.trim(),
  );
  if (targets.length === 0) return [];
  const refs = new Map(targets.map((entry, i) => [`b${i + 1}`, entry]));
  const listing = [...refs.entries()]
    .map(([ref, entry]) => `${describeBook(ref, entry.book, 300)}\n导读：${entry.guide}`)
    .join('\n\n');

  const result = await generateStructured({
    model,
    task: 'grounding',
    temperature: 0,
    signal,
    schema: groundingSchema,
    system:
      '你是图书馆的审校员。逐条比对每本书的导读与该书的资料（书名、作者、主题词、摘要）。找出导读中资料没有提到、无法核实的具体事实，例如情节、数据、人物经历、获奖情况、出版信息。合理的概括与推荐语不算问题。没有问题时返回空数组。',
    prompt: `${listing}\n\n请列出有问题的句子。`,
    validate: (value) => {
      const bad = value.issues.filter((issue) => !refs.has(issue.ref)).map((i) => i.ref);
      return bad.length ? `编号 ${bad.join('、')} 不存在，只能使用列表中的编号` : null;
    },
  });

  return result.issues.map((issue) => {
    const entry = refs.get(issue.ref)!;
    return {
      key: `ground:${entry.book.id}:${issue.quote.slice(0, 24)}`,
      severity: 'warning',
      category: 'source',
      origin: 'ai',
      bookId: entry.book.id,
      message: `《${entry.book.title}》导读中“${issue.quote}”无法从馆藏资料中核实`,
      suggestion: issue.problem,
    } satisfies Draft;
  });
}

export const hasOpenBlockers = (checks: CheckItem[]): boolean =>
  checks.some((c) => c.severity === 'blocker' && c.status === 'open');
