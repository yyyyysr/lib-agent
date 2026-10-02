import {
  createAgentUIStream,
  isStepCount,
  tool,
  ToolLoopAgent,
  type InferAgentUIMessage,
  type LanguageModel,
  type UIMessage,
} from 'ai';
import { z } from 'zod';
import {
  assessCompleteness,
  bookFieldLabels,
  newId,
  type BookRecord,
  type LibrarySearchOutput,
  type LibraryToolBook,
} from '@yys/shared';
import type { Repositories } from '@yys/db';
import { mapProviderError } from '@yys/llm-gateway';

export const CHAT_INSTRUCTIONS = `你是「一页书展」的策展助手，服务于高校图书馆馆员和学生阅读推广团队，帮助他们围绕真实馆藏策划 8–12 本书的主题微书展。

必须遵守：
1. 推荐的图书只能来自 search_library 工具返回的馆藏记录。绝不编造书名、作者、索书号或链接；检索不到合适的书时直接说明，并建议换关键词或导入更多书目。
2. 提到一本书时写出书名，有索书号时一并写出；记录缺少的字段明确标注“待核对”。
3. 介绍书的内容只依据记录中的摘要和主题词。资料不足时写“资料不足，需馆员核对”，不要补充记录之外的情节、观点或评价。
4. 记录中 isSample 为 true 的是示例数据，引用时提醒用户这是示例，正式使用前需替换为学校真实馆藏。
5. 用户给的主题过宽时，先提出 2–3 个更具体的方向供选择，再检索。
6. 用中文回答，简洁、有条理；书单用列表呈现。

当前版本可以帮助梳理主题与目标读者、检索候选书目、说明选书理由；完整的“活动包”生成流程会在后续版本开放。`;

export function toToolBook(book: BookRecord): LibraryToolBook {
  const { missingRequired, missingRecommended } = assessCompleteness(book);
  return {
    id: book.id,
    title: book.title,
    authors: book.authors,
    callNumber: book.callNumber ?? null,
    subjects: book.subjects ?? [],
    summary: book.summary ? book.summary.slice(0, 200) : null,
    sourceUrl: book.sourceUrl ?? null,
    isSample: book.isSample,
    missingFields: [...missingRequired, ...missingRecommended].map((field) => bookFieldLabels[field]),
  };
}

export function createLibraryTools(repos: Repositories) {
  return {
    search_library: tool({
      description: '在已导入的馆藏书目（含示例书库）中检索图书。多个关键词用空格分隔，表示同时满足。',
      inputSchema: z.object({
        keyword: z.string().describe('检索关键词，如“批判性思维”“人工智能”；留空表示浏览全部'),
        limit: z.number().int().min(1).max(20).default(10).describe('返回条数'),
      }),
      execute: async ({ keyword, limit }): Promise<LibrarySearchOutput> => {
        const page = repos.books.search({ text: keyword, limit });
        return { total: page.total, books: page.items.map(toToolBook) };
      },
    }),
  };
}

export function titleFromMessages(messages: UIMessage[]): string {
  const firstUser = messages.find((message) => message.role === 'user');
  const text = firstUser?.parts.find((part) => part.type === 'text')?.text?.replace(/\s+/g, ' ').trim() ?? '';
  if (!text) return '新的书展';
  return [...text].length > 24 ? `${[...text].slice(0, 24).join('')}…` : text;
}

export async function streamChat(options: {
  repos: Repositories;
  model: LanguageModel;
  conversationId: string;
  messages: UIMessage[];
  signal: AbortSignal;
  onSaved: (conversationId: string) => void;
}): Promise<AsyncIterable<unknown>> {
  const { repos, conversationId, messages } = options;
  const title = titleFromMessages(messages);

  const agent = new ToolLoopAgent({
    model: options.model,
    instructions: CHAT_INSTRUCTIONS,
    tools: createLibraryTools(repos),
    stopWhen: isStepCount(8),
    maxRetries: 2,
  });

  return createAgentUIStream({
    agent,
    uiMessages: messages,
    abortSignal: options.signal,
    originalMessages: messages as InferAgentUIMessage<typeof agent>[],
    generateMessageId: () => newId('msg'),
    onEnd: ({ messages: finalMessages }) => {
      repos.conversations.save(conversationId, finalMessages, title);
      options.onSaved(conversationId);
    },
    onError: (error) => {
      const shape = mapProviderError(error);
      return shape.hint ? `${shape.message}。${shape.hint}` : shape.message;
    },
  });
}
