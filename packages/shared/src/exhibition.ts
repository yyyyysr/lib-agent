import { z } from 'zod';

/* ───────────── 状态机 ───────────── */

export const exhibitionStatusSchema = z.enum([
  'draft', // 填写需求
  'curating', // 智能体策展中（或运行中断）
  'reviewing', // 核对与确认
  'proposal_draft', // 申请书已生成，待提交
  'proposal_pending', // 立项审批中
  'proposal_changes', // 立项审批：需修改
  'proposal_approved', // 立项审批：同意
  'package_draft', // 海报与活动包已生成，待提交
  'package_pending', // 上线审批中
  'package_changes', // 上线审批：需修改
  'published', // 已上线（首页展示、活动预告、反馈录入）
  'completed', // 已复盘
]);
export type ExhibitionStatus = z.infer<typeof exhibitionStatusSchema>;

export const statusLabels: Record<ExhibitionStatus, string> = {
  draft: '填写需求',
  curating: '策展中',
  reviewing: '待核对',
  proposal_draft: '申请书待提交',
  proposal_pending: '立项审批中',
  proposal_changes: '立项需修改',
  proposal_approved: '立项已同意',
  package_draft: '活动包待提交',
  package_pending: '上线审批中',
  package_changes: '上线需修改',
  published: '已上线',
  completed: '已复盘',
};

export const workflowSteps = [
  { key: 'brief', label: '需求' },
  { key: 'curate', label: '策展' },
  { key: 'review', label: '核对' },
  { key: 'proposal', label: '申请书' },
  { key: 'approval1', label: '立项审批' },
  { key: 'package', label: '海报与活动包' },
  { key: 'approval2', label: '上线审批' },
  { key: 'publish', label: '上线与反馈' },
  { key: 'retro', label: '复盘' },
] as const;
export type WorkflowStepKey = (typeof workflowSteps)[number]['key'];

const stepOfStatus: Record<ExhibitionStatus, WorkflowStepKey> = {
  draft: 'brief',
  curating: 'curate',
  reviewing: 'review',
  proposal_draft: 'proposal',
  proposal_pending: 'approval1',
  proposal_changes: 'approval1',
  proposal_approved: 'package',
  package_draft: 'package',
  package_pending: 'approval2',
  package_changes: 'approval2',
  published: 'publish',
  completed: 'retro',
};
export const currentStep = (status: ExhibitionStatus): WorkflowStepKey => stepOfStatus[status];
export const stepIndex = (key: WorkflowStepKey): number =>
  workflowSteps.findIndex((s) => s.key === key);

/** 各类内容可编辑的状态；服务端据此拒绝越权修改 */
export const editableIn = {
  brief: ['draft', 'curating', 'reviewing', 'proposal_draft', 'proposal_changes'],
  plan: ['reviewing', 'proposal_draft', 'proposal_changes'],
  proposal: ['proposal_draft', 'proposal_changes'],
  package: ['proposal_approved', 'package_draft', 'package_changes'],
  feedback: ['published', 'completed'],
} as const satisfies Record<string, readonly ExhibitionStatus[]>;

export const isEditable = (kind: keyof typeof editableIn, status: ExhibitionStatus): boolean =>
  (editableIn[kind] as readonly ExhibitionStatus[]).includes(status);

/* ───────────── 需求 ───────────── */

export const briefSchema = z.object({
  theme: z.string().trim().min(2, '请填写主题').max(60),
  audience: z.string().trim().min(2, '请填写目标读者').max(60),
  eventDate: z.string().max(20).default(''),
  eventTime: z.string().max(40).default(''),
  venue: z.string().trim().max(60).default(''),
  bookCount: z.number().int().min(3).max(30).default(10),
  requirements: z.string().max(800).default(''),
  /** 从哪些书目来源中选书；为空表示全部 */
  sourceIds: z.array(z.string()).default([]),
});
export type Brief = z.infer<typeof briefSchema>;

/* ───────────── 策展方案 ───────────── */

/** 入选时的书目快照：之后书库变动不影响已提交的方案，也便于追溯 */
export const bookSnapshotSchema = z.object({
  id: z.string(),
  title: z.string(),
  authors: z.array(z.string()),
  callNumber: z.string().optional(),
  sourceUrl: z.string().optional(),
  subjects: z.array(z.string()).default([]),
  summary: z.string().optional(),
  isbn: z.string().optional(),
  isSample: z.boolean(),
});
export type BookSnapshot = z.infer<typeof bookSnapshotSchema>;

