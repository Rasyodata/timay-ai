import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import * as auth from '../src/auth.ts';
import { createCase } from '../src/cases.ts';
import { openDb, type DB } from '../src/db.ts';
import { upsertDecision } from '../src/decisions.ts';
import { ApiError } from '../src/errors.ts';
import * as opposing from '../src/opposing.ts';
import * as petitions from '../src/petitions.ts';
import { extractLawRefs, type DeepChecker, type DeepItem } from '../src/teyit.ts';

// Karar numaraları ve metinleri uydurmadır.
const DECISION_TEXT = 'Haklı fesih halinde işçiye kıdem tazminatı ödenmesi gerekir. Diğer hususlar yerindedir.';
const FACTS = 'Davacı 01.03.2015 tarihinde işe başlamış, 10.01.2024 tarihinde iş sözleşmesini feshetmiştir.';
const BODY = [
  'Müvekkil 01.03.2015 tarihinde işe başlamıştır.',
  'Yargıtay 2020/111 E., 2021/222 K. sayılı kararında haklı fesihte kıdem tazminatı ödeneceğini belirtmiştir.',
  '4857 sayılı İş Kanunu m. 17 uyarınca ihbar süresi uygulanır. TBK m. 344 de dikkate alınmalıdır.',
].join('\n');

function rejectsAsync(promise: Promise<unknown>, status: number) {
  return assert.rejects(promise, (err: unknown) => err instanceof ApiError && err.status === status);
}

const fakeChecker: DeepChecker = async () => ({
  model: 'test',
  items: (<DeepItem[]>[
    {
      kind: 'karar',
      quote: '2020/111 E., 2021/222 K.',
      status: 'yesil',
      explanation: 'Karar haklı fesihte kıdem tazminatını öngörüyor.',
      source_quote: 'Haklı fesih halinde işçiye kıdem tazminatı ödenmesi gerekir.',
    },
    {
      kind: 'kanun',
      quote: '4857 sayılı İş Kanunu m. 17',
      status: 'yesil',
      explanation: 'm. 17 ihbar sürelerini düzenler.',
      source_quote: '',
    },
    {
      kind: 'olgu',
      quote: 'Müvekkil 01.03.2015 tarihinde işe başlamıştır.',
      status: 'yesil',
      explanation: 'Dosyadaki işe giriş tarihiyle aynı.',
      source_quote: 'Davacı 01.03.2015 tarihinde işe başlamış',
    },
    {
      kind: 'olgu',
      quote: 'Bu cümle dilekçede yok.',
      status: 'yesil',
      explanation: 'Uydurma alıntı; atılmalı.',
      source_quote: '',
    },
  ]),
});

describe('kanun atfı ayrıştırma', () => {
  it('sayı ve kısaltma ile yazılan maddeleri tanır', () => {
    const refs = extractLawRefs("4857 sayılı İş Kanunu m. 17, TBK'nın 344. maddesi ve HMK m. 119");
    assert.deepEqual(
      refs.map((r) => [r.lawNo ?? r.short, r.article]),
      [
        ['4857', 17],
        ['TBK', 344],
        ['HMK', 119],
      ],
    );
  });
});

