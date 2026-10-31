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
  debtorIdNo?: string;
  debtorAddress?: string;
  interestType?: string;
  preInterest?: number | string;
  fee?: number | string;
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
  debtor_id_no: string;
  debtor_address: string;
  interest_type: string;
  pre_interest_kurus: number;
  fee_kurus: number;
}

interface ActionRow {
  id: number;
  date: string;
  action: string;
  amount_kurus: number;
  note: string;
}

export const INTEREST_TYPES = ['sabit', 'yasal'];
/** 3095 sayılı Kanun yasal faiz oranları (yıllık %), yürürlük tarihine göre. */
export const LEGAL_RATES: [string, number][] = [
  ['2006-01-01', 9],
  ['2024-06-01', 24],
];

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
  if (input.interestType !== undefined && !INTEREST_TYPES.includes(input.interestType)) throw new ApiError(400, 'Geçersiz faiz türü.');
  const rate = Number(input.interestRate ?? 0);
  if (!Number.isFinite(rate) || rate < 0) throw new ApiError(400, 'Faiz oranı geçerli değil.');
}

/** Basit faiz: anapara × yıllık oran × gün / 365. */
export function simpleInterest(principalKurus: number, annualRate: number, fromDate: string, toDate: string) {
  if (!fromDate || !annualRate) return 0;
  const days = Math.max(0, Math.floor((Date.parse(toDate) - Date.parse(fromDate)) / 86_400_000));
  return Math.round((principalKurus * annualRate * days) / 36_500);
}

const DAY = 86_400_000;
const addDays = (d: string, n: number) => new Date(Date.parse(d) + n * DAY).toISOString().slice(0, 10);

function rateAt(f: Pick<FileRow, 'interest_type' | 'interest_rate'>, date: string) {
  if (f.interest_type !== 'yasal') return f.interest_rate;
  let r = LEGAL_RATES[0][1];
  for (const [from, rate] of LEGAL_RATES) if (date >= from) r = rate;
  return r;
}

/** Faiz döneminin oran değişim noktaları (yasal faizde). */
function rateBreaks(f: FileRow, from: string, to: string) {
  return f.interest_type === 'yasal' ? LEGAL_RATES.map(([d]) => d).filter((d) => d > from && d < to) : [];
}

export interface LedgerLine {
  date: string;
  kind: 'baslangic' | 'masraf' | 'tahsilat' | 'hesap';
  label: string;
  amount_kurus: number;
  /** Tahsilatın nereye mahsup edildiği. */
  applied?: { masraf: number; faiz: number; anapara: number };
  interest_kurus: number;
  balance: { anapara: number; faiz: number; masraf: number; toplam: number };
}

/**
 * Dosya hesabı (kapak hesabı): asıl alacak, takip öncesi işlemiş faiz, takip sonrası faiz (yasal faizde
 * dönem dönem değişen oranla), masraflar ve vekâlet ücreti. Tahsilatlar TBK 100 uyarınca önce masraf ve
 * vekâlet ücretine, sonra faize, en son asıl alacağa mahsup edilir; faiz kalan asıl alacak üzerinden işler.
 */
export function account(f: FileRow, actions: ActionRow[], asOf: string) {
  const events = actions
    .filter((a) => (a.action === 'tahsilat' || a.action === 'masraf') && a.date <= asOf && a.amount_kurus > 0)
    .sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);
  let anapara = f.principal_kurus;
  let faiz = f.pre_interest_kurus;
  let masraf = f.fee_kurus;
  let interestTotal = f.pre_interest_kurus;
  let expenseTotal = f.fee_kurus;
  let cursor = f.start_date || asOf;
  const lines: LedgerLine[] = [];
  const bal = () => ({ anapara, faiz, masraf, toplam: anapara + faiz + masraf });
  lines.push({
    date: cursor,
    kind: 'baslangic',
    label: 'Takip: asıl alacak' + (f.pre_interest_kurus ? ' + takip öncesi faiz' : '') + (f.fee_kurus ? ' + vekâlet ücreti' : ''),
    amount_kurus: f.principal_kurus + f.pre_interest_kurus + f.fee_kurus,
    interest_kurus: 0,
    balance: bal(),
  });
  const accrue = (to: string) => {
    if (!f.start_date || to <= cursor) return 0;
    let sum = 0;
    let from = cursor;
    for (const br of [...rateBreaks(f, from, to), to]) {
      sum += simpleInterest(anapara, rateAt(f, from), from, br);
      from = br;
    }
    cursor = to;
    faiz += sum;
    interestTotal += sum;
    return sum;
  };
  for (const e of events) {
    const inter = accrue(e.date);
    if (e.action === 'masraf') {
      masraf += e.amount_kurus;
      expenseTotal += e.amount_kurus;
      lines.push({ date: e.date, kind: 'masraf', label: e.note || 'Masraf', amount_kurus: e.amount_kurus, interest_kurus: inter, balance: bal() });
      continue;
    }
    let left = e.amount_kurus;
    const take = (have: number) => {
      const t = Math.min(have, left);
      left -= t;
      return t;
    };
    const applied = { masraf: take(masraf), faiz: 0, anapara: 0 };
    masraf -= applied.masraf;
    applied.faiz = take(faiz);
    faiz -= applied.faiz;
    applied.anapara = take(anapara);
    anapara -= applied.anapara;
    lines.push({ date: e.date, kind: 'tahsilat', label: e.note || 'Tahsilat', amount_kurus: e.amount_kurus, applied, interest_kurus: inter, balance: bal() });
  }
  const inter = accrue(asOf);
  lines.push({ date: asOf, kind: 'hesap', label: 'Hesap tarihi', amount_kurus: 0, interest_kurus: inter, balance: bal() });
  const sum = (k: string) => actions.filter((a) => a.action === k && a.date <= asOf).reduce((n, a) => n + a.amount_kurus, 0);
  const collected = sum('tahsilat');
  const reddiyat = sum('reddiyat');
  const paidClient = sum('muvekkile_odeme');
  return {
    asOf,
    lines,
    interest_total_kurus: interestTotal,
    expense_total_kurus: expenseTotal,
    collected_kurus: collected,
    remaining: bal(),
    /** İcra dairesinde bekleyen para ("para var mı"). */
    at_office_kurus: Math.max(0, collected - reddiyat),
    /** Reddiyatla avukata geçmiş, müvekkile henüz ödenmemiş para. */
    at_lawyer_kurus: Math.max(0, reddiyat - paidClient),
    reddiyat_kurus: reddiyat,
    paid_client_kurus: paidClient,
  };
}

