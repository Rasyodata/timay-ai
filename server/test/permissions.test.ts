import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { beforeEach, describe, it } from 'node:test';
import * as auth from '../src/auth.ts';
import * as cases from '../src/cases.ts';
import * as contracts from '../src/contracts.ts';
import { dashboard } from '../src/dashboard.ts';
import { openDb, type DB } from '../src/db.ts';
import { ApiError } from '../src/errors.ts';
import * as finance from '../src/finance.ts';
import * as petitions from '../src/petitions.ts';
import * as tasks from '../src/tasks.ts';

const status = (code: number) => (e: unknown) => e instanceof ApiError && e.status === code;

describe('avukat yetkileri', () => {
  let db: DB;
  let admin: auth.User;
  let lawyer: auth.User;
  let intern: auth.User;

  beforeEach(() => {
    db = openDb();
    admin = auth.registerOffice(db, { officeName: 'A', name: 'Yönetici', email: 'a@t.local', password: 'sifre1234' }).user;
    const i1 = auth.createInvite(db, admin, { email: 'b@t.local', role: 'avukat' });
    lawyer = auth.acceptInvite(db, { token: i1.token, name: 'Av. İki', password: 'sifre1234' }).user;
    const i2 = auth.createInvite(db, admin, { email: 's@t.local', role: 'stajyer' });
    intern = auth.acceptInvite(db, { token: i2.token, name: 'Stajyer', password: 'sifre1234' }).user;
  });

  it('büroyu açan yöneticidir; yalnız yönetici davet eder ve yetki değiştirir', () => {
    assert.equal(admin.is_admin, 1);
    assert.equal(lawyer.is_admin, 0);
    assert.equal(intern.can_finance, 0);
    assert.equal(intern.can_approve, 0);
    assert.throws(() => auth.createInvite(db, lawyer, { email: 'x@t.local', role: 'avukat' }), status(403));
    assert.throws(() => auth.setPermissions(db, lawyer, intern.id, { canFinance: true }), status(403));
    assert.throws(() => auth.setPermissions(db, admin, admin.id, { isAdmin: false }), status(400));
    const updated = auth.setPermissions(db, admin, intern.id, { canFinance: true, canApprove: true });
    assert.equal(updated.can_finance, 1);
    assert.equal(updated.can_approve, 0, 'stajyer onay yetkisi alamaz');
  });

  it('muhasebe yetkisi olmayan muhasebeyi göremez ve ana sayfada tutar gizlenir', () => {
    assert.throws(() => finance.financeReport(db, intern, {}), status(403));
    assert.throws(() => finance.addEntry(db, intern, { kind: 'gelir', amount: 100, date: '2026-10-01' }), status(403));
    finance.addEntry(db, admin, { kind: 'gelir', amount: 100, date: new Date().toISOString().slice(0, 10) });
    assert.equal(dashboard(db, intern).month.hidden, true);
    assert.equal(dashboard(db, intern).month.income, 0);
    assert.equal(dashboard(db, admin).month.income, 10000);
  });

  it('onay yetkisi kaldırılan avukat dilekçe onaylayamaz', () => {
    const c = cases.createCase(db, admin, { title: 'Dosya' });
    const p = petitions.createPetition(db, admin, { caseId: c.id, title: 'Dilekçe', body: 'Metin' });
    petitions.submitForReview(db, admin, p.id);
    auth.setPermissions(db, admin, lawyer.id, { canApprove: false });
    const limited = auth.getUser(db, lawyer.id);
    assert.throws(() => petitions.review(db, limited, p.id, { action: 'approve', comment: '' }), status(403));
  });

  it('yalnız kendi dosyalarını gören kullanıcı başka dosyaya erişemez', () => {
    const mine = cases.createCase(db, lawyer, { title: 'Benim' });
    const other = cases.createCase(db, admin, { title: 'Başkası' });
    const assigned = cases.createCase(db, admin, { title: 'Görevli' });
    tasks.createTask(db, admin, { title: 'Bak', assigneeId: lawyer.id, caseId: assigned.id });
    auth.setPermissions(db, admin, lawyer.id, { allCases: false });
    const limited = auth.getUser(db, lawyer.id);
    const titles = (cases.listCases(db, limited) as { title: string }[]).map((c) => c.title).sort();
    assert.deepEqual(titles, ['Benim', 'Görevli']);
    assert.throws(() => cases.getCase(db, limited, other.id), status(404));
    assert.equal(cases.getCase(db, limited, mine.id).title, 'Benim');
  });

  it('eski veritabanında ilk kullanıcı yönetici olur, stajyerin yetkileri kapalı gelir', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'timay-')), 'eski.db');
    const old = new Database(file);
    old.exec(`CREATE TABLE offices (id INTEGER PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')));
      CREATE TABLE users (id INTEGER PRIMARY KEY, office_id INTEGER NOT NULL, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, role TEXT NOT NULL);
      INSERT INTO offices (name) VALUES ('Eski');
      INSERT INTO users (office_id, name, email, password_hash, role) VALUES (1, 'Kurucu', 'k@t', 'x:y', 'avukat'), (1, 'Staj', 's@t', 'x:y', 'stajyer');`);
    old.close();
    const db2 = openDb(file);
    const rows = db2.prepare('SELECT name, is_admin, can_finance, can_approve, all_cases FROM users ORDER BY id').all();
    assert.deepEqual(rows, [
      { name: 'Kurucu', is_admin: 1, can_finance: 1, can_approve: 1, all_cases: 1 },
      { name: 'Staj', is_admin: 0, can_finance: 0, can_approve: 0, all_cases: 1 },
    ]);
  });
});

describe('sözleşme onayı', () => {
  let db: DB;
  let a: auth.User;
  let b: auth.User;

  beforeEach(() => {
    db = openDb();
    a = auth.registerOffice(db, { officeName: 'A', name: 'Av. Bir', email: 'a@t.local', password: 'sifre1234' }).user;
    const inv = auth.createInvite(db, a, { email: 'b@t.local', role: 'avukat' });
    b = auth.acceptInvite(db, { token: inv.token, name: 'Av. İki', password: 'sifre1234' }).user;
  });

  it('gönderen onaylayamaz, başka avukat onaylar; metin değişince onay düşer', () => {
    const c = contracts.createContract(db, a, { title: 'Kira', body: 'Kiracı kira bedelini ödemekle yükümlüdür.' });
    assert.throws(() => contracts.reviewContract(db, b, c.id, { action: 'approve' }), status(400));
    contracts.submitContract(db, a, c.id);
    assert.equal(dashboard(db, b).contractsToReview.length, 1);
    assert.equal(dashboard(db, a).contractsToReview.length, 0);
    assert.throws(() => contracts.reviewContract(db, a, c.id, { action: 'approve' }), status(403));
    assert.throws(() => contracts.reviewContract(db, b, c.id, { action: 'request_changes' }), status(400));
    const ok = contracts.reviewContract(db, b, c.id, { action: 'approve' });
    assert.equal(ok.review_status, 'onayli');
    assert.equal(ok.reviews.length, 2);
    const edited = contracts.updateContract(db, a, c.id, { body: 'Yeni metin.' });
    assert.equal(edited.review_status, '');
  });
});
