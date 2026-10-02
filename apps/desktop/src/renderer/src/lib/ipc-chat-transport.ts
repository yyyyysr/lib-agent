import type { ChatTransport, UIMessage, UIMessageChunk } from 'ai';
import { core } from './core-client';

/** 让 AI SDK 的 useChat 跑在 Core 的 MessagePort 上，而不是 HTTP */
export class IpcChatTransport implements ChatTransport<UIMessage> {
  async sendMessages(options: Parameters<ChatTransport<UIMessage>['sendMessages']>[0]): Promise<ReadableStream<UIMessageChunk>> {
    return core.stream(
      'chat.send',
      { conversationId: options.chatId, messages: options.messages },
      options.abortSignal,
    ) as ReadableStream<UIMessageChunk>;
  }

  async reconnectToStream(): Promise<ReadableStream<UIMessageChunk> | null> {
    return null;
  }
}

export const chatTransport = new IpcChatTransport();
