import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import type { User } from './auth.ts';
import type { DB } from './db.ts';
import { ApiError } from './errors.ts';

/*
 * Büro yedeği: büronun bütün kayıtları (dosyalar, belgeler, dilekçeler, sözleşmeler, muhasebe,
 * notlar…) tek bir sıkıştırılmış .timay dosyasına yazılır ve aynı ya da yeni bir sunucuya geri yüklenir.
 * Hangi tablonun hangi büroya ait olduğu şemadan (office_id ya da yabancı anahtar zinciri) bulunur;
 * böylece yeni eklenen tablolar da kendiliğinden yedeğe girer.
 */

const FORMAT = 'timay-yedek';
const VERSION = 1;
// Büroya ait olmayan ya da yedeğe girmemesi gereken tablolar (oturumlar, davetler, ortak karar arşivi).
const SKIP = new Set(['offices', 'sessions', 'invites', 'decisions']);

interface Table {
  name: string;
  cols: string[];
  fks: { from: string; table: string }[];
}

function tables(db: DB): Table[] {
  const names = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all() as { name: string }[]).map((r) => r.name);
  return names
    .filter((n) => !SKIP.has(n))
    .map((name) => ({
      name,
      cols: (db.prepare(`PRAGMA table_info("${name}")`).all() as { name: string }[]).map((c) => c.name),
      fks: (db.prepare(`PRAGMA foreign_key_list("${name}")`).all() as { from: string; table: string }[]).map((f) => ({ from: f.from, table: f.table })),
    }));
}

/** Her tablo için "bu büroya ait satırlar" koşulu ve ebeveynler önce gelecek şekilde sıra. */
export function backupPlan(db: DB) {
  const all = tables(db);
  const byName = new Map(all.map((t) => [t.name, t]));
  const where = new Map<string, string>();
  const resolve = (t: Table, seen: Set<string>): string | null => {
    if (where.has(t.name)) return where.get(t.name)!;
    if (t.cols.includes('office_id')) {
      where.set(t.name, 'office_id = @office');
      return where.get(t.name)!;
    }
    if (seen.has(t.name)) return null;
    seen.add(t.name);
    // Kullanıcıya değil asıl kayda (dava, sözleşme…) bağlanmak tercih edilir.
    const fks = [...t.fks.filter((f) => f.table !== 'users' && f.table !== t.name), ...t.fks.filter((f) => f.table === 'users')];
    for (const f of fks) {
      const parent = byName.get(f.table);
      if (!parent) continue;
      const w = resolve(parent, seen);
      if (w) {
        where.set(t.name, `"${f.from}" IN (SELECT rowid FROM "${parent.name}" WHERE ${w})`);
        return where.get(t.name)!;
      }
    }
    return null;
  };
  const owned = all.filter((t) => resolve(t, new Set()));
  // Topolojik sıra: bir tablo, bağlı olduğu tablolardan sonra gelir.
  const order: Table[] = [];
  const done = new Set<string>();
  const visit = (t: Table, stack: Set<string>) => {
    if (done.has(t.name) || stack.has(t.name)) return;
    stack.add(t.name);
    for (const f of t.fks) {
      const p = owned.find((x) => x.name === f.table);
      if (p && p.name !== t.name) visit(p, stack);
    }
    stack.delete(t.name);
    done.add(t.name);
    order.push(t);
  };
  for (const t of owned) visit(t, new Set());
  return order.map((t) => ({ ...t, where: where.get(t.name)! }));
}

type Cell = string | number | null | { $b64: string };
const enc = (v: unknown): Cell => (Buffer.isBuffer(v) ? { $b64: v.toString('base64') } : (v as Cell));
const dec = (v: Cell) => (v && typeof v === 'object' && '$b64' in v ? Buffer.from(v.$b64, 'base64') : v);

function requireAdmin(user: User) {
  if (!user.is_admin) throw new ApiError(403, 'Yedek almayı ve geri yüklemeyi yalnızca büro yöneticisi yapabilir.');
}

