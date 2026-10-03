/** 解析国家图书馆 OPAC（Aleph）页面中的索书号；供 scripts/fetch-nlc-callnumbers.mjs 使用 */

const cellText = (html: string): string =>
  html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();

const LABEL = /^(索书号|索取号|Call\s*No\.?|Call\s*Number)$/i;
/** 国图馆藏行：“馆藏 | 2012\B80\42\中文基藏\闭架库房”，前三段为索书号（入藏年\分类号\种次号），其后为馆藏地 */
const HOLDING = /^(\d{4}\\[A-Z][^\\\s]*\\[^\\\s]+)(?:\\(.*))?$/;

/** 在页面所有表格中找“索书号/索取号”列（馆藏列表），或“索书号 | 值”两列的行（书目全记录） */
export function parseCallNumbers(html: string): string[] {
  const found: string[] = [];
  for (const table of html.match(/<table[\s\S]*?<\/table>/gi) ?? []) {
    const rows = (table.match(/<tr[\s\S]*?<\/tr>/gi) ?? []).map((row) =>
      (row.match(/<t[hd][\s\S]*?<\/t[hd]>/gi) ?? []).map(cellText),
    );
    rows.forEach((cells, index) => {
      if (cells.length === 2 && cells[0] === '馆藏') {
        const match = HOLDING.exec(cells[1] ?? '');
        if (match) found.push(match[1]! + (match[2] ? ` ${match[2]}` : ''));
        return;
      }
      const column = cells.findIndex((cell) => LABEL.test(cell));
      if (column < 0) return;
      if (cells.length === 2 && column === 0) {
        found.push(cells[1] ?? '');
        return;
      }
      for (const row of rows.slice(index + 1)) {
        const value = row[column];
        if (value) found.push(value);
      }
    });
  }
  return [...new Set(found.map((value) => value.trim()).filter((value) => /[A-Z]/.test(value)))];
}

/**
 * 国图中文图书索书号形如“入藏年\中图分类号\种次号”。有多个馆藏时优先中文基藏、种次号为数字的那一条
 * （借阅区等的种次号可能是字母代码），返回值只含索书号本身。
 */
export function pickCallNumber(values: string[]): string | undefined {
  const callNumber = (value: string): string => value.split(' ')[0]!;
  const numbered = values.filter((value) => /^\d{4}\\[A-Z][^\\]*\\\d+/.test(value));
  const preferred =
    numbered.find((value) => value.includes('中文基藏')) ??
    numbered[0] ??
    values.find((value) => /^\d{4}\\[A-Z]/.test(value)) ??
    values[0];
  return preferred && callNumber(preferred);
}
