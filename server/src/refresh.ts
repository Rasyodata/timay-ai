import type { User } from './auth.ts';
import { assertCaseVisible, caseVisibility, getCase } from './cases.ts';
import { combinedRisk, getPlaybook, type Side } from './clm.ts';
import { getGroup } from './contractgroups.ts';
import type { DB } from './db.ts';
import { caseContext } from './ai.ts';
import type { AiModel } from './claude.ts';
import { DEEP_UNAVAILABLE, deepAgentFindings, reviewDocument } from './disciplines.ts';
import { account } from './enforcement.ts';
import { QUERY_KINDS } from './icra.ts';
import { ApiError } from './errors.ts';

/*
 * "Güncelle": bir dosyanın analizini (risk, eksik, uyarı) programın bugünkü kurallarıyla yeniden çalıştırır,
 * sonucu saklar ve bir önceki analizle karşılaştırır. Program güncellenince (ENGINE değişince) eski analizler
 * "güncel değil" görünür; avukat Güncelle'ye basınca yeni kurallarla yeniden hesaplanır.
 */

/** Analiz kurallarının sürümü. Kurallar değiştiğinde artırılır; eski analizler "güncel değil" olur. */
export const ENGINE = '2026.11.03-1';

export type Entity = 'case' | 'contract' | 'group' | 'icra';
export type Level = 'yuksek' | 'orta' | 'dusuk';
const ENTITIES: Entity[] = ['case', 'contract', 'group', 'icra'];

export interface Issue {
  key: string;
  level: Level;
  text: string;
  /** Bulguyu üstlenen ajan (avukat, savci, hakim, karsi, bilirkisi, sure, delil, mevzuat, ictihat). */
  agent?: string;
  /** Derin analizde yapay zekânın bulduğu. */
  ai?: boolean;
  basis?: string;
}

