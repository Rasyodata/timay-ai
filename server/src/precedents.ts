/*
 * Yerleşik Yargıtay içtihadı: sözleşme maddelerinin mahkemede nasıl değerlendirildiğine dair
 * ilkeler. Her ilke hangi tarafın lehine işlediğini ve Yargıtay'da aranacak ifadeyi taşır;
 * ilgili kararların kendisi Yargıtay karar veritabanından canlı olarak getirilir.
 */

export type Party = 'arsa_sahibi' | 'yuklenici' | 'notr';

export interface Precedent {
  id: string;
  topic: string;
  kinds: string[];
  principle: string;
  basis: string;
  /** İlkenin lehine işlediği taraf. "notr" ilke iki tarafı da bağlar, risk puanını değiştirmez. */
  favours: Party;
  /** Risk puanına etkisi (1–3). */
  weight: number;
  /** Yargıtay'da aranacak ifade. */
  query: string;
}

const KAT = ['kat-karsiligi'];

export const PRECEDENTS: Precedent[] = [
  {
    id: 'kira-kaybi',
    topic: 'gecikme',
    kinds: KAT,
    principle: 'Yüklenici daireleri geç teslim ederse arsa sahibi, gecikilen süre için kira kaybını (mahrum kalınan kira gelirini) isteyebilir.',
    basis: 'TBK m.112, m.125',
    favours: 'arsa_sahibi',
    weight: 3,
    query: 'kat karşılığı gecikme kira kaybı',
  },
  {
    id: 'cezai-indirim',
    topic: 'gecikme',
    kinds: KAT,
    principle: 'Fahiş cezai şart hâkim tarafından indirilebilir; ancak tacir olan borçlu fahişlik nedeniyle indirim isteyemez.',
    basis: 'TBK m.182/3, TTK m.22',
    favours: 'yuklenici',
    weight: 2,
    query: 'kat karşılığı cezai şart fahiş indirim',
  },
  {
    id: 'teslim-temerrut',
    topic: 'teslim',
    kinds: KAT,
    principle: 'Teslim süresi kesin olarak belirlenmişse süre geçince yüklenici ihtara gerek kalmadan temerrüde düşer; süre belirsizse makul süre esas alınır ve ihtar gerekir.',
    basis: 'TBK m.117',
    favours: 'arsa_sahibi',
    weight: 2,
    query: 'kat karşılığı teslim süresi temerrüt ihtar',
  },
  {
    id: 'geriye-etkili-fesih',
    topic: 'fesih',
    kinds: KAT,
    principle: 'Yüklenicinin temerrüdünde arsa sahibi sözleşmeyi geriye etkili feshedebilir; ancak inşaat yaklaşık %90 seviyesine ulaşmışsa fesih ileriye etkili sayılır ve yüklenici yaptığı işin karşılığını alır.',
    basis: 'TBK m.125, TMK m.2',
    favours: 'notr',
    weight: 2,
    query: 'kat karşılığı geriye etkili fesih yüzde 90',
  },
  {
    id: 'tapu-orantili',
    topic: 'tapu',
    kinds: KAT,
    principle: 'Yüklenici, edimini yerine getirdiği oranda arsa payı devri isteyebilir; işi tamamlamadan payların tamamının devrini isteyemez.',
    basis: 'TBK m.97',
    favours: 'arsa_sahibi',
    weight: 2,
    query: 'kat karşılığı arsa payı devri inşaat seviyesi oranında',
  },
  {
    id: 'ucuncu-kisi',
    topic: 'tapu',
    kinds: KAT,
    principle: 'Yükleniciden bağımsız bölüm satın alan üçüncü kişi, yüklenicinin edimini yerine getirdiği oranda arsa sahibine karşı tapu iptali ve tescil isteyebilir.',
    basis: 'TBK m.183 (alacağın temliki)',
    favours: 'yuklenici',
    weight: 2,
    query: 'kat karşılığı yükleniciden satın alan üçüncü kişi tapu iptal tescil',
  },
  {
    id: 'resmi-sekil',
    topic: 'noter',
    kinds: KAT,
    principle: 'Kat karşılığı inşaat sözleşmesi noterde düzenleme şeklinde yapılmalıdır; adi yazılı sözleşme geçersizdir. Ancak edimler büyük ölçüde ifa edilmişse geçersizliğin ileri sürülmesi hakkın kötüye kullanılmasıdır.',
    basis: 'TMK m.706, TBK m.237, Tapu K. m.26, TMK m.2',
    favours: 'notr',
    weight: 1,
    query: 'kat karşılığı adi yazılı şekil geçersiz hakkın kötüye kullanılması',
  },
  {
    id: 'ayip-ihbar',
    topic: 'ayip',
    kinds: KAT,
    principle: 'Arsa sahibi açık ayıpları teslimde bildirmezse yapıyı kabul etmiş sayılır; gizli ayıplar için yüklenicinin sorumluluğu ortaya çıktıklarında bildirilirse devam eder.',
    basis: 'TBK m.474–477',
    favours: 'yuklenici',
    weight: 1,
    query: 'kat karşılığı ayıp ihbar süresi gizli ayıp',
  },
  {
    id: 'devir-onay',
    topic: 'devir',
    kinds: KAT,
    principle: 'Yüklenici sözleşmeyi arsa sahibinin rızası olmadan üçüncü kişiye devredemez; devir yasağı yoksa bile sözleşmenin devri arsa sahibinin onayına bağlıdır.',
    basis: 'TBK m.205',
    favours: 'arsa_sahibi',
    weight: 1,
    query: 'kat karşılığı sözleşmenin devri arsa sahibi onayı',
  },
  {
    id: 'iskan-teslim',
    topic: 'iskan',
    kinds: KAT,
    principle: 'İskân (yapı kullanma izni) alınmadan yapılan teslim, sözleşmede iskânlı teslim kararlaştırılmışsa eksik ifadır; arsa sahibi iskân alınana kadar gecikme tazminatı isteyebilir.',
    basis: 'TBK m.97, İmar K. m.30',
    favours: 'arsa_sahibi',
    weight: 1,
    query: 'kat karşılığı iskan alınmadan teslim gecikme',
  },
  {
    id: 'yetki-tuketici',
    topic: 'yetki',
    kinds: [],
    principle: 'Yetki sözleşmesi yalnızca tacirler ve kamu tüzel kişileri arasında geçerlidir; tacir olmayan bir taraf için yazılan yetkili mahkeme şartı onu bağlamaz.',
    basis: 'HMK m.17',
    favours: 'notr',
    weight: 1,
    query: 'yetki sözleşmesi tacir olmayan geçersiz HMK 17',
  },
  {
    id: 'cezai-genel',
    topic: 'cezai',
    kinds: [],
    principle: 'Aşırı cezai şart hâkim tarafından indirilebilir; tacirler için indirim yolu kapalıdır.',
    basis: 'TBK m.182/3, TTK m.22',
    favours: 'notr',
    weight: 1,
    query: 'cezai şart fahiş indirim tacir',
  },
];

export function precedentsFor(kind: string, topics: Iterable<string>) {
  const set = new Set(topics);
  return PRECEDENTS.filter((p) => set.has(p.topic) && (p.kinds.length === 0 || p.kinds.includes(kind)));
}

/**
 * İçtihat riski: ilgili ilkelerden karşı taraf lehine işleyenler riski artırır, bizim lehimize
 * işleyenler azaltır. 50 nötr noktadır.
 */
export function precedentRisk(list: Precedent[], side: Party) {
  if (side === 'notr') return { score: 50, lehte: 0, aleyhte: 0 };
  let lehte = 0;
  let aleyhte = 0;
  for (const p of list) {
    if (p.favours === 'notr') continue;
    if (p.favours === side) lehte += p.weight;
    else aleyhte += p.weight;
  }
  return { score: Math.max(0, Math.min(100, 50 + (aleyhte - lehte) * 5)), lehte, aleyhte };
}
