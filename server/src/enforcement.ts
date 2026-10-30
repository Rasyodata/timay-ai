import type { User } from './auth.ts';
import type { DB } from './db.ts';
import { ApiError } from './errors.ts';
import { DATE, optionalDate, ownedCaseId, toKurus } from './money.ts';

export const ENFORCEMENT_KINDS = ['ilamsiz', 'ilamli', 'kambiyo', 'rehin', 'tahliye'];
export const ENFORCEMENT_STATUSES = ['derdest', 'itiraz', 'haciz', 'satis', 'tahsil', 'kapandi'];

interface FileInput {
  officeName?: string;
  fileNo?: string;
  kind?: string;
  creditor?: string;
  debtor?: string;
  principal?: number | string;
  interestRate?: number;
  startDate?: string;
  status?: string;
  note?: string;
  caseId?: number | null;
}

interface FileRow {
  id: number;
  office_name: string;
  file_no: string;
  kind: string;
  creditor: string;
  debtor: string;
  principal_kurus: number;
  interest_rate: number;
  start_date: string;
  status: string;
  note: string;
  case_id: number | null;
}

function load(db: DB, user: User, id: number): FileRow {
  const row = db.prepare('SELECT * FROM enforcement_files WHERE id = ? AND office_id = ?').get(id, user.office_id) as
    | FileRow
    | undefined;
  if (!row) throw new ApiError(404, 'İcra dosyası bulunamadı.');
  return row;
}

function check(input: FileInput) {
  if (input.kind !== undefined && !ENFORCEMENT_KINDS.includes(input.kind)) throw new ApiError(400, 'Geçersiz takip türü.');
  if (input.status !== undefined && !ENFORCEMENT_STATUSES.includes(input.status)) throw new ApiError(400, 'Geçersiz durum.');
  const rate = Number(input.interestRate ?? 0);
  if (!Number.isFinite(rate) || rate < 0) throw new ApiError(400, 'Faiz oranı geçerli değil.');
}

/** Basit faiz: anapara × yıllık oran × gün / 365. */
export function simpleInterest(principalKurus: number, annualRate: number, fromDate: string, toDate: string) {
  if (!fromDate || !annualRate) return 0;
  const days = Math.max(0, Math.floor((Date.parse(toDate) - Date.parse(fromDate)) / 86_400_000));
  return Math.round((principalKurus * annualRate * days) / 36_500);
}

function withTotals(db: DB, f: FileRow) {
  const collected = (
    db
      .prepare("SELECT COALESCE(SUM(amount_kurus), 0) AS s FROM enforcement_actions WHERE file_id = ? AND action = 'tahsilat'")
      .get(f.id) as { s: number }
  ).s;
  const today = new Date().toISOString().slice(0, 10);
  const interest = simpleInterest(f.principal_kurus, f.interest_rate, f.start_date, today);
  return { ...f, collected_kurus: collected, interest_kurus: interest, remaining_kurus: f.principal_kurus + interest - collected };
}

export function listFiles(db: DB, user: User) {
  const rows = db.prepare('SELECT * FROM enforcement_files WHERE office_id = ? ORDER BY id DESC').all(user.office_id) as FileRow[];
  return rows.map((r) => withTotals(db, r));
}

export function createFile(db: DB, user: User, input: FileInput) {
  check(input);
  if (!input.debtor?.trim()) throw new ApiError(400, 'Borçlu adı zorunludur.');
  const result = db
    .prepare(
      `INSERT INTO enforcement_files (office_id, case_id, office_name, file_no, kind, creditor, debtor, principal_kurus, interest_rate, start_date, status, note, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      user.office_id,
      ownedCaseId(db, user.office_id, input.caseId),
      input.officeName ?? '',
      input.fileNo ?? '',
      input.kind ?? 'ilamsiz',
      input.creditor ?? '',
      input.debtor.trim(),
      toKurus(input.principal, 'Asıl alacak'),
      Number(input.interestRate ?? 0),
      optionalDate(input.startDate, 'Takip tarihi'),
      input.status ?? 'derdest',
      input.note ?? '',
      user.id,
    );
  return getFile(db, user, Number(result.lastInsertRowid));
}

export function updateFile(db: DB, user: User, id: number, input: FileInput) {
  const f = load(db, user, id);
  check(input);
  db.prepare(
    `UPDATE enforcement_files SET office_name = ?, file_no = ?, kind = ?, creditor = ?, debtor = ?, principal_kurus = ?,
     interest_rate = ?, start_date = ?, status = ?, note = ? WHERE id = ?`,
  ).run(
    input.officeName ?? f.office_name,
    input.fileNo ?? f.file_no,
    input.kind ?? f.kind,
    input.creditor ?? f.creditor,
    input.debtor ?? f.debtor,
    input.principal !== undefined ? toKurus(input.principal, 'Asıl alacak') : f.principal_kurus,
    input.interestRate !== undefined ? Number(input.interestRate) : f.interest_rate,
    input.startDate !== undefined ? optionalDate(input.startDate, 'Takip tarihi') : f.start_date,
    input.status ?? f.status,
    input.note ?? f.note,
    id,
  );
  return getFile(db, user, id);
}

export function getFile(db: DB, user: User, id: number) {
  const f = load(db, user, id);
  const actions = db
    .prepare(
      `SELECT a.*, u.name AS created_by_name FROM enforcement_actions a JOIN users u ON u.id = a.created_by
       WHERE a.file_id = ? ORDER BY a.date DESC, a.id DESC`,
    )
    .all(id);
  return { ...withTotals(db, f), actions };
}

export function addAction(
  db: DB,
  user: User,
  fileId: number,
  input: { date: string; action: string; amount?: number | string; note?: string },
) {
  load(db, user, fileId);
  if (!DATE.test(input.date ?? '')) throw new ApiError(400, 'Tarih YYYY-AA-GG biçiminde olmalı.');
  if (!input.action?.trim()) throw new ApiError(400, 'İşlem türü zorunludur.');
  db.prepare('INSERT INTO enforcement_actions (file_id, date, action, amount_kurus, note, created_by) VALUES (?, ?, ?, ?, ?, ?)').run(
    fileId,
    input.date,
    input.action.trim(),
    toKurus(input.amount),
    input.note ?? '',
    user.id,
  );
  return getFile(db, user, fileId);
}
