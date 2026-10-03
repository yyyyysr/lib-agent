// 下载示例书库的封面到 apps/desktop/resources/covers/，打包时随应用附带（离线也能显示）。
// 封面图片版权归出版方所有，不放入代码仓库；打包前运行一次即可，已下载的不会重复下载。
//   pnpm sample:covers
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..', '..', '..');
const catalog = JSON.parse(
  readFileSync(join(root, 'packages', 'book-sources', 'src', 'sample', 'catalog.json'), 'utf8'),
);
const dir = join(root, 'apps', 'desktop', 'resources', 'covers');
mkdirSync(dir, { recursive: true });

const isImage = (b) =>
  (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) || (b[0] === 0x89 && b[1] === 0x50);

let downloaded = 0;
const failed = [];
for (const [id, book] of Object.entries(catalog.books)) {
  if (!book.coverUrl) continue;
  const file = join(dir, `${createHash('sha1').update(book.coverUrl).digest('hex')}.jpg`);
  if (existsSync(file)) continue;
  try {
    const response = await fetch(book.coverUrl, { signal: AbortSignal.timeout(20_000) });
    const data = new Uint8Array(await response.arrayBuffer());
    if (!response.ok || !isImage(data)) throw new Error(`HTTP ${response.status}`);
    writeFileSync(file, data);
    downloaded++;
  } catch (error) {
    failed.push(`${id}《${book.title}》：${error.message}`);
  }
}
console.log(`封面：新下载 ${downloaded} 张，保存在 ${dir}`);
if (failed.length) {
  console.warn(
    `以下封面下载失败（应用运行时会再尝试联网加载，失败则显示绘制的书封）：\n  ${failed.join('\n  ')}`,
  );
}
