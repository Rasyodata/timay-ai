import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { beforeEach, describe, it } from 'node:test';
import { agenda, addAgendaItem } from '../src/agenda.ts';
import * as auth from '../src/auth.ts';
import * as cases from '../src/cases.ts';
import * as contracts from '../src/contracts.ts';
import { dashboard } from '../src/dashboard.ts';
import { openDb, type DB } from '../src/db.ts';
import * as enforcement from '../src/enforcement.ts';
import { ApiError } from '../src/errors.ts';
import * as finance from '../src/finance.ts';
import * as tasks from '../src/tasks.ts';
import { AREAS, TEMPLATES } from '../src/templates.ts';

const status = (code: number) => (err: unknown) => err instanceof ApiError && err.status === code;

describe('şablonlar', () => {
  it('her hukuk alanında en az bir dilekçe şablonu var ve karar numarası içermiyor', () => {
    for (const area of AREAS) assert.ok(TEMPLATES.some((t) => t.area === area.id), area.id);
    for (const t of TEMPLATES) {
      assert.match(t.body, /SONUÇ VE İSTEM/);
      assert.doesNotMatch(t.body, /\d{4}\/\d+\s*E\./, t.id);
    }
  });
});

describe('sözleşme incelemesi', () => {
  it('taahhüt, ödeme, risk ve eksik maddeleri bulur', () => {
    const a = contracts.analyzeContract(
      'Kiracı her ay 15.000 TL ödemekle yükümlüdür. Kefil olarak Ali Veli imza atmıştır. Gecikmede 50.000 TL cezai şart ödenir. Sözleşme 01.01.2027 tarihinde başlar ve süresi bir yıldır, taraflar ayrıca anlaşmadıkça her yıl aynı şartlarla devam eder ve bu böyle sürer.',
    );
    assert.equal(a.obligations[0].party, 'Kiracı');
    assert.deepEqual(a.payments[0].amounts, ['15.000 TL']);
    assert.deepEqual(a.dates, ['01.01.2027']);
    const titles = a.risks.map((r) => r.title);
    assert.ok(titles.includes('Cezai şart'));
    assert.ok(titles.includes('Kefalet'));
    assert.ok(titles.includes('Mücbir sebep maddesi yok'));
    assert.equal(a.risks[0].level, 'yuksek');
  });

  it('şablonlardaki standart maddeler eksik madde uyarısı vermez', () => {
    const a = contracts.analyzeContract(contracts.CONTRACT_TEMPLATES.find((t) => t.id === 'hizmet')!.body);
    assert.ok(!a.risks.some((r) => r.title.endsWith('yok')));
  });

  it('araya kelime girse de otomatik uzamayı yakalar', () => {
    const a = contracts.analyzeContract('Sözleşme süresi sonunda kendiliğinden bir yıl uzar.');
    assert.ok(a.risks.some((r) => r.title === 'Otomatik yenileme'));
  });
});

