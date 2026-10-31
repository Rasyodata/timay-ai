import type { User } from './auth.ts';
import { caseVisibility } from './cases.ts';
import type { DB } from './db.ts';

/*
 * Bildirim merkezi: kullanıcıya düşen süreler, duruşmalar, görevler ve onay istekleri.
 * Bildirimler veriden anlık hesaplanır; son güne 3 gün, 1 gün kala ve son gün ayrı ayrı bildirilir.
 */

export type NoticeLevel = 'kritik' | 'uyari' | 'bilgi';

export interface Notice {
  key: string;
  level: NoticeLevel;
  kind: 'sure' | 'durusma' | 'gorev' | 'onay';
  title: string;
  detail: string;
  date: string;
  link: { view: string; id?: number; tab?: string };
  read: boolean;
}

function day(offset = 0) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}

const tr = (date: string) => date.split('-').reverse().join('.');

/** Son güne kalan gün sayısını uyarı basamağına çevirir: 3 gün, 1 gün, bugün, geçti. */
function bucket(date: string): { id: string; label: string; level: NoticeLevel } | null {
  const left = Math.round((Date.parse(date) - Date.parse(day())) / 86_400_000);
  if (left < 0) return { id: 'gecti', label: `${-left} gün geçti`, level: 'kritik' };
  if (left === 0) return { id: 'bugun', label: 'bugün son gün', level: 'kritik' };
  if (left === 1) return { id: '1', label: 'yarın son gün', level: 'kritik' };
  if (left <= 3) return { id: '3', label: `${left} gün kaldı`, level: 'uyari' };
  return null;
}

