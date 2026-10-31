import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import * as auth from '../src/auth.ts';
import * as cases from '../src/cases.ts';
import * as contracts from '../src/contracts.ts';
import { openDb, type DB } from '../src/db.ts';
import { upsertDecision, searchArchive } from '../src/decisions.ts';
import { buildUdf, readDocx, readUdf, plainDocx } from '../src/docx.ts';
import * as mevzuat from '../src/mevzuat.ts';
import * as petitions from '../src/petitions.ts';

describe('içtihat uygunluğu, mevzuat takibi ve dışa aktarma', () => {
  let db: DB;
  let a: auth.User;
  let b: auth.User;

  beforeEach(() => {
    db = openDb();
    a = auth.registerOffice(db, { officeName: 'A', name: 'Av. Bir', email: 'a@t.local', password: 'sifre1234' }).user;
    b = auth.registerOffice(db, { officeName: 'B', name: 'Av. İki', email: 'b@t.local', password: 'sifre1234' }).user;
  });

  it('kanun maddesi atıflarını tanır', () => {
    const refs = mevzuat.extractArticles("TBK 117 uyarınca temerrüt; HMK m. 127 süre; 6098 sayılı Türk Borçlar Kanunu'nun 344. maddesi; İş K. 18/1; TBK 9999");
    const labels = refs.map((r) => r.label);
    assert.deepEqual(labels.sort(), ['HMK m.127', 'TBK m.117', 'TBK m.344', 'İş K. m.18'].sort());
  });

  it('arşiv aramasında uygunluk yüzdesine göre sıralar ve maddeleri gösterir', () => {
    upsertDecision(db, { court: 'Yargıtay', chamber: '9. HD', esasNo: '2020/1', kararNo: '2021/1', decisionDate: '2021-01-01', text: 'Kıdem tazminatı hesabında İş K. 32 ve TBK 117 uygulanır. Kıdem tazminatı faizi.' });
    upsertDecision(db, { court: 'Yargıtay', chamber: '9. HD', esasNo: '2020/2', kararNo: '2021/2', decisionDate: '2022-01-01', text: 'Davacının kıdem talebi ve tazminatı reddedilmiştir.' });
    const r = searchArchive(db, { q: 'kıdem tazminatı' });
    const items = r.items as unknown as { esas_no: string; relevance: number; articles: string[] }[];
    assert.equal(items[0].esas_no, '2020/1');
    assert.ok(items[0].relevance > items[1].relevance);
    assert.ok(items[0].articles.includes('TBK m.117'));
  });

  it('mevzuat değişikliği etkilenen sözleşme ve dilekçeleri bulur', () => {
    contracts.createContract(db, a, { title: 'Kira', kind: 'kira', body: 'Kira artışı TBK 344 uyarınca TÜFE ile sınırlıdır.' });
    contracts.createContract(db, a, { title: 'Hizmet', kind: 'hizmet', body: 'Uyuşmazlıkta HMK uygulanır.' });
    const c = cases.createCase(db, a, { title: 'Kira tespit' }) as { id: number };
    petitions.createPetition(db, a, { caseId: c.id, title: 'Kira tespit dilekçesi', body: "6098 sayılı Türk Borçlar Kanunu'nun 344. maddesi gereğince..." });
    const ch = mevzuat.createChange(db, a, { law: 'TBK', articles: '344', summary: 'Kira artış sınırı değişti', effectiveDate: '2026-07-01' })!;
    assert.equal(ch.affected, 2);
    assert.deepEqual(ch.impact.map((i) => i.type).sort(), ['contract', 'petition']);
    assert.equal(mevzuat.listChanges(db, b).length, 0);
  });

  it('UDF ve Word çıktısı metni geri okunabilir üretir', () => {
    const text = 'İSTANBUL 5. İŞ MAHKEMESİ\n\nDAVACI: Ali Veli\nKıdem tazminatı talebimizdir.';
    assert.equal(readUdf(buildUdf(text)), text);
    assert.match(readDocx(plainDocx(text)).accepted, /Kıdem tazminatı/);
  });
});
