import type { User } from './auth.ts';
import type { DB } from './db.ts';
import { ApiError } from './errors.ts';
import { optionalDate, ownedCaseId } from './money.ts';

export function listTasks(db: DB, user: User, query: { mine?: string } = {}) {
  const mine = query.mine === '1';
  return db
    .prepare(
      `SELECT t.*, a.name AS assignee_name, c.name AS created_by_name, k.title AS case_title
       FROM tasks t JOIN users a ON a.id = t.assignee_id JOIN users c ON c.id = t.created_by
       LEFT JOIN cases k ON k.id = t.case_id
       WHERE t.office_id = ? ${mine ? 'AND t.assignee_id = ?' : ''}
       ORDER BY t.done, CASE WHEN t.due_date = '' THEN 1 ELSE 0 END, t.due_date, t.id DESC`,
    )
    .all(...(mine ? [user.office_id, user.id] : [user.office_id]));
}

export function createTask(
  db: DB,
  user: User,
  input: { title: string; assigneeId?: number; dueDate?: string; caseId?: number | null },
) {
  if (!input.title?.trim()) throw new ApiError(400, 'Görev başlığı zorunludur.');
  const assignee = input.assigneeId ?? user.id;
  if (!db.prepare('SELECT 1 FROM users WHERE id = ? AND office_id = ?').get(assignee, user.office_id)) {
    throw new ApiError(400, 'Görev yalnızca büro çalışanlarına verilebilir.');
  }
  const r = db
    .prepare('INSERT INTO tasks (office_id, case_id, title, assignee_id, due_date, created_by) VALUES (?, ?, ?, ?, ?, ?)')
    .run(
      user.office_id,
      ownedCaseId(db, user.office_id, input.caseId),
      input.title.trim(),
      assignee,
      optionalDate(input.dueDate, 'Son tarih'),
      user.id,
    );
  return db.prepare('SELECT * FROM tasks WHERE id = ?').get(Number(r.lastInsertRowid));
}

/** Görevi tamamlar, geri açar ya da başka birine devreder. */
export function updateTask(db: DB, user: User, id: number, input: { done?: boolean; assigneeId?: number }) {
  const task = db.prepare('SELECT * FROM tasks WHERE id = ? AND office_id = ?').get(id, user.office_id) as
    | { done: number; assignee_id: number }
    | undefined;
  if (!task) throw new ApiError(404, 'Görev bulunamadı.');
  if (input.assigneeId !== undefined) {
    if (!db.prepare('SELECT 1 FROM users WHERE id = ? AND office_id = ?').get(input.assigneeId, user.office_id)) {
      throw new ApiError(400, 'Görev yalnızca büro çalışanlarına devredilebilir.');
    }
  }
  db.prepare('UPDATE tasks SET done = ?, assignee_id = ? WHERE id = ?').run(
    input.done === undefined ? task.done : input.done ? 1 : 0,
    input.assigneeId ?? task.assignee_id,
    id,
  );
  return db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);
}
