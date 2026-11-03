import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { DB } from './db.ts';
import { ApiError } from './errors.ts';

export type Role = 'avukat' | 'stajyer';

export interface User {
  id: number;
  office_id: number;
  name: string;
  email: string;
  role: Role;
  /** Ekibi ve yetkileri yönetir. */
  is_admin: number;
  /** Muhasebeyi görür ve kayıt girer. */
  can_finance: number;
  /** Başka avukatın dilekçe ve sözleşmesini onaylayabilir. */
  can_approve: number;
  /** Büronun bütün dosyalarını görür; 0 ise yalnız sorumlu olduğu ya da görevi bulunan dosyaları. */
  all_cases: number;
  /** Yönetim paneli: bütün avukatların yaptıklarını kayan şerit ve iş zekâsı ekranında izler. */
  is_ceo: number;
  /** Yönetici tarafından geçici şifreyle açıldı; ilk girişte şifresini değiştirmeli. */
  must_change_password: number;
}

const USER_COLUMNS = 'id, office_id, name, email, role, is_admin, can_finance, can_approve, all_cases, is_ceo, must_change_password';

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${scryptSync(password, salt, 64).toString('hex')}`;
}

function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(':');
  const expected = Buffer.from(hash, 'hex');
  const actual = scryptSync(password, salt, 64);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function newSession(db: DB, userId: number): string {
  const token = randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sessions (token, user_id) VALUES (?, ?)').run(token, userId);
  return token;
}

function requireFields(fields: Record<string, unknown>) {
  for (const [name, value] of Object.entries(fields)) {
    if (typeof value !== 'string' || value.trim() === '') {
      throw new ApiError(400, `"${name}" alanı zorunludur.`);
    }
  }
}

function insertUser(db: DB, officeId: number, name: string, email: string, password: string, role: Role) {
  if (password.length < 8) throw new ApiError(400, 'Şifre en az 8 karakter olmalıdır.');
  const exists = db.prepare('SELECT 1 FROM users WHERE email = ?').get(email);
  if (exists) throw new ApiError(409, 'Bu e-posta adresiyle kayıtlı bir kullanıcı var.');
  const result = db
    .prepare(
      'INSERT INTO users (office_id, name, email, password_hash, role, can_finance, can_approve) VALUES (?, ?, ?, ?, ?, ?, ?)',
    )
    .run(officeId, name.trim(), email, hashPassword(password), role, role === 'avukat' ? 1 : 0, role === 'avukat' ? 1 : 0);
  return Number(result.lastInsertRowid);
}

/** Yeni büro açar; açan kişi büronun ilk avukatı olur. */
export function registerOffice(
  db: DB,
  input: { officeName: string; name: string; email: string; password: string },
) {
  requireFields({ officeName: input.officeName, name: input.name, email: input.email, password: input.password });
  const email = input.email.trim().toLowerCase();
  return db.transaction(() => {
    const office = db.prepare('INSERT INTO offices (name) VALUES (?)').run(input.officeName.trim());
    const userId = insertUser(db, Number(office.lastInsertRowid), input.name, email, input.password, 'avukat');
    db.prepare('UPDATE users SET is_admin = 1 WHERE id = ?').run(userId);
    return { token: newSession(db, userId), user: getUser(db, userId) };
  })();
}

export function login(db: DB, input: { email: string; password: string }) {
  requireFields({ email: input.email, password: input.password });
  const row = db
    .prepare(`SELECT ${USER_COLUMNS}, password_hash FROM users WHERE email = ?`)
    .get(input.email.trim().toLowerCase()) as (User & { password_hash: string }) | undefined;
  if (!row || !verifyPassword(input.password, row.password_hash)) {
    throw new ApiError(401, 'E-posta veya şifre hatalı.');
  }
  return { token: newSession(db, row.id), user: getUser(db, row.id) };
}

export function createInvite(db: DB, inviter: User, input: { email: string; role: Role }) {
  if (!inviter.is_admin) throw new ApiError(403, 'Ekibe yalnızca büro yöneticisi davet gönderebilir.');
  requireFields({ email: input.email });
  if (input.role !== 'avukat' && input.role !== 'stajyer') throw new ApiError(400, 'Geçersiz rol.');
  const token = randomBytes(16).toString('hex');
  db.prepare('INSERT INTO invites (token, office_id, email, role) VALUES (?, ?, ?, ?)').run(
    token,
    inviter.office_id,
    input.email.trim().toLowerCase(),
    input.role,
  );
  return { token };
}

export function acceptInvite(db: DB, input: { token: string; name: string; password: string }) {
  requireFields({ token: input.token, name: input.name, password: input.password });
  return db.transaction(() => {
    const invite = db
      .prepare('SELECT office_id, email, role FROM invites WHERE token = ? AND used = 0')
      .get(input.token) as { office_id: number; email: string; role: Role } | undefined;
    if (!invite) throw new ApiError(404, 'Davet bulunamadı ya da daha önce kullanılmış.');
    const userId = insertUser(db, invite.office_id, input.name, invite.email, input.password, invite.role);
    db.prepare('UPDATE invites SET used = 1 WHERE token = ?').run(input.token);
    return { token: newSession(db, userId), user: getUser(db, userId) };
  })();
}

export function getUser(db: DB, id: number): User {
  return db.prepare(`SELECT ${USER_COLUMNS} FROM users WHERE id = ?`).get(id) as User;
}

export function userFromToken(db: DB, token: string | undefined): User {
  if (!token) throw new ApiError(401, 'Giriş yapmanız gerekiyor.');
  const row = db.prepare('SELECT user_id FROM sessions WHERE token = ?').get(token) as
    | { user_id: number }
    | undefined;
  if (!row) throw new ApiError(401, 'Oturum geçersiz, tekrar giriş yapın.');
  return getUser(db, row.user_id);
}

export function listOfficeUsers(db: DB, officeId: number): User[] {
  return db.prepare(`SELECT ${USER_COLUMNS} FROM users WHERE office_id = ? ORDER BY name`).all(officeId) as User[];
}

export function requireFinance(user: User) {
  if (!user.can_finance) throw new ApiError(403, 'Muhasebeyi görme yetkiniz yok. Büro yöneticisinden isteyin.');
}

/** Büro yöneticisi bir çalışanın rolünü ve yetkilerini değiştirir. */
export function setPermissions(
  db: DB,
  admin: User,
  userId: number,
  input: { role?: Role; isAdmin?: boolean; canFinance?: boolean; canApprove?: boolean; allCases?: boolean; isCeo?: boolean },
) {
  if (!admin.is_admin) throw new ApiError(403, 'Yetkileri yalnızca büro yöneticisi değiştirebilir.');
  const target = db.prepare(`SELECT ${USER_COLUMNS} FROM users WHERE id = ? AND office_id = ?`).get(userId, admin.office_id) as
    | User
    | undefined;
  if (!target) throw new ApiError(404, 'Kullanıcı bulunamadı.');
  if (input.role !== undefined && input.role !== 'avukat' && input.role !== 'stajyer') throw new ApiError(400, 'Geçersiz rol.');
  const role = input.role ?? target.role;
  const isAdmin = input.isAdmin === undefined ? target.is_admin : input.isAdmin ? 1 : 0;
  if (!isAdmin && target.is_admin) {
    const admins = db.prepare('SELECT COUNT(*) AS n FROM users WHERE office_id = ? AND is_admin = 1').get(admin.office_id) as { n: number };
    if (admins.n <= 1) throw new ApiError(400, 'Büroda en az bir yönetici kalmalı.');
  }
  const canApprove = role === 'stajyer' ? 0 : input.canApprove === undefined ? target.can_approve : input.canApprove ? 1 : 0;
  db.prepare('UPDATE users SET role = ?, is_admin = ?, can_finance = ?, can_approve = ?, all_cases = ? WHERE id = ?').run(
    role,
    isAdmin,
    input.canFinance === undefined ? target.can_finance : input.canFinance ? 1 : 0,
    canApprove,
    input.allCases === undefined ? target.all_cases : input.allCases ? 1 : 0,
    userId,
  );
  if (input.isCeo !== undefined) {
    // Yönetim paneli bütün büroyu gösterir; bu yüzden tüm dosyaları da görür.
    db.prepare('UPDATE users SET is_ceo = ?, all_cases = CASE WHEN ? = 1 THEN 1 ELSE all_cases END WHERE id = ?').run(
      input.isCeo ? 1 : 0,
      input.isCeo ? 1 : 0,
      userId,
    );
  }
  return getUser(db, userId);
}

/** Yönetim panelini (CEO) görebilir mi: CEO ya da büro yöneticisi. */
export function canSeeCeoPanel(user: User): boolean {
  return Boolean(user.is_ceo || user.is_admin);
}

/**
 * Büro yöneticisi davet kodu olmadan doğrudan kullanıcı açar. Verilen şifre geçicidir;
 * kişi ilk girişte kendi şifresini belirler.
 */
export function createUserDirect(
  db: DB,
  admin: User,
  input: { name: string; email: string; password: string; role?: Role; isCeo?: boolean },
) {
  if (!admin.is_admin) throw new ApiError(403, 'Kullanıcıyı yalnızca büro yöneticisi ekleyebilir.');
  requireFields({ name: input.name, email: input.email, password: input.password });
  const role: Role = input.role ?? 'avukat';
  if (role !== 'avukat' && role !== 'stajyer') throw new ApiError(400, 'Geçersiz rol.');
  return db.transaction(() => {
    const userId = insertUser(db, admin.office_id, input.name, input.email.trim().toLowerCase(), input.password, role);
    db.prepare('UPDATE users SET must_change_password = 1 WHERE id = ?').run(userId);
    if (input.isCeo) makeCeo(db, userId);
    return getUser(db, userId);
  })();
}

/**
 * CEO + avukat + direktör: bütün büroyu görür, muhasebeyi izler, ekibi yönetir (direktör)
 * ve avukat olarak dilekçe/sözleşme onaylar.
 */
function makeCeo(db: DB, userId: number) {
  db.prepare("UPDATE users SET role = 'avukat', is_ceo = 1, is_admin = 1, can_finance = 1, all_cases = 1, can_approve = 1 WHERE id = ?").run(userId);
}

/** Kişi kendi şifresini değiştirir (geçici şifreyle girdiyse zorunlu). */
export function changePassword(db: DB, user: User, input: { current: string; next: string }) {
  requireFields({ current: input.current, next: input.next });
  const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(user.id) as { password_hash: string };
  if (!verifyPassword(input.current, row.password_hash)) throw new ApiError(400, 'Şu anki şifre hatalı.');
  if (input.next.length < 8) throw new ApiError(400, 'Yeni şifre en az 8 karakter olmalıdır.');
  if (input.next === input.current) throw new ApiError(400, 'Yeni şifre eskisiyle aynı olamaz.');
  db.prepare('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?').run(hashPassword(input.next), user.id);
  return getUser(db, user.id);
}

/**
 * Tuğba Yörük (CEO, avukat, direktör) hesabı. Sunucu her açılışta bakar;
 * kullanıcı yoksa en çok kullanılan büroya geçici şifreyle ekler. Şifrenin kendisi kodda yok,
 * yalnız özeti (hash) var; ilk girişte değiştirmesi istenir.
 */
export const CEO_SEED = {
  name: 'Tuğba Yörük',
  email: 'tugba@timayplatform.com',
  passwordHash: '024df35cbde2cd932bd6cc1d78951e84:93e815174b30f6c0e4e280796815c8f3e56c058f844eac0993b6994f3dce4f797d82e03937eea0ec16fcdc90cfb8372e4b4df09877040e5a96d7ef9f970bc41a',
};

export function seedCeo(db: DB, seed = CEO_SEED): User | null {
  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(seed.email)) return null;
  const office = db
    .prepare(
      `SELECT o.id FROM offices o
       ORDER BY (SELECT COUNT(*) FROM users u WHERE u.office_id = o.id) + (SELECT COUNT(*) FROM cases c WHERE c.office_id = o.id) DESC, o.id
       LIMIT 1`,
    )
    .get() as { id: number } | undefined;
  if (!office) return null;
  return db.transaction(() => {
    const r = db
      .prepare(
        "INSERT INTO users (office_id, name, email, password_hash, role, must_change_password) VALUES (?, ?, ?, ?, 'avukat', 1)",
      )
      .run(office.id, seed.name, seed.email, seed.passwordHash);
    const userId = Number(r.lastInsertRowid);
    makeCeo(db, userId);
    return getUser(db, userId);
  })();
}
