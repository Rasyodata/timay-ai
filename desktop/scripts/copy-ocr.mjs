// Resimden yazı okuma (OCR) dosyalarını uygulamanın içine kopyalar; böylece
// tanıma internetten bir şey indirmeden bilgisayarda yapılır.
import { copyFileSync, mkdirSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const out = join(dirname(fileURLToPath(import.meta.url)), '../src/renderer/public/ocr');
mkdirSync(out, { recursive: true });

const tesseract = dirname(require.resolve('tesseract.js/package.json'));
copyFileSync(join(tesseract, 'dist/worker.min.js'), join(out, 'worker.min.js'));

const core = dirname(require.resolve('tesseract.js-core/package.json'));
for (const f of readdirSync(core)) if (/-lstm\.wasm\.js$/.test(f)) copyFileSync(join(core, f), join(out, f));

const tur = dirname(require.resolve('@tesseract.js-data/tur/package.json'));
copyFileSync(join(tur, '4.0.0_best_int/tur.traineddata.gz'), join(out, 'tur.traineddata.gz'));
console.log('OCR dosyaları kopyalandı:', out);
