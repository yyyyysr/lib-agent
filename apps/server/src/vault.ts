import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { chmodSync, existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SecretStore } from '@yys/core';

interface Sealed {
  iv: string;
  tag: string;
  data: string;
}

/**
 * 服务器上的密钥库：服务商 API Key 以 AES-256-GCM 加密后落盘。
 * 主密钥来自环境变量 YYS_MASTER_KEY（base64，32 字节），或首次启动时生成的 master.key（权限 600）。
 * 数据库与 secrets.json 被单独拷走也无法解出明文。
 */
export class FileVault implements SecretStore {
  private readonly file: string;
  private readonly key: Buffer;
  private cache: Record<string, Sealed> = {};

  constructor(dataDir: string, masterKey?: string) {
    this.file = join(dataDir, 'secrets.json');
    this.key = masterKey
      ? Buffer.from(masterKey, 'base64')
      : loadOrCreateKey(join(dataDir, 'master.key'));
    if (this.key.length !== 32) throw new Error('主密钥必须是 32 字节（base64 编码）');
    if (existsSync(this.file))
      this.cache = JSON.parse(readFileSync(this.file, 'utf8')) as Record<string, Sealed>;
  }

  async get(ref: string): Promise<string | null> {
    const sealed = this.cache[ref];
    if (!sealed) return null;
    try {
      const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(sealed.iv, 'base64'));
      decipher.setAAD(Buffer.from(ref));
      decipher.setAuthTag(Buffer.from(sealed.tag, 'base64'));
      return Buffer.concat([
        decipher.update(Buffer.from(sealed.data, 'base64')),
        decipher.final(),
      ]).toString('utf8');
    } catch {
      return null;
    }
  }

  async set(ref: string, value: string): Promise<void> {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    // 引用名作为附加认证数据：密文不能被挪到另一个服务商名下使用
    cipher.setAAD(Buffer.from(ref));
    const data = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    this.cache[ref] = {
      iv: iv.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
      data: data.toString('base64'),
    };
    this.flush();
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

function loadOrCreateKey(path: string): Buffer {
  if (existsSync(path)) return Buffer.from(readFileSync(path, 'utf8').trim(), 'base64');
  const key = randomBytes(32);
  writeFileSync(path, `${key.toString('base64')}\n`, { mode: 0o600 });
  chmodSync(path, 0o600);
  return key;
}
