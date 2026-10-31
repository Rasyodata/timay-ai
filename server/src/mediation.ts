import type { User } from './auth.ts';
import type { DB } from './db.ts';
import { ApiError } from './errors.ts';
import { DATE, optionalDate, ownedCaseId, toKurus } from './money.ts';

/*
 * Arabuluculuk: arabulucu avukatın dosyaları, tarafları, toplantıları; sıradaki adım ve yasal süre;
 * davet mektubu, toplantı tutanağı, son tutanak ve anlaşma belgesi taslakları (arabulucu profili ve
 * taraf bilgileriyle doldurulur); ücretin Arabuluculuk Asgari Ücret Tarifesine göre hesabı.
 */

export const TARIFF_YEAR = 2026;
/** 2026 Arabuluculuk Asgari Ücret Tarifesi (RG 26.12.2025). Her yıl başında güncellenmelidir. */
type Kind = { label: string; weeks: number | null; ext: number; min: number; hourly: [number, number, number, number] };
export const KINDS: Record<string, Kind> = {
  is: { label: 'İşçi-işveren', weeks: 3, ext: 1, min: 9000, hourly: [1130, 2460, 2560, 2660] },
  ticari: { label: 'Ticari', weeks: 6, ext: 2, min: 13000, hourly: [1500, 3200, 3300, 3400] },
  tuketici: { label: 'Tüketici', weeks: 3, ext: 1, min: 9000, hourly: [1000, 2200, 2300, 2400] },
  kira: { label: 'Kira', weeks: 3, ext: 1, min: 9000, hourly: [1170, 2540, 2640, 2740] },
  kat: { label: 'Kat mülkiyeti', weeks: 3, ext: 1, min: 9000, hourly: [1170, 2540, 2640, 2740] },
  komsu: { label: 'Komşu hakkı', weeks: 3, ext: 1, min: 9000, hourly: [1170, 2540, 2640, 2740] },
  ortaklik: { label: 'Ortaklığın giderilmesi', weeks: 3, ext: 1, min: 13000, hourly: [1170, 2540, 2640, 2740] },
  aile: { label: 'Aile', weeks: null, ext: 0, min: 9000, hourly: [1000, 2200, 2300, 2400] },
  diger: { label: 'Diğer', weeks: null, ext: 0, min: 9000, hourly: [1000, 2200, 2300, 2400] },
};
// Anlaşmada: anlaşılan tutar dilimlerine göre yüzde (tek arabulucu).
const BRACKETS: [number, number][] = [
  [600_000, 6],
  [960_000, 5],
  [1_560_000, 4],
  [3_120_000, 3],
  [9_360_000, 2],
  [12_480_000, 1.5],
  [24_960_000, 1],
  [Infinity, 0.5],
];
export const STATUSES: Record<string, string> = {
  basvuru: 'Başvuru / görevlendirme',
  davet: 'Taraflar davet edildi',
  gorusme: 'Görüşmeler sürüyor',
  anlasma: 'Anlaşma',
  kismi: 'Kısmen anlaşma',
  anlasmama: 'Anlaşamama',
  sonlandi: 'Diğer sebeple sona erdi',
};
const CLOSED = ['anlasma', 'kismi', 'anlasmama', 'sonlandi'];

interface FileRow {
  id: number;
  mediator_id: number;
  case_id: number | null;
  buro_no: string;
  arb_no: string;
  kind: string;
  mandatory: number;
  subject: string;
  claim_kurus: number;
  assigned_date: string;
  adliye: string;
  status: string;
  result_kurus: number;
  hours: number;
  result_terms: string;
  note: string;
}
interface Party {
  id: number;
  side: 'basvurucu' | 'karsi';
  name: string;
  id_no: string;
  address: string;
  phone: string;
  email: string;
  lawyer: string;
}
interface Meeting {
  id: number;
  date: string;
  time: string;
  place: string;
  method: string;
  note: string;
}

const tl = (n: number) => `${n.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} TL`;
const dmy = (d: string) => (d ? d.split('-').reverse().join('.') : '…');
const addDays = (d: string, n: number) => new Date(Date.parse(d) + n * 86_400_000).toISOString().slice(0, 10);

