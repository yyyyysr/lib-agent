import type { LanguageModel } from 'ai';
import { z } from 'zod';
import {
  nowIso,
  type ActivityPackage,
  type Brief,
  type CheckItem,
  type Execution,
  type FeedbackEntry,
  type Plan,
  type Proposal,
  type Retrospective,
  type UserInfo,
} from '@yys/shared';
import { charLength, generateStructured } from './llm';

const FACT_RULES =
  '不要编造书目资料之外的内容；不要写具体的时间、地点、索书号，这些由系统按模板填入。';

const planDigest = (plan: Plan): string =>
  plan.sections
    .map(
      (s) =>
        `${s.title}：${plan.books
          .filter((b) => b.sectionId === s.id)
          .map((b) => `《${b.book.title}》`)
          .join('、')}`,
    )
    .join('\n');

/* ───────────── 策展申请书 ───────────── */

const proposalTextSchema = z.object({
  purpose: z.string().describe('活动目的与意义，150–250 字'),
  format: z
    .string()
    .describe('拟开展形式，例如“主题书架展陈 + 30 分钟导读分享”，并简要说明，60–120 字'),
  expectedOutcomes: z.string().describe('预期成果，80–150 字'),
  support: z.string().describe('需要图书馆提供的支持，如场地、展架、宣传渠道，50–100 字'),
});

export async function generateProposal(
  model: LanguageModel,
  input: {
    brief: Brief;
    plan: Plan;
    applicant: UserInfo;
    organizer?: string;
    signal?: AbortSignal;
  },
): Promise<Proposal> {
  const { brief, plan, applicant } = input;
  const text = await generateStructured({
    model,
    task: 'proposal',
    temperature: 0.5,
    signal: input.signal,
    schema: proposalTextSchema,
    system: `你代表策展人撰写提交给${input.organizer || '图书馆'}负责人的《主题书展策展申请书》，语言正式、简洁。${FACT_RULES}`,
    prompt: `书展：${plan.title}${plan.subtitle ? `——${plan.subtitle}` : ''}\n主题：${brief.theme}\n目标读者：${brief.audience}\n活动目标：${plan.statement.goals}\n展区与书目：\n${planDigest(plan)}\n活动形式：${plan.activity.format}`,
  });
  const sectionTitle = new Map(plan.sections.map((s) => [s.id, s.title]));
  return {
    organizer: input.organizer ?? '',
    title: plan.title,
    theme: brief.theme,
    audience: brief.audience,
    purpose: text.purpose.trim(),
    format: text.format.trim(),
    expectedOutcomes: text.expectedOutcomes.trim(),
    support: text.support.trim(),
    schedule: { date: brief.eventDate, time: brief.eventTime, venue: brief.venue },
    applicant: {
      userId: applicant.id,
      name: applicant.displayName,
      memberNo: applicant.memberNo,
      department: applicant.department,
    },
    booklist: plan.books.map((b) => ({
      title: b.book.title,
      authors: b.book.authors.join('、'),
      callNumber: b.book.callNumber ?? '待核对',
      section: sectionTitle.get(b.sectionId) ?? '',
    })),
    generatedAt: nowIso(),
  };
}

/* ───────────── 海报与活动包 ───────────── */

const packageTextSchema = z.object({
  poster: z.object({
    headline: z.string().describe('海报主标题，不超过 12 字'),
    subheadline: z.string().describe('副标题，不超过 20 字'),
    tagline: z.string().describe('一句话宣传语，不超过 30 字'),
    highlights: z.array(z.string()).describe('3 个亮点，每个不超过 16 字'),
    callToAction: z.string().describe('行动号召，不超过 16 字'),
  }),
  promotion: z.object({
    postTitle: z.string().describe('校园公众号推文标题'),
    postBody: z.string().describe('推文正文，300–600 字，可分段'),
    signupIntro: z.string().describe('报名介绍，80–150 字'),
    notice: z.string().describe('校园通知短讯，不超过 100 字'),
  }),
  feedbackQuestions: z.array(z.string()).describe('活动后的匿名反馈问题 4–6 个'),
});

