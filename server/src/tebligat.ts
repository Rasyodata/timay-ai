import type { User } from './auth.ts';
import { assertCaseVisible, caseVisibility } from './cases.ts';
import type { DB } from './db.ts';
import { createDeadline, RULES } from './deadlines.ts';
import { ApiError } from './errors.ts';
import { DATE } from './money.ts';

/*
 * Tebligat takibi: e-tebligat (UETS), posta, Tebligat K. 21 ve ilanen tebligatlar.
 * Tebliğ tarihi kanuna göre hesaplanır, tebliğ edilen evraka göre süre önerilir ve
 * tek tıkla süre takibine (ajanda, bildirim, risk) alınır. UETS listesi yapıştırılarak toplu giriş yapılabilir.
 */

export const CHANNELS = {
  'e-tebligat': { label: 'E-tebligat (UETS)', days: 5, basis: 'Tebligat K. m.7/a, Elektronik Tebligat Yön. m.9: elektronik adrese ulaştığı günü izleyen 5. günün sonunda tebliğ edilmiş sayılır.' },
  posta: { label: 'Posta / elden', days: 0, basis: 'Tebligat K. m.10 vd.: tebliğ, muhataba ya da yerine teslim tarihinde yapılmış sayılır.' },
  tk21: { label: 'Muhtara bırakma (TK 21)', days: 0, basis: 'Tebligat K. m.21: tebliğ, ihbarnamenin kapıya yapıştırıldığı tarihte yapılmış sayılır.' },
  ilan: { label: 'İlanen tebligat', days: 7, basis: 'Tebligat K. m.31: son ilan tarihinden itibaren 7 gün sonra tebliğ edilmiş sayılır (mahkeme daha uzun süre belirleyebilir).' },
} as const;
export type Channel = keyof typeof CHANNELS;
const isChannel = (c: unknown): c is Channel => typeof c === 'string' && c in CHANNELS;
/** Süre doğurmayan tebligat (ör. duruşma davetiyesi) için kural kimliği. */
export const NO_DEADLINE = '-';
const validRule = (id: string) => !id || id === NO_DEADLINE || RULES.some((r) => r.id === id);

function addDays(date: string, days: number) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Kanala göre tebliğin yapılmış sayıldığı gün. */
export function servedDate(channel: Channel, received: string) {
  if (!DATE.test(received)) throw new ApiError(400, 'Tebligat tarihi YYYY-AA-GG biçiminde olmalı.');
  return addDays(received, CHANNELS[channel].days);
}

/** Tebliğ edilen evrakın adından ve dosyanın hukuk alanından hangi sürenin başladığını tahmin eder. */
export function suggestRule(subject: string, area = ''): string {
  const s = subject.toLocaleLowerCase('tr');
  const ceza = area === 'ceza' || /\b(hüküm|ceza dairesi|ağır ceza|asliye ceza|sulh ceza)\b/.test(s);
  const idare = area === 'idare' || /\b(idare mahkemesi|vergi mahkemesi)\b/.test(s);
  if (/ödeme emri/.test(s)) return /kambiyo|çek|bono|poliçe/.test(s) ? 'iik-kambiyo' : 'iik-itiraz';
  if (/itiraz/.test(s) && /icra|takip/.test(s)) return 'iik-itirazin-iptali';
  if (/bilirkişi/.test(s)) return 'hmk-bilirkisi';
  if (/cevaba cevap|ikinci cevap/.test(s)) return 'hmk-ikinci-cevap';
  if (/cevap dilekçe/.test(s)) return 'hmk-ikinci-cevap';
  if (/dava dilekçe/.test(s)) return idare ? '' : 'hmk-cevap';
  if (/ara karar|kesin süre|muhtıra/.test(s)) return 'hmk-kesin-sure';
  if (/bölge adliye|istinaf/.test(s) && /karar/.test(s)) return ceza ? 'cmk-temyiz' : idare ? 'iyuk-istinaf' : 'hmk-temyiz';
  if (/karar|hüküm/.test(s)) return ceza ? 'cmk-istinaf' : idare ? 'iyuk-istinaf' : 'hmk-istinaf';
  if (/işlem|tebliğname/.test(s) && idare) return 'iyuk-iptal';
  if (/fesih/.test(s)) return 'is-arabulucu';
  if (/ihtar/.test(s)) return 'kira-ihtar';
  if (/davetiye|duruşma gün|keşif gün/.test(s)) return NO_DEADLINE;
  return '';
}

interface TebligatRow {
  id: number;
  case_id: number | null;
  case_title: string | null;
  channel: Channel;
  sender: string;
  subject: string;
  received_date: string;
  served_date: string;
  rule_id: string;
  deadline_id: number | null;
  due_date: string | null;
  deadline_done: number | null;
  note: string;
  author: string;
  created_at: string;
}

