import type { User } from './auth.ts';
import { getCase } from './cases.ts';
import type { DB } from './db.ts';
import { calculate, createDeadline } from './deadlines.ts';
import { ApiError } from './errors.ts';
import { DATE } from './money.ts';
import { createTask } from './tasks.ts';

/*
 * Safahat: davanın aşamaları (açılış, tensip, ön inceleme, tahkikat, karar, kanun yolu) zaman çizelgesinde.
 * Her yeni aşamada o aşamanın yasal süresi kendiliğinden hesaplanır (adli tatil ve bayramlar dahil)
 * ve "sıradaki adım" önerileri görev olarak tek tıkla açılır.
 */

type Track = 'hukuk' | 'ceza' | 'idare';

interface Step {
  title: string;
  /** Aşama tarihinden kaç gün sonra yapılmalı (görevin son tarihi). */
  days: number;
}

interface StageDef {
  id: string;
  title: string;
  hint: string;
  /** Zaman çizelgesinde ana aşama mı (yan aşamalar yalnız kayıtta görünür). */
  main: boolean;
  /** Bu aşamayla başlayan yasal süre (yargı koluna göre). */
  rule?: Partial<Record<Track, string>>;
  steps: Step[];
}

export const STAGES: StageDef[] = [
  {
    id: 'acilis',
    title: 'Dava açıldı',
    hint: 'Dava dilekçesi mahkemeye verildi.',
    main: true,
    steps: [
      { title: 'Esas numarasını ve mahkemeyi dosyaya girin', days: 1 },
      { title: 'Gider avansı ve harçların yatırıldığını kontrol edin', days: 2 },
      { title: 'Müvekkile davanın açıldığını bildirin', days: 2 },
    ],
  },
  {
    id: 'teblig_dava',
    title: 'Dava dilekçesi tebliğ edildi',
    hint: 'Davalı tarafsak cevap süresi başlar.',
    main: false,
    rule: { hukuk: 'hmk-cevap' },
    steps: [
      { title: 'Cevap dilekçesi taslağını hazırlayın (8 disiplinle inceletin)', days: 5 },
      { title: 'Müvekkilden delil ve belgeleri isteyin', days: 3 },
      { title: 'Gerekirse cevap süresinin uzatılmasını talep edin (HMK 127)', days: 7 },
    ],
  },
  {
    id: 'cevap',
    title: 'Cevap / cevaba cevap',
    hint: 'Dilekçeler aşaması.',
    main: false,
    rule: { hukuk: 'hmk-ikinci-cevap' },
    steps: [
      { title: 'Karşı tarafın cevabını inceleyin; cevaba cevap dilekçesi hazırlayın', days: 7 },
      { title: 'Karşı taraf delillerine karşı beyan hazırlayın', days: 10 },
    ],
  },
  {
    id: 'tensip',
    title: 'Tensip',
    hint: 'Mahkeme ilk ara kararlarını verdi.',
    main: true,
    rule: { hukuk: 'hmk-kesin-sure' },
    steps: [
      { title: 'Tensip zaptındaki kesin süreleri ayrı ayrı süre olarak girin', days: 1 },
      { title: 'Delil ve tanık avansını yatırın', days: 7 },
      { title: 'Delil listesini ve tanık isimlerini bildirin', days: 10 },
    ],
  },
  {
    id: 'on_inceleme',
    title: 'Ön inceleme',
    hint: 'Uyuşmazlık noktaları belirlendi, sulh ve arabuluculuk soruldu.',
    main: true,
    steps: [
      { title: 'Ön inceleme duruşması için uyuşmazlık noktalarını özetleyin', days: 0 },
      { title: 'Sulh ya da arabuluculuk seçeneğini müvekkille değerlendirin', days: 3 },
      { title: 'Ön inceleme tutanağını dosyaya ekleyin', days: 2 },
    ],
  },
  {
    id: 'tahkikat',
    title: 'Tahkikat / duruşma',
    hint: 'Deliller toplanıyor, tanıklar dinleniyor.',
    main: true,
    steps: [
      { title: 'Duruşma tarihini ajandaya girin ve tanıkları bilgilendirin', days: 1 },
      { title: 'Duruşma tutanağına karşı beyan dilekçesi hazırlayın', days: 7 },
    ],
  },
  {
    id: 'bilirkisi',
    title: 'Bilirkişi raporu',
    hint: 'Rapor tebliğ edildi.',
    main: false,
    rule: { hukuk: 'hmk-bilirkisi' },
    steps: [
      { title: 'Bilirkişi raporunu hesaplarla birlikte kontrol edin', days: 3 },
      { title: 'Rapora itiraz / beyan dilekçesi hazırlayın', days: 10 },
    ],
  },
  {
    id: 'sozlu',
    title: 'Sözlü yargılama',
    hint: 'Son sözler ve esas hakkında beyan.',
    main: false,
    steps: [{ title: 'Esas hakkında beyan dilekçesi hazırlayın', days: 7 }],
  },
  {
    id: 'karar',
    title: 'Karar',
    hint: 'Kısa karar açıklandı.',
    main: true,
    rule: { ceza: 'cmk-istinaf' },
    steps: [
      { title: 'Kararı müvekkile bildirin ve kanun yolunu değerlendirin', days: 1 },
      { title: 'Yargılama giderleri ve vekâlet ücretini kontrol edin', days: 3 },
      { title: 'Gerekçeli kararın tebliğini takip edin', days: 15 },
    ],
  },
  {
    id: 'teblig_karar',
    title: 'Gerekçeli karar tebliğ edildi',
    hint: 'Kanun yolu süresi başlar.',
    main: false,
    rule: { hukuk: 'hmk-istinaf', idare: 'iyuk-istinaf', ceza: 'cmk-istinaf' },
    steps: [
      { title: 'İstinaf dilekçesini hazırlayın (8 disiplinle inceletin)', days: 7 },
      { title: 'İstinaf harç ve giderlerini yatırın', days: 10 },
    ],
  },
  {
    id: 'istinaf',
    title: 'İstinaf',
    hint: 'Bölge adliye mahkemesinde.',
    main: true,
    steps: [{ title: 'Karşı tarafın istinafına cevap verin (2 hafta)', days: 10 }],
  },
  {
    id: 'teblig_istinaf',
    title: 'İstinaf kararı tebliğ edildi',
    hint: 'Temyiz süresi başlar.',
    main: false,
    rule: { hukuk: 'hmk-temyiz', ceza: 'cmk-temyiz', idare: 'iyuk-istinaf' },
    steps: [
      { title: 'Temyiz edilebilirliği ve parasal sınırı kontrol edin', days: 3 },
      { title: 'Temyiz dilekçesini hazırlayın', days: 20 },
    ],
  },
  {
    id: 'temyiz',
    title: 'Temyiz',
    hint: 'Yargıtay / Danıştay incelemesinde.',
    main: true,
    steps: [{ title: 'Temyiz incelemesinin sonucunu takip edin', days: 60 }],
  },
  {
    id: 'kesinlesme',
    title: 'Kesinleşme',
    hint: 'Karar kesinleşti.',
    main: true,
    steps: [
      { title: 'Kesinleşme şerhini alın', days: 7 },
      { title: 'Gerekiyorsa ilamlı icra takibi başlatın', days: 15 },
      { title: 'Dosyayı kapatın, vekâlet ücretini tahsil edin', days: 30 },
    ],
  },
];

