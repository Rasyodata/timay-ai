import type { User } from './auth.ts';
import { getContract, updateContract } from './contracts.ts';
import type { DB } from './db.ts';
import { changeSummary, diffWords } from './diff.ts';
import { buildDocx, readDocx } from './docx.ts';
import { ApiError } from './errors.ts';
import { precedentRisk, precedentsFor, type Party } from './precedents.ts';

/*
 * Sözleşme zırhı: kural bankası (playbook), onaylı madde kütüphanesi, mevzuat denetimi,
 * risk puanı, versiyonlar ve gizli değişiklik avcısı, imza sırası ve imza sonrası takvim.
 * Okuma kurallara dayanır; yapay zekâ bağlandığında anlamsal okuma bunun üzerine eklenir.
 */

// ---------------------------------------------------------------------------
// Faz 1a: Kural bankası (playbook)
// ---------------------------------------------------------------------------

export type Side = 'arsa_sahibi' | 'yuklenici' | 'genel';

export interface Playbook {
  /** Uyuşmazlıkta kabul edilen yer mahkemesi. */
  courtCity: string;
  allowArbitration: boolean;
  /** Bize karşı işleyebilecek en yüksek cezai şart (TL). */
  maxPenalty: number;
  requireConfidentiality: boolean;
  requireForceMajeure: boolean;
  requireLiabilityCap: boolean;
  /** Kat karşılığı: arsa sahibine kalacak en düşük pay (%). */
  minOwnerShare: number;
  /** Kat karşılığı: kabul edilen en uzun teslim süresi (ay). */
  maxDeliveryMonths: number;
  /** Kat karşılığı: bağımsız bölüm başına aylık en düşük gecikme tazminatı (TL). */
  minDelayPenalty: number;
  requireGuarantee: boolean;
  stagedTitleTransfer: boolean;
  requireNotary: boolean;
  requireInsurance: boolean;
  forbidAssignment: boolean;
  requireIskan: boolean;
}

export const DEFAULT_PLAYBOOK: Playbook = {
  courtCity: 'İstanbul',
  allowArbitration: false,
  maxPenalty: 1_000_000,
  requireConfidentiality: false,
  requireForceMajeure: true,
  requireLiabilityCap: true,
  minOwnerShare: 50,
  maxDeliveryMonths: 24,
  minDelayPenalty: 20_000,
  requireGuarantee: true,
  stagedTitleTransfer: true,
  requireNotary: true,
  requireInsurance: true,
  forbidAssignment: true,
  requireIskan: true,
};

export function getPlaybook(db: DB, user: User): Playbook {
  const row = db.prepare('SELECT params FROM playbooks WHERE office_id = ?').get(user.office_id) as { params: string } | undefined;
  return { ...DEFAULT_PLAYBOOK, ...(row ? (JSON.parse(row.params) as Partial<Playbook>) : {}) };
}

export function savePlaybook(db: DB, user: User, input: Partial<Playbook>) {
  if (user.role !== 'avukat') throw new ApiError(403, 'Kural bankasını yalnızca avukatlar değiştirebilir.');
  const current = getPlaybook(db, user);
  const next = { ...current } as Record<string, unknown>;
  for (const [key, def] of Object.entries(DEFAULT_PLAYBOOK)) {
    const v = (input as Record<string, unknown>)[key];
    if (v === undefined) continue;
    if (typeof def === 'boolean') next[key] = Boolean(v);
    else if (typeof def === 'number') {
      const n = Number(String(v).replace(/\./g, '').replace(',', '.'));
      if (!Number.isFinite(n) || n < 0) throw new ApiError(400, 'Kural bankasında geçersiz sayı var.');
      next[key] = n;
    } else next[key] = String(v).trim();
  }
  db.prepare(
    `INSERT INTO playbooks (office_id, params, updated_by) VALUES (?, ?, ?)
     ON CONFLICT (office_id) DO UPDATE SET params = excluded.params, updated_by = excluded.updated_by, updated_at = datetime('now')`,
  ).run(user.office_id, JSON.stringify(next), user.id);
  return getPlaybook(db, user);
}

// ---------------------------------------------------------------------------
// Faz 1b: Onaylı madde kütüphanesi
// ---------------------------------------------------------------------------

export const TOPICS: Record<string, string> = {
  pay: 'Paylaşım oranı',
  teslim: 'Teslim süresi',
  gecikme: 'Gecikme tazminatı',
  teminat: 'Teminat',
  tapu: 'Tapu devri',
  iskan: 'İskân ve teslim',
  noter: 'Şekil (noter)',
  devir: 'Devir yasağı',
  sigorta: 'Sigorta',
  ayip: 'Ayıp ve garanti',
  proje: 'Proje değişikliği',
  vergi: 'Vergi ve harçlar',
  yetki: 'Yetkili mahkeme',
  sorumluluk: 'Sorumluluk sınırı',
  cezai: 'Cezai şart',
  mucbir: 'Mücbir sebep',
  fesih: 'Fesih',
  gizlilik: 'Gizlilik',
  kvkk: 'Kişisel veriler',
  faiz: 'Faiz',
};

