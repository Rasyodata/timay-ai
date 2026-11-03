import { canSeeCeoPanel, type User } from './auth.ts';
import type { DB } from './db.ts';
import { ApiError } from './errors.ts';
import { AREAS } from './templates.ts';

export interface Activity {
  at: string;
  user_id: number;
  user_name: string;
  module: string;
  text: string;
}

/**
 * Büroda kim ne yaptı: her modülün kendi tablosundaki "kim, ne zaman" kayıtlarından
 * tek bir akış. Ayrı bir günlük tablosu gerektirmez; geçmiş kayıtlar da görünür.
 */
const SOURCES: { module: string; sql: string }[] = [
  { module: 'Dava', sql: `SELECT c.created_at AS at, c.created_by AS uid, 'yeni dava dosyası açtı: ' || c.title AS text FROM cases c WHERE c.office_id = @o` },
  {
    module: 'Dilekçe',
    sql: `SELECT p.created_at, p.author_id, 'dilekçe başlattı: ' || p.title || ' (' || c.title || ')' FROM petitions p JOIN cases c ON c.id = p.case_id WHERE c.office_id = @o`,
  },
  {
    module: 'Dilekçe',
    sql: `SELECT v.created_at, v.created_by, 'dilekçeyi düzenledi (' || v.version || '. sürüm): ' || p.title FROM petition_versions v JOIN petitions p ON p.id = v.petition_id JOIN cases c ON c.id = p.case_id WHERE c.office_id = @o AND v.version > 1`,
  },
  {
    module: 'Onay',
    sql: `SELECT r.created_at, r.reviewer_id, CASE r.action WHEN 'approve' THEN 'dilekçeyi onayladı: ' ELSE 'dilekçeye düzeltme istedi: ' END || p.title FROM reviews r JOIN petitions p ON p.id = r.petition_id JOIN cases c ON c.id = p.case_id WHERE c.office_id = @o`,
  },
  { module: 'Sözleşme', sql: `SELECT k.created_at, k.created_by, 'sözleşme ekledi: ' || k.title FROM contracts k WHERE k.office_id = @o` },
  {
    module: 'Sözleşme',
    sql: `SELECT r.created_at, r.user_id, CASE r.action WHEN 'submit' THEN 'sözleşmeyi onaya gönderdi: ' WHEN 'approve' THEN 'sözleşmeyi onayladı: ' ELSE 'sözleşmeye düzeltme istedi: ' END || k.title FROM contract_reviews r JOIN contracts k ON k.id = r.contract_id WHERE k.office_id = @o`,
  },
  { module: 'Belge', sql: `SELECT d.created_at, d.created_by, 'dosyaya belge yükledi: ' || d.title FROM case_documents d WHERE d.office_id = @o` },
  {
    module: 'Görev',
    sql: `SELECT t.created_at, t.created_by, 'görev verdi: ' || t.title || ' → ' || a.name FROM tasks t JOIN users a ON a.id = t.assignee_id WHERE t.office_id = @o`,
  },
  {
    module: 'İcra',
    sql: `SELECT e.created_at, e.created_by, 'icra takibi açtı: ' || CASE WHEN e.debtor != '' THEN e.debtor ELSE e.file_no END FROM enforcement_files e WHERE e.office_id = @o`,
  },
  { module: 'Tebligat', sql: `SELECT t.created_at, t.created_by, 'tebligat işledi: ' || t.subject FROM tebligatlar t WHERE t.office_id = @o` },
  {
    module: 'Zaman',
    sql: `SELECT t.created_at, t.user_id, (t.minutes / 60) || ' sa ' || (t.minutes % 60) || ' dk çalıştı' || CASE WHEN t.description != '' THEN ': ' || t.description ELSE '' END FROM time_entries t WHERE t.office_id = @o AND t.running_since = ''`,
  },
  { module: 'Vekâlet', sql: `SELECT p.created_at, p.created_by, 'vekâletname kaydetti: ' || p.client FROM powers_of_attorney p WHERE p.office_id = @o` },
  { module: 'Not', sql: `SELECT n.created_at, n.created_by, 'not aldı: ' || substr(n.body, 1, 60) FROM notes n WHERE n.office_id = @o` },
  {
    module: 'Yapay zekâ',
    sql: `SELECT a.created_at, a.user_id, 'yapay zekâ ile çalıştı: ' || CASE WHEN a.title != '' THEN a.title ELSE a.mode END FROM ai_chats a WHERE a.office_id = @o`,
  },
  {
    module: 'Muhasebe',
    sql: `SELECT f.created_at, f.created_by, CASE f.kind WHEN 'gelir' THEN 'gelir kaydetti' WHEN 'gider' THEN 'gider kaydetti' ELSE 'masraf kaydetti' END || CASE WHEN f.description != '' THEN ': ' || f.description ELSE '' END FROM finance_entries f WHERE f.office_id = @o`,
  },
];

