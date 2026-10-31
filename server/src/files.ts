import { readDocx, readUdf, readZip } from './docx.ts';
import { ApiError } from './errors.ts';
import { htmlToText } from './yargitay.ts';

/*
 * Toplu belge yükleme: ZIP ve UYAP EYP paketlerini açar; Excel (.xlsx), HTML ve XML'den metin çıkarır.
 * PDF ve resimler masaüstünde okunur (OCR), diğerleri burada.
 */

const MAX_ENTRIES = 80;
const MAX_ENTRY = 15 * 1024 * 1024;
/** Paket içinden alınan belge türleri. */
const ACCEPT = /\.(udf|pdf|docx|xlsx|html?|xml|txt|tiff?|jpe?g|png|bmp|gif|webp)$/i;

function decodeXml(s: string) {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, '&');
}

/** Excel: her sayfa satır satır, hücreler sekmeyle ayrılmış metin. */
export function readXlsx(buf: Buffer): string {
  let files: Map<string, Buffer>;
  try {
    files = readZip(buf);
  } catch {
    throw new ApiError(400, 'Dosya bir Excel (.xlsx) belgesi değil.');
  }
  const shared: string[] = [];
  const sst = files.get('xl/sharedStrings.xml')?.toString('utf8') ?? '';
  for (const si of sst.matchAll(/<si>([\s\S]*?)<\/si>/g)) {
    shared.push(decodeXml([...si[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((m) => m[1]).join('')));
  }
  const workbook = files.get('xl/workbook.xml')?.toString('utf8') ?? '';
  const names = [...workbook.matchAll(/<sheet [^>]*name="([^"]*)"/g)].map((m) => decodeXml(m[1]));
  const sheets = [...files.keys()].filter((k) => /^xl\/worksheets\/sheet\d+\.xml$/.test(k)).sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]));
  const out: string[] = [];
  sheets.forEach((key, i) => {
    const xml = files.get(key)!.toString('utf8');
    const rows: string[] = [];
    for (const row of xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
      const cells: string[] = [];
      for (const c of row[1].matchAll(/<c([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const attrs = c[1];
        const inner = c[2] ?? '';
        const v = inner.match(/<v>([\s\S]*?)<\/v>/)?.[1];
        const inline = inner.match(/<t[^>]*>([\s\S]*?)<\/t>/)?.[1];
        if (/t="s"/.test(attrs) && v !== undefined) cells.push(shared[Number(v)] ?? '');
        else if (inline !== undefined) cells.push(decodeXml(inline));
        else cells.push(v !== undefined ? decodeXml(v) : '');
      }
      if (cells.some((x) => x.trim())) rows.push(cells.join('\t').replace(/\t+$/, ''));
    }
    if (rows.length) out.push(`${names[i] ? `[${names[i]}]\n` : ''}${rows.join('\n')}`);
  });
  return out.join('\n\n').trim();
}

/** Sunucuda okunabilen biçimlerin metni; okunamıyorsa null (PDF ve resimler masaüstünde okunur). */
export function extractText(fileName: string, buf: Buffer): { text: string; trackedChanges: number } | null {
  const name = fileName.toLowerCase();
  if (name.endsWith('.udf')) return { text: readUdf(buf), trackedChanges: 0 };
  if (name.endsWith('.docx')) {
    const d = readDocx(buf);
    return { text: d.accepted, trackedChanges: d.trackedChanges };
  }
  if (name.endsWith('.xlsx')) return { text: readXlsx(buf), trackedChanges: 0 };
  if (/\.html?$/.test(name)) return { text: htmlToText(buf.toString('utf8')), trackedChanges: 0 };
  if (name.endsWith('.xml')) return { text: htmlToText(buf.toString('utf8').replace(/<\?xml[^>]*>/, '')), trackedChanges: 0 };
  if (name.endsWith('.txt')) return { text: buf.toString('utf8').replace(/\r/g, '').trim(), trackedChanges: 0 };
  return null;
}

/**
 * ZIP ya da UYAP EYP paketini açar ve içindeki belgeleri döndürür (iç içe ZIP'ler de açılır).
 * EYP'deki üst veri dosyaları (ustveri, imza, paket bilgisi) atlanır.
 */
export function unpack(fileName: string, buf: Buffer) {
  let files: Map<string, Buffer>;
  try {
    files = readZip(buf);
  } catch {
    throw new ApiError(400, `${fileName} açılamadı; ZIP ya da EYP paketi değil.`);
  }
  const out: { name: string; path: string; size: number; base64: string }[] = [];
  const skipped: string[] = [];
  const walk = (entries: Map<string, Buffer>, prefix: string, depth: number) => {
    for (const [path, data] of entries) {
      if (path.endsWith('/') || !data.length) continue;
      const base = path.split('/').pop()!;
      if (/^(ustveri|imza|paketozeti|nihaiozet|\[content_types\]|\.rels)/i.test(base) || /(^|\/)(_rels|__MACOSX)\//.test(path)) continue;
      if (/\.(zip|eyp)$/i.test(base) && depth < 2) {
        try {
          walk(readZip(data), `${prefix}${base}/`, depth + 1);
        } catch {
          skipped.push(prefix + path);
        }
        continue;
      }
      if (!ACCEPT.test(base) || data.length > MAX_ENTRY) {
        skipped.push(prefix + path);
        continue;
      }
      if (out.length >= MAX_ENTRIES) {
        skipped.push(prefix + path);
        continue;
      }
      out.push({ name: base, path: prefix + path, size: data.length, base64: data.toString('base64') });
    }
  };
  walk(files, '', 0);
  return { files: out, skipped };
}
