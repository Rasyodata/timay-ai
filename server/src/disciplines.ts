/*
 * Çok disiplinli inceleme: bir dilekçe, takip talebi ya da ihtarname cevabı sekiz ayrı gözle
 * okunur. 1–7 her biri kendi bakış açısından bulgu çıkarır; 8. disiplin hepsini birleştirir.
 * Kurallar anında ve ücretsiz çalışır; yapay zekâ bağlandığında her disiplin metni ayrıca okur.
 */
import type { User } from './auth.ts';
import { getCase } from './cases.ts';
import { checkCitations } from './citations.ts';
import type { DB } from './db.ts';
import { ApiError } from './errors.ts';
import { extractLawRefs } from './teyit.ts';

export type DocKind = 'dava' | 'cevap' | 'icra' | 'ihtar_cevap' | 'ihtarname' | 'itiraz' | 'kanun_yolu';
export type Level = 'iyi' | 'uyari' | 'kritik';

export const DOC_KINDS: { id: DocKind; label: string }[] = [
  { id: 'dava', label: 'Dava dilekçesi' },
  { id: 'cevap', label: 'Davaya cevap' },
  { id: 'icra', label: 'İcra takip talebi' },
  { id: 'ihtarname', label: 'İhtarname' },
  { id: 'ihtar_cevap', label: 'İhtara cevap' },
  { id: 'itiraz', label: 'İtiraz dilekçesi' },
  { id: 'kanun_yolu', label: 'İstinaf / temyiz' },
];

export interface Finding {
  level: Level;
  text: string;
  /** Neden önemli / dayanağı. */
  basis?: string;
  /** Metinden ilgili kısa parça. */
  quote?: string;
}

export interface DisciplineResult {
  no: number;
  id: string;
  title: string;
  lens: string;
  score: number;
  findings: Finding[];
}

export interface DisciplineReview {
  kind: DocKind;
  kindLabel: string;
  disciplines: DisciplineResult[];
  summary: {
    score: number;
    verdict: 'hazir' | 'duzeltme' | 'ciddi';
    verdictLabel: string;
    critical: number;
    warnings: number;
    priorities: (Finding & { discipline: string })[];
  };
  ai: boolean;
}

interface CaseInfo {
  area: string;
  client: string;
  facts: string;
  court: string;
  esas_no: string;
  documents: number;
}

// ---------------------------------------------------------------- yardımcılar
const lower = (s: string) => s.toLocaleLowerCase('tr');

function has(t: string, ...patterns: RegExp[]) {
  return patterns.some((p) => p.test(t));
}

function quoteOf(body: string, p: RegExp, width = 70) {
  const m = p.exec(body);
  if (!m) return undefined;
  const start = Math.max(0, m.index - 15);
  return body.slice(start, Math.min(body.length, m.index + width)).replace(/\s+/g, ' ').trim();
}

/** Metindeki TL tutarları (12.500,00 TL / 12500 TL / ₺12.500). */
export function amounts(body: string) {
  const out: number[] = [];
  for (const m of body.matchAll(/(?:₺\s*)?(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d{1,2}))?\s*(?:TL|₺|Türk Lirası)/gi)) {
    out.push(Number(m[1].replace(/\./g, '')) + (m[2] ? Number(m[2].padEnd(2, '0')) / 100 : 0));
  }
  return out;
}

