import type { Repositories } from '@yys/db';
import type { createImageGenerator, createLanguageModel, FetchFunction } from '@yys/llm-gateway';
import type { AppInfo, CoreEventTopic, CoreEvents } from '@yys/shared';
import type { AuthService } from '../auth';
import type { MediaStore } from '../media';

export interface CoreDeps {
  repos: Repositories;
  auth: AuthService;
  media: MediaStore;
  /** 测试时替换为返回固定图片的生成器 */
  createImageGenerator?: typeof createImageGenerator;
  secrets: { get(ref: string): Promise<string | null>; remove(ref: string): void };
  fetch?: FetchFunction;
  /** 测试时替换为 mock 模型 */
  createModel?: typeof createLanguageModel;
  emit: <T extends CoreEventTopic>(topic: T, payload: CoreEvents[T]) => void;
  info: Omit<AppInfo, 'sqliteVersion'>;
}
