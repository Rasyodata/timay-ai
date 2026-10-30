import type { User } from './auth.ts';
import type { DB } from './db.ts';
import { ApiError } from './errors.ts';
import { DATE, optionalDate, toKurus } from './money.ts';

export const RECORD_KINDS = ['gorus', 'gorusme', 'toplanti', 'sozlesme', 'yazisma', 'diger'];
const STATUSES = ['aktif', 'pasif'];
const MONTH = /^\d{4}-\d{2}$/;

interface ClientInput {
  name?: string;
  contact?: string;
  taxNo?: string;
  monthlyFee?: number | string;
  includedHours?: number | string;
  extraHourFee?: number | string;
  startDate?: string;
  endDate?: string;
  status?: string;
  responsibleId?: number | null;
  note?: string;
}

interface ClientRow {
  id: number;
  office_id: number;
  name: string;
  contact: string;
  tax_no: string;
  monthly_fee_kurus: number;
  included_minutes: number;
  extra_hour_kurus: number;
  start_date: string;
  end_date: string;
  status: string;
  responsible_id: number | null;
  note: string;
}

function load(db: DB, user: User, id: number): ClientRow {
  const row = db.prepare('SELECT * FROM consultancy_clients WHERE id = ? AND office_id = ?').get(id, user.office_id) as
    | ClientRow
    | undefined;
  if (!row) throw new ApiError(404, 'Danışmanlık müvekkili bulunamadı.');
  return row;
}

function hoursToMinutes(value: unknown) {
  if (value === undefined || value === null || value === '') return 0;
  const n = Number(String(value).replace(',', '.'));
  if (!Number.isFinite(n) || n < 0) throw new ApiError(400, 'Saat geçerli bir sayı olmalı.');
  return Math.round(n * 60);
}

function officeUser(db: DB, user: User, id: unknown): number | null {
  if (id === undefined || id === null || id === '') return null;
  if (!db.prepare('SELECT 1 FROM users WHERE id = ? AND office_id = ?').get(Number(id), user.office_id)) {
    throw new ApiError(400, 'Sorumlu yalnızca büro çalışanı olabilir.');
  }
  return Number(id);
}

/** Bir ayın ücreti: aylık sabit ücret, pakete dahil saati aşan süre için saat ücreti eklenir. */
export function monthCharge(client: Pick<ClientRow, 'monthly_fee_kurus' | 'included_minutes' | 'extra_hour_kurus'>, minutes: number) {
  const extraMinutes = Math.max(0, minutes - client.included_minutes);
  const extra = Math.round((extraMinutes * client.extra_hour_kurus) / 60);
  return { minutes, extraMinutes, fee: client.monthly_fee_kurus, extra, total: client.monthly_fee_kurus + extra };
}

export function listClients(db: DB, user: User) {
  const month = new Date().toISOString().slice(0, 7);
  const rows = db
    .prepare(
      `SELECT c.*, u.name AS responsible_name,
        (SELECT COALESCE(SUM(minutes), 0) FROM consultancy_records r WHERE r.client_id = c.id AND substr(r.date, 1, 7) = ?) AS month_minutes,
        (SELECT MAX(date) FROM consultancy_records r WHERE r.client_id = c.id) AS last_record
       FROM consultancy_clients c LEFT JOIN users u ON u.id = c.responsible_id
       WHERE c.office_id = ? ORDER BY c.status, c.name`,
    )
    .all(month, user.office_id) as (ClientRow & { month_minutes: number })[];
  return rows.map((r) => ({ ...r, month_charge: monthCharge(r, r.month_minutes).total }));
}

