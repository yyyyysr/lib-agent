/** 只追加，不修改已发布的迁移；序号即 PRAGMA user_version */
export const migrations: string[] = [
  /* sql */ `
  CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE providers (
    id TEXT PRIMARY KEY,
    preset_id TEXT NOT NULL,
    display_name TEXT NOT NULL,
    base_url TEXT,
    secret_ref TEXT NOT NULL,
    has_key INTEGER NOT NULL DEFAULT 0,
    models TEXT NOT NULL DEFAULT '[]',
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE book_sources (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    name TEXT NOT NULL,
    meta TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE books (
    id TEXT PRIMARY KEY,
    source_id TEXT NOT NULL REFERENCES book_sources(id) ON DELETE CASCADE,
    external_id TEXT,
    title TEXT NOT NULL,
    authors TEXT NOT NULL DEFAULT '[]',
    publisher TEXT,
    pub_year INTEGER,
    isbn TEXT,
    call_number TEXT,
    location TEXT,
    availability TEXT,
    subjects TEXT,
    summary TEXT,
    source_url TEXT,
    cover_url TEXT,
    is_sample INTEGER NOT NULL DEFAULT 0,
    provenance TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (source_id, external_id)
  );
  CREATE INDEX books_source_idx ON books(source_id);
  CREATE INDEX books_isbn_idx ON books(isbn);

  -- trigram 分词适配中文；少于 3 个字的关键词由查询层回退到 LIKE
  CREATE VIRTUAL TABLE books_fts USING fts5(
    title, authors, subjects, summary,
    content = 'books', content_rowid = 'rowid', tokenize = 'trigram'
  );
  CREATE TRIGGER books_ai AFTER INSERT ON books BEGIN
    INSERT INTO books_fts(rowid, title, authors, subjects, summary)
    VALUES (new.rowid, new.title, new.authors, new.subjects, new.summary);
  END;
  CREATE TRIGGER books_ad AFTER DELETE ON books BEGIN
    INSERT INTO books_fts(books_fts, rowid, title, authors, subjects, summary)
    VALUES ('delete', old.rowid, old.title, old.authors, old.subjects, old.summary);
  END;
  CREATE TRIGGER books_au AFTER UPDATE ON books BEGIN
    INSERT INTO books_fts(books_fts, rowid, title, authors, subjects, summary)
    VALUES ('delete', old.rowid, old.title, old.authors, old.subjects, old.summary);
    INSERT INTO books_fts(rowid, title, authors, subjects, summary)
    VALUES (new.rowid, new.title, new.authors, new.subjects, new.summary);
  END;

  CREATE TABLE conversations (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    messages TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX conversations_updated_idx ON conversations(updated_at DESC);
  `,

  /* sql */ `
  -- 从通用对话改为以书展为中心的工作流
  DROP TABLE IF EXISTS conversations;

  CREATE TABLE users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    display_name TEXT NOT NULL,
    member_no TEXT NOT NULL,
    department TEXT NOT NULL DEFAULT '',
    role TEXT NOT NULL DEFAULT 'user',
    status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL,
    last_login_at TEXT
  );

  CREATE TABLE sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  );
  CREATE INDEX sessions_user_idx ON sessions(user_id);

  -- 旧版本创建的服务商没有归属，视为全员共享
  ALTER TABLE providers ADD COLUMN owner_id TEXT;
  ALTER TABLE book_sources ADD COLUMN created_by TEXT;

  CREATE TABLE exhibitions (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL REFERENCES users(id),
    title TEXT NOT NULL,
    status TEXT NOT NULL,
    brief TEXT NOT NULL,
    plan TEXT,
    checks TEXT NOT NULL DEFAULT '[]',
    proposal TEXT,
    package TEXT,
    execution TEXT NOT NULL DEFAULT '{}',
    retrospective TEXT,
    published_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX exhibitions_owner_idx ON exhibitions(owner_id, updated_at DESC);
  CREATE INDEX exhibitions_published_idx ON exhibitions(published_at DESC);

  CREATE TABLE approvals (
    id TEXT PRIMARY KEY,
    exhibition_id TEXT NOT NULL REFERENCES exhibitions(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    submitted_by TEXT NOT NULL REFERENCES users(id),
    submitted_at TEXT NOT NULL,
    snapshot TEXT NOT NULL,
    reviewer_id TEXT REFERENCES users(id),
    reviewed_at TEXT,
    comment TEXT NOT NULL DEFAULT ''
  );
  CREATE INDEX approvals_status_idx ON approvals(status, submitted_at DESC);
  CREATE INDEX approvals_exhibition_idx ON approvals(exhibition_id, submitted_at DESC);

  CREATE TABLE exhibition_events (
    id TEXT PRIMARY KEY,
    exhibition_id TEXT NOT NULL REFERENCES exhibitions(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    message TEXT NOT NULL,
    actor_id TEXT,
    at TEXT NOT NULL
  );
  CREATE INDEX exhibition_events_idx ON exhibition_events(exhibition_id, at);

  CREATE TABLE feedback_entries (
    id TEXT PRIMARY KEY,
    exhibition_id TEXT NOT NULL REFERENCES exhibitions(id) ON DELETE CASCADE,
    rating INTEGER,
    content TEXT NOT NULL,
    created_by TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX feedback_exhibition_idx ON feedback_entries(exhibition_id, created_at);
  `,
];
