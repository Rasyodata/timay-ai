import type { User } from './auth.ts';
import type { DB } from './db.ts';
import { ApiError } from './errors.ts';
import { buildReport, runDeepCheck, type DeepChecker } from './teyit.ts';

// Karşı taraf dilekçeleri tek sürümlüdür; teyit hep 1. sürüm üzerinden yapılır.
const VERSION = 1;

interface OpposingDocument {
  id: number;
  case_id: number;
  title: string;
  body: string;
  created_at: string;
  facts: string;
}

function load(db: DB, user: User, id: number): OpposingDocument {
  const doc = db
    .prepare(
      `SELECT o.id, o.case_id, o.title, o.body, o.created_at, c.facts FROM opposing_documents o
       JOIN cases c ON c.id = o.case_id WHERE o.id = ? AND c.office_id = ?`,
    )
    .get(id, user.office_id) as OpposingDocument | undefined;
  if (!doc) throw new ApiError(404, 'Karşı taraf dilekçesi bulunamadı.');
  return doc;
}

export function listOpposing(db: DB, user: User, caseId: number) {
  return db
    .prepare(
      `SELECT o.id, o.title, o.created_at FROM opposing_documents o JOIN cases c ON c.id = o.case_id
       WHERE o.case_id = ? AND c.office_id = ? ORDER BY o.id DESC`,
    )
    .all(caseId, user.office_id);
}

export function createOpposing(db: DB, user: User, caseId: number, input: { title: string; body: string }) {
  const owned = db.prepare('SELECT 1 FROM cases WHERE id = ? AND office_id = ?').get(caseId, user.office_id);
  if (!owned) throw new ApiError(404, 'Dava dosyası bulunamadı.');
  if (!input.title?.trim()) throw new ApiError(400, 'Başlık zorunludur.');
  if (!input.body?.trim()) throw new ApiError(400, 'Dilekçe metni boş.');
  const result = db
    .prepare('INSERT INTO opposing_documents (case_id, title, body, created_by) VALUES (?, ?, ?, ?)')
    .run(caseId, input.title.trim(), input.body, user.id);
  return getOpposing(db, user, Number(result.lastInsertRowid));
}

export function getOpposing(db: DB, user: User, id: number) {
  const { facts: _facts, ...doc } = load(db, user, id);
  return { ...doc, teyit: buildReport(db, { type: 'opposing', id, version: VERSION }, doc.body) };
}

export async function deepCheckOpposing(db: DB, user: User, id: number, checker: DeepChecker | null) {
  const doc = load(db, user, id);
  await runDeepCheck(db, checker, { type: 'opposing', id, version: VERSION }, doc.body, doc.facts, user.id);
  return getOpposing(db, user, id);
}
