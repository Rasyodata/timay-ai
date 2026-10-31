import type { User } from './auth.ts';
import type { DB } from './db.ts';
import { ApiError } from './errors.ts';
import { optionalDate, ownedCaseId } from './money.ts';

export function listTasks(db: DB, user: User, query: { mine?: string } = {}) {
  const mine = query.mine === '1';
  return db
    .prepare(
      `SELECT t.*, a.name AS assignee_name, c.name AS created_by_name, r.name AS reviewer_name, k.title AS case_title
       FROM tasks t JOIN users a ON a.id = t.assignee_id JOIN users c ON c.id = t.created_by
       LEFT JOIN users r ON r.id = t.reviewer_id
       LEFT JOIN cases k ON k.id = t.case_id
       WHERE t.office_id = ? ${mine ? 'AND t.assignee_id = ?' : ''}
       ORDER BY t.done, CASE WHEN t.due_date = '' THEN 1 ELSE 0 END, t.due_date, t.id DESC`,
    )
    .all(...(mine ? [user.office_id, user.id] : [user.office_id]));
}

export function createTask(
  db: DB,
  user: User,
  input: { title: string; assigneeId?: number; reviewerId?: number | null; dueDate?: string; caseId?: number | null },
) {
  if (!input.title?.trim()) throw new ApiError(400, 'Görev başlığı zorunludur.');
  const assignee = input.assigneeId ?? user.id;
  if (!db.prepare('SELECT 1 FROM users WHERE id = ? AND office_id = ?').get(assignee, user.office_id)) {
    throw new ApiError(400, 'Görev yalnızca büro çalışanlarına verilebilir.');
  }
  const reviewer = input.reviewerId ? officeUser(db, user, input.reviewerId, 'Kontrol eden') : null;
  const r = db
    .prepare('INSERT INTO tasks (office_id, case_id, title, assignee_id, reviewer_id, due_date, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(
      user.office_id,
      ownedCaseId(db, user.office_id, input.caseId),
      input.title.trim(),
      assignee,
      reviewer,
      optionalDate(input.dueDate, 'Son tarih'),
      user.id,
    );
  return db.prepare('SELECT * FROM tasks WHERE id = ?').get(Number(r.lastInsertRowid));
}

function officeUser(db: DB, user: User, id: number, label: string) {
  if (!db.prepare('SELECT 1 FROM users WHERE id = ? AND office_id = ?').get(id, user.office_id)) {
    throw new ApiError(400, `${label} büro çalışanı olmalı.`);
  }
  return id;
}

export const TASK_STATUSES = ['yapilacak', 'devam', 'inceleme', 'tamam'] as const;
type TaskStatus = (typeof TASK_STATUSES)[number];

/**
 * Görevi panoda taşır, tamamlar, geri açar ya da başka birine devreder.
 * Kontrol eden atanmışsa görevi yalnızca o tamamlayabilir; diğerlerinin "tamamla" isteği incelemeye gönderir.
 */
export function updateTask(
  db: DB,
  user: User,
  id: number,
  input: { done?: boolean; status?: string; assigneeId?: number; reviewerId?: number | null },
) {
  const task = db.prepare('SELECT * FROM tasks WHERE id = ? AND office_id = ?').get(id, user.office_id) as
    | { status: TaskStatus; assignee_id: number; reviewer_id: number | null }
    | undefined;
  if (!task) throw new ApiError(404, 'Görev bulunamadı.');
  if (input.assigneeId !== undefined) {
    if (!db.prepare('SELECT 1 FROM users WHERE id = ? AND office_id = ?').get(input.assigneeId, user.office_id)) {
      throw new ApiError(400, 'Görev yalnızca büro çalışanlarına devredilebilir.');
    }
  }
  const reviewer =
    input.reviewerId === undefined ? task.reviewer_id : input.reviewerId ? officeUser(db, user, input.reviewerId, 'Kontrol eden') : null;
  let status: TaskStatus = task.status;
  if (input.status !== undefined) {
    if (!TASK_STATUSES.includes(input.status as TaskStatus)) throw new ApiError(400, 'Geçersiz görev durumu.');
    status = input.status as TaskStatus;
  } else if (input.done !== undefined) {
    status = input.done ? 'tamam' : 'yapilacak';
  }
  if (status === 'tamam' && task.status !== 'tamam' && reviewer && reviewer !== user.id) {
    if (input.status === 'tamam') throw new ApiError(403, 'Bu görevi yalnızca kontrol eden kişi tamamlayabilir. Önce “İncelemede” sütununa taşıyın.');
    status = 'inceleme';
  }
  db.prepare('UPDATE tasks SET status = ?, done = ?, assignee_id = ?, reviewer_id = ? WHERE id = ?').run(
    status,
    status === 'tamam' ? 1 : 0,
    input.assigneeId ?? task.assignee_id,
    reviewer,
    id,
  );
  return db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);
}
