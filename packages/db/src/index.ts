import { AppDatabase } from './database';
import { BookRepo } from './repos/books';
import { ConversationRepo } from './repos/conversations';
import { ProviderRepo } from './repos/providers';
import { SettingsRepo } from './repos/settings';

export { AppDatabase, fromJson, toJson } from './database';
export { BookRepo, ConversationRepo, ProviderRepo, SettingsRepo };

export interface Repositories {
  db: AppDatabase;
  settings: SettingsRepo;
  providers: ProviderRepo;
  books: BookRepo;
  conversations: ConversationRepo;
}

export function openRepositories(file: string): Repositories {
  const db = new AppDatabase(file);
  return {
    db,
    settings: new SettingsRepo(db),
    providers: new ProviderRepo(db),
    books: new BookRepo(db),
    conversations: new ConversationRepo(db),
  };
}
