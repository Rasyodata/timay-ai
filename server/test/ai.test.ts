import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import * as ai from '../src/ai.ts';
import * as auth from '../src/auth.ts';
import * as cases from '../src/cases.ts';
import type { AiModel, AiRequest } from '../src/claude.ts';
import * as contracts from '../src/contracts.ts';
import { openDb, type DB } from '../src/db.ts';
import { ApiError } from '../src/errors.ts';

describe('yapay zekâ', () => {
  let db: DB;
  let a: auth.User;
  let b: auth.User;
  let calls: AiRequest[];
  let answer: string;
  const model: AiModel = async (req) => {
    calls.push(req);
    return { text: answer, model: 'test-model' };
  };
  beforeEach(() => {
    db = openDb();
    a = auth.registerOffice(db, { officeName: 'A', name: 'Av. Bir', email: 'a@t.local', password: 'sifre1234' }).user;
    b = auth.registerOffice(db, { officeName: 'B', name: 'Av. İki', email: 'b@t.local', password: 'sifre1234' }).user;
    calls = [];
    answer = 'Yanıt';
  });

  it('anahtar yoksa açıklayıcı hata verir', async () => {
    const chat = ai.createChat(db, a, { mode: 'genel' });
    await assert.rejects(ai.sendMessage(db, a, chat.id, { content: 'Merhaba' }, null), (e: ApiError) => e.status === 503);
    assert.equal(ai.getChat(db, a, chat.id).messages.length, 0);
    assert.equal(ai.aiStatus(null).enabled, false);
  });

  it('sohbet dava dosyasını bağlam olarak verir, geçmişi taşır, kişiye özeldir', async () => {
    const c = cases.createCase(db, a, { title: 'Kira tespiti', client: 'Ali Veli', facts: 'Kiracı 2019 yılından beri oturuyor.' });
    const chat = ai.createChat(db, a, { mode: 'dilekce', caseId: c.id });
    await ai.sendMessage(db, a, chat.id, { content: 'Dava dilekçesinin konusu ne olmalı?' }, model);
    answer = 'İkinci yanıt';
    const after = await ai.sendMessage(db, a, chat.id, { content: 'Peki harç?' }, model);
    assert.equal(after.messages.length, 4);
    assert.equal(after.title, 'Dava dilekçesinin konusu ne olmalı?');
    assert.match(calls[1].system, /Kiracı 2019 yılından beri oturuyor/);
    assert.match(calls[1].system, /HMK m\.119/);
    assert.deepEqual(calls[1].messages.map((m) => m.role), ['user', 'assistant', 'user']);
    assert.throws(() => ai.getChat(db, b, chat.id), (e: ApiError) => e.status === 404);
    assert.throws(() => ai.createChat(db, b, { caseId: c.id }), (e: ApiError) => e.status === 404);
    assert.equal(ai.listChats(db, a).length, 1);
    ai.deleteChat(db, a, chat.id);
    assert.equal(ai.listChats(db, a).length, 0);
  });

  it('dilekçe taslağını dosyaya taslak olarak ekler', async () => {
    const c = cases.createCase(db, a, { title: 'İşçilik alacağı', client: 'Ayşe' });
    answer = JSON.stringify({ title: 'Dava dilekçesi', body: 'ANKARA İŞ MAHKEMESİNE\n...', notes: '- Ücret bordrosu eksik' });
    const r = await ai.draftPetition(db, a, { caseId: c.id, kind: 'dava dilekçesi' }, model);
    assert.equal(r.petition.status, 'taslak');
    assert.equal(r.petition.title, 'Dava dilekçesi');
    assert.ok(calls[0].schema);
    await assert.rejects(ai.draftPetition(db, b, { caseId: c.id }, model), (e: ApiError) => e.status === 404);
  });

  it('sözleşme okumasında alıntıları metinde doğrular ve saklar', async () => {
    const k = contracts.createContract(db, a, { title: 'Kira', kind: 'kira', parties: 'A / B', body: 'Kiracı kirayı her ayın 5. günü öder. Uyuşmazlıkta Londra mahkemeleri yetkilidir.' });
    answer = JSON.stringify({
      summary: 'Genel',
      findings: [
        { title: 'Yetki', verdict: 'aleyhte', severity: 'yuksek', quote: 'Londra  mahkemeleri yetkilidir', note: '', basis: 'HMK m.17', suggestion: '' },
        { title: 'Uydurma', verdict: 'lehte', severity: 'dusuk', quote: 'olmayan cümle', note: '', basis: '', suggestion: '' },
      ],
    });
    const r = await ai.reviewContract(db, a, k.id, { side: 'kiracı' }, model);
    assert.deepEqual(r.findings.map((f) => f.verified), [true, false]);
    assert.equal(ai.lastResult(db, a, 'sozlesme', k.id).summary, 'Genel');
    assert.throws(() => ai.lastResult(db, b, 'sozlesme', k.id), (e: ApiError) => e.status === 404);
  });

  it('karar sınıflandırması alıntıyı doğrular', async () => {
    const c = cases.createCase(db, a, { title: 'Tahliye' });
    answer = JSON.stringify({ side: 'lehte', principle: 'İlke', reason: 'Çünkü', quote: 'ihtiyaç samimi olmalıdır', use: 'Kullan' });
    const r = await ai.classifyDecision(db, a, { caseId: c.id, text: 'Kiralayanın ihtiyacı gerçek ve samimi olmalıdır.', title: 'Y3HD' }, model);
    assert.equal(r.side, 'lehte');
    assert.equal(r.verified, false);
    answer = JSON.stringify({ side: 'lehte', principle: 'İlke', reason: 'Çünkü', quote: 'gerçek ve SAMİMİ olmalıdır', use: 'Kullan' });
    assert.equal((await ai.classifyDecision(db, a, { caseId: c.id, text: 'Kiralayanın ihtiyacı gerçek ve samimi olmalıdır.' }, model)).verified, true);
  });

  it('infaz tarihlerini oran ve günlerden sunucu hesaplar', async () => {
    assert.equal(ai.sentenceDays('2024-01-01', 1, 0, 0), 366);
    assert.equal(ai.sentenceDays('2025-01-01', 2, 6, 0), 911);
    const d = ai.infazDates({ startDate: '2025-01-01', totalDays: 730, ratioNum: 1, ratioDen: 2, fixedDays: 0, dsDays: 365, outsideDays: 10 });
    assert.equal(d.conditional_days, 365);
    assert.equal(d.kosullu_tarih, '2026-01-11');
    assert.equal(d.ds_tarih, '2025-01-11');
    assert.equal(d.ceza_bitis, '2027-01-11');
    // Denetimli serbestlik cezaevine girişten önceye düşmez.
    assert.equal(ai.infazDates({ startDate: '2025-01-01', totalDays: 100, ratioNum: 1, ratioDen: 2, fixedDays: 0, dsDays: 365, outsideDays: 0 }).ds_tarih, '2025-01-01');

    answer = JSON.stringify({ category: 'Genel', ratio_num: 1, ratio_den: 2, fixed_days: 0, ds_days: 365, ratio_basis: '5275 m.107/2', ds_basis: '5275 m.105/A', steps: ['a'], warnings: [] });
    const r = await ai.infazCalc(db, a, { crime: 'TCK 142', years: 2, startDate: '2025-01-01' }, model);
    assert.equal(r.total_days, 730);
    assert.equal(r.kosullu_tarih, '2026-01-01');
    assert.equal(ai.infazHistory(db, a).length, 1);
    await assert.rejects(ai.infazCalc(db, a, { crime: 'x', startDate: '2025-01-01' }, model), (e: ApiError) => e.status === 400);
    answer = JSON.stringify({ category: 'x', ratio_num: 3, ratio_den: 2, fixed_days: 0, ds_days: 0, ratio_basis: '', ds_basis: '', steps: [], warnings: [] });
    await assert.rejects(ai.infazCalc(db, a, { crime: 'x', years: 1, startDate: '2025-01-01' }, model), (e: ApiError) => e.status === 422);
  });
});