export const evidenceFieldSchema = z.enum(['title', 'subjects', 'summary']);

export const planBookSchema = z.object({
  book: bookSnapshotSchema,
  sectionId: z.string(),
  reason: z.string(),
  evidence: z.array(evidenceFieldSchema),
  confidence: z.enum(['high', 'medium', 'low']),
  guide: z.string(),
  /** 导读依据：摘要 / 主题词 / 仅书名（需核对）/ 人工撰写 */
  guideBasis: z.enum(['summary', 'subjects', 'title_only', 'manual']),
  edited: z.boolean().default(false),
});
export type PlanBook = z.infer<typeof planBookSchema>;

export const planSectionSchema = z.object({
  id: z.string(),
  title: z.string(),
  intent: z.string(),
  panelText: z.string(),
});
export type PlanSection = z.infer<typeof planSectionSchema>;

export const activitySegmentSchema = z.object({
  minutes: z.number().int().min(1).max(120),
  title: z.string(),
  description: z.string(),
});

export const planSchema = z.object({
  title: z.string(),
  subtitle: z.string().default(''),
  statement: z.object({
    goals: z.string(),
    audienceNote: z.string(),
    structureLogic: z.string(),
    selectionLogic: z.string(),
  }),
  sections: z.array(planSectionSchema),
  books: z.array(planBookSchema),
  alternates: z.array(z.object({ book: bookSnapshotSchema, reason: z.string() })),
  introduction: z.string(),
  activity: z.object({
    durationMinutes: z.number().int(),
    format: z.string(),
    segments: z.array(activitySegmentSchema),
    questions: z.array(z.string()),
  }),
  candidateCount: z.number().int(),
  generatedAt: z.string(),
  model: z.string(),
});
export type Plan = z.infer<typeof planSchema>;

/* ───────────── 核对清单 ───────────── */

export const checkItemSchema = z.object({
  id: z.string(),
  /** 规则检查的稳定标识；同一问题重新检查时据此保留用户的处理状态 */
  key: z.string(),
  severity: z.enum(['blocker', 'warning', 'info']),
  category: z.enum([
    'missing_field',
    'source',
    'duplicate',
    'sample',
    'judgment',
    'length',
    'count',
  ]),
  origin: z.enum(['rule', 'ai']),
  bookId: z.string().optional(),
  message: z.string(),
  suggestion: z.string().default(''),
  status: z.enum(['open', 'resolved', 'dismissed']),
  note: z.string().default(''),
});
export type CheckItem = z.infer<typeof checkItemSchema>;

export const checkCategoryLabels: Record<CheckItem['category'], string> = {
  missing_field: '字段缺失',
  source: '来源不清',
  duplicate: '重复书目',
  sample: '示例数据',
  judgment: '需人工判断',
  length: '篇幅',
  count: '书目数量',
};

/* ───────────── 策展申请书 ───────────── */

export const proposalSchema = z.object({
  title: z.string(),
  theme: z.string(),
  purpose: z.string(),
  audience: z.string(),
  /** 拟开展形式 */
  format: z.string(),
  schedule: z.object({ date: z.string(), time: z.string(), venue: z.string() }),
  applicant: z.object({
    userId: z.string(),
    name: z.string(),
    memberNo: z.string(),
    department: z.string(),
  }),
  booklist: z.array(
    z.object({
      title: z.string(),
      authors: z.string(),
      callNumber: z.string(),
      section: z.string(),
    }),
  ),
  expectedOutcomes: z.string(),
  support: z.string(),
  generatedAt: z.string(),
});
export type Proposal = z.infer<typeof proposalSchema>;

/* ───────────── 海报与活动包 ───────────── */

export const posterTemplateSchema = z.enum(['classic', 'modern', 'minimal']);
export type PosterTemplate = z.infer<typeof posterTemplateSchema>;

