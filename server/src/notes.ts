import type { User } from './auth.ts';
import { assertCaseVisible, caseVisibility } from './cases.ts';
import type { DB } from './db.ts';
import { ApiError } from './errors.ts';
import { extractArticles } from './mevzuat.ts';

/*
 * Akıllı notlar: dosyaya ya da büroya not. #etiketler ayrılır; nottaki tarih, tutar ve kanun maddeleri
 * tanınır ve tek tıkla süre ya da görev yapılabilir.
 */

interface NoteRow {
  id: number;
  case_id: number | null;
  case_title: string | null;
  body: string;
  tags: string;
  pinned: number;
  created_by: number;
  author: string;
  created_at: string;
  updated_at: string;
}

const MONTHS: Record<string, string> = {
  ocak: '01',
  şubat: '02',
  mart: '03',
  nisan: '04',
  mayıs: '05',
  haziran: '06',
  temmuz: '07',
  ağustos: '08',
  eylül: '09',
  ekim: '10',
  kasım: '11',
  aralık: '12',
};

/** Nottaki tarihler (12.11.2026, 12/11/2026, 12 Kasım 2026), tutarlar ve kanun maddeleri. */
export function insights(body: string) {
  const dates = new Set<string>();
  for (const m of body.matchAll(/\b(\d{1,2})[./](\d{1,2})[./](\d{4})\b/g)) {
    const [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
    if (d >= 1 && d <= 31 && mo >= 1 && mo <= 12) dates.add(`${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
  }
  for (const m of body.matchAll(/\b(\d{1,2})\s+(ocak|şubat|mart|nisan|mayıs|haziran|temmuz|ağustos|eylül|ekim|kasım|aralık)\s+(\d{4})\b/giu)) {
    dates.add(`${m[3]}-${MONTHS[m[2].toLocaleLowerCase('tr')]}-${m[1].padStart(2, '0')}`);
  }
  const amounts = [...body.matchAll(/\b\d{1,3}(?:\.\d{3})*(?:,\d{1,2})?\s*(?:TL|₺)/g)].map((m) => m[0]);
  return { dates: [...dates].sort(), amounts: [...new Set(amounts)], articles: extractArticles(body).map((a) => a.label) };
}

function tagsOf(body: string) {
  return [...new Set([...body.matchAll(/#([\p{L}\d_-]{2,30})/gu)].map((m) => m[1].toLocaleLowerCase('tr')))];
}

function shape(r: NoteRow) {
  return { ...r, pinned: Boolean(r.pinned), tags: r.tags ? r.tags.split(',') : [], insights: insights(r.body) };
}

const SELECT = `SELECT n.id, n.case_id, c.title AS case_title, n.body, n.tags, n.pinned, n.created_by, u.name AS author, n.created_at, n.updated_at
  FROM notes n JOIN users u ON u.id = n.created_by LEFT JOIN cases c ON c.id = n.case_id`;

export function listNotes(db: DB, user: User, query: { caseId?: string; tag?: string; q?: string } = {}) {
  const where = ['n.office_id = ?'];
  const params: unknown[] = [user.office_id];
  if (query.caseId) {
    assertCaseVisible(db, user, Number(query.caseId));
    where.push('n.case_id = ?');
    params.push(Number(query.caseId));
  } else {
    // Büro notları ve görebildiği dosyaların notları.
    const v = caseVisibility(user);
    where.push(`(n.case_id IS NULL OR EXISTS (SELECT 1 FROM cases c WHERE c.id = n.case_id${v.sql}))`);
    params.push(...v.params);
  }
  if (query.tag) {
    where.push("(',' || n.tags || ',') LIKE ?");
    params.push(`%,${query.tag.toLocaleLowerCase('tr')},%`);
  }
  for (const w of String(query.q ?? '').trim().split(/\s+/).filter(Boolean)) {
    where.push('n.body LIKE ?');
    params.push(`%${w}%`);
  }
  const rows = db.prepare(`${SELECT} WHERE ${where.join(' AND ')} ORDER BY n.pinned DESC, n.updated_at DESC, n.id DESC LIMIT 200`).all(...params) as NoteRow[];
  return rows.map(shape);
}

function load(db: DB, user: User, id: number) {
  const row = db.prepare(`${SELECT} WHERE n.id = ? AND n.office_id = ?`).get(id, user.office_id) as NoteRow | undefined;
  if (!row) throw new ApiError(404, 'Not bulunamadı.');
  if (row.case_id) assertCaseVisible(db, user, row.case_id);
  return row;
}

export function createNote(db: DB, user: User, input: { caseId?: number | null; body?: string; pinned?: boolean }) {
  const body = String(input.body ?? '').trim();
  if (!body) throw new ApiError(400, 'Not boş olamaz.');
  if (body.length > 20000) throw new ApiError(400, 'Not çok uzun.');
  const caseId = input.caseId ? Number(input.caseId) : null;
  if (caseId) assertCaseVisible(db, user, caseId);
  const r = db
    .prepare('INSERT INTO notes (office_id, case_id, body, tags, pinned, created_by) VALUES (?, ?, ?, ?, ?, ?)')
    .run(user.office_id, caseId, body, tagsOf(body).join(','), input.pinned ? 1 : 0, user.id);
  return shape(load(db, user, Number(r.lastInsertRowid)));
}

export function updateNote(db: DB, user: User, id: number, input: { body?: string; pinned?: boolean }) {
  const cur = load(db, user, id);
  const body = input.body !== undefined ? String(input.body).trim() : cur.body;
  if (!body) throw new ApiError(400, 'Not boş olamaz.');
  db.prepare("UPDATE notes SET body = ?, tags = ?, pinned = ?, updated_at = datetime('now') WHERE id = ?").run(
    body,
    tagsOf(body).join(','),
    input.pinned !== undefined ? (input.pinned ? 1 : 0) : cur.pinned,
    id,
  );
  return shape(load(db, user, id));
}

export function deleteNote(db: DB, user: User, id: number) {
  const cur = load(db, user, id);
  if (cur.created_by !== user.id && !user.is_admin) throw new ApiError(403, 'Notu yalnızca yazan ya da yönetici silebilir.');
  db.prepare('DELETE FROM notes WHERE id = ?').run(id);
  return { ok: true };
}
