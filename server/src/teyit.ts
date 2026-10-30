import { createHash } from 'node:crypto';
import { extractCitations } from './citations.ts';
import type { DB } from './db.ts';
import { ApiError } from './errors.ts';
import { findLawByNo, findLawByShort } from './laws.ts';

/**
 * Teyit: dilekçedeki her dayanağın (karar atfı, kanun maddesi, olay iddiası) kaynağa göre
 * denetlenmesi. Renkler:
 *   yesil   teyit edildi (kaynakta birebir karşılığı var)
 *   sari    kısmen / anlamı kontrol edilmedi, avukat bakmalı
 *   kirmizi teyit edilemedi (kaynak yok ya da çelişiyor)
 *   gri     sonuçsuz (sistemin denetleyemediği dayanak)
 */
export type TeyitStatus = 'yesil' | 'sari' | 'kirmizi' | 'gri';
export type TeyitKind = 'karar' | 'kanun' | 'olgu';

export interface TeyitItem {
  key: string;
  kind: TeyitKind;
  quote: string;
  status: TeyitStatus;
  note: string;
  source: { label: string; url?: string; quote?: string } | null;
  deep: boolean;
}

export interface TeyitReport {
  items: TeyitItem[];
  counts: Record<TeyitStatus, number>;
  deepCheckedAt: string | null;
}

export type TeyitTarget = { type: 'petition' | 'opposing'; id: number; version: number };

/** Derin teyitte Claude'dan dönen ham sonuç. */
export interface DeepItem {
  kind: TeyitKind;
  quote: string;
  status: TeyitStatus;
  explanation: string;
  source_quote: string;
}

export interface DeepInput {
  document: string;
  caseFacts: string;
  decisions: { esasNo: string; kararNo: string; court: string; text: string }[];
  references: { kind: TeyitKind; quote: string }[];
}

export type DeepChecker = (input: DeepInput) => Promise<{ items: DeepItem[]; model: string }>;

export function itemKey(kind: TeyitKind, quote: string) {
  return createHash('sha1').update(`${kind}|${normalize(quote)}`).digest('hex').slice(0, 12);
}

function normalize(s: string) {
  return s.toLocaleLowerCase('tr').replace(/\s+/g, ' ').trim();
}

export function needsAck(item: TeyitItem) {
  return item.status === 'sari' || item.status === 'gri';
}

interface LawRef {
  quote: string;
  lawNo?: string;
  short?: string;
  article: number;
}

