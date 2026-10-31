import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import * as auth from '../src/auth.ts';
import * as cases from '../src/cases.ts';
import { openDb, type DB } from '../src/db.ts';
import { risks } from '../src/deadlines.ts';
import { ApiError } from '../src/errors.ts';
import * as poa from '../src/poa.ts';

const status = (code: number) => (err: unknown) => err instanceof ApiError && err.status === code;

const SCAN = `İSTANBUL 12. NOTERLİĞİ
Yevmiye No: 34567   Tarih: 14.03.2025
VEKALETNAME
Ben Ayşe Yılmaz, Av. Mehmet Kaya'yı vekil tayin ettim. Vekilim davaları takip etmeye, ahzu kabza, sulh olmaya,
davadan feragate, davayı kabule, ibraya, hakem tayinine, yemin teklifine, haciz ve icra takibi yapmaya,
başkasını tevkile ve azle yetkilidir.
İstanbul 12. Noterliği`;

describe('vekâletname yönetimi', () => {
  let db: DB;
  let lawyer: auth.User;
  let stranger: auth.User;
  let caseId: number;

  beforeEach(() => {
    db = openDb();
    lawyer = auth.registerOffice(db, { officeName: 'A', name: 'Av. Bir', email: 'a@t.local', password: 'sifre1234' }).user;
    stranger = auth.registerOffice(db, { officeName: 'B', name: 'Yabancı', email: 'c@t.local', password: 'sifre1234' }).user;
    caseId = cases.createCase(db, lawyer, { title: 'Yılmaz / Deniz İnşaat', area: 'is' }).id;
  });

  it('taranmış vekâletnameden noter, yevmiye, tarih ve özel yetkileri çıkarır', () => {
    const p = poa.parsePoaText(SCAN);
    assert.equal(p.journalNo, '34567');
    assert.equal(p.issueDate, '2025-03-14');
    assert.match(p.notary, /İstanbul 12\. Noterliği/i);
    for (const k of ['ahzu_kabz', 'sulh', 'feragat', 'kabul', 'ibra', 'tahkim', 'yemin', 'haciz', 'tevkil']) assert.ok(p.powers.includes(k), k);
    assert.equal(poa.parsePoaText('12 Ocak 2024 tarihli genel vekaletname').issueDate, '2024-01-12');
    // Taramada başlık büyük harf olur
    const up = poa.parsePoaText("İSTANBUL 12. NOTERLİĞİ\nYevmiye No: 34567\nBen Ayşe Yılmaz, Av. Mehmet Kaya'yı vekil tayin ettim.");
    assert.equal(up.notary, 'İstanbul 12. Noterliği');
    assert.equal(up.client, 'Ayşe Yılmaz');
    assert.equal(up.lawyers, 'Av. Mehmet Kaya');
  });

  it('kaydedilir, davaya bağlanır; azilde açık dosya için uyarı verir; başka büro göremez', () => {
    // Vekâletnamesi olmayan açık dosya uyarısı
    assert.ok(risks(db, lawyer).some((r) => r.area === 'Vekâletname' && /1 açık dosyada/.test(r.title)));
    const v = poa.createPoa(db, lawyer, {
      client: 'Ayşe Yılmaz',
      journalNo: '34567',
      issueDate: '2025-03-14',
      powers: ['ahzu_kabz', 'sulh', 'yok-boyle-yetki'],
      caseIds: [caseId],
      fileName: 'vekalet.jpg',
      mimeType: 'image/jpeg',
      fileBase64: Buffer.from('resim').toString('base64'),
      text: SCAN,
    });
    assert.deepEqual(v.powers, ['ahzu_kabz', 'sulh']);
    assert.equal(v.cases[0].id, caseId);
    assert.equal(poa.listPoas(db, lawyer, { caseId: String(caseId) }).length, 1);
    assert.equal(Buffer.from((poa.getPoa(db, lawyer, v.id, true) as { fileBase64: string }).fileBase64, 'base64').toString(), 'resim');
    assert.ok(!risks(db, lawyer).some((r) => r.area === 'Vekâletname'));
    assert.throws(() => poa.getPoa(db, stranger, v.id), status(404));
    assert.throws(() => poa.createPoa(db, stranger, { client: 'X', caseIds: [caseId] }), status(400));

    const azil = poa.updatePoa(db, lawyer, v.id, { status: 'azil', statusDate: '2026-10-01' });
    assert.equal(azil.status, 'azil');
    const r = risks(db, lawyer).filter((x) => x.area === 'Vekâletname');
    assert.ok(r.some((x) => x.level === 'yuksek' && /Azledilen/.test(x.title)));
    assert.throws(() => poa.updatePoa(db, lawyer, v.id, { status: 'iptal' }), status(400));
  });

  it('süresi dolan ve dolmak üzere olan vekâletnameyi uyarır', () => {
    const past = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    const soon = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10);
    poa.createPoa(db, lawyer, { client: 'Eski', expiryDate: past });
    poa.createPoa(db, lawyer, { client: 'Yakın', expiryDate: soon });
    const r = risks(db, lawyer).filter((x) => x.area === 'Vekâletname');
    assert.ok(r.some((x) => x.level === 'yuksek' && /süresi doldu: Eski/.test(x.title)));
    assert.ok(r.some((x) => x.level === 'orta' && /süresi doluyor: Yakın/.test(x.title)));
  });
});
