import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import * as auth from '../src/auth.ts';
import { openDb, type DB } from '../src/db.ts';
import { writeZip } from '../src/docx.ts';
import * as enforcement from '../src/enforcement.ts';
import { ApiError } from '../src/errors.ts';
import * as icra from '../src/icra.ts';

const b64 = (s: string | Buffer) => Buffer.from(s).toString('base64');

describe('icra: dosya hesabı, sorgular, toplu aktarım', () => {
  let db: DB;
  let a: auth.User;
  let b: auth.User;

  beforeEach(() => {
    db = openDb();
    a = auth.registerOffice(db, { officeName: 'A', name: 'Av. Bir', email: 'a@t.local', password: 'sifre1234' }).user;
    b = auth.registerOffice(db, { officeName: 'B', name: 'Av. İki', email: 'b@t.local', password: 'sifre1234' }).user;
  });

  it('tahsilatı önce masrafa, sonra faize, sonra asıl alacağa mahsup eder', () => {
    const f = enforcement.createFile(db, a, { debtor: 'Borçlu AŞ', principal: '100.000', interestRate: 24, startDate: '2026-01-01' });
    enforcement.addAction(db, a, f.id, { date: '2026-02-01', action: 'masraf', amount: '1.000', note: 'Harç ve tebligat' });
    enforcement.addAction(db, a, f.id, { date: '2026-03-02', action: 'tahsilat', amount: '5.000' });
    const acc = enforcement.fileAccount(db, a, f.id, '2026-03-02');
    const t = acc.lines.find((l) => l.kind === 'tahsilat')!;
    assert.deepEqual(t.applied, { masraf: 100_000, faiz: 203_836 + 190_685, anapara: 5_479 });
    assert.equal(acc.remaining.anapara, 10_000_000 - 5_479);
    assert.equal(acc.remaining.toplam, 10_000_000 - 5_479);
    assert.match(acc.report, /KALAN BORÇ: 99\.945,21 TL/);
    assert.throws(() => enforcement.fileAccount(db, b, f.id), (e: ApiError) => e.status === 404);
  });

  it('yasal faizde oran değişimini dönem dönem uygular; reddiyat ve müvekkile ödemeyi izler', () => {
    const f = enforcement.createFile(db, a, { debtor: 'Veli', principal: '36.500', interestType: 'yasal', startDate: '2024-05-01', fee: '2.000' });
    const acc = enforcement.fileAccount(db, a, f.id, '2024-07-01');
    assert.equal(acc.interest_total_kurus, 27_900 + 72_000);
    assert.equal(acc.remaining.toplam, 3_650_000 + 99_900 + 200_000);
    enforcement.addAction(db, a, f.id, { date: '2024-07-02', action: 'tahsilat', amount: 5000 });
    enforcement.addAction(db, a, f.id, { date: '2024-07-03', action: 'reddiyat', amount: 3000 });
    enforcement.addAction(db, a, f.id, { date: '2024-07-04', action: 'muvekkile_odeme', amount: 1000 });
    const got = enforcement.getFile(db, a, f.id);
    assert.equal(got.at_office_kurus, 200_000);
    assert.equal(got.at_lawyer_kurus, 200_000);
  });

  it('sorgu sonucuna göre haciz önerir, eskimiş sorguyu bildirir', () => {
    const f = enforcement.createFile(db, a, { debtor: 'Veli', principal: 1000 });
    assert.equal(icra.queryOverview(db, a).length, 1);
    let q = icra.addQuery(db, a, f.id, { kind: 'egm', found: true, result: '34 ABC 123 Fiat' });
    assert.match(q.kinds.find((k) => k.key === 'egm')!.suggest, /araç/i);
    enforcement.addAction(db, a, f.id, { date: '2026-10-31', action: 'arac_haczi' });
    q = icra.listQueries(db, a, f.id);
    assert.equal(q.kinds.find((k) => k.key === 'egm')!.suggest, '');
    assert.equal(q.kinds.find((k) => k.key === 'sgk')!.stale, true);
    assert.equal(icra.queryOverview(db, a, new Date().toISOString().slice(0, 10)).length, 0);
    assert.throws(() => icra.addQuery(db, a, f.id, { kind: 'uydurma' }), ApiError);
    assert.throws(() => icra.listQueries(db, b, f.id), (e: ApiError) => e.status === 404);
  });

  it('CSV ile toplu açar ve aynı dosya numarasını günceller', () => {
    const old = enforcement.createFile(db, a, { debtor: 'Eski Borçlu', officeName: 'İstanbul 3. İcra Dairesi', fileNo: '2026/10', principal: 500 });
    const csv = [
      'Borçlu;TC Kimlik No;İcra Dairesi;Dosya No;Asıl Alacak;Faiz Oranı;Takip Tarihi;Takip Türü;Durum',
      'Ali Veli;12345678901;İstanbul 3. İcra Dairesi;2026/11;12.500,50;%24;05.10.2026;Kambiyo senedi;',
      ';;istanbul 3. icra dairesi;2026/10;;;;;Haciz',
      'Hatalı;;;;abc;;;;',
      'Tarihsiz;;;;100;;32/13/2026;;',
    ].join('\n');
    const pre = icra.importFiles(db, a, { fileName: 'liste.csv', base64: b64(csv) });
    assert.deepEqual(pre.summary, { yeni: 1, guncelle: 1, hata: 2 });
    assert.equal(pre.rows[1].match?.id, old.id);
    icra.importFiles(db, a, { fileName: 'liste.csv', base64: b64(csv), commit: true });
    const files = enforcement.listFiles(db, a);
    const ali = files.find((f) => f.debtor === 'Ali Veli')!;
    assert.equal(ali.principal_kurus, 1_250_050);
    assert.equal(ali.kind, 'kambiyo');
    assert.equal(ali.start_date, '2026-10-05');
    assert.equal(ali.debtor_id_no, '12345678901');
    const upd = files.find((f) => f.id === old.id)!;
    assert.equal(upd.status, 'haciz');
    assert.equal(upd.debtor, 'Eski Borçlu');
    assert.equal(enforcement.listFiles(db, b).length, 0);
  });

  it('Excel (.xlsx) okur ve CSV olarak dışa aktarır', () => {
    const xlsx = writeZip([
      ['xl/workbook.xml', '<workbook><sheets><sheet name="Liste" sheetId="1"/></sheets></workbook>'],
      ['xl/sharedStrings.xml', '<sst><si><t>Borçlu</t></si><si><t>Asıl Alacak</t></si><si><t>Ayşe Kaya</t></si></sst>'],
      ['xl/worksheets/sheet1.xml', '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row><row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2"><v>7500</v></c></row></sheetData></worksheet>'],
    ]);
    const r = icra.importFiles(db, a, { fileName: 'liste.xlsx', base64: b64(xlsx), commit: true });
    assert.equal(r.summary.yeni, 1);
    const ex = icra.exportFiles(db, a);
    const text = Buffer.from(ex.base64, 'base64').toString('utf8');
    assert.match(text, /^﻿Borçlu;TC\/VKN;/);
    assert.match(text, /Ayşe Kaya;.*;7500,00;/);
    assert.throws(() => icra.importFiles(db, a, { fileName: 'x.pdf', base64: b64('x') }), ApiError);
  });
});
