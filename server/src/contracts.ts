import type { User } from './auth.ts';
import type { DB } from './db.ts';
import { ApiError } from './errors.ts';
import { optionalDate, ownedCaseId, toKurus } from './money.ts';

// ---------------------------------------------------------------------------
// Şablonlar
// ---------------------------------------------------------------------------

export interface ContractTemplate {
  id: string;
  title: string;
  description: string;
  body: string;
}

const IMZA = `
TARAF 1                                  TARAF 2
[AD SOYAD / UNVAN]                       [AD SOYAD / UNVAN]
İmza:                                    İmza:`;

export const CONTRACT_TEMPLATES: ContractTemplate[] = [
  {
    id: 'kira-konut',
    title: 'Konut kira sözleşmesi',
    description: 'Konut ve çatılı işyeri kirası',
    body: `KONUT KİRA SÖZLEŞMESİ

Madde 1 - Taraflar
Kiraya veren: [AD SOYAD], T.C. No: [T.C. KİMLİK NO], [ADRES]
Kiracı: [AD SOYAD], T.C. No: [T.C. KİMLİK NO], [ADRES]

Madde 2 - Kiralanan
[İL / İLÇE / MAHALLE / ADRES], [ADA / PARSEL], [ODA SAYISI] konut. Kiralanan, demirbaşlarıyla birlikte kullanıma elverişli durumda teslim edilmiştir.

Madde 3 - Süre
Kira süresi [BAŞLANGIÇ TARİHİ] başlangıçlı bir yıldır.

Madde 4 - Kira bedeli ve ödeme
Aylık kira bedeli [TUTAR] TL olup kiracı her ayın [GÜN]. gününe kadar kiraya verenin [BANKA / IBAN] hesabına ödemekle yükümlüdür. Yenilenen kira dönemlerinde kira bedeli bir önceki kira yılının TÜFE oranında artırılır.

Madde 5 - Depozito
Kiracı [TUTAR] TL depozito ödemiştir. Depozito, tahliyede kiralananın hasarsız teslimi halinde iade edilir.

Madde 6 - Kullanım
Kiracı kiralananı özenle kullanmak ve komşulara saygı göstermekle yükümlüdür. Kiracı, kiraya verenin yazılı izni olmadan kiralananı başkasına kiraya veremez.

Madde 7 - Giderler
Elektrik, su, doğalgaz ve aidat giderleri kiracıya aittir.

Madde 8 - Tahliye ve teslim
Kiracı, sözleşme sona erdiğinde kiralananı aldığı durumda teslim edecektir.

Madde 9 - Uyuşmazlık
Uyuşmazlıklarda [İL] mahkemeleri ve icra daireleri yetkilidir.
${IMZA}`,
  },
  {
    id: 'hizmet',
    title: 'Hizmet sözleşmesi',
    description: 'Danışmanlık ve hizmet alımı',
    body: `HİZMET SÖZLEŞMESİ

Madde 1 - Taraflar
Hizmet alan: [UNVAN], [ADRES], [VERGİ NO]
Hizmet veren: [UNVAN], [ADRES], [VERGİ NO]

Madde 2 - Konu
Hizmet veren, [HİZMETİN TANIMI] hizmetini bu sözleşmede belirlenen şartlarla sunmayı taahhüt eder.

Madde 3 - Süre
Sözleşme [BAŞLANGIÇ TARİHİ] tarihinde başlar ve [BİTİŞ TARİHİ] tarihinde sona erer.

Madde 4 - Bedel ve ödeme
Hizmet bedeli aylık [TUTAR] TL + KDV'dir. Hizmet alan, faturanın tebliğinden itibaren [GÜN] gün içinde ödemekle yükümlüdür. Geciken ödemeler için yasal temerrüt faizi uygulanır.

Madde 5 - Tarafların yükümlülükleri
Hizmet veren, hizmeti özenle ve zamanında yerine getirmekle yükümlüdür. Hizmet alan, hizmet için gerekli bilgi ve belgeleri zamanında sağlamakla yükümlüdür.

Madde 6 - Gizlilik
Taraflar, sözleşme kapsamında öğrendikleri ticari sırları süresiz olarak gizli tutmayı taahhüt eder.

Madde 7 - Fesih
Taraflardan her biri [GÜN] gün önceden yazılı bildirimde bulunarak sözleşmeyi feshedebilir. Esaslı ihlal halinde sözleşme derhal feshedilebilir.

Madde 8 - Mücbir sebep
Tarafların kontrolü dışındaki mücbir sebep hallerinde yükümlülükler, mücbir sebep süresince askıya alınır.

Madde 9 - Uyuşmazlık
Uyuşmazlıklarda [İL] mahkemeleri ve icra daireleri yetkilidir.
${IMZA}`,
  },
  {
    id: 'satis',
    title: 'Satış sözleşmesi',
    description: 'Taşınır mal satışı',
    body: `SATIŞ SÖZLEŞMESİ

Madde 1 - Taraflar
Satıcı: [AD SOYAD / UNVAN], [ADRES]
Alıcı: [AD SOYAD / UNVAN], [ADRES]

Madde 2 - Satılan
[MALIN CİNSİ, MİKTARI, ÖZELLİKLERİ]

Madde 3 - Bedel ve ödeme
Satış bedeli [TUTAR] TL'dir. Alıcı, bedelin [TUTAR] TL'sini imza tarihinde, kalan [TUTAR] TL'sini [TARİH] tarihine kadar ödeyecektir.

Madde 4 - Teslim
Satıcı, malı [TARİH] tarihine kadar [TESLİM YERİ]'nde alıcıya teslim edecektir. Hasar, teslimle birlikte alıcıya geçer.

Madde 5 - Ayıp
Alıcı, teslimden itibaren [GÜN] gün içinde malı muayene ederek ayıpları satıcıya bildirmekle yükümlüdür.

Madde 6 - Cezai şart
Satıcının teslimi geciktirmesi halinde her gecikme günü için [TUTAR] TL cezai şart ödenir.

Madde 7 - Uyuşmazlık
Uyuşmazlıklarda [İL] mahkemeleri ve icra daireleri yetkilidir.
${IMZA}`,
  },
  {
    id: 'gizlilik',
    title: 'Gizlilik sözleşmesi (NDA)',
    description: 'Karşılıklı gizlilik taahhüdü',
    body: `GİZLİLİK SÖZLEŞMESİ

Madde 1 - Taraflar
[TARAF 1 UNVAN, ADRES] ve [TARAF 2 UNVAN, ADRES]

Madde 2 - Gizli bilgi
Taraflardan birinin diğerine yazılı, sözlü veya elektronik olarak açıkladığı ticari, teknik ve mali her türlü bilgi gizli bilgidir.

Madde 3 - Yükümlülük
Taraflar, gizli bilgiyi yalnızca [AMAÇ] amacıyla kullanmayı, üçüncü kişilere açıklamamayı ve korumak için gerekli önlemleri almayı taahhüt eder.

Madde 4 - İstisnalar
Kamuya açık olan, yasal zorunlulukla açıklanması gereken veya bağımsız olarak geliştirilen bilgiler gizli bilgi sayılmaz.

Madde 5 - Süre
Gizlilik yükümlülüğü sözleşmenin sona ermesinden sonra [YIL] yıl devam eder.

Madde 6 - Cezai şart
Gizlilik yükümlülüğünü ihlal eden taraf, diğer tarafa [TUTAR] TL cezai şart ödemekle yükümlüdür. Cezai şart, aşan zararın istenmesine engel değildir.

Madde 7 - Uyuşmazlık
Uyuşmazlıklarda [İL] mahkemeleri ve icra daireleri yetkilidir.
${IMZA}`,
  },
  {
    id: 'is-sozlesmesi',
    title: 'Belirsiz süreli iş sözleşmesi',
    description: '4857 sayılı İş Kanunu kapsamında',
    body: `BELİRSİZ SÜRELİ İŞ SÖZLEŞMESİ

Madde 1 - Taraflar
İşveren: [UNVAN], [ADRES], SGK İşyeri No: [NO]
İşçi: [AD SOYAD], T.C. No: [T.C. KİMLİK NO], [ADRES]

Madde 2 - İşin konusu ve yeri
İşçi, [GÖREV] olarak [İŞYERİ ADRESİ]'nde çalışacaktır.

Madde 3 - Başlangıç ve deneme süresi
Sözleşme [BAŞLANGIÇ TARİHİ] tarihinde başlar. Deneme süresi [AY] aydır.

Madde 4 - Çalışma süresi
Haftalık çalışma süresi 45 saattir. Fazla çalışma, işçinin onayı ile yapılır ve kanuna uygun olarak ücretlendirilir.

Madde 5 - Ücret
İşçiye aylık brüt [TUTAR] TL ücret ödenir. Ücret her ayın [GÜN]. günü işçinin banka hesabına ödenir.

Madde 6 - Yıllık izin
İşçi, kanunda öngörülen sürelerde ücretli yıllık izin hakkına sahiptir.

Madde 7 - Gizlilik
İşçi, işverenin ticari sırlarını iş ilişkisi süresince ve sonrasında gizli tutmakla yükümlüdür.

Madde 8 - Fesih
Sözleşmenin feshinde 4857 sayılı İş Kanunu hükümleri uygulanır.

Madde 9 - Uyuşmazlık
Uyuşmazlıklarda [İL] iş mahkemeleri yetkilidir.
${IMZA}`,
  },
  {
    id: 'kat-karsiligi',
    title: 'Kat karşılığı inşaat sözleşmesi',
    description: 'Arsa payı karşılığı inşaat (noter onayı gerekir)',
    body: `ARSA PAYI KARŞILIĞI İNŞAAT SÖZLEŞMESİ

Madde 1 - Taraflar
Arsa sahibi: [AD SOYAD], T.C. No: [T.C. KİMLİK NO], [ADRES]
Yüklenici: [UNVAN], [ADRES], [VERGİ NO]

Madde 2 - Arsa
[İL / İLÇE / MAHALLE], [ADA / PARSEL], [YÜZÖLÇÜMÜ] m² arsa.

Madde 3 - Konu
Yüklenici, arsa üzerine onaylı projeye uygun [KAT SAYISI] katlı yapıyı kendi malzeme ve işçiliğiyle inşa etmeyi taahhüt eder. Karşılığında arsa sahibi, [ORAN] oranında arsa payını yükleniciye devretmeyi kabul eder.

Madde 4 - Paylaşım
Arsa sahibine [BAĞIMSIZ BÖLÜM NUMARALARI], yükleniciye [BAĞIMSIZ BÖLÜM NUMARALARI] bağımsız bölümleri kalacaktır.

Madde 5 - Süre
Yüklenici, yapı ruhsatının alınmasından itibaren [AY] ay içinde yapıyı iskân alınmış olarak teslim etmekle yükümlüdür.

Madde 6 - Gecikme cezası
Teslimin gecikmesi halinde yüklenici, arsa sahibine geciken her ay için bağımsız bölüm başına [TUTAR] TL ödemekle yükümlüdür.

Madde 7 - Tapu devri
Arsa payları, inşaatın ilerleme oranına göre aşamalı olarak devredilir: [AŞAMALAR].

Madde 8 - Teminat
Yüklenici, sözleşme imzasında [TUTAR] TL tutarında banka teminat mektubu verecektir.

Madde 9 - Fesih
Yüklenicinin süresinde işe başlamaması veya işi terk etmesi halinde arsa sahibi sözleşmeyi feshedebilir.

Madde 10 - Uyuşmazlık
Uyuşmazlıklarda [İL] mahkemeleri ve icra daireleri yetkilidir.
${IMZA}`,
  },
];