/** Son hareketler, en yenisi önce. Muhasebe kayıtları yalnız muhasebe yetkisi olana görünür. */
export function activityFeed(db: DB, user: User, limit = 60): Activity[] {
  const sources = SOURCES.filter((s) => s.module !== 'Muhasebe' || user.can_finance);
  // Sütun adları ilk sorgudan gelir (at, uid, text).
  const union = sources.map((s) => `SELECT '${s.module}' AS module, * FROM (${s.sql})`).join(' UNION ALL ');
  return db
    .prepare(
      `SELECT a.at, a.uid AS user_id, u.name AS user_name, a.module, a.text
       FROM (${union}) a JOIN users u ON u.id = a.uid
       ORDER BY a.at DESC LIMIT @limit`,
    )
    .all({ o: user.office_id, limit }) as Activity[];
}

function months(n: number): string[] {
  const out: string[] = [];
  const d = new Date();
  d.setUTCDate(1);
  for (let i = n - 1; i >= 0; i--) {
    const m = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - i, 1));
    out.push(m.toISOString().slice(0, 7));
  }
  return out;
}

/** Yönetim paneli (CEO): kayan şerit akışı + iş zekâsı göstergeleri. */
export function ceoPanel(db: DB, user: User) {
  if (!canSeeCeoPanel(user)) throw new ApiError(403, 'Yönetim panelini yalnız CEO ve büro yöneticisi görür.');
  const o = user.office_id;
  const n = (sql: string, ...p: unknown[]) => (db.prepare(sql).get(...p) as { n: number }).n;

  const kpis = {
    lawyers: n("SELECT COUNT(*) AS n FROM users WHERE office_id = ? AND role = 'avukat'", o),
    openCases: n("SELECT COUNT(*) AS n FROM cases WHERE office_id = ? AND status = 'acik'", o),
    newCases30: n("SELECT COUNT(*) AS n FROM cases WHERE office_id = ? AND created_at >= datetime('now', '-30 day')", o),
    petitionsInReview: n(
      "SELECT COUNT(*) AS n FROM petitions p JOIN cases c ON c.id = p.case_id WHERE c.office_id = ? AND p.status = 'incelemede'",
      o,
    ),
    approved30: n(
      "SELECT COUNT(*) AS n FROM reviews r JOIN petitions p ON p.id = r.petition_id JOIN cases c ON c.id = p.case_id WHERE c.office_id = ? AND r.action = 'approve' AND r.created_at >= datetime('now', '-30 day')",
      o,
    ),
    hearings7: n(
      "SELECT COUNT(*) AS n FROM hearings h JOIN cases c ON c.id = h.case_id WHERE c.office_id = ? AND h.date BETWEEN date('now') AND date('now', '+7 day')",
      o,
    ),
    overdueTasks: n(
      "SELECT COUNT(*) AS n FROM tasks WHERE office_id = ? AND done = 0 AND due_date != '' AND due_date < date('now')",
      o,
    ),
    activeContracts: n("SELECT COUNT(*) AS n FROM contracts WHERE office_id = ? AND status = 'yururlukte'", o),
    openEnforcement: n("SELECT COUNT(*) AS n FROM enforcement_files WHERE office_id = ? AND status NOT IN ('tahsil', 'kapandi')", o),
    hours30: Math.round(
      n("SELECT COALESCE(SUM(minutes), 0) AS n FROM time_entries WHERE office_id = ? AND date >= date('now', '-30 day')", o) / 6,
    ) / 10,
  };

  // Avukat bazında performans (son 30 gün + açık iş yükü).
  const lawyers = db
    .prepare(
      `SELECT u.id, u.name, u.role, u.is_ceo,
        (SELECT COUNT(*) FROM cases c WHERE c.office_id = u.office_id AND c.status = 'acik' AND COALESCE(c.responsible_id, c.created_by) = u.id) AS open_cases,
        (SELECT COUNT(*) FROM petition_versions v JOIN petitions p ON p.id = v.petition_id JOIN cases c ON c.id = p.case_id
          WHERE c.office_id = u.office_id AND v.created_by = u.id AND v.created_at >= datetime('now', '-30 day')) AS petitions_written,
        (SELECT COUNT(*) FROM reviews r WHERE r.reviewer_id = u.id AND r.action = 'approve' AND r.created_at >= datetime('now', '-30 day')) AS approvals,
        (SELECT COUNT(*) FROM tasks t WHERE t.assignee_id = u.id AND t.done = 0) AS open_tasks,
        (SELECT COUNT(*) FROM tasks t WHERE t.assignee_id = u.id AND t.done = 0 AND t.due_date != '' AND t.due_date < date('now')) AS overdue_tasks,
        (SELECT COALESCE(SUM(minutes), 0) FROM time_entries t WHERE t.user_id = u.id AND t.date >= date('now', '-30 day')) AS minutes,
        (SELECT COUNT(*) FROM hearings h JOIN cases c ON c.id = h.case_id WHERE c.office_id = u.office_id
          AND COALESCE(c.responsible_id, c.created_by) = u.id AND h.date BETWEEN date('now') AND date('now', '+30 day')) AS hearings
       FROM users u WHERE u.office_id = ? ORDER BY u.is_ceo DESC, u.name`,
    )
    .all(o) as {
    id: number;
    name: string;
    role: string;
    is_ceo: number;
    open_cases: number;
    petitions_written: number;
    approvals: number;
    open_tasks: number;
    overdue_tasks: number;
    minutes: number;
    hearings: number;
  }[];
  const feed = activityFeed(db, user, 200);
  const lastSeen = new Map<number, string>();
  const actions30 = new Map<number, number>();
  const since = new Date(Date.now() - 30 * 864e5).toISOString().replace('T', ' ').slice(0, 19);
  for (const a of feed) {
    if (!lastSeen.has(a.user_id)) lastSeen.set(a.user_id, a.at);
    if (a.at >= since) actions30.set(a.user_id, (actions30.get(a.user_id) ?? 0) + 1);
  }

  // Aylık eğilim: son 6 ay.
  const ms = months(6);
  const perMonth = (sql: string) => {
    const rows = db.prepare(sql).all(o, ms[0]) as { m: string; n: number }[];
    const map = new Map(rows.map((r) => [r.m, r.n]));
    return ms.map((m) => map.get(m) ?? 0);
  };
  const trend = {
    months: ms,
    cases: perMonth("SELECT substr(created_at, 1, 7) AS m, COUNT(*) AS n FROM cases WHERE office_id = ? AND substr(created_at, 1, 7) >= ? GROUP BY m"),
    petitions: perMonth(
      "SELECT substr(p.created_at, 1, 7) AS m, COUNT(*) AS n FROM petitions p JOIN cases c ON c.id = p.case_id WHERE c.office_id = ? AND substr(p.created_at, 1, 7) >= ? GROUP BY m",
    ),
    contracts: perMonth(
      "SELECT substr(created_at, 1, 7) AS m, COUNT(*) AS n FROM contracts WHERE office_id = ? AND substr(created_at, 1, 7) >= ? GROUP BY m",
    ),
    income: user.can_finance
      ? perMonth(
          "SELECT substr(date, 1, 7) AS m, SUM(amount_kurus) AS n FROM finance_entries WHERE office_id = ? AND kind = 'gelir' AND substr(date, 1, 7) >= ? GROUP BY m",
        )
      : null,
    expense: user.can_finance
      ? perMonth(
          "SELECT substr(date, 1, 7) AS m, SUM(amount_kurus) AS n FROM finance_entries WHERE office_id = ? AND kind IN ('gider', 'masraf') AND substr(date, 1, 7) >= ? GROUP BY m",
        )
      : null,
  };

  const areas = db
    .prepare(
      "SELECT CASE WHEN area = '' THEN 'Belirtilmemiş' ELSE area END AS label, COUNT(*) AS n FROM cases WHERE office_id = ? AND status = 'acik' GROUP BY label ORDER BY n DESC LIMIT 8",
    )
    .all(o)
    .map((r) => {
      const a = r as { label: string; n: number };
      return { label: AREAS.find((x) => x.id === a.label)?.name ?? a.label, n: a.n };
    });
  const petitionStatus = db
    .prepare(
      'SELECT p.status AS label, COUNT(*) AS n FROM petitions p JOIN cases c ON c.id = p.case_id WHERE c.office_id = ? GROUP BY p.status',
    )
    .all(o) as { label: string; n: number }[];

  // Dikkat isteyenler: geciken görevler ve yaklaşan duruşmalar.
  const alerts = db
    .prepare(
      `SELECT 'Geciken görev' AS kind, t.title AS text, a.name AS who, t.due_date AS date FROM tasks t JOIN users a ON a.id = t.assignee_id
        WHERE t.office_id = @o AND t.done = 0 AND t.due_date != '' AND t.due_date < date('now')
       UNION ALL
       SELECT 'Duruşma', c.title || CASE WHEN h.place != '' THEN ' · ' || h.place ELSE '' END, COALESCE(r.name, ''), h.date || CASE WHEN h.time != '' THEN ' ' || h.time ELSE '' END
        FROM hearings h JOIN cases c ON c.id = h.case_id LEFT JOIN users r ON r.id = COALESCE(c.responsible_id, c.created_by)
        WHERE c.office_id = @o AND h.date BETWEEN date('now') AND date('now', '+7 day')
       ORDER BY date LIMIT 12`,
    )
    .all({ o });

  return {
    kpis,
    lawyers: lawyers.map((l) => ({ ...l, actions30: actions30.get(l.id) ?? 0, last_seen: lastSeen.get(l.id) ?? '' })),
    trend,
    areas,
    petitionStatus,
    alerts,
    feed: feed.slice(0, 60),
    financeHidden: !user.can_finance,
  };
}