const SEED_CLAUSES: { kind: string; topic: string; title: string; body: string }[] = [
  {
    kind: 'kat-karsiligi',
    topic: 'teslim',
    title: 'Teslim süresi: ruhsattan itibaren 24 ay, iskânlı teslim',
    body: 'Yüklenici, yapı ruhsatının alındığı tarihten itibaren en geç 24 (yirmi dört) ay içinde yapıyı tüm ortak alanlarıyla birlikte, yapı kullanma izin belgesi (iskân) alınmış, eksiksiz ve projesine uygun olarak arsa sahibine teslim etmekle yükümlüdür. Mücbir sebepler dışında bu süre uzatılamaz.',
  },
  {
    kind: 'kat-karsiligi',
    topic: 'gecikme',
    title: 'Gecikme tazminatı: bağımsız bölüm başına aylık rayiç kira',
    body: 'Teslimin gecikmesi halinde yüklenici, arsa sahibine düşen her bağımsız bölüm için geciken her ay bakımından aylık [TUTAR] TL gecikme tazminatı ödemekle yükümlüdür. Tutar her yıl TÜFE oranında artırılır. Bu tazminat, arsa sahibinin aşan zararını isteme ve sözleşmeden dönme hakkını ortadan kaldırmaz.',
  },
  {
    kind: 'kat-karsiligi',
    topic: 'teminat',
    title: 'Kesin teminat mektubu ve iade şartı',
    body: 'Yüklenici, sözleşmenin imzası anında süresiz ve kesin, [TUTAR] TL tutarında banka teminat mektubu verecektir. Teminat mektubu, yapı kullanma izin belgesinin alınması ve arsa sahibine düşen bağımsız bölümlerin eksiksiz tesliminden sonra iade edilir.',
  },
  {
    kind: 'kat-karsiligi',
    topic: 'tapu',
    title: 'Aşamalı tapu devri (ilerleme oranına göre)',
    body: 'Yükleniciye düşecek arsa payları peşin devredilmez; inşaatın fiziki ilerleme oranına göre aşamalı olarak devredilir: kaba inşaatın tamamlanmasında %30, ince inşaatın tamamlanmasında %30, yapı kullanma izin belgesinin alınması ve teslimde kalan %40. İlerleme oranı, tarafların birlikte seçeceği yapı denetim kuruluşu raporuyla belirlenir.',
  },
  {
    kind: 'kat-karsiligi',
    topic: 'iskan',
    title: 'İskân ve tüm ruhsat masrafları yükleniciye ait',
    body: 'Yapı ruhsatı, yapı denetim, iskân ve abonelik dahil tüm resmi işlemler ile bunların masraf ve harçları yükleniciye aittir. Yapı kullanma izin belgesi alınmadan teslim yapılmış sayılmaz.',
  },
  {
    kind: 'kat-karsiligi',
    topic: 'noter',
    title: 'Noterde düzenleme şeklinde yapılma',
    body: 'Bu sözleşme, Türk Medeni Kanunu m. 706, Türk Borçlar Kanunu m. 237 ve Tapu Kanunu m. 26 uyarınca noterde düzenleme şeklinde yapılmış olup tapu kütüğüne şerh verilecektir.',
  },
  {
    kind: 'kat-karsiligi',
    topic: 'devir',
    title: 'Yüklenicinin sözleşmeyi devredememesi',
    body: 'Yüklenici, arsa sahibinin noterden onaylı yazılı izni olmadan bu sözleşmeden doğan hak ve borçlarını kısmen veya tamamen üçüncü kişilere devredemez, işi başka bir yükleniciye bırakamaz. Bu yasağa aykırılık haklı fesih sebebidir.',
  },
  {
    kind: 'kat-karsiligi',
    topic: 'sigorta',
    title: 'İnşaat all-risk ve üçüncü şahıs sigortası',
    body: 'Yüklenici, inşaat süresince yapıyı arsa sahibi lehine dain-i mürtehin kaydıyla inşaat all-risk sigortası ile, üçüncü kişilere verilebilecek zararları ise mali sorumluluk sigortası ile sigortalatmakla yükümlüdür.',
  },
  {
    kind: 'kat-karsiligi',
    topic: 'ayip',
    title: 'Ayıp sorumluluğu ve yapı denetimi',
    body: 'Yüklenici, yapının 2018 Türkiye Bina Deprem Yönetmeliği, imar mevzuatı ve onaylı projeye uygun yapılmasından sorumludur. Teslimden sonra ortaya çıkan gizli ayıplardan Türk Borçlar Kanunu m. 478 uyarınca sorumluluğu devam eder.',
  },
  {
    kind: 'kat-karsiligi',
    topic: 'proje',
    title: 'Proje değişikliği arsa sahibinin onayına bağlı',
    body: 'Mimari, statik ve tesisat projelerinde yapılacak her türlü değişiklik arsa sahibinin yazılı onayına bağlıdır. Arsa sahibine düşen bağımsız bölümlerin yüzölçümü, konumu ve niteliği onaysız değiştirilemez.',
  },
  {
    kind: 'kat-karsiligi',
    topic: 'vergi',
    title: 'Vergi, harç ve masraflar',
    body: 'Sözleşmenin noter masrafları ile yükleniciye düşen payların devrinden doğan tapu harçları ve vergiler yükleniciye aittir. Arsa sahibine düşen bağımsız bölümlerin teslimine kadar doğan emlak vergisi dışındaki tüm vergi ve harçlar yükleniciye aittir.',
  },
  {
    kind: 'kat-karsiligi',
    topic: 'fesih',
    title: 'Arsa sahibinin fesih ve dönme hakkı',
    body: 'Yüklenicinin süresinde işe başlamaması, işi 30 günden fazla durdurması, işi terk etmesi veya teslim süresini aşması halinde arsa sahibi, noter ihtarıyla verilecek 30 günlük süre sonunda sözleşmeden dönebilir. Bu halde yükleniciye devredilmiş paylar, yapılan imalatın rayiç bedeli mahsup edilerek iade edilir.',
  },
  {
    kind: 'genel',
    topic: 'yetki',
    title: 'İstanbul mahkemeleri yetkili, tazminat sözleşme bedeliyle sınırlı',
    body: 'Bu sözleşmeden doğacak uyuşmazlıklarda İstanbul (Merkez) Mahkemeleri ve İcra Daireleri yetkilidir. Taraflardan birinin diğerine karşı tazminat sorumluluğu, kast ve ağır ihmal halleri saklı kalmak kaydıyla toplam sözleşme bedelini aşamaz.',
  },
  {
    kind: 'genel',
    topic: 'sorumluluk',
    title: 'Sorumluluk üst sınırı',
    body: 'Tarafların bu sözleşmeden doğan toplam tazminat sorumluluğu, kast ve ağır ihmal halleri hariç olmak üzere sözleşme bedeliyle sınırlıdır. Dolaylı zararlar ve kâr kaybı talep edilemez.',
  },
  {
    kind: 'genel',
    topic: 'cezai',
    title: 'Makul cezai şart',
    body: 'Sözleşmeye aykırılık halinde aykırı davranan taraf, diğer tarafa [TUTAR] TL cezai şart öder. Cezai şart, Türk Borçlar Kanunu m. 182 uyarınca hakim tarafından indirilebilir; aşan zararın istenmesi saklıdır.',
  },
  {
    kind: 'genel',
    topic: 'mucbir',
    title: 'Mücbir sebep',
    body: 'Deprem, sel, yangın, salgın, savaş ve resmi makamların engelleyici kararları gibi tarafların kontrolü dışındaki olaylar mücbir sebep sayılır. Mücbir sebep süresince yükümlülükler askıya alınır; mücbir sebep 90 günü aşarsa taraflardan her biri sözleşmeyi tazminatsız feshedebilir. Mücbir sebebi ileri süren taraf durumu 7 gün içinde yazılı olarak bildirmek zorundadır.',
  },
  {
    kind: 'genel',
    topic: 'gizlilik',
    title: 'Karşılıklı gizlilik',
    body: 'Taraflar, sözleşme kapsamında öğrendikleri ticari, teknik ve mali bilgileri sözleşme süresince ve sona ermesinden sonra 5 yıl boyunca gizli tutmayı taahhüt eder.',
  },
  {
    kind: 'genel',
    topic: 'kvkk',
    title: 'Kişisel verilerin korunması',
    body: 'Taraflar, sözleşme kapsamında işledikleri kişisel verileri 6698 sayılı Kişisel Verilerin Korunması Kanunu’na uygun olarak işlemeyi, yalnızca sözleşmenin ifası amacıyla kullanmayı ve gerekli teknik ve idari tedbirleri almayı taahhüt eder.',
  },
  {
    kind: 'genel',
    topic: 'faiz',
    title: 'Temerrüt faizi',
    body: 'Geciken ödemeler için temerrüt tarihinden itibaren 3095 sayılı Kanun uyarınca yürürlükteki yasal faiz (ticari işlerde avans faizi) uygulanır.',
  },
];

function seedLibrary(db: DB, officeId: number) {
  const has = db.prepare('SELECT 1 FROM clause_library WHERE office_id = ? LIMIT 1').get(officeId);
  if (has) return;
  const insert = db.prepare('INSERT INTO clause_library (office_id, kind, topic, title, body, approved) VALUES (?, ?, ?, ?, ?, 1)');
  db.transaction(() => {
    for (const c of SEED_CLAUSES) insert.run(officeId, c.kind, c.topic, c.title, c.body);
  })();
}

export function listClauses(db: DB, user: User, filter: { kind?: string; topic?: string } = {}) {
  seedLibrary(db, user.office_id);
  const where = ['l.office_id = ?'];
  const params: unknown[] = [user.office_id];
  if (filter.kind) {
    where.push("(l.kind = ? OR l.kind = 'genel')");
    params.push(filter.kind);
  }
  if (filter.topic) {
    where.push('l.topic = ?');
    params.push(filter.topic);
  }
  return db
    .prepare(
      `SELECT l.id, l.kind, l.topic, l.title, l.body, l.approved, l.created_at, u.name AS approved_by_name
       FROM clause_library l LEFT JOIN users u ON u.id = l.approved_by WHERE ${where.join(' AND ')} ORDER BY l.topic, l.id`,
    )
    .all(...params) as { id: number; kind: string; topic: string; title: string; body: string }[];
}

