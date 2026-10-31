import { useEffect, useState } from 'react';
import { api, type User } from './api';
import { downloadBase64 } from './Export';
import { Card, Empty, ErrorText, Field, formatDate, Icon, PageHeader, useAsync } from './ui';

/*
 * Yedekleme: büronun bütün kayıtları tek bir .timay dosyasına alınır, e-postayla ya da flaş belleğe
 * gönderilebilir, aynı ya da yeni bir sunucuya geri yüklenir. Program açıkken her gün bir kez
 * kendiliğinden yedek alır (varsayılan klasör D:\Timay-Yedek).
 */

interface Made {
  fileName: string;
  base64: string;
  size: number;
  summary: { key: string; label: string; count: number }[];
}

const K = { auto: 'timay-backup-auto', folder: 'timay-backup-folder', keep: 'timay-backup-keep', last: 'timay-backup-last', lastPath: 'timay-backup-last-path', mail: 'timay-backup-mail' };

function get(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function put(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // tarayıcı depolaması kapalı
  }
}

const bridge = () => window.timay?.backup;
const todayStr = () => new Date().toLocaleDateString('sv-SE');
const mb = (n: number) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);
const autoOn = () => get(K.auto) !== '0';
const keepN = () => Number(get(K.keep)) || 30;

async function folder() {
  return get(K.folder) || (await bridge()?.defaultFolder()) || '';
}

/** Günlük yedeği hemen alır ve klasöre yazar. */
async function runAutoBackup() {
  const b = bridge();
  if (!b) throw new Error('Otomatik yedek yalnızca masaüstü programında çalışır.');
  const made = await api<Made>('/backup', { method: 'POST' });
  const path = await b.auto(made.fileName, made.base64, await folder(), keepN());
  put(K.last, todayStr());
  put(K.lastPath, path);
  window.dispatchEvent(new Event('timay-backup'));
  return path;
}

/** Program açıkken günde bir kez yedek alır (yalnızca yönetici hesabında). */
export function useDailyBackup(user: User) {
  useEffect(() => {
    if (!user.is_admin || !bridge()) return;
    const check = () => {
      if (autoOn() && get(K.last) !== todayStr()) runAutoBackup().catch(() => undefined);
    };
    const first = setTimeout(check, 30_000);
    const timer = setInterval(check, 60 * 60 * 1000);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [user.id]);
}

function Summary({ items }: { items: Made['summary'] }) {
  return (
    <div className="bk-summary">
      {items.map((s) => (
        <span key={s.key} className="tag">
          {s.count} {s.label}
        </span>
      ))}
    </div>
  );
}

function Restore({ initial, onDone }: { initial?: { name: string; base64: string } | null; onDone: () => void }) {
  const [file, setFile] = useState<{ name: string; base64: string } | null>(initial ?? null);
  const [info, setInfo] = useState<{ createdAt: string; createdBy: string; office: string; summary: Made['summary'] } | null>(null);
  const [ok, setOk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    setInfo(null);
    setOk(false);
    setErr(null);
    if (file) api<typeof info>('/backup/inspect', { body: { base64: file.base64 } }).then(setInfo, (e) => setErr((e as Error).message));
  }, [file]);
  useEffect(() => setFile(initial ?? null), [initial]);

  async function choose() {
    const b = bridge();
    if (b) {
      setFile(await b.open());
      return;
    }
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.timay';
    input.onchange = async () => {
      const f = input.files?.[0];
      if (!f) return;
      const buf = new Uint8Array(await f.arrayBuffer());
      let bin = '';
      for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
      setFile({ name: f.name, base64: btoa(bin) });
    };
    input.click();
  }

  async function restore() {
    if (!file) return;
    setBusy(true);
    setErr(null);
    try {
      await api('/backup/restore', { body: { base64: file.base64, confirm: true } });
      setDone(`${file.name} geri yüklendi.`);
      setFile(null);
      onDone();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Yedekten geri yükle">
      <p className="muted small">Bir .timay yedek dosyası seçin. Büronun şimdiki kayıtlarının yerine yedekteki kayıtlar gelir. Yeni bir sunucuya taşınırken de bu kullanılır.</p>
      <div className="row">
        <button onClick={choose}>
          <Icon name="upload" /> Yedek dosyası seç
        </button>
        {file && <span className="small">{file.name}</span>}
      </div>
      {info && (
        <div className="bk-restore">
          <p className="small">
            <strong>{info.office}</strong> bürosunun yedeği · {formatDate(info.createdAt.slice(0, 10))} {new Date(info.createdAt).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })} · alan: {info.createdBy}
          </p>
          <Summary items={info.summary} />
          <label className="check-line warn-line">
            <input type="checkbox" checked={ok} onChange={(e) => setOk(e.target.checked)} /> Şimdiki kayıtların yerine bu yedeğin geleceğini anladım.
          </label>
          <button className="danger" disabled={!ok || busy} onClick={restore}>
            <Icon name="refresh" /> {busy ? 'Geri yükleniyor…' : 'Geri yükle'}
          </button>
        </div>
      )}
      {done && <p className="success small">{done}</p>}
      <ErrorText error={err} />
    </Card>
  );
}