// ---------------------------------------------------------------------------
// Hızlı inceleme: taahhütler, ödemeler, tarihler ve riskler
// ---------------------------------------------------------------------------

export type RiskLevel = 'yuksek' | 'orta' | 'dusuk';

export interface ContractAnalysis {
  obligations: { party: string; text: string }[];
  payments: { text: string; amounts: string[] }[];
  dates: string[];
  risks: { level: RiskLevel; title: string; note: string; quote: string }[];
}

const PARTY = /(Kiraya veren|Kiracı|Satıcı|Alıcı|İşveren|İşçi|Yüklenici|Arsa sahibi|Hizmet veren|Hizmet alan|Taraflar(?:dan (?:her )?biri)?|Taraf \d)/i;
const OBLIGATION = /(yükümlüdür|yükümlü olup|taahhüt eder|borçludur|ödeyecektir|edecektir|verecektir|zorundadır|ödemekle|teslim eder)/i;
const AMOUNT = /\d{1,3}(?:\.\d{3})*(?:,\d+)?\s*(?:TL|₺|USD|EUR|\$|€)|\[TUTAR\]\s*TL/g;
const DATE_TEXT = /\b\d{1,2}[./]\d{1,2}[./]\d{4}\b/g;

const RISK_RULES: { pattern: RegExp; level: RiskLevel; title: string; note: string }[] = [
  {
    pattern: /cezai şart/i,
    level: 'yuksek',
    title: 'Cezai şart',
    note: 'Tutarın orantılı olup olmadığına ve kimin aleyhine işlediğine bakın; aşırı cezai şart hâkimce indirilebilir.',
  },
  {
    pattern: /kefil|kefalet/i,
    level: 'yuksek',
    title: 'Kefalet',
    note: 'Kefaletin geçerliliği için azami miktar, tarih ve müteselsil kefalet sıfatının kefilin el yazısıyla yazılması gerekir; kontrol edin.',
  },
  {
    pattern: /sınırsız(?:\s+\S+){0,3}\s+sorumlu/i,
    level: 'yuksek',
    title: 'Sınırsız sorumluluk',
    note: 'Bir tarafın sorumluluğu sınırlanmamış; sorumluluk üst sınırı eklenmesini değerlendirin.',
  },
  {
    pattern: /(USD|EUR|döviz|\$|€)/,
    level: 'orta',
    title: 'Döviz cinsinden borç',
    note: 'Kur riski var; ödemenin hangi kurdan ve tarihte TL\'ye çevrileceği açık yazılmalı.',
  },
  {
    pattern: /tek taraflı/i,
    level: 'orta',
    title: 'Tek taraflı hak',
    note: 'Bir tarafa tek taraflı değişiklik ya da fesih hakkı tanınmış; dengeyi kontrol edin.',
  },
  {
    pattern: /(kendiliğinden|otomatik(?:\s+olarak)?)\s+(?:[^\s.]+\s+){0,3}(uzar|yenilen)/i,
    level: 'orta',
    title: 'Otomatik yenileme',
    note: 'Sözleşme kendiliğinden uzuyor; fesih bildirim süresini takvime ekleyin.',
  },
  {
    pattern: /rekabet yasağı|rekabet etmeme|münhasır/i,
    level: 'orta',
    title: 'Rekabet yasağı / münhasırlık',
    note: 'Süre, yer ve konu bakımından sınırlı olmalı; aşırı geniş yasaklar geçersiz sayılabilir.',
  },
  {
    pattern: /teminat mektubu|teminat/i,
    level: 'dusuk',
    title: 'Teminat',
    note: 'Teminatın tutarı, süresi ve iade şartları belirli olmalı.',
  },
];

