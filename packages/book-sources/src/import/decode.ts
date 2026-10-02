/**
 * 中文 Windows 下 Excel 另存的 CSV/TXT 常为 GBK/GB18030 编码。
 * 先按 UTF-8 严格解码，失败再回退到 GB18030（GBK 的超集）。
 */
export function decodeText(bytes: Uint8Array): { text: string; encoding: 'utf-8' | 'utf-16le' | 'gb18030' } {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    return { text: new TextDecoder('utf-16le').decode(bytes.subarray(2)), encoding: 'utf-16le' };
  }
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return { text: text.replace(/^\ufeff/, ''), encoding: 'utf-8' };
  } catch {
    return { text: new TextDecoder('gb18030').decode(bytes), encoding: 'gb18030' };
  }
}