/** Metindeki tarihler (GG.AA.YYYY). */
export function dates(body: string) {
  const out: string[] = [];
  for (const m of body.matchAll(/\b(\d{1,2})[./](\d{1,2})[./](\d{4})\b/g)) {
    const [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) out.push(`${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
  }
  return out;
}

function yearsBetween(a: string, b: string) {
  return (Date.parse(b) - Date.parse(a)) / (365.25 * 86400000);
}

function score(findings: Finding[]) {
  const penalty = findings.reduce((s, f) => s + (f.level === 'kritik' ? 25 : f.level === 'uyari' ? 10 : 0), 0);
  return Math.max(0, 100 - penalty);
}

export function guessKind(title: string, body: string): DocKind {
  const t = lower(`${title}\n${body.slice(0, 600)}`);
  if (/istinaf|temyiz|kanun yolu/.test(t)) return 'kanun_yolu';
  if (/ihtarnameye cevap|ihtara cevap|cevabi ihtarname|cevap ihtarnamesi/.test(t)) return 'ihtar_cevap';
  if (/ihtarname/.test(t)) return 'ihtarname';
  if (/cevap dilekçe|davaya cevap|cevaplarımız/.test(t)) return 'cevap';
  if (/takip talebi|icra müdürlüğü|icra dairesi/.test(t)) return 'icra';
  if (/itiraz/.test(t)) return 'itiraz';
  return 'dava';
}

const CRIME = [
  { p: /dolandır/, crime: 'dolandırıcılık (TCK 157–158)' },
  { p: /sahte|sahtecilik|taklit imza/, crime: 'belgede sahtecilik (TCK 204–207)' },
  { p: /tehdit/, crime: 'tehdit (TCK 106)' },
  { p: /hakaret|sövme/, crime: 'hakaret (TCK 125)' },
  { p: /güveni kötüye/, crime: 'güveni kötüye kullanma (TCK 155)' },
  { p: /karşılıksız çek/, crime: 'karşılıksız çek (5941 s. K. m.5)' },
  { p: /zimmet/, crime: 'zimmet (TCK 247)' },
  { p: /şantaj/, crime: 'şantaj (TCK 107)' },
  { p: /mala zarar/, crime: 'mala zarar verme (TCK 151)' },
  { p: /hırsızlık|çaldı/, crime: 'hırsızlık (TCK 141)' },
  { p: /işyerinde (?:taciz|mobbing)|cinsel taciz/, crime: 'cinsel taciz (TCK 105)' },
  { p: /iş kazası.*(?:öldü|vefat|yaralan)|(?:öldü|vefat|yaralan).*iş kazası/s, crime: 'taksirle öldürme / yaralama (TCK 85, 89)' },
];

// ---------------------------------------------------------------- 1. Avukat gözüyle
function lawyer(body: string, kind: DocKind, c: CaseInfo | null): Finding[] {
  const t = lower(body);
  const f: Finding[] = [];
  const result = /sonuç ve (?:istem|talep)|netice[- ]i talep|sonuç\s*:/.test(t);
  if (['dava', 'cevap', 'itiraz', 'kanun_yolu'].includes(kind)) {
    if (!result) f.push({ level: 'kritik', text: '"SONUÇ VE İSTEM" bölümü yok. Mahkeme yalnız istenene karar verir.', basis: 'HMK m.26, m.119/1-ğ' });
    else f.push({ level: 'iyi', text: 'Sonuç ve istem bölümü var.' });
    if (!/yargılama gider|vekâlet ücret|vekalet ücret/.test(t)) f.push({ level: 'uyari', text: 'Yargılama giderleri ve vekâlet ücretinin karşı tarafa yükletilmesi istenmemiş.', basis: 'HMK m.326' });
  }
  const sums = amounts(body);
  if ((kind === 'dava' || kind === 'icra') && sums.length && !/faiz/.test(t)) f.push({ level: 'uyari', text: 'Para alacağı istenmiş ama faiz (türü ve başlangıç tarihi) istenmemiş.', basis: 'TBK m.117–120, 3095 s. K.' });
  if (kind === 'dava' && sums.length && !/fazlaya ilişkin|belirsiz alacak/.test(t)) f.push({ level: 'uyari', text: 'Fazlaya ilişkin haklar saklı tutulmamış; kısmi taleplerde sonradan artırma zorlaşır.', basis: 'HMK m.107, m.109' });
  if (kind === 'dava' && !/ihtiyati haciz|ihtiyati tedbir/.test(t) && !/işçi|kıdem|ihbar|ücret/.test(t) && /alacak|borç/.test(t) && sums.some((s) => s >= 100000))
    f.push({ level: 'uyari', text: 'Yüksek tutarlı alacakta ihtiyati haciz veya tedbir talebi düşünülmeli.', basis: 'İİK m.257, HMK m.389' });
  if (kind === 'cevap' && !/reddi|reddine/.test(t)) f.push({ level: 'kritik', text: 'Cevapta davanın reddi açıkça istenmemiş.' });
  if (c?.client && !lower(body).includes(lower(c.client.split(' ')[0] ?? ''))) f.push({ level: 'uyari', text: `Müvekkil (${c.client}) metinde geçmiyor; taraf bilgilerini kontrol edin.` });
  if (/kabul ediyoruz|kabul etmekteyiz|ikrar ediyoruz/.test(t)) f.push({ level: 'kritik', text: 'Metinde müvekkil aleyhine ikrar sayılabilecek ifade var.', quote: quoteOf(body, /kabul ediyoruz|kabul etmekteyiz|ikrar ediyoruz/i), basis: 'HMK m.188' });
  return f;
}

// ---------------------------------------------------------------- 2. Savcı gözüyle
function prosecutor(body: string, kind: DocKind, today: string): Finding[] {
  const t = lower(body);
  const f: Finding[] = [];
  const found = CRIME.filter((c) => c.p.test(t));
  for (const c of found) {
    f.push({
      level: 'uyari',
      text: `Anlatılan olay ${c.crime} suçunu da oluşturabilir. Ayrıca suç duyurusu veya şikâyet değerlendirilmeli.`,
      basis: 'CMK m.158; şikâyete bağlı suçlarda 6 ay (TCK m.73)',
      quote: quoteOf(body, new RegExp(c.p.source, 'i')),
    });
  }
  if (found.length && !/suç duyurusu|şikâyet|şikayet|savcılı/.test(t)) f.push({ level: 'uyari', text: 'Ceza boyutu varken savcılığa başvuru veya ceza dosyası anılmamış.' });
  const self = /(?:müvekkil\w*)\s[^.]{0,80}(?:ödemedi|teslim etmedi|imzaladı|kabul etti|bildirmedi)/i.exec(body);
  if (self && kind !== 'dava') f.push({ level: 'uyari', text: 'Müvekkilin bir eylemi metinde açıkça yazılmış; ceza soruşturmasında aleyhe delil olarak kullanılabilir.', quote: self[0].slice(0, 90) });
  const old = dates(body).filter((d) => yearsBetween(d, today) > 8);
  if (found.length && old.length) f.push({ level: 'uyari', text: 'Olay tarihi eski; dava zamanaşımı (TCK m.66) yönünden kontrol edin.' });
  if (!found.length) f.push({ level: 'iyi', text: 'Metinde ceza hukuku boyutu gerektiren bir olay görünmüyor.' });
  return f;
}

// ---------------------------------------------------------------- 3. Hâkim gözüyle (usul ve şekil)
function judge(body: string, kind: DocKind, c: CaseInfo | null): Finding[] {
  const t = lower(body);
  const f: Finding[] = [];
  const blanks = [...body.matchAll(/\[[^\]\n]{0,60}\]/g)];
  if (blanks.length) f.push({ level: 'kritik', text: `${blanks.length} doldurulmamış alan var (köşeli parantezli yerler).`, quote: blanks[0][0] });
  if (['dava', 'cevap', 'itiraz', 'kanun_yolu'].includes(kind)) {
    if (!/mahkemesi|başkanlığı|hâkimliği|hakimliği/.test(t.slice(0, 400))) f.push({ level: 'kritik', text: 'Dilekçe başında mahkeme adı yok.', basis: 'HMK m.119/1-a' });
    if (!/davacı|davalı|başvuran|karşı taraf/.test(t)) f.push({ level: 'kritik', text: 'Taraflar (davacı/davalı) yazılmamış.', basis: 'HMK m.119/1-b' });
    if (kind === 'dava' && !/t\.?c\.? kimlik|tckn|vergi (?:no|numarası)|mersis/.test(t)) f.push({ level: 'uyari', text: 'Davacının T.C. kimlik / vergi numarası yok.', basis: 'HMK m.119/1-c' });
    if (!/vekil/.test(t)) f.push({ level: 'uyari', text: 'Vekil bilgisi yok.', basis: 'HMK m.119/1-ç' });
    if (!/konu\s*:|dava konusu|konusu\s*:/.test(t)) f.push({ level: 'uyari', text: '"KONU" satırı yok.', basis: 'HMK m.119/1-d' });
    if (kind === 'dava' && amounts(body).length && !/dava değeri|harca esas|değer\s*:/.test(t)) f.push({ level: 'uyari', text: 'Dava değeri (harca esas değer) belirtilmemiş.', basis: 'HMK m.119/1-ğ, Harçlar K.' });
    if (!/açıklamalar|olaylar|izah/.test(t)) f.push({ level: 'uyari', text: '"AÇIKLAMALAR" bölümü yok; vakıalar sıra numarasıyla anlatılmalı.', basis: 'HMK m.119/1-e' });
    if (!/hukuk[iî] sebep|hukuki neden|yasal dayanak|hukuki deliller/.test(t)) f.push({ level: 'uyari', text: '"HUKUKİ SEBEPLER" bölümü yok.', basis: 'HMK m.119/1-ğ' });
    if (kind === 'cevap' && !/(\d{4})\/(\d+)\s*(?:e\.|esas)/.test(t) && !c?.esas_no) f.push({ level: 'kritik', text: 'Cevapta dosyanın esas numarası yok.' });
    if (kind === 'cevap' && /yetki/.test(t) === false) f.push({ level: 'uyari', text: 'Yetki itirazı yoksa bu hak cevapla birlikte düşer; bilinçli olarak mı yazılmadı?', basis: 'HMK m.116–117' });
  }
  if (kind === 'icra') {
    if (!/icra (?:dairesi|müdürlüğü)/.test(t)) f.push({ level: 'kritik', text: 'İcra dairesi belirtilmemiş.', basis: 'İİK m.58' });
    if (!/borçlu/.test(t)) f.push({ level: 'kritik', text: 'Borçlu bilgisi yok.', basis: 'İİK m.58/2' });
    if (!amounts(body).length) f.push({ level: 'kritik', text: 'Alacak miktarı TL olarak yazılmamış.', basis: 'İİK m.58/3' });
    if (!/takip yolu|ilamsız|ilamlı|kambiyo|rehin/.test(t)) f.push({ level: 'uyari', text: 'Takip yolu seçilmemiş.' });
    if (!/alacağın sebebi|dayanak|fatura|sözleşme|senet|çek/.test(t)) f.push({ level: 'uyari', text: 'Alacağın sebebi veya dayanak belgesi yazılmamış.', basis: 'İİK m.58/4' });
  }
  if (kind === 'ihtar_cevap') {
    if (!/yevmiye|tarihli ihtar|sayılı ihtar/.test(t)) f.push({ level: 'uyari', text: 'Cevap verilen ihtarnamenin tarihi ve yevmiye numarası anılmamış.' });
    if (!/noter/.test(t)) f.push({ level: 'uyari', text: 'Noter bilgisi yok; ispat için noter kanalıyla gönderilmesi önerilir.' });
  }
  if (kind === 'ihtarname' && !/(\d+)\s*(?:gün|iş günü)/.test(t)) f.push({ level: 'kritik', text: 'İhtarnamede süre verilmemiş; temerrüt ve fesih için süre şart olabilir.', basis: 'TBK m.117, m.123' });
  if (!/imza|av\.\s/.test(t.slice(-300))) f.push({ level: 'uyari', text: 'Sonunda imza / vekil adı yok.', basis: 'HMK m.119/1-h' });
  if (c?.court && kind !== 'icra' && !t.includes(lower(c.court.split(' ')[0] ?? ''))) f.push({ level: 'uyari', text: `Dosyadaki mahkeme (${c.court}) dilekçede geçmiyor.` });
  if (!f.some((x) => x.level !== 'iyi')) f.push({ level: 'iyi', text: 'Şekil şartları tamam görünüyor.' });
  return f;
}

// ---------------------------------------------------------------- 4. Karşı taraf avukatı gözüyle
function opponent(db: DB, body: string, today: string): Finding[] {
  const t = lower(body);
  const f: Finding[] = [];
  const vague = [...body.matchAll(/\b(?:yaklaşık|civarında|gibi|vs\.?|vb\.?|bir süre|bazı)\b/gi)];
  if (vague.length >= 3) f.push({ level: 'uyari', text: `${vague.length} yerde belirsiz ifade var (yaklaşık, vs., bazı…). Karşı taraf "somutlaştırılmamış" diyecektir.`, basis: 'HMK m.194', quote: quoteOf(body, /\b(?:yaklaşık|civarında|vs\.?|bazı)\b/i) });
  const cites = checkCitations(db, body);
  const missing = cites.filter((c) => !c.decisionId);
  if (missing.length) f.push({ level: 'kritik', text: `${missing.length} Yargıtay kararı arşivde yok; karşı taraf künyeyi çürütebilir.`, quote: missing[0].raw });
  if (cites.length && !missing.length) f.push({ level: 'iyi', text: `${cites.length} karar atfı arşivle doğrulandı.` });
  const old = dates(body).filter((d) => yearsBetween(d, today) > 5);
  if (old.length && !/zamanaşımı/.test(t)) f.push({ level: 'uyari', text: `${old[0].split('-').reverse().join('.')} tarihli olay 5 yıldan eski; karşı taraf zamanaşımı itirazı yapabilir.`, basis: 'TBK m.146–147' });
  if (/iddia/.test(t) && !/ispat|delil|ek-?\s*\d/.test(t)) f.push({ level: 'uyari', text: 'İddialar delille eşleştirilmemiş; ispat yükü bizde kalır.', basis: 'TMK m.6, HMK m.190' });
  if (/hep|asla|kesinlikle|hiçbir zaman/.test(t)) f.push({ level: 'uyari', text: 'Mutlak ifadeler (hep, asla, kesinlikle) tek bir karşı delille çürütülebilir.', quote: quoteOf(body, /\b(?:hep|asla|kesinlikle|hiçbir zaman)\b/i) });
  if (!f.length) f.push({ level: 'iyi', text: 'Karşı tarafın kolay yakalayacağı belirgin bir açık görünmüyor.' });
  return f;
}

// ---------------------------------------------------------------- 5. Bilirkişi gözüyle (hesap)
function expert(body: string, kind: DocKind): Finding[] {
  const t = lower(body);
  const f: Finding[] = [];
  const sums = amounts(body);
  if (!sums.length) {
    f.push({ level: 'iyi', text: 'Metinde hesap gerektiren tutar yok.' });
    return f;
  }
  f.push({ level: 'iyi', text: `${sums.length} tutar bulundu; en yükseği ${Math.max(...sums).toLocaleString('tr-TR')} TL.` });
  // "… X TL, … Y TL olmak üzere toplam Z TL" cümlelerinde kalemler toplamı tutuyor mu?
  for (const sentence of body.split(/(?<=[.;])\s+|\n/)) {
    const i = lower(sentence).indexOf('toplam');
    if (i < 0) continue;
    const parts = amounts(sentence.slice(0, i));
    const total = amounts(sentence.slice(i))[0];
    const sum = parts.reduce((a, b) => a + b, 0);
    if (parts.length >= 2 && total !== undefined && Math.abs(sum - total) > 1)
      f.push({ level: 'kritik', text: `Kalemlerin toplamı (${sum.toLocaleString('tr-TR')} TL) ile yazılan toplam (${total.toLocaleString('tr-TR')} TL) tutmuyor.`, quote: sentence.trim().slice(0, 120) });
  }
  if (/faiz/.test(t) && !/(?:yasal|ticari|avans|reeskont|temerrüt|mevduat) faiz/.test(t)) f.push({ level: 'uyari', text: 'Faiz türü (yasal, ticari, avans) belirtilmemiş.', basis: '3095 s. K. m.1–2' });
  if (/faiz/.test(t) && !/tarihinden itibaren|temerrüt tarihi|dava tarihinden|takip tarihinden/.test(t)) f.push({ level: 'uyari', text: 'Faizin başlangıç tarihi yok.' });
  if ((kind === 'dava' && /işçilik|kıdem|ihbar|fazla mesai|tazminat/.test(t)) && !/bilirkişi/.test(t)) f.push({ level: 'uyari', text: 'Hesap gerektiren alacakta bilirkişi incelemesi istenmemiş.', basis: 'HMK m.266' });
  if (/brüt|net/.test(t) === false && /ücret|maaş/.test(t)) f.push({ level: 'uyari', text: 'Ücretin brüt mü net mi olduğu yazılmamış; hesap buna göre değişir.' });
  return f;
}

// ---------------------------------------------------------------- 6. Süre ve dava şartları
function deadlines(body: string, kind: DocKind, c: CaseInfo | null, today: string): Finding[] {
  const t = lower(body);
  const f: Finding[] = [];
  const area = c?.area ?? '';
  const mediation = area === 'is' || area === 'ticaret' || area === 'tuketici' || area === 'kira' || /işçilik|kıdem|işe iade|ticari|kira bedeli|tahliye/.test(t);
  if (kind === 'dava' && mediation && !/arabulucu/.test(t))
    f.push({ level: 'kritik', text: 'Bu uyuşmazlıkta arabuluculuk dava şartı olabilir; son tutanak anılmamış. Dava usulden reddedilir.', basis: '7036 s. K. m.3, TTK m.5/A, HUAK m.18/B' });
  if (kind === 'dava' && /işe iade/.test(t)) f.push({ level: 'uyari', text: 'İşe iadede arabuluculuk tutanağından itibaren 2 hafta içinde dava açılmalı.', basis: 'İş K. m.20' });
  if (kind === 'dava' && /itirazın iptali/.test(t)) f.push({ level: 'uyari', text: 'İtirazın iptali davası itirazın tebliğinden itibaren 1 yıl içinde açılmalı.', basis: 'İİK m.67' });
  if (kind === 'cevap') f.push({ level: 'uyari', text: 'Cevap süresi dava dilekçesinin tebliğinden itibaren 2 haftadır (ek süre bir defa, en çok 1 ay).', basis: 'HMK m.127' });
  if (kind === 'kanun_yolu') f.push({ level: 'uyari', text: 'İstinaf ve temyiz süresi kararın tebliğinden itibaren 2 haftadır.', basis: 'HMK m.345, m.361' });
  if (kind === 'itiraz' && /ödeme emri/.test(t)) f.push({ level: 'uyari', text: 'Ödeme emrine itiraz süresi 7 gün, kambiyo takibinde 5 gündür.', basis: 'İİK m.62, m.168' });
  const old = dates(body).filter((d) => yearsBetween(d, today) > 10);
  if (old.length) f.push({ level: 'uyari', text: 'Metinde 10 yıldan eski tarih var; genel zamanaşımı dolmuş olabilir.', basis: 'TBK m.146' });
  if (kind === 'ihtar_cevap' && !/(\d+)\s*gün/.test(t)) f.push({ level: 'iyi', text: 'İhtara cevapta süre vermek zorunlu değildir.' });
  if (!f.length) f.push({ level: 'iyi', text: 'Belirgin bir süre veya dava şartı sorunu görünmüyor.' });
  return f;
}

// ---------------------------------------------------------------- 7. Delil ve ispat
function evidence(body: string, kind: DocKind, c: CaseInfo | null): Finding[] {
  const t = lower(body);
  const f: Finding[] = [];
  if (kind === 'icra' || kind === 'ihtarname' || kind === 'ihtar_cevap') {
    if (!/ek-?\s*\d|ekler|ekte/.test(t)) f.push({ level: 'uyari', text: 'Dayanak belgeler ek olarak gösterilmemiş.' });
    if (!f.length) f.push({ level: 'iyi', text: 'Ekler gösterilmiş.' });
    return f;
  }
  if (!/deliller|hukuki deliller|delil listesi/.test(t)) f.push({ level: 'kritik', text: '"DELİLLER" bölümü yok. Bildirilmeyen delile sonradan dayanılamaz.', basis: 'HMK m.119/1-f, m.140/5, m.145' });
  if (!/her türlü (?:yasal|kanuni) delil/.test(t)) f.push({ level: 'uyari', text: '"Her türlü yasal delil" ibaresi yok.' });
  if (/tanık/.test(t) && !/tanık(?:lar)?\s*:|tanık listesi|isim ve adres/.test(t)) f.push({ level: 'uyari', text: 'Tanık gösterilmiş ama adı ve adresi yazılmamış.', basis: 'HMK m.240' });
  if (!/yemin/.test(t) && kind === 'dava') f.push({ level: 'uyari', text: 'Yemin deliline dayanılmamış.', basis: 'HMK m.225' });
  const exhibits = new Set([...body.matchAll(/ek[- ]?(\d+)/gi)].map((m) => m[1])).size;
  if (c && exhibits > c.documents) f.push({ level: 'uyari', text: `Dilekçede ${exhibits} ek anılıyor, dava dosyasında ${c.documents} belge var. Eksik ekleri yükleyin.` });
  if (c && c.documents === 0 && kind === 'dava') f.push({ level: 'uyari', text: 'Dava dosyasında hiç belge yok; deliller dosyaya eklenmeli.' });
  const laws = extractLawRefs(body).length;
  if (!laws) f.push({ level: 'uyari', text: 'Hiç kanun maddesi gösterilmemiş.' });
  else f.push({ level: 'iyi', text: `${laws} kanun maddesine dayanılmış.` });
  return f;
}

// ---------------------------------------------------------------- 8. Genel değerlendirme
const DISCIPLINES = [
  { id: 'avukat', title: 'Avukat gözüyle', lens: 'Müvekkilin bütün hakları istendi mi, aleyhe bir şey yazıldı mı?' },
  { id: 'savci', title: 'Savcı gözüyle', lens: 'Olayda suç var mı, ceza boyutu müvekkili nasıl etkiler?' },
  { id: 'hakim', title: 'Hâkim gözüyle', lens: 'Usul ve şekil şartları tam mı, karar verilebilir mi?' },
  { id: 'karsi', title: 'Karşı taraf avukatı gözüyle', lens: 'Nereden saldırılır, hangi iddia çürütülür?' },
  { id: 'bilirkisi', title: 'Bilirkişi gözüyle', lens: 'Tutarlar, faiz ve hesaplar tutarlı mı?' },
  { id: 'sure', title: 'Süre ve dava şartları', lens: 'Arabuluculuk, zamanaşımı, hak düşürücü süreler' },
  { id: 'delil', title: 'Delil ve ispat', lens: 'Her iddia delille desteklendi mi, ekler tam mı?' },
] as const;

export function reviewDocument(input: { body: string; kind?: DocKind; title?: string; caseInfo?: CaseInfo | null; db: DB; today?: string }): DisciplineReview {
  const body = input.body ?? '';
  if (!body.trim()) throw new ApiError(400, 'İncelenecek metin boş.');
  const today = input.today ?? new Date().toISOString().slice(0, 10);
  const kind = input.kind && DOC_KINDS.some((k) => k.id === input.kind) ? input.kind : guessKind(input.title ?? '', body);
  const c = input.caseInfo ?? null;
  const lists = [
    lawyer(body, kind, c),
    prosecutor(body, kind, today),
    judge(body, kind, c),
    opponent(input.db, body, today),
    expert(body, kind),
    deadlines(body, kind, c, today),
    evidence(body, kind, c),
  ];
  const disciplines: DisciplineResult[] = DISCIPLINES.map((d, i) => ({ no: i + 1, ...d, findings: lists[i], score: score(lists[i]) }));
  const all = disciplines.flatMap((d) => d.findings.map((f) => ({ ...f, discipline: d.title })));
  const critical = all.filter((f) => f.level === 'kritik');
  const warnings = all.filter((f) => f.level === 'uyari');
  // Ağırlık: hâkim ve süre disiplinleri usulden ret riski taşıdığı için iki kat sayılır.
  const weights = [1, 0.5, 2, 1, 1, 2, 1.5];
  const overall = Math.round(disciplines.reduce((s, d, i) => s + d.score * weights[i], 0) / weights.reduce((a, b) => a + b, 0));
  const verdict = critical.length >= 3 || overall < 50 ? 'ciddi' : critical.length || overall < 80 ? 'duzeltme' : 'hazir';
  const verdictLabel = { hazir: 'Göndermeye hazır', duzeltme: 'Düzeltme gerekli', ciddi: 'Ciddi eksikler var' }[verdict];
  const summaryFindings: Finding[] = [
    { level: verdict === 'hazir' ? 'iyi' : verdict === 'duzeltme' ? 'uyari' : 'kritik', text: `${verdictLabel}: ${critical.length} kritik, ${warnings.length} uyarı.` },
    ...critical.slice(0, 5).map((f) => ({ ...f, text: `${f.discipline}: ${f.text}` })),
  ];
  disciplines.push({ no: 8, id: 'genel', title: 'Genel değerlendirme', lens: 'Yedi disiplinin bulgularını birleştirir, önce neyin düzeltileceğini söyler.', score: overall, findings: summaryFindings });
  return {
    kind,
    kindLabel: DOC_KINDS.find((k) => k.id === kind)!.label,
    disciplines,
    summary: {
      score: overall,
      verdict,
      verdictLabel,
      critical: critical.length,
      warnings: warnings.length,
      priorities: [...critical, ...warnings].slice(0, 8),
    },
    ai: false,
  };
}

export function reviewForUser(db: DB, user: User, input: { body?: string; kind?: DocKind; title?: string; caseId?: number | null }) {
  let caseInfo: CaseInfo | null = null;
  if (input.caseId) {
    const c = getCase(db, user, Number(input.caseId));
    const docs = db.prepare('SELECT COUNT(*) AS n FROM case_documents WHERE case_id = ?').get(c.id) as { n: number };
    caseInfo = { area: c.area, client: c.client, facts: c.facts, court: c.court, esas_no: c.esas_no, documents: docs.n };
  }
  return reviewDocument({ db, body: String(input.body ?? ''), kind: input.kind, title: input.title, caseInfo });
}
