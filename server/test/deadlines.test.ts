import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { agenda } from '../src/agenda.ts';
import * as auth from '../src/auth.ts';
import * as cases from '../src/cases.ts';
import { openDb, type DB } from '../src/db.ts';
import * as deadlines from '../src/deadlines.ts';
import * as enforcement from '../src/enforcement.ts';
import { ApiError } from '../src/errors.ts';

const status = (code: number) => (e: unknown) => e instanceof ApiError && e.status === code;
const calc = (ruleId: string, start: string) => deadlines.calculate({ ruleId, start });

describe('süre hesaplayıcı', () => {
  it('hafta ve ay sürelerini hesaplar, hafta sonunu iş gününe kaydırır', () => {
    // 2026-10-30 cuma + 2 hafta = 2026-11-13 cuma
    assert.equal(calc('hmk-istinaf', '2026-10-30').date, '2026-11-13');
    // 2026-01-31 + 1 ay = 2026-02-28 cumartesi -> 2026-03-02 pazartesi
    const t = calc('hmk-temyiz', '2026-01-31');
    assert.equal(t.date, '2026-03-02');
    assert.equal(t.notes.length, 1);
  });

  it('adli tatile rastlayan yargılama süresi 7 eylüle uzar; zamanaşımı uzamaz', () => {
    const c = calc('hmk-cevap', '2026-07-15');
    assert.equal(c.date, '2026-09-07');
    assert.match(c.notes[0], /HMK 104/);
    assert.equal(calc('tbk-haksiz', '2024-07-25').date, '2026-07-25');
  });

  it('resmî tatilde biten süre ertesi iş gününe geçer', () => {
    // 2026-10-22 + 7 gün = 29 Ekim (perşembe, tatil) -> 30 Ekim
    assert.equal(calc('iik-itiraz', '2026-10-22').date, '2026-10-30');
  });
});

describe('süre takibi ve risk uyarıları', () => {
  let db: DB;
  let lawyer: auth.User;
  let stranger: auth.User;

  beforeEach(() => {
    db = openDb();
    lawyer = auth.registerOffice(db, { officeName: 'A', name: 'Av. Bir', email: 'a@t.local', password: 'sifre1234' }).user;
    stranger = auth.registerOffice(db, { officeName: 'B', name: 'Yabancı', email: 'c@t.local', password: 'sifre1234' }).user;
  });

  it('kuraldan süre oluşturur, ajandada ve risklerde gösterir', () => {
    const caseId = cases.createCase(db, lawyer, { title: 'Dosya' }).id;
    const start = new Date(Date.now() - 10 * 86_400_000).toISOString().slice(0, 10);
    const d = deadlines.createDeadline(db, lawyer, { ruleId: 'hmk-cevap', start, caseId }) as { id: number; title: string; due_date: string };
    assert.equal(d.title, 'Cevap dilekçesi');
    const events = agenda(db, lawyer, { from: '2000-01-01', to: '2100-01-01' });
    assert.ok(events.some((e) => e.kind === 'sure' && e.id === d.id));
    assert.ok(deadlines.risks(db, lawyer).some((r) => r.area === 'Süre'));
    assert.equal(deadlines.risks(db, stranger).length, 0);
    assert.throws(() => deadlines.setDeadlineDone(db, stranger, d.id, true), status(404));
    deadlines.setDeadlineDone(db, lawyer, d.id, true);
    assert.ok(!deadlines.risks(db, lawyer).some((r) => r.area === 'Süre'));
    // Süresi kapanan açık dosya için "ileri tarihli işlem yok" uyarısı çıkar.
    assert.ok(deadlines.risks(db, lawyer).some((r) => r.area === 'Dava'));
  });

  it('1 yıla yakın işlem görmeyen icra dosyasını uyarır', () => {
    const old = new Date(Date.now() - 400 * 86_400_000).toISOString().slice(0, 10);
    enforcement.createFile(db, lawyer, { debtor: 'Borçlu', principal: 1000, startDate: old });
    const r = deadlines.risks(db, lawyer).find((x) => x.area === 'İcra');
    assert.equal(r?.level, 'yuksek');
  });
});
