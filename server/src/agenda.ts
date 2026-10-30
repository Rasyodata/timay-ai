import type { User } from './auth.ts';
import type { DB } from './db.ts';
import { ApiError } from './errors.ts';
import { DATE, ownedCaseId } from './money.ts';

export interface AgendaEvent {
  kind: 'durusma' | 'gorev' | 'taahhut' | 'sozlesme' | 'not';
  id: number;
  date: string;
  time: string;
  title: string;
  detail: string;
  caseId: number | null;
  contractId: number | null;
}

/**
 * Ajanda: duruşmalar, kişinin görevleri, sözleşme taahhütleri ve bitişleri ile
 * kendi notları tek takvimde.
 */
export function agenda(db: DB, user: User, query: { from?: string; to?: string }): AgendaEvent[] {
  const today = new Date().toISOString().slice(0, 10);
  const from = query.from && DATE.test(query.from) ? query.from : today;
  const to = query.to && DATE.test(query.to) ? query.to : '9999-12-31';
  const o = user.office_id;
  const rows = (sql: string, ...p: unknown[]) => db.prepare(sql).all(...p) as Record<string, unknown>[];
  const events: AgendaEvent[] = [
    ...rows(
      `SELECT h.id, h.date, h.time, h.place, h.note, c.id AS case_id, c.title, c.court, c.esas_no
       FROM hearings h JOIN cases c ON c.id = h.case_id WHERE c.office_id = ? AND h.date BETWEEN ? AND ?`,
      o,
      from,
      to,
    ).map((r) => ({
      kind: 'durusma' as const,
      id: r.id as number,
      date: r.date as string,
      time: r.time as string,
      title: `Duruşma: ${r.title}`,
      detail: [r.court, r.esas_no, r.place, r.note].filter(Boolean).join(' · '),
      caseId: r.case_id as number,
      contractId: null,
    })),
    ...rows(
      `SELECT t.id, t.due_date, t.title, t.case_id, k.title AS case_title FROM tasks t LEFT JOIN cases k ON k.id = t.case_id
       WHERE t.office_id = ? AND t.assignee_id = ? AND t.done = 0 AND t.due_date BETWEEN ? AND ?`,
      o,
      user.id,
      from,
      to,
    ).map((r) => ({
      kind: 'gorev' as const,
      id: r.id as number,
      date: r.due_date as string,
      time: '',
      title: `Görev: ${r.title}`,
      detail: (r.case_title as string) ?? '',
      caseId: (r.case_id as number) ?? null,
      contractId: null,
    })),
    ...rows(
      `SELECT o.id, o.due_date, o.text, o.party, k.id AS contract_id, k.title FROM contract_obligations o
       JOIN contracts k ON k.id = o.contract_id WHERE k.office_id = ? AND o.done = 0 AND o.due_date BETWEEN ? AND ?`,
      o,
      from,
      to,
    ).map((r) => ({
      kind: 'taahhut' as const,
      id: r.id as number,
      date: r.due_date as string,
      time: '',
      title: `Taahhüt: ${r.title}`,
      detail: [r.party, r.text].filter(Boolean).join(': '),
      caseId: null,
      contractId: r.contract_id as number,
    })),
    ...rows(
      `SELECT id, end_date, title FROM contracts WHERE office_id = ? AND status = 'yururlukte' AND end_date BETWEEN ? AND ?`,
      o,
      from,
      to,
    ).map((r) => ({
      kind: 'sozlesme' as const,
      id: r.id as number,
      date: r.end_date as string,
      time: '',
      title: `Sözleşme bitiyor: ${r.title}`,
      detail: '',
      caseId: null,
      contractId: r.id as number,
    })),
    ...rows(
      `SELECT a.id, a.date, a.time, a.title, a.note, a.case_id FROM agenda_items a
       WHERE a.office_id = ? AND a.user_id = ? AND a.date BETWEEN ? AND ?`,
      o,
      user.id,
      from,
      to,
    ).map((r) => ({
      kind: 'not' as const,
      id: r.id as number,
      date: r.date as string,
      time: r.time as string,
      title: r.title as string,
      detail: r.note as string,
      caseId: (r.case_id as number) ?? null,
      contractId: null,
    })),
  ];
  return events.sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
}

export function addAgendaItem(
  db: DB,
  user: User,
  input: { date: string; time?: string; title: string; note?: string; caseId?: number | null },
) {
  if (!DATE.test(input.date ?? '')) throw new ApiError(400, 'Tarih YYYY-AA-GG biçiminde olmalı.');
  if (!input.title?.trim()) throw new ApiError(400, 'Başlık zorunludur.');
  db.prepare('INSERT INTO agenda_items (office_id, user_id, case_id, date, time, title, note) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
    user.office_id,
    user.id,
    ownedCaseId(db, user.office_id, input.caseId),
    input.date,
    input.time ?? '',
    input.title.trim(),
    input.note ?? '',
  );
  return { ok: true };
}

export function deleteAgendaItem(db: DB, user: User, id: number) {
  const r = db.prepare('DELETE FROM agenda_items WHERE id = ? AND user_id = ?').run(id, user.id);
  if (r.changes === 0) throw new ApiError(404, 'Not bulunamadı.');
  return { ok: true };
}
