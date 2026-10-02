import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { safeStorage } from 'electron';
import log from 'electron-log/main';

/**
 * API Key 保险箱：safeStorage 加密（macOS 钥匙串 / Windows DPAPI），密文落盘。
 * 明文只在 Core 发起模型请求时按需下发，Renderer 永远读不回明文。
 */
export class SecretVault {
  private readonly file: string;
  private cache: Record<string, string> = {};

  constructor(dir: string) {
    this.file = join(dir, 'secrets.json');
    if (existsSync(this.file)) {
      try {
        this.cache = JSON.parse(readFileSync(this.file, 'utf8')) as Record<string, string>;
      } catch (error) {
        log.error('[secrets] 读取失败，已忽略损坏的文件', error);
        this.cache = {};
      }
    }
  }

  set(ref: string, value: string): void {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('系统加密服务不可用，无法安全保存 API Key');
    }
    this.cache[ref] = safeStorage.encryptString(value).toString('base64');
    this.flush();
  }

  get(ref: string): string | null {
    const encrypted = this.cache[ref];
    if (!encrypted) return null;
    try {
      return safeStorage.decryptString(Buffer.from(encrypted, 'base64'));
    } catch (error) {
      log.error(`[secrets] 解密失败：${ref}`, error);
      return null;
    }
  }

  has(ref: string): boolean {
    return Boolean(this.cache[ref]);
  }

  remove(ref: string): void {
    if (!(ref in this.cache)) return;
    delete this.cache[ref];
    this.flush();
  }

  private flush(): void {
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.cache, null, 2), { encoding: 'utf8', mode: 0o600 });
    renameSync(tmp, this.file);
  }
}
