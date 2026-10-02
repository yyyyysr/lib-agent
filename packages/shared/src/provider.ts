import { z } from 'zod';

/** 决定使用哪个 AI SDK provider 包创建模型 */
export const providerKindSchema = z.enum([
  'openai',
  'anthropic',
  'google',
  'deepseek',
  'openai-compatible',
]);
export type ProviderKind = z.infer<typeof providerKindSchema>;

export interface ProviderPreset {
  id: string;
  name: string;
  kind: ProviderKind;
  defaultBaseURL?: string;
  /** 本地模型服务无需 Key */
  requiresKey: boolean;
  keyUrl?: string;
  /** 是否允许用户修改 baseURL */
  editableBaseURL: boolean;
  group: 'international' | 'domestic' | 'aggregator' | 'local' | 'custom';
}

export const modelCapabilitiesSchema = z.object({
  structuredOutput: z.enum(['native', 'json_mode', 'none', 'unknown']),
  toolCalling: z.enum(['yes', 'no', 'unknown']),
});
export type ModelCapabilities = z.infer<typeof modelCapabilitiesSchema>;

export const modelInfoSchema = z.object({
  id: z.string().min(1),
  label: z.string().optional(),
  capabilities: modelCapabilitiesSchema.optional(),
  testedAt: z.string().optional(),
});
export type ModelInfo = z.infer<typeof modelInfoSchema>;

export const proxyConfigSchema = z.object({
  mode: z.enum(['system', 'manual', 'none']),
  url: z.string().optional(),
});

export const providerConfigSchema = z.object({
  id: z.string(),
  presetId: z.string(),
  displayName: z.string().min(1),
  baseURL: z.string().optional(),
  /** 指向主进程加密存储中的密钥；配置本身从不包含明文 Key */
  secretRef: z.string(),
  hasKey: z.boolean(),
  models: z.array(modelInfoSchema),
  enabled: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ProviderConfig = z.infer<typeof providerConfigSchema>;

export const providerInputSchema = providerConfigSchema
  .pick({ presetId: true, baseURL: true, models: true, enabled: true })
  .extend({
    id: z.string().optional(),
    /** 留空时使用服务商预设名称 */
    displayName: z.string().max(60).default(''),
  });
export type ProviderInput = z.infer<typeof providerInputSchema>;

export const modelRefSchema = z.object({ providerId: z.string(), modelId: z.string() });
export type ModelRef = z.infer<typeof modelRefSchema>;

export const modelRolesSchema = z.object({
  /** 筛选、编排、撰写、对话 */
  primary: modelRefSchema.nullable(),
  /** 标题、摘要、轻量改写；为空时回退到 primary */
  fast: modelRefSchema.nullable(),
});
export type ModelRoles = z.infer<typeof modelRolesSchema>;

export type ConnectionTestResult =
  | {
      ok: true;
      latencyMs: number;
      capabilities: ModelCapabilities;
      sample: string;
    }
  | {
      ok: false;
      error: { code: string; message: string; hint?: string };
    };
