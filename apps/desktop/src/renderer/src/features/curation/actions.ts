import { useCallback } from 'react';
import type {
  AgentTask,
  ExhibitionDetail,
  Plan,
  RpcMethod,
  RpcParams,
  RpcResult,
} from '@yys/shared';
import { core, errorText } from '../../lib/core-client';
import { toast } from '../../store/app-store';
import { useAgentRuns } from '../../store/agent-runs';

/** 调用 Core 并统一提示错误；成功消息可选 */
export async function act<M extends RpcMethod>(
  method: M,
  params: RpcParams<M>,
  success?: string,
): Promise<RpcResult<M> | null> {
  try {
    const call = core.call.bind(core) as (m: RpcMethod, p?: unknown) => Promise<RpcResult<M>>;
    const result = await call(method, params);
    if (success) toast({ tone: 'success', title: success });
    return result;
  } catch (error) {
    const { message, hint } = errorText(error);
    toast({ tone: 'error', title: message, description: hint });
    return null;
  }
}

export interface StepProps {
  detail: ExhibitionDetail;
  /** 当前用户是发起人，且智能体没有在处理 */
  editable: boolean;
  goTo: (step: import('@yys/shared').WorkflowStepKey) => void;
  run: (task: AgentTask) => void;
}

export function useRunner(id: string, onStart: (task: AgentTask) => void) {
  const start = useAgentRuns((s) => s.start);
  return useCallback(
    (task: AgentTask) => {
      onStart(task);
      void start(id, task);
    },
    [id, onStart, start],
  );
}

/** 保存整份方案；后台会重新检查并回到“待核对” */
export const savePlan = (
  detail: ExhibitionDetail,
  mutate: (plan: Plan) => void,
): Promise<unknown> => {
  const plan = structuredClone(detail.plan!);
  mutate(plan);
  return act('exhibitions.updatePlan', { id: detail.id, plan });
};
