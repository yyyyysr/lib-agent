import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { parseImport, splitAuthors, suggestMapping } from './index';

const at = '2026-10-02T00:00:00.000Z';
const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text);

describe('suggestMapping', () => {
  it('识别常见中文表头', () => {
    const { mapping, unmappedHeaders } = suggestMapping(['题名', '责任者', '出版社', '出版年', 'ISBN', '索书号', '馆藏地', '内容简介', '链接', '备注']);
    expect(mapping).toMatchObject({
      title: '题名',
      authors: '责任者',
      publisher: '出版社',
      pubYear: '出版年',
      isbn: 'ISBN',
      callNumber: '索书号',
      location: '馆藏地',
      summary: '内容简介',
      sourceUrl: '链接',
    });
    expect(unmappedHeaders).toEqual(['备注']);
  });

  it('包含匹配不会把"作者简介"当成作者', () => {
    const { mapping } = suggestMapping(['图书题名（正题名）', '作者简介', '第一作者']);
    expect(mapping.title).toBe('图书题名（正题名）');
    expect(mapping.authors).toBe('第一作者');
    expect(mapping.summary).toBe('作者简介');
  });

  it('识别英文表头', () => {
    const { mapping } = suggestMapping(['Title', 'Author', 'Call Number', 'URL']);
    expect(mapping).toMatchObject({ title: 'Title', authors: 'Author', callNumber: 'Call Number', sourceUrl: 'URL' });
  });
});

describe('splitAuthors', () => {
  it('拆分多作者并去掉著/编等责任方式', () => {
    expect(splitAuthors('尼尔·布朗，斯图尔特·基利 著')).toEqual(['尼尔·布朗', '斯图尔特·基利']);
    expect(splitAuthors('费孝通著')).toEqual(['费孝通']);
    expect(splitAuthors('丹尼尔·卡尼曼 等')).toEqual(['丹尼尔·卡尼曼']);
  });
});

