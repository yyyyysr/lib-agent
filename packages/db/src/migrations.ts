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
];
