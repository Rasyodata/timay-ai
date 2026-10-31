import type { User } from './auth.ts';
import { assertCaseVisible, caseVisibility, getCase } from './cases.ts';
import { combinedRisk, getPlaybook, type Side } from './clm.ts';
import { getGroup } from './contractgroups.ts';
import type { DB } from './db.ts';
import { reviewDocument } from './disciplines.ts';
import { ApiError } from './errors.ts';

/*
 * "Güncelle": bir dosyanın analizini (risk, eksik, uyarı) programın bugünkü kurallarıyla yeniden çalıştırır,
 * sonucu saklar ve bir önceki analizle karşılaştırır. Program güncellenince (ENGINE değişince) eski analizler
 * "güncel değil" görünür; avukat Güncelle'ye basınca yeni kurallarla yeniden hesaplanır.
 */

/** Analiz kurallarının sürümü. Kurallar değiştiğinde artırılır; eski analizler "güncel değil" olur. */
export const ENGINE = '2026.10.31-2';

export type Entity = 'case' | 'contract' | 'group';
export type Level = 'yuksek' | 'orta' | 'dusuk';

export interface Issue {
  key: string;
  level: Level;
  text: string;
}

export interface Analysis {
  title: string;
  /** 0–100, yüksek = riskli. */
  risk: number;
  band: Level;
  issues: Issue[];
  facts: Record<string, number | string>;
}

export interface RunRow {
  id: number;
  engine: string;
  risk: number;
  band: Level;
  data: Analysis;
  created_at: string;
  user_name: string;
}

const LEVEL_RANK: Record<Level, number> = { yuksek: 0, orta: 1, dusuk: 2 };
const bandOf = (risk: number): Level => (risk > 70 ? 'yuksek' : risk > 30 ? 'orta' : 'dusuk');
const today = () => new Date().toISOString().slice(0, 10);

function sortIssues(list: Issue[]) {
  return list.sort((a, b) => LEVEL_RANK[a.level] - LEVEL_RANK[b.level]);
}

// ---------------------------------------------------------------- dava dosyası

