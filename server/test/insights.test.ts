import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import * as auth from '../src/auth.ts';
import * as cases from '../src/cases.ts';
import * as contracts from '../src/contracts.ts';
import { openDb, type DB } from '../src/db.ts';
import * as enforcement from '../src/enforcement.ts';
import { ApiError } from '../src/errors.ts';
import * as finance from '../src/finance.ts';
import { insights, INSIGHT_MODULES, lastMonths } from '../src/insights.ts';
import * as poa from '../src/poa.ts';
import * as tasks from '../src/tasks.ts';

const TODAY = '2026-10-31';
const kpi = (r: ReturnType<typeof insights>, label: string) => r.kpis.find((k) => k.label === label)?.value;
const chart = (r: ReturnType<typeof insights>, id: string) => r.charts.find((c) => c.id === id)!;

describe('iş zekası analizleri', () => {
  let db: DB;
  let a: auth.User;
  let other: auth.User;

  beforeEach(() => {
    db = openDb();
    a = auth.registerOffice(db, { officeName: 'A', name: 'Av. Bir', email: 'a@t.local', password: 'sifre1234' }).user;
    other = auth.registerOffice(db, { officeName: 'B', name: 'Av. İki', email: 'b@t.local', password: 'sifre1234' }).user;
  });

  it('son 12 ay anahtarları yıl dönümünü doğru sayar', () => {
    const m = lastMonths('2026-02-15');
    assert.equal(m.length, 12);
    assert.equal(m[0], '2025-03');
    assert.equal(m[11], '2026-02');
  });

  it('her sayfa boş büroda da çalışır', () => {
    for (const m of INSIGHT_MODULES) {
      const r = insights(db, a, m, TODAY);
      assert.ok(r.kpis.length >= 3, m);
      assert.ok(r.charts.length >= 2, m);
    }
    assert.throws(() => insights(db, a, 'yok', TODAY), (e: unknown) => e instanceof ApiError && e.status === 404);
  });

  it('dava, vekâletname, icra, görev ve muhasebe göstergelerini hesaplar; başka büro görmez', () => {
    const c1 = cases.createCase(db, a, { title: 'Bir / İki', area: 'is', court: 'İstanbul 5. İş Mahkemesi' });
    cases.createCase(db, a, { title: 'Üç / Dört', area: 'is' });
    cases.createCase(db, a, { title: 'Beş / Altı', area: 'kira' });
    cases.createCase(db, other, { title: 'Yabancı', area: 'ceza' });
    poa.createPoa(db, a, { client: 'Bir', powers: ['sulh', 'ahzu_kabz'], caseIds: [c1.id] });

    const cs = insights(db, a, 'cases', TODAY);
    assert.equal(kpi(cs, 'Açık dosya'), 3);
    assert.equal(kpi(cs, 'Vekâletnamesi olmayan'), 2);
    assert.deepEqual(chart(cs, 'alan').data[0], { label: 'İş Hukuku', values: [2] });
    assert.ok(!chart(cs, 'alan').data.some((d) => d.label === 'Ceza Hukuku'));

    const pw = insights(db, a, 'powers', TODAY);
    assert.equal(kpi(pw, 'Açık dosya kapsamı'), 33);
    assert.equal(chart(pw, 'yetki').data.find((d) => d.label.startsWith('Sulh'))?.values[0], 1);

    const f = enforcement.createFile(db, a, { debtor: 'Borçlu AŞ', principal: '10.000', startDate: '2026-09-01' });
    enforcement.addAction(db, a, f.id, { date: '2026-10-10', action: 'tahsilat', amount: '2.500' });
    const en = insights(db, a, 'enforcement', TODAY);
    assert.equal(kpi(en, 'Toplam asıl alacak'), 10000);
    assert.equal(kpi(en, 'Tahsil edilen'), 2500);
    assert.equal(kpi(en, 'Tahsil oranı'), 25);
    assert.deepEqual(chart(en, 'borclu').data[0], { label: 'Borçlu AŞ', values: [7500] });
    assert.equal(chart(en, 'tahsilat').data.at(-1)!.values[0], 2500);

    tasks.createTask(db, a, { title: 'Dilekçe', dueDate: '2026-10-01' });
    tasks.createTask(db, a, { title: 'Bilirkişi', dueDate: '2026-11-03' });
    const tk = insights(db, a, 'tasks', TODAY);
    assert.equal(kpi(tk, 'Geciken'), 1);
    assert.equal(kpi(tk, 'Bu hafta teslim'), 1);
    assert.deepEqual(chart(tk, 'kisi').data[0].values, [1, 1]);

    finance.addEntry(db, a, { kind: 'gelir', amount: '1000', date: '2026-10-05', client: 'Bir' });
    finance.addEntry(db, a, { kind: 'gider', amount: '400', date: '2026-09-05', category: 'Kira' });
    const fi = insights(db, a, 'finance', TODAY);
    assert.equal(kpi(fi, 'Net'), 600);
    assert.equal(kpi(fi, 'Kâr marjı'), 60);
    const months = chart(fi, 'aylik').data;
    assert.deepEqual(months.at(-1)!.values, [1000, 0]);
    assert.deepEqual(months.at(-2)!.values, [0, 400]);
  });

  it('sözleşmelerin risk dağılımını çıkarır; muhasebe yetkisi olmayan göremez', () => {
    contracts.createContract(db, a, {
      title: 'Kat karşılığı',
      kind: 'kat-karsiligi',
      body: 'Yüklenici sözleşmeyi dilediği alt yükleniciye devredebilir. Uyuşmazlıklarda Londra Tahkim Mahkemeleri yetkilidir ve tazminat sınırı yoktur.',
    });
    const r = insights(db, a, 'contracts', TODAY);
    const risk = chart(r, 'risk').data.reduce((s, d) => s + d.values[0], 0);
    assert.equal(risk, 1);
    db.prepare('UPDATE users SET can_finance = 0 WHERE id = ?').run(a.id);
    const noFin = { ...a, can_finance: 0 };
    assert.throws(() => insights(db, noFin, 'finance', TODAY), (e: unknown) => e instanceof ApiError && e.status === 403);
    assert.ok(!insights(db, noFin, 'consultancy', TODAY).kpis.some((k) => k.unit === 'tl'));
  });
});
