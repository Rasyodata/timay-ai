import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createApp } from '../src/app.ts';
import * as auth from '../src/auth.ts';
import * as cases from '../src/cases.ts';
import { openDb, type DB } from '../src/db.ts';
import { upsertDecision } from '../src/decisions.ts';
import { ApiError } from '../src/errors.ts';
import * as mcp from '../src/mcp.ts';

describe('Claude bağlantısı (MCP)', () => {
  let db: DB;
  let base = '';
  let close: () => void;
  let lawyer: auth.User;
  let other: auth.User;

  before(async () => {
    db = openDb();
    lawyer = auth.registerOffice(db, { officeName: 'A', name: 'Av. Bir', email: 'a@t.local', password: 'sifre1234' }).user;
    other = auth.registerOffice(db, { officeName: 'B', name: 'Av. İki', email: 'b@t.local', password: 'sifre1234' }).user;
    upsertDecision(db, { court: 'Yargıtay', chamber: '9. Hukuk Dairesi', esasNo: '2022/10', kararNo: '2022/20', text: 'İşe iade davasında geçerli neden ispatı işverene aittir. İş K. m.20.' });
    db.prepare("UPDATE cases SET facts = '' WHERE 0").run();
    const c = cases.createCase(db, lawyer, { title: 'Yılmaz işe iade' });
    db.prepare("UPDATE cases SET facts = 'Müvekkil işten çıkarıldı.' WHERE id = ?").run(c.id);
    cases.createCase(db, other, { title: 'Başka büronun dosyası' });
    const fetchFail = (async () => {
      throw new Error('ağ yok');
    }) as never;
    const server = createApp(db, { fetch: fetchFail }).listen(0);
    await new Promise((r) => server.once('listening', r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    close = () => server.close();
  });
  after(() => close());

  async function connect(token: string) {
    const client = new Client({ name: 'test', version: '1.0.0' });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp/${token}`)));
    return client;
  }
  const textOf = (r: unknown) => ((r as { content: { text: string }[] }).content[0].text);

  it('anahtarla bağlanır, arşivde arar ve kararı okur; dosyalar izinsiz kapalıdır', async () => {
    const key = mcp.createKey(db, lawyer, { label: 'Claude' });
    assert.match(key.token, /^tmy_[0-9a-f]{48}$/);
    const client = await connect(key.token);
    const tools = (await client.listTools()).tools.map((t) => t.name);
    assert.ok(tools.includes('arsivde_karar_ara'));
    assert.ok(!tools.includes('dava_dosyasi'));
    const found = JSON.parse(textOf(await client.callTool({ name: 'arsivde_karar_ara', arguments: { sorgu: 'işe iade geçerli neden' } })));
    assert.equal(found.kararlar.length, 1);
    const full = textOf(await client.callTool({ name: 'karar_metni', arguments: { id: found.kararlar[0].id } }));
    assert.match(full, /ispatı işverene aittir/);
    const online = await client.callTool({ name: 'yargitayda_ara', arguments: { sorgu: 'işe iade' } });
    assert.equal(online.isError, true);
    const atif = JSON.parse(textOf(await client.callTool({ name: 'atif_kontrol', arguments: { metin: 'Yargıtay 9. HD 2022/10 E., 2022/20 K. sayılı kararı' } })));
    assert.ok(Array.isArray(atif));
    await client.close();
  });

  it('dosya izni olan anahtar yalnız kendi bürosunun dosyalarını görür', async () => {
    const key = mcp.createKey(db, lawyer, { allowCases: true });
    const client = await connect(key.token);
    const list = JSON.parse(textOf(await client.callTool({ name: 'dava_dosyalari', arguments: {} })));
    assert.deepEqual(list.map((c: { baslik: string }) => c.baslik), ['Yılmaz işe iade']);
    const ctx = textOf(await client.callTool({ name: 'dava_dosyasi', arguments: { id: list[0].id } }));
    assert.match(ctx, /işten çıkarıldı/);
    const foreignId = (db.prepare("SELECT id FROM cases WHERE title = 'Başka büronun dosyası'").get() as { id: number }).id;
    const denied = await client.callTool({ name: 'dava_dosyasi', arguments: { id: foreignId } });
    assert.equal(denied.isError, true);
    await client.close();
  });

  it('iptal edilen ya da uydurma anahtar reddedilir; başkasının anahtarını yalnız yönetici iptal eder', async () => {
    const key = mcp.createKey(db, lawyer, {});
    assert.equal(mcp.listKeys(db, lawyer).some((k) => k.id === key.id), true);
    assert.equal(mcp.listKeys(db, other).length, 0);
    assert.throws(() => mcp.revokeKey(db, other, key.id), (e) => e instanceof ApiError && e.status === 404);
    mcp.revokeKey(db, lawyer, key.id);
    await assert.rejects(connect(key.token));
    await assert.rejects(connect('tmy_uydurma'));
    const res = await fetch(`${base}/mcp/${key.token}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    assert.equal(res.status, 401);
  });
});