const MISSING_RULES: { pattern: RegExp; level: RiskLevel; title: string; note: string }[] = [
  { pattern: /mücbir sebep/i, level: 'orta', title: 'Mücbir sebep maddesi yok', note: 'Deprem, salgın gibi hallerde yükümlülüklerin ne olacağı düzenlenmemiş.' },
  { pattern: /fesih|feshed/i, level: 'orta', title: 'Fesih maddesi yok', note: 'Sözleşmenin nasıl sona erdirileceği düzenlenmemiş.' },
  { pattern: /yetkili/i, level: 'dusuk', title: 'Yetkili mahkeme yok', note: 'Uyuşmazlıkta hangi yer mahkemesinin yetkili olacağı yazılmamış.' },
  { pattern: /gizli/i, level: 'dusuk', title: 'Gizlilik maddesi yok', note: 'Ticari bilgilerin korunması düzenlenmemiş.' },
];

function clauses(body: string): string[] {
  return body
    .split(/\n+|(?<=[.;])\s+(?=[A-ZÇĞİÖŞÜ])/)
    .map((s) => s.trim())
    .filter((s) => s.length > 8);
}

export function analyzeContract(body: string): ContractAnalysis {
  const parts = clauses(body);
  const obligations = parts
    .filter((c) => OBLIGATION.test(c))
    .map((c) => ({ party: c.match(PARTY)?.[1] ?? '', text: c }));
  const payments = parts
    .map((c) => ({ text: c, amounts: c.match(AMOUNT) ?? [] }))
    .filter((p) => p.amounts.length > 0);
  const dates = [...new Set(body.match(DATE_TEXT) ?? [])];
  const risks: ContractAnalysis['risks'] = [];
  for (const rule of RISK_RULES) {
    const quote = parts.find((c) => rule.pattern.test(c));
    if (quote) risks.push({ level: rule.level, title: rule.title, note: rule.note, quote });
  }
  if (body.trim().length > 200) {
    for (const rule of MISSING_RULES) {
      if (!rule.pattern.test(body)) risks.push({ level: rule.level, title: rule.title, note: rule.note, quote: '' });
    }
  }
  const order: Record<RiskLevel, number> = { yuksek: 0, orta: 1, dusuk: 2 };
  risks.sort((a, b) => order[a.level] - order[b.level]);
  return { obligations, payments, dates, risks };
}

