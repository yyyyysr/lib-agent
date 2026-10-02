import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { cn } from '../lib/cn';

const reducedMotion = (): boolean => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** 进入视口时渐显上浮一次；delay 用于同一组元素依次出现 */
export function Reveal({
  children,
  delay = 0,
  className,
  as: Tag = 'div',
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
  as?: 'div' | 'section' | 'li';
}) {
  const ref = useRef<HTMLElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (reducedMotion()) return setVisible(true);
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: '0px 0px -8% 0px', threshold: 0.08 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return (
    <Tag
      ref={ref as never}
      className={cn('reveal', visible && 'is-visible', className)}
      style={{ transitionDelay: `${delay}ms` }}
    >
      {children}
    </Tag>
  );
}

/** 鼠标悬停时随指针轻微倾斜，并有一道跟随指针的光泽 */
export function Tilt({
  children,
  max = 8,
  className,
}: {
  children: ReactNode;
  max?: number;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(false);
  const [style, setStyle] = useState<CSSProperties>({});
  const move = (event: React.MouseEvent): void => {
    if (reducedMotion() || !ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width;
    const y = (event.clientY - rect.top) / rect.height;
    setStyle({
      '--ry': `${(x - 0.5) * max * 2}deg`,
      '--rx': `${(0.5 - y) * max * 2}deg`,
      '--gx': `${x * 100}%`,
      '--gy': `${y * 100}%`,
    } as CSSProperties);
  };
  return (
    <div
      ref={ref}
      onMouseEnter={() => setActive(true)}
      onMouseMove={move}
      onMouseLeave={() => {
        setActive(false);
        setStyle({});
      }}
      className={cn('tilt relative rounded-xl', active && 'is-active', className)}
      style={style}
    >
      {children}
      <span aria-hidden className="tilt__glare" />
    </div>
  );
}

/** 数字进入视口时从 0 滚动到目标值 */
export function CountUp({
  value,
  decimals = 0,
  duration = 900,
}: {
  value: number;
  decimals?: number;
  duration?: number;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const [shown, setShown] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (reducedMotion()) return setShown(value);
    let frame = 0;
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry?.isIntersecting) return;
      observer.disconnect();
      const start = performance.now();
      const tick = (now: number): void => {
        const t = Math.min(1, (now - start) / duration);
        setShown(value * (1 - (1 - t) ** 3));
        if (t < 1) frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);
    });
    observer.observe(el);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [value, duration]);
  return <span ref={ref}>{shown.toFixed(decimals)}</span>;
}

/** 跟随鼠标的柔和光晕背景 */
export function Spotlight({ children, className }: { children: ReactNode; className?: string }) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  return (
    <div
      className={cn('relative', className)}
      onMouseMove={(e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        setPos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
      }}
      onMouseLeave={() => setPos(null)}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 transition-opacity duration-500"
        style={{
          opacity: pos ? 1 : 0,
          background: pos
            ? `radial-gradient(520px circle at ${pos.x}px ${pos.y}px, var(--accent-soft), transparent 70%)`
            : undefined,
        }}
      />
      <div className="relative">{children}</div>
    </div>
  );
}
