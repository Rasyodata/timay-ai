// Masaüstü programın kendini güncellemesi.
// GitHub Actions her main derlemesinden sonra kurulum dosyasını buraya yükler; programdaki
// "Güncelle" düğmesi en son sürümü buradan indirip kurar. Yükleme için gizli anahtar
// gerekmez: GitHub'ın her iş için verdiği imzalı OIDC kimliği doğrulanır (yalnız
// Rasyodata/timay-ai deposunun main dalı yükleyebilir).
import { createHash, createPublicKey, verify, type JsonWebKey } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Request, Response } from 'express';

export const OIDC_ISSUER = 'https://token.actions.githubusercontent.com';
export const OIDC_AUDIENCE = 'timay-sunucu';
export const ALLOWED_REPO = 'Rasyodata/timay-ai';
export const ALLOWED_REF = 'refs/heads/main';

export interface Release {
  version: string;
  file: string;
  size: number;
  sha256: string;
  date: string;
}

export type Jwks = () => Promise<{ keys: (JsonWebKey & { kid?: string })[] }>;

let jwksCache: { at: number; keys: (JsonWebKey & { kid?: string })[] } | null = null;
export const githubJwks: Jwks = async () => {
  if (jwksCache && Date.now() - jwksCache.at < 3600_000) return { keys: jwksCache.keys };
  const res = await fetch(`${OIDC_ISSUER}/.well-known/jwks`);
  if (!res.ok) throw new Error(`JWKS alınamadı (${res.status})`);
  const body = (await res.json()) as { keys: (JsonWebKey & { kid?: string })[] };
  jwksCache = { at: Date.now(), keys: body.keys };
  return body;
};

const b64 = (s: string) => Buffer.from(s, 'base64url');

/** GitHub Actions OIDC kimliğini doğrular; geçersizse hata mesajı döner. */
export async function checkUploader(token: string, jwks: Jwks, now = Date.now()): Promise<string | null> {
  const parts = token.split('.');
  if (parts.length !== 3) return 'Kimlik biçimi geçersiz.';
  let header: { alg?: string; kid?: string };
  let claims: { iss?: string; aud?: string | string[]; exp?: number; nbf?: number; repository?: string; ref?: string };
  try {
    header = JSON.parse(b64(parts[0]).toString('utf8'));
    claims = JSON.parse(b64(parts[1]).toString('utf8'));
  } catch {
    return 'Kimlik okunamadı.';
  }
  if (header.alg !== 'RS256') return 'İmza türü desteklenmiyor.';
  const { keys } = await jwks();
  const jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) return 'İmza anahtarı bulunamadı.';
  const ok = verify('RSA-SHA256', Buffer.from(`${parts[0]}.${parts[1]}`), createPublicKey({ key: jwk, format: 'jwk' }), b64(parts[2]));
  if (!ok) return 'İmza geçersiz.';
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  const sec = now / 1000;
  if (claims.iss !== OIDC_ISSUER || !aud.includes(OIDC_AUDIENCE)) return 'Kimlik bu sunucu için değil.';
  if (!claims.exp || claims.exp < sec || (claims.nbf && claims.nbf > sec + 60)) return 'Kimliğin süresi geçmiş.';
  if (claims.repository !== ALLOWED_REPO || claims.ref !== ALLOWED_REF) return 'Bu depo/dal yükleme yapamaz.';
  return null;
}

/** "0.2.45" gibi sürümleri karşılaştırır. */
export function newer(a: string, b: string) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d > 0;
  }
  return false;
}

export function latest(dir: string): Release | null {
  const f = join(dir, 'latest.json');
  if (!existsSync(f)) return null;
  try {
    return JSON.parse(readFileSync(f, 'utf8')) as Release;
  } catch {
    return null;
  }
}

export function routes(dir: string, jwks: Jwks = githubJwks) {
  const info = (_req: Request, res: Response) => {
    const rel = latest(dir);
    res.json(rel ? { version: rel.version, size: rel.size, sha256: rel.sha256, date: rel.date, url: '/api/guncelleme/indir' } : { version: null });
  };

  const download = (_req: Request, res: Response) => {
    const rel = latest(dir);
    if (!rel || !existsSync(join(dir, rel.file))) {
      res.status(404).json({ error: 'Henüz güncelleme yüklenmedi.' });
      return;
    }
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Length', String(rel.size));
    res.setHeader('Content-Disposition', `attachment; filename="${rel.file}"`);
    createReadStream(join(dir, rel.file)).pipe(res);
  };

  const upload = async (req: Request, res: Response) => {
    const token = req.header('authorization')?.replace(/^Bearer /, '') ?? '';
    const version = String(req.header('x-timay-version') ?? '');
    const why = await checkUploader(token, jwks).catch((e: Error) => e.message);
    if (why) {
      res.status(403).json({ error: why });
      return;
    }
    if (!/^\d+\.\d+\.\d+$/.test(version)) {
      res.status(400).json({ error: 'Sürüm numarası geçersiz.' });
      return;
    }
    mkdirSync(dir, { recursive: true });
    const file = `Timay-Kurulum-${version}.exe`;
    const tmp = join(dir, `${file}.part`);
    const hash = createHash('sha256');
    let size = 0;
    const out = createWriteStream(tmp);
    req.on('data', (chunk: Buffer) => {
      hash.update(chunk);
      size += chunk.length;
    });
    req.pipe(out);
    out.on('error', (e) => res.status(500).json({ error: e.message }));
    out.on('finish', () => {
      if (size < 1024) {
        unlinkSync(tmp);
        res.status(400).json({ error: 'Dosya boş.' });
        return;
      }
      renameSync(tmp, join(dir, file));
      const rel: Release = { version, file, size, sha256: hash.digest('hex'), date: new Date().toISOString() };
      writeFileSync(join(dir, 'latest.json'), JSON.stringify(rel, null, 2));
      // Diskte yalnız son kurulum dosyası kalsın.
      for (const f of readdirSync(dir)) if (f !== file && f !== 'latest.json' && statSync(join(dir, f)).isFile()) unlinkSync(join(dir, f));
      res.json(rel);
    });
  };

  return { info, download, upload };
}
