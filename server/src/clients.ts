import type { User } from './auth.ts';
import { caseVisibility } from './cases.ts';
import type { DB } from './db.ts';
import { ApiError } from './errors.ts';

/*
 * Müvekkil kartları: müvekkilin bilgileri ve büronun onunla ilgili her şeyi (davalar, icra dosyaları,
 * sözleşmeler, danışmanlık, arabuluculuk, muhasebe) tek kartta. Dosyalardaki müvekkil adlarından
 * kart önerilir. Büro anteti: PDF/Word/UDF çıktılarının başına yazılan büro bilgisi.
 */

interface ClientRow {
  id: number;
  name: string;
  kind: string;
  id_no: string;
  phone: string;
  email: string;
  address: string;
  note: string;
  created_at: string;
}

const key = (s: string | null | undefined) =>
  String(s ?? '')
    .toLocaleLowerCase('tr')
    .replace(/\s+/g, ' ')
    .trim();

function load(db: DB, user: User, id: number) {
  const c = db.prepare('SELECT * FROM clients WHERE id = ? AND office_id = ?').get(id, user.office_id) as ClientRow | undefined;
  if (!c) throw new ApiError(404, 'Müvekkil bulunamadı.');
  return c;
}

/** Dosyalarda müvekkil olarak geçen ama kartı olmayan adlar. */
function suggestions(db: DB, user: User, existing: Set<string>) {
  const names = new Map<string, { name: string; n: number }>();
  const add = (name: string) => {
    const k = key(name);
    if (!k || existing.has(k)) return;
    const cur = names.get(k) ?? { name: name.trim(), n: 0 };
    cur.n++;
    names.set(k, cur);
  };
  for (const r of db.prepare("SELECT client FROM cases WHERE office_id = ? AND client <> ''").all(user.office_id) as { client: string }[]) add(r.client);
  for (const r of db.prepare("SELECT creditor FROM enforcement_files WHERE office_id = ? AND creditor <> ''").all(user.office_id) as { creditor: string }[]) add(r.creditor);
  for (const r of db.prepare('SELECT name FROM consultancy_clients WHERE office_id = ?').all(user.office_id) as { name: string }[]) add(r.name);
  return [...names.values()].sort((a, b) => b.n - a.n).slice(0, 30);
}

export function listClients(db: DB, user: User, q = '') {
  const rows = db.prepare('SELECT * FROM clients WHERE office_id = ? ORDER BY name').all(user.office_id) as ClientRow[];
  const caseRows = db.prepare('SELECT client FROM cases WHERE office_id = ?').all(user.office_id) as { client: string }[];
  const counts = new Map<string, number>();
  for (const r of caseRows) counts.set(key(r.client), (counts.get(key(r.client)) ?? 0) + 1);
  const words = key(q).split(' ').filter(Boolean);
  const clients = rows
    .filter((c) => words.every((w) => key(`${c.name} ${c.id_no} ${c.phone} ${c.email}`).includes(w)))
    .map((c) => ({ ...c, cases: counts.get(key(c.name)) ?? 0 }));
  return { clients, suggestions: q ? [] : suggestions(db, user, new Set(rows.map((r) => key(r.name)))) };
}

interface Input {
  name?: string;
  kind?: string;
  idNo?: string;
  phone?: string;
  email?: string;
  address?: string;
  note?: string;
}