export async function generatePackage(
  model: LanguageModel,
  input: {
    brief: Brief;
    plan: Plan;
    proposal: Proposal;
    approvalComment?: string;
    /** 主办单位，例如“中山大学图书馆”，推文与通知中会署名 */
    organizer?: string;
    signal?: AbortSignal;
  },
): Promise<ActivityPackage> {
  const { brief, plan } = input;
  const text = await generateStructured({
    model,
    task: 'package',
    temperature: 0.8,
    signal: input.signal,
    schema: packageTextSchema,
    system: `你是${input.organizer || '图书馆'}阅读推广的宣传策划，为已立项的主题书展撰写海报文案、推文、报名介绍、校园通知和反馈问卷。文字要吸引${brief.audience}。${input.organizer ? `推文与通知以“${input.organizer}”署名。` : ''}${FACT_RULES}`,
    prompt: `书展：${plan.title}${plan.subtitle ? `——${plan.subtitle}` : ''}\n主题：${brief.theme}\n总导语：${plan.introduction}\n展区与书目：\n${planDigest(plan)}\n活动形式：${plan.activity.format}\n活动环节：${plan.activity.segments.map((s) => s.title).join('、')}${
      input.approvalComment ? `\n立项审批意见：${input.approvalComment}` : ''
    }`,
    validate: (v) => {
      if (charLength(v.poster.headline) > 16) return '海报主标题过长，需不超过 12 字';
      if (v.poster.highlights.length < 2) return '海报亮点至少 2 个';
      if (v.feedbackQuestions.length < 3) return '反馈问题至少 3 个';
      return null;
    },
  });
  return {
    poster: { template: 'classic', ...text.poster, highlights: text.poster.highlights.slice(0, 3) },
    promotion: text.promotion,
    feedbackQuestions: text.feedbackQuestions,
    generatedAt: nowIso(),
  };
}

/* ───────────── 复盘 ───────────── */

const retroTextSchema = z.object({
  summary: z.string().describe('复盘总结，150–250 字'),
  worked: z.array(z.string()).describe('有效的做法与内容'),
  improve: z.array(
    z.object({
      target: z.string().describe('需要修改的材料或环节'),
      issue: z.string(),
      suggestion: z.string(),
    }),
  ),
  audienceInsights: z.array(z.string()).describe('从反馈中看到的读者需求'),
  nextTime: z.array(z.string()).describe('给下一次活动的具体建议'),
});

export function feedbackMetrics(
  execution: Execution,
  feedback: FeedbackEntry[],
): Retrospective['metrics'] {
  const rated = feedback.filter((f) => f.rating !== null);
  const averageRating = rated.length
    ? Math.round((rated.reduce((s, f) => s + f.rating!, 0) / rated.length) * 10) / 10
    : null;
  return { feedbackCount: feedback.length, averageRating, participants: execution.participants };
}

export async function generateRetrospective(
  model: LanguageModel,
  input: {
    brief: Brief;
    plan: Plan;
    execution: Execution;
    feedback: FeedbackEntry[];
    reviewComments: string[];
    openChecks: CheckItem[];
    signal?: AbortSignal;
  },
): Promise<Retrospective> {
  const metrics = feedbackMetrics(input.execution, input.feedback);
  const feedbackText = input.feedback
    .slice(0, 200)
    .map(
      (f, i) =>
        `${i + 1}. ${f.rating ? `[${f.rating}分] ` : ''}${[...f.content].slice(0, 200).join('')}`,
    )
    .join('\n');
  const text = await generateStructured({
    model,
    task: 'retrospective',
    temperature: 0.4,
    signal: input.signal,
    schema: retroTextSchema,
    system:
      '你是阅读推广活动的复盘顾问。依据真实的执行记录与读者反馈，客观总结哪些内容有效、哪些材料需要修改，并给下一次活动提出可操作的建议。反馈不足时如实说明，不要夸大效果。',
    prompt: [
      `书展：${input.plan.title}（主题：${input.brief.theme}；读者：${input.brief.audience}）`,
      `展区与书目：\n${planDigest(input.plan)}`,
      `活动形式：${input.plan.activity.format}`,
      `执行记录：举办日期 ${input.execution.heldOn || '未填写'}，参与 ${input.execution.participants} 人。${input.execution.notes}`,
      `反馈统计：共 ${metrics.feedbackCount} 条，平均评分 ${metrics.averageRating ?? '无'}`,
      feedbackText ? `读者反馈：\n${feedbackText}` : '读者反馈：暂无',
      input.reviewComments.length ? `审批意见：\n${input.reviewComments.join('\n')}` : '',
      input.openChecks.length
        ? `策展时未处理的核对项：\n${input.openChecks.map((c) => c.message).join('\n')}`
        : '',
    ]
      .filter(Boolean)
      .join('\n\n'),
  });
  return { ...text, metrics, generatedAt: nowIso() };
}

