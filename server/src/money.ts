import type { DB } from './db.ts';
import { ApiError } from './errors.ts';

/** TL tutarını (sayı ya da "1.234,56" metni) kuruşa çevirir. */
export function toKurus(value: unknown, field = 'Tutar'): number {
  if (value === undefined || value === null || value === '') return 0;
  const n =
    typeof value === 'number' ? value : Number(String(value).trim().replace(/\./g, '').replace(',', '.'));
  if (!Number.isFinite(n) || n < 0) throw new ApiError(400, `${field} geçerli bir sayı olmalı.`);
  return Math.round(n * 100);
}

export const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function optionalDate(value: unknown, field: string): string {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value !== 'string' || !DATE.test(value)) throw new ApiError(400, `${field} YYYY-AA-GG biçiminde olmalı.`);
  return value;
}

/** Dosya numarası verildiyse büroya ait olduğunu doğrular. */
export function ownedCaseId(db: DB, officeId: number, caseId: unknown): number | null {
  if (caseId === undefined || caseId === null || caseId === '') return null;
  const id = Number(caseId);
  if (!db.prepare('SELECT 1 FROM cases WHERE id = ? AND office_id = ?').get(id, officeId)) {
    throw new ApiError(404, 'Dava dosyası bulunamadı.');
  }
  return id;
}
