import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import * as auth from '../src/auth.ts';
import * as contracts from '../src/contracts.ts';
import * as groups from '../src/contractgroups.ts';
import { openDb, type DB } from '../src/db.ts';
import { ApiError } from '../src/errors.ts';

const KOTU = `ARSA PAYI KARŞILIĞI İNŞAAT SÖZLEŞMESİ
Madde 3 - Konu
Arsa sahibi, %60 oranında arsa payını yükleniciye devretmeyi kabul eder.
Madde 5 - Süre
Yüklenici, yapı ruhsatının alınmasından itibaren 36 ay içinde yapıyı teslim edecektir.
Madde 7 - Tapu devri
Yükleniciye düşen arsa payları sözleşmenin imza tarihinde tapuda devredilir.
Madde 9 - Devir
Yüklenici, sözleşmeyi dilediği alt yükleniciye devredebilir.
Madde 10 - Uyuşmazlık
Uyuşmazlıklarda Londra Tahkim Mahkemeleri yetkilidir ve tazminat sınırı yoktur. Gecikmede 818 sayılı Borçlar Kanunu uygulanır.`;

const IYI = `ARSA PAYI KARŞILIĞI İNŞAAT SÖZLEŞMESİ
Bu sözleşme noterde düzenleme şeklinde yapılmıştır.
Madde 3 - Paylaşım
Arsa sahibine %55 oranında bağımsız bölüm kalacaktır.
Madde 5 - Süre
Yüklenici, yapı ruhsatının alınmasından itibaren 20 ay içinde yapıyı iskân alınmış olarak teslim etmekle yükümlüdür.
Madde 6 - Gecikme
Teslimin gecikmesi halinde yüklenici, geciken her ay için bağımsız bölüm başına 30.000 TL ödemekle yükümlüdür.
Madde 7 - Tapu
Arsa payları inşaatın ilerleme oranına göre aşamalı olarak devredilir.
Madde 8 - Teminat
Yüklenici 2.000.000 TL teminat mektubu verecektir. Yüklenici, sözleşmeyi devredemez. Yapı all-risk sigortası yaptırılır.
Proje değişiklikleri arsa sahibinin onayına bağlıdır. Yüklenici ayıplardan ve deprem yönetmeliğine uygunluktan sorumludur. Vergi ve harçlar yükleniciye aittir.
Mücbir sebep hallerinde süre uzar. Arsa sahibi gecikmede sözleşmeyi feshedebilir.
Madde 10 - Uyuşmazlık
Uyuşmazlıklarda İstanbul Mahkemeleri yetkilidir.`;

describe('sözleşme dosyaları ve yaşam döngüsü', () => {
  let db: DB;
  let a: auth.User;
  let b: auth.User;

  beforeEach(() => {
    db = openDb();
    a = auth.registerOffice(db, { officeName: 'A', name: 'Av. Bir', email: 'a@t.local', password: 'sifre1234' }).user;
    b = auth.registerOffice(db, { officeName: 'B', name: 'Av. İki', email: 'b@t.local', password: 'sifre1234' }).user;
  });

  it('toplu sözleşme ekler; her birinin riskini, toplu riski ve ortak sorunları çıkarır', () => {
    const g = groups.createGroup(db, a, { title: 'Kadıköy projesi', kind: 'kat-karsiligi', side: 'arsa_sahibi' });
    const r = groups.bulkAdd(db, a, g.id, {
      items: [
        { title: 'Daire sahibi 1', body: KOTU, value: 1000000 },
        { title: 'Daire sahibi 2', body: KOTU, value: 1000000 },
        { title: 'Daire sahibi 3', body: IYI, value: 1000000 },
      ],
    });
    assert.equal(r.summary.count, 3);
    assert.equal(r.summary.reviewed, 3);
    const [k1, , i3] = r.contracts;
    assert.ok(k1.risk!.genel > i3.risk!.genel);
    assert.equal(r.summary.max, k1.risk!.genel);
    assert.ok(r.summary.toplu >= r.summary.average && r.summary.toplu <= r.summary.max);
    assert.equal(r.summary.worst!.id, k1.id);
    // Kötü sözleşmelerdeki sorun iki sözleşmede birden görünür ve en üstte yer alır.
    assert.equal(r.common[0].contracts.length >= 2, true);
    assert.equal(r.summary.value_kurus, 300000000);
    assert.equal(contracts.listContracts(db, a).filter((c: any) => c.group_id === g.id).length, 3);
    assert.throws(() => groups.getGroup(db, b, g.id), (e: unknown) => e instanceof ApiError && e.status === 404);
    groups.deleteGroup(db, a, g.id);
    assert.equal(contracts.listContracts(db, a).length, 3);
  });

  it('fesih açık taahhütleri kapatır; yenileme yeni sözleşme açar; ek sözleşme bağlanır', () => {
    const c = contracts.createContract(db, a, { title: 'Kira', kind: 'kira-konut', body: 'Kira sözleşmesi', parties: 'Ali / Veli', status: 'yururlukte' });
    contracts.addObligation(db, a, c.id, { text: 'Kira ödemesi', dueDate: '2026-12-01', amount: '10000' });
    contracts.addObligation(db, a, c.id, { text: 'Depozito iadesi', dueDate: '2027-01-01' });

    const ek = groups.addAddendum(db, a, c.id, {});
    assert.match(ek.body, /EK SÖZLEŞME – 1/);
    const rel = groups.relations(db, a, c.id);
    assert.equal(rel.children.length, 1);

    const renewed = groups.renewContract(db, a, c.id, { carryObligations: true });
    assert.equal(renewed.carriedObligations, 2);
    assert.equal(renewed.contract.obligations.length, 2);
    const old = contracts.getContract(db, a, c.id);
    assert.equal(old.status, 'sona_erdi');
    assert.ok(old.obligations.every((o: any) => o.done === 1));
    assert.equal((groups.relations(db, a, renewed.contract.id).parent as { id: number }).id, c.id);

    const t = groups.terminateContract(db, a, renewed.contract.id, { date: '2026-11-15', reason: 'Kira bedeli ödenmedi.' });
    assert.equal(t.closedObligations, 2);
    assert.match(t.notice, /15\.11\.2026/);
    assert.match(t.notice, /Kira bedeli ödenmedi/);
    assert.throws(() => groups.terminateContract(db, a, renewed.contract.id, {}), (e: unknown) => e instanceof ApiError && e.status === 400);
  });
});
