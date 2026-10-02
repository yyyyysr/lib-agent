import type { CoreToMain } from '@yys/shared';

const TIMEOUT_MS = 5_000;

/** 向主进程按需索取明文密钥；主进程不响应时视为没有密钥，而不是让调用方一直等待 */
export class SecretsClient {
  private seq = 0;
  private readonly pending = new Map<number, (value: string | null) => void>();

  constructor(private readonly post: (message: CoreToMain) => void) {}

  get(ref: string): Promise<string | null> {
    const id = ++this.seq;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        resolve(null);
      }, TIMEOUT_MS);
      this.pending.set(id, (value) => {
        clearTimeout(timer);
        resolve(value);
      });
      this.post({ type: 'secret:get', id, ref });
    });
  }

  remove(ref: string): void {
    this.post({ type: 'secret:remove', ref });
  }

  resolve(id: number, value: string | null): void {
    const done = this.pending.get(id);
    this.pending.delete(id);
    done?.(value);
  }
}