export const packageSchema = z.object({
  poster: z.object({
    template: posterTemplateSchema,
    headline: z.string(),
    subheadline: z.string(),
    tagline: z.string(),
    highlights: z.array(z.string()),
    callToAction: z.string(),
  }),
  promotion: z.object({
    postTitle: z.string(),
    postBody: z.string(),
    signupIntro: z.string(),
    notice: z.string(),
  }),
  feedbackQuestions: z.array(z.string()),
  generatedAt: z.string(),
});
export type ActivityPackage = z.infer<typeof packageSchema>;

/* ───────────── 活动执行、反馈与复盘 ───────────── */

export const executionSchema = z.object({
  heldOn: z.string().default(''),
  participants: z.number().int().min(0).default(0),
  notes: z.string().max(2000).default(''),
});
export type Execution = z.infer<typeof executionSchema>;

export interface FeedbackEntry {
  id: string;
  rating: number | null;
  content: string;
  createdAt: string;
}

export const retrospectiveSchema = z.object({
  summary: z.string(),
  worked: z.array(z.string()),
  improve: z.array(z.object({ target: z.string(), issue: z.string(), suggestion: z.string() })),
  audienceInsights: z.array(z.string()),
  nextTime: z.array(z.string()),
  metrics: z.object({
    feedbackCount: z.number().int(),
    averageRating: z.number().nullable(),
    participants: z.number().int(),
  }),
  generatedAt: z.string(),
});
export type Retrospective = z.infer<typeof retrospectiveSchema>;

/* ───────────── 审批 ───────────── */

export const approvalKindSchema = z.enum(['proposal', 'package']);
export type ApprovalKind = z.infer<typeof approvalKindSchema>;
export const approvalKindLabels: Record<ApprovalKind, string> = {
  proposal: '立项审批',
  package: '上线审批',
};

export interface ApprovalRecord {
  id: string;
  exhibitionId: string;
  exhibitionTitle: string;
  kind: ApprovalKind;
  status: 'pending' | 'approved' | 'changes_requested';
  submittedBy: { id: string; name: string };
  submittedAt: string;
  reviewer?: { id: string; name: string };
  reviewedAt?: string;
  comment: string;
}

export interface TimelineEvent {
  id: string;
  type: string;
  message: string;
  actor?: { id: string; name: string };
  at: string;
}

/* ───────────── 聚合视图 ───────────── */

export interface ExhibitionSummary {
  id: string;
  title: string;
  status: ExhibitionStatus;
  owner: { id: string; name: string };
  theme: string;
  eventDate: string;
  updatedAt: string;
  publishedAt?: string;
}

export interface ExhibitionDetail extends ExhibitionSummary {
  brief: Brief;
  plan: Plan | null;
  checks: CheckItem[];
  proposal: Proposal | null;
  package: ActivityPackage | null;
  execution: Execution;
  feedback: FeedbackEntry[];
  retrospective: Retrospective | null;
  approvals: ApprovalRecord[];
  timeline: TimelineEvent[];
  /** 当前用户可执行的操作，由服务端按角色与状态计算 */
  can: {
    edit: boolean;
    review: boolean;
    delete: boolean;
  };
  running: boolean;
}

export interface ShowcaseBook {
  book: BookSnapshot;
  guide: string;
  reason: string;
}

/** 首页展示用：只包含可公开的内容 */
export interface ShowcaseExhibition {
  id: string;
  title: string;
  subtitle: string;
  status: ExhibitionStatus;
  owner: { name: string; department: string };
  brief: Pick<Brief, 'theme' | 'audience' | 'eventDate' | 'eventTime' | 'venue'>;
  introduction: string;
  sections: (PlanSection & { books: ShowcaseBook[] })[];
  activity: Plan['activity'];
  package: ActivityPackage;
  execution: Execution;
  feedbackStats: { count: number; averageRating: number | null; highlights: string[] };
  retrospective: Pick<Retrospective, 'summary' | 'worked' | 'nextTime'> | null;
  publishedAt: string;
}

/* ───────────── 智能体运行进度 ───────────── */

export type AgentTask = 'curate' | 'proposal' | 'package' | 'retrospective';

export type AgentProgress =
  | {
      type: 'stage';
      stage: string;
      label: string;
      status: 'running' | 'done' | 'failed' | 'skipped';
      detail?: string;
    }
  | { type: 'log'; message: string }
  | { type: 'done'; status: ExhibitionStatus };
