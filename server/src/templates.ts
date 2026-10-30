// Hukuk alanları ve hazır dilekçe şablonları. Şablonlar iskelettir: köşeli parantezli
// yerler dosyaya göre doldurulur. Karar atfı içermezler; içtihat avukat tarafından eklenir
// ve Teyit'ten geçer. [MAHKEME] ve [ESAS NO] dava dosyasındaki bilgilerle otomatik dolar.

export interface Area {
  id: string;
  name: string;
  description: string;
}

export interface Template {
  id: string;
  area: string;
  title: string;
  description: string;
  body: string;
}

export const AREAS: Area[] = [
  { id: 'is', name: 'İş Hukuku', description: 'İşçilik alacakları, işe iade, iş kazası' },
  { id: 'aile', name: 'Aile Hukuku', description: 'Boşanma, nafaka, velayet' },
  { id: 'ceza', name: 'Ceza Hukuku', description: 'Suç duyurusu, itiraz, savunma' },
  { id: 'ticaret', name: 'Ticaret Hukuku', description: 'Alacak, itirazın iptali, şirketler' },
  { id: 'icra', name: 'İcra ve İflas', description: 'Borca itiraz, itirazın kaldırılması, ihtiyati haciz' },
  { id: 'idare', name: 'İdare Hukuku', description: 'İptal davası, yürütmeyi durdurma' },
  { id: 'tuketici', name: 'Tüketici Hukuku', description: 'Ayıplı mal ve hizmet, hakem heyeti' },
  { id: 'kira', name: 'Kira Hukuku', description: 'Tahliye, kira tespiti, uyarlama' },
  { id: 'gayrimenkul', name: 'Gayrimenkul Hukuku', description: 'Ortaklığın giderilmesi, tapu iptal ve tescil' },
  { id: 'miras', name: 'Miras Hukuku', description: 'Mirasçılık belgesi, mirasın reddi' },
];

interface Parts {
  court?: string;
  heading?: string;
  parties: string;
  subject: string;
  facts: string[];
  legal: string;
  evidence: string;
  request: string;
}

function petition(p: Parts): string {
  return [
    `${p.court ?? '[MAHKEME]'}'NE`,
    p.heading ?? '',
    '',
    p.parties,
    '',
    `KONU                : ${p.subject}`,
    '',
    'AÇIKLAMALAR         :',
    '',
    ...p.facts.map((f, i) => `${i + 1}. ${f}\n`),
    `HUKUKİ SEBEPLER     : ${p.legal}`,
    '',
    `DELİLLER            : ${p.evidence}`,
    '',
    `SONUÇ VE İSTEM      : ${p.request}`,
    '',
    'Saygılarımızla arz ederiz. [TARİH]',
    '',
    '                                                    [DAVACI / VEKİLİ]',
    '                                                    Av. [AD SOYAD]',
    '                                                    (e-imza)',
  ]
    .filter((line, i, all) => !(line === '' && all[i - 1] === ''))
    .join('\n');
}

const DAVA_TARAFLARI = `DAVACI              : [AD SOYAD], T.C. No: [T.C. KİMLİK NO]
                      [ADRES]
VEKİLİ              : Av. [AD SOYAD], [BARO] Barosu, [BÜRO ADRESİ]
DAVALI              : [AD SOYAD / UNVAN]
                      [ADRES]`;

const STANDART_DELILLER =
  'Tanık beyanları, bilirkişi incelemesi, yemin ve her türlü yasal delil (delil listemiz ayrıca sunulacaktır).';

