import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import * as auth from '../src/auth.ts';
import * as cases from '../src/cases.ts';
import { openDb, type DB } from '../src/db.ts';
import * as deadlines from '../src/deadlines.ts';
import { upsertDecision } from '../src/decisions.ts';
import { analyzeFacts, matchConcepts } from '../src/emsal.ts';
import { ApiError } from '../src/errors.ts';
import * as finance from '../src/finance.ts';
import * as tebligat from '../src/tebligat.ts';
import * as timesheet from '../src/timesheet.ts';

const status = (code: number) => (e: unknown) => e instanceof ApiError && e.status === code;

let db: DB;
let lawyer: auth.User;
let stranger: auth.User;

beforeEach(() => {
  db = openDb();
  lawyer = auth.registerOffice(db, { officeName: 'A', name: 'Av. Bir', email: 'a@t.local', password: 'sifre1234' }).user;
  stranger = auth.registerOffice(db, { officeName: 'B', name: 'Yabancı', email: 'b@t.local', password: 'sifre1234' }).user;
});

describe('tebligat takibi', () => {
  it('e-tebligatta tebliğ 5. gün, ilanda 7. gün sayılır; posta aynı gün', () => {
    assert.equal(tebligat.servedDate('e-tebligat', '2026-11-02'), '2026-11-07');
    assert.equal(tebligat.servedDate('ilan', '2026-11-02'), '2026-11-09');
    assert.equal(tebligat.servedDate('posta', '2026-11-02'), '2026-11-02');
    assert.throws(() => tebligat.servedDate('posta', '02.11.2026'), status(400));
  });

  it('evraka ve alana göre süre önerir', () => {
    assert.equal(tebligat.suggestRule('Gerekçeli karar'), 'hmk-istinaf');
    assert.equal(tebligat.suggestRule('Gerekçeli karar', 'ceza'), 'cmk-istinaf');
    assert.equal(tebligat.suggestRule('Bölge Adliye Mahkemesi kararı'), 'hmk-temyiz');
    assert.equal(tebligat.suggestRule('Dava dilekçesi ve tensip zaptı'), 'hmk-cevap');
    assert.equal(tebligat.suggestRule('Bilirkişi raporu'), 'hmk-bilirkisi');
    assert.equal(tebligat.suggestRule('Ödeme emri (kambiyo senetlerine)'), 'iik-kambiyo');
    assert.equal(tebligat.suggestRule('Duruşma davetiyesi'), tebligat.NO_DEADLINE);
  });

  it('tebligatı kaydeder, süreyi takibe alır; işlenmeyen tebligat risk olur', () => {
    const caseId = cases.createCase(db, lawyer, { title: 'Alacak davası' }).id;
    const received = new Date(Date.now() - 20 * 86_400_000).toISOString().slice(0, 10);
    const t = tebligat.createTebligat(db, lawyer, { caseId, channel: 'e-tebligat', subject: 'Gerekçeli karar', receivedDate: received, sender: 'İstanbul 3. Asliye Hukuk Mahkemesi' });
    assert.equal(t.status, 'islenmedi');
    assert.equal(t.rule_id, 'hmk-istinaf');
    assert.ok(deadlines.risks(db, lawyer).some((r) => r.area === 'Tebligat'));
    assert.equal(deadlines.risks(db, stranger).filter((r) => r.area === 'Tebligat').length, 0);
    assert.throws(() => tebligat.trackTebligat(db, stranger, t.id, {}), status(404));

    const tracked = tebligat.trackTebligat(db, lawyer, t.id, {});
    assert.equal(tracked.status, 'takipte');
    const d = deadlines.listDeadlines(db, lawyer) as { id: number; start_date: string; case_id: number; title: string }[];
    assert.equal(d.length, 1);
    assert.equal(d[0].start_date, tebligat.servedDate('e-tebligat', received));
    assert.equal(d[0].case_id, caseId);
    assert.match(d[0].title, /İstinaf/);
    assert.ok(!deadlines.risks(db, lawyer).some((r) => r.area === 'Tebligat'));
    assert.throws(() => tebligat.trackTebligat(db, lawyer, t.id, {}), status(400));

    // Süre doğurmayan tebligat risk sayılmaz.
    tebligat.createTebligat(db, lawyer, { subject: 'Duruşma davetiyesi', receivedDate: received });
    assert.ok(!deadlines.risks(db, lawyer).some((r) => r.area === 'Tebligat'));
  });

  it('track ile tek adımda süre oluşturur; silinen süre tebligatı serbest bırakır', () => {
    const t = tebligat.createTebligat(db, lawyer, { subject: 'Bilirkişi raporu', channel: 'posta', receivedDate: '2026-10-30', track: true });
    assert.equal(t.status, 'takipte');
    deadlines.deleteDeadline(db, lawyer, t.deadline_id!);
    assert.equal(tebligat.listTebligat(db, lawyer)[0].status, 'islenmedi');
  });

  it('UETS listesini satırlara ayırır ve esas numarasıyla dosyayı eşleştirir', () => {
    const caseId = cases.createCase(db, lawyer, { title: 'Kira davası', esasNo: '2025/412' } as never).id;
    db.prepare("UPDATE cases SET esas_no = '2025/412' WHERE id = ?").run(caseId);
    const rows = tebligat.parseList(
      db,
      lawyer,
      `Ankara 5. Sulh Hukuk Mahkemesi 2025/412 Esas Gerekçeli Karar 28.10.2026 14:22
       başlık satırı tarih yok
       İstanbul 12. İcra Müdürlüğü Ödeme Emri 30/10/2026`,
    );
    assert.equal(rows.length, 2);
    assert.equal(rows[0].receivedDate, '2026-10-28');
    assert.equal(rows[0].servedDate, '2026-11-02');
    assert.equal(rows[0].caseId, caseId);
    assert.match(rows[0].sender, /Sulh Hukuk Mahkemesi/);
    assert.equal(rows[0].ruleId, 'hmk-istinaf');
    assert.equal(rows[1].ruleId, 'iik-itiraz');
  });
});

