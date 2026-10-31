import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, it } from 'node:test';
import * as auth from '../src/auth.ts';
import * as backup from '../src/backup.ts';
import * as casedocs from '../src/casedocs.ts';
import * as cases from '../src/cases.ts';
import { openDb, type DB } from '../src/db.ts';
import { ApiError } from '../src/errors.ts';
import * as notes from '../src/notes.ts';
import * as petitions from '../src/petitions.ts';

describe('yedekleme', () => {
  let db: DB;
  let a: auth.User;
  let b: auth.User;
  let staff: auth.User;
  let token: string;

  beforeEach(() => {
    db = openDb();
    const reg = auth.registerOffice(db, { officeName: 'A Hukuk', name: 'Av. Bir', email: 'a@t.local', password: 'sifre1234' });
    a = reg.user;
    token = reg.token;
    b = auth.registerOffice(db, { officeName: 'B Hukuk', name: 'Av. İki', email: 'b@t.local', password: 'sifre1234' }).user;
    staff = auth.acceptInvite(db, { token: auth.createInvite(db, a, { email: 's@t.local', role: 'stajyer' }).token, name: 'Stajyer', password: 'sifre1234' }).user;
    const c = cases.createCase(db, a, { title: 'Veli / Deniz' }) as { id: number };
    casedocs.addCaseDocument(db, a, c.id, { fileName: 'bordro.pdf', fileBase64: Buffer.from([0, 1, 2, 250]).toString('base64'), text: 'bordro' });
    const p = petitions.createPetition(db, a, { caseId: c.id, title: 'Dava dilekçesi', body: 'Fazla mesai' }) as { id: number };
    petitions.saveVersion(db, a, p.id, 'Fazla mesai ücreti talebi');
    notes.createNote(db, a, { caseId: c.id, body: 'Tanık #önemli' });
    cases.createCase(db, b, { title: 'B dosyası' });
  });

  const count = (sql: string, ...p: unknown[]) => (db.prepare(sql).get(...p) as { n: number }).n;

  it('yalnız kendi bürosunu yedekler ve aynı sunucuya geri yükler', () => {
    const y = backup.createBackup(db, a);
    assert.match(y.fileName, /^Timay-Yedek-.*\.timay$/);
    assert.deepEqual(
      backup.inspectBackup(db, a, { base64: y.base64 }).summary.map((s) => [s.key, s.count]),
      [['cases', 1], ['case_documents', 1], ['petitions', 1], ['notes', 1], ['users', 2]],
    );
    // Kayıtlar silinir ya da değişir…
    db.prepare("UPDATE cases SET title = 'Bozuldu' WHERE office_id = ?").run(a.office_id);
    db.prepare('DELETE FROM notes').run();
    // …yedekten geri gelir; B bürosu ve yöneticinin oturumu etkilenmez.
    const r = backup.restoreBackup(db, a, { base64: y.base64, confirm: true });
    assert.equal(r.ok, true);
    assert.equal(count("SELECT COUNT(*) n FROM cases WHERE office_id = ? AND title = 'Veli / Deniz'", a.office_id), 1);
    assert.equal(count('SELECT COUNT(*) n FROM notes'), 1);
    assert.equal(count('SELECT COUNT(*) n FROM petition_versions'), 2);
    assert.equal(count("SELECT COUNT(*) n FROM cases WHERE title = 'B dosyası'"), 1);
    assert.equal(auth.userFromToken(db, token).id, a.id);
    const doc = db.prepare('SELECT data FROM case_documents').get() as { data: Buffer };
    assert.deepEqual([...doc.data], [0, 1, 2, 250]);
    assert.equal(auth.login(db, { email: 's@t.local', password: 'sifre1234' }).user.id, staff.id);
  });

  it('boş yeni sunucuya yüklenir; aynı e-postalı yöneticiye bağlanır', () => {
    const y = backup.createBackup(db, a);
    const fresh = openDb();
    auth.registerOffice(fresh, { officeName: 'Başka', name: 'X', email: 'x@t.local', password: 'sifre1234' });
    const me = auth.registerOffice(fresh, { officeName: 'A Hukuk', name: 'Av. Bir', email: 'a@t.local', password: 'yeni12345' }).user;
    assert.notEqual(me.id, a.id);
    backup.restoreBackup(fresh, me, { base64: y.base64, confirm: true });
    const c = fresh.prepare('SELECT office_id, created_by FROM cases').get() as { office_id: number; created_by: number };
    assert.deepEqual(c, { office_id: me.office_id, created_by: me.id });
    assert.equal((fresh.prepare('SELECT COUNT(*) n FROM users WHERE office_id = ?').get(me.office_id) as { n: number }).n, 2);
    assert.equal(auth.login(fresh, { email: 'a@t.local', password: 'yeni12345' }).user.id, me.id);
  });

  it('yönetici olmayanı ve bozuk dosyayı reddeder', () => {
    assert.throws(() => backup.createBackup(db, staff), (e: ApiError) => e.status === 403);
    assert.throws(() => backup.inspectBackup(db, a, { base64: Buffer.from('bozuk').toString('base64') }), (e: ApiError) => e.status === 400);
    const y = backup.createBackup(db, a);
    assert.throws(() => backup.restoreBackup(db, a, { base64: y.base64 }), (e: ApiError) => e.status === 400);
  });

  it('sunucu yedeği günde bir dosya yazar, eskileri siler', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'timay-yedek-'));
    for (const d of ['2026-01-01', '2026-01-02', '2026-01-03']) writeFileSync(join(dir, `timay-${d}.db`), '');
    await backup.serverBackupNow(db, dir, 2);
    const files = readdirSync(dir).sort();
    assert.equal(files.length, 2);
    assert.equal(files[1], `timay-${new Date().toISOString().slice(0, 10)}.db`);
    assert.equal(backup.listServerBackups(a, dir).files.length, 2);
  });
});
