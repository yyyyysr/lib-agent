import { modelInfoSchema, type ProviderConfig } from '@yys/shared';
import { z } from 'zod';
import { fromJson, toJson, type AppDatabase } from '../database';

interface ProviderRow {
  id: string;
  preset_id: string;
  display_name: string;
  base_url: string | null;
  secret_ref: string;
  has_key: number;
  models: string;
  enabled: number;
  owner_id: string | null;
  created_at: string;
  updated_at: string;
}

const modelsSchema = z.array(modelInfoSchema).catch([]);

const toConfig = (row: ProviderRow): ProviderConfig => ({
  id: row.id,
  presetId: row.preset_id,
  displayName: row.display_name,
  baseURL: row.base_url ?? undefined,
  secretRef: row.secret_ref,
  hasKey: row.has_key === 1,
  models: modelsSchema.parse(fromJson(row.models, [])),
  enabled: row.enabled === 1,
  ownerId: row.owner_id,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export class ProviderRepo {
  constructor(private readonly db: AppDatabase) {}

  /** 用户自己的服务商 + 超级管理员共享的服务商 */
  listFor(userId: string): ProviderConfig[] {
    return this.db
      .all<ProviderRow>(
        'SELECT * FROM providers WHERE owner_id = ? OR owner_id IS NULL ORDER BY owner_id IS NULL, created_at',
        userId,
      )
      .map(toConfig);
  }

  get(id: string): ProviderConfig | undefined {
    const row = this.db.get<ProviderRow>('SELECT * FROM providers WHERE id = ?', id);
    return row ? toConfig(row) : undefined;
  }

  upsert(config: ProviderConfig): ProviderConfig {
    this.db.run(
      `INSERT INTO providers(id, preset_id, display_name, base_url, secret_ref, has_key, models, enabled, owner_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         preset_id = excluded.preset_id, display_name = excluded.display_name, base_url = excluded.base_url,
         secret_ref = excluded.secret_ref, has_key = excluded.has_key, models = excluded.models,
         enabled = excluded.enabled, owner_id = excluded.owner_id, updated_at = excluded.updated_at`,
      config.id,
      config.presetId,
      config.displayName,
      config.baseURL ?? null,
      config.secretRef,
      config.hasKey ? 1 : 0,
      toJson(config.models),
      config.enabled ? 1 : 0,
      config.ownerId,
      config.createdAt,
      config.updatedAt,
    );
    return this.get(config.id)!;
  }

  delete(id: string): void {
    this.db.run('DELETE FROM providers WHERE id = ?', id);
  }
}