function loadActions(db: DB, fileId: number) {
  return db.prepare('SELECT id, date, action, amount_kurus, note FROM enforcement_actions WHERE file_id = ?').all(fileId) as ActionRow[];
}

function withTotals(db: DB, f: FileRow, asOf = new Date().toISOString().slice(0, 10)) {
  const acc = account(f, loadActions(db, f.id), asOf);
  return {
    ...f,
    collected_kurus: acc.collected_kurus,
    interest_kurus: acc.interest_total_kurus,
    expense_kurus: acc.expense_total_kurus,
    remaining_kurus: acc.remaining.toplam,
    at_office_kurus: acc.at_office_kurus,
    at_lawyer_kurus: acc.at_lawyer_kurus,
  };
}

/** Belirli bir tarihteki dosya hesabı ve yazdırılabilir kapak hesabı metni. */
export function fileAccount(db: DB, user: User, id: number, asOf?: string) {
  const f = load(db, user, id);
  const date = asOf && DATE.test(asOf) ? asOf : new Date().toISOString().slice(0, 10);
  const acc = account(f, loadActions(db, id), date);
  const tl = (k: number) => `${(k / 100).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} TL`;
  const d = (x: string) => (x ? x.split('-').reverse().join('.') : '—');
  const rate = f.interest_type === 'yasal' ? 'yasal faiz (3095 s.K., dönem oranlarıyla)' : `yıllık %${f.interest_rate}`;
  const report = [
    'DOSYA HESABI',
    `${f.office_name || 'İcra Dairesi'} ${f.file_no ? `${f.file_no} E.` : ''}`.trim(),
    `Alacaklı: ${f.creditor || '—'}`,
    `Borçlu: ${f.debtor}${f.debtor_id_no ? ` (${f.debtor_id_no})` : ''}`,
    `Takip tarihi: ${d(f.start_date)} · Hesap tarihi: ${d(date)} · Faiz: ${rate}`,
    '',
    `Asıl alacak: ${tl(f.principal_kurus)}`,
    `Takip öncesi işlemiş faiz: ${tl(f.pre_interest_kurus)}`,
    `Takip sonrası işlemiş faiz: ${tl(acc.interest_total_kurus - f.pre_interest_kurus)}`,
    `Vekâlet ücreti: ${tl(f.fee_kurus)}`,
    `Masraflar: ${tl(acc.expense_total_kurus - f.fee_kurus)}`,
    `Toplam tahsilat: ${tl(acc.collected_kurus)}`,
    '',
    `KALAN BORÇ: ${tl(acc.remaining.toplam)}`,
    `  (asıl alacak ${tl(acc.remaining.anapara)}, faiz ${tl(acc.remaining.faiz)}, masraf ve vekâlet ücreti ${tl(acc.remaining.masraf)})`,
    '',
    'Tahsilatlar TBK 100 uyarınca önce masraf ve vekâlet ücretine, sonra faize, kalan kısım asıl alacağa mahsup edilmiştir.',
  ].join('\n');
  return { ...acc, report, nextDay: addDays(date, 1) };
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
      `INSERT INTO enforcement_files (office_id, case_id, office_name, file_no, kind, creditor, debtor, principal_kurus, interest_rate, start_date, status, note, created_by,
         debtor_id_no, debtor_address, interest_type, pre_interest_kurus, fee_kurus)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      String(input.debtorIdNo ?? '').trim(),
      String(input.debtorAddress ?? '').trim(),
      input.interestType ?? 'sabit',
      toKurus(input.preInterest, 'Takip öncesi faiz'),
      toKurus(input.fee, 'Vekâlet ücreti'),
    );
  return getFile(db, user, Number(result.lastInsertRowid));
}

export function updateFile(db: DB, user: User, id: number, input: FileInput) {
  const f = load(db, user, id);
  check(input);
  db.prepare(
    `UPDATE enforcement_files SET office_name = ?, file_no = ?, kind = ?, creditor = ?, debtor = ?, principal_kurus = ?,
     interest_rate = ?, start_date = ?, status = ?, note = ?, debtor_id_no = ?, debtor_address = ?, interest_type = ?,
     pre_interest_kurus = ?, fee_kurus = ? WHERE id = ?`,
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
    input.debtorIdNo ?? f.debtor_id_no,
    input.debtorAddress ?? f.debtor_address,
    input.interestType ?? f.interest_type,
    input.preInterest !== undefined ? toKurus(input.preInterest, 'Takip öncesi faiz') : f.pre_interest_kurus,
    input.fee !== undefined ? toKurus(input.fee, 'Vekâlet ücreti') : f.fee_kurus,
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
