import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import * as auth from '../src/auth.ts';
import * as consultancy from '../src/consultancy.ts';
import { openDb, type DB } from '../src/db.ts';
import { ApiError } from '../src/errors.ts';
import * as finance from '../src/finance.ts';

const status = (code: number) => (e: unknown) => e instanceof ApiError && e.status === code;

describe('danışmanlık yönetimi', () => {
  let db: DB;
  let lawyer: auth.User;
  let stranger: auth.User;

  beforeEach(() => {
    db = openDb();
    lawyer = auth.registerOffice(db, { officeName: 'A', name: 'Av. Bir', email: 'a@t.local', password: 'sifre1234' }).user;
    stranger = auth.registerOffice(db, { officeName: 'B', name: 'Yabancı', email: 'c@t.local', password: 'sifre1234' }).user;
  });

  it('paketi aşan saatleri ek ücretle hesaplar', () => {
    const c = consultancy.createClient(db, lawyer, { name: 'Kaya Gıda', monthlyFee: '20.000', includedHours: 5, extraHourFee: '3.000' });
    assert.equal(c.responsible_name, 'Av. Bir');
    consultancy.addRecord(db, lawyer, c.id, { date: '2026-10-05', subject: 'Kira sözleşmesi incelemesi', hours: '4' });
    const after = consultancy.addRecord(db, lawyer, c.id, { date: '2026-10-20', subject: 'Toplantı', hours: '2,5', kind: 'toplanti' });
    const oct = after.months.find((m) => m.month === '2026-10')!;
    assert.equal(oct.minutes, 390);
    assert.equal(oct.extraMinutes, 90);
    assert.equal(oct.extra, 450_000);
    assert.equal(oct.total, 2_450_000);
  });

  it('ayı muhasebeye bir kez gelir olarak işler ve o ayın kaydı silinemez', () => {
    const c = consultancy.createClient(db, lawyer, { name: 'Deniz Ltd.', monthlyFee: 10000 });
    const withRecord = consultancy.addRecord(db, lawyer, c.id, { date: '2026-09-10', subject: 'Görüş', hours: 1 });
    const recordId = withRecord.records[0].id;
    const done = consultancy.invoiceMonth(db, lawyer, c.id, { month: '2026-09' });
    assert.equal(done.months.find((m) => m.month === '2026-09')!.invoiced, 1_000_000);
    const report = finance.financeReport(db, lawyer, {});
    assert.equal(report.summary.income, 1_000_000);
    assert.equal(report.entries[0].date, '2026-09-30');
    assert.throws(() => consultancy.invoiceMonth(db, lawyer, c.id, { month: '2026-09' }), status(400));
    assert.throws(() => consultancy.deleteRecord(db, lawyer, recordId), status(400));
  });

  it('başka büronun müvekkiline erişilemez', () => {
    const c = consultancy.createClient(db, lawyer, { name: 'Gizli A.Ş.' });
    assert.throws(() => consultancy.getClient(db, stranger, c.id), status(404));
    assert.throws(() => consultancy.addRecord(db, stranger, c.id, { date: '2026-10-01', subject: 'x' }), status(404));
    assert.equal(consultancy.listClients(db, stranger).length, 0);
  });
});
