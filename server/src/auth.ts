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
}

const USER_COLUMNS = 'id, office_id, name, email, role, is_admin, can_finance, can_approve, all_cases';

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
  input: { role?: Role; isAdmin?: boolean; canFinance?: boolean; canApprove?: boolean; allCases?: boolean },
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
  return getUser(db, userId);
}
