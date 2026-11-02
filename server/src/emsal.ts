import type { User } from './auth.ts';
import { assertCaseVisible } from './cases.ts';
import type { AiModel } from './claude.ts';
import type { DB } from './db.ts';
import { searchArchive } from './decisions.ts';
import { ApiError } from './errors.ts';
import { extractArticles } from './mevzuat.ts';

/*
 * Olaydan emsal bulma (anlamsal arama): avukat olayı kendi cümleleriyle anlatır ya da dilekçeyi yapıştırır.
 * Metindeki gündelik ifadeler hukuki kavramlara çevrilir ("işten çıkarıldım" → işe iade, geçerli neden),
 * her kavram için Yargıtay'da aranacak ifade üretilir; arşivdeki kararlar uygunluğa göre sıralanır.
 * Yapay zekâ açıksa kavramlar Claude ile zenginleştirilir; kapalıyken kural tabanlı çalışır.
 */

interface Concept {
  id: string;
  area: string;
  label: string;
  /** Metinde aranan ifadeler (küçük harf, Türkçe). */
  triggers: RegExp;
  /** Yargıtay karar veritabanında aranacak ifade. */
  query: string;
  basis: string;
  chamber?: string;
}

const c = (id: string, area: string, label: string, triggers: RegExp, query: string, basis: string, chamber?: string): Concept => ({
  id,
  area,
  label,
  triggers,
  query,
  basis,
  chamber,
});