export function addClause(db: DB, user: User, input: { kind?: string; topic?: string; title?: string; body?: string }) {
  if (user.role !== 'avukat') throw new ApiError(403, 'Kütüphaneye yalnızca avukatlar madde ekleyebilir.');
  if (!input.title?.trim() || !input.body?.trim()) throw new ApiError(400, 'Madde başlığı ve metni zorunludur.');
  if (!input.topic || !TOPICS[input.topic]) throw new ApiError(400, 'Geçerli bir konu seçin.');
  seedLibrary(db, user.office_id);
  const r = db
    .prepare('INSERT INTO clause_library (office_id, kind, topic, title, body, approved, approved_by) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(user.office_id, input.kind || 'genel', input.topic, input.title.trim(), input.body.trim(), user.can_approve ? 1 : 0, user.can_approve ? user.id : null);
  return db.prepare('SELECT * FROM clause_library WHERE id = ?').get(r.lastInsertRowid);
}

export function deleteClause(db: DB, user: User, id: number) {
  if (user.role !== 'avukat') throw new ApiError(403, 'Kütüphaneden yalnızca avukatlar madde silebilir.');
  const r = db.prepare('DELETE FROM clause_library WHERE id = ? AND office_id = ?').run(id, user.office_id);
  if (!r.changes) throw new ApiError(404, 'Madde bulunamadı.');
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Faz 1c: Mevzuat denetimi (değişmiş ya da yürürlükten kalkmış atıflar)
// ---------------------------------------------------------------------------

const MEVZUAT: { pattern: RegExp; kinds?: string[]; title: string; note: string; topic?: string; severity: Severity }[] = [
  {
    pattern: /818\s*sayılı/i,
    title: 'Yürürlükten kalkmış kanuna atıf: 818 sayılı Borçlar Kanunu',
    note: '818 sayılı Borçlar Kanunu 1.7.2012’de yürürlükten kalktı. 6098 sayılı Türk Borçlar Kanunu’na atıf yapın.',
    severity: 'orta',
  },
  {
    pattern: /6762\s*sayılı/i,
    title: 'Yürürlükten kalkmış kanuna atıf: 6762 sayılı TTK',
    note: '6762 sayılı Türk Ticaret Kanunu yerini 6102 sayılı Türk Ticaret Kanunu’na bıraktı.',
    severity: 'orta',
  },
  {
    pattern: /743\s*sayılı/i,
    title: 'Yürürlükten kalkmış kanuna atıf: 743 sayılı Medeni Kanun',
    note: '743 sayılı Türk Kanunu Medenisi yerini 4721 sayılı Türk Medeni Kanunu’na bıraktı.',
    severity: 'orta',
  },
  {
    pattern: /1086\s*sayılı|\bHUMK\b/i,
    title: 'Yürürlükten kalkmış kanuna atıf: HUMK',
    note: '1086 sayılı HUMK yerini 6100 sayılı Hukuk Muhakemeleri Kanunu’na bıraktı.',
    severity: 'orta',
  },
  {
    pattern: /4077\s*sayılı/i,
    title: 'Yürürlükten kalkmış kanuna atıf: 4077 sayılı Tüketici Kanunu',
    note: '4077 sayılı Kanun yerini 6502 sayılı Tüketicinin Korunması Hakkında Kanun’a bıraktı.',
    severity: 'orta',
  },
  {
    pattern: /Yeni Türk Lirası|\bYTL\b/,
    title: 'Eski para birimi: YTL',
    note: '2009’dan bu yana para birimi Türk Lirası (TL) olarak yazılır.',
    severity: 'dusuk',
  },
  {
    pattern: /(yıllık\s*)?(%\s*9|yüzde\s*(9|dokuz))\b[^.\n]{0,30}(yasal|kanuni)\s+faiz|(yasal|kanuni)\s+faiz[^.\n]{0,30}(%\s*9|yüzde\s*(9|dokuz))\b/i,
    title: 'Güncel olmayan yasal faiz oranı (%9)',
    note: 'Yasal faiz oranı 1.6.2024’ten bu yana yıllık %24’tür (3095 sayılı Kanun m. 1). Sabit oran yerine “yürürlükteki yasal faiz” ifadesini kullanın; güncel oranı kontrol edin.',
    topic: 'faiz',
    severity: 'orta',
  },
  {
    pattern: /2007\s+(Deprem Yönetmeliği|tarihli deprem)|Deprem Bölgelerinde Yapılacak Binalar/i,
    kinds: ['kat-karsiligi'],
    title: 'Eski deprem yönetmeliğine atıf',
    note: '1.1.2019’dan itibaren “Türkiye Bina Deprem Yönetmeliği” (2018) uygulanır.',
    topic: 'ayip',
    severity: 'yuksek',
  },
  {
    pattern: /ÜFE|üretici fiyat/i,
    kinds: ['kira-konut'],
    title: 'Kira artışında ÜFE kullanılmış',
    note: 'TBK m. 344’e göre konut ve çatılı işyeri kiralarında artış, önceki kira yılının TÜFE 12 aylık ortalamasını aşamaz.',
    severity: 'orta',
  },
  {
    pattern: /(USD|EUR|döviz|\$|€)/,
    kinds: ['kira-konut'],
    title: 'Konut kirasında döviz',
    note: '32 sayılı Karar uyarınca Türkiye’de yerleşik kişiler arasındaki konut kira sözleşmelerinde bedel dövizle kararlaştırılamaz.',
    severity: 'yuksek',
  },
];

// ---------------------------------------------------------------------------
// Faz 2: İnceleme ve risk puanı
// ---------------------------------------------------------------------------

export type Severity = 'yuksek' | 'orta' | 'dusuk';
export type Verdict = 'lehte' | 'aleyhte' | 'eksik' | 'mevzuat';

export interface Finding {
  key: string;
  topic: string;
  verdict: Verdict;
  severity: Severity;
  title: string;
  note: string;
  /** Sözleşmede ilgili cümle (yoksa boş). */
  quote: string;
}

const WEIGHT: Record<Severity, number> = { yuksek: 22, orta: 10, dusuk: 4 };

function sentences(body: string) {
  return body
    .split(/\n+|(?<=[.;:])\s+(?=[A-ZÇĞİÖŞÜ0-9])/)
    .map((s) => s.trim())
    .filter((s) => s.length > 5);
}

/** "1.500.000 TL", "1.500.000,50 TL", "20 bin TL" → TL sayısı. */
export function parseTL(s: string): number | null {
  const m = /(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d+))?\s*(bin|milyon)?\s*(?:TL|₺|Türk Lirası)/i.exec(s);
  if (!m) return null;
  let n = Number(m[1].replace(/\./g, '') + (m[2] ? `.${m[2]}` : ''));
  if (m[3]?.toLowerCase() === 'bin') n *= 1_000;
  if (m[3]?.toLowerCase() === 'milyon') n *= 1_000_000;
  return n;
}

const tr = (s: string) => s.toLocaleLowerCase('tr');

/** Sözleşmenin hangi tarafın lehine olduğunu kural bankasına göre puanlar. */
export function reviewText(body: string, kind: string, side: Side, pb: Playbook) {
  const list = sentences(body);
  const findings: Finding[] = [];
  const find = (re: RegExp) => list.find((s) => re.test(s)) ?? '';
  const add = (f: Finding) => findings.push(f);
  const forOwner = side !== 'yuklenici';
  const isKat = kind === 'kat-karsiligi';
  // Kat karşılığında bir hüküm arsa sahibine yararsa bizim taraf arsa sahibiyse lehtedir.
  const favour = (ownerFriendly: boolean): Verdict => (ownerFriendly === forOwner ? 'lehte' : 'aleyhte');

  if (isKat) {
    // Paylaşım oranı
    for (const s of list) {
      const m = /(?:%\s*(\d{1,2}(?:[.,]\d+)?)|yüzde\s*(\d{1,2}(?:[.,]\d+)?))/i.exec(s);
      if (!m || !/arsa pay|pay|oran|bağımsız bölüm/i.test(s)) continue;
      const pct = Number((m[1] ?? m[2]).replace(',', '.'));
      let owner: number | null = null;
      if (/arsa sahibine|arsa sahibinin pay|arsa sahibine ait|arsa sahibine kalacak/i.test(s)) owner = pct;
      else if (/yükleniciye|yüklenicinin pay|yükleniciye ait|yükleniciye kalacak/i.test(s)) owner = 100 - pct;
      if (owner === null) continue;
      const ok = owner >= pb.minOwnerShare;
      add({
        key: 'pay',
        topic: 'pay',
        verdict: favour(ok),
        severity: ok ? 'dusuk' : 'yuksek',
        title: `Arsa sahibinin payı %${owner}`,
        note: ok
          ? `Kural bankasındaki en düşük pay (%${pb.minOwnerShare}) karşılanıyor.`
          : `Kural bankasına göre arsa sahibine en az %${pb.minOwnerShare} kalmalı.`,
        quote: s,
      });
      break;
    }

    // Teslim süresi
    const teslim = list.find((s) => /teslim/i.test(s) && /(\d+)\s*(?:\([^)]*\)\s*)?(ay|gün|yıl)\b/i.test(s));
    if (teslim) {
      const m = /(\d+)\s*(?:\([^)]*\)\s*)?(ay|gün|yıl)\b/i.exec(teslim)!;
      const months = m[2].toLowerCase() === 'ay' ? Number(m[1]) : m[2].toLowerCase() === 'yıl' ? Number(m[1]) * 12 : Number(m[1]) / 30;
      const ok = months <= pb.maxDeliveryMonths;
      add({
        key: 'teslim',
        topic: 'teslim',
        verdict: favour(ok),
        severity: ok ? 'dusuk' : 'yuksek',
        title: `Teslim süresi ${m[1]} ${m[2]}`,
        note: ok
          ? `Kural bankasındaki en uzun süre (${pb.maxDeliveryMonths} ay) içinde.`
          : `Kural bankasına göre teslim en geç ${pb.maxDeliveryMonths} ay olmalı; süre uzadıkça arsa sahibinin riski artar.`,
        quote: teslim,
      });
    } else if (/teslim/i.test(body) || body.length > 300) {
      add({ key: 'teslim', topic: 'teslim', verdict: 'eksik', severity: 'yuksek', title: 'Teslim süresi belirsiz', note: 'Yapının ne zamana kadar teslim edileceği sayıyla yazılmamış.', quote: find(/teslim/i) });
    }

    // Gecikme tazminatı
    const gecikme = list.find((x) => /gecik/i.test(x) && /(TL|₺|kira|tazminat|cezai)/i.test(x)) ?? '';
    if (gecikme) {
      const amount = parseTL(gecikme);
      const low = amount !== null && amount < pb.minDelayPenalty;
      add({
        key: 'gecikme',
        topic: 'gecikme',
        verdict: favour(!low),
        severity: low ? 'orta' : 'dusuk',
        title: amount !== null ? `Gecikme tazminatı ${amount.toLocaleString('tr-TR')} TL` : 'Gecikme tazminatı var',
        note: low
          ? `Kural bankasına göre bağımsız bölüm başına aylık en az ${pb.minDelayPenalty.toLocaleString('tr-TR')} TL olmalı.`
          : 'Teslim gecikirse arsa sahibi tazminat alabiliyor.',
        quote: gecikme,
      });
    } else if (pb.minDelayPenalty > 0) {
      add({ key: 'gecikme', topic: 'gecikme', verdict: forOwner ? 'eksik' : 'lehte', severity: forOwner ? 'yuksek' : 'dusuk', title: 'Gecikme tazminatı yok', note: 'Teslim gecikirse arsa sahibine ödenecek tazminat düzenlenmemiş.', quote: '' });
    }

    // Teminat
    const teminat = find(/teminat/i);
    if (teminat) add({ key: 'teminat', topic: 'teminat', verdict: favour(true), severity: 'dusuk', title: 'Teminat verilmiş', note: 'Yüklenicinin edimini güvenceye alan teminat düzenlenmiş; tutarı ve iade şartını kontrol edin.', quote: teminat });
    else if (pb.requireGuarantee) add({ key: 'teminat', topic: 'teminat', verdict: forOwner ? 'eksik' : 'lehte', severity: forOwner ? 'yuksek' : 'dusuk', title: 'Teminat yok', note: 'Yüklenici işi bırakırsa arsa sahibinin başvuracağı bir teminat yok.', quote: '' });

    // Tapu devri
    const tapu = find(/tapu|arsa pay(ı|larının) devr/i);
    const pesin = /(imza|sözleşme)\s*(tarihinde|ile birlikte|anında)[^.]{0,80}(tapu|devr)|(tapu|devr)[^.]{0,80}(peşin|derhal|imza tarihinde|imza anında)/i.test(body);
    const asamali = /aşamalı|ilerleme (oranına|durumuna|seviyesine)|seviyesine göre|tamamlanmasında %/i.test(body);
    if (pesin) add({ key: 'tapu', topic: 'tapu', verdict: favour(false), severity: 'yuksek', title: 'Tapu peşin devrediliyor', note: 'Arsa payı inşaat başlamadan devredilirse yüklenici işi bırakınca arsa sahibi payını geri almakta zorlanır.', quote: find(/peşin|derhal|imza tarihinde|imza anında/i) || tapu });
    else if (asamali) add({ key: 'tapu', topic: 'tapu', verdict: favour(true), severity: 'dusuk', title: 'Tapu aşamalı devrediliyor', note: 'Arsa payları inşaat ilerledikçe devrediliyor.', quote: find(/aşamalı|ilerleme|tamamlanmasında/i) });
    else if (pb.stagedTitleTransfer) add({ key: 'tapu', topic: 'tapu', verdict: forOwner ? 'eksik' : 'lehte', severity: 'orta', title: 'Tapu devrinin zamanı belirsiz', note: 'Arsa paylarının ne zaman devredileceği inşaatın ilerlemesine bağlanmamış.', quote: tapu });

    // İskân
    if (/iskân|iskan|yapı kullanma izn/i.test(body)) add({ key: 'iskan', topic: 'iskan', verdict: favour(true), severity: 'dusuk', title: 'İskânlı teslim', note: 'Teslim yapı kullanma izin belgesine bağlanmış.', quote: find(/iskân|iskan|yapı kullanma izn/i) });
    else if (pb.requireIskan) add({ key: 'iskan', topic: 'iskan', verdict: forOwner ? 'eksik' : 'lehte', severity: 'orta', title: 'İskân şartı yok', note: 'Teslimin iskân alınmış olarak yapılacağı yazılmamış.', quote: '' });

    // Şekil
    if (pb.requireNotary && !/noter/i.test(body)) {
      add({ key: 'noter', topic: 'noter', verdict: 'eksik', severity: 'yuksek', title: 'Noterde düzenleme şekli yok', note: 'Kat karşılığı inşaat sözleşmesi taşınmaz devri borcu içerdiğinden resmi şekilde (noterde düzenleme şeklinde) yapılmazsa geçersiz olabilir (TMK 706, TBK 237, Tapu K. 26).', quote: '' });
    }

    // Devir
    const devir = list.find((x) => /devred|devret|alt yüklenici|başkasına bırak/i.test(x) && !/tapu|arsa pay/i.test(x)) ?? '';
    const yasak = /devred(e)?mez|devredilemez|devretmeyecek|bırakamaz|izni olmadan[^.]{0,60}devred/i.test(devir);
    if (devir) {
      add({ key: 'devir', topic: 'devir', verdict: favour(yasak), severity: yasak ? 'dusuk' : 'orta', title: yasak ? 'Yüklenici sözleşmeyi devredemez' : 'Yüklenici sözleşmeyi devredebilir', note: yasak ? 'Kişisel ifa güvence altında.' : 'Yüklenici işi arsa sahibinin onayı olmadan başkasına devredebiliyor.', quote: devir });
    } else if (pb.forbidAssignment) {
      add({ key: 'devir', topic: 'devir', verdict: forOwner ? 'eksik' : 'lehte', severity: 'orta', title: 'Devir yasağı yok', note: 'Yüklenicinin sözleşmeyi başkasına devredemeyeceği yazılmamış.', quote: '' });
    }

    if (pb.requireInsurance && !/sigorta/i.test(body)) add({ key: 'sigorta', topic: 'sigorta', verdict: 'eksik', severity: 'orta', title: 'Sigorta yok', note: 'İnşaat süresince yapı ve üçüncü kişi zararları sigortalanmamış.', quote: '' });
    if (!/proje/i.test(body) || !/onay/i.test(find(/proje/i))) add({ key: 'proje', topic: 'proje', verdict: forOwner ? 'eksik' : 'lehte', severity: 'dusuk', title: 'Proje değişikliği serbest', note: 'Proje değişikliklerinin arsa sahibinin onayına bağlı olduğu yazılmamış.', quote: find(/proje/i) });
    if (!/ayıp|garanti|deprem yönetmeli/i.test(body)) add({ key: 'ayip', topic: 'ayip', verdict: 'eksik', severity: 'orta', title: 'Ayıp ve deprem yönetmeliği hükmü yok', note: 'Yapının deprem yönetmeliğine uygunluğu ve gizli ayıplardan sorumluluk düzenlenmemiş.', quote: '' });
    if (!/vergi|harç/i.test(body)) add({ key: 'vergi', topic: 'vergi', verdict: 'eksik', severity: 'dusuk', title: 'Vergi ve harçlar belirsiz', note: 'Tapu harçları ve vergilerin kime ait olduğu yazılmamış.', quote: '' });
  }

  // Genel hükümler (tüm sözleşmeler)
  const yetki = find(/yetkili|tahkim|mahkemeleri/i);
  if (/(Londra|London|Paris|Cenevre|Geneva|New York|ICC\b|LCIA|yabancı mahkeme)/i.test(body)) {
    add({ key: 'yetki', topic: 'yetki', verdict: 'aleyhte', severity: 'yuksek', title: 'Yabancı yer mahkemesi / tahkim', note: `Kural bankasına göre uyuşmazlıklar ${pb.courtCity} mahkemelerinde görülmeli. Yurt dışında dava ciddi masraf ve risk demektir.`, quote: find(/Londra|London|Paris|Cenevre|Geneva|New York|ICC|LCIA|yabancı/i) });
  } else if (/tahkim/i.test(body) && !pb.allowArbitration) {
    add({ key: 'yetki', topic: 'yetki', verdict: 'aleyhte', severity: 'orta', title: 'Tahkim şartı', note: 'Kural bankası tahkime izin vermiyor; devlet mahkemesi yetkisi önerin.', quote: find(/tahkim/i) });
  } else if (yetki) {
    const city = /([A-ZÇĞİÖŞÜ][a-zçğıöşü]+)(?:\s*\([^)]*\))?\s+(?:Mahkemeleri|mahkemeleri)/.exec(yetki)?.[1];
    if (/\[İL\]/.test(yetki)) add({ key: 'yetki', topic: 'yetki', verdict: 'eksik', severity: 'dusuk', title: 'Yetkili mahkeme doldurulmamış', note: 'Yetkili yer boş bırakılmış.', quote: yetki });
    else if (city && tr(city) !== tr(pb.courtCity)) add({ key: 'yetki', topic: 'yetki', verdict: 'aleyhte', severity: 'dusuk', title: `${city} mahkemeleri yetkili`, note: `Kural bankası ${pb.courtCity} mahkemelerini öngörüyor.`, quote: yetki });
    else if (city) add({ key: 'yetki', topic: 'yetki', verdict: 'lehte', severity: 'dusuk', title: `${city} mahkemeleri yetkili`, note: 'Kural bankasıyla uyumlu.', quote: yetki });
  }

  if (/sınırsız(?:\s+\S+){0,3}\s+(sorumlu|tazminat)|tazminat(ın)?\s+(üst\s+)?sınır(ı)?\s+(yoktur|bulunmamaktadır|olmaksızın)|sınır olmaksızın/i.test(body)) {
    add({ key: 'sorumluluk', topic: 'sorumluluk', verdict: 'aleyhte', severity: 'yuksek', title: 'Sınırsız tazminat sorumluluğu', note: 'Tazminat sorumluluğu sınırlanmamış; sözleşme bedeliyle sınırlanmasını önerin.', quote: find(/sınırsız|sınır(ı)? (yoktur|bulunmamaktadır|olmaksızın)/i) });
  } else if (pb.requireLiabilityCap && !isKat && body.length > 300 && !/sorumlulu[ğk][^.]{0,80}(sınırlı|aşamaz)|aşamaz/i.test(body)) {
    add({ key: 'sorumluluk', topic: 'sorumluluk', verdict: 'eksik', severity: 'dusuk', title: 'Sorumluluk üst sınırı yok', note: 'Tazminat sorumluluğu için üst sınır yazılmamış.', quote: '' });
  }

  for (const s of list.filter((x) => /cezai şart/i.test(x))) {
    const amount = parseTL(s);
    if (amount !== null && amount > pb.maxPenalty) {
      add({ key: `cezai-${findings.length}`, topic: 'cezai', verdict: 'aleyhte', severity: 'orta', title: `Yüksek cezai şart: ${amount.toLocaleString('tr-TR')} TL`, note: `Kural bankasındaki üst sınır ${pb.maxPenalty.toLocaleString('tr-TR')} TL. Hangi taraf aleyhine işlediğini kontrol edin.`, quote: s });
      break;
    }
  }

  if (/tek taraflı/i.test(body)) add({ key: 'tek-tarafli', topic: 'fesih', verdict: 'aleyhte', severity: 'orta', title: 'Tek taraflı hak', note: 'Bir tarafa tek taraflı değişiklik ya da fesih hakkı tanınmış; kimin lehine olduğunu kontrol edin.', quote: find(/tek taraflı/i) });
  if (/(kendiliğinden|otomatik(?:\s+olarak)?)\s+(?:[^\s.]+\s+){0,3}(uzar|yenilen)/i.test(body)) add({ key: 'uzama', topic: 'fesih', verdict: 'aleyhte', severity: 'dusuk', title: 'Otomatik uzama', note: 'Süre sonunda sözleşme kendiliğinden uzuyor; fesih ihbar tarihi takvime eklenir.', quote: find(/kendiliğinden|otomatik/i) });

  if (body.length > 300) {
    if (pb.requireForceMajeure && !/mücbir sebep/i.test(body)) add({ key: 'mucbir', topic: 'mucbir', verdict: 'eksik', severity: 'orta', title: 'Mücbir sebep maddesi yok', note: 'Deprem, salgın gibi hallerde yükümlülüklerin ne olacağı düzenlenmemiş.', quote: '' });
    if (!/fesih|feshed|dönebilir|dönme/i.test(body)) add({ key: 'fesih', topic: 'fesih', verdict: 'eksik', severity: 'orta', title: 'Fesih maddesi yok', note: 'Sözleşmenin nasıl sona erdirileceği düzenlenmemiş.', quote: '' });
    if (pb.requireConfidentiality && !/gizli/i.test(body)) add({ key: 'gizlilik', topic: 'gizlilik', verdict: 'eksik', severity: 'dusuk', title: 'Gizlilik maddesi yok', note: 'Ticari bilgilerin korunması düzenlenmemiş.', quote: '' });
    if (/T\.?\s?C\.?\s*(Kimlik\s*)?No|kimlik numara/i.test(body) && !/KVKK|6698|kişisel veri/i.test(body)) add({ key: 'kvkk', topic: 'kvkk', verdict: 'mevzuat', severity: 'dusuk', title: 'KVKK hükmü yok', note: 'Sözleşmede kişisel veriler işleniyor; 6698 sayılı KVKK’ya uygun işleme hükmü ekleyin.', quote: '' });
  }

  const blanks = body.match(/\[[A-ZÇĞİÖŞÜ /]{2,}\]/g) ?? [];
  if (blanks.length) add({ key: 'bos-alan', topic: '', verdict: 'eksik', severity: 'orta', title: `${blanks.length} alan doldurulmamış`, note: `Doldurulması gereken alanlar: ${[...new Set(blanks)].slice(0, 6).join(', ')}`, quote: '' });

  for (const rule of MEVZUAT) {
    if (rule.kinds && !rule.kinds.includes(kind)) continue;
    const q = find(rule.pattern);
    if (q || rule.pattern.test(body)) add({ key: `mevzuat-${rule.title}`, topic: rule.topic ?? '', verdict: 'mevzuat', severity: rule.severity, title: rule.title, note: rule.note, quote: q });
  }

  // Aleyhte hükümler tam, iki tarafı da ilgilendiren eksik ve mevzuat sorunları 0,6 ağırlıkla sayılır;
  // böylece taraflar arasındaki fark tavana (100) takılmadan görünür.
  // Puan yumuşak tavanla 100'e yaklaşır; çok sorunlu iki sözleşme de 100'e yapışıp aynı görünmez.
  const raw = findings.reduce((s, f) => s + (f.verdict === 'aleyhte' ? 1 : f.verdict === 'lehte' ? 0 : 0.6) * WEIGHT[f.severity], 0);
  const score = Math.round(100 * (1 - Math.exp(-raw / 80)));
  const band = score <= 30 ? 'dusuk' : score <= 70 ? 'orta' : 'yuksek';
  const order: Record<Verdict, number> = { aleyhte: 0, mevzuat: 1, eksik: 2, lehte: 3 };
  findings.sort((a, b) => order[a.verdict] - order[b.verdict] || WEIGHT[b.severity] - WEIGHT[a.severity]);
  return { score, band, findings };
}

