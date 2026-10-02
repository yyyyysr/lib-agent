import { create } from 'zustand';
import type { AgentProgress, AgentTask, ExhibitionStatus } from '@yys/shared';
import { core, errorText } from '../lib/core-client';
import { toast } from './app-store';

export interface StageState {
  stage: string;
  label: string;
  status: 'running' | 'done' | 'failed' | 'skipped';
  detail?: string;
  startedAt: number;
  endedAt?: number;
}

export interface AgentRun {
  task: AgentTask;
  status: 'running' | 'done' | 'failed' | 'cancelled';
  stages: StageState[];
  logs: string[];
  error?: { message: string; hint?: string };
  /** 运行成功后书展进入的状态，用于自动切换到对应步骤 */
  finalStatus?: ExhibitionStatus;
  startedAt: number;
  controller: AbortController;
}

interface RunState {
  runs: Record<string, AgentRun>;
  start: (exhibitionId: string, task: AgentTask) => Promise<boolean>;
  cancel: (exhibitionId: string) => void;
}

const taskLabels: Record<AgentTask, string> = {
  curate: '策展',
  proposal: '生成申请书',
  package: '生成海报与活动包',
  retrospective: '生成复盘',
};

/** 智能体运行进度放在全局：切换步骤或页面后回来，进度仍然可见 */
export const useAgentRuns = create<RunState>((set, get) => ({
  runs: {},
  start: async (exhibitionId, task) => {
    if (get().runs[exhibitionId]?.status === 'running') return false;
    const controller = new AbortController();
    const update = (patch: (run: AgentRun) => Partial<AgentRun>): void =>
      set((state) => {
        const run = state.runs[exhibitionId];
        return run ? { runs: { ...state.runs, [exhibitionId]: { ...run, ...patch(run) } } } : state;
      });
    set((state) => ({
      runs: {
        ...state.runs,
        [exhibitionId]: {
          task,
          status: 'running',
          stages: [],
          logs: [],
          startedAt: Date.now(),
          controller,
        },
      },
    }));

    const onEvent = (event: AgentProgress): void => {
      if (event.type === 'log') update((run) => ({ logs: [...run.logs, event.message] }));
      if (event.type === 'done') update(() => ({ finalStatus: event.status }));
      if (event.type === 'stage') {
        update((run) => {
          const existing = run.stages.find((s) => s.stage === event.stage);
          const ended = event.status === 'running' ? undefined : Date.now();
          const stages = existing
            ? run.stages.map((s) =>
                s.stage === event.stage
                  ? { ...s, status: event.status, detail: event.detail, endedAt: ended }
                  : s,
              )
            : [
                ...run.stages,
                {
                  stage: event.stage,
                  label: event.label,
                  status: event.status,
                  detail: event.detail,
                  startedAt: Date.now(),
                  endedAt: ended,
                },
              ];
          return { stages };
        });
      }
    };

    try {
      const reader = core
        .stream('agent.run', { id: exhibitionId, task }, controller.signal)
        .getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        onEvent(value);
      }
      if (controller.signal.aborted) {
        update(() => ({ status: 'cancelled' }));
        return false;
      }
      update(() => ({ status: 'done' }));
      toast({ tone: 'success', title: `${taskLabels[task]}完成` });
      return true;
    } catch (error) {
      const err = errorText(error);
      update((run) => ({
        status: 'failed',
        error: err,
        stages: run.stages.map((s) =>
          s.status === 'running' ? { ...s, status: 'failed', endedAt: Date.now() } : s,
        ),
      }));
      toast({
        tone: 'error',
        title: `${taskLabels[task]}未完成`,
        description: err.hint ? `${err.message}。${err.hint}` : err.message,
      });
      return false;
    }
  },
  cancel: (exhibitionId) => get().runs[exhibitionId]?.controller.abort(),
}));
