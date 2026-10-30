import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import * as auth from '../src/auth.ts';
import { openDb, type DB } from '../src/db.ts';
import * as estates from '../src/estates.ts';
import { ApiError } from '../src/errors.ts';

const status = (code: number) => (e: unknown) => e instanceof ApiError && e.status === code;
const h = (id: number, relation: string, extra: Partial<estates.Heir> = {}): estates.Heir => ({
  id,
  name: `K${id}`,
  relation,
  alive: true,
  parent_id: null,
  side: '',
  ...extra,
});
const share = (r: ReturnType<typeof estates.legalShares>, id: number) => r.shares.find((s) => s.id === id)!.share.join('/');
const reserved = (r: ReturnType<typeof estates.legalShares>, id: number) => r.shares.find((s) => s.id === id)!.reserved.join('/');

describe('yasal miras payları', () => {
  it('eş ve iki çocuk: eş 1/4, çocuklar 3/8', () => {
    const r = estates.legalShares([h(1, 'es'), h(2, 'cocuk'), h(3, 'cocuk')]);
    assert.equal(share(r, 1), '1/4');
    assert.equal(share(r, 2), '3/8');
    assert.equal(reserved(r, 2), '3/16');
    assert.equal(reserved(r, 1), '1/4');
  });

  it('ölmüş çocuğun payı torunlarına geçer', () => {
    const r = estates.legalShares([h(1, 'es'), h(2, 'cocuk'), h(3, 'cocuk', { alive: false }), h(4, 'torun', { parent_id: 3 }), h(5, 'torun', { parent_id: 3 })]);
    assert.equal(share(r, 2), '3/8');
    assert.equal(share(r, 4), '3/16');
    assert.equal(share(r, 5), '3/16');
    assert.equal(share(r, 3), '0/1');
  });

  it('altsoy yoksa eş 1/2; ölmüş babanın payı kardeşe geçer', () => {
    const r = estates.legalShares([h(1, 'es'), h(2, 'anne'), h(3, 'baba', { alive: false }), h(4, 'kardes', { side: 'iki' })]);
    assert.equal(share(r, 1), '1/2');
    assert.equal(share(r, 2), '1/4');
    assert.equal(share(r, 4), '1/4');
    assert.equal(reserved(r, 4), '0/1');
    assert.equal(reserved(r, 2), '1/16');
  });

  it('bir tarafta kimse yoksa pay diğer tarafa kalır; yalnız eş varsa hepsi eşin', () => {
    const r = estates.legalShares([h(1, 'anne'), h(2, 'baba', { alive: false })]);
    assert.equal(share(r, 1), '1/1');
    const only = estates.legalShares([h(1, 'es')]);
    assert.equal(share(only, 1), '1/1');
    assert.equal(reserved(only, 1), '3/4');
  });
});

describe('miras dosyası', () => {
  let db: DB;
  let lawyer: auth.User;
  let stranger: auth.User;

  beforeEach(() => {
    db = openDb();
    lawyer = auth.registerOffice(db, { officeName: 'A', name: 'Av. Bir', email: 'a@t.local', password: 'sifre1234' }).user;
    stranger = auth.registerOffice(db, { officeName: 'B', name: 'Yabancı', email: 'c@t.local', password: 'sifre1234' }).user;
  });

  it('net tereke üzerinden tutar ve süreleri hesaplar', () => {
    const e = estates.createEstate(db, lawyer, { deceased: 'Ahmet Çelik', deathDate: '2026-08-15' });
    estates.addHeir(db, lawyer, e.id, { name: 'Ayşe Çelik', relation: 'es' });
    estates.addHeir(db, lawyer, e.id, { name: 'Hasan Çelik', relation: 'cocuk' });
    estates.addItem(db, lawyer, e.id, { kind: 'varlik', title: 'Daire', value: '5.000.000' });
    const d = estates.addItem(db, lawyer, e.id, { kind: 'borc', title: 'Kredi', value: '1.000.000' });
    assert.equal(d.totals.net, 400_000_000);
    assert.deepEqual(
      d.shares.map((s) => s.amount_kurus),
      [100_000_000, 300_000_000],
    );
    assert.equal(d.deadlines[0].date, '2026-11-15');
    assert.throws(() => estates.addHeir(db, lawyer, e.id, { name: 'İkinci eş', relation: 'es' }), status(400));
    assert.throws(() => estates.addHeir(db, lawyer, e.id, { name: 'Torun', relation: 'torun' }), status(400));
    assert.throws(() => estates.getEstate(db, stranger, e.id), status(404));
  });
});
