import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import * as auth from '../src/auth.ts';
import * as casedocs from '../src/casedocs.ts';
import * as cases from '../src/cases.ts';
import { caseSummary } from '../src/casesummary.ts';
import * as contracts from '../src/contracts.ts';
import { openDb, type DB } from '../src/db.ts';
import { buildUdf, writeZip } from '../src/docx.ts';
import { ApiError } from '../src/errors.ts';
import { extractText, readXlsx, unpack } from '../src/files.ts';
import * as notes from '../src/notes.ts';
import * as petitions from '../src/petitions.ts';
import * as safahat from '../src/safahat.ts';
import { searchAll } from '../src/search.ts';

const XLSX = () =>
  writeZip([
    ['xl/workbook.xml', '<workbook><sheets><sheet name="Hesap" sheetId="1"/></sheets></workbook>'],
    ['xl/sharedStrings.xml', '<sst><si><t>Kalem</t></si><si><t>Tutar</t></si><si><t>Kıdem tazminatı</t></si></sst>'],
    ['xl/worksheets/sheet1.xml', '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row><row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2"><v>120000</v></c></row></sheetData></worksheet>'],
  ]);

describe('toplu yükleme, akıllı notlar, arama, dava özeti', () => {
  let db: DB;
  let a: auth.User;
  let b: auth.User;

  beforeEach(() => {
    db = openDb();
    a = auth.registerOffice(db, { officeName: 'A', name: 'Av. Bir', email: 'a@t.local', password: 'sifre1234' }).user;
    b = auth.registerOffice(db, { officeName: 'B', name: 'Av. İki', email: 'b@t.local', password: 'sifre1234' }).user;
  });

  it('Excel, HTML okur; ZIP/EYP paketini (iç içe) açar, üst veriyi atlar', () => {
    assert.equal(readXlsx(XLSX()), '[Hesap]\nKalem\tTutar\nKıdem tazminatı\t120000');
    assert.equal(extractText('karar.html', Buffer.from('<p>Kıdem <b>tazminatı</b></p><p>kabul</p>'))?.text, 'Kıdem tazminatı\nkabul');
    assert.equal(extractText('tarama.pdf', Buffer.from('x')), null);
    const inner = writeZip([['ek1.udf', buildUdf('Ek belge')]]);
    const eyp = writeZip([
      ['Ustveri.xml', '<x/>'],
      ['Belge/dilekce.udf', buildUdf('Dava dilekçesi')],
      ['Ekler/hesap.xlsx', XLSX()],
      ['Ekler/ekler.zip', inner],
      ['Ekler/program.exe', 'MZ'],
    ]);
    const r = unpack('paket.eyp', eyp);
    assert.deepEqual(r.files.map((f) => f.name).sort(), ['dilekce.udf', 'ek1.udf', 'hesap.xlsx']);
    assert.deepEqual(r.skipped, ['Ekler/program.exe']);
    assert.throws(() => unpack('bozuk.zip', Buffer.from('xx')), ApiError);
  });

  it('akıllı not etiketleri, tarih ve tutarları tanır; yetkisiz göremez', () => {
    const c = cases.createCase(db, a, { title: 'Veli / Deniz' }) as { id: number };
    const n = notes.createNote(db, a, { caseId: c.id, body: 'Tanık Ahmet 12.11.2026 duruşmasına gelecek #tanık #önemli. Bakiye 45.000 TL, TBK 117 temerrüt.', pinned: true });
    assert.deepEqual(n.tags, ['tanık', 'önemli']);
    assert.deepEqual(n.insights.dates, ['2026-11-12']);
    assert.deepEqual(n.insights.amounts, ['45.000 TL']);
    assert.deepEqual(n.insights.articles, ['TBK m.117']);
    assert.equal(notes.listNotes(db, a, { tag: 'tanık' }).length, 1);
    assert.equal(notes.listNotes(db, a, { caseId: String(c.id) }).length, 1);
    assert.throws(() => notes.listNotes(db, b, { caseId: String(c.id) }), ApiError);
    assert.equal(notes.listNotes(db, b).length, 0);
    const u = notes.updateNote(db, a, n.id, { pinned: false });
    assert.equal(u.pinned, false);
  });

  it('tam metin arama dosya, belge, dilekçe, sözleşme ve notlarda arar', () => {
    const c = cases.createCase(db, a, { title: 'Veli / Deniz İnşaat', facts: 'Fazla mesai alacağı' }) as { id: number };
    casedocs.addCaseDocument(db, a, c.id, { fileName: 'bordro.pdf', fileBase64: Buffer.from('x').toString('base64'), text: 'Bordroda fazla mesai ödenmemiş görünüyor.' });
    petitions.createPetition(db, a, { caseId: c.id, title: 'Dava dilekçesi', body: 'Fazla mesai ücretinin tahsili talebidir.' });
    contracts.createContract(db, a, { title: 'İş sözleşmesi', kind: 'is', body: 'Fazla mesai ücreti ayrıca ödenir.' });
    notes.createNote(db, a, { body: 'Fazla mesai tanıkları bulunacak' });
    const r = searchAll(db, a, { q: 'fazla mesai' });
    assert.deepEqual(Object.keys(r.counts).sort(), ['case', 'contract', 'document', 'note', 'petition']);
    assert.equal(searchAll(db, b, { q: 'fazla mesai' }).total, 0);
    assert.equal(searchAll(db, a, { q: 'fazla mesai', type: 'note' }).total, 1);
  });

  it('dava özeti, strateji ve durum raporu üretir', () => {
    const c = cases.createCase(db, a, { title: 'Veli / Deniz', area: 'is', court: 'İstanbul 5. İş Mahkemesi', client: 'Ali Veli', facts: 'Müvekkil 3 yıl çalıştı, kıdem tazminatı ödenmedi.' }) as { id: number };
    safahat.addStage(db, a, c.id, { stage: 'teblig_dava', date: new Date().toISOString().slice(0, 10), steps: [] });
    notes.createNote(db, a, { caseId: c.id, body: 'Müvekkil sulha açık', pinned: true });
    const s = caseSummary(db, a, c.id);
    assert.equal(s.stage?.stage, 'teblig_dava');
    assert.equal(s.deadlines.length, 1);
    assert.ok(s.strategy.some((x) => x.level === 'acil' || x.level === 'onemli'));
    assert.match(s.report, /DOSYA DURUM RAPORU/);
    assert.match(s.report, /Cevap dilekçesi/);
    assert.deepEqual(s.notes, ['Müvekkil sulha açık']);
    assert.throws(() => caseSummary(db, b, c.id), ApiError);
  });
});
