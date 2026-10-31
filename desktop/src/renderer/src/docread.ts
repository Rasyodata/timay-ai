import { api } from './api';

/*
 * Belge okuma: Word (.docx), UYAP (.udf), PDF, TIF ve resimler (JPG, PNG, BMP).
 * Taranmış PDF, TIF ve resimlerdeki yazı bu bilgisayarda Türkçe OCR ile okunur.
 */

export const DOC_ACCEPT = '.udf,.pdf,.docx,.xlsx,.html,.htm,.xml,.tif,.tiff,.jpg,.jpeg,.png,.bmp,.gif,.webp,.txt';
export const DOC_FORMATS = 'UYAP (.udf), PDF, Word, TIF, JPG, PNG, BMP';

const IMAGE = /\.(jpe?g|png|bmp|gif|webp)$/i;
const TIFF = /\.tiff?$/i;

export type Progress = (message: string) => void;

/** Okuma ilerlemesi bu olayla da duyurulur (yükleme düğmeleri gösterir). */
export const READ_PROGRESS = 'timay-read-progress';

export interface ReadResult {
  fileName: string;
  /** Yalnızca .docx için: değişiklikleri izle bilgisi sunucuda okunur. */
  fileBase64?: string;
  text?: string;
  /** Metin resimden okunduysa (OCR) true. */
  ocr?: boolean;
}

