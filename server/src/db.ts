import Database from 'better-sqlite3';

export type DB = Database.Database;

const schema = `
CREATE TABLE IF NOT EXISTS offices (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  office_id INTEGER NOT NULL REFERENCES offices(id),
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('avukat', 'stajyer'))
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS invites (
  token TEXT PRIMARY KEY,
  office_id INTEGER NOT NULL REFERENCES offices(id),
  email TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('avukat', 'stajyer')),
  used INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS cases (
  id INTEGER PRIMARY KEY,
  office_id INTEGER NOT NULL REFERENCES offices(id),
  title TEXT NOT NULL,
  court TEXT NOT NULL DEFAULT '',
  esas_no TEXT NOT NULL DEFAULT '',
  parties TEXT NOT NULL DEFAULT '',
  facts TEXT NOT NULL DEFAULT '',
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
-- Karar arşivi: yalnızca burada bulunan kararlara atıf yapılabilir.
CREATE TABLE IF NOT EXISTS decisions (
  id INTEGER PRIMARY KEY,
  court TEXT NOT NULL,
  chamber TEXT NOT NULL DEFAULT '',
  esas_no TEXT NOT NULL,
  karar_no TEXT NOT NULL,
  decision_date TEXT NOT NULL DEFAULT '',
  text TEXT NOT NULL DEFAULT '',
  source_url TEXT NOT NULL DEFAULT '',
  UNIQUE (court, esas_no, karar_no)
);
CREATE TABLE IF NOT EXISTS petitions (
  id INTEGER PRIMARY KEY,
  case_id INTEGER NOT NULL REFERENCES cases(id),
  title TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('taslak', 'incelemede', 'duzeltme', 'onayli')),
  author_id INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS petition_versions (
  id INTEGER PRIMARY KEY,
  petition_id INTEGER NOT NULL REFERENCES petitions(id),
  version INTEGER NOT NULL,
  body TEXT NOT NULL,
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (petition_id, version)
);
CREATE TABLE IF NOT EXISTS reviews (
  id INTEGER PRIMARY KEY,
  petition_id INTEGER NOT NULL REFERENCES petitions(id),
  version INTEGER NOT NULL,
  reviewer_id INTEGER NOT NULL REFERENCES users(id),
  action TEXT NOT NULL CHECK (action IN ('approve', 'request_changes')),
  comment TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
-- Karşı tarafın dilekçeleri: değiştirilemez, yalnızca teyit edilir.
CREATE TABLE IF NOT EXISTS opposing_documents (
  id INTEGER PRIMARY KEY,
  case_id INTEGER NOT NULL REFERENCES cases(id),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
-- Derin teyit (Claude) sonuçları; her sürüm için saklanır, tekrar ücret ödenmez.
CREATE TABLE IF NOT EXISTS teyit_runs (
  id INTEGER PRIMARY KEY,
  target TEXT NOT NULL CHECK (target IN ('petition', 'opposing')),
  target_id INTEGER NOT NULL,
  version INTEGER NOT NULL,
  items TEXT NOT NULL,
  model TEXT NOT NULL,
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
-- İnceleyen avukatın sarı/gri dayanakları tek tek kontrol ettiğinin kaydı.
CREATE TABLE IF NOT EXISTS teyit_acks (
  petition_id INTEGER NOT NULL REFERENCES petitions(id),
  version INTEGER NOT NULL,
  item_key TEXT NOT NULL,
  user_id INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (petition_id, version, item_key, user_id)
);
-- Onay anındaki teyit özeti: "X dayanak teyit edildi, Av. Y onayladı".
CREATE TABLE IF NOT EXISTS approval_records (
  id INTEGER PRIMARY KEY,
  petition_id INTEGER NOT NULL REFERENCES petitions(id),
  version INTEGER NOT NULL,
  reviewer_id INTEGER NOT NULL REFERENCES users(id),
  summary TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`;

export function openDb(file = ':memory:'): DB {
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(schema);
  return db;
}
