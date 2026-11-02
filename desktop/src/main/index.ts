import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { basename, dirname, join } from 'node:path';

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    title: 'Timay',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
    },
  });

  // Dış bağlantılar (ör. karar kaynağı) varsayılan tarayıcıda açılır.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) shell.openExternal(url);
    return { action: 'deny' };
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

// Yargıtay karar veritabanı (Adalet Bakanlığı) yurt dışındaki sunucuya yanıt vermediği için
// arama ve karar metni avukatın kendi bilgisayarından çekilir.
const BEDESTEN = 'https://bedesten.adalet.gov.tr/emsal-karar/';
ipcMain.handle('bedesten', async (_event, path: unknown, data: unknown) => {
  if (path !== 'searchDocuments' && path !== 'getDocumentContent') throw new Error('Geçersiz istek.');
  const res = await fetch(BEDESTEN + path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      Accept: '*/*',
      AdaletApplicationName: 'UyapMevzuat',
      Origin: 'https://mevzuat.adalet.gov.tr',
      Referer: 'https://mevzuat.adalet.gov.tr/',
    },
    body: JSON.stringify({ data, applicationName: 'UyapMevzuat', ...(path === 'searchDocuments' ? { paging: true } : {}) }),
  });
  if (!res.ok) throw new Error(`Karar veritabanı yanıt vermedi (${res.status}).`);
  return res.json();
});

// ---------- Yedekleme ----------
// Yedekler varsayılan olarak D: sürücüsüne (C: çoğu bilgisayarda dolu), yoksa Belgeler klasörüne yazılır.
const BACKUP_FILE = /^Timay-Yedek-.*\.timay$/;
function defaultBackupFolder() {
  if (process.platform === 'win32' && existsSync('D:\\')) return 'D:\\Timay-Yedek';
  return join(app.getPath('documents'), 'Timay-Yedek');
}
const str = (v: unknown) => (typeof v === 'string' ? v : '');
const safeName = (v: unknown) => basename(str(v)).replace(/[^\w.\-]/g, '_') || 'Timay-Yedek.timay';

ipcMain.handle('backup:defaultFolder', () => defaultBackupFolder());

ipcMain.handle('backup:pickFolder', async (event, current: unknown) => {
  const win = BrowserWindow.fromWebContents(event.sender)!;
  const r = await dialog.showOpenDialog(win, { title: 'Yedek klasörünü seçin', defaultPath: str(current) || defaultBackupFolder(), properties: ['openDirectory', 'createDirectory'] });
  return r.canceled ? null : r.filePaths[0];
});

ipcMain.handle('backup:save', async (event, fileName: unknown, base64: unknown, folder: unknown) => {
  const win = BrowserWindow.fromWebContents(event.sender)!;
  const dir = str(folder) || defaultBackupFolder();
  mkdirSync(dir, { recursive: true });
  const r = await dialog.showSaveDialog(win, {
    title: 'Yedeği kaydet',
    defaultPath: join(dir, safeName(fileName)),
    filters: [{ name: 'Timay yedeği', extensions: ['timay'] }],
  });
  if (r.canceled || !r.filePath) return null;
  writeFileSync(r.filePath, Buffer.from(str(base64), 'base64'));
  return r.filePath;
});

// Günlük otomatik yedek: klasöre yazar, en yeni `keep` yedeği tutar.
ipcMain.handle('backup:auto', (_event, fileName: unknown, base64: unknown, folder: unknown, keep: unknown) => {
  const dir = str(folder) || defaultBackupFolder();
  mkdirSync(dir, { recursive: true });
  const file = join(dir, safeName(fileName));
  writeFileSync(file, Buffer.from(str(base64), 'base64'));
  const n = Math.max(1, Math.min(365, Number(keep) || 30));
  const old = readdirSync(dir)
    .filter((f) => BACKUP_FILE.test(f))
    .sort()
    .reverse()
    .slice(n);
  for (const f of old) unlinkSync(join(dir, f));
  return file;
});

ipcMain.handle('backup:list', (_event, folder: unknown) => {
  const dir = str(folder) || defaultBackupFolder();
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => BACKUP_FILE.test(f))
    .sort()
    .reverse()
    .map((f) => {
      const st = statSync(join(dir, f));
      return { name: f, path: join(dir, f), size: st.size, date: st.mtime.toISOString() };
    });
});

ipcMain.handle('backup:open', async (event, path: unknown) => {
  let file = str(path);
  if (!file) {
    const win = BrowserWindow.fromWebContents(event.sender)!;
    const r = await dialog.showOpenDialog(win, { title: 'Yedek dosyasını seçin', defaultPath: defaultBackupFolder(), filters: [{ name: 'Timay yedeği', extensions: ['timay'] }], properties: ['openFile'] });
    if (r.canceled) return null;
    file = r.filePaths[0];
  }
  if (!file.toLowerCase().endsWith('.timay')) throw new Error('Yalnızca .timay yedek dosyası açılabilir.');
  return { name: basename(file), base64: readFileSync(file).toString('base64') };
});

