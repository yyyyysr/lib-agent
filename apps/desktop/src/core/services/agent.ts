import {
  generatePackage,
  generateProposal,
  generateRetrospective,
  rewriteActivity,
  rewriteStatement,
  rewriteText,
  runCuration,
  toSnapshot,
  writeGuide,
  type LibraryAccess,
} from '@yys/agent-core';
import { mapProviderError } from '@yys/llm-gateway';
import {
  AppError,
  isEditable,
  statusLabels,
  type AgentProgress,
  type AgentTask,
  type ExhibitionStatus,
  type PlanBook,
  type SchoolBranding,
  type UserInfo,
} from '@yys/shared';
import type { ExhibitionRecord } from '@yys/db';
import type { RpcHandlers, StreamHandlers } from '../rpc-server';
import type { CoreDeps } from './context';
import type { createExhibitionServices } from './exhibitions';
import type { createModelServices } from './models';

type ExhibitionServices = ReturnType<typeof createExhibitionServices>;
type ResolveModel = ReturnType<typeof createModelServices>['resolveModel'];

/** 进度事件队列：后台任务写入，RPC 流读出 */
function channel<T>() {
  const queue: T[] = [];
  let finished = false;
  let failure: unknown;
  let wake: (() => void) | null = null;
  const notify = (): void => {
    wake?.();
    wake = null;
  };
  return {
    push: (value: T): void => {
      queue.push(value);
      notify();
    },
    close: (error?: unknown): void => {
      finished = true;
      failure = error;
      notify();
    },
    async *iterate(): AsyncGenerator<T> {
      for (;;) {
        if (queue.length) {
          yield queue.shift()!;
          continue;
        }
        if (finished) {
          if (failure) throw failure;
          return;
        }
        await new Promise<void>((resolve) => (wake = resolve));
      }
    },
  };
}

const asAppError = (error: unknown): AppError => {
  if (error instanceof AppError) return error;
  const shape = mapProviderError(error);
  return new AppError(shape.code, shape.message, shape.hint);
};

const taskLabels: Record<AgentTask, string> = {
  curate: '策展',
  proposal: '生成策展申请书',
  package: '生成海报与完整活动包',
  retrospective: '生成复盘总结',
};