/** Ücret hesabı (TL). Anlaşmada yüzde dilimleri ve taban; anlaşamamada saat ücreti, zorunlu arabuluculukta ilk 2 saat Hazineden. */
export function computeFee(input: { kind: string; parties: number; status: string; resultTL: number; hours: number; mandatory: boolean }) {
  const k = KINDS[input.kind] ?? KINDS.diger;
  const band = input.parties <= 2 ? 0 : input.parties <= 5 ? 1 : input.parties <= 10 ? 2 : 3;
  const hourly = k.hourly[band];
  const hours = Math.max(2, Number(input.hours) || 2);
  const lines: string[] = [];
  let total = 0;
  let treasury = 0;
  if ((input.status === 'anlasma' || input.status === 'kismi') && input.resultTL > 0) {
    let left = input.resultTL;
    let pct = 0;
    for (const [size, rate] of BRACKETS) {
      const part = Math.min(left, size);
      if (part <= 0) break;
      pct += (part * rate) / 100;
      lines.push(`${tl(part)} × %${rate} = ${tl((part * rate) / 100)}`);
      left -= part;
    }
    const floor = Math.max(k.min, hourly * 2);
    total = Math.max(pct, floor);
    if (total > pct) lines.push(`Yüzdeyle bulunan ${tl(pct)} tarifedeki tabanın (${tl(floor)}) altında kaldığı için taban uygulanır.`);
  } else if (input.status === 'anlasma' || input.status === 'kismi') {
    total = Math.max(hourly * hours, k.min);
    lines.push(`Konusu para olmayan anlaşma: ${hours} saat × ${tl(hourly)} (en az ${tl(k.min)}).`);
  } else {
    total = hourly * hours;
    lines.push(`${hours} saat × ${tl(hourly)} (${input.parties} taraf) = ${tl(total)}`);
    if (input.mandatory) {
      treasury = Math.min(total, hourly * 2);
      lines.push(`Zorunlu arabuluculukta anlaşamama: ilk 2 saatin ücreti (${tl(treasury)}) Adalet Bakanlığı bütçesinden ödenir.`);
    }
  }
  const byParties = total - treasury;
  return { year: TARIFF_YEAR, hourly, total, treasury, byParties, perSide: byParties / 2, lines };
}

/** Zorunlu arabuluculukta görüşmelerin bitirilmesi gereken süre (hafta) ve uzatmalı son gün. */
export function legalDeadline(kind: string, assigned: string, mandatory: boolean) {
  const k = KINDS[kind];
  if (!mandatory || !k?.weeks || !DATE.test(assigned)) return null;
  return { weeks: k.weeks, ext: k.ext, due: addDays(assigned, k.weeks * 7), extended: addDays(assigned, (k.weeks + k.ext) * 7) };
}

function load(db: DB, user: User, id: number) {
  const f = db.prepare('SELECT * FROM mediation_files WHERE id = ? AND office_id = ?').get(id, user.office_id) as FileRow | undefined;
  if (!f) throw new ApiError(404, 'Arabuluculuk dosyası bulunamadı.');
  return f;
}

function nextStep(f: FileRow, parties: Party[], meetings: Meeting[], today: string) {
  if (!parties.some((p) => p.side === 'basvurucu') || !parties.some((p) => p.side === 'karsi')) return { text: 'Başvurucu ve karşı tarafı ekleyin.', doc: '' };
  if (CLOSED.includes(f.status)) return { text: 'Dosya sonuçlandı. Son tutanağı adliyeye gönderin, ücret hesabını kontrol edin.', doc: 'son_tutanak' };
  if (!meetings.length) return { text: 'Taraflara davet mektubu gönderin ve ilk toplantıyı planlayın.', doc: 'davet' };
  const upcoming = meetings.filter((m) => m.date >= today).sort((a, b) => a.date.localeCompare(b.date))[0];
  if (upcoming) return { text: `${dmy(upcoming.date)} ${upcoming.time} toplantısına hazırlanın.`, doc: 'toplanti' };
  return { text: 'Son toplantı yapıldı. Sonucu (anlaşma / anlaşamama) girin ve son tutanağı düzenleyin.', doc: 'son_tutanak' };
}

