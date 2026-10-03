// 从国家图书馆 OPAC 获取示例书库的真实索书号，写回 src/sample/catalog.json。
// 需要在能访问 opac.nlc.cn 的网络下运行（部分网络会被国图服务器直接断开连接）。
//
//   pnpm sample:callnumbers                 获取所有缺索书号的记录
//   pnpm sample:callnumbers --force         全部重新获取
//   pnpm sample:callnumbers --set sample-0007='2012\F069.9-49\12'   手动填写（从 OPAC 页面抄录）
//
// 写入后自动提升示例书库版本号，应用下次启动时重新灌入示例书库。
import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseCallNumbers, pickCallNumber } from '../src/sample/opac.ts';

const file = join(import.meta.dirname, '..', 'src', 'sample', 'catalog.json');
const catalog = JSON.parse(readFileSync(file, 'utf8'));
const args = process.argv.slice(2);
const force = args.includes('--force');
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// 馆藏页列出每个复本的“馆藏 | 入藏年\分类号\种次号\馆藏地”
const opacUrls = (record) => [
  `http://opac.nlc.cn/F?func=item-global&doc_library=NLC01&doc_number=${record}`,
];
// 国图服务器对频繁请求会暂时拒绝连接
const PACE_MS = 6000;

/** 国图限流时连接会超时或被重置：等待后重试 */
async function fetchWithRetry(url, attempts = 5) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fetchText(url);
    } catch (error) {
      if (attempt >= attempts) throw error;
      console.warn(`  请求失败（${error.message}），${attempt * 2} 分钟后重试…`);
      await sleep(attempt * 120_000);
    }
  }
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: { 'user-agent': UA, 'accept-language': 'zh-CN,zh;q=0.9' },
    redirect: 'follow',
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const charset = /charset=([\w-]+)/i.exec(response.headers.get('content-type') ?? '')?.[1];
  const head = new TextDecoder('latin1').decode(bytes.slice(0, 2048));
  const declared = charset ?? /<meta[^>]+charset=["']?([\w-]+)/i.exec(head)?.[1] ?? 'utf-8';
  return new TextDecoder(declared.toLowerCase() === 'gb2312' ? 'gbk' : declared).decode(bytes);
}

let changed = 0;
for (const arg of args.filter((a) => a.startsWith('sample-') || a.includes('='))) {
  const [id, value] = arg.split('=');
  if (!catalog.books[id] || !value) continue;
  catalog.books[id].callNumber = value.trim();
  changed++;
  console.log(`${id} 手动填写：${value.trim()}`);
}

if (!args.includes('--set')) {
  const failed = [];
  for (const [id, book] of Object.entries(catalog.books)) {
    if (!book.nlcRecord || (book.callNumber && !force)) continue;
    let value;
    for (const url of opacUrls(book.nlcRecord)) {
      try {
        const html = await fetchWithRetry(url);
        const values = parseCallNumbers(html);
        if (values.length) {
          value = pickCallNumber(values);
          break;
        }
        const debug = join(tmpdir(), `nlc-opac-${book.nlcRecord}.html`);
        writeFileSync(debug, html);
        console.warn(`${id} 页面中没有找到索书号，已保存页面：${debug}`);
      } catch (error) {
        console.warn(`${id} 无法访问 ${url}：${error.message}`);
      }
      await sleep(PACE_MS);
    }
    if (value) {
      book.callNumber = value;
      changed++;
      console.log(`${id}《${book.title}》 ${value}`);
    } else {
      failed.push(`${id}《${book.title}》 ${opacUrls(book.nlcRecord)[0]}`);
    }
  }
  if (failed.length) {
    console.log(`\n以下 ${failed.length} 本未能获取，可在浏览器中打开链接后用 --set 手动填写：`);
    for (const line of failed) console.log(`  ${line}`);
  }
}

if (changed > 0) {
  catalog.version += 1;
  writeFileSync(file, `${JSON.stringify(catalog, null, 2)}\n`);
  console.log(`\n已写入 ${changed} 条索书号，示例书库版本更新为 ${catalog.version}`);
} else {
  console.log('\n没有需要写入的索书号');
}