export const CONCEPTS: Concept[] = [
  // İş hukuku
  c('ise-iade', 'is', 'İşe iade (geçerli neden)', /işten (çıkar|at)|işime son|feshed|kovul|işe iade|geçerli neden/g, 'işe iade geçerli neden fesih', 'İş K. m.18-21', '9. Hukuk Dairesi'),
  c('kidem', 'is', 'Kıdem tazminatı', /kıdem|tazminatım(ı)? (ödenme|verilme)|yıllık çalış/g, 'kıdem tazminatı hesap', '1475 s. İş K. m.14'),
  c('ihbar', 'is', 'İhbar tazminatı', /ihbar (tazminat|süre)|haber vermeden|önel/g, 'ihbar tazminatı bildirim süresi', 'İş K. m.17'),
  c('fazla-mesai', 'is', 'Fazla çalışma ücreti', /fazla (mesai|çalışma)|hafta sonu çalış|bayram(da)? çalış|gece çalış/g, 'fazla çalışma ücreti tanık ispat', 'İş K. m.41'),
  c('hakli-fesih-isci', 'is', 'İşçinin haklı nedenle feshi', /maaş(ım)? (ödenme|yatırılma|gecik)|sgk (prim|eksik)|sigortasız|ücret(im)? ödenme/g, 'işçinin haklı nedenle feshi ücret ödenmemesi', 'İş K. m.24'),
  c('mobbing', 'is', 'Psikolojik taciz (mobbing)', /mobbing|psikolojik taciz|baskı (yapıl|gör)|yıldırma/g, 'mobbing psikolojik taciz manevi tazminat', 'TBK m.417, İş K. m.24'),
  c('is-kazasi', 'is', 'İş kazası tazminatı', /iş kazası|işyerinde (yaralan|kaza)|meslek hastalığı/g, 'iş kazası maddi manevi tazminat kusur', 'SGK m.13, TBK m.417'),
  // Kira
  c('temerrut-tahliye', 'kira', 'Kira borcunda temerrüt ve tahliye', /kira(yı)? (ödeme|yatırma)|kirayı (geç|ödemiyor)|kira borcu|iki haklı ihtar/g, 'kira temerrüt tahliye ihtar', 'TBK m.315, m.352/2'),
  c('ihtiyac', 'kira', 'İhtiyaç nedeniyle tahliye', /ihtiyac|kendim oturaca|oğlum(un)? (oturaca|evlen)|kızım(ın)? (oturaca|evlen)/g, 'konut ihtiyacı nedeniyle tahliye samimiyet', 'TBK m.350'),
  c('kira-tespit', 'kira', 'Kira bedelinin tespiti', /kira (artış|tespit|bedelinin tespiti)|kira(yı)? art(ır|tır)|emsal kira/g, 'kira bedelinin tespiti hakkaniyet emsal', 'TBK m.344'),
  c('tahliye-taahhut', 'kira', 'Tahliye taahhüdü', /tahliye taahhüd/g, 'tahliye taahhüdü geçerlilik tarih', 'TBK m.352/1'),
  // Aile
  c('bosanma', 'aile', 'Boşanma (evlilik birliğinin sarsılması)', /boşan|geçimsizlik|evlilik birliğ|eşim(le)? (anlaş|kavga|şiddet)/g, 'evlilik birliğinin temelinden sarsılması kusur', 'TMK m.166', '2. Hukuk Dairesi'),
  c('aldatma', 'aile', 'Zina / sadakatsizlik', /aldat|zina|sadakatsiz|başka biriyle/g, 'sadakat yükümlülüğü güven sarsıcı davranış', 'TMK m.161, m.185'),
  c('nafaka', 'aile', 'Nafaka', /nafaka/g, 'yoksulluk nafakası iştirak nafakası artırım', 'TMK m.175, m.182'),
  c('velayet', 'aile', 'Velayet ve kişisel ilişki', /velayet|çocu(ğ|k)(um)?(un)? (bana|yanımda|görüş)|kişisel ilişki/g, 'velayet çocuğun üstün yararı', 'TMK m.182, m.336'),
  c('mal-rejimi', 'aile', 'Mal rejimi tasfiyesi (katılma alacağı)', /edinilmiş mal|katılma alacağı|mal paylaşımı|evlilik içinde (alınan|aldığımız)/g, 'edinilmiş mallara katılma alacağı', 'TMK m.218-241'),
  c('ziynet', 'aile', 'Ziynet eşyası', /ziynet|takı(lar)?|altın(lar)?(ım)?/g, 'ziynet eşyası iade ispat', 'TMK m.220'),
  // Miras
  c('tenkis', 'miras', 'Tenkis (saklı pay)', /saklı pay|tenkis|mirastan mahrum|tüm malı(nı)? (birine|kardeşime)/g, 'tenkis saklı pay ihlali', 'TMK m.560-571'),
  c('muris-muvazaasi', 'miras', 'Muris muvazaası', /muvazaa|satış gibi gösteril|bedelsiz devr|babam(ız)? (tapuyu|evi) (devretti|sattı)/g, 'muris muvazaası tapu iptal tescil', '1.4.1974 t. 1/2 İBK, TBK m.19', '1. Hukuk Dairesi'),
  c('ortakligin-giderilmesi', 'miras', 'Ortaklığın giderilmesi (izale-i şuyu)', /ortaklığın giderilmesi|izale|hisseli (tapu|ev|arsa)|paydaş|satış(ın)? yoluyla/g, 'ortaklığın giderilmesi satış', 'TMK m.698-699'),
  c('mirasin-reddi', 'miras', 'Mirasın reddi', /mirası(n)? red|borçlu (öldü|vefat)|reddi miras/g, 'mirasın reddi süre hükmen ret', 'TMK m.605-606'),
  // Gayrimenkul
  c('tapu-iptal', 'gayrimenkul', 'Tapu iptal ve tescil', /tapu (iptal|tescil)|tapum(u)? |adıma tescil/g, 'tapu iptali ve tescil', 'TMK m.1025'),
  c('el-atma', 'gayrimenkul', 'El atmanın önlenmesi ve ecrimisil', /el at(ma|tı)|ecrimisil|işgal|izinsiz (kullan|otur)|haksız işgal/g, 'müdahalenin men-i ecrimisil', 'TMK m.683, m.995'),
  c('kat-karsiligi', 'gayrimenkul', 'Kat karşılığı inşaat', /kat karşılığı|müteahhit|yüklenici (daire|teslim)|inşaat(ı)? (bitir|teslim)/g, 'kat karşılığı inşaat sözleşmesi gecikme', 'TBK m.470 vd.'),
  c('kamulastirmasiz', 'idare', 'Kamulaştırmasız el atma', /kamulaştırma|belediye (yol|park) (yaptı|geçirdi)|yola terk/g, 'kamulaştırmasız el atma bedel', '2942 s. K. geç. m.6'),
  // Borçlar ve tazminat
  c('trafik', 'tazminat', 'Trafik kazası tazminatı', /trafik kaza|araç(la)? çarp|kaza(da)? (yaralan|öldü|vefat)|kaza yaptı/g, 'trafik kazası maluliyet tazminatı', 'KTK m.85, TBK m.49'),
  c('destek', 'tazminat', 'Destekten yoksun kalma', /destekten yoksun|eşim(i)? kaybett|babam(ı)? kaybett|ölümü(yle|nde)? (geçim|bakım)/g, 'destekten yoksun kalma tazminatı', 'TBK m.53'),
  c('deger-kaybi', 'tazminat', 'Araç değer kaybı', /değer kaybı|aracım(ın)? (değeri|hasar)|pert/g, 'araç değer kaybı tazminatı', 'KTK m.85, m.90'),
  c('manevi', 'tazminat', 'Manevi tazminat', /manevi tazminat|üzüntü|kişilik hak|onurum|itibarım/g, 'manevi tazminat miktarı kişilik hakkı', 'TBK m.56, m.58'),
  c('hekim', 'tazminat', 'Hekim / tıbbi hata', /doktor(un)? hata|ameliyat(ta)? (hata|komplikasyon)|tıbbi (hata|malpraktis)|hastane(de)? (yanlış|hata)/g, 'tıbbi müdahale hekim kusuru komplikasyon', 'TBK m.506'),
  c('sebepsiz', 'borclar', 'Sebepsiz zenginleşme', /sebepsiz zengin|yanlışlıkla (gönder|yatır|havale)|hatalı (havale|eft)/g, 'sebepsiz zenginleşme iade', 'TBK m.77'),
  c('cezai-sart', 'borclar', 'Cezai şart', /cezai şart|ceza(i)? bedel|sözleşme cezası/g, 'cezai şart fahiş indirim', 'TBK m.179-182'),
  c('vekalet-ucreti', 'borclar', 'Vekâlet ücreti alacağı', /vekalet ücreti|avukatlık ücreti|azil/g, 'haksız azil vekalet ücreti', 'Av. K. m.164, m.174'),
  // Tüketici
  c('ayipli-mal', 'tuketici', 'Ayıplı mal', /ayıplı|arızal|bozuk (çıktı|geldi)|sürekli arıza|değiştirmiyor/g, 'ayıplı mal seçimlik haklar bedel iadesi', 'TKHK m.8-11'),
  c('ayipli-arac', 'tuketici', 'Ayıplı araç', /sıfır (araç|araba)|araç(ta)? (gizli ayıp|arıza)|boyalı (çıktı|parça)|kilometre(si)? (düşürül|oynan)/g, 'ayıplı araç gizli ayıp misli ile değişim', 'TKHK m.11, TBK m.219'),
  c('banka', 'tuketici', 'Banka masrafları ve kredi', /banka (masraf|kesinti)|dosya masrafı|kredi kartı aidat|erken ödeme/g, 'banka dosya masrafı iade tüketici', 'TKHK m.4, m.22'),
  // Ticaret ve icra
  c('itirazin-iptali', 'icra', 'İtirazın iptali ve icra inkâr tazminatı', /itirazın iptali|borca itiraz|takibe itiraz|icra(ya)? itiraz/g, 'itirazın iptali icra inkar tazminatı likit', 'İİK m.67'),
  c('menfi-tespit', 'icra', 'Menfi tespit ve istirdat', /menfi tespit|borçlu olmadığım|haksız takip|istirdat|borcum yok/g, 'menfi tespit davası kötüniyet tazminatı', 'İİK m.72'),
  c('kambiyo', 'ticaret', 'Çek / senet (kambiyo)', /karşılıksız|kambiyo|senet|bono|poliçe|keşide|çek(ler)?(im|in|i)? (yaprağı|bedeli|ibraz|ödenme|karşılığ)/g, 'kambiyo senedi imzaya itiraz zamanaşımı', 'TTK m.776 vd., İİK m.168-170'),
  c('haksiz-rekabet', 'ticaret', 'Haksız rekabet', /haksız rekabet|müşteri(lerimi)? (çal|ayart)|marka(mı)? (taklit|kullan)/g, 'haksız rekabet tespit men tazminat', 'TTK m.54-63'),
  // Ceza
  c('hakaret', 'ceza', 'Hakaret', /hakaret|küfür|sövdü|aşağıla/g, 'hakaret suçu kast eleştiri sınırı', 'TCK m.125'),
  c('tehdit', 'ceza', 'Tehdit', /tehdit|öldürürüm|zarar veririm|korkut/g, 'tehdit suçu ciddi ve elverişli', 'TCK m.106'),
  c('dolandiricilik', 'ceza', 'Dolandırıcılık', /dolandır|kandır|sahte (ilan|site)|parayı aldı (ama|ancak)|hile/g, 'nitelikli dolandırıcılık hileli davranış', 'TCK m.157-158'),
  c('hirsizlik', 'ceza', 'Hırsızlık', /hırsız|çaldı|çalındı|çalın/g, 'hırsızlık suçu etkin pişmanlık', 'TCK m.141-147'),
  c('yaralama', 'ceza', 'Kasten yaralama', /dövdü|darp|yaraladı|vurdu|şiddet gördüm/g, 'kasten yaralama basit tıbbi müdahale', 'TCK m.86'),
  c('uyusturucu', 'ceza', 'Uyuşturucu', /uyuşturucu|esrar|metamfetamin|kullanmak için bulundur/g, 'uyuşturucu ticareti kullanma sınırı', 'TCK m.188, m.191'),
  c('aile-ici-siddet', 'ceza', 'Aile içi şiddet ve koruma kararı', /6284|uzaklaştırma|koruma kararı|ev(den)? (uzaklaştır)/g, 'koruma kararı 6284 ihlal zorlama hapsi', '6284 s. K. m.5, m.13'),
  // İdare
  c('disiplin', 'idare', 'Disiplin cezasına itiraz', /disiplin (cezası|soruşturma)|kınama|aylıktan kesme|memuriyetten çıkar/g, 'disiplin cezası iptal savunma hakkı', '657 s. DMK m.125, İYUK m.2'),
  c('imar-ceza', 'idare', 'İmar para cezası ve yıkım', /imar (para )?cezası|yıkım kararı|kaçak yapı|ruhsatsız/g, 'imar para cezası yıkım kararı iptal', '3194 s. İmar K. m.32, m.42'),
];

