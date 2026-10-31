import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import * as auth from '../src/auth.ts';
import * as casedocs from '../src/casedocs.ts';
import * as cases from '../src/cases.ts';
import { openDb, type DB } from '../src/db.ts';
import { readUdf, writeZip } from '../src/docx.ts';
import { ApiError } from '../src/errors.ts';

const status = (code: number) => (err: unknown) => err instanceof ApiError && err.status === code;

describe('dava belgeleri', () => {
  let db: DB;
  let lawyer: auth.User;
  let stranger: auth.User;
  let caseId: number;

  beforeEach(() => {
    db = openDb();
    lawyer = auth.registerOffice(db, { officeName: 'A', name: 'Av. Bir', email: 'a@t.local', password: 'sifre1234' }).user;
    stranger = auth.registerOffice(db, { officeName: 'B', name: 'Yabancı', email: 'c@t.local', password: 'sifre1234' }).user;
    caseId = cases.createCase(db, lawyer, { title: 'Dosya', area: 'is' }).id;
  });

  it('UYAP .udf belgesinin metnini okur', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?><template format_id="1.8"><content><![CDATA[İSTANBUL 3. İŞ MAHKEMESİ'NE\r\n\r\nDAVACI : Ali Veli￼\r\n]]></content><elements resolver="hvl-default"></elements></template>`;
    const udf = writeZip([['content.xml', xml]]);
    assert.equal(readUdf(udf), "İSTANBUL 3. İŞ MAHKEMESİ'NE\n\nDAVACI : Ali Veli");
    assert.throws(() => readUdf(Buffer.from('düz metin')), status(400));
  });

  it('belge eklenir, listelenir, asıl dosyasıyla açılır ve silinir; başka büro göremez', () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
    const doc = casedocs.addCaseDocument(db, lawyer, caseId, {
      fileName: 'sozlesme.jpg',
      mimeType: 'image/jpeg',
      fileBase64: png.toString('base64'),
      text: 'KAT KARŞILIĞI İNŞAAT SÖZLEŞMESİ',
      ocr: true,
      kind: 'sozlesme',
    }) as { id: number; title: string; ocr: number };
    assert.equal(doc.title, 'sozlesme');
    assert.equal(doc.ocr, 1);
    const list = casedocs.listCaseDocuments(db, lawyer, caseId) as { text_length: number }[];
    assert.equal(list.length, 1);
    assert.equal(list[0].text_length, 31);
    const full = casedocs.getCaseDocument(db, lawyer, doc.id, true) as { fileBase64: string; text: string };
    assert.equal(Buffer.from(full.fileBase64, 'base64').toString('hex'), png.toString('hex'));
    assert.throws(() => casedocs.getCaseDocument(db, stranger, doc.id), status(404));
    assert.throws(() => casedocs.addCaseDocument(db, stranger, caseId, { fileName: 'x.pdf', fileBase64: 'AA==' }), status(404));
    assert.equal((casedocs.updateCaseDocument(db, lawyer, doc.id, { title: 'İmzalı sözleşme' }) as { title: string }).title, 'İmzalı sözleşme');
    casedocs.deleteCaseDocument(db, lawyer, doc.id);
    assert.equal(casedocs.listCaseDocuments(db, lawyer, caseId).length, 0);
  });
});
