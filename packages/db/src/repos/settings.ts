import type { z } from 'zod';
import { nowIso } from '@yys/shared';
import { fromJson, toJson, type AppDatabase } from '../database';

export class SettingsRepo {
  constructor(private readonly db: AppDatabase) {}

  /** 读取并校验；存储内容损坏或不符合 schema 时返回 fallback，避免坏数据拖垮启动 */
  get<S extends z.ZodType>(key: string, schema: S, fallback: z.output<S>): z.output<S> {
    const row = this.db.get<{ value: string }>('SELECT value FROM settings WHERE key = ?', key);
    if (!row) return fallback;
    const parsed = schema.safeParse(fromJson(row.value, undefined));
    return parsed.success ? parsed.data : fallback;
  }

  set(key: string, value: unknown): void {
    this.db.run(
      `INSERT INTO settings(key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      key,
      toJson(value),
      nowIso(),
    );
  }

  delete(key: string): void {
    this.db.run('DELETE FROM settings WHERE key = ?', key);
  }
}
