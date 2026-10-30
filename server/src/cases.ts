import type { User } from './auth.ts';
import type { DB } from './db.ts';
import { ApiError } from './errors.ts';

export interface CaseInput {
  title: string;
  court?: string;
  esasNo?: string;
  parties?: string;
  facts?: string;
  area?: string;
  client?: string;
  status?: 'acik' | 'kapali';
}

export function createCase(db: DB, user: User, input: CaseInput) {
  if (!input.title?.trim()) throw new ApiError(400, 'Dava başlığı zorunludur.');
  const result = db
    .prepare(
      'INSERT INTO cases (office_id, title, court, esas_no, parties, facts, area, client, responsible_id, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    )
    .run(
      user.office_id,
      input.title.trim(),
      input.court ?? '',
      input.esasNo ?? '',
      input.parties ?? '',
      input.facts ?? '',
      input.area ?? '',
      input.client ?? '',
      user.id,
      user.id,
    );
  return getCase(db, user, Number(result.lastInsertRowid));
}

export function updateCase(db: DB, user: User, id: number, input: CaseInput) {
  const current = getCase(db, user, id);
  if (input.status && input.status !== 'acik' && input.status !== 'kapali') {
    throw new ApiError(400, 'Geçersiz dosya durumu.');
  }
  db.prepare(
    'UPDATE cases SET title = ?, court = ?, esas_no = ?, parties = ?, facts = ?, area = ?, client = ?, status = ? WHERE id = ?',
  ).run(
    input.title?.trim() || current.title,
    input.court ?? current.court,
    input.esasNo ?? current.esas_no,
    input.parties ?? current.parties,
    input.facts ?? current.facts,
    input.area ?? current.area,
    input.client ?? current.client,
    input.status ?? current.status,
    id,
  );
  return getCase(db, user, id);
}

/**
 * Yalnız kendi dosyalarını görebilen kullanıcı için ek koşul: sorumlusu olduğu, açtığı
 * ya da kendisine görev verilmiş dosyalar.
 */
export function caseVisibility(user: User, alias = 'c') {
  if (user.all_cases) return { sql: '', params: [] as unknown[] };
  return {
    sql: ` AND (${alias}.responsible_id = ? OR ${alias}.created_by = ? OR EXISTS (SELECT 1 FROM tasks t WHERE t.case_id = ${alias}.id AND t.assignee_id = ?))`,
    params: [user.id, user.id, user.id] as unknown[],
  };
}

export function assertCaseVisible(db: DB, user: User, caseId: number) {
  const v = caseVisibility(user);
  if (!db.prepare(`SELECT 1 FROM cases c WHERE c.id = ? AND c.office_id = ?${v.sql}`).get(caseId, user.office_id, ...v.params)) {
    throw new ApiError(404, 'Dava dosyası bulunamadı.');
  }
}

export function getCase(db: DB, user: User, id: number) {
  assertCaseVisible(db, user, id);
  const row = db.prepare('SELECT * FROM cases WHERE id = ? AND office_id = ?').get(id, user.office_id) as
    | {
        id: number;
        title: string;
        court: string;
        esas_no: string;
        parties: string;
        facts: string;
        area: string;
        client: string;
        status: 'acik' | 'kapali';
        responsible_id: number | null;
      }
    | undefined;
  if (!row) throw new ApiError(404, 'Dava dosyası bulunamadı.');
  const hearings = db.prepare('SELECT * FROM hearings WHERE case_id = ? ORDER BY date, time').all(id);
  const responsible = row.responsible_id
    ? (db.prepare('SELECT name FROM users WHERE id = ?').get(row.responsible_id) as { name: string } | undefined)
    : undefined;
  return { ...row, responsible_name: responsible?.name ?? '', hearings };
}

export function listCases(db: DB, user: User) {
  const v = caseVisibility(user);
  return db
    .prepare(
      `SELECT c.id, c.title, c.court, c.esas_no, c.area, c.client, c.status, c.created_at,
        (SELECT MIN(h.date) FROM hearings h WHERE h.case_id = c.id AND h.date >= date('now')) AS next_hearing,
        (SELECT COUNT(*) FROM petitions p WHERE p.case_id = c.id) AS petition_count,
        u.name AS responsible_name
       FROM cases c LEFT JOIN users u ON u.id = c.responsible_id WHERE c.office_id = ?${v.sql} ORDER BY c.id DESC`,
    )
    .all(user.office_id, ...v.params);
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function addHearing(
  db: DB,
  user: User,
  caseId: number,
  input: { date: string; time?: string; place?: string; note?: string },
) {
  getCase(db, user, caseId);
  if (!DATE.test(input.date ?? '')) throw new ApiError(400, 'Duruşma tarihi YYYY-AA-GG biçiminde olmalı.');
  db.prepare('INSERT INTO hearings (case_id, date, time, place, note, created_by) VALUES (?, ?, ?, ?, ?, ?)').run(
    caseId,
    input.date,
    input.time ?? '',
    input.place ?? '',
    input.note ?? '',
    user.id,
  );
  return getCase(db, user, caseId);
}

export function deleteHearing(db: DB, user: User, hearingId: number) {
  const row = db
    .prepare('SELECT h.case_id FROM hearings h JOIN cases c ON c.id = h.case_id WHERE h.id = ? AND c.office_id = ?')
    .get(hearingId, user.office_id) as { case_id: number } | undefined;
  if (!row) throw new ApiError(404, 'Duruşma bulunamadı.');
  db.prepare('DELETE FROM hearings WHERE id = ?').run(hearingId);
  return getCase(db, user, row.case_id);
}

export function listHearings(db: DB, user: User) {
  return db
    .prepare(
      `SELECT h.*, c.title AS case_title, c.court AS case_court, c.esas_no AS case_esas_no
       FROM hearings h JOIN cases c ON c.id = h.case_id
       WHERE c.office_id = ? AND h.date >= date('now', '-30 day') ORDER BY h.date, h.time`,
    )
    .all(user.office_id);
}

/** Dosyayı başka bir avukata devreder. Yalnızca avukatlar devredebilir. */
export function transferCase(db: DB, user: User, caseId: number, input: { userId: number }) {
  getCase(db, user, caseId);
  if (user.role !== 'avukat') throw new ApiError(403, 'Dosyayı yalnızca avukatlar devredebilir.');
  const target = db
    .prepare("SELECT id FROM users WHERE id = ? AND office_id = ? AND role = 'avukat'")
    .get(input.userId, user.office_id);
  if (!target) throw new ApiError(400, 'Dosya yalnızca bürodaki bir avukata devredilebilir.');
  db.prepare('UPDATE cases SET responsible_id = ? WHERE id = ?').run(input.userId, caseId);
  return getCase(db, user, caseId);
}
