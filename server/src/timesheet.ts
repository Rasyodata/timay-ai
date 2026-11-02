import { requireFinance, type User } from './auth.ts';
import { assertCaseVisible } from './cases.ts';
import type { DB } from './db.ts';
import { ApiError } from './errors.ts';
import { DATE, toKurus } from './money.ts';

/*
 * Zaman takibi: avukat dosyaya harcadığı süreyi kronometreyle ya da elle girer.
 * Saat ücretli kayıtlar seçilip tek tıkla muhasebeye gelir olarak aktarılır (faturalandırma).
 */

interface EntryRow {
  id: number;
  user_id: number;
  user_name: string;
  case_id: number | null;
  case_title: string | null;
  client: string;
  date: string;
  minutes: number;
  description: string;
  rate_kurus: number;
  billable: number;
  running_since: string;
  finance_entry_id: number | null;
}

const SELECT = `SELECT e.id, e.user_id, u.name AS user_name, e.case_id, c.title AS case_title, e.client, e.date, e.minutes, e.description,
  e.rate_kurus, e.billable, e.running_since, e.finance_entry_id
  FROM time_entries e JOIN users u ON u.id = e.user_id LEFT JOIN cases c ON c.id = e.case_id`;

/** Kaydın tutarı (kuruş): dakika × saat ücreti / 60. */
export function amountOf(minutes: number, rateKurus: number) {
  return Math.round((minutes * rateKurus) / 60);
}

function nowIso(now = new Date()) {
  return now.toISOString().slice(0, 19).replace('T', ' ');
}

/** Çalışan kronometrenin şu ana kadarki dakikası (en az 1). */
function elapsed(since: string, now = new Date()) {
  const ms = now.getTime() - Date.parse(`${since.replace(' ', 'T')}Z`);
  return Math.max(1, Math.round(ms / 60_000));
}

function shape(r: EntryRow) {
  const minutes = r.running_since ? r.minutes + elapsed(r.running_since) : r.minutes;
  return {
    ...r,
    billable: Boolean(r.billable),
    running: Boolean(r.running_since),
    live_minutes: minutes,
    amount_kurus: r.billable ? amountOf(minutes, r.rate_kurus) : 0,
    invoiced: r.finance_entry_id !== null,
  };
}

function load(db: DB, user: User, id: number) {
  const row = db.prepare(`${SELECT} WHERE e.id = ? AND e.office_id = ?`).get(id, user.office_id) as EntryRow | undefined;
  if (!row) throw new ApiError(404, 'Zaman kaydı bulunamadı.');
  return row;
}

/** Yalnızca kaydın sahibi ya da yönetici değiştirebilir. */
function own(db: DB, user: User, id: number) {
  const row = load(db, user, id);
  if (row.user_id !== user.id && !user.is_admin) throw new ApiError(403, 'Bu zaman kaydı başka bir çalışana ait.');
  if (row.finance_entry_id !== null) throw new ApiError(400, 'Faturalanmış kayıt değiştirilemez; önce muhasebedeki kaydı silin.');
  return row;
}

export function listEntries(db: DB, user: User, query: { userId?: string; caseId?: string; from?: string; to?: string; open?: string } = {}) {
  const where = ['e.office_id = ?'];
  const params: unknown[] = [user.office_id];
  // Muhasebe yetkisi olmayan çalışan yalnızca kendi kayıtlarını görür.
  if (!user.can_finance) {
    where.push('e.user_id = ?');
    params.push(user.id);
  } else if (query.userId) {
    where.push('e.user_id = ?');
    params.push(Number(query.userId));
  }
  if (query.caseId) {
    assertCaseVisible(db, user, Number(query.caseId));
    where.push('e.case_id = ?');
    params.push(Number(query.caseId));
  }
  if (query.from && DATE.test(query.from)) {
    where.push('e.date >= ?');
    params.push(query.from);
  }
  if (query.to && DATE.test(query.to)) {
    where.push('e.date <= ?');
    params.push(query.to);
  }
  if (query.open === '1') where.push('e.finance_entry_id IS NULL');
  const rows = (db.prepare(`${SELECT} WHERE ${where.join(' AND ')} ORDER BY e.date DESC, e.id DESC LIMIT 1000`).all(...params) as EntryRow[]).map(shape);
  const sum = (f: (r: (typeof rows)[number]) => boolean) => rows.filter(f).reduce((a, r) => a + r.live_minutes, 0);
  return {
    items: rows,
    running: rows.find((r) => r.running && r.user_id === user.id) ?? null,
    totals: {
      minutes: sum(() => true),
      billableMinutes: sum((r) => r.billable),
      openAmountKurus: rows.filter((r) => r.billable && !r.invoiced).reduce((a, r) => a + r.amount_kurus, 0),
      invoicedAmountKurus: rows.filter((r) => r.invoiced).reduce((a, r) => a + r.amount_kurus, 0),
    },
  };
}