// ---------------------------------------------------------------------------
// Yardımcılar
// ---------------------------------------------------------------------------

interface ContractRow {
  id: number;
  office_id: number;
  title: string;
  kind: string;
  parties: string;
  body: string;
  side: string;
  start_date: string;
  end_date: string;
  value_kurus: number;
  status: string;
  locked_at: string;
  review_status: string;
}

function loadContract(db: DB, user: User, id: number) {
  const row = db.prepare('SELECT * FROM contracts WHERE id = ? AND office_id = ?').get(id, user.office_id) as ContractRow | undefined;
  if (!row) throw new ApiError(404, 'Sözleşme bulunamadı.');
  return row;
}

const SIDE_LABEL: Record<string, string> = { arsa_sahibi: 'Arsa sahibi', yuklenici: 'Yüklenici' };

function bandOf(score: number) {
  return score <= 30 ? 'dusuk' : score <= 70 ? 'orta' : 'yuksek';
}

/** Madde riski ile içtihat riskini birleştirir (taraf belli değilse yalnız madde riski). */
function combinedRisk(body: string, kind: string, side: Side, pb: Playbook) {
  const result = reviewText(body, kind, side, pb);
  const party: Party = side === 'arsa_sahibi' || side === 'yuklenici' ? side : 'notr';
  const precedents = precedentsFor(kind, result.findings.map((f) => f.topic));
  const ictihat = precedentRisk(precedents, party);
  const genel = party === 'notr' ? result.score : Math.round(result.score * 0.75 + ictihat.score * 0.25);
  return {
    result,
    precedents,
    party,
    risk: { madde: result.score, ictihat: ictihat.score, genel, band: bandOf(genel), lehte: ictihat.lehte, aleyhte: ictihat.aleyhte },
  };
}

