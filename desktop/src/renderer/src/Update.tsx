import { useEffect, useState } from 'react';
import { getServerUrl } from './api';
import { Icon } from './ui';

// Masaüstü programın kendini güncellemesi: yeni sürüm varsa üstte şerit çıkar,
// "Güncelle"ye basınca sunucudan indirilir ve kurulur, program yeniden açılır.
type Info = { current: string; latest: string | null; available: boolean; packaged: boolean; size: number };
const bridge = () => window.timay?.update;
const EVENT = 'timay-update-check';

export function checkForUpdates() {
  window.dispatchEvent(new Event(EVENT));
}

export function UpdateBanner() {
  const [info, setInfo] = useState<Info | null>(null);
  const [state, setState] = useState<'idle' | 'checking' | 'none' | 'downloading' | 'installing' | 'error'>('idle');
  const [pct, setPct] = useState(0);
  const [error, setError] = useState('');
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    const u = bridge();
    if (!u) return;
    let manual = false;
    const run = async () => {
      setState('checking');
      try {
        const i = await u.check(getServerUrl());
        setInfo(i);
        setHidden(false);
        setState(i.available ? 'idle' : manual ? 'none' : 'idle');
      } catch (e) {
        if (manual) {
          setError((e as Error).message);
          setState('error');
          setHidden(false);
        } else setState('idle');
      }
      manual = false;
    };
    const onManual = () => {
      manual = true;
      void run();
    };
    void run();
    const timer = window.setInterval(run, 6 * 3600_000);
    window.addEventListener(EVENT, onManual);
    const off = u.onProgress(setPct);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener(EVENT, onManual);
      off();
    };
  }, []);

  const u = bridge();
  if (!u || hidden) return null;

  const install = async () => {
    setState('downloading');
    setPct(0);
    try {
      await u.install(getServerUrl());
      setState('installing');
    } catch (e) {
      setError((e as Error).message);
      setState('error');
    }
  };

  let text = '';
  let action: React.ReactNode = null;
  if (state === 'downloading') text = `Yeni sürüm indiriliyor… %${pct}`;
  else if (state === 'installing') text = 'Kuruluyor. Program birazdan kapanıp yeni sürümle kendiliğinden açılacak. (Windows izin sorarsa "Evet" deyin.)';
  else if (state === 'error') {
    text = `Güncelleme yapılamadı: ${error}`;
    action = <button onClick={install} disabled={!info?.available}>Tekrar dene</button>;
  } else if (state === 'none') {
    text = `Program güncel (sürüm ${info?.current}).`;
  } else if (info?.available) {
    text = `Yeni sürüm hazır: ${info.latest} (şu an ${info.current}${info.size ? `, ${Math.round(info.size / 1048576)} MB` : ''}).`;
    action = (
      <button className="primary" onClick={install}>
        Güncelle
      </button>
    );
  } else return null;

  return (
    <div className="update-banner">
      <Icon name="download" />
      <span>{text}</span>
      {action}
      {state !== 'downloading' && state !== 'installing' && (
        <button className="ghost" onClick={() => setHidden(true)} title="Kapat">
          ✕
        </button>
      )}
    </div>
  );
}

/** Kenar çubuğundaki sürüm satırı; tıklayınca güncelleme denetlenir. */
export function VersionLink() {
  const [version, setVersion] = useState('');
  useEffect(() => {
    bridge()
      ?.version()
      .then(setVersion)
      .catch(() => undefined);
  }, []);
  if (!bridge()) return null;
  return (
    <button className="version-link" onClick={checkForUpdates} title="Güncellemeleri denetle">
      <Icon name="refresh" /> {version ? `Sürüm ${version} · ` : ''}Güncelle
    </button>
  );
}