const AGENT_RULES: [string, RegExp][] = [
  ['savci', /suç|ceza(?!i şart)|tck|şikâyet süresi/],
  ['ictihat', /yargıtay|içtihat|emsal|karar arşiv/],
  ['karsi', /^aleyhte|aleyhte|karşı taraf|itiraz|tek taraflı|cayma/],
  ['sure', /süre|zamanaşım|gecik|vade|bitiş|duruşma|tebli|hareketsiz|tarih|arabulucu|yenileme|fesih bildirimi/],
  ['bilirkisi', /tutar|faiz|hesap|bedel|ödeme|harç|masraf|alacak|tl\b|kur farkı|cezai şart/],
  ['delil', /delil|belge|sorgu|tutanak|ispat|(?<![a-zçğıöşü])ek[- ]?\d|imza|fotoğraf/],
  ['mevzuat', /kanun|madde|mevzuat|tbk|hmk|iik|tmk|ttk/],
  ['hakim', /mahkeme|usul|yetki|görev|esas numarası|kimlik|adres|vekâlet|vekil|taraflar|şekil/],
];
/** Her bulgunun hangi ajanın işi olduğu (anahtar kelimelerle). */
export function agentOf(issue: Pick<Issue, 'key' | 'text'>) {
  const t = `${issue.key} ${issue.text}`.toLocaleLowerCase('tr');
  return AGENT_RULES.find(([, p]) => p.test(t))?.[0] ?? 'avukat';
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

export function analyzeCase(db: DB, user: User, id: number): Analysis {
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

  // Her dilekçenin son sürümü 10 ajanla yeniden incelenir.
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

// ---------------------------------------------------------------- icra dosyası

function analyzeIcra(db: DB, user: User, id: number, now = today()): Analysis {
  const f = db.prepare('SELECT * FROM enforcement_files WHERE id = ? AND office_id = ?').get(id, user.office_id) as Record<string, string | number | null> | undefined;
  if (!f) throw new ApiError(404, 'İcra dosyası bulunamadı.');
  const actions = db.prepare('SELECT id, date, action, amount_kurus, note FROM enforcement_actions WHERE file_id = ?').all(id) as { id: number; date: string; action: string; amount_kurus: number; note: string }[];
  const queries = db.prepare('SELECT kind, date, found FROM enforcement_queries WHERE file_id = ? ORDER BY date DESC').all(id) as { kind: string; date: string; found: number }[];
  const issues: Issue[] = [];
  const add = (key: string, level: Level, text: string, agent: string, basis?: string) => issues.push({ key, level, text, agent, basis });
  const days = (d: string) => Math.floor((Date.parse(now) - Date.parse(d)) / 86_400_000);
  const closed = f.status === 'tahsil' || f.status === 'kapandi';
  const kind = String(f.kind);
  if (!String(f.debtor_id_no ?? '').trim()) add('borclu-tc', 'orta', 'Borçlunun T.C. kimlik / vergi numarası girilmemiş; sorgular ve haciz yapılamaz.', 'hakim', 'İİK m.58');
  if (!String(f.debtor_address ?? '').trim()) add('borclu-adres', 'orta', 'Borçlu adresi yok; ödeme emri tebliğ edilemez.', 'hakim', 'Tebligat K. m.21');
  if (!String(f.file_no ?? '').trim()) add('dosya-no', 'dusuk', 'İcra dosya (esas) numarası girilmemiş.', 'hakim');
  if (!Number(f.principal_kurus)) add('asil', 'yuksek', 'Asıl alacak tutarı girilmemiş; hesap yapılamaz.', 'bilirkisi');
  if (f.interest_type !== 'yasal' && !Number(f.interest_rate)) add('faiz', 'orta', 'Faiz oranı 0; faiz istenmiyorsa bilinçli bir tercih olmalı.', 'bilirkisi', '3095 s. K.');
  if (kind === 'ilamli' && !f.case_id) add('ilam', 'orta', 'İlamlı takip ama dava dosyasına bağlanmamış; ilam ve kesinleşme şerhi kontrol edilemiyor.', 'ictihat');
  if (kind === 'kambiyo' && f.status === 'derdest') add('kambiyo-sure', 'orta', 'Kambiyo takibinde borçlunun itiraz/şikâyet süresi 5 gündür; tebliğ tarihini takip edin.', 'sure', 'İİK m.168');
  if (f.status === 'itiraz') add('itiraz', 'yuksek', 'Borçlu itiraz etmiş: itirazın kaldırılması 6 ay, itirazın iptali davası 1 yıl içinde açılmalı.', 'karsi', 'İİK m.67, m.68');
  const hacizler = actions.filter((a) => /haciz/.test(a.action));
  if (!closed && f.start_date && days(String(f.start_date)) > 365 && !hacizler.length)
    add('haciz-sure', 'yuksek', 'Takip 1 yıldan eski ve hiç haciz istenmemiş; haciz isteme süresi dolmuş olabilir.', 'sure', 'İİK m.78, m.79');
  const lastMove = [...actions.map((a) => a.date), ...queries.map((q) => q.date)].sort().pop();
  if (!closed && lastMove && days(lastMove) > 180) add('hareketsiz', 'orta', `Dosya ${days(lastMove)} gündür hareketsiz; 1 yıl işlem yapılmazsa dosya işlemden kaldırılır.`, 'sure', 'İİK m.78/4');
  if (!closed) {
    for (const k of QUERY_KINDS.slice(0, 6)) {
      const last = queries.find((q) => q.kind === k.key);
      if (!last) add(`sorgu-${k.key}`, 'dusuk', `${k.label} sorgusu hiç yapılmamış.`, 'delil');
      else if (days(last.date) > 90) add(`sorgu-${k.key}`, 'dusuk', `${k.label} sorgusu ${days(last.date)} gün önce yapılmış; yenileyin.`, 'delil');
      else if (last.found && k.action && !actions.some((a) => a.action === k.action)) add(`oneri-${k.key}`, 'orta', `${k.label} sorgusunda kayıt bulundu ama işlem yapılmamış: ${k.hint}`, 'avukat');
    }
  }
  const remaining = Number((account(f as never, actions, now) as { remaining: { toplam: number } }).remaining.toplam ?? 0);
  if (closed && remaining > 0) add('kalan', 'orta', 'Dosya kapalı görünüyor ama hesapta kalan borç var.', 'bilirkisi');
  sortIssues(issues);
  const risk = Math.min(100, issues.reduce((s, i) => s + (i.level === 'yuksek' ? 25 : i.level === 'orta' ? 12 : 3), 0));
  return { title: `${f.debtor} (${f.file_no || 'icra'})`, risk, band: bandOf(risk), issues, facts: { islem: actions.length, sorgu: queries.length } };
}

// ---------------------------------------------------------------- kayıt ve karşılaştırma

function analyze(db: DB, user: User, entity: Entity, id: number): Analysis {
  if (entity === 'case') {
    assertCaseVisible(db, user, id);
    return analyzeCase(db, user, id);
  }
  if (entity === 'contract') return analyzeContract(db, user, id);
  if (entity === 'group') return analyzeGroup(db, user, id);
  if (entity === 'icra') return analyzeIcra(db, user, id);
  throw new ApiError(400, 'Bilinmeyen dosya türü.');
}

function parseEntity(raw: string): Entity {
  if ((ENTITIES as string[]).includes(raw)) return raw as Entity;
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
  // Yapay zekâ bulguları (derin analiz) karşılaştırmaya girmez; kurallar aynı kaldıkça fark çıkmaz.
  before = before && { ...before, issues: before.issues.filter((i) => !i.ai) };
  after = { ...after, issues: after.issues.filter((i) => !i.ai) };
  const old = new Set((before?.issues ?? []).map((i) => i.key));
  const now = new Set(after.issues.map((i) => i.key));
  // İlk analizde "yeni çıkan" yoktur; hepsi güncel listede görünür.
  return {
    riskDelta: before ? after.risk - before.risk : 0,
    added: before ? after.issues.filter((i) => !old.has(i.key)) : [],
    resolved: (before?.issues ?? []).filter((i) => !now.has(i.key)),
  };
}

function run(db: DB, user: User, entity: Entity, id: number, extra: Issue[] = []) {
  const previous = lastRun(db, user, entity, id);
  const current = analyze(db, user, entity, id);
  for (const i of current.issues) i.agent ??= agentOf(i);
  if (extra.length) {
    current.issues.push(...extra);
    sortIssues(current.issues);
  }
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

/**
 * Güncelle, analiz türüyle: standart yalnız kurallar; derin, yapay zekâ bağlıysa dokuz ajanın gözüyle de okur.
 * Yapay zekâ yoksa ya da hata verirse standart analiz yapılır ve note nedenini söyler.
 */
export async function refreshWithAnalysis(db: DB, user: User, rawEntity: string, id: number, input: { analysis?: string } = {}, model: AiModel | null = null) {
  const entity = parseEntity(rawEntity);
  const started = Date.now();
  const done = (r: ReturnType<typeof run>, extra: { analysis: 'standart' | 'derin'; note?: string }) => ({ ...r, ...extra, elapsedMs: Date.now() - started });
  if (input.analysis !== 'derin') return done(run(db, user, entity, id), { analysis: 'standart' });
  if (!model) return done(run(db, user, entity, id), { analysis: 'standart', note: DEEP_UNAVAILABLE });
  const base = analyze(db, user, entity, id);
  const subjects: Record<Entity, string> = {
    case: 'İncelenen: bir DAVA DOSYASI (bizim müvekkilimizin dosyası). Her ajan dosyadaki riskleri, eksikleri, süreleri ve stratejiyi değerlendirsin.',
    contract: 'İncelenen: bir SÖZLEŞME. Her ajan müvekkilimiz açısından riskleri, aleyhe maddeleri, eksik korumaları, süreleri ve hesapları değerlendirsin.',
    group: 'İncelenen: birden çok sözleşmeden oluşan bir SÖZLEŞME DOSYASI. Her ajan toplu riskleri ve ortak sorunları değerlendirsin.',
    icra: 'İncelenen: bir İCRA TAKİP DOSYASI (alacaklı vekiliyiz). Her ajan tahsil kabiliyetini, süreleri, usul eksiklerini ve sonraki adımları değerlendirsin.',
  };
  let content = '';
  if (entity === 'case') content = caseContext(db, user, id);
  else if (entity === 'contract') {
    const c = db.prepare('SELECT title, kind, side, parties, body FROM contracts WHERE id = ? AND office_id = ?').get(id, user.office_id) as { title: string; kind: string; side: string; parties: string; body: string };
    content = `<sozlesme baslik="${c.title}" tur="${c.kind}" bizim_taraf="${c.side}" taraflar="${c.parties}">\n${c.body.slice(0, 100000)}\n</sozlesme>`;
  } else if (entity === 'icra') {
    const f = db.prepare('SELECT * FROM enforcement_files WHERE id = ? AND office_id = ?').get(id, user.office_id);
    const actions = db.prepare('SELECT date, action, amount_kurus, note FROM enforcement_actions WHERE file_id = ? ORDER BY date').all(id);
    content = `<icra_dosyasi>\n${JSON.stringify(f)}\nİşlemler: ${JSON.stringify(actions)}\n</icra_dosyasi>`;
  } else content = `<sozlesme_dosyasi baslik="${base.title}">\n${base.issues.map((i) => i.text).join('\n')}\n</sozlesme_dosyasi>`;
  try {
    const deep = await deepAgentFindings(model, { subject: subjects[entity], content, known: base.issues.map((i) => i.text).join('\n') });
    const lvl = { kritik: 'yuksek', uyari: 'orta', iyi: 'dusuk' } as const;
    const extra: Issue[] = deep.findings
      .filter((f) => f.level !== 'iyi')
      .map((f, i) => ({ key: `yz-${f.agent}-${i}`, level: lvl[f.level], text: f.text, agent: f.agent, ai: true, basis: f.basis }));
    return done(run(db, user, entity, id, extra), { analysis: 'derin' });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return done(run(db, user, entity, id), { analysis: 'standart', note: `Derin analiz şu an yapılamadı (${msg}). Standart analiz sonucu gösteriliyor.` });
  }
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
  if (want('icra')) {
    for (const r of db.prepare('SELECT id FROM enforcement_files WHERE office_id = ?').all(user.office_id) as { id: number }[]) targets.push({ entity: 'icra', id: r.id });
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
