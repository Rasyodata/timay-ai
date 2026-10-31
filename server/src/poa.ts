import type { User } from './auth.ts';
import type { DB } from './db.ts';
import { ApiError } from './errors.ts';
import { optionalDate } from './money.ts';

/*
 * Vekâletname yönetimi: müvekkilden alınan vekâletnamelerin noter, yevmiye, tarih ve özel
 * yetkileri; taranmış hâli; bağlı dava dosyaları; azil, istifa ve süre uyarıları.
 */

/** Avukatın ancak vekâletnamede açıkça yazılıysa kullanabileceği özel yetkiler (HMK m.74). */
export const POWERS: Record<string, { label: string; pattern: RegExp }> = {
  ahzu_kabz: { label: 'Ahzu kabz (para alma)', pattern: /ahz[uü]\s*-?\s*kabz|ahz-ı kabz/i },
  sulh: { label: 'Sulh', pattern: /\bsulh/i },
  feragat: { label: 'Davadan feragat', pattern: /feragat/i },
  kabul: { label: 'Davayı kabul', pattern: /kabul(?:e)?\s*(?:etme|etmeye|yetki)|davayı kabul/i },
  ibra: { label: 'İbra', pattern: /\bibra/i },
  tahkim: { label: 'Tahkim ve hakem', pattern: /tahkim|hakem/i },
  yemin: { label: 'Yemin teklifi / kabulü', pattern: /yemin/i },
  haciz: { label: 'Haciz ve icra işlemleri', pattern: /haciz|icra takib/i },
  temlik: { label: 'Temlik ve devir', pattern: /temlik/i },
  tevkil: { label: 'Başka avukata tevkil', pattern: /tevkil|azil ve tevkil/i },
  ceza: { label: 'Ceza davalarında şikâyetten vazgeçme', pattern: /şikayetten vazgeç|şikâyetten vazgeç/i },
};

export const POWERS_LIST = Object.entries(POWERS).map(([key, p]) => ({ key, label: p.label }));

export const POA_STATUSES = ['gecerli', 'azil', 'istifa', 'sona_erdi'] as const;
type PoaStatus = (typeof POA_STATUSES)[number];

interface PoaRow {
  id: number;
  client: string;
  kind: string;
  notary: string;
  journal_no: string;
  issue_date: string;
  expiry_date: string;
  lawyers: string;
  powers: string;
  status: PoaStatus;
  status_date: string;
  note: string;
  file_name: string;
  mime_type: string;
  text: string;
  created_at: string;
  created_by_name: string;
}

const TR_MONTHS = ['ocak', 'şubat', 'mart', 'nisan', 'mayıs', 'haziran', 'temmuz', 'ağustos', 'eylül', 'ekim', 'kasım', 'aralık'];

