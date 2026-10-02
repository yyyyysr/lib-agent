import type { BookRecord, BookSnapshot } from '@yys/shared';

export function toSnapshot(book: BookRecord): BookSnapshot {
  return {
    id: book.id,
    title: book.title,
    authors: book.authors,
    callNumber: book.callNumber,
    sourceUrl: book.sourceUrl,
    subjects: book.subjects ?? [],
    summary: book.summary,
    isbn: book.isbn,
    coverUrl: book.coverUrl,
    isSample: book.isSample,
  };
}

/** 发给模型的单行书目描述：只含完成任务需要的字段，摘要截断，避免上下文过长 */
export function describeBook(ref: string, book: BookSnapshot, summaryLimit = 120): string {
  const parts = [`${ref}｜《${book.title}》`, book.authors.join('、') || '作者未知'];
  if (book.subjects.length) parts.push(`主题词：${book.subjects.slice(0, 6).join('、')}`);
  if (book.summary) parts.push(`摘要：${[...book.summary].slice(0, summaryLimit).join('')}`);
  else parts.push('摘要：无');
  return parts.join('｜');
}

export const formatLessons = (lessons: string[]): string =>
  lessons.length
    ? `\n往期书展复盘得出的经验（请在本次方案中参考）：\n${lessons.map((l) => `- ${l}`).join('\n')}`
    : '';
