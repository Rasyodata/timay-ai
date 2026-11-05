import assert from 'node:assert/strict';
import { generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import { beforeEach, describe, it } from 'node:test';
import { openDb, type DB } from '../src/db.ts';
import { ApiError } from '../src/errors.ts';
import { ssoLogin, type Fetch } from '../src/sso.ts';

const KAYNAK = 'http://platform.test';
process.env.PLATFORM_SSO_KAYNAK = KAYNAK;
const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const fetchAnahtar: Fetch = async (url) => {
  assert.equal(url, `${KAYNAK}/api/sso/anahtar`);
  return { ok: true, status: 200, json: async () => ({ acik: publicKey.export({ type: 'spki', format: 'pem' }) }) };
};
function belge(ek: Record<string, unknown> = {}, anahtar = privateKey) {
  const simdi = Math.floor(Date.now() / 1000);
  const govde = Buffer.from(JSON.stringify({ aud: 'timay', iat: simdi, exp: simdi + 60, nonce: randomBytes(8).toString('hex'),
    sirket: { id: 7, unvan: 'KY YATIRIM' }, kullanici: { id: 3, ad: 'Kadir Fırat', eposta: null }, rol: 'avukat', yonetici: true, ...ek })).toString('base64url');
  return `${govde}.${sign(null, Buffer.from(govde), anahtar).toString('base64url')}`;
}
async function reddeder(p: Promise<unknown>, status: number) {
  await assert.rejects(p, (e: unknown) => e instanceof ApiError && e.status === status);
}

describe('platformdan tek oturum (SSO)', () => {
  let db: DB;
  beforeEach(() => { db = openDb(':memory:'); });

  it('imzalı belgeyle şifresiz giriş: şirket için büro, kullanıcı için hesap açar; ikinci girişte aynı hesap', async () => {
    const r = await ssoLogin(db, { token: belge(), kaynak: KAYNAK }, fetchAnahtar);
    assert.ok(r.token);
    assert.equal(r.user.name, 'Kadir Fırat'); assert.equal(r.user.role, 'avukat'); assert.equal(r.user.is_admin, 1); assert.equal(r.user.can_approve, 1);
    const buro = db.prepare('SELECT name FROM offices WHERE id = ?').get(r.user.office_id) as { name: string };
    assert.equal(buro.name, 'KY YATIRIM');
    const r2 = await ssoLogin(db, { token: belge(), kaynak: KAYNAK }, fetchAnahtar);
    assert.equal(r2.user.id, r.user.id);
    assert.notEqual(r2.token, r.token);
  });

  it('rol her girişte eşitlenir; stajyer onaylayamaz ve yönetici olamaz', async () => {
    await ssoLogin(db, { token: belge(), kaynak: KAYNAK }, fetchAnahtar);
    const r = await ssoLogin(db, { token: belge({ rol: 'stajyer', yonetici: true }), kaynak: KAYNAK }, fetchAnahtar);
    assert.equal(r.user.role, 'stajyer'); assert.equal(r.user.can_approve, 0); assert.equal(r.user.is_admin, 0);
  });

  it('farklı şirket ayrı büro; mevcut bürolara dokunulmaz', async () => {
    db.prepare("INSERT INTO offices (name) VALUES ('Mevcut Büro')").run();
    const a = await ssoLogin(db, { token: belge(), kaynak: KAYNAK }, fetchAnahtar);
    const b = await ssoLogin(db, { token: belge({ sirket: { id: 8, unvan: 'EFFECT OFFICE' } }), kaynak: KAYNAK }, fetchAnahtar);
    assert.notEqual(a.user.office_id, b.user.office_id);
    assert.equal((db.prepare('SELECT COUNT(*) n FROM offices').get() as { n: number }).n, 3);
  });

  it('sahte imza, süresi dolmuş belge, tekrar kullanım ve izinsiz platform reddedilir', async () => {
    const sahte = generateKeyPairSync('ed25519').privateKey;
    await reddeder(ssoLogin(db, { token: belge({}, sahte), kaynak: KAYNAK }, fetchAnahtar), 401);
    const eski = Math.floor(Date.now() / 1000) - 600;
    await reddeder(ssoLogin(db, { token: belge({ iat: eski, exp: eski + 60 }), kaynak: KAYNAK }, fetchAnahtar), 401);
    const t = belge();
    await ssoLogin(db, { token: t, kaynak: KAYNAK }, fetchAnahtar);
    await reddeder(ssoLogin(db, { token: t, kaynak: KAYNAK }, fetchAnahtar), 401);
    await reddeder(ssoLogin(db, { token: belge(), kaynak: 'https://kotu.example' }, fetchAnahtar), 403);
  });
});
