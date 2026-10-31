import assert from 'node:assert/strict';
import { gunzipSync } from 'node:zlib';
import { beforeEach, describe, it } from 'node:test';
import * as auth from '../src/auth.ts';
import * as backup from '../src/backup.ts';
import { openDb, type DB } from '../src/db.ts';
import { ApiError } from '../src/errors.ts';
import * as m from '../src/mediation.ts';

describe('arabuluculuk', () => {
  let db: DB;
  let a: auth.User;
  let b: auth.User;
  beforeEach(() => {
    db = openDb();
    a = auth.registerOffice(db, { officeName: 'A', name: 'Av. Arabulucu', email: 'a@t.local', password: 'sifre1234' }).user;
    b = auth.registerOffice(db, { officeName: 'B', name: 'Av. İki', email: 'b@t.local', password: 'sifre1234' }).user;
  });

  it('anlaşmada dilimli yüzde ve tabanı uygular', () => {
    // 1.000.000 TL: 600.000 × %6 + 400.000 × %5 = 36.000 + 20.000
    assert.equal(m.computeFee({ kind: 'is', parties: 2, status: 'anlasma', resultTL: 1_000_000, hours: 2, mandatory: true }).total, 56_000);
    // 100.000 TL × %6 = 6.000 < taban 9.000
    assert.equal(m.computeFee({ kind: 'is', parties: 2, status: 'anlasma', resultTL: 100_000, hours: 2, mandatory: true }).total, 9_000);
    assert.equal(m.computeFee({ kind: 'ticari', parties: 2, status: 'anlasma', resultTL: 100_000, hours: 2, mandatory: true }).total, 13_000);
  });

  it('anlaşamamada saat ücreti; zorunluda ilk 2 saat Hazineden', () => {
    const f = m.computeFee({ kind: 'is', parties: 2, status: 'anlasmama', resultTL: 0, hours: 3, mandatory: true });
    assert.equal(f.total, 3 * 1130);
    assert.equal(f.treasury, 2 * 1130);
    assert.equal(f.byParties, 1130);
    assert.equal(m.computeFee({ kind: 'ticari', parties: 4, status: 'anlasmama', resultTL: 0, hours: 2, mandatory: false }).total, 6400);
  });

  it('dosya, taraf, toplantı; sıradaki adım, yasal süre ve belgeler', () => {
    m.saveProfile(db, a, { sicil_no: '12345', iban: 'TR00 0000', phone: '0555' });
    let f = m.createFile(db, a, { kind: 'is', subject: 'Kıdem ve ihbar tazminatı', assignedDate: '2026-11-02', buroNo: '2026/100', arbNo: '2026/55' });
    assert.match(f.next.text, /taraf/i);
    assert.deepEqual(f.deadline, { weeks: 3, ext: 1, due: '2026-11-23', extended: '2026-11-30' });
    m.addParty(db, a, f.id, { side: 'basvurucu', name: 'Ali Veli', lawyer: 'Av. X' });
    f = m.addParty(db, a, f.id, { side: 'karsi', name: 'Deniz İnşaat AŞ' });
    assert.equal(f.next.doc, 'davet');
    f = m.addMeeting(db, a, f.id, { date: '2026-11-10', time: '14:00', place: 'Arabuluculuk bürosu' });
    assert.equal(f.status, 'davet');
    const davet = m.buildDocument(db, a, f.id, 'davet');
    assert.match(davet.body, /Ali Veli, Deniz İnşaat AŞ/);
    assert.match(davet.body, /10\.11\.2026 tarihinde saat 14:00/);
    assert.match(davet.body, /Sicil No: 12345/);
    f = m.updateFile(db, a, f.id, { status: 'anlasma', result: '250.000' });
    assert.equal(f.fee.total, 15_000);
    assert.match(m.buildDocument(db, a, f.id, 'son_tutanak').body, /ANLAŞMIŞTIR/);
    assert.match(m.buildDocument(db, a, f.id, 'anlasma').body, /250\.000,00 TL/);
    assert.match(m.buildDocument(db, a, f.id, 'ucret').body, /IBAN\): TR00 0000/);
    assert.throws(() => m.getFile(db, b, f.id), (e: ApiError) => e.status === 404);
    assert.equal(m.listFiles(db, b).length, 0);
    // Yedeğe de girer.
    const s = backup.inspectBackup(db, a, { base64: backup.createBackup(db, a).base64 });
    assert.ok(s);
    assert.ok((JSON.parse(gunzipSync(Buffer.from(backup.createBackup(db, a).base64, 'base64')).toString()).tables.mediation_parties.rows.length) === 2);
  });
});