function stamp(d = new Date()) {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}`;
}

export function createBackup(db: DB, user: User) {
  requireAdmin(user);
  const office = db.prepare('SELECT id, name FROM offices WHERE id = ?').get(user.office_id) as { id: number; name: string };
  const out: Record<string, { columns: string[]; rows: Cell[][] }> = {};
  const counts: Record<string, number> = {};
  for (const t of backupPlan(db)) {
    const rows = db.prepare(`SELECT ${t.cols.map((c) => `"${c}"`).join(', ')} FROM "${t.name}" WHERE ${t.where} ORDER BY rowid`).raw().all({ office: user.office_id }) as unknown[][];
    out[t.name] = { columns: t.cols, rows: rows.map((r) => r.map(enc)) };
    counts[t.name] = rows.length;
  }
  const doc = { format: FORMAT, version: VERSION, createdAt: new Date().toISOString(), createdBy: user.name, office, counts, tables: out };
  const buf = gzipSync(Buffer.from(JSON.stringify(doc)), { level: 6 });
  return {
    fileName: `Timay-Yedek-${stamp()}.timay`,
    base64: buf.toString('base64'),
    size: buf.length,
    summary: summarize(counts),
  };
}

const LABELS: Record<string, string> = {
  cases: 'dava dosyası',
  case_documents: 'belge',
  petitions: 'dilekçe',
  contracts: 'sözleşme',
  tasks: 'görev',
  legal_deadlines: 'süre',
  notes: 'not',
  finance_entries: 'muhasebe kaydı',
  enforcement_files: 'icra dosyası',
  powers_of_attorney: 'vekâletname',
  users: 'kullanıcı',
};

function summarize(counts: Record<string, number>) {
  return Object.entries(LABELS)
    .filter(([k]) => counts[k])
    .map(([k, label]) => ({ key: k, label, count: counts[k] }));
}

interface BackupDoc {
  format: string;
  version: number;
  createdAt: string;
  createdBy: string;
  office: { id: number; name: string };
  counts: Record<string, number>;
  tables: Record<string, { columns: string[]; rows: Cell[][] }>;
}

function parse(base64: string): BackupDoc {
  let doc: BackupDoc;
  try {
    doc = JSON.parse(gunzipSync(Buffer.from(base64, 'base64')).toString('utf8'));
  } catch {
    throw new ApiError(400, 'Bu dosya bir Timay yedeği değil ya da bozuk.');
  }
  if (doc?.format !== FORMAT || !doc.tables) throw new ApiError(400, 'Bu dosya bir Timay yedeği değil.');
  if (doc.version > VERSION) throw new ApiError(400, 'Bu yedek programın daha yeni bir sürümüyle alınmış. Önce programı güncelleyin.');
  return doc;
}

/** Yüklemeden önce yedeğin içeriğini gösterir. */
export function inspectBackup(db: DB, user: User, input: { base64?: string }) {
  requireAdmin(user);
  const doc = parse(String(input.base64 ?? ''));
  return { createdAt: doc.createdAt, createdBy: doc.createdBy, office: doc.office.name, summary: summarize(doc.counts) };
}

/**
 * Yedeği geri yükler: büronun şimdiki kayıtları silinir, yedekteki kayıtlar yazılır. Geri yüklemeyi yapan
 * yönetici hesabı korunur (oturumu kapanmaz); yedekte aynı e-postalı kullanıcı varsa kayıtları ona bağlanır.
 * Bir hata olursa hiçbir şey değişmez.
 */
export function restoreBackup(db: DB, user: User, input: { base64?: string; confirm?: boolean }) {
  requireAdmin(user);
  if (!input.confirm) throw new ApiError(400, 'Geri yükleme onaylanmadı.');
  const doc = parse(String(input.base64 ?? ''));
  const plan = backupPlan(db);
  const userFks = new Map(plan.map((t) => [t.name, new Set(t.fks.filter((f) => f.table === 'users').map((f) => f.from))]));

  // Yedekteki kullanıcı numaraları → bu sunucudaki numaralar.
  const userMap = new Map<number, number>();
  const ut = doc.tables.users;
  if (ut) {
    const iId = ut.columns.indexOf('id');
    const iEmail = ut.columns.indexOf('email');
    for (const r of ut.rows) {
      const email = String(r[iEmail] ?? '').toLocaleLowerCase('tr');
      if (email === user.email.toLocaleLowerCase('tr')) userMap.set(Number(r[iId]), user.id);
    }
  }

  const run = db.transaction(() => {
    db.pragma('defer_foreign_keys = ON');
    // Önce oturumlar (silinecek kullanıcılara bağlı), sonra çocuktan ebeveyne doğru büronun kayıtları.
    db.prepare('DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE office_id = ? AND id <> ?)').run(user.office_id, user.id);
    for (const t of [...plan].reverse()) {
      const extra = t.name === 'users' ? ' AND id <> @me' : '';
      db.prepare(`DELETE FROM "${t.name}" WHERE ${t.where}${extra}`).run({ office: user.office_id, ...(extra ? { me: user.id } : {}) });
    }
    const restored: Record<string, number> = {};
    for (const t of plan) {
      const src = doc.tables[t.name];
      if (!src) continue;
      const cols = src.columns.filter((c) => t.cols.includes(c));
      const idx = cols.map((c) => src.columns.indexOf(c));
      const stmt = db.prepare(`INSERT INTO "${t.name}" (${cols.map((c) => `"${c}"`).join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`);
      const ufk = userFks.get(t.name)!;
      let n = 0;
      for (const r of src.rows) {
        if (t.name === 'users' && userMap.get(Number(r[src.columns.indexOf('id')])) === user.id) continue;
        const vals = idx.map((i, k) => {
          const c = cols[k];
          const v = dec(r[i]);
          if (c === 'office_id') return user.office_id;
          if (ufk.has(c) && v !== null && userMap.has(Number(v))) return userMap.get(Number(v));
          return v;
        });
        try {
          stmt.run(...vals);
        } catch (e) {
          const msg = (e as Error).message;
          if (/UNIQUE|PRIMARY KEY/i.test(msg))
            throw new ApiError(409, `Yedek bu sunucuya yüklenemedi: "${t.name}" kayıtları sunucudaki başka bir büronun kayıtlarıyla çakışıyor.`);
          throw e;
        }
        n++;
      }
      restored[t.name] = n;
    }
    return restored;
  });
  const restored = run();
  return { ok: true, createdAt: doc.createdAt, summary: summarize(restored) };
}

/* ---------- Sunucunun kendi günlük yedeği (bütün veritabanı) ---------- */

const SERVER_FILE = /^timay-\d{4}-\d{2}-\d{2}\.db$/;

export async function serverBackupNow(db: DB, dir: string, keep = 14) {
  mkdirSync(dir, { recursive: true });
  const day = new Date().toISOString().slice(0, 10);
  const file = join(dir, `timay-${day}.db`);
  if (!existsSync(file)) await db.backup(file);
  const old = readdirSync(dir)
    .filter((f) => SERVER_FILE.test(f))
    .sort()
    .reverse()
    .slice(keep);
  for (const f of old) unlinkSync(join(dir, f));
  return file;
}

/** Sunucu açıkken her gün bir kez veritabanının tam kopyasını alır, son 14 günü tutar. */
export function startDailyServerBackups(db: DB, dir: string, keep = 14) {
  const tick = () => serverBackupNow(db, dir, keep).catch((e) => console.error('Günlük yedek alınamadı:', e));
  tick();
  return setInterval(tick, 60 * 60 * 1000).unref();
}

export function listServerBackups(user: User, dir: string | null) {
  requireAdmin(user);
  if (!dir || !existsSync(dir)) return { enabled: Boolean(dir), files: [] };
  const files = readdirSync(dir)
    .filter((f) => SERVER_FILE.test(f))
    .sort()
    .reverse()
    .map((f) => ({ name: f, date: f.slice(6, 16), size: statSync(join(dir, f)).size }));
  return { enabled: true, files };
}