function isoDate(d: number, m: number, y: number) {
  if (y < 100) y += 2000;
  if (!d || !m || !y || m > 12 || d > 31) return '';
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function titleCase(s: string) {
  return s
    .split(/\s+/)
    .map((w) => w.charAt(0).toLocaleUpperCase('tr') + w.slice(1))
    .join(' ');
}

/** Taranmış ya da yazılı vekâletnameden noter, yevmiye, tarih ve özel yetkileri çıkarır. */
export function parsePoaText(text: string) {
  const t = text.replace(/\s+/g, ' ');
  const journal = /yevmiye\s*(?:no|numarası|numara)?\s*[:.]?\s*(\d[\d./-]*)/i.exec(t)?.[1] ?? '';
  // Taramalarda noter başlığı çoğu zaman BÜYÜK harftir: küçük harfe çevirip arar, sonra baş harfleri büyütürüz.
  const lower = t.toLocaleLowerCase('tr');
  const n = /([a-zçğıöşü]+(?:\s+[a-zçğıöşü]+)?)\s+(\d{1,3})\s*\.?\s*noter(?:liği|i)?\b/.exec(lower);
  const notary = n ? `${titleCase(n[1].replace(/^(?:t\.?\s*c\.?\s+)/, ''))} ${n[2]}. Noterliği` : '';
  const client = /\b[Bb]en\s+([A-ZÇĞİÖŞÜ][\p{L}.]+(?:\s+[A-ZÇĞİÖŞÜ][\p{L}.]+){0,3})\s*,/u.exec(t)?.[1] ?? '';
  const lawyers = [...t.matchAll(/\bAv\.\s*([A-ZÇĞİÖŞÜ]\p{L}+(?:\s+[A-ZÇĞİÖŞÜ]\p{L}+)?)/gu)]
    .map((m) => `Av. ${m[1]}`)
    .filter((v, i, a) => a.indexOf(v) === i)
    .join(', ');
  let issue = '';
  const numeric = /(\d{1,2})[./](\d{1,2})[./](\d{2,4})/.exec(t);
  if (numeric) issue = isoDate(Number(numeric[1]), Number(numeric[2]), Number(numeric[3]));
  if (!issue) {
    const words = new RegExp(`(\\d{1,2})\\s+(${TR_MONTHS.join('|')})\\s+(\\d{4})`, 'i').exec(t);
    if (words) issue = isoDate(Number(words[1]), TR_MONTHS.indexOf(words[2].toLocaleLowerCase('tr')) + 1, Number(words[3]));
  }
  const powers = Object.entries(POWERS)
    .filter(([, p]) => p.pattern.test(t))
    .map(([k]) => k);
  const kind = /özel vekalet|özel vekâlet|münhasıran/i.test(t) ? 'ozel' : 'genel';
  return { journalNo: journal, notary, issueDate: issue, powers, kind, client, lawyers };
}

function cleanPowers(input: unknown) {
  return [...new Set((Array.isArray(input) ? input : []).map(String).filter((k) => k in POWERS))];
}

const COLUMNS = `p.id, p.client, p.kind, p.notary, p.journal_no, p.issue_date, p.expiry_date, p.lawyers, p.powers, p.status,
  p.status_date, p.note, p.file_name, p.mime_type, p.created_at, u.name AS created_by_name`;

function shape(row: PoaRow, cases: { id: number; title: string; status: string }[]) {
  return { ...row, powers: JSON.parse(row.powers || '[]') as string[], cases };
}

function linkedCases(db: DB, poaId: number) {
  return db
    .prepare('SELECT c.id, c.title, c.status FROM poa_cases pc JOIN cases c ON c.id = pc.case_id WHERE pc.poa_id = ? ORDER BY c.title')
    .all(poaId) as { id: number; title: string; status: string }[];
}

function load(db: DB, user: User, id: number) {
  const row = db.prepare(`SELECT ${COLUMNS}, p.text FROM powers_of_attorney p JOIN users u ON u.id = p.created_by WHERE p.id = ? AND p.office_id = ?`).get(id, user.office_id) as
    | PoaRow
    | undefined;
  if (!row) throw new ApiError(404, 'Vekâletname bulunamadı.');
  return row;
}

export function listPoas(db: DB, user: User, query: { caseId?: string; q?: string } = {}) {
  const params: unknown[] = [user.office_id];
  let where = 'p.office_id = ?';
  if (query.caseId) {
    where += ' AND EXISTS (SELECT 1 FROM poa_cases pc WHERE pc.poa_id = p.id AND pc.case_id = ?)';
    params.push(Number(query.caseId));
  }
  if (query.q?.trim()) {
    where += ' AND (p.client LIKE ? OR p.journal_no LIKE ? OR p.notary LIKE ?)';
    const like = `%${query.q.trim()}%`;
    params.push(like, like, like);
  }
  const rows = db
    .prepare(`SELECT ${COLUMNS} FROM powers_of_attorney p JOIN users u ON u.id = p.created_by WHERE ${where} ORDER BY p.status = 'gecerli' DESC, p.client`)
    .all(...params) as PoaRow[];
  return rows.map((r) => shape(r, linkedCases(db, r.id)));
}

export function getPoa(db: DB, user: User, id: number, withFile = false) {
  const row = load(db, user, id);
  const out = shape(row, linkedCases(db, id));
  if (!withFile) return out;
  const file = db.prepare('SELECT data FROM powers_of_attorney WHERE id = ?').get(id) as { data: Buffer | null };
  return { ...out, fileBase64: file.data ? file.data.toString('base64') : null };
}

type PoaInput = {
  client?: string;
  kind?: string;
  notary?: string;
  journalNo?: string;
  issueDate?: string;
  expiryDate?: string;
  lawyers?: string;
  powers?: string[];
  note?: string;
  caseIds?: number[];
  fileName?: string;
  mimeType?: string;
  fileBase64?: string;
  text?: string;
};

function setCases(db: DB, user: User, id: number, caseIds: unknown) {
  db.prepare('DELETE FROM poa_cases WHERE poa_id = ?').run(id);
  for (const cid of new Set((Array.isArray(caseIds) ? caseIds : []).map(Number))) {
    if (!db.prepare('SELECT 1 FROM cases WHERE id = ? AND office_id = ?').get(cid, user.office_id)) throw new ApiError(400, 'Dava dosyası bulunamadı.');
    db.prepare('INSERT INTO poa_cases (poa_id, case_id) VALUES (?, ?)').run(id, cid);
  }
}

export function createPoa(db: DB, user: User, input: PoaInput) {
  if (!input.client?.trim()) throw new ApiError(400, 'Müvekkil adı zorunludur.');
  const data = input.fileBase64 ? Buffer.from(input.fileBase64, 'base64') : null;
  if (data && data.length > 15 * 1024 * 1024) throw new ApiError(413, 'Dosya 15 MB’tan büyük olamaz.');
  const tx = db.transaction(() => {
    const r = db
      .prepare(
        `INSERT INTO powers_of_attorney (office_id, client, kind, notary, journal_no, issue_date, expiry_date, lawyers, powers, note,
          file_name, mime_type, data, text, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        user.office_id,
        input.client!.trim(),
        input.kind === 'ozel' ? 'ozel' : 'genel',
        (input.notary ?? '').trim(),
        (input.journalNo ?? '').trim(),
        optionalDate(input.issueDate, 'Düzenleme tarihi'),
        optionalDate(input.expiryDate, 'Geçerlilik sonu'),
        (input.lawyers ?? '').trim(),
        JSON.stringify(cleanPowers(input.powers)),
        (input.note ?? '').trim(),
        data ? String(input.fileName ?? '').slice(0, 200) : '',
        data ? String(input.mimeType ?? '').slice(0, 100) : '',
        data,
        String(input.text ?? '').trim(),
        user.id,
      );
    const id = Number(r.lastInsertRowid);
    setCases(db, user, id, input.caseIds);
    return id;
  });
  return getPoa(db, user, tx());
}

export function updatePoa(db: DB, user: User, id: number, input: PoaInput & { status?: string; statusDate?: string }) {
  const cur = load(db, user, id);
  if (input.status !== undefined && !POA_STATUSES.includes(input.status as PoaStatus)) throw new ApiError(400, 'Geçersiz durum.');
  const status = (input.status ?? cur.status) as PoaStatus;
  const statusDate = status === 'gecerli' ? '' : optionalDate(input.statusDate, 'Tarih') || cur.status_date || new Date().toISOString().slice(0, 10);
  const pick = <T>(v: T | undefined, d: T) => (v === undefined ? d : v);
  db.transaction(() => {
    db.prepare(
      `UPDATE powers_of_attorney SET client = ?, kind = ?, notary = ?, journal_no = ?, issue_date = ?, expiry_date = ?, lawyers = ?,
        powers = ?, note = ?, status = ?, status_date = ? WHERE id = ?`,
    ).run(
      pick(input.client?.trim() || undefined, cur.client),
      input.kind === undefined ? cur.kind : input.kind === 'ozel' ? 'ozel' : 'genel',
      pick(input.notary?.trim(), cur.notary),
      pick(input.journalNo?.trim(), cur.journal_no),
      input.issueDate === undefined ? cur.issue_date : optionalDate(input.issueDate, 'Düzenleme tarihi'),
      input.expiryDate === undefined ? cur.expiry_date : optionalDate(input.expiryDate, 'Geçerlilik sonu'),
      pick(input.lawyers?.trim(), cur.lawyers),
      input.powers === undefined ? cur.powers : JSON.stringify(cleanPowers(input.powers)),
      pick(input.note?.trim(), cur.note),
      status,
      statusDate,
      id,
    );
    if (input.caseIds !== undefined) setCases(db, user, id, input.caseIds);
  })();
  return getPoa(db, user, id);
}

export function deletePoa(db: DB, user: User, id: number) {
  load(db, user, id);
  db.prepare('DELETE FROM poa_cases WHERE poa_id = ?').run(id);
  db.prepare('DELETE FROM powers_of_attorney WHERE id = ?').run(id);
  return { ok: true };
}

/** Süreler ve riskler ekranı için vekâletname uyarıları. */
export function poaRisks(db: DB, user: User, today: string, in30: string) {
  const out: { level: 'yuksek' | 'orta'; title: string; detail: string; id: number }[] = [];
  const rows = db
    .prepare(`SELECT p.id, p.client, p.status, p.status_date, p.expiry_date FROM powers_of_attorney p WHERE p.office_id = ?`)
    .all(user.office_id) as { id: number; client: string; status: PoaStatus; status_date: string; expiry_date: string }[];
  for (const p of rows) {
    const open = linkedCases(db, p.id).filter((c) => c.status === 'acik');
    if (p.status !== 'gecerli') {
      if (open.length) {
        out.push({
          level: 'yuksek',
          title: `${p.status === 'azil' ? 'Azledilen' : p.status === 'istifa' ? 'İstifa edilen' : 'Sona eren'} vekâletnameye bağlı açık dosya: ${p.client}`,
          detail: `${open.map((c) => c.title).join(', ')}. Mahkemeye bildirim yapıldı mı, yeni vekâletname var mı kontrol edin (Av. K. m.41: istifada 15 gün görev sürer).`,
          id: p.id,
        });
      }
      continue;
    }
    if (p.expiry_date && p.expiry_date < today) {
      out.push({ level: 'yuksek', title: `Vekâletnamenin süresi doldu: ${p.client}`, detail: `Geçerlilik sonu ${p.expiry_date.split('-').reverse().join('.')}. Yenisini alın.`, id: p.id });
    } else if (p.expiry_date && p.expiry_date <= in30) {
      out.push({ level: 'orta', title: `Vekâletnamenin süresi doluyor: ${p.client}`, detail: `Geçerlilik sonu ${p.expiry_date.split('-').reverse().join('.')}.`, id: p.id });
    }
  }
  // Vekâletnamesi kayıtlı olmayan açık dosyalar.
  const missing = db
    .prepare(
      `SELECT c.id, c.title FROM cases c WHERE c.office_id = ? AND c.status = 'acik'
       AND NOT EXISTS (SELECT 1 FROM poa_cases pc JOIN powers_of_attorney p ON p.id = pc.poa_id WHERE pc.case_id = c.id AND p.status = 'gecerli')`,
    )
    .all(user.office_id) as { id: number; title: string }[];
  return { poa: out, missing };
}