const STOP = new Set(
  'acaba ama ancak artık aslında az bana bazı belki ben beni benim bile bir biraz birçok birkaç biz bize bizim böyle bu buna bunda bundan bunu bunun burada çok çünkü da daha dahi de defa diye diğer en gibi göre hem hep hepsi her hiç için ile ise kadar ki kim mı mi mu mü nasıl ne neden nerede niçin o ona onda ondan onlar onu onun oysa öyle sanki şey şimdi şu şuna şunu tüm ve veya ya yani yine yok zaten olan olarak olduğu olduğunu ettim etti yaptı yaptım oldu olmuş sonra önce şekilde tarafından tarihinde benden bizden ayrıca üzere ilgili halde'.split(
    ' ',
  ),
);

/** Kavram eşleşmesi yoksa metindeki en sık geçen anlamlı kelimeler. */
function keywords(text: string, n = 5) {
  const freq = new Map<string, number>();
  for (const w of text.toLocaleLowerCase('tr').match(/[\p{L}]{5,}/gu) ?? []) {
    if (STOP.has(w)) continue;
    freq.set(w, (freq.get(w) ?? 0) + 1);
  }
  return [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([w]) => w);
}

export function matchConcepts(text: string) {
  const s = text.toLocaleLowerCase('tr');
  return CONCEPTS.map((k) => ({ k, hits: [...new Set((s.match(k.triggers) ?? []).map((m) => m.trim()))] }))
    .filter((x) => x.hits.length > 0)
    .sort((a, b) => b.hits.length - a.hits.length)
    .map(({ k, hits }) => ({ id: k.id, area: k.area, label: k.label, query: k.query, basis: k.basis, chamber: k.chamber ?? '', hits }));
}