export function createClient(db: DB, user: User, input: ClientInput) {
  if (!input.name?.trim()) throw new ApiError(400, 'Müvekkil adı zorunludur.');
  const r = db
    .prepare(
      `INSERT INTO consultancy_clients (office_id, name, contact, tax_no, monthly_fee_kurus, included_minutes, extra_hour_kurus,
        start_date, end_date, responsible_id, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      user.office_id,
      input.name.trim(),
      input.contact ?? '',
      input.taxNo ?? '',
      toKurus(input.monthlyFee, 'Aylık ücret'),
      hoursToMinutes(input.includedHours),
      toKurus(input.extraHourFee, 'Ek saat ücreti'),
      optionalDate(input.startDate, 'Başlangıç tarihi'),
      optionalDate(input.endDate, 'Bitiş tarihi'),
      officeUser(db, user, input.responsibleId ?? user.id),
      input.note ?? '',
    );
  return getClient(db, user, Number(r.lastInsertRowid));
}

export function updateClient(db: DB, user: User, id: number, input: ClientInput) {
  const c = load(db, user, id);
  if (input.status !== undefined && !STATUSES.includes(input.status)) throw new ApiError(400, 'Geçersiz durum.');
  db.prepare(
    `UPDATE consultancy_clients SET name = ?, contact = ?, tax_no = ?, monthly_fee_kurus = ?, included_minutes = ?,
      extra_hour_kurus = ?, start_date = ?, end_date = ?, status = ?, responsible_id = ?, note = ? WHERE id = ?`,
  ).run(
    input.name?.trim() || c.name,
    input.contact ?? c.contact,
    input.taxNo ?? c.tax_no,
    input.monthlyFee !== undefined ? toKurus(input.monthlyFee, 'Aylık ücret') : c.monthly_fee_kurus,
    input.includedHours !== undefined ? hoursToMinutes(input.includedHours) : c.included_minutes,
    input.extraHourFee !== undefined ? toKurus(input.extraHourFee, 'Ek saat ücreti') : c.extra_hour_kurus,
    input.startDate !== undefined ? optionalDate(input.startDate, 'Başlangıç tarihi') : c.start_date,
    input.endDate !== undefined ? optionalDate(input.endDate, 'Bitiş tarihi') : c.end_date,
    input.status ?? c.status,
    input.responsibleId !== undefined ? officeUser(db, user, input.responsibleId) : c.responsible_id,
    input.note ?? c.note,
    id,
  );
  return getClient(db, user, id);
}

export function getClient(db: DB, user: User, id: number) {
  const c = load(db, user, id);
  const records = db
    .prepare(
      `SELECT r.*, u.name AS user_name FROM consultancy_records r JOIN users u ON u.id = r.user_id
       WHERE r.client_id = ? ORDER BY r.date DESC, r.id DESC`,
    )
    .all(id) as { id: number; date: string; minutes: number }[];
  const invoices = db.prepare('SELECT month, amount_kurus, created_at FROM consultancy_invoices WHERE client_id = ?').all(id) as {
    month: string;
    amount_kurus: number;
  }[];
  const byMonth = new Map<string, number>();
  byMonth.set(new Date().toISOString().slice(0, 7), 0);
  for (const r of records) byMonth.set(r.date.slice(0, 7), (byMonth.get(r.date.slice(0, 7)) ?? 0) + r.minutes);
  const months = [...byMonth.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([month, minutes]) => {
      const invoice = invoices.find((i) => i.month === month);
      return { month, ...monthCharge(c, minutes), invoiced: invoice ? invoice.amount_kurus : null };
    });
  const responsible = c.responsible_id
    ? (db.prepare('SELECT name FROM users WHERE id = ?').get(c.responsible_id) as { name: string } | undefined)
    : undefined;
  return { ...c, responsible_name: responsible?.name ?? '', records, months };
}

export function addRecord(
  db: DB,
  user: User,
  clientId: number,
  input: { date: string; kind?: string; subject: string; hours?: number | string; minutes?: number; note?: string },
) {
  load(db, user, clientId);
  if (!DATE.test(input.date ?? '')) throw new ApiError(400, 'Tarih YYYY-AA-GG biçiminde olmalı.');
  if (!input.subject?.trim()) throw new ApiError(400, 'Konu zorunludur.');
  const kind = input.kind ?? 'gorus';
  if (!RECORD_KINDS.includes(kind)) throw new ApiError(400, 'Geçersiz kayıt türü.');
  const minutes = input.minutes !== undefined ? Math.max(0, Math.round(Number(input.minutes))) : hoursToMinutes(input.hours);
  db.prepare('INSERT INTO consultancy_records (client_id, date, kind, subject, minutes, note, user_id) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
    clientId,
    input.date,
    kind,
    input.subject.trim(),
    minutes,
    input.note ?? '',
    user.id,
  );
  return getClient(db, user, clientId);
}

export function deleteRecord(db: DB, user: User, recordId: number) {
  const row = db
    .prepare(
      `SELECT r.client_id, r.date FROM consultancy_records r JOIN consultancy_clients c ON c.id = r.client_id
       WHERE r.id = ? AND c.office_id = ?`,
    )
    .get(recordId, user.office_id) as { client_id: number; date: string } | undefined;
  if (!row) throw new ApiError(404, 'Kayıt bulunamadı.');
  if (db.prepare('SELECT 1 FROM consultancy_invoices WHERE client_id = ? AND month = ?').get(row.client_id, row.date.slice(0, 7))) {
    throw new ApiError(400, 'Bu ay faturalandı; kaydı silemezsiniz.');
  }
  db.prepare('DELETE FROM consultancy_records WHERE id = ?').run(recordId);
  return getClient(db, user, row.client_id);
}

/** Ayın ücretini muhasebeye gelir olarak işler; aynı ay iki kez faturalanamaz. */
export function invoiceMonth(db: DB, user: User, clientId: number, input: { month: string; vatRate?: number; withholdingRate?: number }) {
  const c = load(db, user, clientId);
  if (!MONTH.test(input.month ?? '')) throw new ApiError(400, 'Ay YYYY-AA biçiminde olmalı.');
  if (db.prepare('SELECT 1 FROM consultancy_invoices WHERE client_id = ? AND month = ?').get(clientId, input.month)) {
    throw new ApiError(400, 'Bu ay zaten faturalandı.');
  }
  const { minutes } = db
    .prepare("SELECT COALESCE(SUM(minutes), 0) AS minutes FROM consultancy_records WHERE client_id = ? AND substr(date, 1, 7) = ?")
    .get(clientId, input.month) as { minutes: number };
  const charge = monthCharge(c, minutes);
  if (charge.total <= 0) throw new ApiError(400, 'Faturalanacak tutar yok.');
  const lastDay = new Date(Date.UTC(Number(input.month.slice(0, 4)), Number(input.month.slice(5, 7)), 0)).toISOString().slice(0, 10);
  const hours = (minutes / 60).toLocaleString('tr-TR', { maximumFractionDigits: 1 });
  db.transaction(() => {
    const entry = db
      .prepare(
        `INSERT INTO finance_entries (office_id, kind, category, description, client, amount_kurus, vat_rate, withholding_rate, date, created_by)
         VALUES (?, 'gelir', 'Danışmanlık ücreti', ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        user.office_id,
        `${input.month} danışmanlık (${hours} saat)`,
        c.name,
        charge.total,
        Number(input.vatRate ?? 20),
        Number(input.withholdingRate ?? 20),
        lastDay,
        user.id,
      );
    db.prepare('INSERT INTO consultancy_invoices (client_id, month, amount_kurus, finance_entry_id) VALUES (?, ?, ?, ?)').run(
      clientId,
      input.month,
      charge.total,
      Number(entry.lastInsertRowid),
    );
  })();
  return getClient(db, user, clientId);
}
