import type { User } from './auth.ts';
import { renewalNotice } from './clm.ts';
import type { DB } from './db.ts';
import { ApiError } from './errors.ts';
import { DATE, optionalDate, ownedCaseId } from './money.ts';
import { poaRisks } from './poa.ts';

/**
 * Önleyici hukuk: yasal süre hesaplayıcı, süre takibi ve büro genelinde risk uyarıları.
 * Süreler bilgi amaçlıdır; dini bayramlar gibi yıldan yıla değişen tatiller hesaba katılmaz.
 */

type Unit = 'gun' | 'hafta' | 'ay' | 'yil';

export interface DeadlineRule {
  id: string;
  group: string;
  title: string;
  amount: number;
  unit: Unit;
  start: string;
  basis: string;
  /** Adli tatilde işlemeyen yargılama süresi mi (HMK 104). */
  judicial: boolean;
  /** Sona erdiği gün tatilse izleyen iş gününe uzar mı (usul süreleri). */
  businessDay: boolean;
}

const r = (
  id: string,
  group: string,
  title: string,
  amount: number,
  unit: Unit,
  start: string,
  basis: string,
  judicial = false,
  businessDay = true,
): DeadlineRule => ({ id, group, title, amount, unit, start, basis, judicial, businessDay });

export const RULES: DeadlineRule[] = [
  r('hmk-cevap', 'Hukuk yargılaması', 'Cevap dilekçesi', 2, 'hafta', 'Dava dilekçesinin tebliği', 'HMK 127', true),
  r('hmk-ikinci-cevap', 'Hukuk yargılaması', 'Cevaba cevap / ikinci cevap dilekçesi', 2, 'hafta', 'Önceki dilekçenin tebliği', 'HMK 136', true),
  r('hmk-istinaf', 'Hukuk yargılaması', 'İstinaf başvurusu', 2, 'hafta', 'Kararın tebliği', 'HMK 345', true),
  r('hmk-temyiz', 'Hukuk yargılaması', 'Temyiz başvurusu', 1, 'ay', 'Kararın tebliği', 'HMK 361', true),
  r('hmk-bilirkisi', 'Hukuk yargılaması', 'Bilirkişi raporuna itiraz', 2, 'hafta', 'Raporun tebliği', 'HMK 281', true),
  r('hmk-kesin-sure', 'Hukuk yargılaması', 'Mahkemenin verdiği kesin süre (2 hafta)', 2, 'hafta', 'Ara kararın tebliği', 'HMK 94', true),
  r('cmk-istinaf', 'Ceza yargılaması', 'İstinaf başvurusu', 2, 'hafta', 'Hükmün açıklanması / tebliği', 'CMK 273'),
  r('cmk-temyiz', 'Ceza yargılaması', 'Temyiz başvurusu', 2, 'hafta', 'Hükmün açıklanması / tebliği', 'CMK 291'),
  r('cmk-itiraz', 'Ceza yargılaması', 'Karara itiraz', 7, 'gun', 'Kararın öğrenilmesi', 'CMK 268'),
  r('tck-sikayet', 'Ceza yargılaması', 'Şikâyet süresi', 6, 'ay', 'Fiilin ve failin öğrenilmesi', 'TCK 73', false, false),
  r('iik-itiraz', 'İcra', 'Ödeme emrine itiraz (genel haciz)', 7, 'gun', 'Ödeme emrinin tebliği', 'İİK 62'),
  r('iik-kambiyo', 'İcra', 'Kambiyo takibine itiraz', 5, 'gun', 'Ödeme emrinin tebliği', 'İİK 168'),
  r('iik-sikayet', 'İcra', 'İcra memuru işlemini şikâyet', 7, 'gun', 'İşlemin öğrenilmesi', 'İİK 16'),
  r('iik-itirazin-iptali', 'İcra', 'İtirazın iptali davası', 1, 'yil', 'İtirazın tebliği', 'İİK 67'),
  r('iik-itirazin-kaldirilmasi', 'İcra', 'İtirazın kaldırılması talebi', 6, 'ay', 'İtirazın tebliği', 'İİK 68'),
  r('iik-haciz-isteme', 'İcra', 'Haciz isteme süresi', 1, 'yil', 'Ödeme emrinin tebliği', 'İİK 78'),
  r('iik-satis-isteme', 'İcra', 'Satış isteme süresi', 1, 'yil', 'Haciz tarihi', 'İİK 106'),
  r('is-arabulucu', 'İş hukuku', 'İşe iade için arabulucuya başvuru', 1, 'ay', 'Fesih bildiriminin tebliği', 'İş K. 20'),
  r('is-dava', 'İş hukuku', 'Arabuluculukta anlaşamama sonrası işe iade davası', 2, 'hafta', 'Son tutanak tarihi', 'İş K. 20', true),
  r('is-alacak', 'İş hukuku', 'İşçilik alacakları zamanaşımı', 5, 'yil', 'İş sözleşmesinin sona ermesi', 'İş K. 32, TBK 147', false, false),
  r('iyuk-iptal', 'İdare ve vergi', 'İdari dava açma süresi', 60, 'gun', 'İşlemin tebliği', 'İYUK 7', true),
  r('iyuk-vergi', 'İdare ve vergi', 'Vergi mahkemesinde dava açma', 30, 'gun', 'İşlemin tebliği', 'İYUK 7', true),
  r('iyuk-istinaf', 'İdare ve vergi', 'İdari yargıda istinaf / temyiz', 30, 'gun', 'Kararın tebliği', 'İYUK 45, 46', true),
  r('tbk-genel', 'Zamanaşımı', 'Genel zamanaşımı', 10, 'yil', 'Alacağın muaccel olması', 'TBK 146', false, false),
  r('tbk-bes', 'Zamanaşımı', 'Kira, faiz, vekâlet ücreti vb. alacaklar', 5, 'yil', 'Alacağın muaccel olması', 'TBK 147', false, false),
  r('tbk-haksiz', 'Zamanaşımı', 'Haksız fiil tazminatı', 2, 'yil', 'Zararın ve failin öğrenilmesi (en geç 10 yıl)', 'TBK 72', false, false),
  r('tbk-sebepsiz', 'Zamanaşımı', 'Sebepsiz zenginleşme', 2, 'yil', 'Geri isteme hakkının öğrenilmesi (en geç 10 yıl)', 'TBK 82', false, false),
  r('ttk-cek', 'Zamanaşımı', 'Çekte müracaat hakkı', 6, 'ay', 'İbraz süresinin bitimi', 'TTK 814', false, false),
  r('ttk-bono', 'Zamanaşımı', 'Bono / poliçede asıl borçluya karşı', 3, 'yil', 'Vade tarihi', 'TTK 749', false, false),
  r('tmk-ret', 'Aile ve miras', 'Mirasın reddi', 3, 'ay', 'Ölümün öğrenilmesi', 'TMK 606', false, false),
  r('tmk-tenkis', 'Aile ve miras', 'Tenkis davası', 1, 'yil', 'Saklı payın zedelendiğinin öğrenilmesi', 'TMK 571', false, false),
  r('tmk-bosanma-tazminat', 'Aile ve miras', 'Boşanma sonrası nafaka / tazminat davası', 1, 'yil', 'Boşanma kararının kesinleşmesi', 'TMK 178', false, false),
  r('kira-tahliye-taahhut', 'Kira', 'Tahliye taahhüdüne dayalı takip / dava', 1, 'ay', 'Taahhüt edilen tahliye tarihi', 'TBK 352/1'),
  r('kira-ihtar', 'Kira', 'Kira bedelinin ödenmesi için ihtar süresi (konut)', 30, 'gun', 'İhtarın tebliği', 'TBK 315', false, false),
];

