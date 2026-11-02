// Windows ekran koruyucusunu (build/TimayPlatform.scr) Windows'ta hazır gelen C# derleyicisiyle derler.
// Windows dışında veya derleyici yoksa atlanır; kurulum o zaman ekran koruyucusuz oluşur.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const csc = join(process.env.WINDIR ?? 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');
if (process.platform !== 'win32' || !existsSync(csc)) {
  console.log('Ekran koruyucu derlenmedi (Windows C# derleyicisi yok).');
} else {
  mkdirSync(join(root, 'build'), { recursive: true });
  execFileSync(
    csc,
    ['/nologo', '/target:winexe', '/codepage:65001', '/optimize+', '/r:System.Windows.Forms.dll', `/out:${join(root, 'build', 'TimayPlatform.scr')}`, join(root, 'scr', 'TimayPlatform.cs')],
    { stdio: 'inherit' },
  );
  console.log('Ekran koruyucu derlendi: build/TimayPlatform.scr');
}
