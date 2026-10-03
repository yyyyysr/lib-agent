import { describe, expect, it } from 'vitest';
import { sniffImageType } from './image-type';

const bytes = (...values: number[]): Uint8Array => new Uint8Array(values);

describe('sniffImageType', () => {
  it('按文件头识别常见图片格式', () => {
    expect(sniffImageType(bytes(0xff, 0xd8, 0xff, 0xe0, 0, 0x10))).toBe('image/jpeg');
    expect(sniffImageType(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0))).toBe(
      'image/png',
    );
    expect(sniffImageType(new TextEncoder().encode('GIF89a'))).toBe('image/gif');
    expect(sniffImageType(new TextEncoder().encode('RIFF\0\0\0\0WEBPVP8 '))).toBe('image/webp');
  });

  it('网页、空内容等不是图片', () => {
    expect(sniffImageType(new TextEncoder().encode('<html><body>404</body></html>'))).toBeNull();
    expect(sniffImageType(bytes())).toBeNull();
    expect(sniffImageType(new TextEncoder().encode('RIFF\0\0\0\0WAVE'))).toBeNull();
  });
});
