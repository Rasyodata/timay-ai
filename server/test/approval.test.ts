import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import * as auth from '../src/auth.ts';
import { createCase } from '../src/cases.ts';
import { extractCitations } from '../src/citations.ts';
import { openDb, type DB } from '../src/db.ts';
import { upsertDecision } from '../src/decisions.ts';
import { ApiError } from '../src/errors.ts';
import * as petitions from '../src/petitions.ts';

// Testlerdeki karar numaraları uydurmadır; gerçek kararlara karşılık gelmez.
const KNOWN = 'Test Dairesi 2020/111 E., 2021/222 K. sayılı kararı';
const UNKNOWN = 'Test Dairesi 2019/999 E., 2019/888 K. sayılı kararı';

function rejects(fn: () => unknown, status: number) {
  assert.throws(fn, (err: unknown) => err instanceof ApiError && err.status === status);
}

describe('atıf ayrıştırma', () => {
  it('iki yazım biçimini de tanır', () => {
    const found = extractCitations('... 2020/111 E., 2021/222 K. ve E. 2018/5, K. 2018/77 ...');
    assert.deepEqual(
      found.map((c) => [c.esasNo, c.kararNo]),
      [
        ['2020/111', '2021/222'],
        ['2018/5', '2018/77'],
      ],
    );
  });
});

/** İnceleyenin sarı/gri dayanakların hepsini kontrol ettiğini işaretler. */
function ackAll(db: DB, user: auth.User, petitionId: number) {
  for (const item of petitions.getPetition(db, user, petitionId).teyit.items) {
    if (item.status === 'sari' || item.status === 'gri') petitions.ackItem(db, user, petitionId, { key: item.key, checked: true });
  }
}

describe('onay akışı', () => {
  let db: DB;
  let author: auth.User;
  let reviewer: auth.User;
  let intern: auth.User;
  let petitionId: number;

  beforeEach(() => {
    db = openDb();
    author = auth.registerOffice(db, {
      officeName: 'Test Hukuk',
      name: 'Yazan Avukat',
      email: 'yazan@test.local',
      password: 'sifre1234',
    }).user;
    const inv1 = auth.createInvite(db, author, { email: 'onaylayan@test.local', role: 'avukat' });
    reviewer = auth.acceptInvite(db, { token: inv1.token, name: 'Onaylayan Avukat', password: 'sifre1234' }).user;
    const inv2 = auth.createInvite(db, author, { email: 'stajyer@test.local', role: 'stajyer' });
    intern = auth.acceptInvite(db, { token: inv2.token, name: 'Stajyer', password: 'sifre1234' }).user;
    upsertDecision(db, { court: 'Test Mahkemesi', esasNo: '2020/111', kararNo: '2021/222' });
    const c = createCase(db, author, { title: 'İşçilik alacağı' });
    petitionId = petitions.createPetition(db, author, { caseId: c.id, title: 'Dava dilekçesi', body: KNOWN }).id;
  });

  it('başka bir avukatın onayıyla Onaylı olur', () => {
    petitions.submitForReview(db, author, petitionId);
    ackAll(db, reviewer, petitionId);
    const result = petitions.review(db, reviewer, petitionId, { action: 'approve' });
    assert.equal(result.status, 'onayli');
    assert.equal(result.reviews.length, 1);
  });

  it('yazan avukat kendi dilekçesini onaylayamaz', () => {
    petitions.submitForReview(db, author, petitionId);
    rejects(() => petitions.review(db, author, petitionId, { action: 'approve' }), 403);
  });

  it('bir sürüm yazan avukat da onaylayamaz', () => {
    petitions.saveVersion(db, reviewer, petitionId, KNOWN + ' ek');
    petitions.submitForReview(db, author, petitionId);
    rejects(() => petitions.review(db, reviewer, petitionId, { action: 'approve' }), 403);
  });

  it('stajyer onaylayamaz', () => {
    petitions.submitForReview(db, author, petitionId);
    rejects(() => petitions.review(db, intern, petitionId, { action: 'approve' }), 403);
  });

  it('arşivde olmayan atıf varsa incelemeye gönderilemez', () => {
    petitions.saveVersion(db, author, petitionId, `${KNOWN}\n${UNKNOWN}`);
    rejects(() => petitions.submitForReview(db, author, petitionId), 422);
  });

  it('düzeltme isteği açıklama ister ve yeni sürümle tekrar taslağa döner', () => {
    petitions.submitForReview(db, author, petitionId);
    rejects(() => petitions.review(db, reviewer, petitionId, { action: 'request_changes' }), 400);
    const asked = petitions.review(db, reviewer, petitionId, { action: 'request_changes', comment: 'Faiz talebini ekleyin.' });
    assert.equal(asked.status, 'duzeltme');
    const edited = petitions.saveVersion(db, author, petitionId, KNOWN + ' faiz');
    assert.equal(edited.status, 'taslak');
    assert.equal(edited.version, 2);
  });

  it('incelemedeki ve onaylı dilekçe değiştirilemez', () => {
    petitions.submitForReview(db, author, petitionId);
    rejects(() => petitions.saveVersion(db, author, petitionId, 'yeni'), 409);
    ackAll(db, reviewer, petitionId);
    petitions.review(db, reviewer, petitionId, { action: 'approve' });
    rejects(() => petitions.saveVersion(db, author, petitionId, 'yeni'), 409);
  });

  it('başka büronun dilekçesi görünmez', () => {
    const other = auth.registerOffice(db, {
      officeName: 'Başka Büro',
      name: 'Başka',
      email: 'baska@test.local',
      password: 'sifre1234',
    }).user;
    rejects(() => petitions.getPetition(db, other, petitionId), 404);
  });
});
