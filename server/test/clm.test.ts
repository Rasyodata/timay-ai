import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import * as auth from '../src/auth.ts';
import * as clm from '../src/clm.ts';
import * as contracts from '../src/contracts.ts';
import { openDb, type DB } from '../src/db.ts';
import { diffWords } from '../src/diff.ts';
import { buildDocx, readDocx } from '../src/docx.ts';
import { ApiError } from '../src/errors.ts';
import { risks } from '../src/deadlines.ts';

const status = (code: number) => (e: unknown) => e instanceof ApiError && e.status === code;

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

describe('sözleşme zırhı', () => {
  let db: DB;
  let a: auth.User;
  let b: auth.User;

  beforeEach(() => {
    db = openDb();
    a = auth.registerOffice(db, { officeName: 'A', name: 'Av. Bir', email: 'a@t.local', password: 'sifre1234' }).user;
    const { token } = auth.createInvite(db, a, { email: 'b@t.local', role: 'avukat' });
    b = auth.acceptInvite(db, { token, name: 'Av. İki', password: 'sifre1234' }).user;
  });

  it('arsa sahibi aleyhine kat karşılığını yüksek risk sayar', () => {
    const r = clm.reviewText(KOTU, 'kat-karsiligi', 'arsa_sahibi', clm.DEFAULT_PLAYBOOK);
    assert.equal(r.band, 'yuksek');
    const t = (k: string) => r.findings.find((f) => f.key === k)!;
    assert.equal(t('pay').verdict, 'aleyhte');
    assert.match(t('pay').title, /%40/);
    assert.equal(t('teslim').verdict, 'aleyhte');
    assert.equal(t('tapu').verdict, 'aleyhte');
    assert.equal(t('devir').verdict, 'aleyhte');
    assert.equal(t('yetki').verdict, 'aleyhte');
    assert.equal(t('sorumluluk').verdict, 'aleyhte');
    assert.equal(t('noter').verdict, 'eksik');
    assert.ok(r.findings.some((f) => f.verdict === 'mevzuat' && /818/.test(f.title)));
  });

  it('lehte sözleşmeyi düşük risk sayar; yüklenici tarafından bakınca tersine döner', () => {
    const r = clm.reviewText(IYI, 'kat-karsiligi', 'arsa_sahibi', clm.DEFAULT_PLAYBOOK);
    assert.equal(r.band, 'dusuk', JSON.stringify(r.findings.filter((f) => f.verdict !== 'lehte')));
    assert.ok(r.findings.filter((f) => f.verdict === 'lehte').length >= 6);
    const y = clm.reviewText(IYI, 'kat-karsiligi', 'yuklenici', clm.DEFAULT_PLAYBOOK);
    assert.equal(y.findings.find((f) => f.key === 'tapu')!.verdict, 'aleyhte');
  });

  it('kural bankası ve kütüphane: eşik değişince sonuç değişir, maddeyle tek tıkla düzeltilir', () => {
    const pb = clm.savePlaybook(db, a, { maxDeliveryMonths: '40' } as never);
    assert.equal(pb.maxDeliveryMonths, 40);
    const c = contracts.createContract(db, a, { title: 'Kat karşılığı', kind: 'kat-karsiligi', body: KOTU });
    clm.setSide(db, a, c.id, 'arsa_sahibi');
    let review = clm.contractReview(db, a, c.id);
    assert.equal(review.findings.find((f) => f.key === 'teslim')!.verdict, 'lehte');
    const yetki = review.findings.find((f) => f.key === 'yetki')!;
    const clause = review.suggestions.yetki[0];
    assert.match(clause.body, /İstanbul/);
    review = clm.applyClause(db, a, c.id, { quote: yetki.quote, clauseId: clause.id }).review;
    assert.equal(review.findings.find((f) => f.key === 'yetki')!.verdict, 'lehte');
    // Eksik madde sona eklenir.
    review = clm.applyClause(db, a, c.id, { clauseId: review.suggestions.noter[0].id }).review;
    assert.equal(review.findings.find((f) => f.key === 'noter'), undefined);
  });

  it('içtihat riski ve taraflara göre risk: arsa sahibi ve yüklenici ayrı puanlanır', () => {
    const c = contracts.createContract(db, a, { title: 'Kat karşılığı', kind: 'kat-karsiligi', body: KOTU });
    clm.setSide(db, a, c.id, 'arsa_sahibi');
    const r = clm.contractReview(db, a, c.id);
    assert.ok(r.precedents.length >= 4);
    const kira = r.precedents.find((p) => p.id === 'kira-kaybi')!;
    assert.equal(kira.direction, 'lehte');
    assert.equal(r.precedents.find((p) => p.id === 'cezai-indirim')?.direction ?? 'aleyhte', 'aleyhte');
    assert.ok(r.risk.ictihat < 50, `arsa sahibi lehine içtihat ağır basmalı: ${r.risk.ictihat}`);
    assert.equal(r.risk.genel, Math.round(r.risk.madde * 0.75 + r.risk.ictihat * 0.25));
    assert.equal(r.parties.length, 2);
    const owner = r.parties.find((p) => p.side === 'arsa_sahibi')!;
    const builder = r.parties.find((p) => p.side === 'yuklenici')!;
    assert.ok(owner.genel > builder.genel, `kötü sözleşme arsa sahibi için daha riskli: ${owner.genel} / ${builder.genel}`);
    assert.equal(owner.genel, r.risk.genel);
    // Taraf belli değilse içtihat puanı nötrdür ve genel risk madde riskine eşittir.
    clm.setSide(db, a, c.id, 'genel');
    const g = clm.contractReview(db, a, c.id);
    assert.equal(g.risk.genel, g.risk.madde);
    assert.ok(g.precedents.every((p) => p.direction === 'notr'));
  });

  it('Word belgesini değişiklikleri izle işaretiyle üretir ve geri okur', () => {
    const buf = buildDocx(diffWords('Bedel 100 TL\nİkinci madde', 'Bedel 150 TL\nİkinci madde & ek'), 'Büro');
    const d = readDocx(buf);
    assert.equal(d.accepted, 'Bedel 150 TL\nİkinci madde & ek');
    assert.equal(d.rejected, 'Bedel 100 TL\nİkinci madde');
    assert.ok(d.trackedChanges >= 2);
    assert.deepEqual(d.authors, ['Büro']);
  });

  it('karşı tarafın gizli değişikliğini yakalar', () => {
    const c = contracts.createContract(db, a, { title: 'Hizmet', kind: 'hizmet', body: 'Madde 4 - Bedel\nBedel aylık 100.000 TL olup 30 gün içinde ödenir.' });
    clm.exportRedline(db, a, c.id); // gönderdiğimiz versiyon
    // Karşı taraf bedeli izlenen değişiklikle değil sessizce değiştirdi, ödeme süresini ise izlenen değişiklikle.
    const theirs = buildDocx(
      diffWords('Madde 4 - Bedel\nBedel aylık 1.000.000 TL olup 30 gün içinde ödenir.', 'Madde 4 - Bedel\nBedel aylık 1.000.000 TL olup 60 gün içinde ödenir.'),
      'Karşı Taraf',
    );
    const r = clm.uploadVersion(db, a, c.id, { fileName: 'donus.docx', fileBase64: theirs.toString('base64') });
    assert.equal(r.trackedChanges, 2);
    assert.equal(r.hidden.length, 1);
    assert.match(r.hidden[0].added, /1\.000\.000/);
    assert.match(r.hidden[0].context, /Madde 4/);
    assert.match(contracts.getContract(db, a, c.id).body, /60 gün/);
    const versions = clm.listVersions(db, a, c.id);
    assert.equal(versions[0].source, 'karsi');
  });

  it('imza: meslektaş onayı olmadan kilitlenmez, sırayla imzalanır, sonunda takvim çıkar', () => {
    const c = contracts.createContract(db, a, { title: 'Kat karşılığı', kind: 'kat-karsiligi', body: IYI });
    assert.throws(() => clm.lockContract(db, a, c.id, { signers: [{ name: 'Arsa sahibi' }] }), status(400));
    contracts.submitContract(db, a, c.id);
    contracts.reviewContract(db, b, c.id, { action: 'approve' });
    const s = clm.lockContract(db, a, c.id, { signers: [{ name: 'Arsa sahibi' }, { name: 'Yüklenici' }] });
    assert.throws(() => contracts.updateContract(db, a, c.id, { body: 'değişti' }), status(400));
    assert.throws(() => clm.markSigned(db, a, c.id, s.signers[1].id), status(400));
    clm.markSigned(db, a, c.id, s.signers[0].id, '2026-01-10');
    const done = clm.markSigned(db, a, c.id, s.signers[1].id, '2026-01-15');
    assert.equal(done.next, null);
    assert.equal(done.schedule!.needsPermitDate, true);
    const got = contracts.getContract(db, a, c.id);
    assert.equal(got.status, 'yururlukte');
    assert.equal(got.start_date, '2026-01-15');
    const sched = clm.buildSchedule(db, a, c.id, { ruhsatDate: '2026-03-01' });
    assert.equal(sched.added, 1);
    assert.equal(sched.items[0].due_date, '2027-11-01');
  });

  it('gecikme alarmı: aylık tazminatı bağımsız bölüm sayısıyla hesaplar ve ihtarname taslağı üretir', () => {
    const c = contracts.createContract(db, a, { title: 'Kat karşılığı', kind: 'kat-karsiligi', body: IYI, startDate: '2024-01-01' });
    clm.buildSchedule(db, a, c.id, { ruhsatDate: '2024-01-01' });
    clm.setUnits(db, a, c.id, 4);
    const al = clm.alarms(db, a, c.id, '2025-10-15');
    assert.equal(al.length, 1);
    assert.equal(al[0].obligation.due_date, '2025-09-01');
    assert.equal(al[0].days, 44);
    assert.equal(al[0].penalty, 2 * 30_000 * 4);
    const n = clm.noticeDraft(db, a, c.id, al[0].obligation.id, '2025-10-15');
    assert.match(n.text, /İHTARNAME/);
    assert.match(n.text, /240\.000,00 TL/);
  });

  it('otomatik uzayan sözleşme için bitişten 60 gün önce fesih ihbarı uyarısı verir', () => {
    const end = new Date(Date.now() + 50 * 86_400_000).toISOString().slice(0, 10);
    const c = contracts.createContract(db, a, {
      title: 'Tedarik',
      body: 'Taraflardan biri bitişten 30 gün önce yazılı bildirimde bulunmazsa sözleşme kendiliğinden bir yıl uzar.',
      startDate: '2025-01-01',
      endDate: end,
    });
    contracts.updateContract(db, a, c.id, { status: 'yururlukte' });
    const r = risks(db, a).find((x) => x.title.startsWith('Otomatik uzayacak'));
    assert.ok(r);
    assert.match(r!.detail, /fesih ihbarı/);
  });

  it('mevzuat denetimi: eski deprem yönetmeliği ve %9 yasal faiz', () => {
    const r = clm.reviewText('Yapı 2007 Deprem Yönetmeliğine uygun yapılır. Gecikmede yıllık %9 yasal faiz işler.', 'kat-karsiligi', 'arsa_sahibi', clm.DEFAULT_PLAYBOOK);
    const titles = r.findings.filter((f) => f.verdict === 'mevzuat').map((f) => f.title).join(' | ');
    assert.match(titles, /deprem/);
    assert.match(titles, /%9/);
  });
});