const SELECT = `SELECT t.id, t.case_id, c.title AS case_title, t.channel, t.sender, t.subject, t.received_date, t.served_date, t.rule_id,
  t.deadline_id, d.due_date, d.done AS deadline_done, t.note, u.name AS author, t.created_at
  FROM tebligatlar t JOIN users u ON u.id = t.created_by LEFT JOIN cases c ON c.id = t.case_id LEFT JOIN legal_deadlines d ON d.id = t.deadline_id`;

function shape(r: TebligatRow) {
  const rule = RULES.find((x) => x.id === r.rule_id);
  return {
    ...r,
    channel_label: CHANNELS[r.channel].label,
    rule_title: rule?.title ?? '',
    status: r.deadline_id ? (r.deadline_done ? 'tamam' : 'takipte') : r.rule_id === NO_DEADLINE ? 'suresiz' : 'islenmedi',
  };
}

function visible(user: User) {
  const v = caseVisibility(user);
  return { sql: `(t.case_id IS NULL OR EXISTS (SELECT 1 FROM cases c WHERE c.id = t.case_id${v.sql}))`, params: v.params };
}

export function listTebligat(db: DB, user: User, query: { caseId?: string; status?: string } = {}) {
  const where = ['t.office_id = ?'];
  const params: unknown[] = [user.office_id];
  if (query.caseId) {
    assertCaseVisible(db, user, Number(query.caseId));
    where.push('t.case_id = ?');
    params.push(Number(query.caseId));
  } else {
    const v = visible(user);
    where.push(v.sql);
    params.push(...v.params);
  }
  if (query.status === 'islenmedi') where.push(`t.deadline_id IS NULL AND t.rule_id != '${NO_DEADLINE}'`);
  const rows = db.prepare(`${SELECT} WHERE ${where.join(' AND ')} ORDER BY t.served_date DESC, t.id DESC LIMIT 500`).all(...params) as TebligatRow[];
  return rows.map(shape);
}

function load(db: DB, user: User, id: number) {
  const row = db.prepare(`${SELECT} WHERE t.id = ? AND t.office_id = ?`).get(id, user.office_id) as TebligatRow | undefined;
  if (!row) throw new ApiError(404, 'Tebligat bulunamadı.');
  if (row.case_id) assertCaseVisible(db, user, row.case_id);
  return row;
}

export interface TebligatInput {
  caseId?: number | null;
  channel?: string;
  sender?: string;
  subject?: string;
  receivedDate?: string;
  ruleId?: string;
  note?: string;
  /** Verilirse önerilen süre hemen takibe alınır. */
  track?: boolean;
  responsibleId?: number | null;
}

function track(db: DB, user: User, t: TebligatRow, ruleId: string, responsibleId?: number | null) {
  if (!RULES.some((r) => r.id === ruleId)) throw new ApiError(400, 'Süre türü bulunamadı.');
  const rule = RULES.find((r) => r.id === ruleId)!;
  const d = createDeadline(db, user, {
    ruleId,
    start: t.served_date,
    caseId: t.case_id,
    responsibleId: responsibleId ?? undefined,
    title: `${rule.title}: ${t.subject}`.slice(0, 200),
    note: `Tebligat: ${CHANNELS[t.channel].label}, ${t.received_date.split('-').reverse().join('.')}${t.sender ? ` · ${t.sender}` : ''}`,
  }) as { id: number };
  db.prepare('UPDATE tebligatlar SET deadline_id = ?, rule_id = ? WHERE id = ?').run(d.id, ruleId, t.id);
}