describe('zaman takibi', () => {
  it('elle kayıt, kronometre ve faturaya aktarma', () => {
    const caseId = cases.createCase(db, lawyer, { title: 'Danışmanlık dosyası' }).id;
    const a = timesheet.addEntry(db, lawyer, { caseId, hours: '1,5', description: 'Dilekçe yazımı', rate: 2000 });
    assert.equal(a.minutes, 90);
    assert.equal(a.amount_kurus, 300000);
    assert.throws(() => timesheet.addEntry(db, lawyer, { hours: 0, description: 'x' }), status(400));
    assert.throws(() => timesheet.addEntry(db, lawyer, { hours: 1 }), status(400));

    const start = new Date('2026-11-02T10:00:00Z');
    const t = timesheet.startTimer(db, lawyer, { caseId, description: 'Duruşma hazırlığı', rate: 2000 }, start);
    assert.ok(t.running);
    const s = timesheet.stopTimer(db, lawyer, t.id, new Date('2026-11-02T10:45:00Z'));
    assert.equal(s.minutes, 45);
    assert.ok(!s.running);
    assert.throws(() => timesheet.stopTimer(db, lawyer, t.id), status(400));

    const list = timesheet.listEntries(db, lawyer, { caseId: String(caseId) });
    assert.equal(list.totals.minutes, 135);
    assert.equal(list.totals.openAmountKurus, 450000);
    assert.throws(() => timesheet.invoiceEntries(db, stranger, { ids: [a.id] }), status(404));

    const inv = timesheet.invoiceEntries(db, lawyer, { ids: [a.id, s.id], date: '2026-11-02' });
    assert.equal(inv.amountKurus, 450000);
    const report = finance.financeReport(db, lawyer, {}) as { entries: { kind: string; amount_kurus: number; case_id: number }[] };
    assert.equal(report.entries[0].kind, 'gelir');
    assert.equal(report.entries[0].amount_kurus, 450000);
    assert.equal(report.entries[0].case_id, caseId);
    assert.throws(() => timesheet.updateEntry(db, lawyer, a.id, { hours: 2 }), status(400));
    assert.throws(() => timesheet.invoiceEntries(db, lawyer, { ids: [a.id] }), status(400));

    // Muhasebe kaydı silinince zaman kayıtları yeniden faturalanabilir.
    finance.deleteEntry(db, lawyer, inv.financeEntryId);
    assert.equal(timesheet.listEntries(db, lawyer).totals.openAmountKurus, 450000);
  });

  it('yeni kronometre çalışanı durdurur; farklı müvekkil ve dosya birlikte faturalanmaz', () => {
    const t1 = timesheet.startTimer(db, lawyer, { client: 'Ahmet', rate: 1000 }, new Date(Date.now() - 30 * 60_000));
    timesheet.startTimer(db, lawyer, { client: 'Mehmet', rate: 1000 });
    const list = timesheet.listEntries(db, lawyer);
    assert.equal(list.items.filter((x) => x.running).length, 1);
    const first = list.items.find((x) => x.id === t1.id)!;
    assert.equal(first.minutes, 30);
    const m = timesheet.addEntry(db, lawyer, { client: 'Mehmet', hours: 1, description: 'Görüşme', rate: 1000 });
    assert.throws(() => timesheet.invoiceEntries(db, lawyer, { ids: [t1.id, m.id] }), status(400));
  });
});