export function contractReview(db: DB, user: User, id: number) {
  const c = loadContract(db, user, id);
  const pb = getPlaybook(db, user);
  const side = (c.side || 'genel') as Side;
  const { result, precedents, party, risk } = combinedRisk(c.body, c.kind, side, pb);
  const library = listClauses(db, user, { kind: c.kind });
  // Kat karşılığında iki tarafın riski ayrı ayrı hesaplanır.
  const parties =
    c.kind === 'kat-karsiligi'
      ? (['arsa_sahibi', 'yuklenici'] as const).map((s) => {
          const r = combinedRisk(c.body, c.kind, s, pb);
          return {
            side: s,
            label: SIDE_LABEL[s],
            ...r.risk,
            against: r.result.findings.filter((f) => f.verdict === 'aleyhte').length,
            missing: r.result.findings.filter((f) => f.verdict === 'eksik').length,
          };
        })
      : [];
  return {
    ...result,
    side: c.side || 'genel',
    risk,
    parties,
    precedents: precedents.map((p) => ({
      ...p,
      direction: p.favours === 'notr' || party === 'notr' ? 'notr' : p.favours === party ? 'lehte' : 'aleyhte',
    })),
    suggestions: Object.fromEntries(
      [...new Set(result.findings.map((f) => f.topic).filter(Boolean))].map((t) => [t, library.filter((l) => l.topic === t)]),
    ),
  };
}

