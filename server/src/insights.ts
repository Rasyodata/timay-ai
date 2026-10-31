/*
 * İş zekası: her yönetim sayfası için göstergeler ve grafik verisi.
 * Tüm grafikler aynı biçimdedir; masaüstü tek bir bileşenle çizer.
 */
import { requireFinance, type User } from './auth.ts';
import { caseVisibility } from './cases.ts';
import { DEFAULT_PLAYBOOK, getPlaybook, reviewText, type Side } from './clm.ts';
import type { DB } from './db.ts';
import { ApiError } from './errors.ts';
import { POWERS_LIST } from './poa.ts';
import { AREAS } from './templates.ts';

export type Unit = 'adet' | 'tl' | 'saat' | 'gun' | 'yuzde';
export type Tone = 'iyi' | 'uyari' | 'kritik' | '';

export interface Kpi {
  label: string;
  value: number;
  unit: Unit;
  hint?: string;
  tone?: Tone;
}

export interface Chart {
  id: string;
  title: string;
  /** bars: sıralı yatay çubuk · months: aylık sütun · parts: tek parçalı çubuk (dağılım) */
  kind: 'bars' | 'months' | 'parts';
  unit: Unit;
  /** Birden çok seri (ör. gelir ve gider) varsa adları; yoksa tek seri. */
  series?: string[];
  /** Seriler bir bütünün parçalarıysa üst üste (ör. zamanında + geciken); değilse yan yana. */
  stacked?: boolean;
  data: { label: string; values: number[]; tone?: Tone }[];
  note?: string;
}

export interface Insights {
  kpis: Kpi[];
  charts: Chart[];
}

const MONTHS = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'];

/** Son n ayın 'YYYY-MM' anahtarları (eskiden yeniye). */
export function lastMonths(today: string, n = 12) {
  const [y, m] = today.split('-').map(Number);
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    out.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
  }
  return out;
}

function monthLabel(key: string) {
  const [y, m] = key.split('-');
  return `${MONTHS[Number(m) - 1]} ${y.slice(2)}`;
}

/** Tarihleri aylara dağıtır; her satır [tarih, değer...]. */
function byMonth(today: string, rows: { date: string; values: number[] }[], width = 1, n = 12) {
  const keys = lastMonths(today, n);
  const map = new Map(keys.map((k) => [k, new Array(width).fill(0) as number[]]));
  for (const r of rows) {
    const slot = map.get((r.date ?? '').slice(0, 7));
    if (slot) r.values.forEach((v, i) => (slot[i] += v));
  }
  return keys.map((k) => ({ label: monthLabel(k), values: map.get(k)! }));
}

/** Sayımları büyükten küçüğe sıralar; fazlası "Diğer"de toplanır. */
function ranked(counts: Map<string, number>, limit = 8) {
  const sorted = [...counts.entries()].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  const head = sorted.slice(0, limit).map(([label, v]) => ({ label, values: [v] }));
  const rest = sorted.slice(limit).reduce((s, [, v]) => s + v, 0);
  if (rest > 0) head.push({ label: 'Diğer', values: [rest] });
  return head;
}

function count<T>(rows: T[], key: (r: T) => string, value: (r: T) => number = () => 1) {
  const m = new Map<string, number>();
  for (const r of rows) m.set(key(r), (m.get(key(r)) ?? 0) + value(r));
  return m;
}

function addDays(date: string, days: number) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function daysBetween(a: string, b: string) {
  return Math.round((Date.parse(`${b.slice(0, 10)}T00:00:00Z`) - Date.parse(`${a.slice(0, 10)}T00:00:00Z`)) / 86400000);
}

const tl = (kurus: number) => Math.round(kurus / 100);
const AREA_NAME = Object.fromEntries(AREAS.map((a) => [a.id, a.name]));

