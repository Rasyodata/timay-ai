import { deflateRawSync, inflateRawSync } from 'node:zlib';
import { ApiError } from './errors.ts';
import type { DiffPart } from './diff.ts';

// ---------------------------------------------------------------------------
// Asgari ZIP okuma / yazma (Word .docx dosyaları ZIP arşividir)
// ---------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Buffer) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function readZip(buf: Buffer): Map<string, Buffer> {
  const files = new Map<string, Buffer>();
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 66_000); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new ApiError(400, 'Dosya bir Word (.docx) belgesi değil.');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let k = 0; k < count; k++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString('utf8');
    const dataStart = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const data = buf.subarray(dataStart, dataStart + compSize);
    if (method === 0) files.set(name, Buffer.from(data));
    else if (method === 8) files.set(name, inflateRawSync(data));
    p += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

export function writeZip(entries: [string, string | Buffer][]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of entries) {
    const raw = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
    const comp = deflateRawSync(raw);
    const nameBuf = Buffer.from(name, 'utf8');
    const crc = crc32(raw);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(comp.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(comp.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBuf, comp);
    centrals.push(central, nameBuf);
    offset += 30 + nameBuf.length + comp.length;
  }
  const centralBuf = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralBuf, end]);
}

// ---------------------------------------------------------------------------
// Word belgesini okuma
// ---------------------------------------------------------------------------

const unescapeXml = (s: string) =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_m, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, '&');

export interface DocxText {
  /** Karşı tarafın gönderdiği haliyle, izlenen değişiklikler kabul edilmiş metin. */
  accepted: string;
  /** İzlenen değişiklikler reddedilmiş metin: karşı tarafın "beyan ettiği" değişiklikler geri alınmış hali. */
  rejected: string;
  /** Word'de "değişiklikleri izle" ile işaretlenmiş değişiklik sayısı. */
  trackedChanges: number;
  /** Değişikliği yapan kişi adları (w:author). */
  authors: string[];
}

export function readDocx(buf: Buffer): DocxText {
  const files = readZip(buf);
  const xml = files.get('word/document.xml')?.toString('utf8');
  if (!xml) throw new ApiError(400, 'Word belgesinin metni okunamadı.');
  const body = xml.replace(/^[\s\S]*?<w:body[^>]*>/, '').replace(/<w:sectPr[\s\S]*$/, '');
  const accepted: string[] = [];
  const rejected: string[] = [];
  const authors = new Set<string>();
  let trackedChanges = 0;
  for (const para of body.match(/<w:p[ >][\s\S]*?<\/w:p>|<w:p\/>/g) ?? []) {
    let acc = '';
    let rej = '';
    let mode: 'normal' | 'ins' | 'del' = 'normal';
    const re = /<(\/?)w:(ins|del|t|delText|tab|br|cr|moveFrom|moveTo)\b([^>]*?)(\/?)>([^<]*)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(para))) {
      const [, close, tag, attrs, selfClose, text] = m;
      if (tag === 'ins' || tag === 'moveTo') {
        if (close) mode = 'normal';
        else if (!selfClose) {
          mode = 'ins';
          trackedChanges++;
          const a = /w:author="([^"]*)"/.exec(attrs);
          if (a) authors.add(unescapeXml(a[1]));
        }
      } else if (tag === 'del' || tag === 'moveFrom') {
        if (close) mode = 'normal';
        else if (!selfClose) {
          mode = 'del';
          trackedChanges++;
          const a = /w:author="([^"]*)"/.exec(attrs);
          if (a) authors.add(unescapeXml(a[1]));
        }
      } else if (!close) {
        const t = tag === 't' || tag === 'delText' ? unescapeXml(text) : tag === 'tab' ? '\t' : '\n';
        if (mode !== 'del') acc += t;
        if (mode !== 'ins') rej += t;
      }
    }
    accepted.push(acc);
    rejected.push(rej);
  }
  const join = (lines: string[]) => lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return { accepted: join(accepted), rejected: join(rejected), trackedChanges, authors: [...authors] };
}

// ---------------------------------------------------------------------------
// Word belgesi üretme ("değişiklikleri izle" işaretli)
// ---------------------------------------------------------------------------

const escapeXml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/></Types>`;
const RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`;
const DOC_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/></Relationships>`;
const SETTINGS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:trackRevisions/></w:settings>`;

/**
 * Fark parçalarından Word belgesi üretir. Eklenen ve silinen kısımlar Word'de
 * "Değişiklikleri İzle" (redline) olarak görünür; belge izleme açık olarak açılır.
 */
export function buildDocx(parts: DiffPart[], author: string): Buffer {
  const date = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  const who = escapeXml(author || 'Timay');
  let id = 1;
  const RUN = '<w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:sz w:val="22"/></w:rPr>';
  const paragraphs: string[] = [];
  let current = '';
  for (const part of parts) {
    const lines = part.text.split('\n');
    lines.forEach((line, idx) => {
      if (idx > 0) {
        paragraphs.push(current);
        current = '';
      }
      if (!line) return;
      const t = escapeXml(line);
      if (part.op === 'eq') current += `<w:r>${RUN}<w:t xml:space="preserve">${t}</w:t></w:r>`;
      else if (part.op === 'ins')
        current += `<w:ins w:id="${id++}" w:author="${who}" w:date="${date}"><w:r>${RUN}<w:t xml:space="preserve">${t}</w:t></w:r></w:ins>`;
      else
        current += `<w:del w:id="${id++}" w:author="${who}" w:date="${date}"><w:r>${RUN}<w:delText xml:space="preserve">${t}</w:delText></w:r></w:del>`;
    });
  }
  paragraphs.push(current);
  const doc = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraphs
    .map((p) => `<w:p><w:pPr><w:spacing w:after="120"/></w:pPr>${p}</w:p>`)
    .join('')}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1417" w:right="1417" w:bottom="1417" w:left="1417" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>`;
  return writeZip([
    ['[Content_Types].xml', CONTENT_TYPES],
    ['_rels/.rels', RELS],
    ['word/_rels/document.xml.rels', DOC_RELS],
    ['word/settings.xml', SETTINGS],
    ['word/document.xml', doc],
  ]);
}

/**
 * UYAP Doküman Editörü (.udf) dosyasının metnini çıkarır. UDF bir ZIP arşividir;
 * metnin tamamı content.xml içindeki <content> öğesinde CDATA olarak durur.
 */
export function readUdf(buf: Buffer): string {
  let files: Map<string, Buffer>;
  try {
    files = readZip(buf);
  } catch {
    throw new ApiError(400, 'Dosya bir UYAP (.udf) belgesi değil.');
  }
  const xml = files.get('content.xml')?.toString('utf8');
  if (!xml) throw new ApiError(400, 'UYAP belgesinde içerik bulunamadı.');
  const m = xml.match(/<content>\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*<\/content>/) ?? xml.match(/<content>([\s\S]*?)<\/content>/);
  if (!m) throw new ApiError(400, 'UYAP belgesinde metin bulunamadı.');
  return m[1]
    .replace(/￼/g, '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