describe('parseImport', () => {
  it('CSV：解析、规范化、同批去重并报告问题', async () => {
    const csv = [
      '书名,作者,ISBN,索书号,链接',
      '《学会提问》,尼尔·布朗；斯图尔特·基利,978-7-111-11111-1,B804/7,www.example.edu/b/1',
      '学会提问,尼尔·布朗,978-7-111-11111-1,B804/7,https://example.edu/b/1',
      ',无名氏,,,',
      '统计数字会撒谎,达莱尔·哈夫,123,C8/19,not a url',
    ].join('\n');
    const result = await parseImport({ bytes: utf8(csv), fileName: 'books.csv' }, at);
    expect(result.format).toBe('csv');
    expect(result.totalRows).toBe(4);
    expect(result.drafts).toHaveLength(2);
    expect(result.duplicates).toBe(1);
    expect(result.skipped).toBe(1);
    const [first] = result.drafts;
    expect(first).toMatchObject({
      title: '学会提问',
      authors: ['尼尔·布朗', '斯图尔特·基利'],
      isbn: '9787111111111',
      sourceUrl: 'https://www.example.edu/b/1',
      isSample: false,
    });
    expect(first?.provenance.title).toEqual({ origin: 'import', at, verified: false });
    expect(result.issues.map((issue) => issue.message).join('\n')).toMatch(/ISBN 位数不正确[\s\S]*链接格式无法识别/);
  });

  it('CSV：GB18030 编码自动识别', async () => {
    // "书名,作者\n乡土中国,费孝通" 的 GBK 编码
    const gbk = Uint8Array.from([
      0xca, 0xe9, 0xc3, 0xfb, 0x2c, 0xd7, 0xf7, 0xd5, 0xdf, 0x0a, 0xcf, 0xe7, 0xcd, 0xc1, 0xd6, 0xd0, 0xb9, 0xfa, 0x2c,
      0xb7, 0xd1, 0xd0, 0xa2, 0xcd, 0xa8,
    ]);
    const result = await parseImport({ bytes: gbk, fileName: 'export.csv' }, at);
    expect(result.encoding).toBe('gb18030');
    expect(result.drafts[0]).toMatchObject({ title: '乡土中国', authors: ['费孝通'] });
  });

  it('TXT：每行一本书的自由格式', async () => {
    const txt = ['1. 《乡土中国》费孝通', '2、思考，快与慢 / 丹尼尔·卡尼曼 / 中信出版社', '- 刻意练习 - 安德斯·艾利克森'].join('\n');
    const result = await parseImport({ text: txt, format: 'txt' }, at);
    expect(result.drafts.map((d) => [d.title, d.authors[0]])).toEqual([
      ['乡土中国', '费孝通'],
      ['思考，快与慢', '丹尼尔·卡尼曼'],
      ['刻意练习', '安德斯·艾利克森'],
    ]);
    expect(result.drafts[1]?.publisher).toBe('中信出版社');
  });

  it('TXT：制表符分隔的表格', async () => {
    const txt = '题名\t责任者\t索书号\n心流\t米哈里·契克森米哈赖\tB84/62';
    const result = await parseImport({ text: txt, format: 'txt' }, at);
    expect(result.drafts[0]).toMatchObject({ title: '心流', callNumber: 'B84/62' });
  });

  it('JSON：嵌套在 data.items 中的数组，数组字段自动拼接', async () => {
    const json = JSON.stringify({
      code: 0,
      data: { items: [{ title: '原则', author: ['瑞·达利欧'], keywords: ['管理', '决策'], url: 'https://x.edu/1' }] },
    });
    const result = await parseImport({ bytes: utf8(json), fileName: 'cms.json' }, at);
    expect(result.drafts[0]).toMatchObject({ title: '原则', authors: ['瑞·达利欧'], subjects: ['管理', '决策'] });
  });

  it('JSON Lines', async () => {
    const jsonl = '{"书名":"心流","作者":"米哈里·契克森米哈赖"}\n{"书名":"原则","作者":"瑞·达利欧"}';
    const result = await parseImport({ bytes: utf8(jsonl), fileName: 'books.jsonl' }, at);
    expect(result.drafts).toHaveLength(2);
  });

  it('XLSX：读取首个工作表，超链接单元格保留 URL', async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('馆藏');
    sheet.addRow(['正题名', '著者', '馆藏链接']);
    sheet.addRow(['终身成长', '卡罗尔·德韦克', { text: '查看', hyperlink: 'https://lib.example.edu/r/9' }]);
    const buffer = new Uint8Array(await workbook.xlsx.writeBuffer());
    const result = await parseImport({ bytes: buffer, fileName: '馆藏.xlsx' }, at);
    expect(result.drafts[0]).toMatchObject({
      title: '终身成长',
      authors: ['卡罗尔·德韦克'],
      sourceUrl: 'https://lib.example.edu/r/9',
    });
  });

  it('XLSX：书名单元格带超链接且没有链接列时，作为来源链接', async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('导出');
    sheet.addRow(['书名', '作者']);
    sheet.addRow([{ text: '乡土中国', hyperlink: 'https://cms.example.edu/b/23' }, '费孝通']);
    const buffer = new Uint8Array(await workbook.xlsx.writeBuffer());
    const result = await parseImport({ bytes: buffer, fileName: 'cms.xlsx' }, at);
    expect(result.drafts[0]).toMatchObject({ title: '乡土中国', sourceUrl: 'https://cms.example.edu/b/23' });
    expect(result.mapping.sourceUrl).toBe('__cellLink');
  });

  it('旧版 .xls 给出明确提示', async () => {
    const xls = Uint8Array.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
    await expect(parseImport({ bytes: xls, fileName: 'old.xlsx' }, at)).rejects.toMatchObject({ code: 'unsupported_format' });
  });

  it('没有书名列时报错并列出识别到的表头', async () => {
    await expect(parseImport({ bytes: utf8('编号,备注\n1,无'), fileName: 'x.csv' }, at)).rejects.toMatchObject({
      code: 'import_failed',
      hint: expect.stringContaining('编号'),
    });
  });

  it('不支持的扩展名', async () => {
    await expect(parseImport({ bytes: utf8(''), fileName: 'x.pdf' }, at)).rejects.toMatchObject({ code: 'unsupported_format' });
  });
});
