import { dirname, join } from 'node:path';
import { createApp } from './app.ts';
import { startDailyServerBackups } from './backup.ts';
import { createClaudeChecker, createClaudeModel } from './claude.ts';
import { openDb } from './db.ts';

const port = Number(process.env.PORT ?? 4000);
const dbFile = process.env.DB_FILE ?? 'timay.db';
const db = openDb(dbFile);
const deepChecker = createClaudeChecker();
const ai = createClaudeModel();
// Veritabanının günlük tam kopyası, veritabanıyla aynı diskte "yedek" klasörüne (Render'da /data/yedek).
const backupDir = process.env.BACKUP_DIR ?? join(dirname(dbFile), 'yedek');
startDailyServerBackups(db, backupDir);

createApp(db, { deepChecker, ai, backupDir }).listen(port, () => {
  console.log(`Timay sunucusu http://localhost:${port} adresinde çalışıyor`);
  console.log(`Günlük veritabanı yedeği: ${backupDir}`);
  if (!deepChecker) console.log('ANTHROPIC_API_KEY tanımlı değil: derin teyit ve yapay zekâ (Claude) kapalı.');
});
