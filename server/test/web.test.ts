import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { createApp } from '../src/app.ts';
import { openDb } from '../src/db.ts';

describe('tarayıcı sürümü (/uygulama/)', () => {
  let base = '';
  let close = () => {};
  before(async () => {
    const dir = mkdtempSync(join(tmpdir(), 'timay-web-'));
    writeFileSync(join(dir, 'index.html'), '<html>timay-web</html>');
    mkdirSync(join(dir, 'ocr'));
    writeFileSync(join(dir, 'ocr', 'worker.min.js'), '//w');
    const server = createApp(openDb(), { webDir: dir }).listen(0);
    await new Promise((r) => server.once('listening', r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    close = () => server.close();
  });
  after(() => close());

  it('kök ve /uygulama adresi /uygulama/ adresine yönlenir', async () => {
    for (const p of ['/', '/uygulama']) {
      const r = await fetch(base + p, { redirect: 'manual' });
      assert.equal(r.status, 302);
      assert.equal(r.headers.get('location'), '/uygulama/');
    }
  });

  it('sayfayı, dosyaları ve bilinmeyen alt adresleri sunar; API etkilenmez', async () => {
    assert.match(await (await fetch(`${base}/uygulama/`)).text(), /timay-web/);
    assert.equal(await (await fetch(`${base}/uygulama/ocr/worker.min.js`)).text(), '//w');
    assert.match(await (await fetch(`${base}/uygulama/dava/5`)).text(), /timay-web/);
    assert.equal((await fetch(`${base}/api/health`)).status, 200);
  });
});