describe('olaydan emsal bulma', () => {
  it('gündelik anlatımı hukuki kavramlara çevirir', () => {
    const k = matchConcepts('Müvekkil 8 yıl çalıştığı fabrikadan hiçbir sebep gösterilmeden işten çıkarıldı, kıdem tazminatı ödenmedi, fazla mesai yaptırılıyordu.');
    const ids = k.map((x) => x.id);
    assert.ok(ids.includes('ise-iade'));
    assert.ok(ids.includes('kidem'));
    assert.ok(ids.includes('fazla-mesai'));
    assert.ok(!matchConcepts('Komşum çekiç ile duvarı çekiçledi').some((x) => x.id === 'kambiyo'));
  });

  it('arama ifadeleri üretir, arşivdeki kararları getirir; yapay zekâ varsa ekler', async () => {
    upsertDecision(db, {
      court: 'Yargıtay',
      chamber: '3. Hukuk Dairesi',
      esasNo: '2021/100',
      kararNo: '2021/200',
      text: 'Kiracı kira bedelini ödemediğinden temerrüt nedeniyle tahliye kararı verilmesi gerekir. TBK m.315 ihtar.',
    } as never);
    const r = await analyzeFacts(db, lawyer, { text: 'Kiracım 4 aydır kirayı ödemiyor, ihtar çektim yine ödemedi.' }, null);
    assert.ok(r.concepts.some((x) => x.id === 'temerrut-tahliye'));
    assert.ok(r.queries.length > 0);
    assert.equal(r.archive.length, 1);
    assert.equal(r.ai, null);

    const fake = async () => ({ text: JSON.stringify({ issues: [{ label: 'Tahliye', query: 'temerrüt tahliye iki haklı ihtar', basis: 'TBK m.352/2' }] }), model: 'test' });
    const r2 = await analyzeFacts(db, lawyer, { text: 'Kiracım 4 aydır kirayı ödemiyor.', useAi: true }, fake);
    assert.equal(r2.queries[0].query, 'temerrüt tahliye iki haklı ihtar');
    await assert.rejects(analyzeFacts(db, lawyer, { text: 'kısa' }, null), status(400));
  });

  it('dava dosyasının olaylarından arar; başka büronun dosyasını açmaz', async () => {
    const caseId = cases.createCase(db, lawyer, { title: 'Boşanma', facts: 'Eşim sürekli şiddet uyguluyor, boşanmak ve velayeti almak istiyorum.' } as never).id;
    db.prepare("UPDATE cases SET facts = 'Eşim sürekli şiddet uyguluyor, boşanmak ve velayeti almak istiyorum.' WHERE id = ?").run(caseId);
    const r = await analyzeFacts(db, lawyer, { caseId }, null);
    assert.ok(r.concepts.some((x) => x.id === 'bosanma'));
    assert.ok(r.concepts.some((x) => x.id === 'velayet'));
    await assert.rejects(analyzeFacts(db, stranger, { caseId }, null), status(404));
  });
});