export function createTebligat(db: DB, user: User, input: TebligatInput) {
  const channel = input.channel ?? 'e-tebligat';
  if (!isChannel(channel)) throw new ApiError(400, 'Tebligat kanalı geçersiz.');
  const subject = String(input.subject ?? '').trim();
  if (!subject) throw new ApiError(400, 'Tebliğ edilen evrakı yazın (ör. gerekçeli karar).');
  const received = String(input.receivedDate ?? '');
  const served = servedDate(channel, received);
  const caseId = input.caseId ? Number(input.caseId) : null;
  let area = '';
  if (caseId) {
    assertCaseVisible(db, user, caseId);
    area = (db.prepare('SELECT area FROM cases WHERE id = ?').get(caseId) as { area: string }).area;
  }
  const ruleId = input.ruleId !== undefined ? String(input.ruleId) : suggestRule(subject, area);
  if (!validRule(ruleId)) throw new ApiError(400, 'Süre türü bulunamadı.');
  const res = db
    .prepare(
      `INSERT INTO tebligatlar (office_id, case_id, channel, sender, subject, received_date, served_date, rule_id, note, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(user.office_id, caseId, channel, String(input.sender ?? '').trim(), subject, received, served, ruleId, String(input.note ?? ''), user.id);
  const id = Number(res.lastInsertRowid);
  if (input.track && ruleId && ruleId !== NO_DEADLINE) track(db, user, load(db, user, id), ruleId, input.responsibleId);
  return shape(load(db, user, id));
}

/** İşlenmemiş tebligatı süre takibine alır. */
export function trackTebligat(db: DB, user: User, id: number, input: { ruleId?: string; responsibleId?: number | null }) {
  const t = load(db, user, id);
  if (t.deadline_id) throw new ApiError(400, 'Bu tebligatın süresi zaten takipte.');
  const ruleId = String(input.ruleId ?? t.rule_id);
  if (!ruleId || ruleId === NO_DEADLINE) throw new ApiError(400, 'Süre türünü seçin.');
  track(db, user, t, ruleId, input.responsibleId);
  return shape(load(db, user, id));
}

export function updateTebligat(db: DB, user: User, id: number, input: { caseId?: number | null; note?: string; ruleId?: string }) {
  const t = load(db, user, id);
  let caseId = t.case_id;
  if (input.caseId !== undefined) {
    caseId = input.caseId ? Number(input.caseId) : null;
    if (caseId) assertCaseVisible(db, user, caseId);
  }
  const ruleId = input.ruleId !== undefined ? String(input.ruleId) : t.rule_id;
  if (!validRule(ruleId)) throw new ApiError(400, 'Süre türü bulunamadı.');
  if (t.deadline_id && ruleId !== t.rule_id) throw new ApiError(400, 'Süresi takibe alınmış tebligatın süre türü değiştirilemez; önce süreyi silin.');
  db.prepare('UPDATE tebligatlar SET case_id = ?, note = ?, rule_id = ? WHERE id = ?').run(caseId, input.note ?? t.note, ruleId, id);
  if (t.deadline_id && caseId !== t.case_id) db.prepare('UPDATE legal_deadlines SET case_id = ? WHERE id = ?').run(caseId, t.deadline_id);
  return shape(load(db, user, id));
}

export function deleteTebligat(db: DB, user: User, id: number) {
  load(db, user, id);
  db.prepare('DELETE FROM tebligatlar WHERE id = ?').run(id);
  return { ok: true };
}

/* ---------- UETS listesinden toplu giriş ---------- */

const SENDER = /([\p{L}\d.\s]*?(?:Mahkemesi|Müdürlüğü|Dairesi|Başkanlığı|Bakanlığı|Valiliği|Kaymakamlığı|Belediyesi|Savcılığı|Kurulu))/u;
const ESAS = /\b(\d{4})\/(\d{1,7})\b/;

/**
 * UETS ya da UYAP tebligat listesinden kopyalanan metni satır satır ayırır: tarih, gönderen kurum,
 * evrak ve (varsa) esas numarası. Esas numarası büroda bir dosyayla eşleşirse dosya önerilir.
 */
export function parseList(db: DB, user: User, text: string) {
  const lines = String(text ?? '')
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  if (lines.length > 500) throw new ApiError(400, 'Tek seferde en çok 500 satır yapıştırın.');
  const v = caseVisibility(user);
  const cases = db.prepare(`SELECT c.id, c.title, c.esas_no, c.area FROM cases c WHERE c.office_id = ?${v.sql}`).all(user.office_id, ...v.params) as {
    id: number;
    title: string;
    esas_no: string;
    area: string;
  }[];
  const out = [];
  for (const line of lines) {
    const m = line.match(/\b(\d{1,2})[./](\d{1,2})[./](\d{4})\b/);
    if (!m) continue;
    const [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
    if (d < 1 || d > 31 || mo < 1 || mo > 12) continue;
    const date = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const rest = line.replace(/\b\d{1,2}[./]\d{1,2}[./]\d{4}(\s+\d{1,2}:\d{2}(:\d{2})?)?/g, ' ').replace(/\s+/g, ' ').trim();
    const sender = rest.match(SENDER)?.[1].trim() ?? '';
    const esas = rest.match(ESAS)?.[0] ?? '';
    const subject = rest.replace(sender, '').replace(/^[\s\-–·|,;:]+|[\s\-–·|,;:]+$/g, '').trim() || 'Tebligat';
    const match = esas ? cases.find((c) => c.esas_no.replace(/\s/g, '') === esas) : undefined;
    out.push({
      receivedDate: date,
      sender,
      subject: subject.slice(0, 300),
      esasNo: esas,
      caseId: match?.id ?? null,
      caseTitle: match?.title ?? '',
      ruleId: suggestRule(subject, match?.area ?? ''),
      servedDate: servedDate('e-tebligat', date),
    });
  }
  return out;
}

/** Bildirim ve riskler için: süreye bağlanmamış tebligatlar. */
export function untracked(db: DB, user: User) {
  return listTebligat(db, user, { status: 'islenmedi' });
}
