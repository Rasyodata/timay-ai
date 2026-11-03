import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import * as auth from '../src/auth.ts';
import * as cases from '../src/cases.ts';
import { activityFeed, ceoPanel } from '../src/ceo.ts';
import { openDb, type DB } from '../src/db.ts';
import { ApiError } from '../src/errors.ts';
import * as petitions from '../src/petitions.ts';
import * as tasks from '../src/tasks.ts';

const status = (code: number) => (e: unknown) => e instanceof ApiError && e.status === code;

describe('yönetim paneli (CEO)', () => {
  let db: DB;
  let admin: auth.User;
  let lawyer: auth.User;

  beforeEach(() => {
    db = openDb();
    admin = auth.registerOffice(db, { officeName: 'A', name: 'Kadir', email: 'a@t.local', password: 'sifre1234' }).user;
    const i = auth.createInvite(db, admin, { email: 'b@t.local', role: 'avukat' });
    lawyer = auth.acceptInvite(db, { token: i.token, name: 'Av. Ayşe', password: 'sifre1234' }).user;
  });

  it('Tuğba Yörük en kalabalık büroya geçici şifreyle CEO olarak açılır, bir kez', () => {
    auth.registerOffice(db, { officeName: 'Deneme', name: 'Deneme', email: 'd@t.local', password: 'sifre1234' });
    const seed = { name: 'Tuğba Yörük', email: 'tugba@t.local', passwordHash: auth.hashPassword('Gecici-123') };
    const ceo = auth.seedCeo(db, seed)!;
    assert.equal(ceo.office_id, admin.office_id);
    assert.equal(ceo.is_ceo, 1);
    assert.equal(ceo.is_admin, 1);
    assert.equal(ceo.all_cases, 1);
    assert.equal(ceo.can_approve, 1, 'aynı zamanda avukat: onay verebilir');
    assert.equal(ceo.role, 'avukat');
    assert.equal(ceo.must_change_password, 1);
    assert.equal(auth.seedCeo(db, seed), null, 'ikinci açılışta tekrar eklenmez');
    const { user } = auth.login(db, { email: 'tugba@t.local', password: 'Gecici-123' });
    assert.throws(() => auth.changePassword(db, user, { current: 'yanlis', next: 'YeniSifre1' }), status(400));
    const changed = auth.changePassword(db, user, { current: 'Gecici-123', next: 'YeniSifre1' });
    assert.equal(changed.must_change_password, 0);
    assert.ok(auth.login(db, { email: 'tugba@t.local', password: 'YeniSifre1' }).token);
  });

  it('kodda tanımlı CEO kaydı geçerli bir şifre özeti taşır', () => {
    assert.match(auth.CEO_SEED.passwordHash, /^[0-9a-f]{32}:[0-9a-f]{128}$/);
    assert.equal(auth.CEO_SEED.name, 'Tuğba Yörük');
  });

  it('yönetici doğrudan CEO kullanıcı açabilir; avukat açamaz', () => {
    assert.throws(() => auth.createUserDirect(db, lawyer, { name: 'X', email: 'x@t.local', password: 'sifre1234' }), status(403));
    const ceo = auth.createUserDirect(db, admin, { name: 'Tuğba', email: 'tg@t.local', password: 'sifre1234', isCeo: true });
    assert.equal(ceo.is_ceo, 1);
    assert.equal(ceo.must_change_password, 1);
    const off = auth.setPermissions(db, admin, ceo.id, { isCeo: false });
    assert.equal(off.is_ceo, 0);
  });

  it('akış bütün avukatların yaptıklarını gösterir; panel yalnız CEO/yöneticiye açık', () => {
    const c = cases.createCase(db, lawyer, { title: 'Kira tespiti' }) as { id: number };
    petitions.createPetition(db, lawyer, { caseId: c.id, title: 'Dava dilekçesi', body: 'Metin' });
    tasks.createTask(db, admin, { title: 'Bilirkişi raporuna itiraz', assigneeId: lawyer.id, dueDate: '2020-01-01' });
    const ceo = auth.createUserDirect(db, admin, { name: 'Tuğba', email: 'tg@t.local', password: 'sifre1234', isCeo: true });

    const feed = activityFeed(db, ceo);
    const texts = feed.map((a) => `${a.user_name}: ${a.text}`);
    assert.ok(texts.some((t) => t.startsWith('Av. Ayşe: yeni dava dosyası açtı: Kira tespiti')), texts.join('\n'));
    assert.ok(texts.some((t) => t.startsWith('Av. Ayşe: dilekçe başlattı: Dava dilekçesi')), texts.join('\n'));
    assert.ok(texts.some((t) => t.startsWith('Kadir: görev verdi: Bilirkişi')), texts.join('\n'));

    const panel = ceoPanel(db, ceo);
    assert.equal(panel.kpis.openCases, 1);
    assert.equal(panel.kpis.overdueTasks, 1);
    assert.equal(panel.lawyers.length, 3, 'CEO aynı zamanda avukat: listede en üstte');
    assert.equal(panel.lawyers[0].is_ceo, 1);
    const ayse = panel.lawyers.find((l) => l.name === 'Av. Ayşe')!;
    assert.equal(ayse.open_cases, 1);
    assert.equal(ayse.petitions_written, 1);
    assert.equal(ayse.overdue_tasks, 1);
    assert.ok(ayse.actions30 >= 2);
    assert.equal(panel.trend.months.length, 6);
    assert.equal(panel.trend.cases.at(-1), 1);
    assert.throws(() => ceoPanel(db, lawyer), status(403));
  });
});
