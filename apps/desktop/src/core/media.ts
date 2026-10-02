import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { AppError } from '@yys/shared';

const extensions: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};
const MAX_BYTES = 15 * 1024 * 1024;

/** AI 生成的图片保存在数据目录 media/ 下，由主进程经 yys-media:// 协议提供给界面 */
export class MediaStore {
  private readonly dir: string;

  constructor(dataDir: string) {
    this.dir = join(dataDir, 'media');
    mkdirSync(this.dir, { recursive: true });
  }

  save(data: Uint8Array, mediaType: string): string {
    const ext = extensions[mediaType.toLowerCase()];
    if (!ext) throw new AppError('internal', `不支持的图片格式：${mediaType}`);
    if (data.byteLength === 0 || data.byteLength > MAX_BYTES)
      throw new AppError('internal', '生成的图片为空或过大');
    const id = `img_${randomBytes(8).toString('hex')}`;
    writeFileSync(join(this.dir, `${id}.${ext}`), data);
    return id;
  }
}
