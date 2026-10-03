/** 按文件头识别图片：部分图书馆服务器把封面标成 text/html */
export function sniffImageType(data: Uint8Array): string | null {
  const at = (offset: number, bytes: number[]): boolean =>
    bytes.every((byte, i) => data[offset + i] === byte);
  if (at(0, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (at(0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (at(0, [0x47, 0x49, 0x46, 0x38])) return 'image/gif';
  if (at(0, [0x52, 0x49, 0x46, 0x46]) && at(8, [0x57, 0x45, 0x42, 0x50])) return 'image/webp';
  return null;
}