// ---------------------------------------------------------------------------
// Kayıtlar
// ---------------------------------------------------------------------------

const STATUSES = ['taslak', 'yururlukte', 'sona_erdi'];

interface ContractInput {
  title?: string;
  kind?: string;
  parties?: string;
  body?: string;
  startDate?: string;
  endDate?: string;
  value?: number | string;
  status?: string;
  caseId?: number | null;
}

interface ContractRow {
  id: number;
  title: string;
  kind: string;
  parties: string;
  body: string;
  start_date: string;
  end_date: string;
  value_kurus: number;
  status: string;
  case_id: number | null;
  created_at: string;
}

function load(db: DB, user: User, id: number): ContractRow {
  const row = db.prepare('SELECT * FROM contracts WHERE id = ? AND office_id = ?').get(id, user.office_id) as
    | ContractRow
    | undefined;
  if (!row) throw new ApiError(404, 'Sözleşme bulunamadı.');
  return row;
}

export function listContracts(db: DB, user: User) {
  return db
    .prepare(
      `SELECT c.id, c.title, c.kind, c.parties, c.start_date, c.end_date, c.value_kurus, c.status, c.created_at,
        (SELECT COUNT(*) FROM contract_obligations o WHERE o.contract_id = c.id AND o.done = 0) AS open_obligations
       FROM contracts c WHERE c.office_id = ? ORDER BY c.id DESC`,
    )
    .all(user.office_id);
}