describe('büro modülleri', () => {
  let db: DB;
  let lawyer: auth.User;
  let other: auth.User;
  let stranger: auth.User;
  let caseId: number;

  beforeEach(() => {
    db = openDb();
    lawyer = auth.registerOffice(db, { officeName: 'A', name: 'Av. Bir', email: 'a@t.local', password: 'sifre1234' }).user;
    const inv = auth.createInvite(db, lawyer, { email: 'b@t.local', role: 'avukat' });
    other = auth.acceptInvite(db, { token: inv.token, name: 'Av. İki', password: 'sifre1234' }).user;
    stranger = auth.registerOffice(db, { officeName: 'B', name: 'Yabancı', email: 'c@t.local', password: 'sifre1234' }).user;
    caseId = cases.createCase(db, lawyer, { title: 'Dosya', area: 'is' }).id;
  });

  it('dosya sorumlusu olur ve başka avukata devredilir; başka büroya devredilemez', () => {
    assert.equal(cases.getCase(db, lawyer, caseId).responsible_name, 'Av. Bir');
    assert.equal(cases.transferCase(db, lawyer, caseId, { userId: other.id }).responsible_name, 'Av. İki');
    assert.throws(() => cases.transferCase(db, lawyer, caseId, { userId: stranger.id }), status(400));
  });

  it('duruşma, görev ve not ajandada ve ana sayfada görünür', () => {
    const soon = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
    cases.addHearing(db, lawyer, caseId, { date: soon, time: '10:30' });
    tasks.createTask(db, lawyer, { title: 'Bilirkişi raporuna itiraz', assigneeId: other.id, dueDate: soon, caseId });
    addAgendaItem(db, other, { date: soon, title: 'Müvekkil görüşmesi' });
    const kinds = agenda(db, other, {}).map((e) => e.kind);
    assert.deepEqual(kinds.sort(), ['durusma', 'gorev', 'not']);
    const d = dashboard(db, other);
    assert.equal(d.hearings.length, 1);
    assert.equal(d.tasks.length, 1);
    assert.throws(() => tasks.createTask(db, lawyer, { title: 'x', assigneeId: stranger.id }), status(400));
  });

  it('görev panosu: kontrol eden atanmışsa görevi yalnızca o tamamlar', () => {
    const t = tasks.createTask(db, lawyer, { title: 'Cevap dilekçesi', assigneeId: other.id, reviewerId: lawyer.id }) as { id: number };
    assert.equal((tasks.updateTask(db, other, t.id, { status: 'devam' }) as { status: string }).status, 'devam');
    assert.throws(() => tasks.updateTask(db, other, t.id, { status: 'tamam' }), status(403));
    // Eski "tamamlandı" işareti incelemeye gönderir.
    assert.equal((tasks.updateTask(db, other, t.id, { done: true }) as { status: string; done: number }).status, 'inceleme');
    const done = tasks.updateTask(db, lawyer, t.id, { status: 'tamam' }) as { status: string; done: number };
    assert.equal(done.status, 'tamam');
    assert.equal(done.done, 1);
    assert.throws(() => tasks.updateTask(db, lawyer, t.id, { status: 'bitti' }), status(400));
    assert.throws(() => tasks.createTask(db, lawyer, { title: 'x', reviewerId: stranger.id }), status(400));
  });

  it('muhasebe kâr, KDV ve stopajı hesaplar', () => {
    finance.addEntry(db, lawyer, { kind: 'gelir', amount: 10000, vatRate: 20, withholdingRate: 20, date: '2026-10-01', caseId });
    finance.addEntry(db, lawyer, { kind: 'gider', amount: '2.500,50', vatRate: 20, date: '2026-10-02' });
    finance.addEntry(db, lawyer, { kind: 'masraf', amount: 300, date: '2026-10-03', caseId });
    const r = finance.financeReport(db, lawyer, {});
    assert.equal(r.summary.income, 1_000_000);
    assert.equal(r.summary.expense, 250_050);
    assert.equal(r.summary.profit, 749_950);
    assert.equal(r.summary.vatCollected, 200_000);
    assert.equal(r.summary.withholding, 200_000);
    assert.equal(r.byCase[0].costs, 30_000);
    assert.equal(finance.financeReport(db, stranger, {}).entries.length, 0);
  });

  it('icra dosyasında tahsilat düşülür ve faiz hesaplanır', () => {
    assert.equal(enforcement.simpleInterest(100_000_00, 24, '2026-01-01', '2026-12-31'), 2_393_425); // 100.000 TL × %24 × 364 gün
    const f = enforcement.createFile(db, lawyer, { debtor: 'Borçlu A.Ş.', principal: 1000, kind: 'ilamsiz' });
    const after = enforcement.addAction(db, lawyer, f.id, { date: '2026-10-30', action: 'tahsilat', amount: 400 });
    assert.equal(after.collected_kurus, 40_000);
    assert.equal(after.remaining_kurus, 60_000);
    assert.throws(() => enforcement.getFile(db, stranger, f.id), status(404));
  });

  it('sözleşme taahhüdü eklenir ve tamamlanır', () => {
    const c = contracts.createContract(db, lawyer, { title: 'Kira', body: 'Kiracı ödemekle yükümlüdür.' });
    const withOb = contracts.addObligation(db, lawyer, c.id, { text: 'Kira ödemesi', dueDate: '2026-11-01', amount: 15000 });
    const ob = withOb.obligations[0] as { id: number };
    assert.equal((contracts.setObligationDone(db, lawyer, ob.id, true).obligations[0] as { done: number }).done, 1);
  });

  it('eski veritabanına yeni sütunlar eklenir', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'timay-')), 'eski.db');
    const old = new Database(file);
    old.exec(`CREATE TABLE cases (id INTEGER PRIMARY KEY, office_id INTEGER, title TEXT, court TEXT DEFAULT '',
      esas_no TEXT DEFAULT '', parties TEXT DEFAULT '', facts TEXT DEFAULT '', created_by INTEGER, created_at TEXT)`);
    old.close();
    const cols = (openDb(file).prepare('PRAGMA table_info(cases)').all() as { name: string }[]).map((c) => c.name);
    for (const c of ['area', 'client', 'status', 'responsible_id']) assert.ok(cols.includes(c), c);
  });
});
