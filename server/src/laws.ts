// Hızlı teyitte tanınan kanunlar. `maxArticle` yalnızca madde sayısı kesin bilinen
// kanunlarda dolu; bu sayının üstündeki bir madde numarası "böyle madde yok" sayılır.
export interface Law {
  no: string;
  short: string;
  name: string;
  maxArticle?: number;
}

export const LAWS: Law[] = [
  { no: '4857', short: 'İş K.', name: 'İş Kanunu', maxArticle: 121 },
  { no: '6098', short: 'TBK', name: 'Türk Borçlar Kanunu', maxArticle: 649 },
  { no: '6100', short: 'HMK', name: 'Hukuk Muhakemeleri Kanunu', maxArticle: 452 },
  { no: '2004', short: 'İİK', name: 'İcra ve İflas Kanunu', maxArticle: 370 },
  { no: '4721', short: 'TMK', name: 'Türk Medeni Kanunu', maxArticle: 1030 },
  { no: '5237', short: 'TCK', name: 'Türk Ceza Kanunu', maxArticle: 345 },
  { no: '5271', short: 'CMK', name: 'Ceza Muhakemesi Kanunu', maxArticle: 335 },
  { no: '6502', short: 'TKHK', name: 'Tüketicinin Korunması Hakkında Kanun', maxArticle: 87 },
  { no: '7036', short: 'İş Mah. K.', name: 'İş Mahkemeleri Kanunu' },
  { no: '6102', short: 'TTK', name: 'Türk Ticaret Kanunu', maxArticle: 1535 },
  { no: '2577', short: 'İYUK', name: 'İdari Yargılama Usulü Kanunu' },
  { no: '6325', short: 'HUAK', name: 'Hukuk Uyuşmazlıklarında Arabuluculuk Kanunu' },
  { no: '5510', short: 'SGK K.', name: 'Sosyal Sigortalar ve Genel Sağlık Sigortası Kanunu' },
];

const byShort = new Map<string, Law>();
for (const law of LAWS) byShort.set(normalizeShort(law.short), law);
// Uygulamada sık görülen diğer kısaltmalar.
byShort.set(normalizeShort('İK'), LAWS[0]);
byShort.set(normalizeShort('BK'), LAWS[1]);
byShort.set(normalizeShort('MK'), LAWS[4]);

function normalizeShort(s: string) {
  return s.toLocaleUpperCase('tr').replace(/[\s.]/g, '');
}

export function findLawByNo(no: string): Law | undefined {
  return LAWS.find((l) => l.no === no);
}

export function findLawByShort(short: string): Law | undefined {
  return byShort.get(normalizeShort(short));
}
