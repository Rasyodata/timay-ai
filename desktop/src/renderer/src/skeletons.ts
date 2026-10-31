import type { CaseDetail } from './api';

/*
 * Belge türüne göre boş iskelet. Köşeli parantezli yerler doldurulur; 8 disiplinli inceleme
 * hangi bölümün eksik kaldığını gösterir.
 */

type CaseInfo = Pick<CaseDetail, 'court' | 'esas_no' | 'client' | 'parties'>;

const court = (c: CaseInfo) => (c.court ? `${c.court.toLocaleUpperCase('tr')} BAŞKANLIĞI'NA` : "[MAHKEME] BAŞKANLIĞI'NA");
const client = (c: CaseInfo) => c.client || '[MÜVEKKİL ADI SOYADI]';

export function skeleton(kind: string, c: CaseInfo): string {
  switch (kind) {
    case 'cevap':
      return `${court(c)}

ESAS NO: ${c.esas_no || '[ESAS NO]'}

DAVALI: ${client(c)} (T.C. Kimlik No: [ ]), [ADRES]
VEKİLİ: Av. [AD SOYAD], [ADRES]
DAVACI: [KARŞI TARAF]
KONU: Davaya cevaplarımızın sunulmasıdır.
TEBLİĞ TARİHİ: [GG.AA.YYYY]

İLK İTİRAZLARIMIZ:
1. [Yetki itirazı varsa burada yazılmalıdır (HMK m.116–117).]

AÇIKLAMALAR:
1. [Davacının iddialarına tek tek cevap]

HUKUKİ SEBEPLER: [HMK, TBK ...]

DELİLLER: [Belgeler (EK-1 ...)], tanık, bilirkişi incelemesi, yemin ve her türlü yasal delil.

SONUÇ VE İSTEM: Yukarıda açıklanan nedenlerle haksız ve dayanaksız davanın reddine, yargılama giderleri ve vekâlet ücretinin davacıya yükletilmesine karar verilmesini saygıyla arz ederiz.

Davalı Vekili
Av. [AD SOYAD] (imza)`;
    case 'icra':
      return `[ŞEHİR] [ ]. İCRA DAİRESİ MÜDÜRLÜĞÜ'NE

TAKİP TALEBİ
ALACAKLI: ${client(c)} (T.C. Kimlik / Vergi No: [ ]), [ADRES]
VEKİLİ: Av. [AD SOYAD]
BORÇLU: [AD SOYAD / UNVAN], [ADRES]
TAKİP YOLU: İlamsız takip (Örnek 7)
ALACAK MİKTARI: [ ] TL asıl alacak, [ ] TL işlemiş faiz, toplam [ ] TL
FAİZ: Asıl alacağa takip tarihinden itibaren yasal faiz
ALACAĞIN SEBEBİ: [fatura / sözleşme / cari hesap] (EK-1)

Borçluya ödeme emri gönderilmesini talep ederim.

Alacaklı Vekili
Av. [AD SOYAD] (imza)`;
    case 'ihtarname':
      return `İHTARNAME

KEŞİDECİ: ${client(c)}, [ADRES]
VEKİLİ: Av. [AD SOYAD]
MUHATAP: [AD SOYAD / UNVAN], [ADRES]
KONU: [ ]

AÇIKLAMALAR:
1. [Olay ve borç]

İşbu ihtarnamenin tebliğinden itibaren [7] gün içinde [ ] TL'nin ödenmesini, aksi halde yasal yollara başvurulacağını ihtar ederiz.

Keşideci Vekili
Av. [AD SOYAD] (imza)`;
    case 'ihtar_cevap':
      return `CEVABİ İHTARNAME

KEŞİDECİ: ${client(c)}, [ADRES]
VEKİLİ: Av. [AD SOYAD]
MUHATAP: [AD SOYAD / UNVAN], [ADRES]
KONU: [ ] Noterliğinin [GG.AA.YYYY] tarihli, [ ] yevmiye numaralı ihtarnamesine cevabımızdır.

AÇIKLAMALAR:
1. [İhtarnamedeki iddialara cevap]

Yukarıda açıklanan nedenlerle ihtarnamenizdeki taleplerinizi kabul etmediğimizi ihtaren bildiririz.

Keşideci Vekili
Av. [AD SOYAD] (imza)`;
    case 'itiraz':
      return `${court(c)}

DOSYA NO: ${c.esas_no || '[ ]'}
İTİRAZ EDEN: ${client(c)}
VEKİLİ: Av. [AD SOYAD]
KONU: [ ] itirazlarımızın sunulmasıdır.

AÇIKLAMALAR:
1. [ ]

HUKUKİ SEBEPLER: [ ]

DELİLLER: [ ] ve her türlü yasal delil.

SONUÇ VE İSTEM: İtirazımızın kabulüne, yargılama giderleri ve vekâlet ücretinin karşı tarafa yükletilmesine karar verilmesini saygıyla arz ederiz.

Vekili
Av. [AD SOYAD] (imza)`;
    case 'kanun_yolu':
      return `[BÖLGE ADLİYE MAHKEMESİ / YARGITAY] İLGİLİ DAİRESİ'NE
Gönderilmek üzere
${court(c)}

ESAS NO: ${c.esas_no || '[ ]'}
İSTİNAF EDEN: ${client(c)}
VEKİLİ: Av. [AD SOYAD]
KARŞI TARAF: [ ]
KARAR TARİHİ / TEBLİĞ TARİHİ: [GG.AA.YYYY] / [GG.AA.YYYY]
KONU: Kararın kaldırılması talebidir.

İSTİNAF SEBEPLERİ:
1. [Usule aykırılık]
2. [Esasa ilişkin aykırılık]

HUKUKİ SEBEPLER: HMK m.341 vd.

SONUÇ VE İSTEM: Kararın kaldırılmasına, davanın kabulüne, yargılama giderleri ve vekâlet ücretinin karşı tarafa yükletilmesine karar verilmesini saygıyla arz ederiz.

Vekili
Av. [AD SOYAD] (imza)`;
    default:
      return `${court(c)}

DAVACI: ${client(c)} (T.C. Kimlik No: [ ]), [ADRES]
VEKİLİ: Av. [AD SOYAD], [ADRES]
DAVALI: [AD SOYAD / UNVAN], [ADRES]
KONU: [ ]
DAVA DEĞERİ: [ ] TL

AÇIKLAMALAR:
1. [Olaylar, tarih sırasıyla]

HUKUKİ SEBEPLER: [ ]

DELİLLER: [Belgeler (EK-1 ...)], tanık, bilirkişi incelemesi, yemin ve her türlü yasal delil.

SONUÇ VE İSTEM: Fazlaya ilişkin haklarımız saklı kalmak kaydıyla [ ] TL'nin [ ] tarihinden itibaren yasal faizi ile davalıdan tahsiline, yargılama giderleri ve vekâlet ücretinin davalıya yükletilmesine karar verilmesini saygıyla arz ederiz.

Davacı Vekili
Av. [AD SOYAD] (imza)`;
  }
}
