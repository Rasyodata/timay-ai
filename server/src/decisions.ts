import type { DB } from './db.ts';
import { ApiError } from './errors.ts';

export interface DecisionInput {
  court: string;
  chamber?: string;
  esasNo: string;
  kararNo: string;
  decisionDate?: string;
  text?: string;
  sourceUrl?: string;
}

const NO_PATTERN = /^\d{4}\/\d+$/;

/** Karar arşivine ekler; aynı mahkeme + esas + karar numarası varsa günceller. */
export function upsertDecision(db: DB, input: DecisionInput) {
  if (!input.court?.trim()) throw new ApiError(400, 'Mahkeme adı zorunludur.');
  if (!NO_PATTERN.test(input.esasNo ?? '') || !NO_PATTERN.test(input.kararNo ?? '')) {
    throw new ApiError(400, 'Esas ve karar numarası "2021/1234" biçiminde olmalıdır.');
  }
  db.prepare(
    `INSERT INTO decisions (court, chamber, esas_no, karar_no, decision_date, text, source_url)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (court, esas_no, karar_no) DO UPDATE SET
       chamber = excluded.chamber, decision_date = excluded.decision_date,
       text = excluded.text, source_url = excluded.source_url`,
  ).run(
    input.court.trim(),
    input.chamber ?? '',
    input.esasNo,
    input.kararNo,
    input.decisionDate ?? '',
    input.text ?? '',
    input.sourceUrl ?? '',
  );
}

export function searchDecisions(db: DB, query: string, limit = 20) {
  const q = query.trim();
  if (!q) return [];
  const like = `%${q}%`;
  return db
    .prepare(
      `SELECT id, court, chamber, esas_no, karar_no, decision_date, source_url,
              substr(text, 1, 400) AS excerpt
       FROM decisions
       WHERE text LIKE ? OR esas_no = ? OR karar_no = ? OR chamber LIKE ?
       ORDER BY decision_date DESC LIMIT ?`,
    )
    .all(like, q, q, like, limit);
}