// Sabit resmî tatiller (AA-GG). Dinî bayramlar her yıl değiştiği için eklenmez.
const HOLIDAYS = ['01-01', '04-23', '05-01', '05-19', '07-15', '08-30', '10-29'];

function iso(d: Date) {
  return d.toISOString().slice(0, 10);
}

function parse(date: string) {
  return new Date(`${date}T00:00:00Z`);
}

function isHoliday(d: Date) {
  const day = d.getUTCDay();
  return day === 0 || day === 6 || HOLIDAYS.includes(iso(d).slice(5));
}

/** Kurala göre son günü hesaplar ve hangi uzatmaların uygulandığını açıklar. */
export function computeDeadline(rule: Pick<DeadlineRule, 'amount' | 'unit' | 'judicial' | 'businessDay'>, start: string) {
  if (!DATE.test(start)) throw new ApiError(400, 'Başlangıç tarihi YYYY-AA-GG biçiminde olmalı.');
  const d = parse(start);
  const notes: string[] = [];
  if (rule.unit === 'gun') d.setUTCDate(d.getUTCDate() + rule.amount);
  else if (rule.unit === 'hafta') d.setUTCDate(d.getUTCDate() + rule.amount * 7);
  else {
    // Ay ve yıl sürelerinde son gün, başlangıca karşılık gelen gündür; o ayda yoksa ayın son günü.
    const months = rule.unit === 'ay' ? rule.amount : rule.amount * 12;
    const day = d.getUTCDate();
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() + months);
    const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
    d.setUTCDate(Math.min(day, last));
  }
  if (rule.judicial) {
    const y = d.getUTCFullYear();
    const tatilStart = `${y}-07-20`;
    const tatilEnd = `${y}-08-31`;
    if (iso(d) >= tatilStart && iso(d) <= tatilEnd) {
      d.setTime(parse(`${y}-09-07`).getTime());
      notes.push('Adli tatile rastladığı için tatilin bitiminden itibaren 1 hafta uzadı (HMK 104).');
    }
  }
  if (rule.businessDay) {
    const before = iso(d);
    while (isHoliday(d)) d.setUTCDate(d.getUTCDate() + 1);
    if (iso(d) !== before) notes.push('Son gün tatile rastladığı için izleyen ilk iş gününe uzadı (HMK 93).');
  }
  return { date: iso(d), notes };
}

