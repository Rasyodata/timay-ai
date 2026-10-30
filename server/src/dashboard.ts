import type { User } from './auth.ts';
import type { DB } from './db.ts';

/** Ana sayfa: tek sorguda büronun bugünkü durumu. */
export function dashboard(db: DB, user: User) {
  const o = user.office_id;
  const one = <T>(sql: string, ...p: unknown[]) => db.prepare(sql).get(...p) as T;
  const counts = {
    openCases: one<{ n: number }>("SELECT COUNT(*) AS n FROM cases WHERE office_id = ? AND status = 'acik'", o).n,
    drafts: one<{ n: number }>(
      "SELECT COUNT(*) AS n FROM petitions p JOIN cases c ON c.id = p.case_id WHERE c.office_id = ? AND p.status IN ('taslak', 'duzeltme')",
      o,
    ).n,
    inReview: one<{ n: number }>(
      "SELECT COUNT(*) AS n FROM petitions p JOIN cases c ON c.id = p.case_id WHERE c.office_id = ? AND p.status = 'incelemede'",
      o,
    ).n,
    approved: one<{ n: number }>(
      "SELECT COUNT(*) AS n FROM petitions p JOIN cases c ON c.id = p.case_id WHERE c.office_id = ? AND p.status = 'onayli'",
      o,
    ).n,
    activeContracts: one<{ n: number }>("SELECT COUNT(*) AS n FROM contracts WHERE office_id = ? AND status = 'yururlukte'", o).n,
    openEnforcement: one<{ n: number }>(
      "SELECT COUNT(*) AS n FROM enforcement_files WHERE office_id = ? AND status NOT IN ('tahsil', 'kapandi')",
      o,
    ).n,
  };
  const month = new Date().toISOString().slice(0, 7);
  const money = one<{ income: number; expense: number }>(
    `SELECT COALESCE(SUM(CASE WHEN kind = 'gelir' THEN amount_kurus END), 0) AS income,
            COALESCE(SUM(CASE WHEN kind = 'gider' THEN amount_kurus END), 0) AS expense
     FROM finance_entries WHERE office_id = ? AND substr(date, 1, 7) = ?`,
    o,
    month,
  );
  // İnceleyebileceği dilekçeler: incelemede olup hiçbir sürümünü yazmadığı dilekçeler.
  const toReview =
    user.role === 'avukat' && user.can_approve
      ? db
          .prepare(
            `SELECT p.id, p.title, c.title AS case_title, u.name AS author_name
             FROM petitions p JOIN cases c ON c.id = p.case_id JOIN users u ON u.id = p.author_id
             WHERE c.office_id = ? AND p.status = 'incelemede' AND p.author_id != ?
               AND NOT EXISTS (SELECT 1 FROM petition_versions v WHERE v.petition_id = p.id AND v.created_by = ?)
             ORDER BY p.id DESC LIMIT 10`,
          )
          .all(o, user.id, user.id)
      : [];
  const myDrafts = db
    .prepare(
      `SELECT p.id, p.title, p.status, c.title AS case_title FROM petitions p JOIN cases c ON c.id = p.case_id
       WHERE c.office_id = ? AND p.author_id = ? AND p.status IN ('taslak', 'duzeltme') ORDER BY p.id DESC LIMIT 10`,
    )
    .all(o, user.id);
  const hearings = db
    .prepare(
      `SELECT h.id, h.date, h.time, h.place, h.case_id, c.title AS case_title, c.court AS case_court
       FROM hearings h JOIN cases c ON c.id = h.case_id
       WHERE c.office_id = ? AND h.date BETWEEN date('now') AND date('now', '+30 day') ORDER BY h.date, h.time LIMIT 10`,
    )
    .all(o);
  const tasks = db
    .prepare(
      `SELECT t.id, t.title, t.due_date, k.title AS case_title, c.name AS created_by_name FROM tasks t
       JOIN users c ON c.id = t.created_by LEFT JOIN cases k ON k.id = t.case_id
       WHERE t.office_id = ? AND t.assignee_id = ? AND t.done = 0
       ORDER BY CASE WHEN t.due_date = '' THEN 1 ELSE 0 END, t.due_date LIMIT 10`,
    )
    .all(o, user.id);
  const deadlines = db
    .prepare(
      `SELECT o.id, o.text, o.due_date, o.amount_kurus, k.id AS contract_id, k.title AS contract_title
       FROM contract_obligations o JOIN contracts k ON k.id = o.contract_id
       WHERE k.office_id = ? AND o.done = 0 AND o.due_date != '' AND o.due_date <= date('now', '+60 day')
       ORDER BY o.due_date LIMIT 10`,
    )
    .all(o);
  const expiring = db
    .prepare(
      `SELECT id, title, end_date FROM contracts
       WHERE office_id = ? AND status = 'yururlukte' AND end_date != '' AND end_date <= date('now', '+60 day')
       ORDER BY end_date LIMIT 10`,
    )
    .all(o);
  const contractsToReview = user.can_approve
    ? db
        .prepare(
          `SELECT c.id, c.title, u.name AS author_name FROM contracts c JOIN users u ON u.id = c.submitted_by
           WHERE c.office_id = ? AND c.review_status = 'incelemede' AND c.submitted_by != ? ORDER BY c.id DESC LIMIT 10`,
        )
        .all(o, user.id)
    : [];
  const visibleMoney = user.can_finance ? money : { income: 0, expense: 0 };
  return {
    counts,
    month: { ...visibleMoney, profit: visibleMoney.income - visibleMoney.expense, hidden: !user.can_finance },
    toReview,
    contractsToReview,
    myDrafts,
    hearings,
    tasks,
    deadlines,
    expiring,
  };
}