describe('teyit', () => {
  let db: DB;
  let author: auth.User;
  let reviewer: auth.User;
  let caseId: number;
  let petitionId: number;

  beforeEach(() => {
    db = openDb();
    author = auth.registerOffice(db, {
      officeName: 'Test Hukuk',
      name: 'Yazan Avukat',
      email: 'yazan@test.local',
      password: 'sifre1234',
    }).user;
    const inv = auth.createInvite(db, author, { email: 'onaylayan@test.local', role: 'avukat' });
    reviewer = auth.acceptInvite(db, { token: inv.token, name: 'Onaylayan Avukat', password: 'sifre1234' }).user;
    upsertDecision(db, { court: 'Test Mahkemesi', esasNo: '2020/111', kararNo: '2021/222', text: DECISION_TEXT });
    caseId = createCase(db, author, { title: 'İşçilik alacağı', facts: FACTS }).id;
    petitionId = petitions.createPetition(db, author, { caseId, title: 'Dava dilekçesi', body: BODY }).id;
  });

  it('hızlı teyit: arşivdeki karar ve bilinen madde sarı', () => {
    const { teyit } = petitions.getPetition(db, author, petitionId);
    assert.deepEqual(
      teyit.items.map((i) => [i.kind, i.status]),
      [
        ['karar', 'sari'],
        ['kanun', 'sari'],
        ['kanun', 'sari'],
      ],
    );
  });

  it('olmayan madde numarası kırmızıdır ve incelemeye gönderimi engeller', () => {
    petitions.saveVersion(db, author, petitionId, `${BODY}\nTBK m. 900`);
    const { teyit } = petitions.getPetition(db, author, petitionId);
    assert.equal(teyit.items.find((i) => i.quote.includes('900'))?.status, 'kirmizi');
    assert.throws(
      () => petitions.submitForReview(db, author, petitionId),
      (err: unknown) => err instanceof ApiError && err.status === 422 && 'red' in (err.details as object),
    );
  });

  it('listede olmayan kanun gridir', () => {
    petitions.saveVersion(db, author, petitionId, '1234 sayılı Örnek Kanun m. 5');
    assert.equal(petitions.getPetition(db, author, petitionId).teyit.items[0].status, 'gri');
  });

  it('sarı dayanaklar işaretlenmeden onaylanamaz; onayda teyit özeti saklanır', () => {
    petitions.submitForReview(db, author, petitionId);
    assert.throws(
      () => petitions.review(db, reviewer, petitionId, { action: 'approve' }),
      (err: unknown) => err instanceof ApiError && err.status === 422,
    );
    for (const item of petitions.getPetition(db, reviewer, petitionId).teyit.items) {
      petitions.ackItem(db, reviewer, petitionId, { key: item.key, checked: true });
    }
    const result = petitions.review(db, reviewer, petitionId, { action: 'approve' });
    assert.equal(result.status, 'onayli');
    assert.equal(result.approval?.reviewer_name, 'Onaylayan Avukat');
    assert.equal(result.approval?.summary.total, 3);
  });

  it('yazan avukat dayanak işaretleyemez', () => {
    petitions.submitForReview(db, author, petitionId);
    const key = petitions.getPetition(db, author, petitionId).teyit.items[0].key;
    assert.throws(
      () => petitions.ackItem(db, author, petitionId, { key, checked: true }),
      (err: unknown) => err instanceof ApiError && err.status === 403,
    );
  });

  it('derin teyit: yeşil yalnızca kaynakta birebir alıntı varsa kalır', async () => {
    const result = await petitions.deepCheck(db, author, petitionId, fakeChecker);
    const byKind = (kind: string) => result.teyit.items.filter((i) => i.kind === kind);
    assert.equal(byKind('karar')[0].status, 'yesil');
    assert.equal(byKind('karar')[0].source?.quote, 'Haklı fesih halinde işçiye kıdem tazminatı ödenmesi gerekir.');
    // Kanun maddesinin metni arşivde yok: en fazla sarı.
    assert.equal(byKind('kanun')[0].status, 'sari');
    // Dilekçede geçmeyen alıntı atılır, dosyada karşılığı olan olgu yeşildir.
    assert.equal(byKind('olgu').length, 1);
    assert.equal(byKind('olgu')[0].status, 'yesil');
    assert.ok(result.teyit.deepCheckedAt);
  });

  it('derin teyit, yeni sürümde tekrar yapılana kadar eski sürüme bağlı kalır', async () => {
    await petitions.deepCheck(db, author, petitionId, fakeChecker);
    const next = petitions.saveVersion(db, author, petitionId, BODY + '\nEk açıklama.');
    assert.equal(next.teyit.deepCheckedAt, null);
    assert.equal(next.teyit.items.find((i) => i.kind === 'karar')?.status, 'sari');
  });

  it('Claude anahtarı yoksa derin teyit anlaşılır hata verir', async () => {
    await rejectsAsync(petitions.deepCheck(db, author, petitionId, null), 503);
  });

  it('karşı taraf dilekçesi teyit edilir', async () => {
    const doc = opposing.createOpposing(db, author, caseId, {
      title: 'Cevap dilekçesi',
      body: 'Yargıtay 2019/999 E., 2019/888 K. sayılı kararı ve 2020/111 E., 2021/222 K. sayılı kararı',
    });
    assert.deepEqual(
      doc.teyit.items.map((i) => i.status),
      ['kirmizi', 'sari'],
    );
    const checked = await opposing.deepCheckOpposing(db, author, doc.id, fakeChecker);
    assert.deepEqual(
      checked.teyit.items.map((i) => i.status),
      ['kirmizi', 'yesil'],
    );
  });
});