export function listFiles(db: DB, user: User, today = new Date().toISOString().slice(0, 10)) {
  const rows = db
    .prepare(
      `SELECT f.*, u.name AS mediator,
         (SELECT group_concat(name, ', ') FROM mediation_parties p WHERE p.file_id = f.id AND p.side = 'basvurucu') AS applicants,
         (SELECT group_concat(name, ', ') FROM mediation_parties p WHERE p.file_id = f.id AND p.side = 'karsi') AS respondents,
         (SELECT MIN(date) FROM mediation_meetings m WHERE m.file_id = f.id AND m.date >= ?) AS next_meeting
       FROM mediation_files f JOIN users u ON u.id = f.mediator_id WHERE f.office_id = ? ORDER BY f.id DESC`,
    )
    .all(today, user.office_id) as (FileRow & { mediator: string; applicants: string | null; respondents: string | null; next_meeting: string | null })[];
  return rows.map((r) => ({ ...r, kind_label: KINDS[r.kind]?.label ?? r.kind, status_label: STATUSES[r.status] ?? r.status, deadline: CLOSED.includes(r.status) ? null : legalDeadline(r.kind, r.assigned_date, Boolean(r.mandatory)) }));
}

interface FileInput {
  buroNo?: string;
  arbNo?: string;
  kind?: string;
  mandatory?: boolean;
  subject?: string;
  claim?: string | number;
  assignedDate?: string;
  adliye?: string;
  status?: string;
  result?: string | number;
  hours?: number | string;
  resultTerms?: string;
  note?: string;
  caseId?: number | null;
}

function check(input: FileInput) {
  if (input.kind !== undefined && !KINDS[input.kind]) throw new ApiError(400, 'Geçersiz uyuşmazlık türü.');
  if (input.status !== undefined && !STATUSES[input.status]) throw new ApiError(400, 'Geçersiz durum.');
  if (input.hours !== undefined && !(Number(input.hours) > 0)) throw new ApiError(400, 'Görüşme süresi (saat) geçerli değil.');
}