export function listNotifications(db: DB, user: User) {
  const out: Omit<Notice, 'read'>[] = [];
  const all = <T>(sql: string, ...p: unknown[]) => db.prepare(sql).all(...p) as T[];

  for (const d of all<{ id: number; title: string; due_date: string; case_id: number | null; case_title: string | null; basis: string }>(
    `SELECT d.id, d.title, d.due_date, d.case_id, k.title AS case_title, d.basis FROM legal_deadlines d LEFT JOIN cases k ON k.id = d.case_id
     WHERE d.office_id = ? AND d.done = 0 AND COALESCE(d.responsible_id, d.created_by) = ? AND d.due_date <= ?`,
    user.office_id,
    user.id,
    day(3),
  )) {
    const b = bucket(d.due_date)!;
    out.push({
      key: `sure-${d.id}-${b.id}`,
      level: b.level,
      kind: 'sure',
      title: `${d.title}: ${b.label}`,
      detail: [d.case_title, `son gün ${tr(d.due_date)}`, d.basis.split(' · ')[0]].filter(Boolean).join(' · '),
      date: d.due_date,
      link: d.case_id ? { view: 'case', id: d.case_id } : { view: 'deadlines' },
    });
  }

  const v = caseVisibility(user);
  for (const h of all<{ id: number; date: string; time: string; case_id: number; title: string; court: string }>(
    `SELECT h.id, h.date, h.time, c.id AS case_id, c.title, c.court FROM hearings h JOIN cases c ON c.id = h.case_id
     WHERE c.office_id = ? AND h.date >= ? AND h.date <= ? AND COALESCE(c.responsible_id, c.created_by) = ?${v.sql}`,
    user.office_id,
    day(),
    day(3),
    user.id,
    ...v.params,
  )) {
    const left = Math.round((Date.parse(h.date) - Date.parse(day())) / 86_400_000);
    const id = left === 0 ? 'bugun' : left === 1 ? '1' : '3';
    out.push({
      key: `durusma-${h.id}-${id}`,
      level: left <= 1 ? 'kritik' : 'uyari',
      kind: 'durusma',
      title: `Duruşma ${left === 0 ? 'bugün' : left === 1 ? 'yarın' : `${left} gün sonra`}: ${h.title}`,
      detail: [h.court, `${tr(h.date)}${h.time ? ` ${h.time}` : ''}`].filter(Boolean).join(' · '),
      date: h.date,
      link: { view: 'case', id: h.case_id, tab: 'durusmalar' },
    });
  }

  for (const t of all<{ id: number; title: string; due_date: string; case_title: string | null }>(
    `SELECT t.id, t.title, t.due_date, c.title AS case_title FROM tasks t LEFT JOIN cases c ON c.id = t.case_id
     WHERE t.office_id = ? AND t.assignee_id = ? AND t.done = 0 AND t.due_date != '' AND t.due_date <= ?`,
    user.office_id,
    user.id,
    day(1),
  )) {
    const b = bucket(t.due_date)!;
    out.push({
      key: `gorev-${t.id}-${b.id}`,
      level: b.id === 'gecti' ? 'kritik' : 'uyari',
      kind: 'gorev',
      title: `Görev: ${t.title}`,
      detail: [t.case_title, b.label].filter(Boolean).join(' · '),
      date: t.due_date,
      link: { view: 'tasks' },
    });
  }

  for (const t of all<{ id: number; title: string; assignee: string }>(
    `SELECT t.id, t.title, u.name AS assignee FROM tasks t JOIN users u ON u.id = t.assignee_id
     WHERE t.office_id = ? AND t.reviewer_id = ? AND t.status = 'inceleme' AND t.done = 0`,
    user.office_id,
    user.id,
  )) {
    out.push({ key: `gorev-kontrol-${t.id}`, level: 'bilgi', kind: 'onay', title: `Kontrol bekliyor: ${t.title}`, detail: `${t.assignee} tamamladı`, date: day(), link: { view: 'tasks' } });
  }

  for (const p of all<{ id: number; title: string; author: string; case_title: string }>(
    `SELECT p.id, p.title, u.name AS author, c.title AS case_title FROM petitions p JOIN cases c ON c.id = p.case_id JOIN users u ON u.id = p.author_id
     WHERE c.office_id = ? AND p.status = 'incelemede' AND p.author_id != ?`,
    user.office_id,
    user.id,
  )) {
    out.push({ key: `dilekce-onay-${p.id}`, level: 'bilgi', kind: 'onay', title: `Onay bekleyen dilekçe: ${p.title}`, detail: `${p.case_title} · ${p.author}`, date: day(), link: { view: 'petition', id: p.id } });
  }

  for (const c of all<{ id: number; title: string; submitter: string }>(
    `SELECT k.id, k.title, COALESCE(u.name, '') AS submitter FROM contracts k LEFT JOIN users u ON u.id = k.submitted_by
     WHERE k.office_id = ? AND k.review_status = 'incelemede' AND COALESCE(k.submitted_by, 0) != ?`,
    user.office_id,
    user.id,
  )) {
    out.push({ key: `sozlesme-onay-${c.id}`, level: 'bilgi', kind: 'onay', title: `Onay bekleyen sözleşme: ${c.title}`, detail: c.submitter, date: day(), link: { view: 'contract', id: c.id } });
  }

  const read = new Set((db.prepare('SELECT key FROM notification_reads WHERE user_id = ?').all(user.id) as { key: string }[]).map((r) => r.key));
  const rank: Record<NoticeLevel, number> = { kritik: 0, uyari: 1, bilgi: 2 };
  const items: Notice[] = out
    .map((n) => ({ ...n, read: read.has(n.key) }))
    .sort((a, b) => Number(a.read) - Number(b.read) || rank[a.level] - rank[b.level] || a.date.localeCompare(b.date));
  return { items, unread: items.filter((i) => !i.read).length };
}

export function markRead(db: DB, user: User, input: { keys?: string[]; all?: boolean }) {
  const keys = input.all ? listNotifications(db, user).items.map((i) => i.key) : (input.keys ?? []).map(String).slice(0, 500);
  const ins = db.prepare('INSERT OR IGNORE INTO notification_reads (user_id, key) VALUES (?, ?)');
  db.transaction(() => keys.forEach((k) => ins.run(user.id, k)))();
  // Eski okundu kayıtları (90 gün) temizlenir.
  db.prepare("DELETE FROM notification_reads WHERE user_id = ? AND read_at < datetime('now', '-90 day')").run(user.id);
  return listNotifications(db, user);
}