export function createClient(db: DB, user: User, input: Input) {
  const name = String(input.name ?? '').trim();
  if (!name) throw new ApiError(400, 'Müvekkil adı zorunludur.');
  const dup = (db.prepare('SELECT id, name FROM clients WHERE office_id = ?').all(user.office_id) as { id: number; name: string }[]).find((c) => key(c.name) === key(name));
  if (dup) throw new ApiError(409, `${dup.name} adına zaten bir müvekkil kartı var.`);
  const r = db
    .prepare('INSERT INTO clients (office_id, name, kind, id_no, phone, email, address, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(user.office_id, name, input.kind === 'sirket' ? 'sirket' : 'kisi', input.idNo ?? '', input.phone ?? '', input.email ?? '', input.address ?? '', input.note ?? '');
  return getClient(db, user, Number(r.lastInsertRowid));
}

export function updateClient(db: DB, user: User, id: number, input: Input) {
  const c = load(db, user, id);
  const name = input.name !== undefined ? String(input.name).trim() : c.name;
  if (!name) throw new ApiError(400, 'Müvekkil adı zorunludur.');
  db.prepare('UPDATE clients SET name = ?, kind = ?, id_no = ?, phone = ?, email = ?, address = ?, note = ? WHERE id = ?').run(
    name,
    input.kind ? (input.kind === 'sirket' ? 'sirket' : 'kisi') : c.kind,
    input.idNo ?? c.id_no,
    input.phone ?? c.phone,
    input.email ?? c.email,
    input.address ?? c.address,
    input.note ?? c.note,
    id,
  );
  return getClient(db, user, id);
}

export function deleteClient(db: DB, user: User, id: number) {
  load(db, user, id);
  if (!user.is_admin) throw new ApiError(403, 'Müvekkil kartını yalnızca büro yöneticisi silebilir.');
  db.prepare('DELETE FROM clients WHERE id = ?').run(id);
  return { ok: true };
}

/** Müvekkil kartı: bilgileri ve adına kayıtlı her şey. */
export function getClient(db: DB, user: User, id: number) {
  const c = load(db, user, id);
  const k = key(c.name);
  const v = caseVisibility(user);
  const cases = (
    db
      .prepare(`SELECT c.id, c.title, c.court, c.esas_no, c.status, c.client FROM cases c WHERE c.office_id = ?${v.sql} ORDER BY c.id DESC`)
      .all(user.office_id, ...v.params) as { id: number; title: string; court: string; esas_no: string; status: string; client: string }[]
  ).filter((r) => key(r.client) === k);
  const caseIds = new Set(cases.map((r) => r.id));
  const enforcement = (
    db.prepare('SELECT id, debtor, office_name, file_no, status, creditor, case_id FROM enforcement_files WHERE office_id = ? ORDER BY id DESC').all(user.office_id) as {
      id: number;
      debtor: string;
      office_name: string;
      file_no: string;
      status: string;
      creditor: string;
      case_id: number | null;
    }[]
  ).filter((r) => key(r.creditor) === k || (r.case_id !== null && caseIds.has(r.case_id)));
  const contracts = (
    db.prepare('SELECT id, title, parties, status, case_id FROM contracts WHERE office_id = ? ORDER BY id DESC').all(user.office_id) as {
      id: number;
      title: string;
      parties: string;
      status: string;
      case_id: number | null;
    }[]
  ).filter((r) => key(r.parties).includes(k) || (r.case_id !== null && caseIds.has(r.case_id)));
  const consultancy = (db.prepare('SELECT id, name, status FROM consultancy_clients WHERE office_id = ?').all(user.office_id) as { id: number; name: string; status: string }[]).filter(
    (r) => key(r.name) === k,
  );
  const mediation = (
    db
      .prepare('SELECT f.id, f.subject, f.status, p.name FROM mediation_files f JOIN mediation_parties p ON p.file_id = f.id WHERE f.office_id = ?')
      .all(user.office_id) as { id: number; subject: string; status: string; name: string }[]
  )
    .filter((r) => key(r.name) === k)
    .map(({ id, subject, status }) => ({ id, subject, status }));
  const fin = (
    db.prepare('SELECT kind, amount_kurus, client, case_id FROM finance_entries WHERE office_id = ?').all(user.office_id) as {
      kind: string;
      amount_kurus: number;
      client: string;
      case_id: number | null;
    }[]
  ).filter((r) => key(r.client) === k || (r.case_id !== null && caseIds.has(r.case_id)));
  const sum = (kind: string) => fin.filter((r) => r.kind === kind).reduce((n, r) => n + r.amount_kurus, 0);
  return {
    ...c,
    cases,
    enforcement,
    contracts,
    consultancy,
    mediation: [...new Map(mediation.map((m) => [m.id, m])).values()],
    finance: { gelir: sum('gelir'), masraf: sum('masraf'), gider: sum('gider'), entries: fin.length },
  };
}

/* ---------- Büro anteti ---------- */

export function getLetterhead(db: DB, user: User) {
  const r = db.prepare('SELECT letterhead, use_letterhead FROM office_settings WHERE office_id = ?').get(user.office_id) as { letterhead: string; use_letterhead: number } | undefined;
  return { letterhead: r?.letterhead ?? '', useLetterhead: r ? Boolean(r.use_letterhead) : true };
}

export function saveLetterhead(db: DB, user: User, input: { letterhead?: string; useLetterhead?: boolean }) {
  if (!user.is_admin) throw new ApiError(403, 'Büro antetini yalnızca büro yöneticisi değiştirebilir.');
  const text = String(input.letterhead ?? '').trim();
  if (text.split('\n').length > 6) throw new ApiError(400, 'Antet en fazla 6 satır olabilir.');
  db.prepare(
    `INSERT INTO office_settings (office_id, letterhead, use_letterhead) VALUES (?, ?, ?)
     ON CONFLICT(office_id) DO UPDATE SET letterhead = excluded.letterhead, use_letterhead = excluded.use_letterhead`,
  ).run(user.office_id, text, input.useLetterhead === false ? 0 : 1);
  return getLetterhead(db, user);
}

/** Dışa aktarılan metnin başına büro antetini ekler (antet açıksa ve istenmişse). */
export function withLetterhead(db: DB, user: User, body: string, wanted = true) {
  const l = getLetterhead(db, user);
  if (!wanted || !l.useLetterhead || !l.letterhead) return body;
  return `${l.letterhead}\n${'—'.repeat(30)}\n\n${body}`;
}