ipcMain.handle('backup:show', (_event, path: unknown) => {
  const p = str(path);
  if (p && existsSync(p)) shell.showItemInFolder(p);
  else shell.openPath(p || defaultBackupFolder());
});

// Yedeği e-postayla göndermek için: e-posta programı açılır, dosya klasörde seçili gösterilir (sürükleyip eklenir).
ipcMain.handle('backup:mail', (_event, path: unknown, to: unknown) => {
  const p = str(path);
  const subject = encodeURIComponent(`Timay yedeği ${basename(p)}`);
  const body = encodeURIComponent('Timay büro yedeği ektedir. (Dosya klasörde seçili olarak açıldı, e-postaya sürükleyip bırakın.)');
  shell.openExternal(`mailto:${encodeURIComponent(str(to))}?subject=${subject}&body=${body}`);
  if (p && existsSync(p)) shell.showItemInFolder(p);
});

// ---------- Güncelleme ----------
// "Güncelle" düğmesi: en son kurulum dosyası Timay sunucusundan indirilir, doğrulanır ve
// sessiz kurulumla aynı klasöre kurulur; kurulum bitince program kendiliğinden yeniden açılır.
const serverBase = (url: unknown) => {
  const u = str(url).replace(/\/+$/, '');
  if (!/^https?:\/\//.test(u)) throw new Error('Sunucu adresi geçersiz.');
  return u;
};

ipcMain.handle('app:version', () => app.getVersion());

ipcMain.handle('update:check', async (_event, server: unknown) => {
  const current = app.getVersion();
  const res = await fetch(`${serverBase(server)}/api/guncelleme`);
  if (!res.ok) throw new Error(`Güncelleme bilgisi alınamadı (${res.status}).`);
  const info = (await res.json()) as { version: string | null; size?: number; date?: string };
  const newer = (a: string, b: string) => {
    const pa = a.split('.').map(Number);
    const pb = b.split('.').map(Number);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      const d = (pa[i] || 0) - (pb[i] || 0);
      if (d) return d > 0;
    }
    return false;
  };
  return { current, latest: info.version, size: info.size ?? 0, date: info.date ?? '', available: Boolean(info.version && newer(info.version, current)), packaged: app.isPackaged };
});

ipcMain.handle('update:install', async (event, server: unknown) => {
  if (!app.isPackaged) throw new Error('Geliştirme sürümü güncellenemez.');
  const base = serverBase(server);
  const info = (await (await fetch(`${base}/api/guncelleme`)).json()) as { version: string | null; sha256?: string };
  if (!info.version) throw new Error('Sunucuda güncelleme yok.');
  // C: çoğu bilgisayarda dolu: indirme ve kurulumun geçici dosyaları D: sürücüsüne.
  const work = process.platform === 'win32' && existsSync('D:\\') ? 'D:\\Timay-Kurulum' : join(app.getPath('temp'), 'Timay-Kurulum');
  const tmp = join(work, 'tmp');
  mkdirSync(tmp, { recursive: true });
  const file = join(work, `Timay-Kurulum-${info.version}.exe`);

  const res = await fetch(`${base}/api/guncelleme/indir`);
  if (!res.ok || !res.body) throw new Error(`Kurulum dosyası indirilemedi (${res.status}).`);
  const total = Number(res.headers.get('content-length')) || 0;
  const hash = createHash('sha256');
  const chunks: Buffer[] = [];
  let got = 0;
  let last = 0;
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    const b = Buffer.from(value);
    chunks.push(b);
    hash.update(b);
    got += b.length;
    const pct = total ? Math.floor((got / total) * 100) : 0;
    if (pct !== last) {
      last = pct;
      event.sender.send('update:progress', pct);
    }
  }
  if (info.sha256 && hash.digest('hex') !== info.sha256) throw new Error('İndirilen dosya bozuk, tekrar deneyin.');
  writeFileSync(file, Buffer.concat(chunks));

  // Kurulum klasörü ve kurulum türü (tüm kullanıcılar mı, yalnız bu kullanıcı mı) korunur.
  const installDir = dirname(app.getPath('exe'));
  const perUser = installDir.toLowerCase().startsWith(join(app.getPath('appData'), '..', 'Local').toLowerCase());
  const args = ['/S', '--updated', '--force-run', ...(perUser ? [] : ['/allusers']), `/D=${installDir}`];
  const child = spawn(file, args, { detached: true, stdio: 'ignore', env: { ...process.env, TEMP: tmp, TMP: tmp } });
  child.unref();
  setTimeout(() => app.quit(), 500);
  return { started: true, version: info.version };
});

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
