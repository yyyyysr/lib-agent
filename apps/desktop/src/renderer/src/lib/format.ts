export function formatDateTime(iso: string | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function formatDate(value: string | undefined): string {
  if (!value) return '';
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return value;
  return `${Number(match[1])} 年 ${Number(match[2])} 月 ${Number(match[3])} 日`;
}

/** 活动预告：距离活动日期的天数描述 */
export function countdown(
  eventDate: string,
): { label: string; tone: 'upcoming' | 'today' | 'past' } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(eventDate);
  if (!match) return null;
  const event = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = Math.round((event.getTime() - today.getTime()) / 86_400_000);
  if (days > 0) return { label: `距离活动还有 ${days} 天`, tone: 'upcoming' };
  if (days === 0) return { label: '活动就在今天', tone: 'today' };
  return { label: '活动已举办', tone: 'past' };
}

export const durationText = (ms: number): string =>
  ms < 1000 ? '<1s' : `${Math.round(ms / 1000)}s`;
