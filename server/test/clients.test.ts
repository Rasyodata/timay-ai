import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import * as auth from '../src/auth.ts';
import * as cases from '../src/cases.ts';
import * as clients from '../src/clients.ts';
import { openDb, type DB } from '../src/db.ts';
import * as enforcement from '../src/enforcement.ts';
import { ApiError } from '../src/errors.ts';
import * as mediation from '../src/mediation.ts';

describe('müvekkil kartları ve antet', () => {
  let db: DB;
  let a: auth.User;
  let b: auth.User;
  beforeEach(() => {
    db = openDb();
    a = auth.registerOffice(db, { officeName: 'A', name: 'Av. Bir', email: 'a@t.local', password: 'sifre1234' }).user;
    b = auth.registerOffice(db, { officeName: 'B', name: 'Av. İki', email: 'b@t.local', password: 'sifre1234' }).user;
  });

  it('dosyalardan önerir, kartta ilgili her şeyi toplar', () => {
    cases.createCase(db, a, { title: 'İşçilik alacağı', client: 'Ali Veli' });
    cases.createCase(db, a, { title: 'Kira', client: 'ali  VELİ' });
    enforcement.createFile(db, a, { debtor: 'Borçlu', creditor: 'Ali Veli', principal: 100 });
    const mf = mediation.createFile(db, a, { kind: 'is' });
    mediation.addParty(db, a, mf.id, { side: 'basvurucu', name: 'Ali Veli' });
    const s = clients.listClients(db, a).suggestions;
    assert.deepEqual(s.map((x) => [x.name, x.n]), [['Ali Veli', 3]]);
    const c = clients.createClient(db, a, { name: 'Ali Veli', phone: '0555' });
    assert.equal(c.cases.length, 2);
    assert.equal(c.enforcement.length, 1);
    assert.equal(c.mediation.length, 1);
    assert.equal(clients.listClients(db, a).suggestions.length, 0);
    assert.equal(clients.listClients(db, a, 'ali').clients[0].cases, 2);
    assert.throws(() => clients.createClient(db, a, { name: 'ALİ VELİ' }), (e: ApiError) => e.status === 409);
    assert.throws(() => clients.getClient(db, b, c.id), (e: ApiError) => e.status === 404);
  });

  it('antet çıktının başına eklenir; yalnız yönetici değiştirir', () => {
    assert.equal(clients.withLetterhead(db, a, 'Metin'), 'Metin');
    clients.saveLetterhead(db, a, { letterhead: 'YILMAZ HUKUK BÜROSU\nKadıköy / İstanbul' });
    assert.match(clients.withLetterhead(db, a, 'Metin'), /^YILMAZ HUKUK BÜROSU\nKadıköy \/ İstanbul\n—+\n\nMetin$/);
    assert.equal(clients.withLetterhead(db, a, 'Metin', false), 'Metin');
    assert.equal(clients.withLetterhead(db, b, 'Metin'), 'Metin');
    const staff = auth.acceptInvite(db, { token: auth.createInvite(db, a, { email: 's@t.local', role: 'stajyer' }).token, name: 'S', password: 'sifre1234' }).user;
    assert.throws(() => clients.saveLetterhead(db, staff, { letterhead: 'x' }), (e: ApiError) => e.status === 403);
  });
});