/* ───────────── 局部改写 ───────────── */

export async function rewriteText(
  model: LanguageModel,
  input: {
    kind: string;
    current: string;
    brief: Brief;
    plan: Plan;
    instruction: string;
    maxChars: number;
    signal?: AbortSignal;
  },
): Promise<string> {
  const { text } = await generateStructured({
    model,
    task: 'rewrite',
    temperature: 0.7,
    signal: input.signal,
    schema: z.object({ text: z.string() }),
    system: `你按策展人的修改要求改写书展的${input.kind}，不超过 ${input.maxChars} 字。${FACT_RULES}`,
    prompt: `书展：${input.plan.title}（主题：${input.brief.theme}；读者：${input.brief.audience}）\n展区与书目：\n${planDigest(input.plan)}\n\n当前内容：\n${input.current}\n\n修改要求：${input.instruction}`,
    validate: (v) => (v.text.trim() ? null : '内容为空'),
  });
  return text.trim();
}

const activitySchema = z.object({
  format: z.string(),
  segments: z.array(
    z.object({ minutes: z.number().int(), title: z.string(), description: z.string() }),
  ),
  questions: z.array(z.string()),
});

export async function rewriteActivity(
  model: LanguageModel,
  input: { brief: Brief; plan: Plan; instruction: string; signal?: AbortSignal },
): Promise<Plan['activity']> {
  const result = await generateStructured({
    model,
    task: 'rewrite_activity',
    temperature: 0.7,
    signal: input.signal,
    schema: activitySchema,
    system: `你按策展人的修改要求调整书展配套活动流程。${FACT_RULES}`,
    prompt: `书展：${input.plan.title}\n当前活动：${JSON.stringify(input.plan.activity)}\n\n修改要求：${input.instruction}`,
    validate: (v) => (v.segments.length === 0 ? '活动流程至少需要一个环节' : null),
  });
  return { ...result, durationMinutes: result.segments.reduce((s, x) => s + x.minutes, 0) };
}

export async function rewriteStatement(
  model: LanguageModel,
  input: { brief: Brief; plan: Plan; instruction: string; signal?: AbortSignal },
): Promise<Plan['statement']> {
  return generateStructured({
    model,
    task: 'rewrite_statement',
    temperature: 0.6,
    signal: input.signal,
    schema: z.object({
      goals: z.string(),
      audienceNote: z.string(),
      structureLogic: z.string(),
      selectionLogic: z.string(),
    }),
    system: `你按策展人的修改要求改写书展的策展说明。${FACT_RULES}`,
    prompt: `书展：${input.plan.title}\n展区与书目：\n${planDigest(input.plan)}\n当前策展说明：${JSON.stringify(input.plan.statement)}\n\n修改要求：${input.instruction}`,
  });
}

/* ───────────── 反馈匿名化 ───────────── */

/** 去除手机号、邮箱、学号/工号等可识别个人的信息；姓名无法可靠识别，录入时提示用户不要填写 */
export function anonymize(text: string): string {
  return text
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '［邮箱已隐去］')
    .replace(/(?<!\d)1[3-9]\d{9}(?!\d)/g, '［手机号已隐去］')
    .replace(/(?<!\d)\d{8,}(?!\d)/g, '［编号已隐去］');
}
