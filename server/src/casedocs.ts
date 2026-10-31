import type { User } from './auth.ts';
import { assertCaseVisible } from './cases.ts';
import type { DB } from './db.ts';
import { ApiError } from './errors.ts';

/*
 * Dava dosyasına eklenen belgeler: UYAP (.udf), PDF, Word, TIF ve resimler (JPG, PNG, BMP).
 * Asıl dosya saklanır; okunabilen ya da resimden okunan (OCR) metin aranabilsin diye ayrıca tutulur.
 */

const MAX_BYTES = 15 * 1024 * 1024;

export const DOC_KINDS = ['dilekce', 'karar', 'bilirkisi', 'tutanak', 'sozlesme', 'delil', 'diger'] as const;

interface CaseDocumentRow {
  id: number;
  case_id: number;
  title: string;
  kind: string;
  file_name: string;
  mime_type: string;
  size: number;
  text: string;
  ocr: number;
  created_by_name: string;
  created_at: string;
}

const COLUMNS = `d.id, d.case_id, d.title, d.kind, d.file_name, d.mime_type, d.size, d.ocr, d.created_at, u.name AS created_by_name`;

export function listCaseDocuments(db: DB, user: User, caseId: number) {
  assertCaseVisible(db, user, caseId);
  return db
    .prepare(
      `SELECT ${COLUMNS}, length(d.text) AS text_length FROM case_documents d JOIN users u ON u.id = d.created_by
       WHERE d.case_id = ? ORDER BY d.id DESC`,
    )
    .all(caseId);
}

function load(db: DB, user: User, id: number) {
  const row = db.prepare('SELECT case_id FROM case_documents d WHERE d.id = ? AND d.office_id = ?').get(id, user.office_id) as
    | { case_id: number }
    | undefined;
  if (!row) throw new ApiError(404, 'Belge bulunamadı.');
  assertCaseVisible(db, user, row.case_id);
  return row;
}

export function addCaseDocument(
  db: DB,
  user: User,
  caseId: number,
  input: { title?: string; kind?: string; fileName?: string; mimeType?: string; fileBase64?: string; text?: string; ocr?: boolean },
) {
  assertCaseVisible(db, user, caseId);
  const fileName = String(input.fileName ?? '').trim().slice(0, 200);
  if (!fileName) throw new ApiError(400, 'Dosya adı gerekli.');
  const data = Buffer.from(String(input.fileBase64 ?? ''), 'base64');
  if (!data.length) throw new ApiError(400, 'Dosya boş.');
  if (data.length > MAX_BYTES) throw new ApiError(413, 'Dosya 15 MB’tan büyük olamaz.');
  const kind = DOC_KINDS.includes(input.kind as never) ? String(input.kind) : 'diger';
  const title = (input.title?.trim() || fileName.replace(/\.[^.]+$/, '')).slice(0, 200);
  const r = db
    .prepare(
      `INSERT INTO case_documents (office_id, case_id, title, kind, file_name, mime_type, size, data, text, ocr, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      user.office_id,
      caseId,
      title,
      kind,
      fileName,
      String(input.mimeType ?? '').slice(0, 100) || 'application/octet-stream',
      data.length,
      data,
      String(input.text ?? '').replace(/\r/g, '').trim(),
      input.ocr ? 1 : 0,
      user.id,
    );
  return getCaseDocument(db, user, Number(r.lastInsertRowid));
}

export function getCaseDocument(db: DB, user: User, id: number, withFile = false) {
  load(db, user, id);
  const row = db
    .prepare(`SELECT ${COLUMNS}, d.text${withFile ? ', d.data' : ''} FROM case_documents d JOIN users u ON u.id = d.created_by WHERE d.id = ?`)
    .get(id) as CaseDocumentRow & { data?: Buffer };
  const { data, ...rest } = row;
  return data ? { ...rest, fileBase64: data.toString('base64') } : rest;
}

export function updateCaseDocument(db: DB, user: User, id: number, input: { title?: string; kind?: string; text?: string }) {
  load(db, user, id);
  const cur = db.prepare('SELECT title, kind, text FROM case_documents WHERE id = ?').get(id) as { title: string; kind: string; text: string };
  db.prepare('UPDATE case_documents SET title = ?, kind = ?, text = ? WHERE id = ?').run(
    input.title?.trim() ? input.title.trim().slice(0, 200) : cur.title,
    DOC_KINDS.includes(input.kind as never) ? input.kind : cur.kind,
    input.text !== undefined ? String(input.text).replace(/\r/g, '').trim() : cur.text,
    id,
  );
  return getCaseDocument(db, user, id);
}

export function deleteCaseDocument(db: DB, user: User, id: number) {
  load(db, user, id);
  db.prepare('DELETE FROM case_documents WHERE id = ?').run(id);
  return { ok: true };
}
