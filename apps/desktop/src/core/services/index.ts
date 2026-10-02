import type { RpcHandlers, StreamHandlers } from '../rpc-server';
import { createAccountServices } from './accounts';
import { createAgentServices } from './agent';
import { createBookServices } from './books';
import type { CoreDeps } from './context';
import { createExhibitionServices } from './exhibitions';
import { createModelServices } from './models';

export type { CoreDeps } from './context';

export function createServices(deps: CoreDeps): { handlers: RpcHandlers; streams: StreamHandlers } {
  /** 正在由智能体处理的书展；处理期间拒绝其他修改 */
  const running = new Set<string>();
  const accounts = createAccountServices(deps);
  const models = createModelServices(deps);
  const books = createBookServices(deps);
  const exhibitions = createExhibitionServices(deps, running);
  const agent = createAgentServices(deps, running, exhibitions, models.resolveModel, books.library);

  return {
    handlers: {
      ...accounts.handlers,
      ...models.handlers,
      ...books.handlers,
      ...exhibitions.handlers,
      ...agent.handlers,
    },
    streams: agent.streams,
  };
}
