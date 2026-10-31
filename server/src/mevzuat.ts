import type { User } from './auth.ts';
import { caseVisibility } from './cases.ts';
import type { DB } from './db.ts';
import { ApiError } from './errors.ts';
import { findLawByNo, findLawByShort, LAWS } from './laws.ts';
import { DATE } from './money.ts';

/*
 * İçtihat sonuçlarında uygunluk yüzdesi ve ilgili kanun maddeleri; mevzuat değişikliği takibi:
 * bir kanun maddesi değişince büronun hangi sözleşme ve dilekçelerinin o maddeye dayandığı listelenir.
 */

export interface ArticleRef {
  law: string;
  article: number;
  label: string;
}

const SHORTS = [...LAWS.map((l) => l.short), 'İK', 'BK', 'MK', 'İş Kanunu']
  .map((s) => s.replace(/\./g, '\\.?').replace(/\s+/g, '\\s*'))
  .sort((a, b) => b.length - a.length)
  .join('|');
const SHORT_RE = new RegExp(`(?<![\\p{L}])(${SHORTS})\\s*(?:m(?:adde|d)?\\.?\\s*)?(\\d{1,4})(?:\\s*\\/\\s*\\d+)?(?![\\d\\p{L}])`, 'gu');
const NO_RE = /(\d{4})\s+sayılı[^.\n]{0,90}?(\d{1,4})\.?\s*(?:ve\s+\d{1,4}\.?\s*)?madde/giu;

/** Metindeki kanun maddesi atıfları: "TBK 117", "HMK m. 127", "6098 sayılı Kanun'un 344. maddesi". */
export function extractArticles(text: string): ArticleRef[] {
  const out = new Map<string, ArticleRef>();
  const add = (short: string | undefined, article: number) => {
    if (!short || !article) return;
    const law = findLawByShort(short) ?? (/^iş\s*kanunu$/i.test(short.trim()) ? LAWS[0] : undefined);
    if (!law || (law.maxArticle && article > law.maxArticle)) return;
    const key = `${law.short} ${article}`;
    out.set(key, { law: law.short, article, label: `${law.short} m.${article}` });
  };
  for (const m of text.matchAll(SHORT_RE)) add(m[1], Number(m[2]));
  for (const m of text.matchAll(NO_RE)) add(findLawByNo(m[1])?.short, Number(m[2]));
  return [...out.values()];
}

const norm = (s: string) => s.toLocaleLowerCase('tr');

