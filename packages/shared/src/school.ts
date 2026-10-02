import { z } from 'zod';
import { bookFieldKeys } from './book';

/**
 * 学校配置。首版只用 portalUrl / searchUrlTemplate 在系统浏览器中打开学校页面；
 * auth 与 api 为学校授权后接入馆藏数据库预留。
 */
export const schoolProfileSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  /** 数字图书馆 / 内容管理系统入口 */
  portalUrl: z.string().url().optional(),
  /** 检索页模板，{query} 会被替换为 URL 编码后的关键词 */
  searchUrlTemplate: z.string().optional(),
  auth: z
    .object({
      type: z.enum(['oidc', 'oauth2', 'cas', 'token']),
      issuer: z.string().optional(),
      authorizeUrl: z.string().optional(),
      tokenUrl: z.string().optional(),
      clientId: z.string().optional(),
      scopes: z.array(z.string()).optional(),
      redirect: z.enum(['loopback', 'custom_scheme']).default('loopback'),
    })
    .optional(),
  /** 学校自建内容管理系统的 HTTP JSON 检索接口 */
  api: z
    .object({
      baseUrl: z.string().url(),
      searchPath: z.string().default('/search'),
      queryParam: z.string().default('q'),
      pageSizeParam: z.string().optional(),
      /** 结果数组在响应 JSON 中的路径，如 data.items */
      itemsPath: z.string().default('items'),
      totalPath: z.string().optional(),
      /** 学校字段名 → 本系统字段 */
      fieldMap: z.partialRecord(z.enum(bookFieldKeys), z.string()).default({}),
    })
    .optional(),
});
export type SchoolProfile = z.infer<typeof schoolProfileSchema>;

export type CampusConnectionStatus =
  | { state: 'not_configured' }
  | { state: 'portal_only' }
  | { state: 'signed_out' }
  | { state: 'connected'; account?: string; expiresAt?: string };
