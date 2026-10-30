import { requireFinance, type User } from './auth.ts';
import type { DB } from './db.ts';
import { ApiError } from './errors.ts';
import { DATE, ownedCaseId, toKurus } from './money.ts';

// gelir: büronun kazancı (vekâlet ücreti, danışmanlık). gider: büronun kendi giderleri
// (kira, maaş). masraf: müvekkil adına yapılan ve müvekkilden alınacak dosya masrafları.
const KINDS = ['gelir', 'gider', 'masraf'] as const;
type Kind = (typeof KINDS)[number];

interface EntryInput {
  kind: Kind;
  category?: string;
  description?: string;
  client?: string;
  amount: number | string;
  vatRate?: number;
  withholdingRate?: number;
  date: string;
  caseId?: number | null;
}

function rate(value: unknown, field: string) {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n) || n < 0 || n > 100) throw new ApiError(400, `${field} 0 ile 100 arasında olmalı.`);
  return n;
}

export function addEntry(db: DB, user: User, input: EntryInput) {
  requireFinance(user);
  if (!KINDS.includes(input.kind)) throw new ApiError(400, 'Kayıt türü gelir, gider ya da masraf olmalı.');
  if (!DATE.test(input.date ?? '')) throw new ApiError(400, 'Tarih YYYY-AA-GG biçiminde olmalı.');
  const amount = toKurus(input.amount);
  if (amount <= 0) throw new ApiError(400, 'Tutar sıfırdan büyük olmalı.');
  const result = db
    .prepare(
      `INSERT INTO finance_entries (office_id, case_id, kind, category, description, client, amount_kurus, vat_rate, withholding_rate, date, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      user.office_id,
      ownedCaseId(db, user.office_id, input.caseId),
      input.kind,
      input.category ?? '',
      input.description ?? '',
      input.client ?? '',
      amount,
      rate(input.vatRate, 'KDV oranı'),
      rate(input.withholdingRate, 'Stopaj oranı'),
      input.date,
      user.id,
    );
  return db.prepare('SELECT * FROM finance_entries WHERE id = ?').get(Number(result.lastInsertRowid));
}

export function deleteEntry(db: DB, user: User, id: number) {
  requireFinance(user);
  const r = db.prepare('DELETE FROM finance_entries WHERE id = ? AND office_id = ?').run(id, user.office_id);
  if (r.changes === 0) throw new ApiError(404, 'Kayıt bulunamadı.');
  return { ok: true };
}

/**
 * Seçilen dönemin kayıtları ve özeti. Tutarlar KDV hariç girilir; KDV ve stopaj
 * kayıttaki oranlardan hesaplanır.
 */
export function financeReport(db: DB, user: User, query: { from?: string; to?: string; caseId?: string }) {
  requireFinance(user);
  const from = query.from && DATE.test(query.from) ? query.from : '0000-01-01';
  const to = query.to && DATE.test(query.to) ? query.to : '9999-12-31';
  const params: unknown[] = [user.office_id, from, to];
  let caseFilter = '';
  if (query.caseId) {
    caseFilter = 'AND f.case_id = ?';
    params.push(Number(query.caseId));
  }
  const entries = db
    .prepare(
      `SELECT f.*, c.title AS case_title FROM finance_entries f LEFT JOIN cases c ON c.id = f.case_id
       WHERE f.office_id = ? AND f.date BETWEEN ? AND ? ${caseFilter} ORDER BY f.date DESC, f.id DESC`,
    )
    .all(...params) as {
    kind: Kind;
    amount_kurus: number;
    vat_rate: number;
    withholding_rate: number;
    date: string;
    case_id: number | null;
    case_title: string | null;
  }[];

  const sum = (kind: Kind, fn: (e: (typeof entries)[number]) => number = (e) => e.amount_kurus) =>
    entries.filter((e) => e.kind === kind).reduce((t, e) => t + fn(e), 0);
  const income = sum('gelir');
  const expense = sum('gider');
  const costs = sum('masraf');
  const vatCollected = Math.round(sum('gelir', (e) => (e.amount_kurus * e.vat_rate) / 100));
  const vatPaid = Math.round(sum('gider', (e) => (e.amount_kurus * e.vat_rate) / 100));
  const withholding = Math.round(sum('gelir', (e) => (e.amount_kurus * e.withholding_rate) / 100));

  const monthly = new Map<string, { month: string; income: number; expense: number; costs: number }>();
  const byCase = new Map<string, { caseId: number; title: string; income: number; costs: number }>();
  for (const e of entries) {
    const m = e.date.slice(0, 7);
    const row = monthly.get(m) ?? { month: m, income: 0, expense: 0, costs: 0 };
    if (e.kind === 'gelir') row.income += e.amount_kurus;
    else if (e.kind === 'gider') row.expense += e.amount_kurus;
    else row.costs += e.amount_kurus;
    monthly.set(m, row);
    if (e.case_id) {
      const k = String(e.case_id);
      const c = byCase.get(k) ?? { caseId: e.case_id, title: e.case_title ?? '', income: 0, costs: 0 };
      if (e.kind === 'gelir') c.income += e.amount_kurus;
      if (e.kind === 'masraf') c.costs += e.amount_kurus;
      byCase.set(k, c);
    }
  }

  return {
    entries,
    summary: {
      income,
      expense,
      costs,
      profit: income - expense,
      vatCollected,
      vatPaid,
      vatPayable: vatCollected - vatPaid,
      withholding,
    },
    monthly: [...monthly.values()].sort((a, b) => a.month.localeCompare(b.month)),
    byCase: [...byCase.values()].sort((a, b) => b.income - a.income),
  };
}
