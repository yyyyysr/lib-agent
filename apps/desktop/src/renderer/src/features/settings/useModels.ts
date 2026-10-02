import { useMemo } from 'react';
import type { ModelCapabilities, ModelRef, ModelRoles } from '@yys/shared';
import { core, errorText } from '../../lib/core-client';
import { useRpc } from '../../lib/use-rpc';
import { toast } from '../../store/app-store';

export interface ModelOption extends ModelRef {
  providerName: string;
  label: string;
  hasKey: boolean;
  shared: boolean;
  capabilities?: ModelCapabilities;
}

export const sameRef = (a: ModelRef | null | undefined, b: ModelRef | null | undefined): boolean =>
  Boolean(a && b && a.providerId === b.providerId && a.modelId === b.modelId);

export function useModels() {
  const providers = useRpc('providers.list', undefined, { topics: ['providers.changed'] });
  const roles = useRpc('settings.getModelRoles', undefined, { topics: ['providers.changed'] });

  const options = useMemo<ModelOption[]>(
    () =>
      (providers.data ?? [])
        .filter((p) => p.enabled)
        .flatMap((p) =>
          p.models.map((m) => ({
            providerId: p.id,
            modelId: m.id,
            providerName: p.displayName,
            label: m.label ?? m.id,
            hasKey: p.hasKey,
            shared: p.ownerId === null,
            capabilities: m.capabilities,
          })),
        ),
    [providers.data],
  );

  const setRoles = async (patch: Partial<ModelRoles>): Promise<void> => {
    const current = roles.data ?? { primary: null, fast: null };
    try {
      await core.call('settings.setModelRoles', { ...current, ...patch });
    } catch (error) {
      toast({ tone: 'error', title: '切换模型失败', description: errorText(error).message });
    }
  };

  return {
    options,
    roles: roles.data,
    providers: providers.data ?? [],
    loading: providers.loading,
    setRoles,
  };
}
