import { createApp } from './app.ts';
import { createClaudeChecker } from './claude.ts';
import { openDb } from './db.ts';

const port = Number(process.env.PORT ?? 4000);
const db = openDb(process.env.DB_FILE ?? 'timay.db');
const deepChecker = createClaudeChecker();

createApp(db, { deepChecker }).listen(port, () => {
  console.log(`Timay sunucusu http://localhost:${port} adresinde çalışıyor`);
  if (!deepChecker) console.log('ANTHROPIC_API_KEY tanımlı değil: derin teyit (Claude) kapalı.');
});