const STAGE = new Map(STAGES.map((s) => [s.id, s]));

function trackOf(area: string): Track {
  if (area === 'ceza') return 'ceza';
  if (area === 'idare' || area === 'vergi') return 'idare';
  return 'hukuk';
}

function addDays(date: string, days: number) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const today = () => new Date().toISOString().slice(0, 10);

/** Aşamanın önerileri: o aşamanın yasal süresi ve yapılacak işler, tarihleriyle. */
function suggestionsFor(stageId: string, date: string, area: string) {
  const def = STAGE.get(stageId);
  if (!def) return null;
  const ruleId = def.rule?.[trackOf(area)];
  const deadline = ruleId ? calculate({ ruleId, start: date }) : null;
  return {
    stage: def.id,
    deadline: deadline && { ruleId, title: deadline.rule.title, basis: deadline.rule.basis, date: deadline.date, notes: deadline.notes },
    steps: def.steps.map((s) => ({ title: s.title, due: addDays(date, s.days) })),
  };
}

export function stageCatalog() {
  return STAGES.map(({ id, title, hint, main }) => ({ id, title, hint, main }));
}

/** Davanın safahatı: aşama kayıtları, zaman çizelgesi, sıradaki duruşma ve güncel öneriler. */
export function getSafahat(db: DB, user: User, caseId: number) {
  const c = getCase(db, user, caseId);
  const entries = db
    .prepare(
      `SELECT s.id, s.stage, s.date, s.note, s.created_at, COALESCE(u.name, '') AS user_name
       FROM case_stages s LEFT JOIN users u ON u.id = s.created_by WHERE s.case_id = ? ORDER BY s.date, s.id`,
    )
    .all(caseId) as { id: number; stage: string; date: string; note: string; created_at: string; user_name: string }[];
  const last = entries.at(-1) ?? null;
  const reachedOrder = Math.max(-1, ...entries.map((e) => STAGES.findIndex((s) => s.id === e.stage)));
  const timeline = STAGES.filter((s) => s.main).map((s) => {
    const idx = STAGES.findIndex((x) => x.id === s.id);
    const entry = [...entries].reverse().find((e) => e.stage === s.id);
    return {
      id: s.id,
      title: s.title,
      state: entry && last?.stage === s.id ? 'current' : idx <= reachedOrder ? 'done' : 'todo',
      date: entry?.date ?? '',
    };
  });
  // Ana aşama olmayan son kayıt, en yakın ana aşamayı "şu an" yapar.
  if (last && !STAGE.get(last.stage)?.main) {
    const cur = [...timeline].reverse().find((t) => t.state === 'done');
    if (cur) cur.state = 'current';
  }
  const hearings = (c.hearings as { date: string; time: string; note?: string }[]).filter((h) => h.date >= today());
  const next = hearings[0];
  const nextHearing = next ? { date: next.date, time: next.time, days: Math.round((Date.parse(next.date) - Date.parse(today())) / 86_400_000) } : null;
  const idx = last ? STAGES.findIndex((s) => s.id === last.stage) : -1;
  return {
    caseId,
    area: c.area,
    track: trackOf(c.area),
    current: last ? { stage: last.stage, title: STAGE.get(last.stage)?.title ?? last.stage, date: last.date } : null,
    entries: entries.map((e) => ({ ...e, title: STAGE.get(e.stage)?.title ?? e.stage })).reverse(),
    timeline,
    nextHearing,
    suggestions: last ? suggestionsFor(last.stage, last.date, c.area) : suggestionsFor('acilis', today(), c.area),
    /** Sıradaki muhtemel aşama (formda önceden seçili gelir). */
    nextStage: STAGES[idx + 1]?.id ?? null,
    stages: stageCatalog(),
  };
}