// ---------------------------------------------------------------- Dava dosyaları
function casesInsights(db: DB, user: User, today: string): Insights {
  const v = caseVisibility(user);
  const rows = db
    .prepare(
      `SELECT c.id, c.area, c.status, c.court, c.created_at, u.name AS responsible
       FROM cases c LEFT JOIN users u ON u.id = c.responsible_id WHERE c.office_id = ?${v.sql}`,
    )
    .all(user.office_id, ...v.params) as { id: number; area: string; status: string; court: string; created_at: string; responsible: string | null }[];
  const open = rows.filter((r) => r.status !== 'kapali');
  const ids = new Set(rows.map((r) => r.id));
  const hearings = (
    db
      .prepare('SELECT h.case_id, h.date FROM hearings h JOIN cases c ON c.id = h.case_id WHERE c.office_id = ? AND h.date >= ? AND h.date <= ?')
      .all(user.office_id, today, addDays(today, 30)) as { case_id: number; date: string }[]
  ).filter((h) => ids.has(h.case_id));
  const deadlines = (
    db
      .prepare('SELECT case_id, due_date FROM legal_deadlines WHERE office_id = ? AND done = 0 AND case_id IS NOT NULL')
      .all(user.office_id) as { case_id: number; due_date: string }[]
  ).filter((d) => ids.has(d.case_id));
  const overdue = deadlines.filter((d) => d.due_date < today).length;
  const avgAge = open.length ? Math.round(open.reduce((s, r) => s + daysBetween(r.created_at, today), 0) / open.length) : 0;
  const thisMonth = rows.filter((r) => r.created_at.slice(0, 7) === today.slice(0, 7)).length;
  const docs = new Map(
    (db.prepare('SELECT case_id, COUNT(*) AS n FROM case_documents WHERE office_id = ? GROUP BY case_id').all(user.office_id) as { case_id: number; n: number }[]).map((d) => [
      d.case_id,
      d.n,
    ]),
  );
  const poa = new Set(
    (
      db
        .prepare("SELECT pc.case_id FROM poa_cases pc JOIN powers_of_attorney p ON p.id = pc.poa_id WHERE p.office_id = ? AND p.status = 'gecerli'")
        .all(user.office_id) as { case_id: number }[]
    ).map((r) => r.case_id),
  );
  const noPoa = open.filter((r) => !poa.has(r.id)).length;
  return {
    kpis: [
      { label: 'Açık dosya', value: open.length, unit: 'adet', hint: `${rows.length - open.length} kapalı` },
      { label: 'Bu ay açılan', value: thisMonth, unit: 'adet' },
      { label: 'Ortalama açık kalma', value: avgAge, unit: 'gun', hint: 'açık dosyalarda' },
      { label: '30 gün içinde duruşma', value: hearings.length, unit: 'adet' },
      { label: 'Kaçırılmış süre', value: overdue, unit: 'adet', tone: overdue ? 'kritik' : 'iyi', hint: `${deadlines.length} takipteki süre` },
      { label: 'Vekâletnamesi olmayan', value: noPoa, unit: 'adet', tone: noPoa ? 'uyari' : 'iyi', hint: 'açık dosya' },
    ],
    charts: [
      { id: 'aylik', title: 'Aylık açılan dosya', kind: 'months', unit: 'adet', data: byMonth(today, rows.map((r) => ({ date: r.created_at, values: [1] }))) },
      { id: 'alan', title: 'Hukuk alanına göre açık dosyalar', kind: 'bars', unit: 'adet', data: ranked(count(open, (r) => AREA_NAME[r.area] ?? 'Belirtilmemiş')) },
      { id: 'sorumlu', title: 'Avukata göre açık dosya yükü', kind: 'bars', unit: 'adet', data: ranked(count(open, (r) => r.responsible || 'Atanmamış')) },
      { id: 'mahkeme', title: 'Mahkemeye göre dosyalar', kind: 'bars', unit: 'adet', data: ranked(count(rows.filter((r) => r.court.trim()), (r) => r.court.trim()), 6) },
      {
        id: 'belge',
        title: 'Belge sayısına göre dosyalar',
        kind: 'parts',
        unit: 'adet',
        data: [
          { label: 'Belgesi yok', values: [open.filter((r) => !docs.get(r.id)).length] },
          { label: '1–5 belge', values: [open.filter((r) => (docs.get(r.id) ?? 0) >= 1 && (docs.get(r.id) ?? 0) <= 5).length] },
          { label: '6+ belge', values: [open.filter((r) => (docs.get(r.id) ?? 0) > 5).length] },
        ],
        note: 'Yalnızca açık dosyalar',
      },
    ],
  };
}

