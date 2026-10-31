import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import * as auth from '../src/auth.ts';
import * as cases from '../src/cases.ts';
import { openDb, type DB } from '../src/db.ts';
import { computeDeadline } from '../src/deadlines.ts';
import { ApiError } from '../src/errors.ts';
import * as notifications from '../src/notifications.ts';
import * as safahat from '../src/safahat.ts';
import * as tasks from '../src/tasks.ts';

describe('safahat, otomatik süre ve bildirimler', () => {
  let db: DB;
  let a: auth.User;
  let b: auth.User;

  beforeEach(() => {
    db = openDb();
    a = auth.registerOffice(db, { officeName: 'A', name: 'Av. Bir', email: 'a@t.local', password: 'sifre1234' }).user;
    b = auth.registerOffice(db, { officeName: 'B', name: 'Av. İki', email: 'b@t.local', password: 'sifre1234' }).user;
  });

  it('bayram tatili son günü izleyen iş gününe uzatır', () => {
    // 2026 Kurban Bayramı 27–30 Mayıs; 30 Mayıs cumartesi, 31 pazar → 1 Haziran.
    const r = computeDeadline({ amount: 2, unit: 'hafta', judicial: false, businessDay: true }, '2026-05-13');
    assert.equal(r.date, '2026-06-01');
  });

  it('aşama eklenince yasal süre ve seçilen işler görev olarak açılır', () => {
    const c = cases.createCase(db, a, { title: 'Veli / Deniz', area: 'is' }) as { id: number };
    const empty = safahat.getSafahat(db, a, c.id);
    assert.equal(empty.current, null);
    assert.equal(empty.timeline[0].state, 'todo');
    const prev = safahat.previewStage(db, a, c.id, { stage: 'teblig_karar', date: '2026-07-10' });
    assert.equal(prev.deadline?.ruleId, 'hmk-istinaf');
    // 2 hafta → 24 Temmuz adli tatilde → 7 Eylül.
    assert.equal(prev.deadline?.date, '2026-09-07');
    const r = safahat.addStage(db, a, c.id, { stage: 'teblig_karar', date: '2026-07-10', steps: [prev.steps[0].title] });
    assert.ok(r.created.deadline);
    assert.equal(r.created.tasks.length, 1);
    assert.equal(r.current?.stage, 'teblig_karar');
    assert.equal(r.timeline.find((t) => t.id === 'karar')?.state, 'current');
    assert.equal(r.nextStage, 'istinaf');
    assert.equal((db.prepare('SELECT stage FROM cases WHERE id = ?').get(c.id) as { stage: string }).stage, 'teblig_karar');
    const after = safahat.deleteStage(db, a, c.id, r.entries[0].id);
    assert.equal(after.current, null);
    assert.throws(() => safahat.getSafahat(db, b, c.id), ApiError);
    assert.throws(() => safahat.addStage(db, a, c.id, { stage: 'yok' }), ApiError);
  });

  it('son güne 3 gün ve 1 gün kala ayrı bildirim, okundu işareti', () => {
    const c = cases.createCase(db, a, { title: 'Dosya' }) as { id: number };
    const d = (n: number) => {
      const x = new Date();
      x.setUTCDate(x.getUTCDate() + n);
      return x.toISOString().slice(0, 10);
    };
    db.prepare("INSERT INTO legal_deadlines (office_id, case_id, title, due_date, responsible_id, created_by) VALUES (?, ?, 'Cevap dilekçesi', ?, ?, ?)").run(a.office_id, c.id, d(3), a.id, a.id);
    db.prepare("INSERT INTO legal_deadlines (office_id, case_id, title, due_date, responsible_id, created_by) VALUES (?, ?, 'Uzak süre', ?, ?, ?)").run(a.office_id, c.id, d(20), a.id, a.id);
    tasks.createTask(db, a, { title: 'Delil listesi', caseId: c.id, dueDate: d(-1) });
    const n = notifications.listNotifications(db, a);
    assert.equal(n.items.length, 2);
    assert.ok(n.items.some((i) => i.key.endsWith('-3') && i.level === 'uyari'));
    assert.ok(n.items.some((i) => i.kind === 'gorev' && i.level === 'kritik'));
    const r = notifications.markRead(db, a, { all: true });
    assert.equal(r.unread, 0);
    // Süre 1 güne inince yeni (okunmamış) bildirim olur.
    db.prepare("UPDATE legal_deadlines SET due_date = ? WHERE title = 'Cevap dilekçesi'").run(d(1));
    const later = notifications.listNotifications(db, a);
    assert.equal(later.unread, 1);
    assert.equal(notifications.listNotifications(db, b).items.length, 0);
  });
});
