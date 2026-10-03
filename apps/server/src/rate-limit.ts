/** 按来源 IP 的滑动窗口计数：限制登录 / 注册尝试与同时在线的连接数 */
export class RateLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  /** 记录一次尝试；超过限制时返回 false */
  hit(key: string, now = Date.now()): boolean {
    const recent = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (recent.length >= this.limit) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(now);
    this.hits.set(key, recent);
    return true;
  }

  /** 定期清理过期记录，避免长期运行时内存增长 */
  sweep(now = Date.now()): void {
    for (const [key, times] of this.hits) {
      const recent = times.filter((t) => now - t < this.windowMs);
      if (recent.length) this.hits.set(key, recent);
      else this.hits.delete(key);
    }
  }
}