export function calculate(input: { ruleId?: string; start?: string }) {
  const rule = RULES.find((x) => x.id === input.ruleId);
  if (!rule) throw new ApiError(400, 'Süre türü bulunamadı.');
  return { rule, ...computeDeadline(rule, input.start ?? '') };
}

// ---------- Süre takibi ----------
export function listDeadlines(db: DB, user: User, query: { all?: string } = {}) {
  return db
    .prepare(
      `SELECT d.*, k.title AS case_title, u.name AS responsible_name FROM legal_deadlines d
       LEFT JOIN cases k ON k.id = d.case_id LEFT JOIN users u ON u.id = d.responsible_id
       WHERE d.office_id = ? ${query.all === '1' ? '' : 'AND d.done = 0'} ORDER BY d.done, d.due_date`,
    )
    .all(user.office_id);
}

export function createDeadline(
  db: DB,
  user: User,
  input: { title?: string; ruleId?: string; start?: string; dueDate?: string; caseId?: number | null; responsibleId?: number | null; note?: string },
) {
  let title = input.title?.trim() ?? '';
  let due = optionalDate(input.dueDate, 'Son gün');
  let basis = '';
  if (input.ruleId) {
    const c = calculate({ ruleId: input.ruleId, start: input.start });
    title ||= c.rule.title;
    due ||= c.date;
    basis = `${c.rule.basis}${c.notes.length ? ` · ${c.notes.join(' ')}` : ''}`;
  }
  if (!title) throw new ApiError(400, 'Süre başlığı zorunludur.');
  if (!due) throw new ApiError(400, 'Son gün ya da hesaplanacak süre türü gerekli.');
  const responsible = input.responsibleId ?? user.id;
  if (!db.prepare('SELECT 1 FROM users WHERE id = ? AND office_id = ?').get(responsible, user.office_id)) {
    throw new ApiError(400, 'Sorumlu yalnızca büro çalışanı olabilir.');
  }
  const res = db
    .prepare(
      `INSERT INTO legal_deadlines (office_id, case_id, title, rule_id, start_date, due_date, basis, note, responsible_id, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      user.office_id,
      ownedCaseId(db, user.office_id, input.caseId),
      title,
      input.ruleId ?? '',
      optionalDate(input.start, 'Başlangıç tarihi'),
      due,
      basis,
      input.note ?? '',
      responsible,
      user.id,
    );
  return db.prepare('SELECT * FROM legal_deadlines WHERE id = ?').get(Number(res.lastInsertRowid));
}

export function setDeadlineDone(db: DB, user: User, id: number, done: boolean) {
  const r0 = db.prepare('UPDATE legal_deadlines SET done = ? WHERE id = ? AND office_id = ?').run(done ? 1 : 0, id, user.office_id);
  if (r0.changes === 0) throw new ApiError(404, 'Süre bulunamadı.');
  return { ok: true };
}

export function deleteDeadline(db: DB, user: User, id: number) {
  const r0 = db.prepare('DELETE FROM legal_deadlines WHERE id = ? AND office_id = ?').run(id, user.office_id);
  if (r0.changes === 0) throw new ApiError(404, 'Süre bulunamadı.');
  return { ok: true };
}

// ---------- Risk uyarıları ----------
export interface Risk {
  level: 'yuksek' | 'orta';
  area: string;
  title: string;
  detail: string;
  link: { view: string; id?: number } | null;
}

function addDays(days: number) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return iso(d);
}

/** Büronun tüm modüllerini tarayıp kaçırılabilecek süre ve riskleri listeler. */
export function risks(db: DB, user: User): Risk[] {
  const o = user.office_id;
  const today = addDays(0);
  const all = <T>(sql: string, ...p: unknown[]) => db.prepare(sql).all(...p) as T[];
  const out: Risk[] = [];

  for (const d of all<{ id: number; title: string; due_date: string; case_title: string | null }>(
    `SELECT d.id, d.title, d.due_date, k.title AS case_title FROM legal_deadlines d LEFT JOIN cases k ON k.id = d.case_id
     WHERE d.office_id = ? AND d.done = 0 AND d.due_date <= ?`,
    o,
    addDays(7),
  )) {
    const overdue = d.due_date < today;
    out.push({
      level: overdue || d.due_date <= addDays(2) ? 'yuksek' : 'orta',
      area: 'Süre',
      title: `${overdue ? 'Süresi geçti' : 'Süre doluyor'}: ${d.title}`,
      detail: [d.case_title, `son gün ${d.due_date.split('-').reverse().join('.')}`].filter(Boolean).join(' · '),
      link: { view: 'deadlines' },
    });
  }

  for (const f of all<{ id: number; debtor: string; last: string }>(
    `SELECT f.id, f.debtor, COALESCE((SELECT MAX(date) FROM enforcement_actions a WHERE a.file_id = f.id), f.start_date) AS last
     FROM enforcement_files f WHERE f.office_id = ? AND f.status NOT IN ('tahsil', 'kapandi')`,
    o,
  )) {
    if (f.last && f.last <= addDays(-300)) {
      out.push({
        level: f.last <= addDays(-365) ? 'yuksek' : 'orta',
        area: 'İcra',
        title: `İcra dosyasında uzun süredir işlem yok: ${f.debtor}`,
        detail: 'Haciz ve satış isteme süreleri 1 yıldır (İİK 78, 106); dosya düşebilir.',
        link: { view: 'enforcement-file', id: f.id },
      });
    }
  }

  for (const c of all<{ id: number; title: string; end_date: string; body: string }>(
    `SELECT id, title, end_date, body FROM contracts WHERE office_id = ? AND status = 'yururlukte' AND end_date != '' AND end_date <= ?`,
    o,
    addDays(60),
  )) {
    // Otomatik uzayan sözleşmede bitişten 60 gün önce, fesih ihbarının son gününü bildir.
    const renewal = renewalNotice(c.body, c.end_date);
    if (renewal && c.end_date >= today) {
      const last = renewal.lastNoticeDate.split('-').reverse().join('.');
      out.push({
        level: renewal.lastNoticeDate <= addDays(7) ? 'yuksek' : 'orta',
        area: 'Sözleşme',
        title: `Otomatik uzayacak: ${c.title}`,
        detail: `Sözleşme ${c.end_date.split('-').reverse().join('.')} tarihinde bitiyor. ${renewal.noticeDays ? `${last} tarihine kadar fesih ihbarı gönderilmezse` : 'Fesih ihbarı gönderilmezse'} kendiliğinden uzayacak. Mevcut şartlardan memnun musunuz?`,
        link: { view: 'contract', id: c.id },
      });
      continue;
    }
    if (c.end_date > addDays(30)) continue;
    out.push({
      level: c.end_date < today ? 'yuksek' : 'orta',
      area: 'Sözleşme',
      title: `${c.end_date < today ? 'Süresi bitmiş ama yürürlükte görünüyor' : 'Sözleşme bitiyor'}: ${c.title}`,
      detail: 'Yenileme, fesih bildirimi ya da otomatik uzama maddesini kontrol edin.',
      link: { view: 'contract', id: c.id },
    });
  }

  for (const o2 of all<{ contract_id: number; title: string; text: string; due_date: string }>(
    `SELECT o.contract_id, k.title, o.text, o.due_date FROM contract_obligations o JOIN contracts k ON k.id = o.contract_id
     WHERE k.office_id = ? AND o.done = 0 AND o.due_date != '' AND o.due_date < ?`,
    o,
    today,
  )) {
    out.push({
      level: 'yuksek',
      area: 'Sözleşme',
      title: `Yerine getirilmemiş taahhüt: ${o2.title}`,
      detail: `${o2.text} · son gün ${o2.due_date.split('-').reverse().join('.')}, ${Math.round((Date.parse(today) - Date.parse(o2.due_date)) / 86_400_000)} gün gecikti. Gecikme tazminatı ve ihtarname taslağı sözleşme sayfasında.`,
      link: { view: 'contract', id: o2.contract_id },
    });
  }

  for (const c of all<{ id: number; title: string }>(
    `SELECT c.id, c.title FROM cases c WHERE c.office_id = ? AND c.status = 'acik'
     AND NOT EXISTS (SELECT 1 FROM hearings h WHERE h.case_id = c.id AND h.date >= ?)
     AND NOT EXISTS (SELECT 1 FROM legal_deadlines d WHERE d.case_id = c.id AND d.done = 0)`,
    o,
    today,
  )) {
    out.push({
      level: 'orta',
      area: 'Dava',
      title: `Açık dosyada ileri tarihli duruşma ya da süre yok: ${c.title}`,
      detail: 'Dosyanın son durumunu UYAP’tan kontrol edip duruşma ya da süre girin.',
      link: { view: 'case', id: c.id },
    });
  }

  const vek = poaRisks(db, user, today, addDays(30));
  for (const p of vek.poa) out.push({ level: p.level, area: 'Vekâletname', title: p.title, detail: p.detail, link: { view: 'powers', id: p.id } });
  if (vek.missing.length) {
    out.push({
      level: 'orta',
      area: 'Vekâletname',
      title: `${vek.missing.length} açık dosyada geçerli vekâletname kaydı yok`,
      detail: vek.missing.slice(0, 5).map((c) => c.title).join(', ') + (vek.missing.length > 5 ? '…' : ''),
      link: { view: 'powers' },
    });
  }

  for (const t of all<{ title: string; due_date: string; assignee: string }>(
    `SELECT t.title, t.due_date, u.name AS assignee FROM tasks t JOIN users u ON u.id = t.assignee_id
     WHERE t.office_id = ? AND t.done = 0 AND t.due_date != '' AND t.due_date < ?`,
    o,
    today,
  )) {
    out.push({ level: 'orta', area: 'Görev', title: `Gecikmiş görev: ${t.title}`, detail: `Sorumlu: ${t.assignee}`, link: { view: 'tasks' } });
  }

  return out.sort((a, b) => (a.level === b.level ? 0 : a.level === 'yuksek' ? -1 : 1));
}
