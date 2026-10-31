import type { User } from './auth.ts';
import { getCase } from './cases.ts';
import type { DB } from './db.ts';
import { reviewDocument } from './disciplines.ts';
import { analyzeCase } from './refresh.ts';
import { getSafahat } from './safahat.ts';
import { AREAS } from './templates.ts';

/*
 * Dava özeti ve strateji: dosyadaki bilgilerden (taraflar, aşama, süreler, belgeler, dilekçe incelemeleri,
 * sabit notlar) özet ve önceliklendirilmiş yol haritası; müvekkile gönderilecek durum raporu metni.
 * Yapay zekâ bağlanınca özet ve strateji ayrıca metinden yazılacak.
 */

const tr = (d: string) => (d ? d.split('-').reverse().join('.') : '');
const KIND_LABEL: Record<string, string> = { dilekce: 'dilekçe', karar: 'karar', bilirkisi: 'bilirkişi raporu', tutanak: 'tutanak', sozlesme: 'sözleşme', delil: 'delil', diger: 'diğer' };

export function caseSummary(db: DB, user: User, caseId: number) {
  const c = getCase(db, user, caseId);
  const saf = getSafahat(db, user, caseId);
  const analysis = analyzeCase(db, user, caseId);
  const area = AREAS.find((a) => a.id === c.area)?.name ?? '';
  const deadlines = db
    .prepare("SELECT title, due_date, basis FROM legal_deadlines WHERE case_id = ? AND done = 0 ORDER BY due_date LIMIT 10")
    .all(caseId) as { title: string; due_date: string; basis: string }[];
  const docs = db.prepare('SELECT kind, COUNT(*) AS n FROM case_documents WHERE case_id = ? GROUP BY kind').all(caseId) as { kind: string; n: number }[];
  const tasks = db
    .prepare("SELECT t.title, t.due_date, u.name AS assignee FROM tasks t JOIN users u ON u.id = t.assignee_id WHERE t.case_id = ? AND t.done = 0 ORDER BY t.due_date = '', t.due_date LIMIT 10")
    .all(caseId) as { title: string; due_date: string; assignee: string }[];
  const notes = db.prepare('SELECT body FROM notes WHERE case_id = ? AND pinned = 1 ORDER BY updated_at DESC LIMIT 5').all(caseId) as { body: string }[];
  const petitions = (
    db
      .prepare(
        `SELECT p.id, p.title, p.status, (SELECT body FROM petition_versions v WHERE v.petition_id = p.id ORDER BY version DESC LIMIT 1) AS body
         FROM petitions p WHERE p.case_id = ? ORDER BY p.id`,
      )
      .all(caseId) as { id: number; title: string; status: string; body: string | null }[]
  ).map((p) => {
    const r = p.body?.trim() ? reviewDocument({ db, body: p.body, title: p.title, caseInfo: { area: c.area, client: c.client, facts: c.facts, court: c.court, esas_no: c.esas_no, documents: docs.reduce((n, d) => n + d.n, 0) } }) : null;
    return { id: p.id, title: p.title, status: p.status, score: r?.summary.score ?? null, verdict: r?.summary.verdictLabel ?? '', priorities: r?.summary.priorities.slice(0, 2).map((x) => x.text) ?? [] };
  });

  // Strateji: önce kaçırılmaması gerekenler, sonra eksikler, sonra aşamanın sıradaki adımları.
  const strategy: { level: 'acil' | 'onemli' | 'plan'; text: string }[] = [];
  for (const d of deadlines.slice(0, 3)) strategy.push({ level: d.due_date <= new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10) ? 'acil' : 'onemli', text: `${d.title}: son gün ${tr(d.due_date)}${d.basis ? ` (${d.basis.split(' · ')[0]})` : ''}` });
  for (const i of analysis.issues.filter((x) => x.level === 'yuksek').slice(0, 4)) strategy.push({ level: 'acil', text: i.text });
  for (const p of petitions.filter((x) => x.score !== null && x.score < 80)) for (const t of p.priorities) strategy.push({ level: 'onemli', text: `${p.title}: ${t}` });
  for (const i of analysis.issues.filter((x) => x.level === 'orta').slice(0, 3)) strategy.push({ level: 'onemli', text: i.text });
  for (const s of saf.suggestions?.steps ?? []) strategy.push({ level: 'plan', text: `${s.title} (${tr(s.due)})` });

  const docText = docs.map((d) => `${d.n} ${KIND_LABEL[d.kind] ?? d.kind}`).join(', ');
  const lines = [
    `DOSYA DURUM RAPORU – ${c.title}`,
    `Tarih: ${tr(new Date().toISOString().slice(0, 10))}`,
    '',
    `Mahkeme: ${c.court || '—'}${c.esas_no ? ` · Esas: ${c.esas_no}` : ''}`,
    `Müvekkil: ${c.client || '—'}${area ? ` · Alan: ${area}` : ''}`,
    `Aşama: ${saf.current ? `${saf.current.title} (${tr(saf.current.date)})` : 'girilmedi'}`,
    `Sıradaki duruşma: ${saf.nextHearing ? `${tr(saf.nextHearing.date)} ${saf.nextHearing.time} (${saf.nextHearing.days} gün sonra)` : 'yok'}`,
    '',
    c.facts ? `Olay özeti: ${c.facts}` : '',
    '',
    deadlines.length ? 'Açık süreler:' : '',
    ...deadlines.map((d) => `- ${d.title}: ${tr(d.due_date)}`),
    '',
    petitions.length ? 'Dilekçeler:' : '',
    ...petitions.map((p) => `- ${p.title}${p.score !== null ? ` (inceleme puanı ${p.score}/100)` : ''}`),
    docText ? `\nDosyadaki belgeler: ${docText}.` : '',
    '',
    'Yapılacaklar:',
    ...strategy.slice(0, 8).map((s) => `- ${s.text}`),
  ];
  const report = lines
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return {
    case: { id: c.id, title: c.title, court: c.court, esas_no: c.esas_no, client: c.client, parties: c.parties, area, facts: c.facts, status: c.status },
    stage: saf.current,
    nextHearing: saf.nextHearing,
    risk: { score: analysis.risk, band: analysis.band, issues: analysis.issues.length },
    deadlines,
    tasks,
    documents: docs,
    petitions,
    notes: notes.map((n) => n.body),
    strategy,
    report,
    ai: false,
  };
}