const lawNoPatterns = [
  /(\d{4})\s+sayılı[^\n\d,;]{0,90}?(?:\bm\.|\bmd\.|\bmadde(?:si)?)\s*(\d+)/gu,
  /(\d{4})\s+sayılı[^\n\d,;]{0,90}?(\d+)\.\s*madde/gu,
];
const lawShortPatterns = [
  /(?<!\p{L})(İş K\.|TBK|HMK|İİK|TMK|TCK|CMK|TKHK|TTK|İYUK|HUAK|İK|BK|MK)(?:['’]\p{L}+)?\s*(?:m\.|md\.)\s*(\d+)/gu,
  /(?<!\p{L})(İş K\.|TBK|HMK|İİK|TMK|TCK|CMK|TKHK|TTK|İYUK|HUAK|İK|BK|MK)(?:['’]\p{L}+)?\s*(\d+)\.\s*madde/gu,
];

export function extractLawRefs(body: string): LawRef[] {
  const found = new Map<string, LawRef & { index: number }>();
  const add = (ref: LawRef, index: number) => {
    const id = `${ref.lawNo ?? findLawByShort(ref.short!)?.no ?? ref.short}|${ref.article}`;
    const seen = found.get(id);
    if (!seen || index < seen.index) found.set(id, { ...ref, index });
  };
  for (const p of lawNoPatterns) {
    for (const m of body.matchAll(p)) add({ quote: m[0], lawNo: m[1], article: Number(m[2]) }, m.index);
  }
  for (const p of lawShortPatterns) {
    for (const m of body.matchAll(p)) add({ quote: m[0], short: m[1], article: Number(m[2]) }, m.index);
  }
  return [...found.values()].sort((a, b) => a.index - b.index).map(({ index: _index, ...ref }) => ref);
}

/** Ücretsiz, anında yapılan kontrol: karar arşivi ve kanun listesi. */
export function fastItems(db: DB, body: string): TeyitItem[] {
  const items: TeyitItem[] = [];
  const lookup = db.prepare(
    'SELECT court, chamber, decision_date, source_url FROM decisions WHERE esas_no = ? AND karar_no = ?',
  );
  for (const c of extractCitations(body)) {
    const row = lookup.get(c.esasNo, c.kararNo) as
      | { court: string; chamber: string; decision_date: string; source_url: string }
      | undefined;
    items.push({
      key: itemKey('karar', c.raw),
      kind: 'karar',
      quote: c.raw,
      status: row ? 'sari' : 'kirmizi',
      note: row
        ? 'Karar arşivde bulundu; dilekçedeki anlamla örtüştüğü henüz kontrol edilmedi.'
        : 'Bu esas/karar numarası arşivde yok. Uydurma ya da yanlış yazılmış olabilir.',
      source: row
        ? {
            label: [row.court, row.chamber, row.decision_date].filter(Boolean).join(', '),
            url: row.source_url || undefined,
          }
        : null,
      deep: false,
    });
  }
  for (const ref of extractLawRefs(body)) {
    const law = ref.lawNo ? findLawByNo(ref.lawNo) : findLawByShort(ref.short!);
    let status: TeyitStatus;
    let note: string;
    if (!law) {
      status = 'gri';
      note = 'Bu kanun sistemin listesinde yok; madde elle kontrol edilmeli.';
    } else if (law.maxArticle && ref.article > law.maxArticle) {
      status = 'kirmizi';
      note = `${law.name} ${law.maxArticle} maddedir; ${ref.article}. madde yok.`;
    } else {
      status = 'sari';
      note = `${law.name} ${ref.article}. madde mevcut; içeriğin iddiayı desteklediği kontrol edilmedi.`;
    }
    items.push({
      key: itemKey('kanun', ref.quote),
      kind: 'kanun',
      quote: ref.quote,
      status,
      note,
      source: law ? { label: `${law.no} sayılı ${law.name}` } : null,
      deep: false,
    });
  }
  return items;
}

interface RunRow {
  items: string;
  created_at: string;
}

function latestRun(db: DB, target: TeyitTarget) {
  return db
    .prepare(
      'SELECT items, created_at FROM teyit_runs WHERE target = ? AND target_id = ? AND version = ? ORDER BY id DESC LIMIT 1',
    )
    .get(target.type, target.id, target.version) as RunRow | undefined;
}

function contains(a: string, b: string) {
  const na = normalize(a);
  const nb = normalize(b);
  return na.includes(nb) || nb.includes(na);
}

/** Hızlı kontrol ile (varsa) bu sürüm için yapılmış derin teyidi birleştirir. */
export function buildReport(db: DB, target: TeyitTarget, body: string): TeyitReport {
  const items = fastItems(db, body);
  const run = latestRun(db, target);
  if (run) {
    const deepItems = JSON.parse(run.items) as TeyitItem[];
    for (const item of items) {
      const match = deepItems.find((d) => d.kind === item.kind && contains(d.quote, item.quote));
      // Arşivde olmayan karar ya da var olmayan madde derin teyitle yeşile dönemez.
      if (!match || item.status === 'kirmizi') continue;
      item.status = match.status;
      item.note = match.note;
      item.deep = true;
      if (match.source?.quote) item.source = { ...(item.source ?? { label: '' }), quote: match.source.quote };
    }
    for (const d of deepItems) {
      if (d.kind === 'olgu' && normalize(body).includes(normalize(d.quote))) items.push(d);
    }
  }
  const counts: Record<TeyitStatus, number> = { yesil: 0, sari: 0, kirmizi: 0, gri: 0 };
  for (const item of items) counts[item.status]++;
  return { items, counts, deepCheckedAt: run?.created_at ?? null };
}

/**
 * Claude'un verdiği yeşili sunucu tarafında doğrular: kaynak alıntısı karar metninde ya da
 * dava olaylarında birebir geçmiyorsa sonuç sarıya düşer. Kanun maddelerinin metni arşivde
 * olmadığından en fazla sarı olabilir.
 */
export function verifyDeepItems(input: DeepInput, raw: DeepItem[]): TeyitItem[] {
  return raw
    .filter((d) => d.quote?.trim() && normalize(input.document).includes(normalize(d.quote)))
    .map((d) => {
      let status = d.status;
      let sourceText = '';
      if (d.kind === 'karar') {
        const decision = input.decisions.find((x) => d.quote.includes(x.esasNo) && d.quote.includes(x.kararNo));
        sourceText = decision?.text ?? '';
      } else if (d.kind === 'olgu') {
        sourceText = input.caseFacts;
      }
      const quoteFound = !!d.source_quote?.trim() && normalize(sourceText).includes(normalize(d.source_quote));
      if (status === 'yesil' && (d.kind === 'kanun' || !quoteFound)) status = 'sari';
      return {
        key: itemKey(d.kind, d.quote),
        kind: d.kind,
        quote: d.quote,
        status,
        note: d.explanation,
        source: quoteFound
          ? { label: d.kind === 'olgu' ? 'Dava dosyası olayları' : 'Karar metni', quote: d.source_quote }
          : null,
        deep: true,
      };
    });
}

export async function runDeepCheck(
  db: DB,
  checker: DeepChecker | null,
  target: TeyitTarget,
  body: string,
  caseFacts: string,
  userId: number,
) {
  if (!checker) {
    throw new ApiError(503, 'Derin teyit kapalı: sunucuya Claude API anahtarı (ANTHROPIC_API_KEY) eklenmemiş.');
  }
  if (!body.trim()) throw new ApiError(400, 'Metin boş.');
  const fast = fastItems(db, body);
  const lookup = db.prepare(
    'SELECT court, chamber, text FROM decisions WHERE esas_no = ? AND karar_no = ?',
  );
  const decisions = extractCitations(body).flatMap((c) => {
    const row = lookup.get(c.esasNo, c.kararNo) as { court: string; chamber: string; text: string } | undefined;
    return row ? [{ esasNo: c.esasNo, kararNo: c.kararNo, court: [row.court, row.chamber].filter(Boolean).join(' '), text: row.text }] : [];
  });
  const input: DeepInput = {
    document: body,
    caseFacts,
    decisions,
    references: fast.map((i) => ({ kind: i.kind, quote: i.quote })),
  };
  const result = await checker(input);
  const items = verifyDeepItems(input, result.items);
  db.prepare(
    'INSERT INTO teyit_runs (target, target_id, version, items, model, created_by) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(target.type, target.id, target.version, JSON.stringify(items), result.model, userId);
  return buildReport(db, target, body);
}
