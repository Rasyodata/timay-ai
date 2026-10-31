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
-- Duruşma takvimi.
CREATE TABLE IF NOT EXISTS hearings (
  id INTEGER PRIMARY KEY,
  case_id INTEGER NOT NULL REFERENCES cases(id),
  date TEXT NOT NULL,
  time TEXT NOT NULL DEFAULT '',
  place TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  created_by INTEGER NOT NULL REFERENCES users(id)
);
-- Sözleşme yönetimi.
CREATE TABLE IF NOT EXISTS contracts (
  id INTEGER PRIMARY KEY,
  office_id INTEGER NOT NULL REFERENCES offices(id),
  title TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT '',
  parties TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  start_date TEXT NOT NULL DEFAULT '',
  end_date TEXT NOT NULL DEFAULT '',
  value_kurus INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'taslak' CHECK (status IN ('taslak', 'yururlukte', 'sona_erdi')),
  case_id INTEGER REFERENCES cases(id),
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS contract_obligations (
  id INTEGER PRIMARY KEY,
  contract_id INTEGER NOT NULL REFERENCES contracts(id),
  party TEXT NOT NULL DEFAULT '',
  text TEXT NOT NULL,
  due_date TEXT NOT NULL DEFAULT '',
  amount_kurus INTEGER NOT NULL DEFAULT 0,
  done INTEGER NOT NULL DEFAULT 0
);
-- Büro muhasebesi: tutarlar kuruş cinsinden tamsayı.
CREATE TABLE IF NOT EXISTS finance_entries (
  id INTEGER PRIMARY KEY,
  office_id INTEGER NOT NULL REFERENCES offices(id),
  case_id INTEGER REFERENCES cases(id),
  kind TEXT NOT NULL CHECK (kind IN ('gelir', 'gider', 'masraf')),
  category TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  client TEXT NOT NULL DEFAULT '',
  amount_kurus INTEGER NOT NULL,
  vat_rate REAL NOT NULL DEFAULT 0,
  withholding_rate REAL NOT NULL DEFAULT 0,
  date TEXT NOT NULL,
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
-- İcra takipleri.
CREATE TABLE IF NOT EXISTS enforcement_files (
  id INTEGER PRIMARY KEY,
  office_id INTEGER NOT NULL REFERENCES offices(id),
  case_id INTEGER REFERENCES cases(id),
  office_name TEXT NOT NULL DEFAULT '',
  file_no TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL DEFAULT 'ilamsiz',
  creditor TEXT NOT NULL DEFAULT '',
  debtor TEXT NOT NULL DEFAULT '',
  principal_kurus INTEGER NOT NULL DEFAULT 0,
  interest_rate REAL NOT NULL DEFAULT 0,
  start_date TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'derdest',
  note TEXT NOT NULL DEFAULT '',
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS enforcement_actions (
  id INTEGER PRIMARY KEY,
  file_id INTEGER NOT NULL REFERENCES enforcement_files(id),
  date TEXT NOT NULL,
  action TEXT NOT NULL,
  amount_kurus INTEGER NOT NULL DEFAULT 0,
  note TEXT NOT NULL DEFAULT '',
  created_by INTEGER NOT NULL REFERENCES users(id)
);
-- Görevler: avukatlar arası iş verme.
CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY,
  office_id INTEGER NOT NULL REFERENCES offices(id),
  case_id INTEGER REFERENCES cases(id),
  title TEXT NOT NULL,
  assignee_id INTEGER NOT NULL REFERENCES users(id),
  due_date TEXT NOT NULL DEFAULT '',
  done INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
-- Danışmanlık: sürekli hukuki danışmanlık verilen müvekkiller ve çalışma kayıtları.
CREATE TABLE IF NOT EXISTS consultancy_clients (
  id INTEGER PRIMARY KEY,
  office_id INTEGER NOT NULL REFERENCES offices(id),
  name TEXT NOT NULL,
  contact TEXT NOT NULL DEFAULT '',
  tax_no TEXT NOT NULL DEFAULT '',
  monthly_fee_kurus INTEGER NOT NULL DEFAULT 0,
  included_minutes INTEGER NOT NULL DEFAULT 0,
  extra_hour_kurus INTEGER NOT NULL DEFAULT 0,
  start_date TEXT NOT NULL DEFAULT '',
  end_date TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'aktif',
  responsible_id INTEGER REFERENCES users(id),
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS consultancy_records (
  id INTEGER PRIMARY KEY,
  client_id INTEGER NOT NULL REFERENCES consultancy_clients(id),
  date TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'gorus',
  subject TEXT NOT NULL,
  minutes INTEGER NOT NULL DEFAULT 0,
  note TEXT NOT NULL DEFAULT '',
  user_id INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS consultancy_invoices (
  id INTEGER PRIMARY KEY,
  client_id INTEGER NOT NULL REFERENCES consultancy_clients(id),
  month TEXT NOT NULL,
  amount_kurus INTEGER NOT NULL,
  finance_entry_id INTEGER REFERENCES finance_entries(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (client_id, month)
);
-- Miras: tereke dosyası, mirasçılar ve tereke kalemleri.
CREATE TABLE IF NOT EXISTS estates (
  id INTEGER PRIMARY KEY,
  office_id INTEGER NOT NULL REFERENCES offices(id),
  deceased TEXT NOT NULL,
  death_date TEXT NOT NULL DEFAULT '',
  client TEXT NOT NULL DEFAULT '',
  case_id INTEGER REFERENCES cases(id),
  note TEXT NOT NULL DEFAULT '',
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS estate_heirs (
  id INTEGER PRIMARY KEY,
  estate_id INTEGER NOT NULL REFERENCES estates(id),
  name TEXT NOT NULL,
  relation TEXT NOT NULL,
  alive INTEGER NOT NULL DEFAULT 1,
  parent_id INTEGER REFERENCES estate_heirs(id),
  side TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS estate_items (
  id INTEGER PRIMARY KEY,
  estate_id INTEGER NOT NULL REFERENCES estates(id),
  kind TEXT NOT NULL CHECK (kind IN ('varlik', 'borc')),
  category TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL,
  value_kurus INTEGER NOT NULL DEFAULT 0
);
-- Önleyici hukuk: yasal süre takibi.
CREATE TABLE IF NOT EXISTS legal_deadlines (
  id INTEGER PRIMARY KEY,
  office_id INTEGER NOT NULL REFERENCES offices(id),
  case_id INTEGER REFERENCES cases(id),
  title TEXT NOT NULL,
  rule_id TEXT NOT NULL DEFAULT '',
  start_date TEXT NOT NULL DEFAULT '',
  due_date TEXT NOT NULL,
  basis TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  done INTEGER NOT NULL DEFAULT 0,
  responsible_id INTEGER REFERENCES users(id),
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
-- Sözleşme onay geçmişi (dilekçedeki akranlar arası onayın sözleşme karşılığı).
CREATE TABLE IF NOT EXISTS contract_reviews (
  id INTEGER PRIMARY KEY,
  contract_id INTEGER NOT NULL REFERENCES contracts(id),
  action TEXT NOT NULL CHECK (action IN ('submit', 'approve', 'request_changes')),
  comment TEXT NOT NULL DEFAULT '',
  body_hash TEXT NOT NULL DEFAULT '',
  user_id INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
-- Sözleşme zırhı: kural bankası, madde kütüphanesi, versiyonlar, imza sırası.
CREATE TABLE IF NOT EXISTS playbooks (
  office_id INTEGER PRIMARY KEY REFERENCES offices(id),
  params TEXT NOT NULL DEFAULT '{}',
  updated_by INTEGER REFERENCES users(id),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS clause_library (
  id INTEGER PRIMARY KEY,
  office_id INTEGER NOT NULL REFERENCES offices(id),
  kind TEXT NOT NULL DEFAULT 'genel',
  topic TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  approved INTEGER NOT NULL DEFAULT 1,
  approved_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS contract_versions (
  id INTEGER PRIMARY KEY,
  contract_id INTEGER NOT NULL REFERENCES contracts(id),
  version INTEGER NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('biz', 'karsi')),
  body TEXT NOT NULL,
  file_name TEXT NOT NULL DEFAULT '',
  meta TEXT NOT NULL DEFAULT '{}',
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (contract_id, version)
);
CREATE TABLE IF NOT EXISTS contract_signers (
  id INTEGER PRIMARY KEY,
  contract_id INTEGER NOT NULL REFERENCES contracts(id),
  position INTEGER NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT '',
  signed_at TEXT NOT NULL DEFAULT ''
);
-- Dava dosyasına eklenen belgeler (UYAP .udf, PDF, Word, TIF, resim); metni aranabilir tutulur.
CREATE TABLE IF NOT EXISTS case_documents (
  id INTEGER PRIMARY KEY,
  office_id INTEGER NOT NULL REFERENCES offices(id),
  case_id INTEGER NOT NULL REFERENCES cases(id),
  title TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'diger',
  file_name TEXT NOT NULL,
  mime_type TEXT NOT NULL DEFAULT '',
  size INTEGER NOT NULL,
  data BLOB NOT NULL,
  text TEXT NOT NULL DEFAULT '',
  ocr INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
-- Vekâletnameler ve bağlı dava dosyaları.
CREATE TABLE IF NOT EXISTS powers_of_attorney (
  id INTEGER PRIMARY KEY,
  office_id INTEGER NOT NULL REFERENCES offices(id),
  client TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'genel',
  notary TEXT NOT NULL DEFAULT '',
  journal_no TEXT NOT NULL DEFAULT '',
  issue_date TEXT NOT NULL DEFAULT '',
  expiry_date TEXT NOT NULL DEFAULT '',
  lawyers TEXT NOT NULL DEFAULT '',
  powers TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'gecerli',
  status_date TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  file_name TEXT NOT NULL DEFAULT '',
  mime_type TEXT NOT NULL DEFAULT '',
  data BLOB,
  text TEXT NOT NULL DEFAULT '',
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS poa_cases (
  poa_id INTEGER NOT NULL REFERENCES powers_of_attorney(id),
  case_id INTEGER NOT NULL REFERENCES cases(id),
  PRIMARY KEY (poa_id, case_id)
);
-- Sözleşme dosyaları: tek bir işin sözleşmeleri ya da toplu incelenen benzer sözleşmeler.
CREATE TABLE IF NOT EXISTS contract_groups (
  id INTEGER PRIMARY KEY,
  office_id INTEGER NOT NULL REFERENCES offices(id),
  title TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT '',
  side TEXT NOT NULL DEFAULT '',
  case_id INTEGER REFERENCES cases(id),
  note TEXT NOT NULL DEFAULT '',
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
-- Güncelle: dosya analizlerinin geçmişi (risk, eksikler), program sürümüyle birlikte.
CREATE TABLE IF NOT EXISTS analysis_runs (
  id INTEGER PRIMARY KEY,
  office_id INTEGER NOT NULL REFERENCES offices(id),
  entity TEXT NOT NULL,
  entity_id INTEGER NOT NULL,
  engine TEXT NOT NULL,
  risk INTEGER NOT NULL,
  band TEXT NOT NULL,
  data TEXT NOT NULL,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS analysis_runs_entity ON analysis_runs (office_id, entity, entity_id);
-- Safahat: davanın aşamaları (tensip, ön inceleme, karar, kanun yolu…).
CREATE TABLE IF NOT EXISTS case_stages (
  id INTEGER PRIMARY KEY,
  office_id INTEGER NOT NULL REFERENCES offices(id),
  case_id INTEGER NOT NULL REFERENCES cases(id),
  stage TEXT NOT NULL,
  date TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
-- Bildirim merkezi: kullanıcının okuduğu bildirimler (bildirimler anlık hesaplanır).
CREATE TABLE IF NOT EXISTS notification_reads (
  user_id INTEGER NOT NULL REFERENCES users(id),
  key TEXT NOT NULL,
  read_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, key)
);
-- Mevzuat takibi: büronun izlediği kanun değişiklikleri.
CREATE TABLE IF NOT EXISTS law_changes (
  id INTEGER PRIMARY KEY,
  office_id INTEGER NOT NULL REFERENCES offices(id),
  law TEXT NOT NULL,
  articles TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL,
  effective_date TEXT NOT NULL DEFAULT '',
  summary TEXT NOT NULL DEFAULT '',
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
-- Akıllı notlar: dava dosyasına ya da büroya ait notlar (#etiket, sabitleme).
CREATE TABLE IF NOT EXISTS notes (
  id INTEGER PRIMARY KEY,
  office_id INTEGER NOT NULL REFERENCES offices(id),
  case_id INTEGER REFERENCES cases(id),
  body TEXT NOT NULL,
  tags TEXT NOT NULL DEFAULT '',
  pinned INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
-- İcra dosyasında yapılan mal varlığı / adres sorguları (UYAP'ta yapılır, sonucu burada tutulur).
CREATE TABLE IF NOT EXISTS enforcement_queries (
  id INTEGER PRIMARY KEY,
  office_id INTEGER NOT NULL REFERENCES offices(id),
  file_id INTEGER NOT NULL REFERENCES enforcement_files(id),
  kind TEXT NOT NULL,
  date TEXT NOT NULL,
  found INTEGER NOT NULL DEFAULT 0,
  result TEXT NOT NULL DEFAULT '',
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
-- Arabuluculuk: arabulucu profili, dosyalar, taraflar ve toplantılar.
CREATE TABLE IF NOT EXISTS mediator_profiles (
  user_id INTEGER PRIMARY KEY REFERENCES users(id),
  sicil_no TEXT NOT NULL DEFAULT '',
  id_no TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  iban TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS mediation_files (
  id INTEGER PRIMARY KEY,
  office_id INTEGER NOT NULL REFERENCES offices(id),
  mediator_id INTEGER NOT NULL REFERENCES users(id),
  case_id INTEGER REFERENCES cases(id),
  buro_no TEXT NOT NULL DEFAULT '',
  arb_no TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL DEFAULT 'is',
  mandatory INTEGER NOT NULL DEFAULT 1,
  subject TEXT NOT NULL DEFAULT '',
  claim_kurus INTEGER NOT NULL DEFAULT 0,
  assigned_date TEXT NOT NULL DEFAULT '',
  adliye TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'basvuru',
  result_kurus INTEGER NOT NULL DEFAULT 0,
  hours REAL NOT NULL DEFAULT 2,
  result_terms TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS mediation_parties (
  id INTEGER PRIMARY KEY,
  file_id INTEGER NOT NULL REFERENCES mediation_files(id),
  side TEXT NOT NULL DEFAULT 'basvurucu',
  name TEXT NOT NULL,
  id_no TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  lawyer TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS mediation_meetings (
  id INTEGER PRIMARY KEY,
  file_id INTEGER NOT NULL REFERENCES mediation_files(id),
  date TEXT NOT NULL,
  time TEXT NOT NULL DEFAULT '',
  place TEXT NOT NULL DEFAULT '',
  method TEXT NOT NULL DEFAULT 'yuz_yuze',
  note TEXT NOT NULL DEFAULT ''
);
-- Ajanda (dava defteri): avukatın kendi notları ve randevuları.
CREATE TABLE IF NOT EXISTS agenda_items (
  id INTEGER PRIMARY KEY,
  office_id INTEGER NOT NULL REFERENCES offices(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  case_id INTEGER REFERENCES cases(id),
  date TEXT NOT NULL,
  time TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT ''
);
`;

/** Eski veritabanlarına sonradan eklenen sütunlar. */
function migrate(db: DB) {
  const caseColumns = (db.prepare('PRAGMA table_info(cases)').all() as { name: string }[]).map((c) => c.name);
  if (!caseColumns.includes('area')) db.exec("ALTER TABLE cases ADD COLUMN area TEXT NOT NULL DEFAULT ''");
  if (!caseColumns.includes('client')) db.exec("ALTER TABLE cases ADD COLUMN client TEXT NOT NULL DEFAULT ''");
  if (!caseColumns.includes('responsible_id')) db.exec('ALTER TABLE cases ADD COLUMN responsible_id INTEGER REFERENCES users(id)');
  if (!caseColumns.includes('status')) db.exec("ALTER TABLE cases ADD COLUMN status TEXT NOT NULL DEFAULT 'acik'");
  if (!caseColumns.includes('stage')) db.exec("ALTER TABLE cases ADD COLUMN stage TEXT NOT NULL DEFAULT ''");

  const userColumns = (db.prepare('PRAGMA table_info(users)').all() as { name: string }[]).map((c) => c.name);
  if (!userColumns.includes('is_admin')) {
    db.exec('ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0');
    // Mevcut bürolarda büroyu açan (ilk) kullanıcı yönetici olur.
    db.exec('UPDATE users SET is_admin = 1 WHERE id IN (SELECT MIN(id) FROM users GROUP BY office_id)');
  }
  if (!userColumns.includes('can_finance')) {
    db.exec('ALTER TABLE users ADD COLUMN can_finance INTEGER NOT NULL DEFAULT 1');
    db.exec("UPDATE users SET can_finance = 0 WHERE role = 'stajyer'");
  }
  if (!userColumns.includes('can_approve')) {
    db.exec('ALTER TABLE users ADD COLUMN can_approve INTEGER NOT NULL DEFAULT 1');
    db.exec("UPDATE users SET can_approve = 0 WHERE role = 'stajyer'");
  }
  if (!userColumns.includes('all_cases')) db.exec('ALTER TABLE users ADD COLUMN all_cases INTEGER NOT NULL DEFAULT 1');

  const contractColumns = (db.prepare('PRAGMA table_info(contracts)').all() as { name: string }[]).map((c) => c.name);
  if (!contractColumns.includes('review_status')) {
    db.exec("ALTER TABLE contracts ADD COLUMN review_status TEXT NOT NULL DEFAULT ''");
    db.exec('ALTER TABLE contracts ADD COLUMN submitted_by INTEGER REFERENCES users(id)');
  }
  if (!contractColumns.includes('side')) db.exec("ALTER TABLE contracts ADD COLUMN side TEXT NOT NULL DEFAULT ''");
  if (!contractColumns.includes('locked_at')) db.exec("ALTER TABLE contracts ADD COLUMN locked_at TEXT NOT NULL DEFAULT ''");
  if (!contractColumns.includes('permit_date')) db.exec("ALTER TABLE contracts ADD COLUMN permit_date TEXT NOT NULL DEFAULT ''");
  if (!contractColumns.includes('units')) db.exec('ALTER TABLE contracts ADD COLUMN units INTEGER NOT NULL DEFAULT 1');
  if (!contractColumns.includes('group_id')) db.exec('ALTER TABLE contracts ADD COLUMN group_id INTEGER REFERENCES contract_groups(id)');
  if (!contractColumns.includes('parent_id')) {
    // Ek sözleşme ve yenileme: yeni sözleşme asıl sözleşmeye bağlanır.
    db.exec('ALTER TABLE contracts ADD COLUMN parent_id INTEGER REFERENCES contracts(id)');
    db.exec("ALTER TABLE contracts ADD COLUMN relation TEXT NOT NULL DEFAULT ''");
    db.exec("ALTER TABLE contracts ADD COLUMN terminated_at TEXT NOT NULL DEFAULT ''");
    db.exec("ALTER TABLE contracts ADD COLUMN termination_reason TEXT NOT NULL DEFAULT ''");
  }
  const obligationColumns = (db.prepare('PRAGMA table_info(contract_obligations)').all() as { name: string }[]).map((c) => c.name);
  if (!obligationColumns.includes('direction')) db.exec("ALTER TABLE contract_obligations ADD COLUMN direction TEXT NOT NULL DEFAULT ''");
  if (!obligationColumns.includes('source')) db.exec("ALTER TABLE contract_obligations ADD COLUMN source TEXT NOT NULL DEFAULT ''");
  const efColumns = (db.prepare('PRAGMA table_info(enforcement_files)').all() as { name: string }[]).map((c) => c.name);
  if (!efColumns.includes('debtor_id_no')) {
    // İcra föyü: borçlu kimliği ve adresi, faiz türü, takip öncesi faiz, vekâlet ücreti.
    db.exec("ALTER TABLE enforcement_files ADD COLUMN debtor_id_no TEXT NOT NULL DEFAULT ''");
    db.exec("ALTER TABLE enforcement_files ADD COLUMN debtor_address TEXT NOT NULL DEFAULT ''");
    db.exec("ALTER TABLE enforcement_files ADD COLUMN interest_type TEXT NOT NULL DEFAULT 'sabit'");
    db.exec('ALTER TABLE enforcement_files ADD COLUMN pre_interest_kurus INTEGER NOT NULL DEFAULT 0');
    db.exec('ALTER TABLE enforcement_files ADD COLUMN fee_kurus INTEGER NOT NULL DEFAULT 0');
  }
  const taskColumns = (db.prepare('PRAGMA table_info(tasks)').all() as { name: string }[]).map((c) => c.name);
  if (!taskColumns.includes('status')) {
    // Görev panosu: yapilacak → devam → inceleme → tamam. Tamamlama kontrol edene aittir.
    db.exec("ALTER TABLE tasks ADD COLUMN status TEXT NOT NULL DEFAULT 'yapilacak'");
    db.exec('ALTER TABLE tasks ADD COLUMN reviewer_id INTEGER REFERENCES users(id)');
    db.exec("UPDATE tasks SET status = 'tamam' WHERE done = 1");
  }
}

export function openDb(file = ':memory:'): DB {
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(schema);
  migrate(db);
  return db;
}
