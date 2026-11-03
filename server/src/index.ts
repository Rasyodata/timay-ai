import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.ts';
import { startDailyServerBackups } from './backup.ts';
import { createClaudeChecker, createClaudeModel } from './claude.ts';
import { openDb } from './db.ts';
import { seedCeo } from './auth.ts';

const port = Number(process.env.PORT ?? 4000);
const dbFile = process.env.DB_FILE ?? 'timay.db';
const db = openDb(dbFile);
const ceo = seedCeo(db);
if (ceo) console.log(`Yönetim paneli kullanıcısı açıldı: ${ceo.name} <${ceo.email}>`);
const deepChecker = createClaudeChecker();
const ai = createClaudeModel();
// Veritabanının günlük tam kopyası, veritabanıyla aynı diskte "yedek" klasörüne (Render'da /data/yedek).
const backupDir = process.env.BACKUP_DIR ?? join(dirname(dbFile), 'yedek');
startDailyServerBackups(db, backupDir);

// Tarayıcı sürümü derlendiyse /uygulama/ adresinden sunulur.
const webGuess = join(dirname(fileURLToPath(import.meta.url)), '../../desktop/out-web');
const webDir = process.env.WEB_DIR ?? (existsSync(join(webGuess, 'index.html')) ? webGuess : null);

// Masaüstü program güncellemeleri veritabanıyla aynı diskte (Render'da /data/guncelleme).
const updateDir = process.env.UPDATE_DIR ?? join(dirname(dbFile), 'guncelleme');

createApp(db, { deepChecker, ai, backupDir, webDir, updateDir }).listen(port, () => {
  console.log(`Timay sunucusu http://localhost:${port} adresinde çalışıyor`);
  console.log(`Günlük veritabanı yedeği: ${backupDir}`);
  if (webDir) console.log(`Tarayıcı sürümü: http://localhost:${port}/uygulama/`);
  if (!deepChecker) console.log('ANTHROPIC_API_KEY tanımlı değil: derin teyit ve yapay zekâ (Claude) kapalı.');
});