export function createFile(db: DB, user: User, input: FileInput) {
  check(input);
  const r = db
    .prepare(
      `INSERT INTO mediation_files (office_id, mediator_id, case_id, buro_no, arb_no, kind, mandatory, subject, claim_kurus, assigned_date, adliye, note)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      user.office_id,
      user.id,
      ownedCaseId(db, user.office_id, input.caseId),
      String(input.buroNo ?? '').trim(),
      String(input.arbNo ?? '').trim(),
      input.kind ?? 'is',
      input.mandatory === false ? 0 : 1,
      String(input.subject ?? '').trim(),
      toKurus(input.claim, 'Talep tutarı'),
      optionalDate(input.assignedDate, 'Görevlendirme tarihi'),
      String(input.adliye ?? '').trim(),
      String(input.note ?? ''),
    );
  return getFile(db, user, Number(r.lastInsertRowid));
}

export function updateFile(db: DB, user: User, id: number, input: FileInput) {
  const f = load(db, user, id);
  check(input);
  db.prepare(
    `UPDATE mediation_files SET buro_no = ?, arb_no = ?, kind = ?, mandatory = ?, subject = ?, claim_kurus = ?, assigned_date = ?, adliye = ?,
       status = ?, result_kurus = ?, hours = ?, result_terms = ?, note = ? WHERE id = ?`,
  ).run(
    input.buroNo ?? f.buro_no,
    input.arbNo ?? f.arb_no,
    input.kind ?? f.kind,
    input.mandatory === undefined ? f.mandatory : input.mandatory ? 1 : 0,
    input.subject ?? f.subject,
    input.claim !== undefined ? toKurus(input.claim, 'Talep tutarı') : f.claim_kurus,
    input.assignedDate !== undefined ? optionalDate(input.assignedDate, 'Görevlendirme tarihi') : f.assigned_date,
    input.adliye ?? f.adliye,
    input.status ?? f.status,
    input.result !== undefined ? toKurus(input.result, 'Anlaşma tutarı') : f.result_kurus,
    input.hours !== undefined ? Number(input.hours) : f.hours,
    input.resultTerms ?? f.result_terms,
    input.note ?? f.note,
    id,
  );
  return getFile(db, user, id);
}

export function getFile(db: DB, user: User, id: number, today = new Date().toISOString().slice(0, 10)) {
  const f = load(db, user, id);
  const parties = db.prepare('SELECT * FROM mediation_parties WHERE file_id = ? ORDER BY side, id').all(id) as Party[];
  const meetings = db.prepare('SELECT * FROM mediation_meetings WHERE file_id = ? ORDER BY date, time, id').all(id) as Meeting[];
  const fee = computeFee({ kind: f.kind, parties: parties.length || 2, status: f.status, resultTL: f.result_kurus / 100, hours: f.hours, mandatory: Boolean(f.mandatory) });
  return {
    ...f,
    mandatory: Boolean(f.mandatory),
    kind_label: KINDS[f.kind]?.label ?? f.kind,
    status_label: STATUSES[f.status] ?? f.status,
    parties,
    meetings,
    deadline: legalDeadline(f.kind, f.assigned_date, Boolean(f.mandatory)),
    next: nextStep(f, parties, meetings, today),
    fee,
  };
}

export function addParty(db: DB, user: User, fileId: number, input: Partial<Party>) {
  load(db, user, fileId);
  if (!String(input.name ?? '').trim()) throw new ApiError(400, 'Taraf adı zorunludur.');
  if (input.side !== 'basvurucu' && input.side !== 'karsi') throw new ApiError(400, 'Taraf başvurucu ya da karşı taraf olmalı.');
  db.prepare('INSERT INTO mediation_parties (file_id, side, name, id_no, address, phone, email, lawyer) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
    fileId,
    input.side,
    String(input.name).trim(),
    String(input.id_no ?? '').trim(),
    String(input.address ?? '').trim(),
    String(input.phone ?? '').trim(),
    String(input.email ?? '').trim(),
    String(input.lawyer ?? '').trim(),
  );
  return getFile(db, user, fileId);
}

export function deleteParty(db: DB, user: User, id: number) {
  const p = db.prepare('SELECT p.file_id FROM mediation_parties p JOIN mediation_files f ON f.id = p.file_id WHERE p.id = ? AND f.office_id = ?').get(id, user.office_id) as { file_id: number } | undefined;
  if (!p) throw new ApiError(404, 'Taraf bulunamadı.');
  db.prepare('DELETE FROM mediation_parties WHERE id = ?').run(id);
  return getFile(db, user, p.file_id);
}

export function addMeeting(db: DB, user: User, fileId: number, input: Partial<Meeting>) {
  const f = load(db, user, fileId);
  if (!DATE.test(String(input.date ?? ''))) throw new ApiError(400, 'Toplantı tarihi YYYY-AA-GG biçiminde olmalı.');
  const method = input.method === 'telekonferans' ? 'telekonferans' : 'yuz_yuze';
  db.prepare('INSERT INTO mediation_meetings (file_id, date, time, place, method, note) VALUES (?, ?, ?, ?, ?, ?)').run(
    fileId,
    input.date,
    String(input.time ?? ''),
    String(input.place ?? ''),
    method,
    String(input.note ?? ''),
  );
  if (f.status === 'basvuru') db.prepare("UPDATE mediation_files SET status = 'davet' WHERE id = ?").run(fileId);
  return getFile(db, user, fileId);
}

export function deleteMeeting(db: DB, user: User, id: number) {
  const m = db.prepare('SELECT m.file_id FROM mediation_meetings m JOIN mediation_files f ON f.id = m.file_id WHERE m.id = ? AND f.office_id = ?').get(id, user.office_id) as { file_id: number } | undefined;
  if (!m) throw new ApiError(404, 'Toplantı bulunamadı.');
  db.prepare('DELETE FROM mediation_meetings WHERE id = ?').run(id);
  return getFile(db, user, m.file_id);
}

/* ---------- Arabulucu profili ---------- */

const PROFILE_FIELDS = ['sicil_no', 'id_no', 'address', 'phone', 'email', 'iban'] as const;

export function getProfile(db: DB, user: User, userId = user.id) {
  const row = db.prepare('SELECT * FROM mediator_profiles WHERE user_id = ?').get(userId) as Record<string, string> | undefined;
  const name = (db.prepare('SELECT name FROM users WHERE id = ?').get(userId) as { name: string }).name;
  return { name, ...Object.fromEntries(PROFILE_FIELDS.map((k) => [k, row?.[k] ?? ''])) } as { name: string } & Record<(typeof PROFILE_FIELDS)[number], string>;
}

export function saveProfile(db: DB, user: User, input: Record<string, unknown>) {
  const v = PROFILE_FIELDS.map((k) => String(input[k] ?? '').trim());
  db.prepare(
    `INSERT INTO mediator_profiles (user_id, ${PROFILE_FIELDS.join(', ')}) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET ${PROFILE_FIELDS.map((k) => `${k} = excluded.${k}`).join(', ')}`,
  ).run(user.id, ...v);
  return getProfile(db, user);
}

/* ---------- Belge taslakları ---------- */

export const DOCS: Record<string, string> = {
  davet: 'Davet mektubu',
  toplanti: 'Toplantı tutanağı',
  son_tutanak: 'Son tutanak',
  anlasma: 'Anlaşma belgesi',
  ucret: 'Ücret hesabı',
};

export function buildDocument(db: DB, user: User, fileId: number, type: string, opts: { partyId?: number; meetingId?: number } = {}) {
  const f = getFile(db, user, fileId);
  if (!DOCS[type]) throw new ApiError(400, 'Geçersiz belge türü.');
  const me = getProfile(db, user, f.mediator_id);
  const today = dmy(new Date().toISOString().slice(0, 10));
  const app = f.parties.filter((p) => p.side === 'basvurucu');
  const res = f.parties.filter((p) => p.side === 'karsi');
  const who = (p: Party) => `${p.name}${p.id_no ? ` (T.C./VKN ${p.id_no})` : ''}${p.address ? `, ${p.address}` : ''}${p.lawyer ? ` — vekili ${p.lawyer}` : ''}`;
  const head = [
    `Arabuluculuk Bürosu No: ${f.buro_no || '…'}`,
    `Arabuluculuk No: ${f.arb_no || '…'}`,
    `Uyuşmazlık türü: ${f.kind_label}${f.mandatory ? ' (dava şartı arabuluculuk)' : ' (ihtiyari arabuluculuk)'}`,
  ];
  const signs = [
    '',
    ...f.parties.map((p) => `${p.side === 'basvurucu' ? 'Başvurucu' : 'Karşı taraf'}: ${p.name}${p.lawyer ? ` / Vekili: ${p.lawyer}` : ''}    İmza:`),
    `Arabulucu: ${me.name}${me.sicil_no ? ` (Sicil No: ${me.sicil_no})` : ''}    İmza:`,
  ];
  const meeting = (opts.meetingId ? f.meetings.find((m) => m.id === opts.meetingId) : undefined) ?? f.meetings[f.meetings.length - 1];
  const where = (m?: Meeting) => (m ? `${dmy(m.date)} tarihinde saat ${m.time || '…'}'da ${m.method === 'telekonferans' ? 'telekonferans/görüntülü görüşme yoluyla' : m.place || '…'}` : '… tarihinde saat …’da …');
  let lines: string[] = [];
  switch (type) {
    case 'davet': {
      const to = (opts.partyId ? f.parties.filter((p) => p.id === opts.partyId) : f.parties) as Party[];
      lines = [
        'ARABULUCULUK GÖRÜŞMESİNE DAVET MEKTUBU',
        '',
        ...head,
        '',
        `Sayın ${to.map((p) => p.name).join(', ') || '…'},`,
        '',
        `${app.map((p) => p.name).join(', ') || '…'} ile ${res.map((p) => p.name).join(', ') || '…'} arasındaki ${f.subject || 'uyuşmazlık'} konusunda arabulucu olarak görevlendirildim.`,
        `Uyuşmazlığın görüşülmesi amacıyla ${where(meeting)} yapılacak arabuluculuk görüşmesine katılmanızı rica ederim.`,
        '',
        'Görüşmeye kimlik belgenizle, vekil aracılığıyla katılacaksanız vekâletnamenin bir örneğiyle gelmeniz gerekmektedir. Arabuluculuk görüşmeleri gizlidir; görüşmede sunulan bilgi ve belgeler 6325 sayılı Kanun uyarınca sonradan delil olarak kullanılamaz.',
        f.mandatory ? 'Dava şartı arabuluculukta ilk toplantıya geçerli bir mazeret olmaksızın katılmayan taraf, sonradan açılacak davada haklı çıksa bile yargılama giderlerinin tamamından sorumlu tutulur ve lehine vekâlet ücretine hükmedilmez.' : '',
        '',
        'Katılımınızı ya da mazeretinizi aşağıdaki iletişim bilgilerinden bildirmenizi rica ederim.',
        '',
        `${today}`,
        `Arabulucu ${me.name}`,
        [me.sicil_no && `Sicil No: ${me.sicil_no}`, me.phone && `Tel: ${me.phone}`, me.email && `E-posta: ${me.email}`].filter(Boolean).join(' · '),
        me.address,
      ];
      break;
    }
    case 'toplanti':
      lines = [
        'ARABULUCULUK TOPLANTI TUTANAĞI',
        '',
        ...head,
        '',
        `Toplantı: ${where(meeting)}`,
        `Katılanlar:`,
        ...f.parties.map((p) => `- ${who(p)}`),
        '',
        'Arabulucu, taraflara arabuluculuk sürecini, gizlilik ilkesini, beyanların delil olarak kullanılamayacağını ve anlaşmanın hukuki sonuçlarını açıkladı.',
        meeting?.note ? `Görüşülen hususlar: ${meeting.note}` : 'Görüşülen hususlar: …',
        '',
        'Taraflar görüşmelere devam etme iradesini bildirdi. Bir sonraki toplantının tarihi taraflarla birlikte belirlenecektir.',
        `İşbu tutanak ${today} tarihinde ${f.parties.length + 1} nüsha olarak düzenlenip okunarak imza altına alınmıştır.`,
        ...signs,
      ];
      break;
    case 'son_tutanak': {
      const outcome =
        f.status === 'anlasma'
          ? 'Taraflar uyuşmazlığın tamamı üzerinde ANLAŞMIŞTIR.'
          : f.status === 'kismi'
            ? 'Taraflar uyuşmazlığın bir kısmı üzerinde ANLAŞMIŞ, kalan kısım üzerinde anlaşamamıştır.'
            : f.status === 'anlasmama'
              ? 'Yapılan görüşmeler sonunda taraflar ANLAŞAMAMIŞTIR.'
              : f.status === 'sonlandi'
                ? 'Arabuluculuk faaliyeti tarafların katılmaması / başka sebeple sona ermiştir.'
                : '[Sonucu girin: anlaşma, kısmen anlaşma, anlaşamama]';
      lines = [
        'ARABULUCULUK SON TUTANAĞI',
        '',
        ...head,
        f.adliye ? `Adliye: ${f.adliye}` : '',
        '',
        'Taraflar:',
        ...f.parties.map((p) => `- ${p.side === 'basvurucu' ? 'Başvurucu' : 'Karşı taraf'}: ${who(p)}`),
        '',
        `Uyuşmazlık konusu: ${f.subject || '…'}`,
        `Görevlendirme tarihi: ${dmy(f.assigned_date)}`,
        `Yapılan toplantılar: ${f.meetings.map((m) => dmy(m.date)).join(', ') || '…'}`,
        '',
        `Sonuç: ${outcome}`,
        f.status === 'anlasma' || f.status === 'kismi' ? `Anlaşılan hususlar ayrıca düzenlenen anlaşma belgesinde gösterilmiştir.${f.result_kurus ? ` Anlaşma tutarı: ${tl(f.result_kurus / 100)}.` : ''}` : '',
        '',
        `Arabuluculuk ücreti: ${tl(f.fee.total)}${f.fee.treasury ? ` (ilk iki saat ${tl(f.fee.treasury)} Adalet Bakanlığı bütçesinden)` : ''}; taraflarca eşit ödenecek kısım: ${tl(f.fee.byParties)}.`,
        '',
        `İşbu son tutanak 6325 sayılı Kanun'un 17. maddesi uyarınca ${today} tarihinde düzenlenmiş, okunarak imza altına alınmıştır.`,
        ...signs,
      ];
      break;
    }
    case 'anlasma':
      lines = [
        'ARABULUCULUK ANLAŞMA BELGESİ',
        '',
        ...head,
        '',
        'Taraflar:',
        ...f.parties.map((p) => `- ${p.side === 'basvurucu' ? 'Başvurucu' : 'Karşı taraf'}: ${who(p)}`),
        '',
        `Taraflar arasındaki ${f.subject || 'uyuşmazlık'} konusunda arabulucu ${me.name} huzurunda yapılan görüşmeler sonunda aşağıdaki hususlarda anlaşılmıştır:`,
        '',
        f.result_terms || `1. ${res.map((p) => p.name).join(', ') || 'Karşı taraf'}, ${app.map((p) => p.name).join(', ') || 'başvurucuya'} ${f.result_kurus ? tl(f.result_kurus / 100) : '… TL'} ödeyecektir.\n2. Ödeme … tarihine kadar … IBAN numaralı hesaba yapılacaktır.\n3. Taraflar, bu anlaşma ile uyuşmazlık konusu hakkında birbirlerini karşılıklı olarak ibra eder; bu konuda dava açmayacaklarını kabul ederler.`,
        '',
        'Taraflar ve vekilleri ile arabulucunun birlikte imzaladığı bu anlaşma belgesi, 6325 sayılı Kanun\'un 18. maddesi uyarınca icra edilebilirlik şerhi aranmaksızın ilam niteliğindedir.',
        `Düzenleme tarihi: ${today}`,
        ...signs,
      ];
      break;
    case 'ucret':
      lines = [
        `ARABULUCULUK ÜCRET HESABI (${TARIFF_YEAR} Arabuluculuk Asgari Ücret Tarifesi)`,
        '',
        ...head,
        `Taraf sayısı: ${f.parties.length || 2} · Sonuç: ${f.status_label}${f.result_kurus ? ` · Anlaşma tutarı: ${tl(f.result_kurus / 100)}` : ''}`,
        '',
        ...f.fee.lines,
        '',
        `Toplam arabuluculuk ücreti: ${tl(f.fee.total)}`,
        f.fee.treasury ? `Adalet Bakanlığı bütçesinden: ${tl(f.fee.treasury)}` : '',
        `Taraflarca ödenecek: ${tl(f.fee.byParties)} (her iki tarafa ${tl(f.fee.perSide)}, aksi kararlaştırılmadıkça)`,
        me.iban ? `Ödeme hesabı (IBAN): ${me.iban}` : '',
        '',
        'Tarife tutarları asgari tutarlardır; taraflarla daha yüksek ücret kararlaştırılabilir. Tutarları yürürlükteki tarifeyle kontrol ediniz.',
      ];
      break;
  }
  return { title: `${DOCS[type]} - ${f.arb_no || f.buro_no || `dosya ${f.id}`}`, body: lines.filter((l, i, a) => !(l === '' && a[i - 1] === '')).join('\n') };
}

export function feeQuote(input: { kind?: string; parties?: number; status?: string; result?: string | number; hours?: number; mandatory?: boolean }) {
  if (!KINDS[String(input.kind)]) throw new ApiError(400, 'Geçersiz uyuşmazlık türü.');
  return computeFee({
    kind: String(input.kind),
    parties: Number(input.parties) || 2,
    status: String(input.status ?? 'anlasma'),
    resultTL: toKurus(input.result, 'Anlaşma tutarı') / 100,
    hours: Number(input.hours) || 2,
    mandatory: input.mandatory !== false,
  });
}