export function createContract(db: DB, user: User, input: ContractInput) {
  if (!input.title?.trim()) throw new ApiError(400, 'Sözleşme başlığı zorunludur.');
  const result = db
    .prepare(
      `INSERT INTO contracts (office_id, title, kind, parties, body, start_date, end_date, value_kurus, case_id, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      user.office_id,
      input.title.trim(),
      input.kind ?? '',
      input.parties ?? '',
      input.body ?? '',
      optionalDate(input.startDate, 'Başlangıç tarihi'),
      optionalDate(input.endDate, 'Bitiş tarihi'),
      toKurus(input.value, 'Sözleşme bedeli'),
      ownedCaseId(db, user.office_id, input.caseId),
      user.id,
    );
  return getContract(db, user, Number(result.lastInsertRowid));
}

export function updateContract(db: DB, user: User, id: number, input: ContractInput) {
  const c = load(db, user, id);
  if (input.status !== undefined && !STATUSES.includes(input.status)) throw new ApiError(400, 'Geçersiz durum.');
  db.prepare(
    `UPDATE contracts SET title = ?, kind = ?, parties = ?, body = ?, start_date = ?, end_date = ?, value_kurus = ?, status = ?
     WHERE id = ?`,
  ).run(
    input.title?.trim() || c.title,
    input.kind ?? c.kind,
    input.parties ?? c.parties,
    input.body ?? c.body,
    input.startDate !== undefined ? optionalDate(input.startDate, 'Başlangıç tarihi') : c.start_date,
    input.endDate !== undefined ? optionalDate(input.endDate, 'Bitiş tarihi') : c.end_date,
    input.value !== undefined ? toKurus(input.value, 'Sözleşme bedeli') : c.value_kurus,
    input.status ?? c.status,
    id,
  );
  return getContract(db, user, id);
}

export function getContract(db: DB, user: User, id: number) {
  const c = load(db, user, id);
  const obligations = db
    .prepare('SELECT * FROM contract_obligations WHERE contract_id = ? ORDER BY done, due_date, id')
    .all(id);
  return { ...c, obligations, analysis: analyzeContract(c.body) };
}

export function addObligation(
  db: DB,
  user: User,
  contractId: number,
  input: { party?: string; text: string; dueDate?: string; amount?: number | string },
) {
  load(db, user, contractId);
  if (!input.text?.trim()) throw new ApiError(400, 'Taahhüt metni boş.');
  db.prepare(
    'INSERT INTO contract_obligations (contract_id, party, text, due_date, amount_kurus) VALUES (?, ?, ?, ?, ?)',
  ).run(contractId, input.party ?? '', input.text.trim(), optionalDate(input.dueDate, 'Son tarih'), toKurus(input.amount));
  return getContract(db, user, contractId);
}

export function setObligationDone(db: DB, user: User, obligationId: number, done: boolean) {
  const row = db
    .prepare(
      'SELECT o.contract_id FROM contract_obligations o JOIN contracts c ON c.id = o.contract_id WHERE o.id = ? AND c.office_id = ?',
    )
    .get(obligationId, user.office_id) as { contract_id: number } | undefined;
  if (!row) throw new ApiError(404, 'Taahhüt bulunamadı.');
  db.prepare('UPDATE contract_obligations SET done = ? WHERE id = ?').run(done ? 1 : 0, obligationId);
  return getContract(db, user, row.contract_id);
}
