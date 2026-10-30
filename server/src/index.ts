import { createApp } from './app.ts';
import { openDb } from './db.ts';

const port = Number(process.env.PORT ?? 4000);
const db = openDb(process.env.DB_FILE ?? 'timay.db');

createApp(db).listen(port, () => {
  console.log(`Timay sunucusu http://localhost:${port} adresinde çalışıyor`);
});
