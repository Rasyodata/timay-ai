import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import * as auth from '../src/auth.ts';
import * as cases from '../src/cases.ts';
import * as contracts from '../src/contracts.ts';
import * as enforcement from '../src/enforcement.ts';
import { openDb, type DB } from '../src/db.ts';
import { ApiError } from '../src/errors.ts';
import * as petitions from '../src/petitions.ts';
import * as refresh from '../src/refresh.ts';

describe('Güncelle: analizi yeniden çalıştırma', () => {
  let db: DB;
  let a: auth.User;
  let b: auth.User;

  beforeEach(() => {
    db = openDb();
    a = auth.registerOffice(db, { officeName: 'A', name: 'Av. Bir', email: 'a@t.local', password: 'sifre1234' }).user;
    b = auth.registerOffice(db, { officeName: 'B', name: 'Av. İki', email: 'b@t.local', password: 'sifre1234' }).user;
  });

  it('dava dosyasının eksiklerini bulur, düzeltilince farkı gösterir', () => {
    const c = cases.createCase(db, a, { title: 'Veli / Deniz', area: 'is' }) as { id: number };
    assert.equal(refresh.status(db, a, 'case', c.id).stale, true);
    const first = refresh.refresh(db, a, 'case', c.id);
    const keys = first.current.issues.map((i) => i.key);
    assert.ok(keys.includes('mahkeme'));
    assert.ok(keys.includes('vekalet'));
    assert.equal(first.previous, null);
    petitions.createPetition(db, a, { caseId: c.id, title: 'Dava dilekçesi', body: 'Sayın Mahkeme,\nMüvekkil alacaklarını istiyor vs. toplam [TUTAR] TL.' });
    cases.updateCase(db, a, c.id, { title: 'Veli / Deniz', area: 'is', court: 'İstanbul 5. İş Mahkemesi' });
    const second = refresh.refresh(db, a, 'case', c.id);
    assert.ok(second.previous);
    assert.ok(second.changes.resolved.some((i) => i.key === 'mahkeme'));
    assert.ok(second.changes.added.some((i) => i.key.startsWith('dilekce-')));
    assert.equal(refresh.status(db, a, 'case', c.id).stale, false);
    assert.throws(() => refresh.refresh(db, b, 'case', c.id), ApiError);
  });

  it('sözleşmeyi yeniden puanlar ve tümünü güncelle değişenleri listeler', () => {
    const k = contracts.createContract(db, a, { title: 'Kira', kind: 'kira', body: 'Kiracı her türlü zarardan sınırsız sorumludur. Uyuşmazlıkta Londra mahkemeleri yetkilidir.' }) as { id: number };
    const r = refresh.refresh(db, a, 'contract', k.id);
    assert.ok(r.current.issues.length > 0);
    const all = refresh.refreshAll(db, a);
    assert.equal(all.count, 1);
    assert.equal(all.changed.length, 0, 'değişiklik yoksa listede görünmez');
    assert.throws(() => refresh.refresh(db, b, 'contract', k.id), ApiError);
    assert.throws(() => refresh.refresh(db, a, 'dosya', k.id), ApiError);
  });

  it('icra dosyasını ajanlarla analiz eder; derin analiz yapay zekâ yoksa standarda düşer', async () => {
    const f = enforcement.createFile(db, a, { debtor: 'Borçlu Ltd.', kind: 'ilamsiz', principal: 50000, startDate: '2024-01-10', status: 'itiraz' }) as { id: number };
    const r = await refresh.refreshWithAnalysis(db, a, 'icra', f.id, { analysis: 'derin' }, null);
    assert.equal(r.analysis, 'standart');
    assert.match(r.note ?? '', /yapay zekâ/);
    const byKey = new Map(r.current.issues.map((i) => [i.key, i]));
    assert.equal(byKey.get('itiraz')?.agent, 'karsi');
    assert.equal(byKey.get('haciz-sure')?.agent, 'sure');
    assert.equal(byKey.get('borclu-tc')?.agent, 'hakim');
    const c = cases.createCase(db, a, { title: 'Kira', area: 'kira' }) as { id: number };
    const model = async () => ({ model: 't', text: JSON.stringify({ agents: [{ id: 'sure', findings: [{ level: 'kritik', text: 'Tahliye için ihtar süresi kaçabilir.', basis: 'TBK m.315', quote: '' }] }] }) });
    const deep = await refresh.refreshWithAnalysis(db, a, 'case', c.id, { analysis: 'derin' }, model);
    assert.equal(deep.analysis, 'derin');
    assert.ok(deep.current.issues.some((i) => i.ai && i.agent === 'sure' && i.level === 'yuksek'));
    assert.ok(deep.current.issues.every((i) => i.agent));
    const again = await refresh.refreshWithAnalysis(db, a, 'case', c.id, {}, null);
    assert.equal(again.changes.added.length + again.changes.resolved.length, 0, 'yapay zekâ bulguları farka girmez');
  });
});
