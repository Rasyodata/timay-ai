import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as auth from '../src/auth.ts';
import * as cases from '../src/cases.ts';
import { openDb } from '../src/db.ts';
import { amounts, guessKind, reviewDocument, reviewForUser, reviewWithAnalysis } from '../src/disciplines.ts';
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

  it('on ajan çalışır; zayıf dilekçe ciddi eksik, iyi dilekçe daha yüksek puan alır', () => {
    const db = openDb();
    const weak = reviewDocument({ db, body: ZAYIF, kind: 'dava', today: '2026-10-31' });
    assert.equal(weak.disciplines.length, 10);
    assert.deepEqual(weak.disciplines.map((d) => d.id), ['avukat', 'savci', 'hakim', 'karsi', 'bilirkisi', 'sure', 'delil', 'mevzuat', 'ictihat', 'genel']);
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

  it('mevzuat ajanı olmayan maddeyi ve büronun kaydettiği değişikliği yakalar', () => {
    const db = openDb();
    const a = auth.registerOffice(db, { officeName: 'M', name: 'Av. Bir', email: 'm@t.local', password: 'sifre1234' }).user;
    db.prepare("INSERT INTO law_changes (office_id, law, articles, title, effective_date) VALUES (?, 'HMK', '107', 'Belirsiz alacak davası değişti', '2026-06-01')").run(a.office_id);
    const r = reviewForUser(db, a, { body: IYI, kind: 'dava' });
    const mev = r.disciplines.find((d) => d.id === 'mevzuat')!;
    assert.ok(mev.findings.some((f) => /HMK m\.107 değişmiş/.test(f.text)), JSON.stringify(mev.findings));
    const bad = reviewForUser(db, a, { body: 'TBK m.9999 uyarınca talep ederiz.', kind: 'dava' });
    assert.ok(bad.disciplines.find((d) => d.id === 'mevzuat')!.findings.some((f) => f.level === 'kritik'));
    assert.ok(bad.disciplines.find((d) => d.id === 'ictihat')!.findings.some((f) => /Yargıtay/.test(f.text)));
  });

  it('derin analiz: yapay zekâ yoksa standart sonuç ve açıklama döner; varsa ajan bulguları eklenir', async () => {
    const db = openDb();
    const a = auth.registerOffice(db, { officeName: 'D', name: 'Av. Bir', email: 'd@t.local', password: 'sifre1234' }).user;
    const off = await reviewWithAnalysis(db, a, { body: IYI, analysis: 'derin' }, null);
    assert.equal(off.analysis, 'standart');
    assert.match(off.note ?? '', /yapay zekâ bağlantısı/);
    let seen = '';
    const model = async (req: { system: string; messages: { content: string }[] }) => {
      seen = req.system + req.messages[0].content;
      return {
        model: 'test',
        text: JSON.stringify({
          agents: [
            { id: 'sure', findings: [{ level: 'kritik', text: 'Hak düşürücü süre geçmiş olabilir.', basis: 'TMK m.1', quote: 'işe başlamış' }] },
            { id: 'ictihat', findings: [{ level: 'uyari', text: 'Güncel HGK kararı eklenmeli.', basis: '', quote: 'uydurma cümle' }] },
          ],
        }),
      };
    };
    const deep = await reviewWithAnalysis(db, a, { body: IYI, analysis: 'derin', side: 'karsi' }, model);
    assert.equal(deep.analysis, 'derin');
    assert.equal(deep.ai, true);
    assert.match(seen, /KARŞI TARAFIN/);
    const sure = deep.disciplines.find((d) => d.id === 'sure')!;
    assert.ok(sure.findings.some((f) => f.ai && f.verified && f.level === 'kritik'));
    assert.ok(deep.disciplines.find((d) => d.id === 'ictihat')!.findings.some((f) => f.ai && f.verified === false));
    assert.match(deep.summary.verdictLabel, /Karşı tarafın/);
    const failing = async () => {
      throw new Error('bağlantı yok');
    };
    const fb = await reviewWithAnalysis(db, a, { body: IYI, analysis: 'derin' }, failing);
    assert.equal(fb.analysis, 'standart');
    assert.match(fb.note ?? '', /bağlantı yok/);
  });
});
