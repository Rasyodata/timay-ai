import type { User } from './auth.ts';
import type { DB } from './db.ts';
import { upsertDecision } from './decisions.ts';
import { ApiError } from './errors.ts';

/**
 * Adalet Bakanlığı'nın açık karar veritabanı (Bedesten / mevzuat.adalet.gov.tr) üzerinden
 * Yargıtay kararlarını arar ve seçilen kararı tam metniyle büro arşivine aktarır.
 */
const BASE = 'https://bedesten.adalet.gov.tr/emsal-karar';
const PAGE_SIZE = 10;
const HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  Accept: '*/*',
  AdaletApplicationName: 'UyapMevzuat',
  Origin: 'https://mevzuat.adalet.gov.tr',
  Referer: 'https://mevzuat.adalet.gov.tr/',
};

export type Fetch = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;

interface RawDecision {
  documentId: string;
  birimAdi?: string;
  esasNo?: string;
  kararNo?: string;
  kararTarihiStr?: string;
}

export interface OnlineDecision {
  documentId: string;
  court: string;
  chamber: string;
  esasNo: string;
  kararNo: string;
  date: string;
  archiveId: number | null;
}

async function post<T>(fetchImpl: Fetch, path: string, data: Record<string, unknown>): Promise<T> {
  let res;
  try {
    res = await fetchImpl(`${BASE}/${path}`, {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({ data, applicationName: 'UyapMevzuat', ...(path === 'searchDocuments' ? { paging: true } : {}) }),
    });
  } catch {
    throw new ApiError(502, 'Yargıtay karar veritabanına ulaşılamadı. Biraz sonra tekrar deneyin.');
  }
  if (!res.ok) throw new ApiError(502, `Karar veritabanı yanıt vermedi (${res.status}).`);
  const body = (await res.json()) as { data?: T; metadata?: { FMTY?: string; FMTE?: string } };
  if (!body.data) throw new ApiError(502, body.metadata?.FMTE || 'Karar veritabanından geçersiz yanıt alındı.');
  return body.data;
}

/** "05.03.2021" → "2021-03-05"; tarih anlamsızsa (ör. 6006 yılı) boş döner. */
export function parseDate(s?: string) {
  const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec((s ?? '').trim());
  if (!m) return '';
  const year = Number(m[3]);
  if (year < 1950 || year > new Date().getFullYear() + 1) return '';
  return `${m[3]}-${m[2]}-${m[1]}`;
}

function toOnline(db: DB, r: RawDecision): OnlineDecision {
  const esasNo = (r.esasNo ?? '').trim();
  const kararNo = (r.kararNo ?? '').trim();
  const row = db.prepare("SELECT id FROM decisions WHERE court = 'Yargıtay' AND esas_no = ? AND karar_no = ?").get(esasNo, kararNo) as
    | { id: number }
    | undefined;
  return {
    documentId: String(r.documentId),
    court: 'Yargıtay',
    chamber: (r.birimAdi ?? '').trim(),
    esasNo,
    kararNo,
    date: parseDate(r.kararTarihiStr),
    archiveId: row?.id ?? null,
  };
}

export async function search(db: DB, fetchImpl: Fetch, input: { q?: string; chamber?: string; page?: string | number }) {
  const phrase = (input.q ?? '').trim();
  if (phrase.length < 2) throw new ApiError(400, 'Aramak için en az iki harf yazın.');
  const page = Math.max(1, Math.min(Number(input.page) || 1, 1000));
  const data: Record<string, unknown> = {
    pageSize: PAGE_SIZE,
    pageNumber: page,
    itemTypeList: ['YARGITAYKARARI'],
    phrase,
    sortFields: ['KARAR_TARIHI'],
    sortDirection: 'desc',
  };
  if (input.chamber?.trim()) data.birimAdi = input.chamber.trim();
  const result = await post<{ emsalKararList?: RawDecision[]; total?: number }>(fetchImpl, 'searchDocuments', data);
  return { total: Number(result.total ?? 0), items: (result.emsalKararList ?? []).map((r) => toOnline(db, r)) };
}

const ENTITIES: Record<string, string> = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

/** Eski tip HTML karar metnini düz metne çevirir. */
export function htmlToText(html: string) {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (all, e: string) => {
      if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1)));
      return ENTITIES[e.toLowerCase()] ?? all;
    })
    .replace(/ /g, ' ')
    .replace(/\r/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Kararı tam metniyle indirip arşive ekler; arşivdeki kaydı döner. */
export async function importDecision(
  db: DB,
  fetchImpl: Fetch,
  user: User,
  input: { documentId?: string; date?: string; chamber?: string },
) {
  if (user.role !== 'avukat') throw new ApiError(403, 'Arşive yalnızca avukatlar karar ekleyebilir.');
  const docId = String(input.documentId ?? '').trim();
  if (!/^[\w-]{1,64}$/.test(docId)) throw new ApiError(400, 'Geçersiz karar kimliği.');
  const content = await post<{ content?: string; mimeType?: string }>(fetchImpl, 'getDocumentContent', { documentId: docId });
  if (!content.content) throw new ApiError(502, 'Karar metni alınamadı.');
  const raw = Buffer.from(content.content, 'base64').toString('utf8');
  const text = content.mimeType && !content.mimeType.includes('html') ? raw.trim() : htmlToText(raw);

  // Başlık satırı: "12. Hukuk Dairesi 2006/10799 E., 2006/13163 K."
  const head = /^(.*?)\s*(\d{4}\/\d+)\s*E\.\s*,?\s*(\d{4}\/\d+)\s*K\./m.exec(text);
  if (!head) throw new ApiError(422, 'Karar metninde esas ve karar numarası bulunamadı.');
  const chamber = (input.chamber?.trim() || head[1]).replace(/^T\.?C\.?\s*/i, '').replace(/^Yargıtay\s*/i, '').trim();
  const dateMatch = /(?:karar\s+tarihi|tarihinde)[^\d]{0,20}(\d{2}\.\d{2}\.\d{4})/i.exec(text) ?? /(\d{2}\.\d{2}\.\d{4})\s+tarihinde/i.exec(text);
  const id = upsertDecision(db, {
    court: 'Yargıtay',
    chamber,
    esasNo: head[2],
    kararNo: head[3],
    decisionDate: parseDate(dateMatch?.[1]) || (/^\d{4}-\d{2}-\d{2}$/.test(input.date ?? '') ? input.date : ''),
    text,
    sourceUrl: `https://mevzuat.adalet.gov.tr/ictihat/${docId}`,
  });
  return db.prepare('SELECT * FROM decisions WHERE id = ?').get(id);
}
