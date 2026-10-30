import type { DB } from './db.ts';

export interface Citation {
  raw: string;
  esasNo: string;
  kararNo: string;
}

export interface CheckedCitation extends Citation {
  decisionId: number | null;
  court: string | null;
  sourceUrl: string | null;
}

// "2020/1234 E., 2021/5678 K." ve "E. 2020/1234, K. 2021/5678" yazımlarını tanır.
const patterns = [
  /(\d{4}\/\d+)\s*E\.?\s*,?\s*(\d{4}\/\d+)\s*K\./g,
  /E\.?\s*:?\s*(\d{4}\/\d+)\s*,?\s*K\.?\s*:?\s*(\d{4}\/\d+)/g,
];

export function extractCitations(body: string): Citation[] {
  const found = new Map<string, Citation>();
  for (const pattern of patterns) {
    for (const m of body.matchAll(pattern)) {
      const key = `${m[1]}|${m[2]}`;
      if (!found.has(key)) found.set(key, { raw: m[0], esasNo: m[1], kararNo: m[2] });
    }
  }
  return [...found.values()];
}

export function checkCitations(db: DB, body: string): CheckedCitation[] {
  const lookup = db.prepare(
    'SELECT id, court, source_url FROM decisions WHERE esas_no = ? AND karar_no = ?',
  );
  return extractCitations(body).map((c) => {
    const row = lookup.get(c.esasNo, c.kararNo) as
      | { id: number; court: string; source_url: string }
      | undefined;
    return {
      ...c,
      decisionId: row?.id ?? null,
      court: row?.court ?? null,
      sourceUrl: row?.source_url ?? null,
    };
  });
}
