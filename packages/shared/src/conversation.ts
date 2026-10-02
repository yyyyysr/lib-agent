export interface ConversationSummary {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export interface ConversationDetail extends ConversationSummary {
  /** AI SDK UIMessage[]，按原样持久化 */
  messages: unknown[];
}
