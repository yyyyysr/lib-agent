import { nowIso, type ConversationDetail, type ConversationSummary } from '@yys/shared';
import { fromJson, toJson, type AppDatabase } from '../database';

interface ConversationRow {
  id: string;
  title: string;
  messages: string;
  created_at: string;
  updated_at: string;
}

const toSummary = (row: Omit<ConversationRow, 'messages'>): ConversationSummary => ({
  id: row.id,
  title: row.title,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export class ConversationRepo {
  constructor(private readonly db: AppDatabase) {}

  list(): ConversationSummary[] {
    return this.db
      .all<ConversationRow>('SELECT id, title, created_at, updated_at FROM conversations ORDER BY updated_at DESC')
      .map(toSummary);
  }

  get(id: string): ConversationDetail | undefined {
    const row = this.db.get<ConversationRow>('SELECT * FROM conversations WHERE id = ?', id);
    return row ? { ...toSummary(row), messages: fromJson<unknown[]>(row.messages, []) } : undefined;
  }

  private summary(id: string): ConversationSummary | undefined {
    const row = this.db.get<ConversationRow>('SELECT id, title, created_at, updated_at FROM conversations WHERE id = ?', id);
    return row ? toSummary(row) : undefined;
  }

  /** 首次保存时用 title 建档；之后只更新消息，保留用户改过的标题 */
  save(id: string, messages: unknown[], titleIfNew: string): ConversationSummary {
    const at = nowIso();
    this.db.run(
      `INSERT INTO conversations(id, title, messages, created_at, updated_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET messages = excluded.messages, updated_at = excluded.updated_at`,
      id,
      titleIfNew,
      toJson(messages),
      at,
      at,
    );
    return this.summary(id)!;
  }

  rename(id: string, title: string): ConversationSummary | undefined {
    this.db.run('UPDATE conversations SET title = ?, updated_at = ? WHERE id = ?', title, nowIso(), id);
    return this.summary(id);
  }

  delete(id: string): void {
    this.db.run('DELETE FROM conversations WHERE id = ?', id);
  }
}
