import type { BookFieldKey } from '@yys/shared';

/** 常见表头写法：学校自建系统、OPAC 导出、手工表格 */
const synonyms: Record<BookFieldKey, string[]> = {
  title: [
    '书名',
    '题名',
    '正题名',
    '题目',
    '图书名称',
    '书目名称',
    '名称',
    'title',
    'booktitle',
    'name',
  ],
  authors: [
    '作者',
    '著者',
    '责任者',
    '责任者/作者',
    '作者/责任者',
    '编著者',
    'author',
    'authors',
    'creator',
  ],
  publisher: ['出版社', '出版者', '出版单位', '出版发行', 'publisher', 'press'],
  pubYear: [
    '出版年',
    '出版年份',
    '出版时间',
    '出版日期',
    '年份',
    'year',
    'pubyear',
    'pubdate',
    'publishyear',
    'date',
  ],
  isbn: ['isbn', 'isbn号', '国际标准书号', '标准书号', 'issn/isbn'],
  callNumber: ['索书号', '索取号', '索书号/分类号', 'callnumber', 'callno', 'call'],
  location: ['馆藏地', '馆藏地点', '馆藏位置', '馆藏', '所在馆', '位置', 'location', 'library'],
  availability: ['在架状态', '借阅状态', '馆藏状态', '状态', '可借', 'status', 'availability'],
  subjects: [
    '主题词',
    '主题',
    '关键词',
    '关键字',
    '标签',
    'subject',
    'subjects',
    'keywords',
    'tags',
    'category',
  ],
  summary: [
    '摘要',
    '内容简介',
    '简介',
    '内容提要',
    '提要',
    '图书简介',
    '描述',
    'summary',
    'abstract',
    'description',
    'intro',
  ],
  sourceUrl: [
    '来源链接',
    '馆藏链接',
    '链接',
    '网址',
    '详情页',
    '详情链接',
    'url',
    'link',
    'href',
    'permalink',
  ],
  coverUrl: ['封面', '封面链接', '封面图', 'cover', 'coverurl', 'image'],
  docType: ['文献类型', '资料类型', 'doctype'],
  responsibility: ['所有责任者', '责任说明', '责任者说明', 'statementofresponsibility'],
  otherTitles: [
    '其他题名',
    '所有题名',
    '并列题名',
    '并列正题名',
    '原题名',
    '原书名',
    'originaltitle',
  ],
  pubPlace: ['出版发行地', '出版、发行地', '出版地', 'pubplace'],
  keywords: ['主题标引', '标引词', '关键词（国图）'],
  language: ['语种', '语言', 'language', 'lang'],
  clcNumber: ['中图分类号', '中图分类', '分类号', '分类', 'clc', 'clcnumber'],
  extent: ['载体形态', '页数', '页码', '形态描述', 'extent', 'pages'],
  catalogSource: ['书目来源', '来源数据库', '编目机构', 'catalogsource'],
  catalogUrl: ['书目记录', '书目链接', 'opac链接', 'opac', 'catalogurl'],
};

const normalize = (value: string): string =>
  value
    .toLowerCase()
    .replace(/^\ufeff/, '')
    .replace(/[\s_\-()（）【】\[\]:：*·.]/g, '');

const summaryLike = /简介|介绍|提要|摘要/;

export interface MappingResult {
  mapping: Partial<Record<BookFieldKey, string>>;
  unmappedHeaders: string[];
}

/** 按"完全相同 → 包含关系"两轮把表头映射到书目字段；每个表头、每个字段最多使用一次 */
export function suggestMapping(headers: string[]): MappingResult {
  const mapping: Partial<Record<BookFieldKey, string>> = {};
  const used = new Set<string>();
  const fields = Object.keys(synonyms) as BookFieldKey[];
  const normalized = headers.map((header) => ({ header, key: normalize(header) }));

  for (const field of fields) {
    const targets = synonyms[field].map(normalize);
    const hit = normalized.find(({ header, key }) => !used.has(header) && targets.includes(key));
    if (hit) {
      mapping[field] = hit.header;
      used.add(hit.header);
    }
  }

  for (const field of fields) {
    if (mapping[field]) continue;
    const targets = synonyms[field].map(normalize).filter((target) => target.length >= 2);
    const candidates = normalized
      .filter(({ header, key }) => {
        if (used.has(header)) return false;
        if (field !== 'summary' && summaryLike.test(header)) return false;
        return targets.some((target) => key.includes(target));
      })
      .sort((a, b) => a.key.length - b.key.length);
    const hit = candidates[0];
    if (hit) {
      mapping[field] = hit.header;
      used.add(hit.header);
    }
  }

  return { mapping, unmappedHeaders: headers.filter((header) => !used.has(header)) };
}
