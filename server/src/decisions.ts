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
  const row = db
    .prepare('SELECT id FROM decisions WHERE court = ? AND esas_no = ? AND karar_no = ?')
    .get(input.court.trim(), input.esasNo, input.kararNo) as { id: number };
  return row.id;
}

export function searchDecisions(db: DB, query: string, limit = 20) {
  return searchArchive(db, { q: query, limit }).items;
}

/**
 * Arşivde arama: kelimelerin hepsi geçmeli; esas/karar numarası tam eşleşir.
 * Sorgu boşsa en son eklenen kararlar döner.
 */
export function searchArchive(db: DB, input: { q?: string; chamber?: string; year?: string; limit?: number; offset?: number }) {
  const where: string[] = [];
  const params: unknown[] = [];
  const q = (input.q ?? '').trim();
  if (q) {
    if (NO_PATTERN.test(q)) {
      where.push('(esas_no = ? OR karar_no = ?)');
      params.push(q, q);
    } else {
      for (const word of q.split(/\s+/).filter(Boolean)) {
        where.push('(text LIKE ? OR chamber LIKE ?)');
        params.push(`%${word}%`, `%${word}%`);
      }
    }
  }
  if (input.chamber?.trim()) {
    where.push('chamber LIKE ?');
    params.push(`%${input.chamber.trim()}%`);
  }
  if (input.year && /^\d{4}$/.test(input.year)) {
    where.push('(substr(decision_date, 1, 4) = ? OR karar_no LIKE ?)');
    params.push(input.year, `${input.year}/%`);
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const limit = Math.min(Number(input.limit ?? 20) || 20, 100);
  const offset = Math.max(Number(input.offset ?? 0) || 0, 0);
  const total = (db.prepare(`SELECT COUNT(*) AS n FROM decisions ${clause}`).get(...params) as { n: number }).n;
  const items = db
    .prepare(
      `SELECT id, court, chamber, esas_no, karar_no, decision_date, source_url, substr(text, 1, 400) AS excerpt
       FROM decisions ${clause} ORDER BY ${q ? 'decision_date DESC' : 'id DESC'} LIMIT ? OFFSET ?`,
    )
    .all(...params, limit, offset);
  return { total, items };
}

export function getDecision(db: DB, id: number) {
  const row = db.prepare('SELECT * FROM decisions WHERE id = ?').get(id);
  if (!row) throw new ApiError(404, 'Karar bulunamadı.');
  return row;
}

export function archiveStats(db: DB) {
  const total = (db.prepare('SELECT COUNT(*) AS n FROM decisions').get() as { n: number }).n;
  const chambers = db
    .prepare("SELECT chamber, COUNT(*) AS n FROM decisions WHERE chamber != '' GROUP BY chamber ORDER BY n DESC LIMIT 12")
    .all();
  return { total, chambers };
}