function analyzeCase(db: DB, user: User, id: number): Analysis {
  const c = getCase(db, user, id);
  const issues: Issue[] = [];
  const add = (key: string, level: Level, text: string) => issues.push({ key, level, text });

  if (!c.court.trim()) add('mahkeme', 'orta', 'Mahkeme bilgisi girilmemiş.');
  if (!c.esas_no.trim()) add('esas', 'dusuk', 'Esas numarası girilmemiş.');
  if (!c.client.trim()) add('muvekkil', 'orta', 'Müvekkil adı girilmemiş.');
  if (!c.parties.trim()) add('taraflar', 'dusuk', 'Taraflar yazılmamış.');
  if (c.facts.trim().length < 40) add('olay', 'orta', 'Olay özeti yok ya da çok kısa; dilekçe denetimi eksik kalır.');

  const poa = db.prepare('SELECT p.status, p.expiry_date FROM poa_cases x JOIN powers_of_attorney p ON p.id = x.poa_id WHERE x.case_id = ?').all(id) as {
    status: string;
    expiry_date: string;
  }[];
  const validPoa = poa.filter((p) => p.status === 'gecerli' && (!p.expiry_date || p.expiry_date >= today()));
  if (c.status === 'acik' && poa.length === 0) add('vekalet', 'yuksek', 'Dosyaya bağlı vekâletname yok.');
  else if (c.status === 'acik' && validPoa.length === 0) add('vekalet-gecersiz', 'yuksek', 'Dosyadaki vekâletnamenin süresi dolmuş ya da azledilmiş.');

  const late = db.prepare("SELECT title, due_date FROM legal_deadlines WHERE case_id = ? AND done = 0 AND due_date < ?").all(id, today()) as {
    title: string;
    due_date: string;
  }[];
  for (const d of late) add(`sure-${d.title}`, 'yuksek', `Süresi geçmiş iş: ${d.title} (${d.due_date.split('-').reverse().join('.')}).`);
  const soon = db
    .prepare("SELECT title, due_date FROM legal_deadlines WHERE case_id = ? AND done = 0 AND due_date >= ? AND due_date <= date(?, '+7 day')")
    .all(id, today(), today()) as { title: string; due_date: string }[];
  for (const d of soon) add(`yakin-${d.title}`, 'orta', `Süre doluyor: ${d.title} (${d.due_date.split('-').reverse().join('.')}).`);

  const nextHearing = c.hearings.find((h) => (h as { date: string }).date >= today());
  const openDeadlines = (db.prepare('SELECT COUNT(*) AS n FROM legal_deadlines WHERE case_id = ? AND done = 0').get(id) as { n: number }).n;
  if (c.status === 'acik' && !nextHearing && openDeadlines === 0) add('takip', 'orta', 'İleri tarihli duruşma ya da süre yok; dosya takipsiz kalabilir.');

  const docs = (db.prepare('SELECT COUNT(*) AS n FROM case_documents WHERE case_id = ?').get(id) as { n: number }).n;
  if (docs === 0) add('belge', 'dusuk', 'Dosyaya hiç belge (delil, tebligat) yüklenmemiş.');

  // Her dilekçenin son sürümü 8 disiplinle yeniden incelenir.
  const petitions = db
    .prepare(
      `SELECT p.id, p.title, p.status, (SELECT body FROM petition_versions v WHERE v.petition_id = p.id ORDER BY version DESC LIMIT 1) AS body
       FROM petitions p WHERE p.case_id = ? ORDER BY p.id`,
    )
    .all(id) as { id: number; title: string; status: string; body: string | null }[];
  const caseInfo = { area: c.area, client: c.client, facts: c.facts, court: c.court, esas_no: c.esas_no, documents: docs };
  const scores: number[] = [];
  for (const p of petitions) {
    if (!p.body?.trim()) continue;
    const r = reviewDocument({ db, body: p.body, title: p.title, caseInfo });
    scores.push(r.summary.score);
    if (r.summary.verdict !== 'hazir') {
      add(
        `dilekce-${p.id}`,
        r.summary.verdict === 'ciddi' ? 'yuksek' : 'orta',
        `“${p.title}” ${r.summary.score}/100: ${r.summary.critical} kritik, ${r.summary.warnings} uyarı${r.summary.priorities[0] ? ` · önce: ${r.summary.priorities[0].text}` : ''}`,
      );
    }
  }

  sortIssues(issues);
  const raw = issues.reduce((s, i) => s + (i.level === 'yuksek' ? 22 : i.level === 'orta' ? 10 : 4), 0);
  const fromIssues = Math.round(100 * (1 - Math.exp(-raw / 80)));
  const petitionRisk = scores.length ? 100 - Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null;
  const risk = petitionRisk === null ? fromIssues : Math.round(fromIssues * 0.6 + petitionRisk * 0.4);
  return {
    title: c.title,
    risk,
    band: bandOf(risk),
    issues,
    facts: {
      dilekce: petitions.length,
      dilekce_puani: scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : '',
      belge: docs,
      acik_sure: openDeadlines,
      gecikmis_sure: late.length,
    },
  };
}

// ---------------------------------------------------------------- sözleşme