export function createAgentServices(
  deps: CoreDeps,
  running: Set<string>,
  exhibitions: ExhibitionServices,
  resolveModel: ResolveModel,
  library: LibraryAccess,
  branding: () => SchoolBranding,
) {
  const { repos } = deps;
  const { owned, log, changed, find } = exhibitions;

  /** 往期复盘中的建议，作为新一期策展的参考 */
  const lessons = (): string[] =>
    repos.exhibitions
      .listPublished()
      .filter((e) => e.retrospective)
      .slice(0, 2)
      .flatMap((e) => [
        ...e.retrospective!.nextTime,
        ...e.retrospective!.improve.map((i) => `${i.target}：${i.suggestion}`),
      ])
      .slice(0, 6);

  const assertCanStart = (task: AgentTask, record: ExhibitionRecord): void => {
    const allowed: Record<AgentTask, ExhibitionStatus[]> = {
      curate: ['draft', 'curating', 'reviewing', 'proposal_draft', 'proposal_changes'],
      proposal: ['reviewing', 'proposal_draft', 'proposal_changes'],
      package: ['proposal_approved', 'package_draft', 'package_changes'],
      retrospective: ['published', 'completed'],
    };
    if (!allowed[task].includes(record.status)) {
      throw new AppError(
        'invalid_state',
        `当前状态“${statusLabels[record.status]}”下不能${taskLabels[task]}`,
      );
    }
    if (task === 'proposal') {
      if (!record.plan) throw new AppError('invalid_state', '还没有策展方案');
      const open = record.checks.filter(
        (c) => c.severity === 'blocker' && c.status === 'open',
      ).length;
      if (open)
        throw new AppError(
          'invalid_state',
          `还有 ${open} 项必须处理的核对项`,
          '在核对清单中修改方案、标记已处理，或写明理由后忽略',
        );
    }
  };

  async function runTask(
    task: AgentTask,
    record: ExhibitionRecord,
    user: UserInfo,
    signal: AbortSignal,
    progress: (e: AgentProgress) => void,
  ): Promise<ExhibitionStatus> {
    const { model, label } = await resolveModel(user);
    const single = async <T>(work: () => Promise<T>): Promise<T> => {
      progress({ type: 'stage', stage: task, label: taskLabels[task], status: 'running' });
      const value = await work();
      progress({ type: 'stage', stage: task, label: taskLabels[task], status: 'done' });
      return value;
    };
    log(record, 'agent', `智能体开始${taskLabels[task]}（${label}）`, user);

    switch (task) {
      case 'curate': {
        repos.exhibitions.update(record.id, { status: 'curating' });
        changed(record.id);
        const { plan, checks } = await runCuration({
          model,
          modelLabel: label,
          brief: record.brief,
          library,
          lessons: lessons(),
          previousChecks: record.checks,
          signal,
          progress,
        });
        repos.exhibitions.update(record.id, {
          plan,
          checks,
          title: plan.title || record.brief.theme,
          status: 'reviewing',
          proposal: null,
        });
        const blockers = checks.filter((c) => c.severity === 'blocker').length;
        log(
          record,
          'agent',
          `策展完成：${plan.books.length} 本书、${plan.sections.length} 个展区、${checks.length} 项待核对${blockers ? `（${blockers} 项必须处理）` : ''}`,
          user,
        );
        return 'reviewing';
      }
      case 'proposal': {
        const proposal = await single(() =>
          generateProposal(model, {
            brief: record.brief,
            plan: record.plan!,
            applicant: user,
            organizer: branding().organizer,
            signal,
          }),
        );
        repos.exhibitions.update(record.id, { proposal, status: 'proposal_draft' });
        log(record, 'agent', '已生成策展申请书，请核对后提交立项审批', user);
        return 'proposal_draft';
      }
      case 'package': {
        const approval = repos.approvals
          .listByExhibition(record.id)
          .find((a) => a.kind === 'proposal' && a.status === 'approved');
        const pkg = await single(() =>
          generatePackage(model, {
            brief: record.brief,
            plan: record.plan!,
            proposal: record.proposal!,
            approvalComment: approval?.comment,
            organizer: branding().organizer,
            signal,
          }),
        );
        if (record.package) pkg.poster.template = record.package.poster.template;
        repos.exhibitions.update(record.id, { package: pkg, status: 'package_draft' });
        log(record, 'agent', '已生成海报与完整活动包，请核对后提交上线审批', user);
        return 'package_draft';
      }
      case 'retrospective': {
        const retrospective = await single(() =>
          generateRetrospective(model, {
            brief: record.brief,
            plan: record.plan!,
            execution: record.execution,
            feedback: repos.feedback.list(record.id),
            reviewComments: repos.approvals
              .listByExhibition(record.id)
              .map((a) => a.comment)
              .filter(Boolean),
            openChecks: record.checks.filter((c) => c.status === 'open'),
            signal,
          }),
        );
        repos.exhibitions.update(record.id, { retrospective, status: 'completed' });
        log(record, 'agent', '已生成复盘总结', user);
        return 'completed';
      }
    }
  }

  /** 需要调用模型的局部修改：执行期间锁定书展，避免并发修改相互覆盖 */
  async function withLock<T>(id: string, work: () => Promise<T>): Promise<T> {
    running.add(id);
    changed(id);
    try {
      return await work();
    } catch (error) {
      throw asAppError(error);
    } finally {
      running.delete(id);
      changed(id);
    }
  }

  const editablePlan = (
    user: UserInfo,
    id: string,
  ): ExhibitionRecord & { plan: NonNullable<ExhibitionRecord['plan']> } => {
    const record = owned(user, id);
    if (!isEditable('plan', record.status) || !record.plan)
      throw new AppError('invalid_state', `当前状态“${statusLabels[record.status]}”下不能修改方案`);
    return record as ExhibitionRecord & { plan: NonNullable<ExhibitionRecord['plan']> };
  };

  /** 与手动编辑方案相同的保存路径：重新检查并回到“待核对” */
  const applyPlan = (
    record: ExhibitionRecord,
    plan: NonNullable<ExhibitionRecord['plan']>,
    user: UserInfo,
    message: string,
  ): ExhibitionRecord => exhibitions.savePlan(record, plan, user, message);

  const handlers: Pick<RpcHandlers, 'plan.replaceBook' | 'plan.regenerateGuide' | 'plan.rewrite'> =
    {
      'plan.replaceBook': ({ id, oldBookId, newBookId }, { user, signal }) => {
        const record = editablePlan(user, id);
        const plan = structuredClone(record.plan);
        const index = plan.books.findIndex((b) => b.book.id === oldBookId);
        if (index < 0) throw new AppError('not_found', '要替换的书不在书单中');
        if (plan.books.some((b) => b.book.id === newBookId))
          throw new AppError('invalid_params', '这本书已经在书单中');
        const alternate = plan.alternates.find((a) => a.book.id === newBookId);
        const libraryBook = alternate ? undefined : repos.books.getByIds([newBookId])[0];
        const book = alternate?.book ?? (libraryBook ? toSnapshot(libraryBook) : undefined);
        if (!book) throw new AppError('not_found', '书库中没有找到这本书');
        const old = plan.books[index]!;
        return withLock(id, async () => {
          const { model } = await resolveModel(user);
          const section = plan.sections.find((s) => s.id === old.sectionId);
          const reason = alternate?.reason ?? '由策展人从书库中选入';
          const guide = await writeGuide(model, {
            book,
            brief: record.brief,
            sectionTitle: section?.title ?? '',
            reason,
            signal,
          });
          const evidence: PlanBook['evidence'] = [
            'title',
            ...(book.subjects.length ? (['subjects'] as const) : []),
            ...(book.summary ? (['summary'] as const) : []),
          ];
          plan.books[index] = {
            book,
            sectionId: old.sectionId,
            reason,
            evidence,
            confidence: evidence.length > 1 ? 'medium' : 'low',
            ...guide,
            edited: false,
          };
          plan.alternates = [
            { book: old.book, reason: '被替换下的书目' },
            ...plan.alternates.filter((a) => a.book.id !== newBookId),
          ];
          return exhibitions.toDetail(
            applyPlan(record, plan, user, `将《${old.book.title}》替换为《${book.title}》`),
            user,
          );
        });
      },
      'plan.regenerateGuide': ({ id, bookId, instruction }, { user, signal }) => {
        const record = editablePlan(user, id);
        const plan = structuredClone(record.plan);
        const entry = plan.books.find((b) => b.book.id === bookId);
        if (!entry) throw new AppError('not_found', '这本书不在书单中');
        return withLock(id, async () => {
          const { model } = await resolveModel(user);
          const section = plan.sections.find((s) => s.id === entry.sectionId);
          Object.assign(
            entry,
            await writeGuide(model, {
              book: entry.book,
              brief: record.brief,
              sectionTitle: section?.title ?? '',
              reason: entry.reason,
              instruction,
              signal,
            }),
            {
              edited: false,
            },
          );
          return exhibitions.toDetail(
            applyPlan(record, plan, user, `重新生成《${entry.book.title}》的导读`),
            user,
          );
        });
      },
      'plan.rewrite': ({ id, target, sectionId, instruction }, { user, signal }) => {
        const record = editablePlan(user, id);
        const plan = structuredClone(record.plan);
        return withLock(id, async () => {
          const { model } = await resolveModel(user);
          const base = { brief: record.brief, plan, instruction, signal };
          let message: string;
          if (target === 'introduction') {
            plan.introduction = await rewriteText(model, {
              ...base,
              kind: '总导语',
              current: plan.introduction,
              maxChars: 300,
            });
            message = '按要求改写了总导语';
          } else if (target === 'section') {
            const section = plan.sections.find((s) => s.id === sectionId);
            if (!section) throw new AppError('not_found', '展区不存在');
            section.panelText = await rewriteText(model, {
              ...base,
              kind: `展区“${section.title}”的展板短文`,
              current: section.panelText,
              maxChars: 150,
            });
            message = `按要求改写了展区“${section.title}”的展板短文`;
          } else if (target === 'statement') {
            plan.statement = await rewriteStatement(model, base);
            message = '按要求改写了策展说明';
          } else {
            plan.activity = await rewriteActivity(model, base);
            message = '按要求调整了活动流程';
          }
          return exhibitions.toDetail(applyPlan(record, plan, user, message), user);
        });
      },
    };

  const streams: StreamHandlers = {
    'agent.run': async ({ id, task }, { user, signal }) => {
      const record = owned(user, id);
      assertCanStart(task, record);
      const ch = channel<AgentProgress>();
      running.add(id);
      changed(id);
      void (async () => {
        try {
          const status = await runTask(task, record, user, signal, ch.push);
          ch.push({ type: 'done', status });
          ch.close();
          changed(id, { showcase: task === 'retrospective' });
        } catch (error) {
          const appError = asAppError(error);
          // 失败时恢复到开始前的状态，已有的方案与材料保持不变
          const current = find(id);
          if (current.status !== record.status)
            repos.exhibitions.update(id, { status: record.status });
          log(record, 'agent', `${taskLabels[task]}未完成：${appError.message}`, user);
          ch.close(appError);
        } finally {
          running.delete(id);
          changed(id);
        }
      })();
      return ch.iterate();
    },
  };

  return { handlers, streams };
}