export function setSide(db: DB, user: User, id: number, side: string) {
  loadContract(db, user, id);
  if (!['arsa_sahibi', 'yuklenici', 'genel'].includes(side)) throw new ApiError(400, 'Geçersiz taraf.');
  db.prepare('UPDATE contracts SET side = ? WHERE id = ?').run(side, id);
  return contractReview(db, user, id);
}

/** Bulgudaki cümleyi kütüphane maddesiyle değiştirir (sonradan Word'de izlenen değişiklik olarak görünür). */
export function applyClause(db: DB, user: User, id: number, input: { quote?: string; clauseId?: number; text?: string }) {
  const c = loadContract(db, user, id);
  if (c.locked_at) throw new ApiError(400, 'Sözleşme imzaya kilitlendi; metin değiştirilemez.');
  let text = input.text?.trim() ?? '';
  if (input.clauseId) {
    const clause = db.prepare('SELECT body FROM clause_library WHERE id = ? AND office_id = ?').get(input.clauseId, user.office_id) as
      | { body: string }
      | undefined;
    if (!clause) throw new ApiError(404, 'Madde bulunamadı.');
    text = clause.body;
  }
  if (!text) throw new ApiError(400, 'Eklenecek metin boş.');
  ensureBaseVersion(db, user, c);
  const quote = input.quote?.trim();
  let body: string;
  if (quote) {
    if (!c.body.includes(quote)) throw new ApiError(409, 'Değiştirilecek cümle metinde bulunamadı; sözleşme değişmiş olabilir.');
    body = c.body.replace(quote, text);
  } else {
    // Eksik madde: sona, imza bloğundan önce eklenir.
    const sign = c.body.search(/\n\s*(TARAF 1|İMZALAR|İmza:)/);
    body = sign > 0 ? `${c.body.slice(0, sign).trimEnd()}\n\n${text}\n${c.body.slice(sign)}` : `${c.body.trimEnd()}\n\n${text}`;
  }
  updateContract(db, user, id, { body });
  return { ok: true, review: contractReview(db, user, id) };
}

// ---------------------------------------------------------------------------
// Faz 3: Versiyonlar, gizli değişiklik avcısı, Word çıktısı
// ---------------------------------------------------------------------------

interface VersionRow {
  id: number;
  contract_id: number;
  version: number;
  source: 'biz' | 'karsi';
  body: string;
  file_name: string;
  meta: string;
  created_at: string;
}

function lastVersion(db: DB, contractId: number, source?: 'biz' | 'karsi') {
  return db
    .prepare(`SELECT * FROM contract_versions WHERE contract_id = ? ${source ? 'AND source = ?' : ''} ORDER BY version DESC LIMIT 1`)
    .get(...(source ? [contractId, source] : [contractId])) as VersionRow | undefined;
}