export interface EntryInput {
  caseId?: number | null;
  client?: string;
  date?: string;
  minutes?: number | string;
  hours?: number | string;
  description?: string;
  rate?: number | string;
  billable?: boolean;
}

function minutesOf(input: EntryInput) {
  if (input.minutes !== undefined && input.minutes !== '') {
    const m = Number(input.minutes);
    if (!Number.isFinite(m) || m < 0) throw new ApiError(400, 'Süre geçerli bir dakika olmalı.');
    return Math.round(m);
  }
  if (input.hours !== undefined && input.hours !== '') {
    const h = Number(String(input.hours).replace(',', '.'));
    if (!Number.isFinite(h) || h < 0) throw new ApiError(400, 'Süre geçerli bir saat olmalı.');
    return Math.round(h * 60);
  }
  return 0;
}

function caseOf(db: DB, user: User, caseId: unknown) {
  if (!caseId) return null;
  assertCaseVisible(db, user, Number(caseId));
  return Number(caseId);
}

function clientOf(db: DB, caseId: number | null, client: unknown) {
  const c = String(client ?? '').trim();
  if (c || !caseId) return c;
  return (db.prepare('SELECT client FROM cases WHERE id = ?').get(caseId) as { client: string }).client;
}

export function addEntry(db: DB, user: User, input: EntryInput) {
  const minutes = minutesOf(input);
  if (minutes <= 0) throw new ApiError(400, 'Harcanan süreyi girin.');
  if (minutes > 24 * 60) throw new ApiError(400, 'Bir kayıt 24 saatten uzun olamaz.');
  const date = input.date || new Date().toISOString().slice(0, 10);
  if (!DATE.test(date)) throw new ApiError(400, 'Tarih YYYY-AA-GG biçiminde olmalı.');
  const description = String(input.description ?? '').trim();
  if (!description) throw new ApiError(400, 'Yapılan işi kısaca yazın.');
  const caseId = caseOf(db, user, input.caseId);
  const r = db
    .prepare(
      `INSERT INTO time_entries (office_id, user_id, case_id, client, date, minutes, description, rate_kurus, billable)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(user.office_id, user.id, caseId, clientOf(db, caseId, input.client), date, minutes, description, toKurus(input.rate, 'Saat ücreti'), input.billable === false ? 0 : 1);
  return shape(load(db, user, Number(r.lastInsertRowid)));
}

/** Kronometreyi başlatır. Kullanıcının çalışan kronometresi varsa önce durdurulur. */
export function startTimer(db: DB, user: User, input: EntryInput, now = new Date()) {
  const running = db.prepare("SELECT id FROM time_entries WHERE user_id = ? AND running_since != ''").get(user.id) as { id: number } | undefined;
  if (running) stopTimer(db, user, running.id, now);
  const caseId = caseOf(db, user, input.caseId);
  const r = db
    .prepare(
      `INSERT INTO time_entries (office_id, user_id, case_id, client, date, minutes, description, rate_kurus, billable, running_since)
       VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?)`,
    )
    .run(
      user.office_id,
      user.id,
      caseId,
      clientOf(db, caseId, input.client),
      now.toISOString().slice(0, 10),
      String(input.description ?? '').trim(),
      toKurus(input.rate, 'Saat ücreti'),
      input.billable === false ? 0 : 1,
      nowIso(now),
    );
  return shape(load(db, user, Number(r.lastInsertRowid)));
}

export function stopTimer(db: DB, user: User, id: number, now = new Date()) {
  const row = own(db, user, id);
  if (!row.running_since) throw new ApiError(400, 'Kronometre zaten durmuş.');
  const minutes = Math.min(row.minutes + elapsed(row.running_since, now), 24 * 60);
  db.prepare("UPDATE time_entries SET minutes = ?, running_since = '', description = ? WHERE id = ?").run(
    minutes,
    row.description || 'Dosya çalışması',
    id,
  );
  return shape(load(db, user, id));
}

export function updateEntry(db: DB, user: User, id: number, input: EntryInput) {
  const row = own(db, user, id);
  const minutes = input.minutes !== undefined || input.hours !== undefined ? minutesOf(input) : row.minutes;
  if (!row.running_since && minutes <= 0) throw new ApiError(400, 'Harcanan süreyi girin.');
  const date = input.date ?? row.date;
  if (!DATE.test(date)) throw new ApiError(400, 'Tarih YYYY-AA-GG biçiminde olmalı.');
  const caseId = input.caseId !== undefined ? caseOf(db, user, input.caseId) : row.case_id;
  db.prepare('UPDATE time_entries SET case_id = ?, client = ?, date = ?, minutes = ?, description = ?, rate_kurus = ?, billable = ? WHERE id = ?').run(
    caseId,
    input.client !== undefined ? clientOf(db, caseId, input.client) : row.client,
    date,
    minutes,
    input.description !== undefined ? String(input.description).trim() : row.description,
    input.rate !== undefined ? toKurus(input.rate, 'Saat ücreti') : row.rate_kurus,
    input.billable !== undefined ? (input.billable ? 1 : 0) : row.billable,
    id,
  );
  return shape(load(db, user, id));
}

export function deleteEntry(db: DB, user: User, id: number) {
  own(db, user, id);
  db.prepare('DELETE FROM time_entries WHERE id = ?').run(id);
  return { ok: true };
}

/**
 * Seçilen saat ücretli kayıtları muhasebeye tek bir gelir kaydı olarak aktarır.
 * Kayıtlar aynı dosyaya ya da aynı müvekkile ait olmalı; aktarılan kayıt kilitlenir.
 */
export function invoiceEntries(db: DB, user: User, input: { ids?: number[]; date?: string; vatRate?: number; withholdingRate?: number }) {
  requireFinance(user);
  const ids = [...new Set((input.ids ?? []).map(Number))];
  if (ids.length === 0) throw new ApiError(400, 'Faturalanacak kayıtları seçin.');
  const rows = ids.map((i) => load(db, user, i));
  if (rows.some((r) => r.finance_entry_id !== null)) throw new ApiError(400, 'Seçilenlerden biri zaten faturalanmış.');
  if (rows.some((r) => r.running_since)) throw new ApiError(400, 'Çalışan kronometreyi önce durdurun.');
  if (rows.some((r) => !r.billable)) throw new ApiError(400, 'Ücretsiz (faturalanmaz) kayıtlar aktarılamaz.');
  const cases = new Set(rows.map((r) => r.case_id ?? 0));
  const clients = new Set(rows.map((r) => r.client.trim().toLocaleLowerCase('tr')));
  const sameCase = cases.size === 1 && rows[0].case_id !== null;
  const sameClient = clients.size === 1;
  if (!sameCase && !sameClient) throw new ApiError(400, 'Aynı dosyaya ya da aynı müvekkile ait kayıtları seçin.');
  const total = rows.reduce((a, r) => a + amountOf(r.minutes, r.rate_kurus), 0);
  if (total <= 0) throw new ApiError(400, 'Seçilen kayıtlarda saat ücreti yok; önce saat ücretini girin.');
  const minutes = rows.reduce((a, r) => a + r.minutes, 0);
  const date = input.date || new Date().toISOString().slice(0, 10);
  if (!DATE.test(date)) throw new ApiError(400, 'Tarih YYYY-AA-GG biçiminde olmalı.');
  const rate = (v: unknown, f: string) => {
    const n = Number(v ?? 0);
    if (!Number.isFinite(n) || n < 0 || n > 100) throw new ApiError(400, `${f} 0 ile 100 arasında olmalı.`);
    return n;
  };
  const caseId = sameCase ? rows[0].case_id : null;
  const hours = `${Math.floor(minutes / 60)} sa ${minutes % 60} dk`;
  const tx = db.transaction(() => {
    const f = db
      .prepare(
        `INSERT INTO finance_entries (office_id, case_id, kind, category, description, client, amount_kurus, vat_rate, withholding_rate, date, created_by)
         VALUES (?, ?, 'gelir', 'Saat ücreti', ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        user.office_id,
        caseId,
        `Avukatlık hizmeti, ${hours} (${rows.length} kayıt)`,
        rows[0].client,
        total,
        rate(input.vatRate ?? 20, 'KDV oranı'),
        rate(input.withholdingRate, 'Stopaj oranı'),
        date,
        user.id,
      );
    const fid = Number(f.lastInsertRowid);
    const upd = db.prepare('UPDATE time_entries SET finance_entry_id = ? WHERE id = ?');
    for (const r of rows) upd.run(fid, r.id);
    return fid;
  });
  const financeId = tx();
  return { financeEntryId: financeId, amountKurus: total, minutes };
}
