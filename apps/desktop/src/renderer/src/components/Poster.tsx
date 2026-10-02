import { forwardRef } from 'react';
import { BookOpen, CalendarDays, MapPin } from 'lucide-react';
import type { ActivityPackage, Brief, PosterTemplate } from '@yys/shared';
import { cn } from '../lib/cn';
import { formatDate } from '../lib/format';

export const posterTemplates: { key: PosterTemplate; label: string }[] = [
  { key: 'classic', label: '书香' },
  { key: 'modern', label: '撞色' },
  { key: 'minimal', label: '简约' },
];

interface PosterProps {
  poster: ActivityPackage['poster'];
  brief: Pick<Brief, 'eventDate' | 'eventTime' | 'venue' | 'audience'>;
  bookTitles: string[];
  organizer?: string;
  /** 缩放比例；导出时使用 1 */
  scale?: number;
}

/**
 * 海报：文案来自智能体，时间、地点、书名等事实信息直接取自书展数据，不经模型改写。
 * 固定 420×560（3:4），三种模板只改版式与配色。
 */
export const Poster = forwardRef<HTMLDivElement, PosterProps>(function Poster(
  { poster, brief, bookTitles, organizer = '中山大学图书馆', scale = 1 },
  ref,
) {
  const when =
    [formatDate(brief.eventDate), brief.eventTime].filter(Boolean).join(' ') || '时间待定';
  const where = brief.venue || '地点待定';
  const titles = bookTitles.slice(0, 6);

  const inner = (() => {
    switch (poster.template) {
      case 'modern':
        return (
          <div className="flex h-full flex-col bg-[#f4efe6] text-[#1b1b1b]">
            <div className="relative h-[230px] bg-[#c8553d] px-8 pt-9 text-white">
              <p className="text-[12px] tracking-[0.3em] opacity-80">{organizer} · 一页书展</p>
              <p className="mt-3 text-[40px] leading-[1.1] font-bold">{poster.headline}</p>
              <p className="mt-2 text-[16px] font-medium opacity-90">{poster.subheadline}</p>
              <div className="absolute right-8 -bottom-6 rounded-full bg-[#1b1b1b] px-4 py-2 text-[13px] font-semibold text-white">
                {poster.callToAction}
              </div>
            </div>
            <div className="flex-1 px-8 pt-10">
              <p className="text-[14px] leading-relaxed">{poster.tagline}</p>
              <ul className="mt-4 space-y-1.5 text-[13px]">
                {poster.highlights.map((h) => (
                  <li key={h} className="flex items-center gap-2">
                    <span className="size-1.5 rounded-full bg-[#c8553d]" />
                    {h}
                  </li>
                ))}
              </ul>
              <p className="mt-5 text-[11px] leading-relaxed text-[#6b6257]">
                {titles.map((t) => `《${t}》`).join(' ')}
              </p>
            </div>
            <div className="space-y-1 border-t border-[#d9cfbf] px-8 py-4 text-[12px]">
              <p className="flex items-center gap-1.5">
                <CalendarDays className="size-3.5" />
                {when}
              </p>
              <p className="flex items-center gap-1.5">
                <MapPin className="size-3.5" />
                {where}
              </p>
            </div>
          </div>
        );
      case 'minimal':
        return (
          <div className="flex h-full flex-col bg-white px-10 py-10 text-[#111]">
            <p className="text-[11px] tracking-[0.35em] text-[#888]">ONE PAGE BOOK FAIR</p>
            <div className="mt-auto">
              <p className="text-[44px] leading-[1.05] font-semibold tracking-tight">
                {poster.headline}
              </p>
              <p className="mt-3 text-[16px] text-[#444]">{poster.subheadline}</p>
              <div className="my-6 h-px bg-[#111]" />
              <p className="text-[13px] leading-relaxed text-[#444]">{poster.tagline}</p>
              <p className="mt-4 text-[12px] text-[#666]">{poster.highlights.join(' / ')}</p>
            </div>
            <div className="mt-8 flex items-end justify-between text-[12px]">
              <div className="space-y-0.5">
                <p>{when}</p>
                <p>{where}</p>
                <p className="text-[#888]">{organizer}</p>
              </div>
              <p className="font-semibold">{poster.callToAction} →</p>
            </div>
          </div>
        );
      default:
        return (
          <div className="flex h-full flex-col bg-[#1f3d2f] px-9 py-9 text-[#f3ecd8]">
            <div className="flex items-center gap-2 text-[12px] tracking-[0.25em] text-[#c9b98f]">
              <BookOpen className="size-4" /> 一页书展
            </div>
            <p className="mt-8 text-[42px] leading-[1.1] font-bold">{poster.headline}</p>
            <p className="mt-3 text-[17px] text-[#e0d5b5]">{poster.subheadline}</p>
            <p className="mt-6 border-l-2 border-[#c9b98f] pl-3 text-[14px] leading-relaxed">
              {poster.tagline}
            </p>
            <div className="mt-6 flex flex-wrap gap-2">
              {poster.highlights.map((h) => (
                <span
                  key={h}
                  className="rounded-full border border-[#c9b98f]/60 px-3 py-1 text-[12px]"
                >
                  {h}
                </span>
              ))}
            </div>
            <div className="mt-auto space-y-1.5 rounded-xl bg-[#f3ecd8]/10 p-4 text-[13px]">
              <p className="flex items-center gap-2">
                <CalendarDays className="size-4 text-[#c9b98f]" />
                {when}
              </p>
              <p className="flex items-center gap-2">
                <MapPin className="size-4 text-[#c9b98f]" />
                {where}
              </p>
              <p className="pt-1 text-[11px] text-[#c9b98f]">
                面向 {brief.audience} · {organizer}
              </p>
            </div>
            <p className="mt-4 text-center text-[14px] font-semibold tracking-widest">
              {poster.callToAction}
            </p>
          </div>
        );
    }
  })();

  return (
    <div
      role="img"
      aria-label={`海报：${poster.headline}，${poster.subheadline}，${when}，${where}`}
      style={{ width: 420 * scale, height: 560 * scale }}
      className="shrink-0 overflow-hidden rounded-xl shadow-lg"
    >
      <div
        ref={ref}
        style={{
          width: 420,
          height: 560,
          transform: `scale(${scale})`,
          transformOrigin: 'top left',
        }}
        className={cn('font-sans')}
      >
        {inner}
      </div>
    </div>
  );
});