function analyzeContract(db: DB, user: User, id: number): Analysis {
  const c = db.prepare('SELECT id, title, kind, side, body, status, end_date FROM contracts WHERE id = ? AND office_id = ?').get(id, user.office_id) as
    | { id: number; title: string; kind: string; side: string; body: string; status: string; end_date: string }
    | undefined;
  if (!c) throw new ApiError(404, 'Sözleşme bulunamadı.');
  const issues: Issue[] = [];
  const add = (key: string, level: Level, text: string) => issues.push({ key, level, text });
  let risk = 0;
  let against = 0;
  let missing = 0;
  if (c.body.trim()) {
    const { result, risk: r } = combinedRisk(c.body, c.kind, (c.side || 'genel') as Side, getPlaybook(db, user));
    risk = r.genel;
    for (const f of result.findings) {
      if (f.verdict === 'lehte') continue;
      if (f.verdict === 'aleyhte') against++;
      if (f.verdict === 'eksik') missing++;
      const tag = f.verdict === 'aleyhte' ? 'Aleyhte' : f.verdict === 'eksik' ? 'Eksik' : 'Mevzuat';
      add(`${f.verdict}-${f.key}`, f.severity, `${tag}: ${f.title}`);
    }
  } else {
    add('metin', 'orta', 'Sözleşme metni yok; risk hesaplanamadı.');
  }
  const late = db
    .prepare("SELECT text, due_date FROM contract_obligations WHERE contract_id = ? AND done = 0 AND due_date != '' AND due_date < ?")
    .all(id, today()) as { text: string; due_date: string }[];
  for (const o of late) add(`taahhut-${o.text}`, 'yuksek', `Gecikmiş taahhüt: ${o.text} (${o.due_date.split('-').reverse().join('.')}).`);
  if (c.status === 'yururlukte' && c.end_date && c.end_date < today()) add('bitis', 'yuksek', 'Bitiş tarihi geçmiş ama sözleşme yürürlükte görünüyor.');
  if (late.length) risk = Math.min(100, risk + late.length * 5);
  sortIssues(issues);
  return {
    title: c.title,
    risk,
    band: bandOf(risk),
    issues,
    facts: { aleyhte: against, eksik: missing, gecikmis_taahhut: late.length },
  };
}

// ---------------------------------------------------------------- sözleşme dosyası

function analyzeGroup(db: DB, user: User, id: number): Analysis {
  const g = getGroup(db, user, id);
  const s = g.summary;
  const issues: Issue[] = [];
  for (const c of g.contracts) {
    if (c.risk && c.risk.band === 'yuksek') issues.push({ key: `riskli-${c.id}`, level: 'yuksek', text: `Yüksek riskli: ${c.title} (${c.risk.genel}/100)` });
    if (c.late_obligations) issues.push({ key: `gecikme-${c.id}`, level: 'yuksek', text: `${c.title}: ${c.late_obligations} gecikmiş taahhüt` });
  }
  for (const i of g.common.slice(0, 8)) {
    if (i.contracts.length < 2) continue;
    issues.push({ key: `ortak-${i.key}`, level: i.severity as Level, text: `${i.contracts.length} sözleşmede ortak sorun: ${i.title}` });
  }
  sortIssues(issues);
  return {
    title: g.title,
    risk: s.toplu,
    band: bandOf(s.toplu),
    issues,
    facts: { sozlesme: s.count, incelenen: s.reviewed, ortalama: s.average, en_yuksek: s.max },
  };
}

// ---------------------------------------------------------------- kayıt ve karşılaştırma

function analyze(db: DB, user: User, entity: Entity, id: number): Analysis {
  if (entity === 'case') {
    assertCaseVisible(db, user, id);
    return analyzeCase(db, user, id);
  }
  if (entity === 'contract') return analyzeContract(db, user, id);
  if (entity === 'group') return analyzeGroup(db, user, id);
  throw new ApiError(400, 'Bilinmeyen dosya türü.');
}

function parseEntity(raw: string): Entity {
  if (raw === 'case' || raw === 'contract' || raw === 'group') return raw;
  throw new ApiError(400, 'Bilinmeyen dosya türü.');
}

function lastRun(db: DB, user: User, entity: Entity, id: number): RunRow | null {
  const row = db
    .prepare(
      `SELECT r.id, r.engine, r.risk, r.band, r.data, r.created_at, COALESCE(u.name, '') AS user_name
       FROM analysis_runs r LEFT JOIN users u ON u.id = r.created_by
       WHERE r.office_id = ? AND r.entity = ? AND r.entity_id = ? ORDER BY r.id DESC LIMIT 1`,
    )
    .get(user.office_id, entity, id) as (Omit<RunRow, 'data'> & { data: string }) | undefined;
  return row ? { ...row, data: JSON.parse(row.data) as Analysis } : null;
}

export function compare(before: Analysis | null, after: Analysis) {
  const old = new Set((before?.issues ?? []).map((i) => i.key));
  const now = new Set(after.issues.map((i) => i.key));
  // İlk analizde "yeni çıkan" yoktur; hepsi güncel listede görünür.
  return {
    riskDelta: before ? after.risk - before.risk : 0,
    added: before ? after.issues.filter((i) => !old.has(i.key)) : [],
    resolved: (before?.issues ?? []).filter((i) => !now.has(i.key)),
  };
}

