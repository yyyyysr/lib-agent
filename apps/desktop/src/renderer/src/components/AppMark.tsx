import { cn } from '../lib/cn';

/** “一页书展”标识：一页翻开的书，与强调色一致；随深浅色主题变化 */
export function AppMark({ size = 'md', className }: { size?: 'sm' | 'md'; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-md bg-accent text-accent-fg',
        size === 'sm' ? 'size-5' : 'size-6',
        className,
      )}
    >
      <svg
        viewBox="0 0 24 24"
        className={size === 'sm' ? 'size-3.5' : 'size-4'}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {/* 左右两页与书脊 */}
        <path d="M12 6.5C10.2 5.2 7.6 4.6 4.5 4.8v12.6c3.1-.2 5.7.4 7.5 1.7" />
        <path d="M12 6.5c1.8-1.3 4.4-1.9 7.5-1.7v12.6c-3.1-.2-5.7.4-7.5 1.7" />
        <path d="M12 6.5v12.6" />
        {/* 右页上的一行字：“一页” */}
        <path d="M14.5 10h2.6" />
      </svg>
    </span>
  );
}
