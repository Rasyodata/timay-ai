import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { createApp } from '../src/app.ts';
import { openDb } from '../src/db.ts';
import { newer, type Jwks } from '../src/update.ts';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwks: Jwks = async () => ({ keys: [{ ...publicKey.export({ format: 'jwk' }), kid: 'k1' }] });
const enc = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
function token(claims: Record<string, unknown>, kid = 'k1') {
  const head = enc({ alg: 'RS256', kid });
  const body = enc({
    iss: 'https://token.actions.githubusercontent.com',
    aud: 'timay-sunucu',
    repository: 'Rasyodata/timay-ai',
    ref: 'refs/heads/main',
    exp: Math.floor(Date.now() / 1000) + 300,
    ...claims,
  });
  return `${head}.${body}.${sign('RSA-SHA256', Buffer.from(`${head}.${body}`), privateKey).toString('base64url')}`;
}

describe('program güncellemesi', () => {
  let base = '';
  let close = () => {};
  before(async () => {
    const server = createApp(openDb(), { updateDir: mkdtempSync(join(tmpdir(), 'timay-upd-')), jwks }).listen(0);
    await new Promise((r) => server.once('listening', r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    close = () => server.close();
  });
  after(() => close());

  const upload = (auth: string, version: string, size = 4096) =>
    fetch(`${base}/api/guncelleme/yukle`, {
      method: 'POST',
      headers: { authorization: `Bearer ${auth}`, 'x-timay-version': version, 'content-type': 'application/octet-stream' },
      body: Buffer.alloc(size, 7),
    });

  it('sürüm karşılaştırma', () => {
    assert.equal(newer('0.2.10', '0.2.9'), true);
    assert.equal(newer('0.2.9', '0.2.9'), false);
    assert.equal(newer('0.1.0', '0.2.1'), false);
  });

  it('henüz yükleme yoksa sürüm boş', async () => {
    assert.deepEqual(await (await fetch(`${base}/api/guncelleme`)).json(), { version: null });
  });

  it('yalnız main dalının imzalı kimliği yükleyebilir', async () => {
    assert.equal((await upload('bozuk', '0.2.1')).status, 403);
    assert.equal((await upload(token({ ref: 'refs/heads/deneme' }), '0.2.1')).status, 403);
    assert.equal((await upload(token({ repository: 'baska/depo' }), '0.2.1')).status, 403);
    assert.equal((await upload(token({ aud: 'baska' }), '0.2.1')).status, 403);
    assert.equal((await upload(token({ exp: 1 }), '0.2.1')).status, 403);
    assert.equal((await upload(token({}, 'yok'), '0.2.1')).status, 403);
    const forged = token({}).split('.');
    forged[1] = enc({ iss: 'https://token.actions.githubusercontent.com', aud: 'timay-sunucu', repository: 'Rasyodata/timay-ai', ref: 'refs/heads/main', exp: 9e9 });
    assert.equal((await upload(forged.join('.'), '0.2.1')).status, 403);
    assert.equal((await upload(token({}), 'abc')).status, 400);
  });

  it('yüklenen son sürüm bilgisi ve dosyası verilir, eskisi silinir', async () => {
    assert.equal((await upload(token({}), '0.2.1')).status, 200);
    const r = await upload(token({}), '0.2.2', 5000);
    assert.equal(r.status, 200);
    const info = (await (await fetch(`${base}/api/guncelleme`)).json()) as { version: string; size: number; sha256: string };
    assert.equal(info.version, '0.2.2');
    assert.equal(info.size, 5000);
    assert.match(info.sha256, /^[0-9a-f]{64}$/);
    const file = Buffer.from(await (await fetch(`${base}/api/guncelleme/indir`)).arrayBuffer());
    assert.equal(file.length, 5000);
  });
});