const AI_SCHEMA = {
  type: 'object',
  properties: {
    issues: {
      type: 'array',
      items: {
        type: 'object',
        properties: { label: { type: 'string' }, query: { type: 'string' }, basis: { type: 'string' } },
        required: ['label', 'query', 'basis'],
        additionalProperties: false,
      },
    },
  },
  required: ['issues'],
  additionalProperties: false,
};

export interface EmsalInput {
  text?: string;
  caseId?: number | null;
  useAi?: boolean;
}

/**
 * Olay anlatımını ya da dilekçeyi hukuki kavramlara ve arama ifadelerine çevirir;
 * büro arşivindeki uygun kararları getirir. Çevrimiçi Yargıtay araması masaüstünde bu ifadelerle yapılır.
 */
export async function analyzeFacts(db: DB, user: User, input: EmsalInput, model: AiModel | null) {
  let text = String(input.text ?? '').trim();
  if (input.caseId) {
    assertCaseVisible(db, user, Number(input.caseId));
    const k = db.prepare('SELECT title, facts FROM cases WHERE id = ?').get(Number(input.caseId)) as { title: string; facts: string };
    if (!text) text = `${k.title}\n${k.facts}`.trim();
  }
  if (text.length < 15) throw new ApiError(400, 'Olayı birkaç cümleyle anlatın ya da dilekçeyi yapıştırın.');
  if (text.length > 100000) text = text.slice(0, 100000);

  const concepts = matchConcepts(text).slice(0, 6);
  let ai: { label: string; query: string; basis: string }[] = [];
  let aiError = '';
  if (input.useAi && model) {
    try {
      const r = await model({
        system: `Sen Türk hukukunda uzman bir avukatsın. Avukatın anlattığı olaydaki hukuki meseleleri belirle ve her mesele için Yargıtay karar veritabanında aranacak kısa bir ifade yaz (3-6 kelime, hukuk terimleriyle, tırnak ve işaret kullanmadan). basis: ilgili kanun maddesi (ör. "TBK m.344"); emin değilsen boş bırak. En çok 5 mesele.`,
        messages: [{ role: 'user', content: text.slice(0, 30000) }],
        schema: AI_SCHEMA,
        effort: 'low',
        maxTokens: 4000,
      });
      ai = (JSON.parse(r.text) as { issues: typeof ai }).issues.slice(0, 5);
    } catch (e) {
      aiError = e instanceof ApiError ? e.message : 'Yapay zekâ yanıt veremedi; kural tabanlı sonuçlar gösteriliyor.';
    }
  }

  const queries: { query: string; label: string; chamber: string }[] = [];
  const push = (query: string, label: string, chamber = '') => {
    const q = query.trim().replace(/\s+/g, ' ');
    if (q && !queries.some((x) => x.query.toLocaleLowerCase('tr') === q.toLocaleLowerCase('tr'))) queries.push({ query: q, label, chamber });
  };
  for (const a of ai) push(a.query, a.label);
  for (const k of concepts) push(k.query, k.label, k.chamber);
  const words = concepts.length || ai.length ? [] : keywords(text);
  if (words.length) push(words.slice(0, 3).join(' '), 'Metindeki anahtar kelimeler');

  // Arşivde her ifadeyle ara, kararı en yüksek uygunlukla bir kez listele.
  const archive = new Map<number, Record<string, unknown> & { relevance: number | null; matched: string }>();
  for (const q of queries.slice(0, 5)) {
    for (const d of searchArchive(db, { q: q.query.split(' ').slice(0, 3).join(' '), limit: 5 }).items as unknown as (Record<string, unknown> & { id: number; relevance: number | null })[]) {
      const prev = archive.get(d.id);
      if (!prev || (d.relevance ?? 0) > (prev.relevance ?? 0)) archive.set(d.id, { ...d, matched: q.label });
    }
  }

  return {
    concepts,
    ai: ai.length ? ai : null,
    aiAvailable: model !== null,
    aiError,
    queries: queries.slice(0, 6),
    articles: extractArticles(text).slice(0, 10).map((a) => a.label),
    keywords: words,
    archive: [...archive.values()].sort((a, b) => (b.relevance ?? 0) - (a.relevance ?? 0)).slice(0, 10),
  };
}
