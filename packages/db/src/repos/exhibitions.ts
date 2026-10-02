import { z } from 'zod';
import {
  briefSchema,
  checkItemSchema,
  executionSchema,
  newId,
  nowIso,
  packageSchema,
  planSchema,
  proposalSchema,
  retrospectiveSchema,
  type ActivityPackage,
  type ApprovalKind,
  type Brief,
  type CheckItem,
  type Execution,
  type ExhibitionStatus,
  type FeedbackEntry,
  type Plan,
  type Proposal,
  type Retrospective,
} from '@yys/shared';
import { fromJson, toJson, type AppDatabase, type Params } from '../database';

export interface ExhibitionRecord {
  id: string;
  ownerId: string;
  title: string;
  status: ExhibitionStatus;
  brief: Brief;
  plan: Plan | null;
  checks: CheckItem[];
  proposal: Proposal | null;
  package: ActivityPackage | null;
  execution: Execution;
  retrospective: Retrospective | null;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface ExhibitionRow {
  id: string;
  owner_id: string;
  title: string;
  status: ExhibitionStatus;
  brief: string;
  plan: string | null;
  checks: string;
  proposal: string | null;
  package: string | null;
  execution: string;
  retrospective: string | null;
  published_at: string | null;
  created_at: string;
  updated_at: string;
}

/** JSON 列损坏或结构过期时回退为空值，而不是让整条记录无法打开 */
function parseOr<S extends z.ZodType>(
  schema: S,
  raw: string | null,
  fallback: z.output<S>,
): z.output<S> {
  if (raw === null) return fallback;
  const parsed = schema.safeParse(fromJson(raw, undefined));
  return parsed.success ? parsed.data : fallback;
}

const toRecord = (row: ExhibitionRow): ExhibitionRecord => ({
  id: row.id,
  ownerId: row.owner_id,
  title: row.title,
  status: row.status,
  brief: parseOr(
    briefSchema,
    row.brief,
    briefSchema.parse({ theme: row.title, audience: '未填写' }),
  ),
  plan: parseOr(planSchema.nullable(), row.plan, null),
  checks: parseOr(z.array(checkItemSchema), row.checks, []),
  proposal: parseOr(proposalSchema.nullable(), row.proposal, null),
  package: parseOr(packageSchema.nullable(), row.package, null),
  execution: parseOr(executionSchema, row.execution, executionSchema.parse({})),
  retrospective: parseOr(retrospectiveSchema.nullable(), row.retrospective, null),
  publishedAt: row.published_at,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

type Patch = Partial<Omit<ExhibitionRecord, 'id' | 'ownerId' | 'createdAt' | 'updatedAt'>>;

const columns: Record<keyof Patch, { column: string; json: boolean }> = {
  title: { column: 'title', json: false },
  status: { column: 'status', json: false },
  brief: { column: 'brief', json: true },
  plan: { column: 'plan', json: true },
  checks: { column: 'checks', json: true },
  proposal: { column: 'proposal', json: true },
  package: { column: 'package', json: true },
  execution: { column: 'execution', json: true },
  retrospective: { column: 'retrospective', json: true },
  publishedAt: { column: 'published_at', json: false },
};

export class ExhibitionRepo {
  constructor(private readonly db: AppDatabase) {}

  create(ownerId: string, brief: Brief): ExhibitionRecord {
    const id = newId('exh');
    const at = nowIso();
    this.db.run(
      `INSERT INTO exhibitions(id, owner_id, title, status, brief, created_at, updated_at) VALUES (?, ?, ?, 'draft', ?, ?, ?)`,
      id,
      ownerId,
      brief.theme,
      toJson(brief),
      at,
      at,
    );
    return this.get(id)!;
  }

  get(id: string): ExhibitionRecord | undefined {
    const row = this.db.get<ExhibitionRow>('SELECT * FROM exhibitions WHERE id = ?', id);
    return row ? toRecord(row) : undefined;
  }

  list(filter: { ownerId?: string; statuses?: ExhibitionStatus[] } = {}): ExhibitionRecord[] {
    const where: string[] = [];
    const params: Params = [];
    if (filter.ownerId) {
      where.push('owner_id = ?');
      params.push(filter.ownerId);
    }
    if (filter.statuses?.length) {
      where.push(`status IN (${filter.statuses.map(() => '?').join(',')})`);
      params.push(...filter.statuses);
    }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    return this.db
      .all<ExhibitionRow>(`SELECT * FROM exhibitions ${clause} ORDER BY updated_at DESC`, ...params)
      .map(toRecord);
  }

  listPublished(): ExhibitionRecord[] {
    return this.db
      .all<ExhibitionRow>(
        "SELECT * FROM exhibitions WHERE status IN ('published', 'completed') AND published_at IS NOT NULL ORDER BY published_at DESC",
      )
      .map(toRecord);
  }

  countByStatus(): Partial<Record<ExhibitionStatus, number>> {
    const result: Partial<Record<ExhibitionStatus, number>> = {};
    for (const row of this.db.all<{ status: ExhibitionStatus; n: number }>(
      'SELECT status, COUNT(*) AS n FROM exhibitions GROUP BY status',
    )) {
      result[row.status] = Number(row.n);
    }
    return result;
  }

  update(id: string, patch: Patch): ExhibitionRecord {
    const sets: string[] = [];
    const params: Params = [];
    for (const [key, value] of Object.entries(patch) as [keyof Patch, unknown][]) {
      const meta = columns[key];
      if (!meta || value === undefined) continue;
      sets.push(`${meta.column} = ?`);
      params.push(meta.json ? (value === null ? null : toJson(value)) : (value as string | null));
    }
    sets.push('updated_at = ?');
    params.push(nowIso(), id);
    this.db.run(`UPDATE exhibitions SET ${sets.join(', ')} WHERE id = ?`, ...params);
    return this.get(id)!;
  }

  delete(id: string): void {
    this.db.run('DELETE FROM exhibitions WHERE id = ?', id);
  }
}

export interface ApprovalRow {
  id: string;
  exhibitionId: string;
  kind: ApprovalKind;
  status: 'pending' | 'approved' | 'changes_requested';
  submittedBy: string;
  submittedAt: string;
  snapshot: unknown;
  reviewerId: string | null;
  reviewedAt: string | null;
  comment: string;
}

interface RawApprovalRow {
  id: string;
  exhibition_id: string;
  kind: ApprovalKind;
  status: ApprovalRow['status'];
  submitted_by: string;
  submitted_at: string;
  snapshot: string;
  reviewer_id: string | null;
  reviewed_at: string | null;
  comment: string;
}

const toApproval = (row: RawApprovalRow): ApprovalRow => ({
  id: row.id,
  exhibitionId: row.exhibition_id,
  kind: row.kind,
  status: row.status,
  submittedBy: row.submitted_by,
  submittedAt: row.submitted_at,
  snapshot: fromJson(row.snapshot, null),
  reviewerId: row.reviewer_id,
  reviewedAt: row.reviewed_at,
  comment: row.comment,
});

export class ApprovalRepo {
  constructor(private readonly db: AppDatabase) {}

  create(input: {
    exhibitionId: string;
    kind: ApprovalKind;
    submittedBy: string;
    snapshot: unknown;
  }): ApprovalRow {
    const id = newId('appr');
    this.db.run(
      `INSERT INTO approvals(id, exhibition_id, kind, status, submitted_by, submitted_at, snapshot) VALUES (?, ?, ?, 'pending', ?, ?, ?)`,
      id,
      input.exhibitionId,
      input.kind,
      input.submittedBy,
      nowIso(),
      toJson(input.snapshot),
    );
    return this.get(id)!;
  }

  get(id: string): ApprovalRow | undefined {
    const row = this.db.get<RawApprovalRow>('SELECT * FROM approvals WHERE id = ?', id);
    return row ? toApproval(row) : undefined;
  }

  listByExhibition(exhibitionId: string): ApprovalRow[] {
    return this.db
      .all<RawApprovalRow>(
        'SELECT * FROM approvals WHERE exhibition_id = ? ORDER BY submitted_at DESC',
        exhibitionId,
      )
      .map(toApproval);
  }

  list(status: 'pending' | 'done'): ApprovalRow[] {
    const sql =
      status === 'pending'
        ? "SELECT * FROM approvals WHERE status = 'pending' ORDER BY submitted_at"
        : "SELECT * FROM approvals WHERE status != 'pending' ORDER BY reviewed_at DESC LIMIT 200";
    return this.db.all<RawApprovalRow>(sql).map(toApproval);
  }

  pendingCount(): number {
    return Number(
      this.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM approvals WHERE status = 'pending'")
        ?.n ?? 0,
    );
  }

  /** 撤销同一书展、同一类型中仍在等待的旧申请（重新提交时） */
  supersedePending(exhibitionId: string, kind: ApprovalKind): void {
    this.db.run(
      "DELETE FROM approvals WHERE exhibition_id = ? AND kind = ? AND status = 'pending'",
      exhibitionId,
      kind,
    );
  }

  decide(
    id: string,
    input: { status: 'approved' | 'changes_requested'; reviewerId: string; comment: string },
  ): ApprovalRow {
    this.db.run(
      'UPDATE approvals SET status = ?, reviewer_id = ?, reviewed_at = ?, comment = ? WHERE id = ?',
      input.status,
      input.reviewerId,
      nowIso(),
      input.comment,
      id,
    );
    return this.get(id)!;
  }
}

export class EventRepo {
  constructor(private readonly db: AppDatabase) {}

  add(exhibitionId: string, type: string, message: string, actorId?: string): void {
    this.db.run(
      'INSERT INTO exhibition_events(id, exhibition_id, type, message, actor_id, at) VALUES (?, ?, ?, ?, ?, ?)',
      newId('evt'),
      exhibitionId,
      type,
      message,
      actorId ?? null,
      nowIso(),
    );
  }

  list(
    exhibitionId: string,
  ): { id: string; type: string; message: string; actorId: string | null; at: string }[] {
    return this.db
      .all<{ id: string; type: string; message: string; actor_id: string | null; at: string }>(
        'SELECT * FROM exhibition_events WHERE exhibition_id = ? ORDER BY at, rowid',
        exhibitionId,
      )
      .map((row) => ({
        id: row.id,
        type: row.type,
        message: row.message,
        actorId: row.actor_id,
        at: row.at,
      }));
  }
}

export class FeedbackRepo {
  constructor(private readonly db: AppDatabase) {}

  add(
    exhibitionId: string,
    entries: { rating: number | null; content: string }[],
    createdBy: string,
  ): void {
    const stmt = this.db.raw.prepare(
      'INSERT INTO feedback_entries(id, exhibition_id, rating, content, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    );
    const at = nowIso();
    this.db.transaction(() => {
      for (const entry of entries)
        stmt.run(newId('fb'), exhibitionId, entry.rating, entry.content, createdBy, at);
    });
  }

  list(exhibitionId: string): FeedbackEntry[] {
    return this.db
      .all<{ id: string; rating: number | null; content: string; created_at: string }>(
        'SELECT id, rating, content, created_at FROM feedback_entries WHERE exhibition_id = ? ORDER BY created_at, rowid',
        exhibitionId,
      )
      .map((row) => ({
        id: row.id,
        rating: row.rating === null ? null : Number(row.rating),
        content: row.content,
        createdAt: row.created_at,
      }));
  }

  delete(exhibitionId: string, entryId: string): void {
    this.db.run(
      'DELETE FROM feedback_entries WHERE id = ? AND exhibition_id = ?',
      entryId,
      exhibitionId,
    );
  }
}