export function toBase64(buf: ArrayBuffer) {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export function mimeOf(name: string) {
  const ext = name.toLowerCase().split('.').pop() ?? '';
  const map: Record<string, string> = {
    pdf: 'application/pdf',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    udf: 'application/x-udf',
    tif: 'image/tiff',
    tiff: 'image/tiff',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    bmp: 'image/bmp',
    gif: 'image/gif',
    webp: 'image/webp',
    txt: 'text/plain',
  };
  return map[ext] ?? 'application/octet-stream';
}

function clean(text: string) {
  return text
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function loadPdf(buf: ArrayBuffer) {
  const pdfjs = await import('pdfjs-dist');
  const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  return pdfjs.getDocument({ data: new Uint8Array(buf) }).promise;
}

async function pdfText(buf: ArrayBuffer) {
  const doc = await loadPdf(buf.slice(0));
  const pages: string[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const content = await (await doc.getPage(p)).getTextContent();
    pages.push(content.items.map((it) => ('str' in it ? it.str + (it.hasEOL ? '\n' : '') : '')).join(''));
  }
  return clean(pages.join('\n'));
}

/** Taranmış PDF sayfalarını resme çevirir (en fazla 40 sayfa). */
async function pdfPages(buf: ArrayBuffer, progress?: Progress) {
  const doc = await loadPdf(buf.slice(0));
  const canvases: HTMLCanvasElement[] = [];
  const count = Math.min(doc.numPages, 40);
  for (let p = 1; p <= count; p++) {
    progress?.(`PDF sayfası hazırlanıyor (${p}/${count})`);
    const page = await doc.getPage(p);
    const viewport = page.getViewport({ scale: 2 });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    await page.render({ canvasContext: canvas.getContext('2d')!, viewport }).promise;
    canvases.push(canvas);
  }
  return canvases;
}

async function tiffPages(buf: ArrayBuffer) {
  const UTIF = (await import('utif')).default;
  const ifds = UTIF.decode(buf);
  const canvases: HTMLCanvasElement[] = [];
  for (const ifd of ifds.slice(0, 40)) {
    UTIF.decodeImage(buf, ifd);
    const rgba = UTIF.toRGBA8(ifd);
    const canvas = document.createElement('canvas');
    canvas.width = ifd.width;
    canvas.height = ifd.height;
    const ctx = canvas.getContext('2d')!;
    const img = ctx.createImageData(ifd.width, ifd.height);
    img.data.set(rgba);
    ctx.putImageData(img, 0, 0);
    canvases.push(canvas);
  }
  if (!canvases.length) throw new Error('TIF dosyasında sayfa bulunamadı.');
  return canvases;
}

async function imageCanvas(file: Blob) {
  const bmp = await createImageBitmap(file);
  const canvas = document.createElement('canvas');
  canvas.width = bmp.width;
  canvas.height = bmp.height;
  canvas.getContext('2d')!.drawImage(bmp, 0, 0);
  bmp.close();
  return canvas;
}

type OcrWorker = Awaited<ReturnType<typeof import('tesseract.js').createWorker>>;
let workerPromise: Promise<OcrWorker> | null = null;
let currentProgress: Progress | undefined;

function ocrWorker() {
  if (!workerPromise) {
    const base = new URL('./ocr/', document.baseURI).href;
    workerPromise = import('tesseract.js').then(({ createWorker, OEM }) =>
      createWorker('tur', OEM.LSTM_ONLY, {
        workerPath: `${base}worker.min.js`,
        corePath: base,
        langPath: base.replace(/\/$/, ''),
        workerBlobURL: false,
        gzip: true,
        logger: (m: { status: string; progress: number }) => {
          if (m.status === 'recognizing text') currentProgress?.(`Yazı okunuyor %${Math.round(m.progress * 100)}`);
        },
      }),
    );
    workerPromise.catch(() => {
      workerPromise = null;
    });
  }
  return workerPromise;
}

/** Sayfa resimlerindeki yazıyı Türkçe olarak okur. */
export async function ocr(pages: HTMLCanvasElement[], progress?: Progress) {
  progress?.('Yazı tanıma hazırlanıyor…');
  const worker = await ocrWorker();
  const texts: string[] = [];
  for (let i = 0; i < pages.length; i++) {
    currentProgress = (m) => progress?.(pages.length > 1 ? `Sayfa ${i + 1}/${pages.length} · ${m}` : m);
    const { data } = await worker.recognize(pages[i]);
    texts.push(data.text);
  }
  currentProgress = undefined;
  return clean(texts.join('\n\n'));
}

/** Herhangi bir desteklenen belgeyi okur. Word için dosyanın kendisi döner (sunucu okur). */
export async function readDocument(file: File, onProgress?: Progress, options: { keepDocx?: boolean } = {}): Promise<ReadResult> {
  const progress: Progress = (m) => {
    onProgress?.(m);
    window.dispatchEvent(new CustomEvent(READ_PROGRESS, { detail: m }));
  };
  const name = file.name.toLowerCase();
  const buf = await file.arrayBuffer();
  if (name.endsWith('.docx')) {
    if (options.keepDocx) return { fileName: file.name, fileBase64: toBase64(buf) };
    const r = await api<{ text: string }>('/documents/extract', { body: { fileName: file.name, fileBase64: toBase64(buf) } });
    return { fileName: file.name, text: r.text };
  }
  if (/\.(xlsx|html?|xml)$/.test(name)) {
    progress?.('Belge okunuyor…');
    const r = await api<{ text: string }>('/documents/extract', { body: { fileName: file.name, fileBase64: toBase64(buf) } });
    return { fileName: file.name, text: r.text };
  }
  if (name.endsWith('.udf')) {
    progress?.('UYAP belgesi okunuyor…');
    const r = await api<{ text: string }>('/documents/extract', { body: { fileName: file.name, fileBase64: toBase64(buf) } });
    return { fileName: file.name, text: r.text };
  }
  if (name.endsWith('.pdf')) {
    progress?.('PDF okunuyor…');
    const text = await pdfText(buf);
    if (text.replace(/\s/g, '').length > 40) return { fileName: file.name, text };
    // Metni olmayan (taranmış) PDF: sayfaları resim olarak okuyalım.
    return { fileName: file.name, text: await ocr(await pdfPages(buf, progress), progress), ocr: true };
  }
  if (TIFF.test(name)) {
    progress?.('TIF okunuyor…');
    return { fileName: file.name, text: await ocr(await tiffPages(buf), progress), ocr: true };
  }
  if (IMAGE.test(name)) {
    progress?.('Resim hazırlanıyor…');
    return { fileName: file.name, text: await ocr([await imageCanvas(file)], progress), ocr: true };
  }
  if (name.endsWith('.txt')) return { fileName: file.name, text: clean(new TextDecoder().decode(buf)) };
  if (name.endsWith('.doc')) throw new Error('Eski .doc biçimi okunamıyor; Word’de “Farklı kaydet → .docx” ile kaydedip yükleyin.');
  throw new Error(`Bu dosya türü desteklenmiyor. Desteklenenler: ${DOC_FORMATS}.`);
}

/** Belgeden yalnızca metni çıkarır. */
export async function documentText(file: File, progress?: Progress) {
  const r = await readDocument(file, progress);
  return r.text ?? '';
}
