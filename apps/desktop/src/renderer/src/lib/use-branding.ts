import { DEFAULT_SCHOOL, organizerOf, type SchoolBranding } from '@yys/shared';
import { useRpc } from './use-rpc';

const fallback: SchoolBranding = {
  schoolName: DEFAULT_SCHOOL.name,
  organizer: organizerOf(DEFAULT_SCHOOL.name),
};

/** 学校与主办单位名称；加载完成前先显示默认的中山大学，避免闪烁 */
export function useBranding(): SchoolBranding {
  const { data } = useRpc('school.branding', undefined, { topics: ['school.changed'] });
  return data ?? fallback;
}