export const TEMPLATES: Template[] = [
  // İş Hukuku
  {
    id: 'is-iscilik-alacagi',
    area: 'is',
    title: 'İşçilik alacakları dava dilekçesi',
    description: 'Kıdem, ihbar tazminatı, fazla mesai ve yıllık izin ücreti',
    body: petition({
      heading: '(Arabuluculuk son tutanağı ektedir)',
      parties: DAVA_TARAFLARI,
      subject:
        'Fazlaya ilişkin haklarımız saklı kalmak kaydıyla kıdem tazminatı, ihbar tazminatı, fazla çalışma ücreti ve yıllık izin ücreti alacaklarının tahsili talebidir. (Belirsiz alacak)',
      facts: [
        'Müvekkil, davalı işyerinde [İŞE GİRİŞ TARİHİ] ile [ÇIKIŞ TARİHİ] tarihleri arasında [GÖREVİ] olarak çalışmıştır. Son aylık net ücreti [ÜCRET] TL\'dir.',
        'Müvekkilin iş sözleşmesi [FESİH ŞEKLİ VE GEREKÇESİ] feshedilmiştir. Fesih haklı nedene dayanmamaktadır.',
        'Müvekkil haftada [SAAT] saat çalışmış, fazla çalışma ücretleri ödenmemiştir. Kullandırılmayan yıllık izin ücretleri de ödenmemiştir.',
        'Dava şartı olan arabuluculuk görüşmeleri [TARİH] tarihli son tutanakla anlaşamama ile sonuçlanmıştır.',
      ],
      legal: '4857 sayılı İş Kanunu, 1475 sayılı İş Kanunu m. 14, 7036 sayılı İş Mahkemeleri Kanunu, HMK m. 107 ve ilgili mevzuat.',
      evidence: `SGK hizmet dökümü, ücret bordroları, banka kayıtları, işyeri şahsi sicil dosyası, arabuluculuk son tutanağı, ${STANDART_DELILLER}`,
      request:
        'Fazlaya ilişkin haklarımız saklı kalmak kaydıyla, şimdilik [TUTAR] TL kıdem tazminatı, [TUTAR] TL ihbar tazminatı, [TUTAR] TL fazla çalışma ücreti ve [TUTAR] TL yıllık izin ücretinin yasal faizleriyle birlikte davalıdan tahsiline, yargılama giderleri ve vekâlet ücretinin davalıya yükletilmesine karar verilmesini vekâleten talep ederiz.',
    }),
  },
  {
    id: 'is-ise-iade',
    area: 'is',
    title: 'İşe iade dava dilekçesi',
    description: 'Geçersiz fesih nedeniyle işe iade ve boşta geçen süre ücreti',
    body: petition({
      heading: '(Arabuluculuk son tutanağı ektedir)',
      parties: DAVA_TARAFLARI,
      subject: 'Feshin geçersizliğinin tespiti ile müvekkilin işe iadesi talebidir.',
      facts: [
        'Müvekkil davalı işyerinde [İŞE GİRİŞ TARİHİ] tarihinden bu yana [GÖREVİ] olarak çalışmaktadır. İşyerinde 30 veya daha fazla işçi çalışmaktadır.',
        'Müvekkilin iş sözleşmesi [FESİH TARİHİ] tarihinde [GEREKÇE] gerekçesiyle feshedilmiştir. Fesih bildiriminde geçerli bir neden gösterilmemiş, savunma alınmamıştır.',
        'Fesih tebliğinden itibaren bir ay içinde arabulucuya başvurulmuş, [TARİH] tarihli son tutanakla anlaşma sağlanamamıştır.',
      ],
      legal: '4857 sayılı İş Kanunu m. 18, 19, 20 ve 21, 7036 sayılı İş Mahkemeleri Kanunu m. 3 ve ilgili mevzuat.',
      evidence: `Fesih bildirimi, SGK kayıtları, işyeri şahsi sicil dosyası, arabuluculuk son tutanağı, ${STANDART_DELILLER}`,
      request:
        'Feshin geçersizliğinin tespiti ile müvekkilin işe iadesine, işe başlatılmaması halinde ödenecek tazminatın belirlenmesine, kararın kesinleşmesine kadar en çok dört aylık ücret ve diğer hakların ödenmesine, yargılama giderleri ve vekâlet ücretinin davalıya yükletilmesine karar verilmesini vekâleten talep ederiz.',
    }),
  },

  // Aile Hukuku
  {
    id: 'aile-anlasmali-bosanma',
    area: 'aile',
    title: 'Anlaşmalı boşanma dilekçesi',
    description: 'TMK m. 166/3, protokol ile birlikte',
    body: petition({
      parties: `DAVACI              : [AD SOYAD], T.C. No: [T.C. KİMLİK NO], [ADRES]
VEKİLİ              : Av. [AD SOYAD]
DAVALI              : [AD SOYAD], T.C. No: [T.C. KİMLİK NO], [ADRES]`,
      subject: 'Tarafların anlaşmalı olarak boşanmalarına karar verilmesi talebidir.',
      facts: [
        'Taraflar [EVLİLİK TARİHİ] tarihinde evlenmiştir. Evlilik bir yıldan uzun sürmüştür.',
        'Evlilik birliği temelinden sarsılmış olup taraflar boşanma ve sonuçları konusunda ekte sunulan protokolde tam olarak anlaşmışlardır.',
        'Taraflar, protokolde velayet, nafaka ve mal paylaşımı konularında serbest iradeleriyle uzlaşmıştır.',
      ],
      legal: '4721 sayılı Türk Medeni Kanunu m. 166/3 ve ilgili mevzuat.',
      evidence: 'Nüfus kayıtları, anlaşmalı boşanma protokolü, tarafların beyanları.',
      request:
        'Tarafların TMK m. 166/3 uyarınca boşanmalarına, ekli protokolün aynen onaylanmasına, yargılama giderlerinin taraflar üzerinde bırakılmasına karar verilmesini talep ederiz.',
    }),
  },
  {
    id: 'aile-cekismeli-bosanma',
    area: 'aile',
    title: 'Çekişmeli boşanma dava dilekçesi',
    description: 'Evlilik birliğinin temelinden sarsılması, nafaka, velayet',
    body: petition({
      parties: DAVA_TARAFLARI,
      subject: 'Boşanma, velayet, tedbir ve yoksulluk nafakası ile maddi ve manevi tazminat talebidir.',
      facts: [
        'Taraflar [EVLİLİK TARİHİ] tarihinde evlenmiş olup bu evlilikten [ÇOCUK SAYISI VE YAŞLARI] çocukları vardır.',
        'Davalı [KUSURLU DAVRANIŞLAR] nedeniyle evlilik birliği temelinden sarsılmış, ortak hayatın sürdürülmesi taraflardan beklenemez hale gelmiştir.',
        'Müvekkilin düzenli bir geliri bulunmamaktadır; boşanma ile yoksulluğa düşecektir.',
      ],
      legal: '4721 sayılı Türk Medeni Kanunu m. 166/1, 169, 174, 175, 182 ve ilgili mevzuat.',
      evidence: `Nüfus kayıtları, tanık beyanları, mesaj ve yazışma kayıtları, sosyal ve ekonomik durum araştırması, ${STANDART_DELILLER}`,
      request:
        'Tarafların boşanmalarına, ortak çocukların velayetinin müvekkile verilmesine, dava süresince aylık [TUTAR] TL tedbir nafakasına ve karar sonrası yoksulluk nafakasına, [TUTAR] TL maddi ve [TUTAR] TL manevi tazminatın davalıdan tahsiline, yargılama giderleri ve vekâlet ücretinin davalıya yükletilmesine karar verilmesini talep ederiz.',
    }),
  },
  {
    id: 'aile-nafaka-artirim',
    area: 'aile',
    title: 'Nafaka artırım dava dilekçesi',
    description: 'Değişen koşullar nedeniyle nafakanın artırılması',
    body: petition({
      parties: DAVA_TARAFLARI,
      subject: '[MAHKEME VE KARAR BİLGİSİ] ile hükmedilen nafakanın artırılması talebidir.',
      facts: [
        '[KARAR TARİHİ] tarihli kararla aylık [TUTAR] TL nafakaya hükmedilmiştir.',
        'Aradan geçen sürede ekonomik koşullar değişmiş, nafaka alacaklısının ihtiyaçları artmış, davalının geliri ise yükselmiştir.',
      ],
      legal: '4721 sayılı Türk Medeni Kanunu m. 176/4, 182 ve ilgili mevzuat.',
      evidence: `Nafaka kararı, gelir belgeleri, sosyal ve ekonomik durum araştırması, ${STANDART_DELILLER}`,
      request:
        'Aylık nafakanın dava tarihinden itibaren [TUTAR] TL\'ye artırılmasına, her yıl ÜFE oranında artırılmasına, yargılama giderleri ve vekâlet ücretinin davalıya yükletilmesine karar verilmesini talep ederiz.',
    }),
  },

  // Ceza Hukuku
  {
    id: 'ceza-suc-duyurusu',
    area: 'ceza',
    title: 'Suç duyurusu dilekçesi',
    description: 'Cumhuriyet Başsavcılığına şikâyet ve suç duyurusu',
    body: petition({
      court: '[İL] CUMHURİYET BAŞSAVCILIĞI',
      parties: `MÜŞTEKİ             : [AD SOYAD], T.C. No: [T.C. KİMLİK NO], [ADRES]
VEKİLİ              : Av. [AD SOYAD]
ŞÜPHELİ             : [AD SOYAD / BİLİNMEYEN], [ADRES]
SUÇ                 : [SUÇ ADI]
SUÇ TARİHİ          : [TARİH]`,
      subject: 'Şüphelinin eylemi nedeniyle şikâyetçi olduğumuzun ve cezalandırılmasının talebidir.',
      facts: [
        '[TARİH] tarihinde [YER]\'de şüpheli [EYLEMİN AYRINTILI ANLATIMI].',
        'Şüphelinin eylemi [SUÇ ADI] suçunu oluşturmaktadır. Müvekkil olay nedeniyle [ZARAR] zarara uğramıştır.',
      ],
      legal: '5271 sayılı Ceza Muhakemesi Kanunu m. 158, 5237 sayılı Türk Ceza Kanunu ve ilgili mevzuat.',
      evidence: 'Kamera kayıtları, tanık beyanları, darp raporu, yazışmalar ve toplanacak her türlü delil.',
      request:
        'Şüpheli hakkında soruşturma başlatılarak delillerin toplanmasına ve kamu davası açılarak cezalandırılmasına karar verilmesini talep ederiz.',
    }),
  },
  {
    id: 'ceza-itiraz',
    area: 'ceza',
    title: 'Kovuşturmaya yer olmadığına dair karara itiraz',
    description: 'CMK m. 173 uyarınca sulh ceza hâkimliğine itiraz',
    body: petition({
      court: '[İL] NÖBETÇİ SULH CEZA HÂKİMLİĞİ',
      heading: 'Gönderilmek üzere\n[İL] CUMHURİYET BAŞSAVCILIĞI\'NA',
      parties: `İTİRAZ EDEN         : [AD SOYAD] (Müşteki)
VEKİLİ              : Av. [AD SOYAD]
ŞÜPHELİ             : [AD SOYAD]
SORUŞTURMA NO       : [SORUŞTURMA NO]
KARAR NO            : [KARAR NO]`,
      subject: '[TARİH] tarihinde tebliğ edilen kovuşturmaya yer olmadığına dair karara itirazlarımızdır.',
      facts: [
        'Başsavcılık, [GEREKÇE] gerekçesiyle kovuşturmaya yer olmadığına karar vermiştir.',
        'Karar eksik inceleme ile verilmiştir: [TOPLANMAYAN DELİLLER VE HATALI DEĞERLENDİRMELER].',
        'Tebliğden itibaren 15 günlük süre içinde itiraz ediyoruz.',
      ],
      legal: '5271 sayılı Ceza Muhakemesi Kanunu m. 173 ve ilgili mevzuat.',
      evidence: 'Soruşturma dosyası ve dilekçede belirtilen deliller.',
      request:
        'Kovuşturmaya yer olmadığına dair kararın kaldırılarak kamu davası açılmasına karar verilmesini talep ederiz.',
    }),
  },

  // Ticaret Hukuku
  {
    id: 'ticaret-itirazin-iptali',
    area: 'ticaret',
    title: 'İtirazın iptali dava dilekçesi',
    description: 'İİK m. 67, icra inkâr tazminatı ile',
    body: petition({
      parties: DAVA_TARAFLARI,
      subject:
        '[İCRA DAİRESİ] [DOSYA NO] sayılı dosyasında davalının itirazının iptali ile takibin devamı ve %20\'den az olmamak üzere icra inkâr tazminatı talebidir.',
      facts: [
        'Müvekkil şirket ile davalı arasında [TİCARİ İLİŞKİ] bulunmaktadır. Bu ilişkiden doğan [TUTAR] TL alacak ödenmemiştir.',
        'Alacak için başlatılan ilamsız takibe davalı haksız olarak itiraz etmiş, takip durmuştur.',
        'Ticari uyuşmazlıklarda dava şartı olan arabuluculuğa başvurulmuş, anlaşma sağlanamamıştır.',
      ],
      legal: '2004 sayılı İcra ve İflas Kanunu m. 67, 6102 sayılı Türk Ticaret Kanunu, 6098 sayılı Türk Borçlar Kanunu ve ilgili mevzuat.',
      evidence: `İcra dosyası, faturalar, ticari defterler, cari hesap ekstresi, sözleşme, arabuluculuk son tutanağı, ${STANDART_DELILLER}`,
      request:
        'Davalının itirazının iptali ile takibin devamına, alacağın %20\'sinden az olmamak üzere icra inkâr tazminatının davalıdan tahsiline, yargılama giderleri ve vekâlet ücretinin davalıya yükletilmesine karar verilmesini talep ederiz.',
    }),
  },
  {
    id: 'ticaret-alacak',
    area: 'ticaret',
    title: 'Alacak dava dilekçesi',
    description: 'Sözleşmeden doğan ticari alacak',
    body: petition({
      parties: DAVA_TARAFLARI,
      subject: '[TUTAR] TL alacağın faiziyle birlikte tahsili talebidir.',
      facts: [
        'Taraflar arasında [TARİH] tarihli [SÖZLEŞME TÜRÜ] sözleşmesi imzalanmıştır.',
        'Müvekkil edimini eksiksiz ifa etmiş, davalı ise [TUTAR] TL bedeli ödememiştir.',
        'Davalıya [TARİH] tarihli ihtarname gönderilmiş, ödeme yapılmamıştır.',
      ],
      legal: '6098 sayılı Türk Borçlar Kanunu, 6102 sayılı Türk Ticaret Kanunu ve ilgili mevzuat.',
      evidence: `Sözleşme, faturalar, ihtarname, ticari defterler, ${STANDART_DELILLER}`,
      request:
        '[TUTAR] TL alacağın temerrüt tarihinden itibaren işleyecek avans faiziyle birlikte davalıdan tahsiline, yargılama giderleri ve vekâlet ücretinin davalıya yükletilmesine karar verilmesini talep ederiz.',
    }),
  },

  // İcra ve İflas
  {
    id: 'icra-borca-itiraz',
    area: 'icra',
    title: 'Ödeme emrine itiraz dilekçesi',
    description: 'İİK m. 62, borca ve faize itiraz',
    body: petition({
      court: '[İL] [NO]. İCRA DAİRESİ',
      parties: `DOSYA NO            : [DOSYA NO]
BORÇLU / İTİRAZ EDEN: [AD SOYAD], [ADRES]
VEKİLİ              : Av. [AD SOYAD]
ALACAKLI            : [AD SOYAD / UNVAN]`,
      subject: 'Ödeme emrine, borca, faize ve tüm ferilerine itirazımızdır.',
      facts: [
        'Müvekkile [TEBLİĞ TARİHİ] tarihinde ödeme emri tebliğ edilmiştir.',
        'Müvekkilin alacaklıya böyle bir borcu bulunmamaktadır. Borca, faize, faiz oranına ve tüm ferilerine itiraz ediyoruz.',
      ],
      legal: '2004 sayılı İcra ve İflas Kanunu m. 62 ve ilgili mevzuat.',
      evidence: 'İcra dosyası ve her türlü yasal delil.',
      request: 'İtirazımızın kabulü ile takibin durdurulmasına karar verilmesini talep ederiz.',
    }),
  },
  {
    id: 'icra-itirazin-kaldirilmasi',
    area: 'icra',
    title: 'İtirazın kaldırılması dilekçesi',
    description: 'İİK m. 68, belgeye dayalı alacakta',
    body: petition({
      court: '[İL] NÖBETÇİ İCRA HUKUK MAHKEMESİ',
      parties: `DAVACI (ALACAKLI)   : [AD SOYAD / UNVAN]
VEKİLİ              : Av. [AD SOYAD]
DAVALI (BORÇLU)     : [AD SOYAD], [ADRES]
İCRA DOSYASI        : [İCRA DAİRESİ] [DOSYA NO]`,
      subject: 'Davalının itirazının kesin olarak kaldırılması ve icra inkâr tazminatı talebidir.',
      facts: [
        'Müvekkil, davalı aleyhine [BELGE TÜRÜ, ör. imzası ikrar edilmiş adi senet] dayanağıyla ilamsız takip başlatmıştır.',
        'Davalı borca itiraz etmiş ise de alacak İİK m. 68\'de sayılan nitelikte bir belgeye dayanmaktadır.',
      ],
      legal: '2004 sayılı İcra ve İflas Kanunu m. 68 ve ilgili mevzuat.',
      evidence: 'İcra dosyası, takip dayanağı belge.',
      request:
        'Davalının itirazının kesin olarak kaldırılmasına, %20\'den az olmamak üzere icra inkâr tazminatına, yargılama giderleri ve vekâlet ücretinin davalıya yükletilmesine karar verilmesini talep ederiz.',
    }),
  },
  {
    id: 'icra-ihtiyati-haciz',
    area: 'icra',
    title: 'İhtiyati haciz talep dilekçesi',
    description: 'İİK m. 257, vadesi gelmiş rehinle temin edilmemiş alacak',
    body: petition({
      court: '[İL] NÖBETÇİ ASLİYE TİCARET / HUKUK MAHKEMESİ',
      parties: `İHTİYATİ HACİZ İSTEYEN: [AD SOYAD / UNVAN]
VEKİLİ              : Av. [AD SOYAD]
KARŞI TARAF         : [AD SOYAD / UNVAN], [ADRES]`,
      subject: 'Borçlunun menkul, gayrimenkul mallarıyla üçüncü kişilerdeki hak ve alacaklarına ihtiyati haciz konulması talebidir.',
      facts: [
        'Müvekkilin karşı taraftan [BELGE, ör. çek / bono] dayalı, vadesi gelmiş ve rehinle temin edilmemiş [TUTAR] TL alacağı bulunmaktadır.',
        'Alacağın tahsili tehlikededir.',
      ],
      legal: '2004 sayılı İcra ve İflas Kanunu m. 257 vd. ve ilgili mevzuat.',
      evidence: 'Alacak belgesi aslı, banka karşılıksız kaşesi (varsa).',
      request:
        'Teminat karşılığında borçlunun mal, hak ve alacaklarına [TUTAR] TL ve ferileri üzerinden ihtiyati haciz konulmasına karar verilmesini talep ederiz.',
    }),
  },

  // İdare Hukuku
  {
    id: 'idare-iptal',
    area: 'idare',
    title: 'İptal davası dilekçesi',
    description: 'İYUK m. 2, yürütmeyi durdurma talepli',
    body: petition({
      court: '[İL] İDARE MAHKEMESİ BAŞKANLIĞI',
      heading: '(Yürütmeyi durdurma taleplidir)',
      parties: `DAVACI              : [AD SOYAD], T.C. No: [T.C. KİMLİK NO], [ADRES]
VEKİLİ              : Av. [AD SOYAD]
DAVALI İDARE        : [İDARE ADI]
DAVA KONUSU İŞLEM   : [İŞLEMİN TARİHİ VE SAYISI]
TEBLİĞ TARİHİ       : [TARİH]`,
      subject: 'Dava konusu işlemin öncelikle yürütmesinin durdurulması ve iptali talebidir.',
      facts: [
        'Davalı idare [TARİH] tarihli işlemle [İŞLEMİN İÇERİĞİ].',
        'İşlem yetki, şekil, sebep, konu ve maksat yönlerinden hukuka aykırıdır: [AYKIRILIK GEREKÇELERİ].',
        'İşlemin uygulanması halinde telafisi güç veya imkânsız zararlar doğacak olup işlem açıkça hukuka aykırıdır.',
        'Dava, tebliğden itibaren 60 günlük dava açma süresi içinde açılmıştır.',
      ],
      legal: '2577 sayılı İdari Yargılama Usulü Kanunu m. 2, 7 ve 27, Anayasa m. 125 ve ilgili mevzuat.',
      evidence: 'Dava konusu işlem, tebliğ belgesi, idari dosya ve her türlü yasal delil.',
      request:
        'Dava konusu işlemin öncelikle yürütmesinin durdurulmasına, yargılama sonunda iptaline, yargılama giderleri ve vekâlet ücretinin davalı idareye yükletilmesine karar verilmesini talep ederiz.',
    }),
  },

  // Tüketici Hukuku
  {
    id: 'tuketici-ayipli-mal',
    area: 'tuketici',
    title: 'Ayıplı mal dava dilekçesi',
    description: 'TKHK m. 8 ve 11, bedel iadesi veya değişim',
    body: petition({
      court: '[İL] TÜKETİCİ MAHKEMESİ',
      parties: DAVA_TARAFLARI,
      subject: 'Ayıplı malın iadesi ile ödenen [TUTAR] TL bedelin faiziyle iadesi talebidir.',
      facts: [
        'Müvekkil [TARİH] tarihinde davalıdan [MALIN ADI] ürününü [TUTAR] TL bedelle satın almıştır.',
        'Ürün kısa süre içinde [AYIBIN AÇIKLAMASI] nedeniyle kullanılamaz hale gelmiştir. Ayıp, satış tarihinde mevcuttur.',
        'Davalıya [TARİH] tarihinde bildirimde bulunulmuş, sonuç alınamamıştır. (Dava şartı arabuluculuk tutanağı / hakem heyeti parasal sınırı açıklaması)',
      ],
      legal: '6502 sayılı Tüketicinin Korunması Hakkında Kanun m. 8, 9, 10 ve 11 ve ilgili mevzuat.',
      evidence: `Fatura, garanti belgesi, servis kayıtları, yazışmalar, ${STANDART_DELILLER}`,
      request:
        'Sözleşmeden dönülerek ödenen [TUTAR] TL bedelin ödeme tarihinden itibaren faiziyle davalıdan tahsiline, yargılama giderleri ve vekâlet ücretinin davalıya yükletilmesine karar verilmesini talep ederiz.',
    }),
  },
  {
    id: 'tuketici-hakem-heyeti',
    area: 'tuketici',
    title: 'Tüketici hakem heyeti başvurusu',
    description: 'TKHK m. 68, parasal sınırın altındaki uyuşmazlıklar',
    body: petition({
      court: '[İL / İLÇE] TÜKETİCİ HAKEM HEYETİ BAŞKANLIĞI',
      parties: `BAŞVURAN            : [AD SOYAD], T.C. No: [T.C. KİMLİK NO], [ADRES], [TELEFON]
KARŞI TARAF         : [UNVAN], [ADRES]`,
      subject: '[TUTAR] TL bedelin iadesi talebidir.',
      facts: [
        '[TARİH] tarihinde karşı taraftan [MAL / HİZMET] satın aldım.',
        '[SORUNUN AÇIKLAMASI]. Karşı tarafa başvurmama rağmen sorun çözülmemiştir.',
      ],
      legal: '6502 sayılı Tüketicinin Korunması Hakkında Kanun m. 68 ve ilgili mevzuat.',
      evidence: 'Fatura, sözleşme, yazışmalar.',
      request: '[TUTAR] TL\'nin karşı taraftan alınarak tarafıma ödenmesine karar verilmesini talep ederim.',
    }),
  },

  // Kira Hukuku
  {
    id: 'kira-tahliye-temerrut',
    area: 'kira',
    title: 'Kira temerrüdü nedeniyle tahliye',
    description: 'TBK m. 315 ve 352/2, kira bedelinin ödenmemesi',
    body: petition({
      court: '[İL] NÖBETÇİ SULH HUKUK MAHKEMESİ',
      parties: DAVA_TARAFLARI,
      subject: 'Kiralananın tahliyesi talebidir.',
      facts: [
        'Davalı, müvekkile ait [ADRES] adresindeki taşınmazda [TARİH] başlangıç tarihli sözleşme ile aylık [TUTAR] TL bedelle kiracıdır.',
        'Davalı [AYLAR] aylarına ait kira bedellerini ödememiştir. [TARİH] tarihli ihtarname ile süre verilmiş, ödeme yapılmamıştır. / Bir kira yılı içinde iki haklı ihtara sebep olmuştur.',
        'Uyuşmazlık için dava şartı arabuluculuk sürecinde anlaşma sağlanamamıştır.',
      ],
      legal: '6098 sayılı Türk Borçlar Kanunu m. 315 ve 352/2, 6325 sayılı Kanun ve ilgili mevzuat.',
      evidence: `Kira sözleşmesi, ihtarnameler ve tebliğ şerhleri, banka kayıtları, arabuluculuk son tutanağı, ${STANDART_DELILLER}`,
      request:
        'Kiralananın tahliyesine, yargılama giderleri ve vekâlet ücretinin davalıya yükletilmesine karar verilmesini talep ederiz.',
    }),
  },
  {
    id: 'kira-tespit',
    area: 'kira',
    title: 'Kira bedelinin tespiti dava dilekçesi',
    description: 'TBK m. 344, beş yılı aşan kira ilişkisi',
    body: petition({
      court: '[İL] NÖBETÇİ SULH HUKUK MAHKEMESİ',
      parties: DAVA_TARAFLARI,
      subject: '[DÖNEM] kira dönemi için aylık kira bedelinin [TUTAR] TL olarak tespiti talebidir.',
      facts: [
        'Davalı, müvekkile ait [ADRES] adresindeki taşınmazda [TARİH] tarihinden beri kiracıdır. Mevcut aylık kira bedeli [TUTAR] TL\'dir.',
        'Kira ilişkisi beş yılı aşmış olup kira bedeli emsal kira bedellerinin çok altında kalmıştır.',
      ],
      legal: '6098 sayılı Türk Borçlar Kanunu m. 344 ve ilgili mevzuat.',
      evidence: `Kira sözleşmesi, emsal kira sözleşmeleri, bilirkişi incelemesi ve keşif, ${STANDART_DELILLER}`,
      request:
        '[DÖNEM] kira döneminden geçerli olmak üzere aylık kira bedelinin [TUTAR] TL olarak tespitine, yargılama giderleri ve vekâlet ücretinin davalıya yükletilmesine karar verilmesini talep ederiz.',
    }),
  },

  // Gayrimenkul Hukuku
  {
    id: 'gayrimenkul-ortakligin-giderilmesi',
    area: 'gayrimenkul',
    title: 'Ortaklığın giderilmesi (izale-i şuyu) dava dilekçesi',
    description: 'TMK m. 698-699, paylı mülkiyette',
    body: petition({
      court: '[İL] NÖBETÇİ SULH HUKUK MAHKEMESİ',
      parties: `DAVACI              : [AD SOYAD], T.C. No: [T.C. KİMLİK NO], [ADRES]
VEKİLİ              : Av. [AD SOYAD]
DAVALILAR           : 1. [AD SOYAD], [ADRES]
                      2. [AD SOYAD], [ADRES]`,
      subject: '[İL / İLÇE] [ADA / PARSEL] sayılı taşınmazdaki ortaklığın giderilmesi talebidir.',
      facts: [
        'Dava konusu taşınmaz müvekkil ile davalıların paylı / elbirliği mülkiyetindedir.',
        'Paydaşlar arasında taşınmazın kullanımı ve paylaşımı konusunda anlaşma sağlanamamaktadır.',
      ],
      legal: '4721 sayılı Türk Medeni Kanunu m. 698 ve 699 ve ilgili mevzuat.',
      evidence: `Tapu kayıtları, mirasçılık belgesi (varsa), keşif ve bilirkişi incelemesi, ${STANDART_DELILLER}`,
      request:
        'Taşınmazdaki ortaklığın aynen taksim, mümkün değilse satış suretiyle giderilmesine, yargılama giderlerinin paydaşlara payları oranında yükletilmesine karar verilmesini talep ederiz.',
    }),
  },
  {
    id: 'gayrimenkul-tapu-iptal',
    area: 'gayrimenkul',
    title: 'Tapu iptali ve tescil dava dilekçesi',
    description: 'TMK m. 1025, yolsuz tescil',
    body: petition({
      court: '[İL] NÖBETÇİ ASLİYE HUKUK MAHKEMESİ',
      parties: DAVA_TARAFLARI,
      subject: '[ADA / PARSEL] sayılı taşınmazın davalı adına olan tapu kaydının iptali ile müvekkil adına tescili talebidir.',
      facts: [
        'Dava konusu taşınmaz [EDİNİM ŞEKLİ] ile davalı adına tescil edilmiştir.',
        'Tescil [YOLSUZLUK NEDENİ, ör. muvazaa / vekâletin kötüye kullanılması] nedeniyle hukuki sebepten yoksundur.',
      ],
      legal: '4721 sayılı Türk Medeni Kanunu m. 1024 ve 1025, 6098 sayılı Türk Borçlar Kanunu ve ilgili mevzuat.',
      evidence: `Tapu kayıtları ve akit tabloları, vekâletname, keşif, bilirkişi, ${STANDART_DELILLER}`,
      request:
        'Taşınmazın davalı adına olan tapu kaydının iptali ile müvekkil adına tesciline, dava süresince taşınmaz üzerine ihtiyati tedbir konulmasına, yargılama giderleri ve vekâlet ücretinin davalıya yükletilmesine karar verilmesini talep ederiz.',
    }),
  },

  // Miras Hukuku
  {
    id: 'miras-mirascilik-belgesi',
    area: 'miras',
    title: 'Mirasçılık belgesi (veraset ilamı) talebi',
    description: 'TMK m. 598',
    body: petition({
      court: '[İL] NÖBETÇİ SULH HUKUK MAHKEMESİ',
      parties: `DAVACI              : [AD SOYAD], T.C. No: [T.C. KİMLİK NO], [ADRES]
VEKİLİ              : Av. [AD SOYAD]
MURİS               : [AD SOYAD], T.C. No: [T.C. KİMLİK NO], Ölüm tarihi: [TARİH]`,
      subject: 'Muris [AD SOYAD]\'ın mirasçılarını gösterir mirasçılık belgesi verilmesi talebidir.',
      facts: [
        'Müvekkilin [YAKINLIK DERECESİ] olan muris [ÖLÜM TARİHİ] tarihinde vefat etmiştir.',
        'Murisin yasal mirasçılarının ve paylarının tespitine ihtiyaç duyulmaktadır.',
      ],
      legal: '4721 sayılı Türk Medeni Kanunu m. 598 ve ilgili mevzuat.',
      evidence: 'Nüfus kayıtları (muris ve mirasçılar), ölüm belgesi.',
      request: 'Murisin mirasçılarını ve paylarını gösterir mirasçılık belgesi verilmesine karar verilmesini talep ederiz.',
    }),
  },
  {
    id: 'miras-reddi-miras',
    area: 'miras',
    title: 'Mirasın reddi dilekçesi',
    description: 'TMK m. 605-606, üç aylık süre içinde',
    body: petition({
      court: '[İL] NÖBETÇİ SULH HUKUK MAHKEMESİ',
      parties: `DAVACI              : [AD SOYAD], T.C. No: [T.C. KİMLİK NO], [ADRES]
VEKİLİ              : Av. [AD SOYAD]
MURİS               : [AD SOYAD], Ölüm tarihi: [TARİH]`,
      subject: 'Murisin mirasının kayıtsız şartsız reddedildiğinin tespiti ve tescili talebidir.',
      facts: [
        'Müvekkilin [YAKINLIK DERECESİ] olan muris [ÖLÜM TARİHİ] tarihinde vefat etmiştir.',
        'Müvekkil, ölümü ve mirasçı olduğunu [TARİH] tarihinde öğrenmiş olup yasal üç aylık süre içinde mirası reddetmektedir.',
      ],
      legal: '4721 sayılı Türk Medeni Kanunu m. 605, 606 ve 609 ve ilgili mevzuat.',
      evidence: 'Nüfus kayıtları, ölüm belgesi.',
      request:
        'Müvekkilin murisin mirasını kayıtsız şartsız reddettiğinin tespiti ile ret beyanının tesciline karar verilmesini talep ederiz.',
    }),
  },
];

export function listAreas() {
  return AREAS.map((a) => ({
    ...a,
    templates: TEMPLATES.filter((t) => t.area === a.id).map(({ body: _body, ...t }) => t),
  }));
}

export function getTemplate(id: string) {
  return TEMPLATES.find((t) => t.id === id) ?? null;
}