/** Sorgu ile karar metninin uygunluğu (0–100): kelimelerin geçmesi, tam ifade ve geçiş sıklığı. */
export function relevance(text: string, query: string) {
  const t = norm(text);
  const words = norm(query)
    .split(/[\s,;]+/)
    .map((w) => w.replace(/^["']|["']$/g, ''))
    .filter((w) => w.length >= 3);
  if (!words.length) return 0;
  let hits = 0;
  let count = 0;
  for (const w of words) {
    const n = t.split(w).length - 1;
    if (n) hits++;
    count += Math.min(n, 10);
  }
  const phrase = words.length > 1 && t.includes(norm(query).replace(/["']/g, '').trim()) ? 25 : 0;
  const score = (hits / words.length) * 60 + phrase + Math.min(15, (count / (words.length * 4)) * 15);
  return Math.max(1, Math.min(100, Math.round(words.length === 1 ? (score / 75) * 100 : score)));
}

// ---------------------------------------------------------------- mevzuat değişikliği takibi

interface ChangeRow {
  id: number;
  law: string;
  articles: string;
  title: string;
  effective_date: string;
  summary: string;
  created_at: string;
}

function parseArticles(raw: unknown) {
  return String(raw ?? '')
    .split(/[\s,;]+/)
    .map((x) => Number(x.replace(/\D/g, '')))
    .filter((n) => n > 0 && n < 5000);
}

export function lawOptions() {
  return LAWS.map((l) => ({ short: l.short, name: l.name, no: l.no }));
}

export function listChanges(db: DB, user: User) {
  const rows = db.prepare('SELECT * FROM law_changes WHERE office_id = ? ORDER BY effective_date DESC, id DESC').all(user.office_id) as ChangeRow[];
  return rows.map((r) => {
    const impact = impactOf(db, user, r);
    return { ...r, articles: parseArticles(r.articles), affected: impact.length, impact };
  });
}

export function createChange(db: DB, user: User, input: { law?: string; articles?: string; title?: string; effectiveDate?: string; summary?: string }) {
  const law = findLawByShort(String(input.law ?? ''));
  if (!law) throw new ApiError(400, 'Kanun seçin.');
  const date = String(input.effectiveDate ?? '');
  if (date && !DATE.test(date)) throw new ApiError(400, 'Yürürlük tarihi YYYY-AA-GG biçiminde olmalı.');
  const articles = parseArticles(input.articles);
  const title = String(input.title ?? '').trim() || `${law.short} ${articles.length ? `m.${articles.join(', ')}` : ''} değişikliği`.trim();
  const r = db
    .prepare('INSERT INTO law_changes (office_id, law, articles, title, effective_date, summary, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(user.office_id, law.short, articles.join(','), title, date, String(input.summary ?? '').trim(), user.id);
  return listChanges(db, user).find((c) => c.id === Number(r.lastInsertRowid));
}

export function deleteChange(db: DB, user: User, id: number) {
  const r = db.prepare('DELETE FROM law_changes WHERE id = ? AND office_id = ?').run(id, user.office_id);
  if (!r.changes) throw new ApiError(404, 'Kayıt bulunamadı.');
  return { ok: true };
}

function snippet(text: string, needle: string) {
  const i = norm(text).indexOf(norm(needle));
  if (i < 0) return text.slice(0, 160);
  return `${i > 60 ? '…' : ''}${text.slice(Math.max(0, i - 60), i + needle.length + 80).replace(/\s+/g, ' ')}…`;
}

/** Değişikliğin etkilediği sözleşmeler ve dilekçeler (o kanunun o maddelerine atıf yapanlar). */
function impactOf(db: DB, user: User, change: ChangeRow) {
  const wanted = parseArticles(change.articles);
  const law = findLawByShort(change.law)!;
  const docs: { type: 'contract' | 'petition'; id: number; title: string; status: string; body: string; case_title?: string }[] = [];
  for (const c of db.prepare("SELECT id, title, status, body FROM contracts WHERE office_id = ? AND status != 'sona_erdi'").all(user.office_id) as {
    id: number;
    title: string;
    status: string;
    body: string;
  }[])
    docs.push({ type: 'contract', ...c });
  const v = caseVisibility(user);
  for (const p of db
    .prepare(
      `SELECT p.id, p.title, p.status, c.title AS case_title,
        (SELECT body FROM petition_versions x WHERE x.petition_id = p.id ORDER BY version DESC LIMIT 1) AS body
       FROM petitions p JOIN cases c ON c.id = p.case_id WHERE c.office_id = ? AND c.status = 'acik'${v.sql}`,
    )
    .all(user.office_id, ...v.params) as { id: number; title: string; status: string; case_title: string; body: string | null }[])
    docs.push({ type: 'petition', ...p, body: p.body ?? '' });

  const out: { type: 'contract' | 'petition'; id: number; title: string; status: string; context: string; refs: string[]; snippet: string }[] = [];
  for (const d of docs) {
    const refs = extractArticles(d.body).filter((r) => r.law === law.short && (!wanted.length || wanted.includes(r.article)));
    // Madde verilmemişse kanunun adının geçmesi de yeterlidir.
    const byName = !wanted.length && !refs.length && norm(d.body).includes(norm(law.name));
    if (!refs.length && !byName) continue;
    const needle = refs.length ? String(refs[0].article) : law.name;
    out.push({
      type: d.type,
      id: d.id,
      title: d.title,
      status: d.status,
      context: d.case_title ?? '',
      refs: refs.map((r) => r.label),
      snippet: snippet(d.body, refs.length ? `${needle}` : needle),
    });
  }
  return out;
}
