import type { ApprovalRow, ExhibitionRecord } from '@yys/db';
import {
  anonymize,
  feedbackMetrics,
  hasOpenBlockers,
  mergeChecks,
  ruleChecks,
} from '@yys/agent-core';
import {
  AppError,
  approvalKindLabels,
  hasRole,
  isEditable,
  statusLabels,
  type ApprovalRecord,
  type ExhibitionDetail,
  type ExhibitionStatus,
  type ExhibitionSummary,
  type Plan,
  type ShowcaseExhibition,
  type UserInfo,
} from '@yys/shared';
import type { RpcHandlers } from '../rpc-server';
import type { CoreDeps } from './context';

export function createExhibitionServices(deps: CoreDeps, running: Set<string>) {
  const { repos } = deps;

  const name = (id: string | null | undefined): string =>
    id ? (repos.users.names([id]).get(id)?.name ?? '已删除用户') : '';

  /* ───────────── 访问控制 ───────────── */

  const find = (id: string): ExhibitionRecord => {
    const record = repos.exhibitions.get(id);
    if (!record) throw new AppError('not_found', '书展不存在，可能已被删除');
    return record;
  };

  /** 本人与审批管理员以上可查看；其他人只能在首页看到已上线的书展 */
  const viewable = (user: UserInfo, id: string): ExhibitionRecord => {
    const record = find(id);
    if (record.ownerId !== user.id && !hasRole(user.role, 'approver'))
      throw new AppError('forbidden', '只能查看自己发起的书展');
    return record;
  };

  /** 只有发起人可以推进工作流和修改内容 */
  const owned = (user: UserInfo, id: string): ExhibitionRecord => {
    const record = find(id);
    if (record.ownerId !== user.id) throw new AppError('forbidden', '只有书展发起人可以修改');
    if (running.has(id)) throw new AppError('busy', '智能体正在处理这个书展，请等待完成后再修改');
    return record;
  };

  const requireState = (
    kind: Parameters<typeof isEditable>[0],
    record: ExhibitionRecord,
    action: string,
  ): void => {
    if (!isEditable(kind, record.status)) {
      throw new AppError(
        'invalid_state',
        `当前状态“${statusLabels[record.status]}”下不能${action}`,
      );
    }
  };

  const log = (record: ExhibitionRecord, type: string, message: string, actor?: UserInfo): void => {
    repos.events.add(record.id, type, message, actor?.id);
  };

  const changed = (id: string, opts: { showcase?: boolean; approvals?: boolean } = {}): void => {
    deps.emit('exhibitions.changed', { id });
    if (opts.showcase) deps.emit('showcase.changed', {});
    if (opts.approvals) deps.emit('approvals.changed', {});
  };

  /* ───────────── 视图 ───────────── */

  const toSummary = (record: ExhibitionRecord): ExhibitionSummary => ({
    id: record.id,
    title: record.title,
    status: record.status,
    owner: { id: record.ownerId, name: name(record.ownerId) },
    theme: record.brief.theme,
    eventDate: record.brief.eventDate,
    updatedAt: record.updatedAt,
    publishedAt: record.publishedAt ?? undefined,
  });

  const toApproval = (row: ApprovalRow, title?: string): ApprovalRecord => ({
    id: row.id,
    exhibitionId: row.exhibitionId,
    exhibitionTitle: title ?? repos.exhibitions.get(row.exhibitionId)?.title ?? '',
    kind: row.kind,
    status: row.status,
    submittedBy: { id: row.submittedBy, name: name(row.submittedBy) },
    submittedAt: row.submittedAt,
    reviewer: row.reviewerId ? { id: row.reviewerId, name: name(row.reviewerId) } : undefined,
    reviewedAt: row.reviewedAt ?? undefined,
    comment: row.comment,
  });

  const toDetail = (record: ExhibitionRecord, viewer: UserInfo): ExhibitionDetail => {
    const approvals = repos.approvals
      .listByExhibition(record.id)
      .map((row) => toApproval(row, record.title));
    const events = repos.events.list(record.id);
    const actors = repos.users.names(
      events.map((e) => e.actorId).filter((id): id is string => Boolean(id)),
    );
    const isOwner = record.ownerId === viewer.id;
    return {
      ...toSummary(record),
      brief: record.brief,
      plan: record.plan,
      checks: record.checks,
      proposal: record.proposal,
      package: record.package,
      execution: record.execution,
      feedback: repos.feedback.list(record.id),
      retrospective: record.retrospective,
      approvals,
      timeline: events.map((e) => ({
        id: e.id,
        type: e.type,
        message: e.message,
        at: e.at,
        actor: e.actorId
          ? { id: e.actorId, name: actors.get(e.actorId)?.name ?? '已删除用户' }
          : undefined,
      })),
      can: {
        edit: isOwner,
        review:
          !isOwner &&
          hasRole(viewer.role, 'approver') &&
          approvals.some((a) => a.status === 'pending'),
        delete:
          viewer.role === 'superadmin' ||
          (isOwner && record.status !== 'published' && record.status !== 'completed'),
      },
      running: running.has(record.id),
    };
  };

  const toShowcase = (record: ExhibitionRecord): ShowcaseExhibition | null => {
    const { plan, package: pkg } = record;
    if (!plan || !pkg || !record.publishedAt) return null;
    const owner = repos.users.names([record.ownerId]).get(record.ownerId);
    const feedback = repos.feedback.list(record.id);
    const metrics = feedbackMetrics(record.execution, feedback);
    // 首页精选：只取明确给了好评的反馈，排除含被隐去个人信息的内容
    const highlights = feedback
      .filter(
        (f) =>
          f.rating !== null &&
          f.rating >= 4 &&
          [...f.content].length >= 6 &&
          !f.content.includes('已隐去］'),
      )
      .sort((a, b) => b.content.length - a.content.length)
      .slice(0, 3)
      .map((f) =>
        [...f.content].length > 80 ? `${[...f.content].slice(0, 80).join('')}…` : f.content,
      );
    return {
      id: record.id,
      title: plan.title,
      subtitle: plan.subtitle,
      status: record.status,
      owner: { name: owner?.name ?? '', department: owner?.department ?? '' },
      brief: {
        theme: record.brief.theme,
        audience: record.brief.audience,
        eventDate: record.brief.eventDate,
        eventTime: record.brief.eventTime,
        venue: record.brief.venue,
      },
      introduction: plan.introduction,
      sections: plan.sections.map((section) => ({
        ...section,
        books: plan.books
          .filter((b) => b.sectionId === section.id)
          .map((b) => ({ book: b.book, guide: b.guide, reason: b.reason })),
      })),
      activity: plan.activity,
      package: pkg,
      execution: record.execution,
      feedbackStats: {
        count: metrics.feedbackCount,
        averageRating: metrics.averageRating,
        highlights,
      },
      retrospective: record.retrospective
        ? {
            summary: record.retrospective.summary,
            worked: record.retrospective.worked,
            nextTime: record.retrospective.nextTime,
          }
        : null,
      publishedAt: record.publishedAt,
    };
  };

  /** 方案修改后：重新跑规则检查（保留模型核验项与用户的处理状态），并回到“待核对” */
  const savePlan = (
    record: ExhibitionRecord,
    plan: Plan,
    actor: UserInfo,
    message: string,
  ): ExhibitionRecord => {
    const aiItems = record.checks.filter(
      (c) => c.origin === 'ai' && (!c.bookId || plan.books.some((b) => b.book.id === c.bookId)),
    );
    const checks = [...mergeChecks(ruleChecks(plan, record.brief), record.checks), ...aiItems];
    const updated = repos.exhibitions.update(record.id, {
      plan,
      checks,
      title: plan.title || record.brief.theme,
      status: 'reviewing',
    });
    log(
      record,
      'plan',
      record.status === 'reviewing' ? message : `${message}；方案有改动，需重新确认并生成申请书`,
      actor,
    );
    return updated;
  };

  const validatePlan = (plan: Plan): void => {
    const sectionIds = new Set(plan.sections.map((s) => s.id));
    const ids = plan.books.map((b) => b.book.id);
    if (plan.books.length === 0) throw new AppError('invalid_params', '书单不能为空');
    if (new Set(ids).size !== ids.length)
      throw new AppError('invalid_params', '书单中有重复的书目');
    if (plan.books.some((b) => !sectionIds.has(b.sectionId)))
      throw new AppError('invalid_params', '有书目没有分配到展区');
  };

  /* ───────────── 处理函数 ───────────── */

  const handlers: Pick<
    RpcHandlers,
    | 'showcase.latest'
    | 'showcase.list'
    | 'showcase.get'
    | 'exhibitions.list'
    | 'exhibitions.create'
    | 'exhibitions.get'
    | 'exhibitions.updateBrief'
    | 'exhibitions.updatePlan'
    | 'exhibitions.updateProposal'
    | 'exhibitions.updatePackage'
    | 'exhibitions.updateExecution'
    | 'exhibitions.updateRetrospective'
    | 'exhibitions.submit'
    | 'exhibitions.delete'
    | 'exhibitions.unpublish'
    | 'checks.run'
    | 'checks.update'
    | 'feedback.add'
    | 'feedback.delete'
    | 'approvals.list'
    | 'approvals.decide'
  > = {
    'showcase.latest': () => {
      for (const record of repos.exhibitions.listPublished()) {
        const view = toShowcase(record);
        if (view) return view;
      }
      return null;
    },
    'showcase.list': () => repos.exhibitions.listPublished().map(toSummary),
    'showcase.get': ({ id }) => {
      const view = toShowcase(find(id));
      if (!view) throw new AppError('not_found', '这个书展尚未上线');
      return view;
    },

    'exhibitions.list': ({ scope }, { user }) => {
      if (scope === 'all' && !hasRole(user.role, 'approver'))
        throw new AppError('forbidden', '只有审批管理员可以查看全部书展');
      return repos.exhibitions.list(scope === 'all' ? {} : { ownerId: user.id }).map(toSummary);
    },
    'exhibitions.create': (brief, { user }) => {
      const record = repos.exhibitions.create(user.id, brief);
      log(record, 'created', `发起策展：${brief.theme}`, user);
      changed(record.id);
      return toDetail(record, user);
    },
    'exhibitions.get': ({ id }, { user }) => toDetail(viewable(user, id), user),
    'exhibitions.updateBrief': ({ id, brief }, { user }) => {
      const record = owned(user, id);
      requireState('brief', record, '修改需求');
      const updated = repos.exhibitions.update(id, {
        brief,
        title: record.plan?.title || brief.theme,
      });
      log(
        record,
        'brief',
        record.plan ? '修改了策展需求（重新策展后生效）' : '修改了策展需求',
        user,
      );
      changed(id);
      return toDetail(updated, user);
    },
    'exhibitions.updatePlan': ({ id, plan }, { user }) => {
      const record = owned(user, id);
      requireState('plan', record, '修改方案');
      validatePlan(plan);
      const updated = savePlan(record, plan, user, '编辑了策展方案');
      changed(id);
      return toDetail(updated, user);
    },
    'exhibitions.updateProposal': ({ id, proposal }, { user }) => {
      const record = owned(user, id);
      requireState('proposal', record, '修改申请书');
      // 申请人与书单以系统记录为准，防止被篡改
      const updated = repos.exhibitions.update(id, {
        proposal: {
          ...proposal,
          applicant: record.proposal!.applicant,
          booklist: record.proposal!.booklist,
        },
      });
      log(record, 'proposal', '编辑了策展申请书', user);
      changed(id);
      return toDetail(updated, user);
    },
    'exhibitions.updatePackage': ({ id, package: pkg }, { user }) => {
      const record = owned(user, id);
      requireState('package', record, '修改活动包');
      const updated = repos.exhibitions.update(id, {
        package: pkg,
        status: record.status === 'proposal_approved' ? 'package_draft' : record.status,
      });
      log(record, 'package', '编辑了海报与活动包', user);
      changed(id);
      return toDetail(updated, user);
    },
    'exhibitions.updateExecution': ({ id, execution }, { user }) => {
      const record = owned(user, id);
      requireState('feedback', record, '录入执行记录');
      const updated = repos.exhibitions.update(id, { execution });
      log(record, 'execution', `更新了活动执行记录（参与 ${execution.participants} 人）`, user);
      changed(id, { showcase: true });
      return toDetail(updated, user);
    },
    'exhibitions.updateRetrospective': ({ id, retrospective }, { user }) => {
      const record = owned(user, id);
      requireState('feedback', record, '修改复盘');
      const updated = repos.exhibitions.update(id, { retrospective, status: 'completed' });
      log(record, 'retrospective', '编辑了复盘总结', user);
      changed(id, { showcase: true });
      return toDetail(updated, user);
    },

    'exhibitions.submit': ({ id, kind }, { user }) => {
      const record = owned(user, id);
      let status: ExhibitionStatus;
      let snapshot: unknown;
      if (kind === 'proposal') {
        if (record.status !== 'proposal_draft' && record.status !== 'proposal_changes') {
          throw new AppError('invalid_state', '请先确认方案并生成策展申请书');
        }
        if (!record.proposal || !record.plan) throw new AppError('invalid_state', '缺少策展申请书');
        if (hasOpenBlockers(record.checks))
          throw new AppError('invalid_state', '还有必须处理的核对项，请先在“核对”中处理');
        status = 'proposal_pending';
        snapshot = { proposal: record.proposal, plan: record.plan, checks: record.checks };
      } else {
        if (record.status !== 'package_draft' && record.status !== 'package_changes') {
          throw new AppError('invalid_state', '请先生成海报与活动包');
        }
        if (!record.package) throw new AppError('invalid_state', '缺少活动包');
        status = 'package_pending';
        snapshot = { package: record.package, plan: record.plan, proposal: record.proposal };
      }
      const updated = repos.db.transaction(() => {
        repos.approvals.supersedePending(id, kind);
        repos.approvals.create({ exhibitionId: id, kind, submittedBy: user.id, snapshot });
        return repos.exhibitions.update(id, { status });
      });
      log(record, 'submit', `提交${approvalKindLabels[kind]}`, user);
      changed(id, { approvals: true });
      return toDetail(updated, user);
    },

    'exhibitions.delete': ({ id }, { user }) => {
      const record = find(id);
      const detail = toDetail(record, user);
      if (!detail.can.delete) throw new AppError('forbidden', '已上线的书展只能由超级管理员删除');
      if (running.has(id)) throw new AppError('busy', '智能体正在处理这个书展，请稍后再删除');
      repos.exhibitions.delete(id);
      changed(id, {
        showcase: record.status === 'published' || record.status === 'completed',
        approvals: true,
      });
    },
    'exhibitions.unpublish': ({ id, comment }, { user }) => {
      const record = find(id);
      if (record.status !== 'published' && record.status !== 'completed')
        throw new AppError('invalid_state', '这个书展没有上线');
      const updated = repos.exhibitions.update(id, {
        status: 'package_changes',
        publishedAt: null,
      });
      log(record, 'unpublish', `超级管理员将书展下线：${comment}`, user);
      changed(id, { showcase: true });
      return toDetail(updated, user);
    },

    'checks.run': ({ id }, { user }) => {
      const record = owned(user, id);
      requireState('plan', record, '重新检查');
      if (!record.plan) throw new AppError('invalid_state', '还没有策展方案');
      const aiItems = record.checks.filter((c) => c.origin === 'ai');
      const updated = repos.exhibitions.update(id, {
        checks: [...mergeChecks(ruleChecks(record.plan, record.brief), record.checks), ...aiItems],
      });
      changed(id);
      return toDetail(updated, user);
    },
    'checks.update': ({ id, itemId, status, note }, { user }) => {
      const record = owned(user, id);
      requireState('plan', record, '处理核对项');
      const item = record.checks.find((c) => c.id === itemId);
      if (!item) throw new AppError('not_found', '核对项不存在，可能已在重新检查后消失');
      if (item.severity === 'blocker' && status === 'dismissed' && !note.trim()) {
        throw new AppError(
          'invalid_params',
          '忽略必须处理的问题时，请写明理由',
          '例如：馆员已确认该书在架，链接稍后补充',
        );
      }
      const checks = record.checks.map((c) =>
        c.id === itemId ? { ...c, status, note: note.trim() } : c,
      );
      const updated = repos.exhibitions.update(id, { checks });
      changed(id);
      return toDetail(updated, user);
    },

    'feedback.add': ({ id, entries }, { user }) => {
      const record = find(id);
      if (record.ownerId !== user.id && !hasRole(user.role, 'approver'))
        throw new AppError('forbidden', '只有发起人或管理员可以录入反馈');
      requireState('feedback', record, '录入反馈');
      repos.feedback.add(
        id,
        entries.map((e) => ({ rating: e.rating, content: anonymize(e.content) })),
        user.id,
      );
      log(record, 'feedback', `录入 ${entries.length} 条读者反馈`, user);
      changed(id, { showcase: true });
      return toDetail(find(id), user);
    },
    'feedback.delete': ({ id, entryId }, { user }) => {
      const record = owned(user, id);
      repos.feedback.delete(id, entryId);
      changed(id, { showcase: true });
      return toDetail(record, user);
    },

    'approvals.list': ({ status }) => repos.approvals.list(status).map((row) => toApproval(row)),
    'approvals.decide': ({ approvalId, decision, comment }, { user }) => {
      const approval = repos.approvals.get(approvalId);
      if (!approval) throw new AppError('not_found', '审批记录不存在');
      if (approval.status !== 'pending')
        throw new AppError('invalid_state', '这条申请已经处理过了');
      if (approval.submittedBy === user.id)
        throw new AppError('forbidden', '不能审批自己提交的申请', '请由其他审批管理员处理');
      if (decision === 'changes' && !comment.trim())
        throw new AppError('invalid_params', '退回修改时请写明修改意见');
      const record = find(approval.exhibitionId);
      const expected: ExhibitionStatus =
        approval.kind === 'proposal' ? 'proposal_pending' : 'package_pending';
      if (record.status !== expected)
        throw new AppError('invalid_state', '书展状态已变化，请刷新后重试');

      const approved = decision === 'approve';
      const status: ExhibitionStatus =
        approval.kind === 'proposal'
          ? approved
            ? 'proposal_approved'
            : 'proposal_changes'
          : approved
            ? 'published'
            : 'package_changes';
      const decided = repos.db.transaction(() => {
        const row = repos.approvals.decide(approvalId, {
          status: approved ? 'approved' : 'changes_requested',
          reviewerId: user.id,
          comment: comment.trim(),
        });
        repos.exhibitions.update(record.id, {
          status,
          ...(status === 'published' ? { publishedAt: new Date().toISOString() } : {}),
        });
        return row;
      });
      const label = approvalKindLabels[approval.kind];
      log(
        record,
        'review',
        `${label}${approved ? '：同意' : '：退回修改'}${comment.trim() ? `。意见：${comment.trim()}` : ''}`,
        user,
      );
      if (status === 'published') log(record, 'publish', '书展已上线，首页已更新', user);
      changed(record.id, { approvals: true, showcase: status === 'published' });
      return toApproval(decided, record.title);
    },
  };

  return { handlers, find, owned, log, changed, toDetail, savePlan };
}
