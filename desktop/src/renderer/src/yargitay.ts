import { api, type ArchiveDecision, type OnlineDecision } from './api';

/*
 * Yargıtay karar araması. Karar veritabanına (Bedesten) bu bilgisayardan ulaşılır; sunucu arama
 * gövdesini kurar ve arşivde olan kararları işaretler. Tarayıcıda sunucu üzerinden aranır.
 */

export interface YargitaySearch {
  q: string;
  chamber?: string;
  page?: number;
  exact?: boolean;
  exclude?: string;
  yearFrom?: string;
  yearTo?: string;
}

type Raw = { data?: unknown; metadata?: { FMTE?: string } };

export async function searchYargitay(s: YargitaySearch): Promise<{ total: number; items: OnlineDecision[] }> {
  const input = {
    q: s.q,
    chamber: s.chamber ?? '',
    exact: s.exact ? '1' : '',
    exclude: s.exclude ?? '',
    yearFrom: s.yearFrom ?? '',
    yearTo: s.yearTo ?? '',
    page: String(s.page ?? 1),
  };
  const bedesten = window.timay?.bedesten;
  if (!bedesten) return api(`/yargitay/search?${new URLSearchParams(input)}`);
  const run = async (withDates: boolean) => {
    const data = await api<Record<string, unknown>>('/yargitay/body', { body: { ...input, withDates } });
    return (await bedesten('searchDocuments', data)) as Raw;
  };
  const dated = Boolean(input.yearFrom || input.yearTo);
  let raw = dated ? await run(true).catch(() => ({}) as Raw) : await run(true);
  // Tarih süzgeci kabul edilmezse tarihsiz arar, yıl aralığını sonuçta uygular.
  if (!raw.data && dated) raw = await run(false);
  if (!raw.data) throw new Error(raw.metadata?.FMTE || 'Karar veritabanından geçersiz yanıt alındı.');
  return api('/yargitay/map', { body: { data: raw.data, filter: { yearFrom: input.yearFrom, yearTo: input.yearTo } } });
}

/** Kararı tam metniyle büro arşivine ekler. */
export async function importYargitay(d: OnlineDecision) {
  const body: Record<string, unknown> = { documentId: d.documentId, date: d.date, chamber: d.chamber };
  const bedesten = window.timay?.bedesten;
  if (bedesten) {
    const raw = (await bedesten('getDocumentContent', { documentId: d.documentId })) as { data?: { content?: string; mimeType?: string } };
    if (!raw.data?.content) throw new Error('Karar metni alınamadı.');
    body.content = raw.data.content;
    body.mimeType = raw.data.mimeType;
  }
  return api<ArchiveDecision>('/yargitay/import', { body });
}

export function decisionTitle(d: { chamber: string; court: string; esas_no?: string; karar_no?: string; esasNo?: string; kararNo?: string }) {
  return `${d.court} ${d.chamber} · ${d.esas_no ?? d.esasNo} E. / ${d.karar_no ?? d.kararNo} K.`;
}
