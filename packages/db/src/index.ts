import { AppDatabase } from './database';
import { BookRepo } from './repos/books';
import { ApprovalRepo, EventRepo, ExhibitionRepo, FeedbackRepo } from './repos/exhibitions';
import { ProviderRepo } from './repos/providers';
import { SettingsRepo } from './repos/settings';
import { SessionRepo, UserRepo } from './repos/users';

export { AppDatabase, fromJson, toJson } from './database';
export type { ApprovalRow, ExhibitionRecord } from './repos/exhibitions';
export {
  ApprovalRepo,
  BookRepo,
  EventRepo,
  ExhibitionRepo,
  FeedbackRepo,
  ProviderRepo,
  SessionRepo,
  SettingsRepo,
  UserRepo,
};

export interface Repositories {
  db: AppDatabase;
  settings: SettingsRepo;
  providers: ProviderRepo;
  books: BookRepo;
  users: UserRepo;
  sessions: SessionRepo;
  exhibitions: ExhibitionRepo;
  approvals: ApprovalRepo;
  events: EventRepo;
  feedback: FeedbackRepo;
}

export function openRepositories(file: string): Repositories {
  const db = new AppDatabase(file);
  return {
    db,
    settings: new SettingsRepo(db),
    providers: new ProviderRepo(db),
    books: new BookRepo(db),
    users: new UserRepo(db),
    sessions: new SessionRepo(db),
    exhibitions: new ExhibitionRepo(db),
    approvals: new ApprovalRepo(db),
    events: new EventRepo(db),
    feedback: new FeedbackRepo(db),
  };
}