// ---------------------------------------------------------------- Sözleşmeler
const CONTRACT_KIND: Record<string, string> = {
  'kat-karsiligi': 'Kat karşılığı inşaat',
  hizmet: 'Hizmet',
  satis: 'Satış',
  'kira-konut': 'Kira',
  gizlilik: 'Gizlilik',
};
const CONTRACT_STATUS: Record<string, string> = { taslak: 'Taslak', yururlukte: 'Yürürlükte', sona_erdi: 'Sona erdi' };

function contractsInsights(db: DB, user: User, today: string): Insights {
  const rows = db
    .prepare('SELECT id, kind, status, body, side, end_date, value_kurus, review_status, created_at FROM contracts WHERE office_id = ?')
    .all(user.office_id) as { id: number; kind: string; status: string; body: string; side: string; end_date: string; value_kurus: number; review_status: string; created_at: string }[];
  let pb = DEFAULT_PLAYBOOK;
  try {
    pb = getPlaybook(db, user);
  } catch {
    // varsayılan kurallar
  }
  const risk = { dusuk: 0, orta: 0, yuksek: 0 };
  for (const c of rows) {
    if (!c.body.trim()) continue;
    const side = (c.side || 'genel') as Side;
    risk[reviewText(c.body, c.kind, side, pb).band as keyof typeof risk]++;
  }
  const obligations = db
    .prepare(
      `SELECT o.due_date, o.amount_kurus, o.done FROM contract_obligations o JOIN contracts c ON c.id = o.contract_id
       WHERE c.office_id = ? AND o.due_date != ''`,
    )
    .all(user.office_id) as { due_date: string; amount_kurus: number; done: number }[];
  const active = rows.filter((r) => r.status === 'yururlukte');
  const ending = active.filter((r) => r.end_date && r.end_date >= today && r.end_date <= addDays(today, 60)).length;
  const lateObl = obligations.filter((o) => !o.done && o.due_date < today).length;
  const pending = rows.filter((r) => r.review_status === 'incelemede').length;
  // Gelecek 12 ayın taahhütleri
  const future = today.slice(0, 7);
  const next = Array.from({ length: 12 }, (_, i) => {
    const d = new Date(Date.UTC(Number(future.slice(0, 4)), Number(future.slice(5, 7)) - 1 + i, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  });
  const oblByMonth = next.map((k) => {
    const list = obligations.filter((o) => !o.done && o.due_date.slice(0, 7) === k);
    return { label: monthLabel(k), values: [list.length] };
  });
  return {
    kpis: [
      { label: 'Yürürlükte', value: active.length, unit: 'adet', hint: `${rows.length} sözleşme` },
      { label: 'Yürürlükteki toplam değer', value: tl(active.reduce((s, r) => s + r.value_kurus, 0)), unit: 'tl' },
      { label: 'Yüksek riskli', value: risk.yuksek, unit: 'adet', tone: risk.yuksek ? 'kritik' : 'iyi' },
      { label: 'Onay bekleyen', value: pending, unit: 'adet', tone: pending ? 'uyari' : '' },
      { label: '60 gün içinde biten', value: ending, unit: 'adet', tone: ending ? 'uyari' : '' },
      { label: 'Geciken taahhüt', value: lateObl, unit: 'adet', tone: lateObl ? 'kritik' : 'iyi' },
    ],
    charts: [
      {
        id: 'risk',
        title: 'Risk dağılımı',
        kind: 'parts',
        unit: 'adet',
        data: [
          { label: 'Düşük', values: [risk.dusuk], tone: 'iyi' },
          { label: 'Orta', values: [risk.orta], tone: 'uyari' },
          { label: 'Yüksek', values: [risk.yuksek], tone: 'kritik' },
        ],
        note: 'Metni olan sözleşmeler, büronun kurallarına göre',
      },
      { id: 'durum', title: 'Duruma göre', kind: 'parts', unit: 'adet', data: Object.entries(CONTRACT_STATUS).map(([k, l]) => ({ label: l, values: [rows.filter((r) => r.status === k).length] })) },
      { id: 'tur', title: 'Türe göre sözleşmeler', kind: 'bars', unit: 'adet', data: ranked(count(rows, (r) => CONTRACT_KIND[r.kind] ?? 'Diğer')) },
      { id: 'taahhut', title: 'Önümüzdeki 12 ayın taahhütleri', kind: 'months', unit: 'adet', data: oblByMonth },
      { id: 'aylik', title: 'Aylık eklenen sözleşme', kind: 'months', unit: 'adet', data: byMonth(today, rows.map((r) => ({ date: r.created_at, values: [1] }))) },
    ],
  };
}

// ---------------------------------------------------------------- Vekâletnameler
function powersInsights(db: DB, user: User, today: string): Insights {
  const rows = db
    .prepare('SELECT id, status, kind, notary, issue_date, expiry_date, powers, created_at FROM powers_of_attorney WHERE office_id = ?')
    .all(user.office_id) as { id: number; status: string; kind: string; notary: string; issue_date: string; expiry_date: string; powers: string; created_at: string }[];
  const valid = rows.filter((r) => r.status === 'gecerli' && !(r.expiry_date && r.expiry_date < today));
  const expiring = valid.filter((r) => r.expiry_date && r.expiry_date <= addDays(today, 30)).length;
  const openCases = db.prepare("SELECT id FROM cases WHERE office_id = ? AND status != 'kapali'").all(user.office_id) as { id: number }[];
  const covered = new Set(
    (
      db
        .prepare("SELECT pc.case_id FROM poa_cases pc JOIN powers_of_attorney p ON p.id = pc.poa_id WHERE p.office_id = ? AND p.status = 'gecerli'")
        .all(user.office_id) as { case_id: number }[]
    ).map((r) => r.case_id),
  );
  const missing = openCases.filter((c) => !covered.has(c.id)).length;
  const coverage = openCases.length ? Math.round(((openCases.length - missing) / openCases.length) * 100) : 100;
  const powerCounts = POWERS_LIST.map((p) => ({ label: p.label, values: [valid.filter((r) => (JSON.parse(r.powers || '[]') as string[]).includes(p.key)).length] }));
  return {
    kpis: [
      { label: 'Geçerli vekâletname', value: valid.length, unit: 'adet', hint: `${rows.length} kayıt` },
      { label: 'Açık dosya kapsamı', value: coverage, unit: 'yuzde', tone: coverage === 100 ? 'iyi' : coverage >= 80 ? 'uyari' : 'kritik', hint: 'geçerli vekâletnamesi olan' },
      { label: 'Vekâletnamesi olmayan dosya', value: missing, unit: 'adet', tone: missing ? 'uyari' : 'iyi' },
      { label: '30 gün içinde süresi dolan', value: expiring, unit: 'adet', tone: expiring ? 'uyari' : '' },
      { label: 'Azil / istifa', value: rows.filter((r) => r.status === 'azil' || r.status === 'istifa').length, unit: 'adet' },
    ],
    charts: [
      {
        id: 'durum',
        title: 'Duruma göre',
        kind: 'parts',
        unit: 'adet',
        data: [
          { label: 'Geçerli', values: [valid.length], tone: 'iyi' },
          { label: 'Süresi dolmuş', values: [rows.filter((r) => r.status === 'sona_erdi' || (r.status === 'gecerli' && r.expiry_date && r.expiry_date < today)).length] },
          { label: 'Azledildi', values: [rows.filter((r) => r.status === 'azil').length], tone: 'kritik' },
          { label: 'İstifa', values: [rows.filter((r) => r.status === 'istifa').length], tone: 'uyari' },
        ],
      },
      { id: 'yetki', title: 'Geçerli vekâletnamelerde özel yetkiler', kind: 'bars', unit: 'adet', data: powerCounts.sort((a, b) => b.values[0] - a.values[0]), note: 'Kaç vekâletnamede bu yetki var' },
      { id: 'noter', title: 'Notere göre', kind: 'bars', unit: 'adet', data: ranked(count(rows.filter((r) => r.notary), (r) => r.notary), 6) },
      { id: 'aylik', title: 'Aylık düzenlenen vekâletname', kind: 'months', unit: 'adet', data: byMonth(today, rows.map((r) => ({ date: r.issue_date || r.created_at, values: [1] }))) },
    ],
  };
}

// ---------------------------------------------------------------- İcra takibi
const ENF_STATUS: Record<string, string> = { derdest: 'Derdest', itiraz: 'İtiraz edildi', haciz: 'Haciz', satis: 'Satış', tahsil: 'Tahsil edildi', kapandi: 'Kapandı' };
const ENF_KIND: Record<string, string> = { ilamsiz: 'İlamsız', ilamli: 'İlamlı', kambiyo: 'Kambiyo', rehin: 'Rehin', tahliye: 'Tahliye' };

function enforcementInsights(db: DB, user: User, today: string): Insights {
  const files = db
    .prepare('SELECT id, kind, status, debtor, principal_kurus, start_date, created_at FROM enforcement_files WHERE office_id = ?')
    .all(user.office_id) as { id: number; kind: string; status: string; debtor: string; principal_kurus: number; start_date: string; created_at: string }[];
  const actions = db
    .prepare(
      `SELECT a.file_id, a.date, a.action, a.amount_kurus FROM enforcement_actions a JOIN enforcement_files f ON f.id = a.file_id WHERE f.office_id = ?`,
    )
    .all(user.office_id) as { file_id: number; date: string; action: string; amount_kurus: number }[];
  const collected = actions.filter((a) => a.action === 'tahsilat');
  const total = files.reduce((s, f) => s + f.principal_kurus, 0);
  const got = collected.reduce((s, a) => s + a.amount_kurus, 0);
  const openFiles = files.filter((f) => f.status !== 'tahsil' && f.status !== 'kapandi');
  const gotBy = count(collected, (a) => String(a.file_id), (a) => a.amount_kurus);
  const remaining = new Map<string, number>();
  for (const f of openFiles) {
    const left = Math.max(0, f.principal_kurus - (gotBy.get(String(f.id)) ?? 0));
    const key = f.debtor || 'Belirtilmemiş';
    remaining.set(key, (remaining.get(key) ?? 0) + tl(left));
  }
  const lastAction = new Map<number, string>();
  for (const a of actions) if ((lastAction.get(a.file_id) ?? '') < a.date) lastAction.set(a.file_id, a.date);
  const idle = openFiles.filter((f) => daysBetween(lastAction.get(f.id) ?? f.start_date ?? f.created_at, today) > 90).length;
  return {
    kpis: [
      { label: 'Açık icra dosyası', value: openFiles.length, unit: 'adet', hint: `${files.length} dosya` },
      { label: 'Toplam asıl alacak', value: tl(total), unit: 'tl' },
      { label: 'Tahsil edilen', value: tl(got), unit: 'tl', tone: 'iyi' },
      { label: 'Tahsil oranı', value: total ? Math.round((got / total) * 100) : 0, unit: 'yuzde' },
      { label: '90 gündür işlem yok', value: idle, unit: 'adet', tone: idle ? 'uyari' : 'iyi', hint: 'açık dosyada' },
    ],
    charts: [
      { id: 'asama', title: 'Aşamaya göre dosyalar', kind: 'bars', unit: 'adet', data: Object.entries(ENF_STATUS).map(([k, l]) => ({ label: l, values: [files.filter((f) => f.status === k).length] })) },
      { id: 'tahsilat', title: 'Aylık tahsilat', kind: 'months', unit: 'tl', data: byMonth(today, collected.map((a) => ({ date: a.date, values: [tl(a.amount_kurus)] }))) },
      { id: 'borclu', title: 'Borçluya göre kalan alacak', kind: 'bars', unit: 'tl', data: ranked(remaining, 6) },
      { id: 'tur', title: 'Takip türüne göre', kind: 'parts', unit: 'adet', data: Object.entries(ENF_KIND).map(([k, l]) => ({ label: l, values: [files.filter((f) => f.kind === k).length] })) },
    ],
  };
}

// ---------------------------------------------------------------- Danışmanlık
const CONSULT_KIND: Record<string, string> = {
  gorus: 'Hukuki görüş',
  gorusme: 'Görüşme',
  toplanti: 'Toplantı',
  sozlesme: 'Sözleşme incelemesi',
  yazisma: 'Yazışma',
  diger: 'Diğer',
};

function consultancyInsights(db: DB, user: User, today: string): Insights {
  const clients = db
    .prepare('SELECT id, name, status, monthly_fee_kurus, included_minutes FROM consultancy_clients WHERE office_id = ?')
    .all(user.office_id) as { id: number; name: string; status: string; monthly_fee_kurus: number; included_minutes: number }[];
  const records = db
    .prepare('SELECT r.client_id, r.date, r.kind, r.minutes FROM consultancy_records r JOIN consultancy_clients c ON c.id = r.client_id WHERE c.office_id = ?')
    .all(user.office_id) as { client_id: number; date: string; kind: string; minutes: number }[];
  const active = clients.filter((c) => c.status === 'aktif');
  const month = today.slice(0, 7);
  const usedNow = count(records.filter((r) => r.date.slice(0, 7) === month), (r) => String(r.client_id), (r) => r.minutes);
  const over = active.filter((c) => c.included_minutes > 0 && (usedNow.get(String(c.id)) ?? 0) > c.included_minutes).length;
  const hours = (m: number) => Math.round((m / 60) * 10) / 10;
  const kpis: Kpi[] = [
    { label: 'Aktif müvekkil', value: active.length, unit: 'adet' },
    { label: 'Bu ay harcanan', value: hours([...usedNow.values()].reduce((s, v) => s + v, 0)), unit: 'saat' },
    { label: 'Paketi aşan müvekkil', value: over, unit: 'adet', tone: over ? 'uyari' : 'iyi', hint: 'bu ay' },
  ];
  if (user.can_finance) {
    const fee = active.reduce((s, c) => s + c.monthly_fee_kurus, 0);
    kpis.splice(1, 0, { label: 'Aylık sabit gelir', value: tl(fee), unit: 'tl' });
    const minutes = [...usedNow.values()].reduce((s, v) => s + v, 0);
    if (minutes) kpis.push({ label: 'Saat başı gelir (bu ay)', value: Math.round(tl(fee) / (minutes / 60)), unit: 'tl' });
  }
  return {
    kpis,
    charts: [
      {
        id: 'kullanim',
        title: 'Bu ay müvekkil bazında kullanım',
        kind: 'bars',
        unit: 'saat',
        series: ['Harcanan', 'Pakete dahil'],
        data: active
          .map((c) => ({ label: c.name, values: [hours(usedNow.get(String(c.id)) ?? 0), hours(c.included_minutes)] }))
          .sort((a, b) => b.values[0] - a.values[0])
          .slice(0, 8),
      },
      { id: 'aylik', title: 'Aylık danışmanlık saati', kind: 'months', unit: 'saat', data: byMonth(today, records.map((r) => ({ date: r.date, values: [hours(r.minutes)] }))) },
      { id: 'tur', title: 'İş türüne göre süre (son 12 ay)', kind: 'parts', unit: 'saat', data: Object.entries(CONSULT_KIND).map(([k, l]) => ({ label: l, values: [hours(records.filter((r) => r.kind === k && r.date >= addDays(today, -365)).reduce((s, r) => s + r.minutes, 0))] })) },
    ],
  };
}

// ---------------------------------------------------------------- Miras
function estatesInsights(db: DB, user: User): Insights {
  const estates = db.prepare('SELECT id, deceased FROM estates WHERE office_id = ?').all(user.office_id) as { id: number; deceased: string }[];
  const items = db
    .prepare('SELECT i.estate_id, i.kind, i.category, i.value_kurus FROM estate_items i JOIN estates e ON e.id = i.estate_id WHERE e.office_id = ?')
    .all(user.office_id) as { estate_id: number; kind: string; category: string; value_kurus: number }[];
  const heirs = db.prepare('SELECT COUNT(*) AS n FROM estate_heirs h JOIN estates e ON e.id = h.estate_id WHERE e.office_id = ?').get(user.office_id) as { n: number };
  const assets = items.filter((i) => i.kind === 'varlik');
  const debts = items.filter((i) => i.kind === 'borc');
  const sum = (l: typeof items) => tl(l.reduce((s, i) => s + i.value_kurus, 0));
  const net = new Map<string, number>();
  for (const e of estates) {
    const own = items.filter((i) => i.estate_id === e.id);
    net.set(e.deceased, sum(own.filter((i) => i.kind === 'varlik')) - sum(own.filter((i) => i.kind === 'borc')));
  }
  const negative = [...net.values()].filter((v) => v < 0).length;
  return {
    kpis: [
      { label: 'Tereke dosyası', value: estates.length, unit: 'adet' },
      { label: 'Toplam varlık', value: sum(assets), unit: 'tl' },
      { label: 'Toplam borç', value: sum(debts), unit: 'tl' },
      { label: 'Net tereke', value: sum(assets) - sum(debts), unit: 'tl' },
      { label: 'Borcu varlığını aşan', value: negative, unit: 'adet', tone: negative ? 'kritik' : 'iyi', hint: 'reddi miras süresine dikkat' },
      { label: 'Mirasçı', value: heirs.n, unit: 'adet' },
    ],
    charts: [
      { id: 'varlik', title: 'Varlık türlerine göre', kind: 'bars', unit: 'tl', data: ranked(count(assets, (i) => i.category || 'Diğer', (i) => tl(i.value_kurus)), 6) },
      { id: 'borc', title: 'Borç türlerine göre', kind: 'bars', unit: 'tl', data: ranked(count(debts, (i) => i.category || 'Diğer', (i) => tl(i.value_kurus)), 6) },
      {
        id: 'net',
        title: 'Dosya bazında net tereke',
        kind: 'bars',
        unit: 'tl',
        data: [...net.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 8)
          .map(([label, v]) => ({ label, values: [v], tone: v < 0 ? ('kritik' as Tone) : undefined })),
      },
    ],
  };
}

// ---------------------------------------------------------------- Görevler
const TASK_STATUS: Record<string, string> = { yapilacak: 'Yapılacak', devam: 'Devam ediyor', inceleme: 'Kontrolde', tamam: 'Tamamlandı' };

function tasksInsights(db: DB, user: User, today: string): Insights {
  const rows = db
    .prepare('SELECT t.status, t.due_date, t.created_at, u.name AS assignee FROM tasks t JOIN users u ON u.id = t.assignee_id WHERE t.office_id = ?')
    .all(user.office_id) as { status: string; due_date: string; created_at: string; assignee: string }[];
  const open = rows.filter((r) => r.status !== 'tamam');
  const late = open.filter((r) => r.due_date && r.due_date < today);
  const week = open.filter((r) => r.due_date && r.due_date >= today && r.due_date <= addDays(today, 7)).length;
  const done = rows.length - open.length;
  return {
    kpis: [
      { label: 'Açık görev', value: open.length, unit: 'adet' },
      { label: 'Geciken', value: late.length, unit: 'adet', tone: late.length ? 'kritik' : 'iyi' },
      { label: 'Bu hafta teslim', value: week, unit: 'adet', tone: week ? 'uyari' : '' },
      { label: 'Kontrol bekleyen', value: rows.filter((r) => r.status === 'inceleme').length, unit: 'adet' },
      { label: 'Tamamlanma oranı', value: rows.length ? Math.round((done / rows.length) * 100) : 0, unit: 'yuzde' },
    ],
    charts: [
      { id: 'durum', title: 'Duruma göre', kind: 'parts', unit: 'adet', data: Object.entries(TASK_STATUS).map(([k, l]) => ({ label: l, values: [rows.filter((r) => r.status === k).length] })) },
      {
        id: 'kisi',
        title: 'Kişiye göre açık görevler',
        kind: 'bars',
        unit: 'adet',
        series: ['Zamanında', 'Geciken'],
        stacked: true,
        data: [...count(open, (r) => r.assignee).entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 8)
          .map(([name, n]) => {
            const l = late.filter((r) => r.assignee === name).length;
            return { label: name, values: [n - l, l] };
          }),
      },
      { id: 'aylik', title: 'Aylık açılan görev', kind: 'months', unit: 'adet', data: byMonth(today, rows.map((r) => ({ date: r.created_at, values: [1] }))) },
    ],
  };
}

// ---------------------------------------------------------------- Muhasebe
function financeInsights(db: DB, user: User, today: string): Insights {
  requireFinance(user);
  const rows = db
    .prepare('SELECT kind, category, client, amount_kurus, date FROM finance_entries WHERE office_id = ?')
    .all(user.office_id) as { kind: string; category: string; client: string; amount_kurus: number; date: string }[];
  const year = today.slice(0, 4);
  const ytd = rows.filter((r) => r.date.slice(0, 4) === year);
  const sum = (kind: string, l = ytd) => tl(l.filter((r) => r.kind === kind).reduce((s, r) => s + r.amount_kurus, 0));
  const income = sum('gelir');
  const expense = sum('gider');
  const disb = sum('masraf');
  const last12 = rows.filter((r) => r.date >= `${lastMonths(today)[0]}-01`);
  return {
    kpis: [
      { label: `${year} geliri`, value: income, unit: 'tl', tone: 'iyi' },
      { label: `${year} gideri`, value: expense, unit: 'tl' },
      { label: 'Net', value: income - expense, unit: 'tl', tone: income - expense < 0 ? 'kritik' : 'iyi' },
      { label: 'Kâr marjı', value: income ? Math.round(((income - expense) / income) * 100) : 0, unit: 'yuzde' },
      { label: 'Müvekkil adına masraf', value: disb, unit: 'tl', hint: 'dava masrafları' },
    ],
    charts: [
      {
        id: 'aylik',
        title: 'Aylık gelir ve gider',
        kind: 'months',
        unit: 'tl',
        series: ['Gelir', 'Gider'],
        data: byMonth(
          today,
          rows.filter((r) => r.kind !== 'masraf').map((r) => ({ date: r.date, values: r.kind === 'gelir' ? [tl(r.amount_kurus), 0] : [0, tl(r.amount_kurus)] })),
          2,
        ),
      },
      { id: 'muvekkil', title: 'Müvekkile göre gelir (son 12 ay)', kind: 'bars', unit: 'tl', data: ranked(count(last12.filter((r) => r.kind === 'gelir'), (r) => r.client || 'Belirtilmemiş', (r) => tl(r.amount_kurus)), 6) },
      { id: 'gider', title: 'Gider kalemleri (son 12 ay)', kind: 'bars', unit: 'tl', data: ranked(count(last12.filter((r) => r.kind === 'gider'), (r) => r.category || 'Diğer', (r) => tl(r.amount_kurus)), 6) },
    ],
  };
}

// ---------------------------------------------------------------- Karar arşivi
function decisionsInsights(db: DB): Insights {
  const rows = db.prepare('SELECT court, chamber, decision_date FROM decisions').all() as { court: string; chamber: string; decision_date: string }[];
  const years = count(rows.filter((r) => /\d{4}/.test(r.decision_date)), (r) => /(\d{4})/.exec(r.decision_date)![1]);
  return {
    kpis: [
      { label: 'Arşivdeki karar', value: rows.length, unit: 'adet' },
      { label: 'Daire', value: new Set(rows.map((r) => `${r.court} ${r.chamber}`)).size, unit: 'adet' },
      { label: 'Son 5 yılın kararı', value: rows.filter((r) => Number(/(\d{4})/.exec(r.decision_date)?.[1] ?? 0) >= Number(new Date().getFullYear()) - 5).length, unit: 'adet' },
    ],
    charts: [
      { id: 'daire', title: 'Daireye göre', kind: 'bars', unit: 'adet', data: ranked(count(rows, (r) => [r.court, r.chamber].filter(Boolean).join(' ') || 'Belirtilmemiş'), 8) },
      {
        id: 'yil',
        title: 'Karar yılına göre',
        kind: 'bars',
        unit: 'adet',
        data: [...years.entries()].sort((a, b) => b[0].localeCompare(a[0])).slice(0, 10).map(([label, v]) => ({ label, values: [v] })),
      },
    ],
  };
}

export const INSIGHT_MODULES = ['cases', 'contracts', 'powers', 'enforcement', 'consultancy', 'estates', 'tasks', 'finance', 'decisions'] as const;

export function insights(db: DB, user: User, module: string, today = new Date().toISOString().slice(0, 10)): Insights {
  switch (module) {
    case 'cases':
      return casesInsights(db, user, today);
    case 'contracts':
      return contractsInsights(db, user, today);
    case 'powers':
      return powersInsights(db, user, today);
    case 'enforcement':
      return enforcementInsights(db, user, today);
    case 'consultancy':
      return consultancyInsights(db, user, today);
    case 'estates':
      return estatesInsights(db, user);
    case 'tasks':
      return tasksInsights(db, user, today);
    case 'finance':
      return financeInsights(db, user, today);
    case 'decisions':
      return decisionsInsights(db);
    default:
      throw new ApiError(404, 'Bu sayfa için analiz yok.');
  }
}