function insertVersion(db: DB, user: User, contractId: number, source: 'biz' | 'karsi', body: string, fileName: string, meta: object) {
  const v = (lastVersion(db, contractId)?.version ?? 0) + 1;
  db.prepare(
    'INSERT INTO contract_versions (contract_id, version, source, body, file_name, meta, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run(contractId, v, source, body, fileName, JSON.stringify(meta), user.id);
  return v;
}

/** İlk düzenlemeden önce mevcut metni 1. versiyon olarak saklar. */
function ensureBaseVersion(db: DB, user: User, c: ContractRow) {
  if (!lastVersion(db, c.id) && c.body.trim()) insertVersion(db, user, c.id, 'biz', c.body, '', { note: 'İlk metin' });
}

export function listVersions(db: DB, user: User, id: number) {
  loadContract(db, user, id);
  const rows = db
    .prepare(
      `SELECT v.id, v.version, v.source, v.file_name, v.meta, v.created_at, u.name AS created_by_name, length(v.body) AS size
       FROM contract_versions v JOIN users u ON u.id = v.created_by WHERE v.contract_id = ? ORDER BY v.version DESC`,
    )
    .all(id) as (Omit<VersionRow, 'body'> & { meta: string })[];
  return rows.map((r) => ({ ...r, meta: JSON.parse(r.meta || '{}') }));
}

export function compareVersions(db: DB, user: User, id: number, from: number, to: number) {
  loadContract(db, user, id);
  const get = (v: number) => db.prepare('SELECT body FROM contract_versions WHERE contract_id = ? AND version = ?').get(id, v) as { body: string } | undefined;
  const a = get(from);
  const b = get(to);
  if (!a || !b) throw new ApiError(404, 'Versiyon bulunamadı.');
  return { parts: diffWords(a.body, b.body), changes: changeSummary(a.body, b.body) };
}

/**
 * Karşı taraftan gelen versiyonu yükler. Word belgesindeki izlenen değişiklikler geri
 * alındığında metin bizim gönderdiğimiz son versiyona eşit olmalıdır; değilse karşı taraf
 * "değişiklikleri izle" kapalıyken gizli değişiklik yapmıştır.
 */
export function uploadVersion(
  db: DB,
  user: User,
  id: number,
  input: { fileName?: string; fileBase64?: string; text?: string; source?: string },
) {
  const c = loadContract(db, user, id);
  if (c.locked_at) throw new ApiError(400, 'Sözleşme imzaya kilitlendi; yeni versiyon yüklenemez.');
  const source = input.source === 'biz' ? 'biz' : 'karsi';
  const fileName = (input.fileName ?? '').slice(0, 200);
  let accepted: string;
  let rejected: string;
  let tracked = 0;
  let authors: string[] = [];
  if (input.fileBase64) {
    const buf = Buffer.from(input.fileBase64, 'base64');
    if (buf.length > 15 * 1024 * 1024) throw new ApiError(413, 'Dosya 15 MB’tan büyük olamaz.');
    const doc = readDocx(buf);
    accepted = doc.accepted;
    rejected = doc.rejected;
    tracked = doc.trackedChanges;
    authors = doc.authors;
  } else if (input.text?.trim()) {
    accepted = rejected = input.text.replace(/\r/g, '').trim();
  } else {
    throw new ApiError(400, 'Word dosyası ya da metin gerekli.');
  }
  if (!accepted.trim()) throw new ApiError(400, 'Belgede metin bulunamadı. Taranmış (resim) belgeler için yapay zekâ bağlantısı gerekir.');

  ensureBaseVersion(db, user, c);
  const sent = lastVersion(db, id, 'biz');
  const hidden = source === 'karsi' && sent ? changeSummary(sent.body, rejected) : [];
  const declared = source === 'karsi' && sent ? changeSummary(sent.body, accepted).length : 0;
  const meta = { trackedChanges: tracked, authors, hidden, declared, comparedTo: sent?.version ?? null };
  const version = insertVersion(db, user, id, source, accepted, fileName, meta);
  updateContract(db, user, id, { body: accepted });
  return { version, ...meta, review: contractReview(db, user, id) };
}

/**
 * Karşı tarafa gönderilecek Word belgesi: son karşı taraf (ya da ilk) versiyonundan bu yana
 * yaptığımız değişiklikler "Değişiklikleri İzle" olarak işaretlenir. Gönderilen metin
 * versiyon olarak saklanır; karşı taraftan dönen belge buna göre denetlenir.
 */
export function exportRedline(db: DB, user: User, id: number) {
  const c = loadContract(db, user, id);
  ensureBaseVersion(db, user, c);
  const base = lastVersion(db, id, 'karsi') ?? (db.prepare('SELECT * FROM contract_versions WHERE contract_id = ? ORDER BY version LIMIT 1').get(id) as VersionRow);
  const parts = diffWords(base.body, c.body);
  const last = lastVersion(db, id);
  if (!last || last.body !== c.body || last.source !== 'biz') {
    insertVersion(db, user, id, 'biz', c.body, `${c.title}.docx`, { note: 'Karşı tarafa gönderildi', changes: parts.filter((p) => p.op !== 'eq').length });
  }
  const office = db.prepare('SELECT name FROM offices WHERE id = ?').get(user.office_id) as { name: string } | undefined;
  return { fileName: `${c.title.replace(/[\\/:*?"<>|]/g, '')}.docx`, buffer: buildDocx(parts, office?.name || user.name) };
}

// ---------------------------------------------------------------------------
// Faz 3b: Kilitleme ve imza sırası
// ---------------------------------------------------------------------------

export function lockContract(db: DB, user: User, id: number, input: { signers?: { name?: string; role?: string }[] }) {
  const c = loadContract(db, user, id);
  if (c.locked_at) throw new ApiError(400, 'Sözleşme zaten kilitli.');
  if (c.review_status !== 'onayli') throw new ApiError(400, 'İmzaya göndermeden önce sözleşme bir meslektaş tarafından onaylanmalı.');
  const signers = (input.signers ?? []).filter((s) => s.name?.trim());
  if (!signers.length) throw new ApiError(400, 'En az bir imzacı girin.');
  db.transaction(() => {
    db.prepare("UPDATE contracts SET locked_at = datetime('now') WHERE id = ?").run(id);
    const ins = db.prepare('INSERT INTO contract_signers (contract_id, position, name, role) VALUES (?, ?, ?, ?)');
    signers.forEach((s, i) => ins.run(id, i + 1, s.name!.trim(), (s.role ?? '').trim()));
    insertVersion(db, user, id, 'biz', c.body, '', { note: 'İmzaya kilitlendi' });
  })();
  return signingState(db, user, id);
}

export function signingState(db: DB, user: User, id: number) {
  const c = loadContract(db, user, id);
  const signers = db.prepare('SELECT * FROM contract_signers WHERE contract_id = ? ORDER BY position').all(id) as {
    id: number;
    name: string;
    role: string;
    position: number;
    signed_at: string;
  }[];
  return { locked_at: c.locked_at, signers, next: signers.find((s) => !s.signed_at)?.id ?? null };
}

/** İmza sırasına göre imzayı işler; son imzayla sözleşme yürürlüğe girer ve takvim çıkarılır. */
export function markSigned(db: DB, user: User, id: number, signerId: number, date?: string) {
  const state = signingState(db, user, id);
  if (!state.locked_at) throw new ApiError(400, 'Sözleşme imzaya kilitlenmedi.');
  if (state.next !== signerId) throw new ApiError(400, 'İmzalar sırayla alınır; önce sıradaki imzacı imzalamalı.');
  const signedAt = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : new Date().toISOString().slice(0, 10);
  db.prepare('UPDATE contract_signers SET signed_at = ? WHERE id = ?').run(signedAt, signerId);
  const after = signingState(db, user, id);
  let schedule: ReturnType<typeof buildSchedule> | null = null;
  if (!after.next) {
    db.prepare("UPDATE contracts SET status = 'yururlukte', start_date = CASE WHEN start_date = '' THEN ? ELSE start_date END WHERE id = ?").run(signedAt, id);
    schedule = buildSchedule(db, user, id, {});
  }
  return { ...after, schedule };
}

// ---------------------------------------------------------------------------
// Faz 4: İmza sonrası takvim, gecikme alarmı, ihtarname, otomatik uzama
// ---------------------------------------------------------------------------

function addPeriod(date: string, n: number, unit: string) {
  const d = new Date(`${date}T00:00:00Z`);
  const u = unit.toLowerCase();
  if (u === 'gün') d.setUTCDate(d.getUTCDate() + n);
  else if (u === 'hafta') d.setUTCDate(d.getUTCDate() + n * 7);
  else if (u === 'ay') {
    const day = d.getUTCDate();
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() + n);
    const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
    d.setUTCDate(Math.min(day, last));
  } else d.setUTCFullYear(d.getUTCFullYear() + n);
  return d.toISOString().slice(0, 10);
}

const PARTY = /(Kiraya veren|Kiracı|Satıcı|Alıcı|İşveren|İşçi|Yüklenici|Arsa sahibi|Hizmet veren|Hizmet alan)/i;

/** Sözleşme metninden süreleri okuyup tarihli taahhüt ve ödeme takvimi çıkarır. */
export function extractSchedule(body: string, events: { imza?: string; ruhsat?: string }) {
  const items: { text: string; party: string; due_date: string; amount: number; direction: string; basis: string }[] = [];
  for (const s of sentences(body)) {
    const m = /(imza(?:lanma)?(?:sı)?|sözleşme(?:nin)?\s+(?:imza|başlangıç)\s*tarihi|yapı ruhsatı(?:nın)?(?:\s+alın(?:ma|dığı))?(?:sın)?|ruhsat(?:ın)?\s+alın(?:ma|dığı)(?:sın)?)[^.]{0,40}?(?:tarih(?:in)?den|dan|den)\s+itibaren\s+(?:en geç\s+)?(\d+)\s*(?:\([^)]*\)\s*)?(gün|hafta|ay|yıl)/i.exec(s);
    const amount = parseTL(s) ?? 0;
    const party = s.match(PARTY)?.[1] ?? '';
    if (m) {
      const isRuhsat = /ruhsat/i.test(m[1]);
      const start = isRuhsat ? events.ruhsat : events.imza;
      if (!start) continue;
      items.push({
        text: s,
        party,
        due_date: addPeriod(start, Number(m[2]), m[3]),
        amount,
        direction: /öde/i.test(s) ? 'odeme' : 'is',
        basis: `${isRuhsat ? 'Ruhsat' : 'İmza'} tarihinden itibaren ${m[2]} ${m[3]}`,
      });
      continue;
    }
    const d = /\b(\d{1,2})[./](\d{1,2})[./](\d{4})\b/.exec(s);
    if (d && /(yükümlü|edecektir|ödeyecek|teslim|ödenir|ödeme)/i.test(s)) {
      items.push({
        text: s,
        party,
        due_date: `${d[3]}-${d[2].padStart(2, '0')}-${d[1].padStart(2, '0')}`,
        amount,
        direction: /öde/i.test(s) ? 'odeme' : 'is',
        basis: 'Metindeki tarih',
      });
    }
  }
  return items;
}

/** Gecikme cezası kuralını okur: aylık/günlük sabit tutar ya da günlük yüzde. */
export function penaltyRule(body: string) {
  for (const s of sentences(body)) {
    if (!/gecik/i.test(s)) continue;
    const pct = /(günlük|her gün(?:ü)? için)\s*%\s*(\d+(?:[.,]\d+)?)|%\s*(\d+(?:[.,]\d+)?)\s*(?:günlük|gecikme faizi)/i.exec(s);
    if (pct) return { kind: 'yuzde_gun' as const, rate: Number((pct[2] ?? pct[3]).replace(',', '.')), quote: s };
    const amount = parseTL(s);
    if (amount !== null) {
      const perUnit = /bağımsız bölüm (başına|için)|her bir bağımsız/i.test(s);
      return { kind: /(her\s+)?(gecikme\s+)?gün/i.test(s) && !/ay/i.test(s.replace(/aykırı/gi, '')) ? ('tl_gun' as const) : ('tl_ay' as const), amount, perUnit, quote: s };
    }
  }
  return null;
}

