import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { migrations } from './migrations';

export type Row = Record<string, unknown>;
export type Params = SQLInputValue[];

export class AppDatabase {
  readonly raw: DatabaseSync;

  constructor(file: string) {
    this.raw = new DatabaseSync(file);
    this.raw.exec('PRAGMA journal_mode = WAL');
    this.raw.exec('PRAGMA foreign_keys = ON');
    this.raw.exec('PRAGMA busy_timeout = 3000');
    this.migrate();
  }

  get schemaVersion(): number {
    return Number((this.raw.prepare('PRAGMA user_version').get() as Row).user_version);
  }

  get sqliteVersion(): string {
    return String((this.raw.prepare('SELECT sqlite_version() AS v').get() as Row).v);
  }

  all<T = Row>(sql: string, ...params: Params): T[] {
    return this.raw.prepare(sql).all(...params) as T[];
  }

  get<T = Row>(sql: string, ...params: Params): T | undefined {
    return this.raw.prepare(sql).get(...params) as T | undefined;
  }

  run(sql: string, ...params: Params): { changes: number } {
    const result = this.raw.prepare(sql).run(...params);
    return { changes: Number(result.changes) };
  }

  private depth = 0;

  /** 可重入：最外层用 BEGIN/COMMIT，嵌套调用用 SAVEPOINT */
  transaction<T>(fn: () => T): T {
    const savepoint = `sp_${this.depth}`;
    this.raw.exec(this.depth === 0 ? 'BEGIN IMMEDIATE' : `SAVEPOINT ${savepoint}`);
    this.depth++;
    try {
      const result = fn();
      this.depth--;
      this.raw.exec(this.depth === 0 ? 'COMMIT' : `RELEASE ${savepoint}`);
      return result;
    } catch (error) {
      this.depth--;
      this.raw.exec(this.depth === 0 ? 'ROLLBACK' : `ROLLBACK TO ${savepoint}; RELEASE ${savepoint}`);
      throw error;
    }
  }

  close(): void {
    if (this.raw.isOpen) this.raw.close();
  }

  private migrate(): void {
    const current = this.schemaVersion;
    for (const [index, sql] of migrations.entries()) {
      const version = index + 1;
      if (version <= current) continue;
      this.transaction(() => {
        this.raw.exec(sql);
        this.raw.exec(`PRAGMA user_version = ${version}`);
      });
    }
  }
}

export const toJson = (value: unknown): string => JSON.stringify(value ?? null);

export function fromJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== 'string') return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}
