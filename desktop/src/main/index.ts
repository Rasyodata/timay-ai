import { app, BrowserWindow, ipcMain, shell } from 'electron';
import { join } from 'node:path';

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

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