/** Aşamayı seçince formda gösterilecek öneriler (henüz kaydetmeden). */
export function previewStage(db: DB, user: User, caseId: number, input: { stage?: string; date?: string }) {
  const c = getCase(db, user, caseId);
  const date = input.date && DATE.test(input.date) ? input.date : today();
  const s = suggestionsFor(String(input.stage ?? ''), date, c.area);
  if (!s) throw new ApiError(400, 'Aşama bulunamadı.');
  return s;
}

/**
 * Yeni safahat: aşamayı kaydeder; istenirse yasal süreyi ve seçilen işleri dosya sorumlusuna görev olarak açar.
 */
export function addStage(
  db: DB,
  user: User,
  caseId: number,
  input: { stage?: string; date?: string; note?: string; createDeadline?: boolean; steps?: string[] },
) {
  const c = getCase(db, user, caseId);
  const def = STAGE.get(String(input.stage ?? ''));
  if (!def) throw new ApiError(400, 'Aşama bulunamadı.');
  const date = input.date || today();
  if (!DATE.test(date)) throw new ApiError(400, 'Aşama tarihi YYYY-AA-GG biçiminde olmalı.');
  const s = suggestionsFor(def.id, date, c.area)!;
  const responsible = c.responsible_id ?? user.id;
  const created = { deadline: null as unknown, tasks: [] as unknown[] };
  db.transaction(() => {
    db.prepare('INSERT INTO case_stages (office_id, case_id, stage, date, note, created_by) VALUES (?, ?, ?, ?, ?, ?)').run(
      user.office_id,
      caseId,
      def.id,
      date,
      String(input.note ?? '').trim(),
      user.id,
    );
    db.prepare('UPDATE cases SET stage = ? WHERE id = ?').run(def.id, caseId);
    if (input.createDeadline !== false && s.deadline) {
      created.deadline = createDeadline(db, user, { ruleId: s.deadline.ruleId, start: date, caseId, responsibleId: responsible, note: `Safahat: ${def.title}` });
    }
    const wanted = new Set(input.steps ?? []);
    for (const step of s.steps) {
      if (!wanted.has(step.title)) continue;
      created.tasks.push(createTask(db, user, { title: step.title, caseId, assigneeId: responsible, dueDate: step.due }));
    }
  })();
  return { ...getSafahat(db, user, caseId), created };
}

export function deleteStage(db: DB, user: User, caseId: number, stageId: number) {
  getCase(db, user, caseId);
  const r = db.prepare('DELETE FROM case_stages WHERE id = ? AND case_id = ? AND office_id = ?').run(stageId, caseId, user.office_id);
  if (!r.changes) throw new ApiError(404, 'Safahat kaydı bulunamadı.');
  const last = db.prepare('SELECT stage FROM case_stages WHERE case_id = ? ORDER BY date DESC, id DESC LIMIT 1').get(caseId) as { stage: string } | undefined;
  db.prepare('UPDATE cases SET stage = ? WHERE id = ?').run(last?.stage ?? '', caseId);
  return getSafahat(db, user, caseId);
}
