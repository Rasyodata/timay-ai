// Windows ekran koruyucusu ve ekran kilidi.
// - "TimayPlatform.scr" (scr/TimayPlatform.cs) Windows'tan /s alınca Timay.exe'yi --ekran-koruyucu ile açar:
//   her ekranda tam ekran tanıtım; fare/klavye dokununca kapanır.
// - Program ilk açılışta (kullanıcı başına bir kez) kendini bu kullanıcının Windows ekran koruyucusu yapar:
//   3 dakika bekleme ve dönüşte Windows şifresi. Ekran koruyucudaki seçenekle kapatılabilir.
import { app, BrowserWindow, ipcMain, screen } from 'electron';
import { execFile, spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const DESKTOP = 'HKCU\\Control Panel\\Desktop';

export function saverMode(argv = process.argv): 'show' | 'quit' | null {
  for (const a of argv.slice(1)) {
    const x = a.toLowerCase();
    if (x === '--ekran-koruyucu') return 'show';
    if (/^[/-]s$/.test(x)) return 'show';
    if (/^[/-][pc](:.*)?$/.test(x)) return 'quit';
  }
  return null;
}

/** Ekran koruyucu çalışırken programın kendi verisine dokunmasın diye ayrı bir klasör kullanılır. */
export function prepareSaverMode() {
  app.setPath('userData', join(app.getPath('userData'), 'ekran-koruyucu'));
}

export function openSaverWindows(preload: string, load: (win: BrowserWindow, query: string) => void) {
  const wins: BrowserWindow[] = [];
  const quit = () => {
    for (const w of wins) if (!w.isDestroyed()) w.destroy();
    app.quit();
  };
  for (const d of screen.getAllDisplays()) {
    const win = new BrowserWindow({
      ...d.bounds,
      frame: false,
      fullscreen: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      backgroundColor: '#05070d',
      show: false,
      webPreferences: { preload, contextIsolation: true, sandbox: true },
    });
    win.setAlwaysOnTop(true, 'screen-saver');
    win.once('ready-to-show', () => win.show());
    win.on('closed', quit);
    win.webContents.on('before-input-event', () => quit());
    load(win, 'reklam&ekran');
    wins.push(win);
  }
}

function reg(args: string[]): Promise<string> {
  return new Promise((resolve, reject) =>
    execFile('reg.exe', args, { windowsHide: true }, (err, out) => (err ? reject(err) : resolve(String(out)))),
  );
}

function scrPath(): string | null {
  const sys = join(process.env.WINDIR ?? 'C:\\Windows', 'System32', 'TimayPlatform.scr');
  if (existsSync(sys)) return sys;
  const own = join(dirname(process.execPath), 'TimayPlatform.scr');
  return existsSync(own) ? own : null;
}

async function current(): Promise<string> {
  try {
    const out = await reg(['query', DESKTOP, '/v', 'SCRNSAVE.EXE']);
    return out.match(/SCRNSAVE\.EXE\s+REG_\w+\s+(.*)/i)?.[1]?.trim() ?? '';
  } catch {
    return '';
  }
}

async function status() {
  const path = process.platform === 'win32' && app.isPackaged ? scrPath() : null;
  if (!path) return { available: false, enabled: false };
  return { available: true, enabled: /TimayPlatform\.scr$/i.test(await current()) };
}

async function setEnabled(on: boolean) {
  const path = scrPath();
  if (process.platform !== 'win32' || !path) return status();
  if (on) {
    await reg(['add', DESKTOP, '/v', 'SCRNSAVE.EXE', '/t', 'REG_SZ', '/d', path, '/f']);
    await reg(['add', DESKTOP, '/v', 'ScreenSaveActive', '/t', 'REG_SZ', '/d', '1', '/f']);
    await reg(['add', DESKTOP, '/v', 'ScreenSaveTimeOut', '/t', 'REG_SZ', '/d', '180', '/f']);
    // Ekran koruyucudan dönünce Windows şifresi sorulsun.
    await reg(['add', DESKTOP, '/v', 'ScreenSaverIsSecure', '/t', 'REG_SZ', '/d', '1', '/f']);
  } else if (/TimayPlatform\.scr$/i.test(await current())) {
    await reg(['delete', DESKTOP, '/v', 'SCRNSAVE.EXE', '/f']);
    await reg(['add', DESKTOP, '/v', 'ScreenSaveActive', '/t', 'REG_SZ', '/d', '0', '/f']);
  }
  // Ayarı Windows'a hemen bildir.
  spawn('rundll32.exe', ['user32.dll,UpdatePerUserSystemParameters', '1', 'True'], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
  return status();
}

/** İlk açılışta (kullanıcı başına bir kez) Timay'ı Windows ekran koruyucusu yapar. */
export async function applyOnFirstRun() {
  if (process.platform !== 'win32' || !app.isPackaged || !scrPath()) return;
  const flag = join(app.getPath('userData'), 'ekran-koruyucu.json');
  if (existsSync(flag)) {
    try {
      if (JSON.parse(readFileSync(flag, 'utf8')).done) return;
    } catch {
      /* yeniden uygula */
    }
  }
  try {
    await setEnabled(true);
    writeFileSync(flag, JSON.stringify({ done: true, at: new Date().toISOString() }));
  } catch {
    /* bir sonraki açılışta yeniden denenir */
  }
}

export function registerSaverIpc() {
  ipcMain.handle('saver:system', () => status());
  ipcMain.handle('saver:system:set', (_e, on: unknown) => setEnabled(on === true));
  // Program içindeki tanıtım ekranı kapanınca Windows kilitlenir (Windows şifresi sorulur).
  ipcMain.handle('saver:lock', () => {
    if (process.platform !== 'win32') return false;
    spawn('rundll32.exe', ['user32.dll,LockWorkStation'], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
    return true;
  });
}
