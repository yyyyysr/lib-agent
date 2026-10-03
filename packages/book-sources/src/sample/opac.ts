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

/** 在页面所有表格中找“索书号/索取号”列（馆藏列表），或“索书号 | 值”两列的行（书目全记录） */
export function parseCallNumbers(html: string): string[] {
  const found: string[] = [];
  for (const table of html.match(/<table[\s\S]*?<\/table>/gi) ?? []) {
    const rows = (table.match(/<tr[\s\S]*?<\/tr>/gi) ?? []).map((row) =>
      (row.match(/<t[hd][\s\S]*?<\/t[hd]>/gi) ?? []).map(cellText),
    );
    rows.forEach((cells, index) => {
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

/** 国图中文图书索书号形如“入藏年\中图分类号\种次号”；有多个馆藏时优先这种格式 */
export const pickCallNumber = (values: string[]): string | undefined =>
  values.find((value) => /^\d{4}\\[A-Z]/.test(value)) ?? values[0];
