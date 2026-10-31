import { useEffect, useState, type FormEvent } from 'react';
import { DEFAULT_SERVER_URL, getServerUrl, setServerUrl, type User } from './api';
import { Card, ErrorText, Field, Icon, PageHeader } from './ui';

/*
 * Sistem ayarları bu bilgisayara özeldir (sunucu adresi, tema). Girişi ayar şifresi korur;
 * şifre bu bilgisayarda özet (hash) olarak saklanır, böylece sunucuya ulaşılamadığında da
 * ayarlar açılabilir ve sunucu adresi düzeltilebilir.
 */

const PIN_KEY = 'timay-settings-pin';
const THEME_KEY = 'timay-theme';

async function hash(pin: string) {
  const data = new TextEncoder().encode(`timay-ayar:${pin}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function read(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function hasSettingsPin() {
  return Boolean(read(PIN_KEY));
}

export async function checkSettingsPin(pin: string) {
  return (await hash(pin)) === read(PIN_KEY);
}

async function setSettingsPin(pin: string) {
  localStorage.setItem(PIN_KEY, await hash(pin));
}

export type Theme = 'acik' | 'koyu' | 'sistem';

export function applyTheme(theme: Theme = (read(THEME_KEY) as Theme) || 'acik') {
  const dark = theme === 'koyu' || (theme === 'sistem' && window.matchMedia?.('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
}

/** Sunucunun ayakta olup olmadığını dener; Render uykudan uyanırken birkaç kez bekler. */
export async function pingServer(url = getServerUrl(), attempts = 4) {
  for (let i = 0; i < attempts; i++) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 20_000);
      const res = await fetch(`${url}/api/health`, { signal: ctrl.signal });
      clearTimeout(timer);
      if (res.ok) return true;
    } catch {
      // yeniden dene
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
  return false;
}

/** Ayar şifresi penceresi. Şifre hiç belirlenmemişse yalnızca büro yöneticisi (ya da ilk kurulumda giriş ekranı) geçebilir. */
export function SettingsGate({ user, onOpen, onCancel }: { user: User | null; onOpen: () => void; onCancel: () => void }) {
  const [pin, setPin] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const pinSet = hasSettingsPin();

  useEffect(() => {
    if (!pinSet && (!user || user.is_admin)) onOpen();
  }, []);

  if (!pinSet) {
    return (
      <div className="modal-backdrop" onClick={onCancel}>
        <div className="modal" onClick={(e) => e.stopPropagation()}>
          <h3>Sistem ayarları</h3>
          <p className="muted">Sistem ayarlarına yalnızca büro yöneticisi girebilir.</p>
          <div className="form-actions">
            <button onClick={onCancel}>Kapat</button>
          </div>
        </div>
      </div>
    );
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (await checkSettingsPin(pin)) onOpen();
    else setErr('Ayar şifresi yanlış.');
  }

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <form className="modal" onSubmit={submit} onClick={(e) => e.stopPropagation()}>
        <h3>
          <Icon name="shield" /> Sistem ayarları
        </h3>
        <p className="muted small">Devam etmek için ayar şifresini girin.</p>
        <input type="password" autoFocus value={pin} onChange={(e) => setPin(e.target.value)} placeholder="Ayar şifresi" />
        <ErrorText error={err} />
        <div className="form-actions">
          <button type="button" onClick={onCancel}>
            Vazgeç
          </button>
          <button className="primary" type="submit">
            Aç
          </button>
        </div>
      </form>
    </div>
  );
}

export function SettingsView({ onClose, onReconnected }: { onClose?: () => void; onReconnected?: () => void }) {
  const [server, setServer] = useState(getServerUrl());
  const [status, setStatus] = useState<'idle' | 'testing' | 'ok' | 'fail'>('idle');
  const [pin, setPin] = useState({ a: '', b: '' });
  const [pinMsg, setPinMsg] = useState<string | null>(null);
  const [pinErr, setPinErr] = useState<string | null>(null);
  const [theme, setTheme] = useState<Theme>((read(THEME_KEY) as Theme) || 'acik');

  async function test(url = server) {
    setStatus('testing');
    setStatus((await pingServer(url.trim().replace(/\/+$/, ''), 2)) ? 'ok' : 'fail');
  }

  async function saveAndReconnect() {
    setServerUrl(server);
    setServer(getServerUrl());
    setStatus('testing');
    const ok = await pingServer(getServerUrl());
    setStatus(ok ? 'ok' : 'fail');
    if (ok) onReconnected?.();
  }

  return (
    <div className="page">
      <PageHeader
        title="Sistem ayarları"
        subtitle="Bu bilgisayarın sunucu bağlantısı, ayar şifresi ve görünüm"
        back={onClose}
      />
      <div className="grid-2">
        <Card title="Sunucu bağlantısı">
          <Field label="Sunucu adresi">
            <input value={server} onChange={(e) => setServer(e.target.value)} placeholder="https://" />
          </Field>
          <p className="muted small">Varsayılan: {DEFAULT_SERVER_URL}</p>
          <div className="conn-status">
            {status === 'testing' && <span className="muted">Bağlanılıyor… (sunucu uykudaysa 1 dakika sürebilir)</span>}
            {status === 'ok' && <span className="success-note">Sunucuya bağlanıldı.</span>}
            {status === 'fail' && <span className="error">Sunucuya ulaşılamadı. Adresi ve internet bağlantısını kontrol edin.</span>}
          </div>
          <div className="form-actions">
            <button onClick={() => setServer(DEFAULT_SERVER_URL)}>Varsayılana dön</button>
            <button onClick={() => test()} disabled={status === 'testing'}>
              Bağlantıyı dene
            </button>
            <button className="primary" onClick={saveAndReconnect} disabled={status === 'testing'}>
              Kaydet ve yeniden bağlan
            </button>
          </div>
        </Card>
        <Card title="Ayar şifresi">
          <p className="muted small">
            {hasSettingsPin()
              ? 'Bu bilgisayarda sistem ayarlarına girmek için şifre isteniyor. Değiştirmek için yeni şifreyi iki kez yazın.'
              : 'Henüz ayar şifresi yok. Diğer kullanıcıların ayarlara girmemesi için bir şifre belirleyin.'}
          </p>
          <form
            className="form-grid"
            onSubmit={async (e) => {
              e.preventDefault();
              if (pin.a.length < 4) return setPinErr('Şifre en az 4 karakter olmalı.');
              if (pin.a !== pin.b) return setPinErr('İki şifre aynı değil.');
              await setSettingsPin(pin.a);
              setPin({ a: '', b: '' });
              setPinErr(null);
              setPinMsg('Ayar şifresi kaydedildi.');
            }}
          >
            <Field label="Yeni ayar şifresi">
              <input type="password" value={pin.a} onChange={(e) => setPin({ ...pin, a: e.target.value })} />
            </Field>
            <Field label="Tekrar">
              <input type="password" value={pin.b} onChange={(e) => setPin({ ...pin, b: e.target.value })} />
            </Field>
            <div className="form-actions">
              {pinMsg && <span className="success-note">{pinMsg}</span>}
              <ErrorText error={pinErr} />
              <button className="primary" type="submit">
                Şifreyi kaydet
              </button>
            </div>
          </form>
        </Card>
        <Card title="Görünüm">
          <div className="segmented">
            {(
              [
                ['acik', 'Açık', 'sun'],
                ['koyu', 'Koyu', 'moon'],
                ['sistem', 'Windows ile aynı', 'home'],
              ] as const
            ).map(([k, label, icon]) => (
              <button
                key={k}
                type="button"
                className={theme === k ? 'active' : ''}
                onClick={() => {
                  localStorage.setItem(THEME_KEY, k);
                  setTheme(k);
                  applyTheme(k);
                }}
              >
                <Icon name={icon} /> {label}
              </button>
            ))}
          </div>
        </Card>
        <Card title="Hakkında">
          <p className="small">
            Timay hukuk bürosu programı. Kayıtlarınız sunucuda tutulur; aynı hesapla istediğiniz bilgisayardan giriş yapabilirsiniz. Yargıtay araması her
            bilgisayarın kendi internet bağlantısından yapılır.
          </p>
        </Card>
      </div>
    </div>
  );
}

/** Sunucuya ulaşılamadığında ekranın üstünde çıkan şerit. */
export function ConnectionBanner({ onSettings, onReconnected }: { onSettings: () => void; onReconnected: () => void }) {
  const [offline, setOffline] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const off = () => setOffline(true);
    window.addEventListener('timay-offline', off);
    return () => window.removeEventListener('timay-offline', off);
  }, []);
  if (!offline) return null;
  return (
    <div className="conn-banner">
      <Icon name="alert" />
      <span>{busy ? 'Sunucuya yeniden bağlanılıyor… (sunucu uykudaysa 1 dakika sürebilir)' : 'Sunucuya bağlanılamadı.'}</span>
      <button
        className="primary"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          const ok = await pingServer();
          setBusy(false);
          if (ok) {
            setOffline(false);
            onReconnected();
          }
        }}
      >
        Sunucuya yeniden bağlan
      </button>
      <button onClick={onSettings}>Sistem ayarları</button>
    </div>
  );
}
