import { useState } from 'react';
import { coverUrlFor } from '@yys/shared/ipc';
import { cn } from '../lib/cn';

export interface CoverBook {
  id: string;
  title: string;
  authors: string[];
  coverUrl?: string;
}

type Size = 'xs' | 'sm' | 'md' | 'lg';

const dimensions: Record<Size, string> = {
  xs: 'w-9 h-[52px]',
  sm: 'w-14 h-20',
  md: 'w-28 h-40',
  lg: 'w-40 h-[228px]',
};

/** 精装书配色：深色封面布 + 浅色烫印 */
const palettes = [
  { cloth: '#2f4a44', ink: '#e9dcc3', band: '#c9a86a' },
  { cloth: '#7a2e2e', ink: '#f2e6d0', band: '#d9b46a' },
  { cloth: '#1f3b5b', ink: '#e8edf3', band: '#9fb7d3' },
  { cloth: '#4a3b6b', ink: '#efe9f6', band: '#c3b0e3' },
  { cloth: '#6b4f1f', ink: '#f6ecd8', band: '#e2c48b' },
  { cloth: '#2d5a3d', ink: '#e7f1ea', band: '#a9d2b4' },
  { cloth: '#8a4b2f', ink: '#fbeee3', band: '#f0c49a' },
  { cloth: '#33424f', ink: '#f0f2f4', band: '#b8c4cf' },
];

const hash = (text: string): number =>
  [...text].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7);

/**
 * 书封：有封面图时经本地缓存加载真实封面，否则（或加载失败时）绘制一本精装书。
 * 两种情况都叠加书脊、书页与光泽，呈现实体书的质感。
 */
export function BookCover({
  book,
  size = 'md',
  className,
}: {
  book: CoverBook;
  size?: Size;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const palette = palettes[hash(book.title) % palettes.length]!;
  const showImage = Boolean(book.coverUrl) && !failed;
  const compact = size === 'xs' || size === 'sm';

  return (
    <div
      className={cn(
        'book-cover relative shrink-0 overflow-hidden rounded-[2px_4px_4px_2px]',
        dimensions[size],
        className,
      )}
      style={{ backgroundColor: palette.cloth }}
    >
      {showImage ? (
        <img
          src={coverUrlFor(book.coverUrl!)}
          alt={`《${book.title}》封面`}
          loading="lazy"
          draggable={false}
          onError={() => setFailed(true)}
          className="absolute inset-0 size-full object-cover"
        />
      ) : (
        <div
          role="img"
          aria-label={`《${book.title}》`}
          className="absolute inset-0 flex flex-col"
          style={{ color: palette.ink }}
        >
          <div
            className={cn('mx-[14%] border-b', compact ? 'mt-[18%]' : 'mt-[16%]')}
            style={{ borderColor: palette.band }}
          />
          <p
            className={cn(
              'mx-[14%] font-semibold leading-snug',
              size === 'xs'
                ? 'mt-1 line-clamp-3 text-[7px]'
                : size === 'sm'
                  ? 'mt-1.5 line-clamp-3 text-[9px]'
                  : size === 'md'
                    ? 'mt-3 line-clamp-4 text-[13px]'
                    : 'mt-4 line-clamp-4 text-[17px]',
            )}
          >
            {book.title}
          </p>
          {!compact && (
            <p
              className={cn(
                'mx-[14%] mt-2 line-clamp-2 opacity-80',
                size === 'md' ? 'text-[9px]' : 'text-[11px]',
              )}
            >
              {book.authors.join('、')}
            </p>
          )}
          <div className="mt-auto mb-[12%] mx-[14%] flex items-center gap-1">
            <span className="h-px flex-1" style={{ backgroundColor: palette.band }} />
            {!compact && <span className="text-[8px] tracking-[0.2em] opacity-70">一页书展</span>}
            <span className="h-px flex-1" style={{ backgroundColor: palette.band }} />
          </div>
        </div>
      )}
      {/* 书脊、书页边与光泽 */}
      <span aria-hidden className="book-cover__spine" />
      <span aria-hidden className="book-cover__gloss" />
    </div>
  );
}
