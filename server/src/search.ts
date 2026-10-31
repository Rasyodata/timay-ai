import type { User } from './auth.ts';
import { caseVisibility } from './cases.ts';
import type { DB } from './db.ts';
import { relevance } from './mevzuat.ts';

/*
 * Tam metin arama: dava dosyaları, dosya belgeleri (OCR metni dahil), dilekçeler, sözleşmeler,
 * notlar ve karar arşivi tek kutudan aranır. Kullanıcı yalnız görebildiği dosyaları görür.
 */

export interface Hit {
  type: 'case' | 'document' | 'petition' | 'contract' | 'note' | 'decision';
  id: number;
  title: string;
  context: string;
  snippet: string;
  score: number;
  link: { name: string; id?: number; tab?: string };
}

const norm = (s: string) => s.toLocaleLowerCase('tr');

function snippet(text: string, words: string[]) {
  const t = norm(text);
  let at = -1;
  for (const w of words) {
    at = t.indexOf(w);
    if (at >= 0) break;
  }
  const clean = (s: string) => s.replace(/\s+/g, ' ').trim();
  if (at < 0) return clean(text.slice(0, 180));
  const start = Math.max(0, at - 70);
  return `${start > 0 ? '…' : ''}${clean(text.slice(start, at + 150))}…`;
}

export function searchAll(db: DB, user: User, input: { q?: string; type?: string }) {
  const q = String(input.q ?? '').trim();
  const words = norm(q)
    .split(/\s+/)
    .filter((w) => w.length >= 2);
  if (!words.length) return { q, total: 0, counts: {}, hits: [] as Hit[] };
  const like = (cols: string[]) => {
    // Her kelime en az bir sütunda geçmeli.
    const sql = words.map(() => `(${cols.map((c) => `${c} LIKE ?`).join(' OR ')})`).join(' AND ');
    const params = words.flatMap((w) => cols.map(() => `%${w}%`));
    return { sql, params };
  };
  const want = (t: Hit['type']) => !input.type || input.type === t;
  const v = caseVisibility(user);
  const hits: Hit[] = [];
  const all = <T>(sql: string, ...p: unknown[]) => db.prepare(sql).all(...p) as T[];

  if (want('case')) {
    const l = like(['c.title', 'c.facts', 'c.parties', 'c.client', 'c.court', 'c.esas_no']);
    for (const r of all<{ id: number; title: string; facts: string; parties: string; client: string; court: string; esas_no: string }>(
      `SELECT c.id, c.title, c.facts, c.parties, c.client, c.court, c.esas_no FROM cases c WHERE c.office_id = ?${v.sql} AND ${l.sql} LIMIT 50`,
      user.office_id,
      ...v.params,
      ...l.params,
    )) {
      const text = [r.title, r.client, r.court, r.esas_no, r.parties, r.facts].join(' ');
      hits.push({ type: 'case', id: r.id, title: r.title, context: [r.court, r.esas_no].filter(Boolean).join(' · '), snippet: snippet(text, words), score: relevance(text, q) + 10, link: { name: 'case', id: r.id } });
    }
  }
  if (want('document')) {
    const l = like(['d.title', 'd.text', 'd.file_name']);
    for (const r of all<{ id: number; title: string; text: string; case_id: number; case_title: string }>(
      `SELECT d.id, d.title, d.text, d.case_id, c.title AS case_title FROM case_documents d JOIN cases c ON c.id = d.case_id
       WHERE d.office_id = ?${v.sql} AND ${l.sql} LIMIT 80`,
      user.office_id,
      ...v.params,
      ...l.params,
    ))
      hits.push({ type: 'document', id: r.id, title: r.title, context: r.case_title, snippet: snippet(r.text || r.title, words), score: relevance(`${r.title} ${r.text}`, q), link: { name: 'case', id: r.case_id, tab: 'belgeler' } });
  }
  if (want('petition')) {
    const l = like(['p.title', 'x.body']);
    for (const r of all<{ id: number; title: string; body: string; case_title: string }>(
      `SELECT p.id, p.title, x.body, c.title AS case_title FROM petitions p JOIN cases c ON c.id = p.case_id
       JOIN petition_versions x ON x.petition_id = p.id AND x.version = (SELECT MAX(version) FROM petition_versions y WHERE y.petition_id = p.id)
       WHERE c.office_id = ?${v.sql} AND ${l.sql} LIMIT 80`,
      user.office_id,
      ...v.params,
      ...l.params,
    ))
      hits.push({ type: 'petition', id: r.id, title: r.title, context: r.case_title, snippet: snippet(r.body, words), score: relevance(`${r.title} ${r.body}`, q), link: { name: 'petition', id: r.id } });
  }
  if (want('contract')) {
    const l = like(['k.title', 'k.body', 'k.parties']);
    for (const r of all<{ id: number; title: string; body: string; parties: string }>(
      `SELECT k.id, k.title, k.body, k.parties FROM contracts k WHERE k.office_id = ? AND ${l.sql} LIMIT 80`,
      user.office_id,
      ...l.params,
    ))
      hits.push({ type: 'contract', id: r.id, title: r.title, context: r.parties, snippet: snippet(r.body || r.title, words), score: relevance(`${r.title} ${r.body}`, q), link: { name: 'contract', id: r.id } });
  }
  if (want('note')) {
    const l = like(['n.body']);
    for (const r of all<{ id: number; body: string; case_id: number | null; case_title: string | null }>(
      `SELECT n.id, n.body, n.case_id, c.title AS case_title FROM notes n LEFT JOIN cases c ON c.id = n.case_id
       WHERE n.office_id = ? AND (n.case_id IS NULL OR EXISTS (SELECT 1 FROM cases c WHERE c.id = n.case_id${v.sql})) AND ${l.sql} LIMIT 50`,
      user.office_id,
      ...v.params,
      ...l.params,
    ))
      hits.push({
        type: 'note',
        id: r.id,
        title: r.body.split('\n')[0].slice(0, 80),
        context: r.case_title ?? 'Büro notu',
        snippet: snippet(r.body, words),
        score: relevance(r.body, q),
        link: r.case_id ? { name: 'case', id: r.case_id, tab: 'notlar' } : { name: 'notes' },
      });
  }
  if (want('decision')) {
    const l = like(['text']);
    for (const r of all<{ id: number; court: string; chamber: string; esas_no: string; karar_no: string; text: string }>(
      `SELECT id, court, chamber, esas_no, karar_no, text FROM decisions WHERE ${l.sql} LIMIT 50`,
      ...l.params,
    ))
      hits.push({
        type: 'decision',
        id: r.id,
        title: `${r.court} ${r.chamber} ${r.esas_no} E. / ${r.karar_no} K.`,
        context: 'Karar arşivi',
        snippet: snippet(r.text, words),
        score: relevance(r.text, q),
        link: { name: 'decisions' },
      });
  }
  hits.sort((a, b) => b.score - a.score);
  const counts: Record<string, number> = {};
  for (const h of hits) counts[h.type] = (counts[h.type] ?? 0) + 1;
  return { q, total: hits.length, counts, hits: hits.slice(0, 150) };
}
