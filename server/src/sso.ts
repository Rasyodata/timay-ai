import { createHash, createPublicKey, randomBytes, verify, type KeyObject } from 'node:crypto';
import type { DB } from './db.ts';
import { ApiError } from './errors.ts';
import { getUser, hashPassword, newSession, type Role } from './auth.ts';

/**
 * Platformdan tek oturum (SSO): platforma giriş yapmış kullanıcı Timay'e şifre yazmadan girer.
 *
 * Platform, kendi Ed25519 anahtarıyla imzalı, 60 sn geçerli, tek kullanımlık bir giriş belgesi üretir; Timay belgeyi
 * platformun herkese açık anahtarıyla (kaynak/api/sso/anahtar) doğrular. Ortak bir gizli anahtar yoktur.
 * Yalnız izinli platformlar kabul edilir: adresler kodda açık yazılmaz, SHA-256 özetleriyle tutulur
 * (ek kaynak: PLATFORM_SSO_KAYNAK, virgülle ayrılmış açık adres — yerel denemeler için).
 *
 * Eşleme: platform şirketi → ayrı büro (mevcut büro verisine dokunulmaz); platform kullanıcısı → o bürodaki kullanıcı.
 * Rol ve yönetici yetkisi her girişte platformdakiyle eşitlenir (Stajyer onaylayamaz).
 */
const IZINLI_OZET = new Set([
  '21267fbbfc6a2c1fdd854f6f74e8c690e7537c73f43c6c07b480845959447237',
  'd49c3c15153cf73b2373931d3f1377d70bd0c0fd55a74b3ea79af9fdcf25e527',
  '6344311d6466acdf9c7e1a67ee633fe4e3bff33b329f72109f16478ecc0a7498',
]);
const ozet = (s: string) => createHash('sha256').update(s).digest('hex');
const ekKaynaklar = () => new Set((process.env.PLATFORM_SSO_KAYNAK ?? '').split(',').map((x) => x.trim().replace(/\/+$/, '')).filter(Boolean));

export type Fetch = (url: string) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;
const anahtarlar = new Map<string, { key: KeyObject; zaman: number }>();
const kullanilan = new Map<string, number>(); // nonce → bitiş (tekrar kullanım engeli)

async function platformAnahtari(kaynak: string, fetchFn: Fetch): Promise<KeyObject> {
  const onbellek = anahtarlar.get(kaynak);
  if (onbellek && Date.now() - onbellek.zaman < 10 * 60 * 1000) return onbellek.key;
  const res = await fetchFn(`${kaynak}/api/sso/anahtar`);
  if (!res.ok) throw new ApiError(502, 'Platformun anahtarı alınamadı.');
  const pem = (await res.json() as { acik?: string }).acik;
  if (typeof pem !== 'string') throw new ApiError(502, 'Platform anahtarı geçersiz.');
  const key = createPublicKey(pem);
  if (key.asymmetricKeyType !== 'ed25519') throw new ApiError(502, 'Platform anahtarı geçersiz.');
  anahtarlar.set(kaynak, { key, zaman: Date.now() });
  return key;
}

interface Belge {
  aud: string; iat: number; exp: number; nonce: string;
  sirket: { id: number; unvan: string };
  kullanici: { id: number; ad: string; eposta?: string | null };
  rol: Role; yonetici: boolean;
}

export async function ssoLogin(db: DB, body: { token?: string; kaynak?: string }, fetchFn: Fetch) {
  const kaynak = String(body?.kaynak ?? '').trim().replace(/\/+$/, '');
  const token = String(body?.token ?? '');
  if (!/^https?:\/\/[^/]+$/.test(kaynak)) throw new ApiError(400, 'Geçersiz platform adresi.');
  if (!IZINLI_OZET.has(ozet(kaynak)) && !ekKaynaklar().has(kaynak)) throw new ApiError(403, 'Bu platformdan girişe izin yok.');
  const [govde, imza] = token.split('.');
  if (!govde || !imza) throw new ApiError(400, 'Geçersiz giriş belgesi.');
  const key = await platformAnahtari(kaynak, fetchFn);
  if (!verify(null, Buffer.from(govde), key, Buffer.from(imza, 'base64url'))) throw new ApiError(401, 'Giriş belgesi doğrulanamadı.');
  let b: Belge;
  try { b = JSON.parse(Buffer.from(govde, 'base64url').toString('utf8')); } catch { throw new ApiError(400, 'Geçersiz giriş belgesi.'); }
  const simdi = Math.floor(Date.now() / 1000);
  if (b.aud !== 'timay' || !(b.exp > simdi) || b.exp - b.iat > 120 || !b.nonce) throw new ApiError(401, 'Giriş belgesinin süresi dolmuş; sayfayı yenileyin.');
  for (const [n, bitis] of kullanilan) if (bitis < simdi) kullanilan.delete(n);
  if (kullanilan.has(b.nonce)) throw new ApiError(401, 'Giriş belgesi daha önce kullanılmış; sayfayı yenileyin.');
  kullanilan.set(b.nonce, b.exp);
  if (b.rol !== 'avukat' && b.rol !== 'stajyer') throw new ApiError(400, 'Geçersiz rol.');
  const sirketId = Number(b.sirket?.id), kullaniciId = Number(b.kullanici?.id);
  const ad = String(b.kullanici?.ad ?? '').trim();
  if (!sirketId || !kullaniciId || !ad) throw new ApiError(400, 'Geçersiz giriş belgesi.');

  const on = ozet(kaynak).slice(0, 10);
  return db.transaction(() => {
    // büro: platform şirketi başına bir büro
    const buroRef = `${on}:${sirketId}`;
    let buro = db.prepare('SELECT id FROM offices WHERE external_ref = ?').get(buroRef) as { id: number } | undefined;
    if (!buro) buro = { id: Number(db.prepare('INSERT INTO offices (name, external_ref) VALUES (?, ?)').run(String(b.sirket.unvan || 'Platform şirketi').trim(), buroRef).lastInsertRowid) };
    else db.prepare('UPDATE offices SET name = ? WHERE id = ?').run(String(b.sirket.unvan || 'Platform şirketi').trim(), buro.id);
    // kullanıcı: o büroda platform kullanıcısı
    const kulRef = `${on}:${sirketId}:${kullaniciId}`;
    const avukat = b.rol === 'avukat' ? 1 : 0, yonetici = b.yonetici && avukat ? 1 : 0;
    let u = db.prepare('SELECT id FROM users WHERE external_ref = ?').get(kulRef) as { id: number } | undefined;
    if (!u) {
      const istenen = typeof b.kullanici.eposta === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(b.kullanici.eposta) ? b.kullanici.eposta.trim().toLowerCase() : '';
      const eposta = istenen && !db.prepare('SELECT 1 FROM users WHERE email = ?').get(istenen) ? istenen : `p${sirketId}.${kullaniciId}.${on}@platform.invalid`;
      u = { id: Number(db.prepare(`INSERT INTO users (office_id, name, email, password_hash, role, is_admin, can_finance, can_approve, all_cases, external_ref)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(buro.id, ad, eposta, hashPassword(randomBytes(32).toString('hex')), b.rol, yonetici, yonetici, avukat, yonetici ? 1 : 0, kulRef).lastInsertRowid) };
    } else {
      db.prepare('UPDATE users SET name = ?, role = ?, is_admin = ?, can_approve = ?, must_change_password = 0 WHERE id = ?').run(ad, b.rol, yonetici, avukat, u.id);
    }
    return { token: newSession(db, u.id), user: getUser(db, u.id) };
  })();
}