export function BackupView({ user }: { user: User }) {
  const b = bridge();
  const [made, setMade] = useState<{ made: Made; path: string | null } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [auto, setAuto] = useState(autoOn());
  const [keep, setKeep] = useState(keepN());
  const [dir, setDir] = useState('');
  const [mail, setMail] = useState(get(K.mail) ?? '');
  const [restoreFile, setRestoreFile] = useState<{ name: string; base64: string } | null>(null);
  const local = useAsync(async () => (b ? b.list(await folder()) : []), []);
  const server = useAsync(() => api<{ enabled: boolean; files: { name: string; date: string; size: number }[] }>('/backup/server'), []);

  useEffect(() => {
    folder().then(setDir);
    const on = () => local.reload();
    window.addEventListener('timay-backup', on);
    return () => window.removeEventListener('timay-backup', on);
  }, []);

  if (!user.is_admin)
    return (
      <div className="page">
        <PageHeader title="Yedekleme" subtitle="Büro yedekleri" />
        <Empty icon="shield">Yedek almayı ve geri yüklemeyi yalnızca büro yöneticisi yapabilir.</Empty>
      </div>
    );

  async function act(name: string, fn: () => Promise<void>) {
    setBusy(name);
    setErr(null);
    setMsg(null);
    try {
      await fn();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const takeNow = () =>
    act('al', async () => {
      const m = await api<Made>('/backup', { method: 'POST' });
      if (b) {
        const path = await b.save(m.fileName, m.base64, dir);
        setMade({ made: m, path });
        if (path) setMsg(`Yedek kaydedildi: ${path}`);
      } else {
        downloadBase64(m.fileName, m.base64, 'application/octet-stream');
        setMade({ made: m, path: null });
        setMsg('Yedek indirildi.');
      }
      local.reload();
    });

  const send = () =>
    act('gonder', async () => {
      if (!b) throw new Error('E-postayla gönderme masaüstü programında çalışır.');
      put(K.mail, mail.trim());
      const path = await runAutoBackup();
      await b.mail(path, mail.trim());
      setMsg('E-posta programınız açıldı. Yedek dosyası klasörde seçili; e-postaya sürükleyip bırakın.');
    });

  const last = local.data?.[0];
  return (
    <div className="page">
      <PageHeader title="Yedekleme" subtitle="Büronun bütün kayıtlarını yedekleyin, gönderin, gerektiğinde geri yükleyin" />
      {msg && <p className="success-note">{msg}</p>}
      <ErrorText error={err} />
      <div className="grid-2">
        <Card title="Yedek al">
          <p className="muted small">Dava dosyaları, belgeler, dilekçeler, sözleşmeler, süreler, görevler, muhasebe, notlar ve ekip bilgisi tek bir .timay dosyasına yazılır.</p>
          <button className="primary" disabled={Boolean(busy)} onClick={takeNow}>
            <Icon name="download" /> {busy === 'al' ? 'Yedek hazırlanıyor…' : 'Şimdi yedek al'}
          </button>
          {made && (
            <>
              <p className="small">
                {made.made.fileName} · {mb(made.made.size)}
              </p>
              <Summary items={made.made.summary} />
            </>
          )}
        </Card>
        <Card title="Yedek gönder">
          <p className="muted small">Güncel yedek alınır, e-posta programınız açılır ve dosya klasörde seçili gösterilir; e-postaya sürükleyip bırakmanız yeter. Flaş belleğe ya da Google Drive klasörüne de aynı şekilde kopyalayabilirsiniz.</p>
          <Field label="Gönderilecek e-posta (isteğe bağlı)">
            <input type="email" value={mail} onChange={(e) => setMail(e.target.value)} placeholder="ör. buro@ornek.com" />
          </Field>
          <div className="row">
            <button className="primary" disabled={Boolean(busy) || !b} onClick={send}>
              <Icon name="upload" /> {busy === 'gonder' ? 'Hazırlanıyor…' : 'Yedeği e-postayla gönder'}
            </button>
            <button disabled={!b} onClick={() => b?.show(last?.path ?? dir)}>
              <Icon name="folder" /> Klasörde göster
            </button>
          </div>
        </Card>
        <Card title="Günlük otomatik yedek">
          {!b ? (
            <p className="muted small">Otomatik yedek masaüstü programında çalışır.</p>
          ) : (
            <>
              <label className="check-line">
                <input
                  type="checkbox"
                  checked={auto}
                  onChange={(e) => {
                    put(K.auto, e.target.checked ? '1' : '0');
                    setAuto(e.target.checked);
                  }}
                />{' '}
                Program açıkken her gün bir kez otomatik yedek al
              </label>
              <Field label="Yedek klasörü">
                <div className="row">
                  <input readOnly value={dir} />
                  <button
                    onClick={async () => {
                      const d = await b.pickFolder(dir);
                      if (d) {
                        put(K.folder, d);
                        setDir(d);
                        local.reload();
                      }
                    }}
                  >
                    Değiştir
                  </button>
                </div>
              </Field>
              <Field label="Saklanacak yedek sayısı (eskiler silinir)">
                <input
                  type="number"
                  min={1}
                  max={365}
                  value={keep}
                  onChange={(e) => {
                    const n = Math.max(1, Math.min(365, Number(e.target.value) || 30));
                    put(K.keep, String(n));
                    setKeep(n);
                  }}
                />
              </Field>
              <p className="small">
                Son otomatik yedek: <strong>{get(K.last) ? formatDate(get(K.last)) : 'henüz yok'}</strong>
              </p>
              <button disabled={Boolean(busy)} onClick={() => act('oto', async () => setMsg(`Yedek alındı: ${await runAutoBackup()}`))}>
                <Icon name="refresh" /> {busy === 'oto' ? 'Alınıyor…' : 'Şimdi çalıştır'}
              </button>
            </>
          )}
        </Card>
        <Restore initial={restoreFile} onDone={() => setMsg('Yedek geri yüklendi. Ekranlar yeni kayıtlarla açılır.')} />
      </div>
      {b && (
        <Card title="Bu bilgisayardaki yedekler" className="flush">
          {local.data?.length === 0 ? (
            <Empty icon="inbox">Klasörde yedek yok.</Empty>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Dosya</th>
                  <th>Tarih</th>
                  <th>Boyut</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {local.data?.map((f) => (
                  <tr key={f.path}>
                    <td>{f.name}</td>
                    <td>{new Date(f.date).toLocaleString('tr-TR', { dateStyle: 'short', timeStyle: 'short' })}</td>
                    <td>{mb(f.size)}</td>
                    <td className="row">
                      <button className="link small" onClick={() => b.show(f.path)}>
                        Göster
                      </button>
                      <button className="link small" onClick={() => b.mail(f.path, mail.trim())}>
                        Gönder
                      </button>
                      <button className="link small" onClick={async () => setRestoreFile(await b.open(f.path))}>
                        Geri yükle…
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      )}
      <Card title="Sunucu yedekleri">
        <p className="muted small">Sunucu, bütün veritabanının tam kopyasını her gün kendi diskine alır ve son 14 günü saklar. Bilgisayarınız kapalı olsa da çalışır.</p>
        <ErrorText error={server.error} />
        {server.data && (server.data.files.length ? <p className="small">Son sunucu yedeği: <strong>{formatDate(server.data.files[0].date)}</strong> · toplam {server.data.files.length} gün</p> : <p className="muted small">Henüz sunucu yedeği yok.</p>)}
      </Card>
    </div>
  );
}