function run(db: DB, user: User, entity: Entity, id: number) {
  const previous = lastRun(db, user, entity, id);
  const current = analyze(db, user, entity, id);
  const info = db
    .prepare('INSERT INTO analysis_runs (office_id, entity, entity_id, engine, risk, band, data, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(user.office_id, entity, id, ENGINE, current.risk, current.band, JSON.stringify(current), user.id);
  // Her dosya için son 20 analiz saklanır.
  db.prepare(
    `DELETE FROM analysis_runs WHERE office_id = ? AND entity = ? AND entity_id = ? AND id NOT IN
     (SELECT id FROM analysis_runs WHERE office_id = ? AND entity = ? AND entity_id = ? ORDER BY id DESC LIMIT 20)`,
  ).run(user.office_id, entity, id, user.office_id, entity, id);
  return {
    engine: ENGINE,
    run_id: Number(info.lastInsertRowid),
    at: new Date().toISOString().replace('T', ' ').slice(0, 19),
    current,
    previous: previous && { engine: previous.engine, at: previous.created_at, risk: previous.risk, band: previous.band },
    changes: compare(previous?.data ?? null, current),
  };
}

/** Güncelle düğmesi: analizi yeniden çalıştırır, saklar, önceki analizle farkı döndürür. */
export function refresh(db: DB, user: User, rawEntity: string, id: number) {
  return run(db, user, parseEntity(rawEntity), id);
}

/** Son analiz ve program güncellendiği için eskiyip eskimediği. */
export function status(db: DB, user: User, rawEntity: string, id: number) {
  const entity = parseEntity(rawEntity);
  const last = lastRun(db, user, entity, id);
  return {
    engine: ENGINE,
    last: last && { engine: last.engine, at: last.created_at, risk: last.risk, band: last.band, user_name: last.user_name, issues: last.data.issues.length },
    stale: !last || last.engine !== ENGINE,
  };
}

/** Tümünü güncelle: kullanıcının görebildiği bütün dava, sözleşme ve sözleşme dosyalarını yeniden analiz eder. */
export function refreshAll(db: DB, user: User, input: { entity?: string; entities?: string[] } = {}) {
  const list = input.entities?.length ? input.entities.map(parseEntity) : input.entity ? [parseEntity(input.entity)] : null;
  const want = (e: Entity) => !list || list.includes(e);
  const targets: { entity: Entity; id: number }[] = [];
  if (want('case')) {
    const v = caseVisibility(user);
    for (const r of db.prepare(`SELECT c.id FROM cases c WHERE c.office_id = ?${v.sql}`).all(user.office_id, ...v.params) as { id: number }[])
      targets.push({ entity: 'case', id: r.id });
  }
  if (want('contract')) {
    for (const r of db.prepare('SELECT id FROM contracts WHERE office_id = ?').all(user.office_id) as { id: number }[]) targets.push({ entity: 'contract', id: r.id });
  }
  if (want('group')) {
    for (const r of db.prepare('SELECT id FROM contract_groups WHERE office_id = ?').all(user.office_id) as { id: number }[]) targets.push({ entity: 'group', id: r.id });
  }
  const changed: { entity: Entity; id: number; title: string; before: number | null; after: number; added: number; resolved: number }[] = [];
  let added = 0;
  let resolved = 0;
  db.transaction(() => {
    for (const t of targets) {
      const r = run(db, user, t.entity, t.id);
      added += r.changes.added.length;
      resolved += r.changes.resolved.length;
      if (!r.previous || r.changes.riskDelta || r.changes.added.length || r.changes.resolved.length)
        changed.push({
          entity: t.entity,
          id: t.id,
          title: r.current.title,
          before: r.previous?.risk ?? null,
          after: r.current.risk,
          added: r.changes.added.length,
          resolved: r.changes.resolved.length,
        });
    }
  })();
  changed.sort((a, b) => b.after - a.after);
  return { engine: ENGINE, count: targets.length, added, resolved, changed };
}
