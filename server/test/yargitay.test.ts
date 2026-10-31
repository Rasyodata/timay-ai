import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import * as auth from '../src/auth.ts';
import { openDb, type DB } from '../src/db.ts';
import { searchArchive } from '../src/decisions.ts';
import { ApiError } from '../src/errors.ts';
import * as yargitay from '../src/yargitay.ts';

const status = (code: number) => (e: unknown) => e instanceof ApiError && e.status === code;

const HTML =
  '<html><body><font face="Arial">12. Hukuk Dairesi&nbsp; 2006/10799 E.&nbsp;, 2006/13163 K.</font><br>' +
  '<p>"İçtihat Metni"</p><p>MAHKEMESİ : İcra Hukuk Mahkemesi</p>\r\n<p>Haklı fesih ve kıdem tazminatı &amp; ihbar</p>' +
  '<p>05.07.2006 tarihinde oybirliğiyle karar verildi.</p></body></html>';

function mockFetch(calls: { url: string; body: any }[]): yargitay.Fetch {
  return async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ url, body });
    if (url.endsWith('/searchDocuments')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          data: {
            total: 1370000,
            emsalKararList: [
              { documentId: '1001', birimAdi: '12. Hukuk Dairesi', esasNo: '2006/10799', kararNo: '2006/13163', kararTarihiStr: '05.07.2006' },
              { documentId: '1002', birimAdi: '9. Hukuk Dairesi', esasNo: '2020/1', kararNo: '2021/2', kararTarihiStr: '01.01.6006' },
            ],
          },
          metadata: { FMTY: 'SUCCESS' },
        }),
      };
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({ data: { content: Buffer.from(HTML, 'utf8').toString('base64'), mimeType: 'text/html' } }),
    };
  };
}

describe('Yargıtay çevrimiçi arama ve arşive aktarma', () => {
  let db: DB;
  let lawyer: auth.User;

  beforeEach(() => {
    db = openDb();
    lawyer = auth.registerOffice(db, { officeName: 'A', name: 'Av. Bir', email: 'a@t.local', password: 'sifre1234' }).user;
  });

  it('arar, tarihleri doğrular ve doğru isteği gönderir', async () => {
    const calls: { url: string; body: any }[] = [];
    const r = await yargitay.search(db, mockFetch(calls), { q: 'haklı fesih', chamber: '12. Hukuk Dairesi', page: '2' });
    assert.equal(r.total, 1370000);
    assert.equal(r.items[0].date, '2006-07-05');
    assert.equal(r.items[1].date, '');
    assert.equal(r.items[0].archiveId, null);
    assert.equal(calls[0].body.data.phrase, 'haklı fesih');
    assert.equal(calls[0].body.data.pageNumber, 2);
    assert.equal(calls[0].body.data.birimAdi, '12. Hukuk Dairesi');
    assert.deepEqual(calls[0].body.data.itemTypeList, ['YARGITAYKARARI']);
  });

  it('kararı tam metniyle arşive ekler ve sonraki aramada işaretler', async () => {
    const f = mockFetch([]);
    const saved = (await yargitay.importDecision(db, f, lawyer, { documentId: '1001' })) as Record<string, string>;
    assert.equal(saved.chamber, '12. Hukuk Dairesi');
    assert.equal(saved.esas_no, '2006/10799');
    assert.equal(saved.karar_no, '2006/13163');
    assert.equal(saved.decision_date, '2006-07-05');
    assert.match(saved.text, /Haklı fesih ve kıdem tazminatı & ihbar/);
    assert.doesNotMatch(saved.text, /<|&nbsp;| |\r/);
    assert.equal(saved.source_url, 'https://mevzuat.adalet.gov.tr/ictihat/1001');
    assert.equal(searchArchive(db, { q: 'kıdem' }).total, 1);
    const again = await yargitay.search(db, f, { q: 'fesih' });
    assert.equal(again.items[0].archiveId, Number(saved.id));
  });

  it('stajyer ekleyemez; bozuk istek ve ulaşılamayan servis anlaşılır hata verir', async () => {
    const { token } = auth.createInvite(db, lawyer, { email: 's@t.local', role: 'stajyer' });
    const intern = auth.acceptInvite(db, { token, name: 'Stajyer', password: 'sifre1234' }).user;
    await assert.rejects(yargitay.importDecision(db, mockFetch([]), intern, { documentId: '1001' }), status(403));
    await assert.rejects(yargitay.search(db, mockFetch([]), { q: 'a' }), status(400));
    await assert.rejects(yargitay.importDecision(db, mockFetch([]), lawyer, { documentId: '../x' }), status(400));
    const down: yargitay.Fetch = async () => {
      throw new Error('ECONNREFUSED');
    };
    await assert.rejects(yargitay.search(db, down, { q: 'fesih' }), status(502));
  });

  it('masaüstünden gelen ham yanıtı ve metni indirmeden işler', async () => {
    const calls: { url: string; body: any }[] = [];
    const f = mockFetch(calls);
    const list = yargitay.mapSearch(db, {
      total: 2,
      emsalKararList: [{ documentId: '1001', birimAdi: '12. Hukuk Dairesi', esasNo: '2006/10799', kararNo: '2006/13163', kararTarihiStr: '05.07.2006' }],
    });
    assert.equal(list.items[0].date, '2006-07-05');
    assert.equal(yargitay.mapSearch(db, {}).items.length, 0);
    const saved = (await yargitay.importDecision(db, f, lawyer, {
      documentId: '1001',
      content: Buffer.from(HTML, 'utf8').toString('base64'),
      mimeType: 'text/html',
    })) as Record<string, string>;
    assert.equal(saved.esas_no, '2006/10799');
    assert.equal(calls.length, 0);
  });

  it('tam ifade, hariç kelime ve yıl aralığıyla arama gövdesi kurar', () => {
    const body = yargitay.searchBody({ q: 'kat karşılığı', exact: '1', exclude: 'kira, -tahliye', yearFrom: '2020', yearTo: 2024 });
    assert.equal(body.phrase, '"kat karşılığı" -kira -tahliye');
    assert.equal(body.kararTarihiStart, '2020-01-01T00:00:00.000Z');
    assert.equal(body.kararTarihiEnd, '2024-12-31T23:59:59.999Z');
    assert.equal(yargitay.searchBody({ q: 'kat karşılığı', yearFrom: '2020' }, false).kararTarihiStart, undefined);
    const items = [{ date: '2019-05-01' }, { date: '2021-03-02' }, { date: '' }];
    assert.deepEqual(yargitay.filterYears(items, { yearFrom: 2020 }).length, 2);
  });

  it('HTML karar metnini düz metne çevirir', () => {
    assert.equal(yargitay.htmlToText('<p>a&nbsp;b</p><p>c&#252;</p>'), 'a b\ncü');
  });
});
