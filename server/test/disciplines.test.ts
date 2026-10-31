import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as auth from '../src/auth.ts';
import * as cases from '../src/cases.ts';
import { openDb } from '../src/db.ts';
import { amounts, guessKind, reviewDocument, reviewForUser } from '../src/disciplines.ts';
import { ApiError } from '../src/errors.ts';

const ZAYIF = `Sayın Mahkeme,
Müvekkil işyerinde yaklaşık 3 yıl çalıştı, bazı alacakları ödenmedi vs. İşveren müvekkili tehdit etti.
Kıdem tazminatı 120.000 TL, ihbar tazminatı 30.000 TL, toplam 160.000 TL ödenmesini isteriz.`;

const IYI = `İSTANBUL ( ). İŞ MAHKEMESİ BAŞKANLIĞI'NA
DAVACI: Ali Veli (T.C. Kimlik No: 11111111111), Adres: Kadıköy
VEKİLİ: Av. Ayşe Yılmaz
DAVALI: Deniz İnşaat Ltd. Şti.
KONU: Kıdem ve ihbar tazminatı alacağı. Dava değeri: 150.000 TL
AÇIKLAMALAR:
1. Müvekkil 01.03.2022 tarihinde işe başlamış, 01.06.2025 tarihinde iş sözleşmesi feshedilmiştir.
2. Arabuluculuk son tutanağı 10.09.2025 tarihlidir (EK-1).
3. Kıdem tazminatı 120.000 TL, ihbar tazminatı 30.000 TL olmak üzere toplam 150.000 TL alacak vardır (EK-2). Ücret brüt 40.000 TL'dir.
HUKUKİ SEBEPLER: 4857 sayılı İş Kanunu m. 17, 1475 sayılı K. m.14, HMK m.107.
DELİLLER: Arabuluculuk tutanağı, SGK kayıtları, bilirkişi incelemesi, tanıklar: Mehmet Kaya (adres: Üsküdar), yemin ve her türlü yasal delil.
SONUÇ VE İSTEM: Fazlaya ilişkin haklarımız saklı kalmak kaydıyla 150.000 TL'nin fesih tarihinden itibaren en yüksek mevduat faizi ile davalıdan tahsiline, yargılama giderleri ve vekâlet ücretinin davalıya yükletilmesine karar verilmesini saygıyla arz ederiz.
Davacı Vekili Av. Ayşe Yılmaz (imza)`;

describe('çok disiplinli inceleme', () => {
  it('belge türünü ve tutarları tanır', () => {
    assert.equal(guessKind('Davaya cevap dilekçesi', ''), 'cevap');
    assert.equal(guessKind('', 'İSTANBUL 4. İCRA DAİRESİ MÜDÜRLÜĞÜNE takip talebi'), 'icra');
    assert.equal(guessKind('İhtarnameye cevap', ''), 'ihtar_cevap');
    assert.deepEqual(amounts('120.000 TL ve 1.250,50 TL ile ₺300 TL'), [120000, 1250.5, 300]);
  });

  it('sekiz disiplin çalışır; zayıf dilekçe ciddi eksik, iyi dilekçe daha yüksek puan alır', () => {
    const db = openDb();
    const weak = reviewDocument({ db, body: ZAYIF, kind: 'dava', today: '2026-10-31' });
    assert.equal(weak.disciplines.length, 8);
    assert.equal(weak.disciplines[7].id, 'genel');
    assert.equal(weak.summary.verdict, 'ciddi');
    const texts = weak.disciplines.flatMap((d) => d.findings.map((f) => f.text)).join('\n');
    assert.match(texts, /SONUÇ VE İSTEM/);
    assert.match(texts, /arabuluculuk/i);
    assert.match(texts, /tehdit/);
    assert.match(texts, /DELİLLER/);
    assert.match(texts, /150\.000 TL\) ile yazılan toplam \(160\.000/);
    const good = reviewDocument({ db, body: IYI, kind: 'dava', today: '2026-10-31' });
    assert.ok(good.summary.score > weak.summary.score + 30, `${good.summary.score} vs ${weak.summary.score}`);
    assert.equal(good.summary.critical, 0, JSON.stringify(good.summary.priorities));
  });

  it('dava dosyasıyla birlikte inceler ve boş metni reddeder', () => {
    const db = openDb();
    const a = auth.registerOffice(db, { officeName: 'A', name: 'Av. Bir', email: 'a@t.local', password: 'sifre1234' }).user;
    const c = cases.createCase(db, a, { title: 'Veli / Deniz', area: 'is', client: 'Ali Veli', court: 'İstanbul 5. İş Mahkemesi' });
    const r = reviewForUser(db, a, { body: IYI, caseId: c.id, title: 'Dava dilekçesi' });
    assert.equal(r.kind, 'dava');
    assert.ok(r.disciplines[6].findings.some((f) => /ek anılıyor/.test(f.text)));
    assert.throws(() => reviewForUser(db, a, { body: '  ' }), (e: unknown) => e instanceof ApiError && e.status === 400);
  });
});
