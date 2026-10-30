import type { User } from './auth.ts';
import type { DB } from './db.ts';
import { ApiError } from './errors.ts';

export interface CaseInput {
  title: string;
  court?: string;
  esasNo?: string;
  parties?: string;
  facts?: string;
}

export function createCase(db: DB, user: User, input: CaseInput) {
  if (!input.title?.trim()) throw new ApiError(400, 'Dava başlığı zorunludur.');
  const result = db
    .prepare(
      'INSERT INTO cases (office_id, title, court, esas_no, parties, facts, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)',
    )
    .run(
      user.office_id,
      input.title.trim(),
      input.court ?? '',
      input.esasNo ?? '',
      input.parties ?? '',
      input.facts ?? '',
      user.id,
    );
  return getCase(db, user, Number(result.lastInsertRowid));
}

export function updateCase(db: DB, user: User, id: number, input: CaseInput) {
  const current = getCase(db, user, id);
  db.prepare('UPDATE cases SET title = ?, court = ?, esas_no = ?, parties = ?, facts = ? WHERE id = ?').run(
    input.title?.trim() || current.title,
    input.court ?? current.court,
    input.esasNo ?? current.esas_no,
    input.parties ?? current.parties,
    input.facts ?? current.facts,
    id,
  );
  return getCase(db, user, id);
}

export function getCase(db: DB, user: User, id: number) {
  const row = db.prepare('SELECT * FROM cases WHERE id = ? AND office_id = ?').get(id, user.office_id) as
    | { id: number; title: string; court: string; esas_no: string; parties: string; facts: string }
    | undefined;
  if (!row) throw new ApiError(404, 'Dava dosyası bulunamadı.');
  return row;
}

export function listCases(db: DB, user: User) {
  return db
    .prepare('SELECT id, title, court, esas_no, created_at FROM cases WHERE office_id = ? ORDER BY id DESC')
    .all(user.office_id);
}