export function buildSchedule(db: DB, user: User, id: number, input: { ruhsatDate?: string; imzaDate?: string }) {
  const c = loadContract(db, user, id);
  const imza = input.imzaDate || c.start_date;
  if (!imza) throw new ApiError(400, 'Takvim için imza (başlangıç) tarihi gerekli.');
  if (input.ruhsatDate && !/^\d{4}-\d{2}-\d{2}$/.test(input.ruhsatDate)) throw new ApiError(400, 'Ruhsat tarihi YYYY-AA-GG olmalı.');
  if (input.ruhsatDate) db.prepare('UPDATE contracts SET permit_date = ? WHERE id = ?').run(input.ruhsatDate, id);
  const ruhsat = input.ruhsatDate || (db.prepare('SELECT permit_date FROM contracts WHERE id = ?').get(id) as { permit_date: string }).permit_date;
  const items = extractSchedule(c.body, { imza, ruhsat: ruhsat || undefined });
  const exists = db.prepare('SELECT 1 FROM contract_obligations WHERE contract_id = ? AND text = ?');
  const ins = db.prepare(
    "INSERT INTO contract_obligations (contract_id, party, text, due_date, amount_kurus, direction, source) VALUES (?, ?, ?, ?, ?, ?, 'otomatik')",
  );
  let added = 0;
  db.transaction(() => {
    for (const it of items) {
      if (exists.get(id, it.text)) continue;
      ins.run(id, it.party, it.text, it.due_date, Math.round(it.amount * 100), it.direction);
      added++;
    }
  })();
  return { added, items, needsPermitDate: !ruhsat && /ruhsat[^.]{0,60}itibaren/i.test(c.body) };
}

export function setObligationDirection(db: DB, user: User, obligationId: number, direction: string) {
  if (!['', 'alacak', 'borc', 'is', 'odeme'].includes(direction)) throw new ApiError(400, 'Geçersiz tür.');
  const row = db
    .prepare('SELECT o.contract_id FROM contract_obligations o JOIN contracts c ON c.id = o.contract_id WHERE o.id = ? AND c.office_id = ?')
    .get(obligationId, user.office_id) as { contract_id: number } | undefined;
  if (!row) throw new ApiError(404, 'Taahhüt bulunamadı.');
  db.prepare('UPDATE contract_obligations SET direction = ? WHERE id = ?').run(direction, obligationId);
  return getContract(db, user, row.contract_id);
}

const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

/** Geciken taahhütler ve işleyen gecikme cezası. */
export function alarms(db: DB, user: User, id: number, today = new Date().toISOString().slice(0, 10)) {
  const c = loadContract(db, user, id);
  const rule = penaltyRule(c.body);
  const units = Number((db.prepare('SELECT units FROM contracts WHERE id = ?').get(id) as { units: number }).units) || 1;
  const overdue = db
    .prepare("SELECT * FROM contract_obligations WHERE contract_id = ? AND done = 0 AND due_date != '' AND due_date < ? ORDER BY due_date")
    .all(id, today) as { id: number; text: string; party: string; due_date: string; amount_kurus: number }[];
  return overdue.map((o) => {
    const days = daysBetween(o.due_date, today);
    let penalty = 0;
    let basis = '';
    if (rule?.kind === 'tl_ay') {
      const months = Math.ceil(days / 30);
      penalty = rule.amount * months * (rule.perUnit ? units : 1);
      basis = `${months} ay × ${rule.amount.toLocaleString('tr-TR')} TL${rule.perUnit ? ` × ${units} bağımsız bölüm` : ''}`;
    } else if (rule?.kind === 'tl_gun') {
      penalty = rule.amount * days;
      basis = `${days} gün × ${rule.amount.toLocaleString('tr-TR')} TL`;
    } else if (rule?.kind === 'yuzde_gun') {
      const base = o.amount_kurus / 100 || c.value_kurus / 100;
      penalty = (base * rule.rate * days) / 100;
      basis = `${days} gün × %${rule.rate} × ${base.toLocaleString('tr-TR')} TL`;
    }
    return { obligation: o, days, penalty: Math.round(penalty * 100) / 100, basis, rule: rule?.quote ?? '' };
  });
}

export function setUnits(db: DB, user: User, id: number, units: unknown) {
  loadContract(db, user, id);
  const n = Number(units);
  if (!Number.isInteger(n) || n < 1 || n > 1000) throw new ApiError(400, 'Bağımsız bölüm sayısı 1 ile 1000 arasında olmalı.');
  db.prepare('UPDATE contracts SET units = ? WHERE id = ?').run(n, id);
  return { ok: true };
}

/** Geciken taahhüt için noter ihtarnamesi taslağı. */
export function noticeDraft(db: DB, user: User, id: number, obligationId: number, today = new Date().toISOString().slice(0, 10)) {
  const c = loadContract(db, user, id);
  const alarm = alarms(db, user, id, today).find((a) => a.obligation.id === obligationId);
  if (!alarm) throw new ApiError(404, 'Bu taahhüt için gecikme yok.');
  const fmt = (d: string) => d.split('-').reverse().join('.');
  const office = db.prepare('SELECT name FROM offices WHERE id = ?').get(user.office_id) as { name: string } | undefined;
  const lines = [
    'İHTARNAME',
    '',
    `Keşideci       : [MÜVEKKİL AD SOYAD / UNVAN], [ADRES]`,
    `Vekili         : ${user.name}${office ? `, ${office.name}` : ''}`,
    `Muhatap        : ${alarm.obligation.party || '[MUHATAP]'}, [ADRES]`,
    `Konu           : ${c.title} kapsamındaki yükümlülüğün yerine getirilmemesi ve gecikme tazminatı`,
    '',
    'Sayın Muhatap,',
    '',
    `1. Taraflar arasında ${c.start_date ? `${fmt(c.start_date)} tarihinde ` : ''}“${c.title}” imzalanmıştır.`,
    `2. Sözleşme uyarınca “${alarm.obligation.text}” yükümlülüğünün en geç ${fmt(alarm.obligation.due_date)} tarihinde yerine getirilmesi gerekirken bugüne kadar ${alarm.days} gündür yerine getirilmemiştir.`,
    alarm.rule ? `3. Sözleşmenin ilgili hükmü şöyledir: “${alarm.rule}”` : '3. Gecikme nedeniyle uğranılan zararlar saklıdır.',
    alarm.penalty
      ? `4. Bu hüküm uyarınca ${fmt(today)} itibarıyla işlemiş gecikme tazminatı ${alarm.penalty.toLocaleString('tr-TR', { minimumFractionDigits: 2 })} TL’dir (${alarm.basis}).`
      : '4. Gecikme nedeniyle doğan tüm zarar ve tazminat haklarımız saklıdır.',
    '',
    `İşbu ihtarnamenin tebliğinden itibaren 7 (yedi) gün içinde yükümlülüğünüzü yerine getirmeniz${alarm.penalty ? ' ve işlemiş gecikme tazminatını ödemeniz' : ''}, aksi halde Türk Borçlar Kanunu m. 123 ve devamı uyarınca sözleşmeden dönme, tazminat ve yasal yollara başvurma haklarımızı kullanacağımızı ihtaren bildiririz.`,
    '',
    `Keşideci Vekili`,
    user.name,
  ];
  return { text: lines.join('\n') };
}

/** Otomatik uzayan sözleşmede fesih ihbarının son günü. */
export function renewalNotice(body: string, endDate: string) {
  if (!endDate || !/(kendiliğinden|otomatik(?:\s+olarak)?)\s+(?:[^\s.]+\s+){0,3}(uzar|yenilen)/i.test(body)) return null;
  const m = /(\d+)\s*(?:\([^)]*\)\s*)?(gün|ay)\s+(?:önce(?:den)?|evvel)/i.exec(body);
  const days = m ? (m[2].toLowerCase() === 'ay' ? Number(m[1]) * 30 : Number(m[1])) : 0;
  const d = new Date(`${endDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return { lastNoticeDate: d.toISOString().slice(0, 10), noticeDays: days };
}

