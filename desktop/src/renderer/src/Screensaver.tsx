import { useEffect, useRef, useState } from 'react';
import type { Go, View } from './App';
import { Icon, type IconName } from './ui';

// Ekran koruyucu: program bir süre kullanılmayınca Timay'ın modüllerini tanıtan
// hareketli bir ekran açılır. Karttaki düğmeye basınca o modül açılır; boş yere
// tıklamak ya da bir tuşa basmak ekranı kapatır.

type Slide = { view: View['name']; icon: IconName; color: string; kicker: string; title: string; text: string; points: string[] };

export const SLIDES: Slide[] = [
  {
    view: 'ai', icon: 'spark', color: '#8b5cf6', kicker: 'Yapay zekâ',
    title: 'Hukuk asistanınız her an yanınızda',
    text: 'Sorunuzu yazın; dayanaklı cevap, dilekçe taslağı ve içtihat değerlendirmesi saniyeler içinde.',
    points: ['Dilekçe taslağı', 'İçtihat lehte / aleyhte', 'İnfaz hesabı'],
  },
  {
    view: 'templates', icon: 'check', color: '#16a34a', kicker: 'Onaylı dilekçe',
    title: 'Her dilekçe ikinci bir avukatın onayından geçer',
    text: 'Teyit, her dayanağı kaynağıyla karşılaştırır. Kırmızı uyarı varken dilekçe onaylanamaz.',
    points: ['10 hukuk alanında şablon', 'Renkli Teyit raporu', 'Onay kaydı'],
  },
  {
    view: 'decisions', icon: 'scale', color: '#2563eb', kicker: 'Yargıtay kararları',
    title: 'Emsal karar, tek aramada önünüzde',
    text: 'Yargıtay kararlarını arayın, tam metniyle büro arşivinize ekleyin, dilekçenize bağlayın.',
    points: ['Daire ve yıl filtresi', 'Tam metin arşiv', 'Olaydan emsal'],
  },
  {
    view: 'cases', icon: 'folder', color: '#0ea5e9', kicker: 'Dava dosyaları',
    title: 'Bütün dosyalarınız tek ekranda',
    text: 'UYAP .udf, PDF, Word ve taranmış belgeler okunur; safahat, süreler ve özet kendiliğinden çıkar.',
    points: ['Türkçe OCR', 'Safahat ve özet', 'Toplu güncelleme'],
  },
  {
    view: 'contracts', icon: 'contract', color: '#f59e0b', kicker: 'Sözleşme zırhı',
    title: 'Riskli maddeyi imzadan önce görün',
    text: 'Her madde içtihatla karşılaştırılır; taraflara göre risk, fesih ve yenileme tarihleri izlenir.',
    points: ['Madde madde risk', 'Kat karşılığı inşaat', 'Toplu sözleşme analizi'],
  },
  {
    view: 'deadlines', icon: 'shield', color: '#ef4444', kicker: 'Süreler ve riskler',
    title: 'Hiçbir süreyi kaçırmayın',
    text: 'Tebligattan itibaren süreler otomatik hesaplanır, yaklaşan günler ajandanıza düşer.',
    points: ['Tebligat 5 gün kuralı', 'Duruşma ajandası', 'Hatırlatmalar'],
  },
  {
    view: 'enforcement', icon: 'gavel', color: '#14b8a6', kicker: 'İcra takibi',
    title: 'Takipten tahsilata tüm icra süreci',
    text: 'Dosya, haciz, faiz ve tahsilat tek yerde; masraf ve vekâlet ücreti muhasebeye işlenir.',
    points: ['Faiz hesabı', 'Haciz kayıtları', 'Tahsilat takibi'],
  },
  {
    view: 'mediation', icon: 'users', color: '#ec4899', kicker: 'Arabuluculuk',
    title: 'Arabuluculuk dosyası ve 2026 tarifesi',
    text: 'Toplantılar, tutanaklar ve ücret hesabı güncel tarifeyle otomatik.',
    points: ['2026 ücret tarifesi', 'Toplantı takibi', 'Anlaşma tutanağı'],
  },
  {
    view: 'finance', icon: 'wallet', color: '#22c55e', kicker: 'Büro muhasebesi',
    title: 'Büronuzun parası kuruşu kuruşuna',
    text: 'Zaman takibi faturaya, masraf dosyaya, tahsilat müvekkile bağlanır.',
    points: ['Zaman takibi', 'Masraf ve avans', 'Müvekkil ekstresi'],
  },
  {
    view: 'calculators', icon: 'calc', color: '#6366f1', kicker: 'Hesaplayıcılar',
    title: 'Faiz, harç, kıdem, infaz: hepsi hazır',
    text: 'Günlük işlerin hesapları tek tıkla, kaynağı ve formülüyle birlikte.',
    points: ['Faiz ve harç', 'İşçilik alacakları', 'İnfaz hesabı'],
  },
];

const KEY = 'timay-ekran-koruyucu';
export const SAVER_OPTIONS = [0, 1, 3, 5, 10, 15];
export function saverMinutes() {
  try {
    const v = localStorage.getItem(KEY);
    return v === null ? 3 : Number(v) || 0;
  } catch {
    return 3;
  }
}
function setSaverMinutes(n: number) {
  try {
    localStorage.setItem(KEY, String(n));
  } catch {
    /* tarayıcı izin vermezse varsayılan kalır */
  }
}

const SLIDE_MS = 8000;
const SHOW = 'timay-ekran-koruyucu-goster';
/** Tanıtım ekranını hemen açar (ör. müvekkile göstermek için). */
export function showScreensaver() {
  window.dispatchEvent(new Event(SHOW));
}

const INTRO_MS = 11000;
const INTRO_WORDS = ['Dilekçe', 'Yargıtay içtihadı', 'Dava dosyası', 'Sözleşme', 'İcra', 'Arabuluculuk', 'Muhasebe'];

/** "Timay Platform · Hukuk Yazılımı" açılış animasyonu (reklam). */
export function BrandIntro() {
  return (
    <section className="intro" onClick={(e) => e.stopPropagation()}>
      <div className="intro-rings" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
      <div className="intro-logo">
        <span className="intro-mark">T</span>
        <svg className="intro-scale" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 3v18M7 21h10M5 7h14M5 7l-3 7a3 3 0 006 0L5 7zM19 7l-3 7a3 3 0 006 0l-3-7z" />
        </svg>
      </div>
      <h1 className="intro-title">
        {['TIMAY', 'PLATFORM'].map((word, w) => (
          <span key={word} className="intro-word">
            {word.split('').map((ch, k) => (
              <span key={k} style={{ animationDelay: `${0.9 + (w * 6 + k) * 0.06}s` }}>
                {ch}
              </span>
            ))}
          </span>
        ))}
      </h1>
      <div className="intro-sub">HUKUK YAZILIMI</div>
      <div className="intro-line" />
      <p className="intro-tag">Yapay zekâ yazar, avukat onaylar.</p>
      <div className="intro-words">
        {INTRO_WORDS.map((w, k) => (
          <span key={w} style={{ animationDelay: `${4.2 + k * 0.35}s` }}>
            {w}
          </span>
        ))}
      </div>
      <div className="intro-site">timayplatform.com</div>
    </section>
  );
}

const LOCK_KEY = 'timay-ekran-kilit';
function lockOnClose() {
  try {
    return localStorage.getItem(LOCK_KEY) !== '0';
  } catch {
    return true;
  }
}

export function Screensaver({ go, ad = false, system = false }: { go: Go; ad?: boolean; system?: boolean }) {
  const [open, setOpen] = useState(ad);
  const [lock, setLock] = useState(lockOnClose);
  const [win, setWin] = useState<{ available: boolean; enabled: boolean } | null>(null);

  // Windows ekran koruyucusu olarak: dokununca kapan.
  useEffect(() => {
    if (!system) return;
    const start = Date.now();
    let first: { x: number; y: number } | null = null;
    const quit = () => {
      if (Date.now() - start > 1000) window.close();
    };
    const move = (e: MouseEvent) => {
      if (!first) first = { x: e.screenX, y: e.screenY };
      else if (Math.abs(e.screenX - first.x) + Math.abs(e.screenY - first.y) > 12) quit();
    };
    window.addEventListener('mousemove', move);
    for (const ev of ['mousedown', 'keydown', 'wheel', 'touchstart'] as const) window.addEventListener(ev, quit);
    document.body.style.cursor = 'none';
  }, [system]);

  useEffect(() => {
    if (open && !ad) void window.timay?.saver?.status().then(setWin).catch(() => undefined);
  }, [open, ad]);
  const [minutes, setMinutes] = useState(saverMinutes);
  // -1: açılış animasyonu, 0..: modül slaytları
  const [step, setStep] = useState(-1);
  const [now, setNow] = useState(new Date());
  const last = useRef(Date.now());

  // Hareketsizlik sayacı
  useEffect(() => {
    if (ad) return;
    const touch = () => {
      last.current = Date.now();
    };
    const show = () => {
      setStep(-1);
      setOpen(true);
    };
    window.addEventListener(SHOW, show);
    const events = ['mousemove', 'mousedown', 'keydown', 'wheel', 'touchstart'] as const;
    for (const e of events) window.addEventListener(e, touch, { passive: true });
    const t = window.setInterval(() => {
      if (minutes > 0 && !open && Date.now() - last.current >= minutes * 60_000) {
        setStep(-1);
        setOpen(true);
      }
    }, 5000);
    return () => {
      for (const e of events) window.removeEventListener(e, touch);
      window.removeEventListener(SHOW, show);
      window.clearInterval(t);
    };
  }, [minutes, open, ad]);

  // Sahne geçişi: açılış → modüller → açılış …
  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => setStep((x) => (x + 1 >= SLIDES.length ? -1 : x + 1)), step < 0 ? INTRO_MS : SLIDE_MS);
    return () => window.clearTimeout(t);
  }, [open, step]);

  useEffect(() => {
    if (!open) return;
    const c = window.setInterval(() => setNow(new Date()), 1000);
    const key = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') setStep((x) => (x + 1 >= SLIDES.length ? -1 : x + 1));
      else if (e.key === 'ArrowLeft') setStep((x) => (x <= -1 ? SLIDES.length - 1 : x - 1));
      else if (!ad) close();
    };
    window.addEventListener('keydown', key);
    return () => {
      window.clearInterval(c);
      window.removeEventListener('keydown', key);
    };
  }, [open, ad]);

  const close = (lockScreen = true) => {
    if (ad) return;
    last.current = Date.now();
    setOpen(false);
    // Kapanınca Windows kilitlenir: geri dönmek için Windows şifresi gerekir.
    if (lockScreen && lockOnClose()) void window.timay?.saver?.lock();
  };

  if (!open) return null;
  const s = step >= 0 ? SLIDES[step] : null;
  const color = s?.color ?? '#c9a24a';
  const time = now.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
  const date = now.toLocaleDateString('tr-TR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  return (
    <div className={`saver${ad ? ' saver-ad' : ''}`} onClick={() => close()} style={{ ['--saver-c' as string]: color }}>
      <div className="saver-bg" aria-hidden="true">
        <span className="orb o1" />
        <span className="orb o2" />
        <span className="orb o3" />
        <span className="grid" />
      </div>

      {s && (
        <header className="saver-top">
          <div className="saver-brand">
            <span className="logo-mark">T</span>
            <span>
              <strong>Timay Platform</strong>
              <small>Hukuk Yazılımı · Avukat onaylı yapay zekâ</small>
            </span>
          </div>
          <div className="saver-clock">
            <strong>{time}</strong>
            <small>{date}</small>
          </div>
        </header>
      )}

      {!s ? (
        <BrandIntro key="intro" />
      ) : (
        <section key={step} className="saver-card" onClick={(e) => e.stopPropagation()}>
          <div className="saver-icon">
            <Icon name={s.icon} />
          </div>
          <div className="saver-body">
            <span className="saver-kicker">{s.kicker}</span>
            <h1>{s.title}</h1>
            <p>{s.text}</p>
            <ul>
              {s.points.map((p) => (
                <li key={p}>
                  <Icon name="check" /> {p}
                </li>
              ))}
            </ul>
            {!ad && (
              <button
                className="saver-cta"
                onClick={() => {
                  close();
                  go({ name: s.view } as View);
                }}
              >
                {s.kicker} modülünü aç →
              </button>
            )}
          </div>
          <div className="saver-progress" key={`p${step}`} />
        </section>
      )}

      <nav className="saver-dots" onClick={(e) => e.stopPropagation()}>
        <button className={step < 0 ? 'on' : ''} onClick={() => setStep(-1)} title="Timay Platform" />
        {SLIDES.map((x, k) => (
          <button key={x.view} className={k === step ? 'on' : ''} onClick={() => setStep(k)} title={x.kicker} />
        ))}
      </nav>

      {!ad && (
        <footer className="saver-foot" onClick={(e) => e.stopPropagation()}>
          <span>Devam etmek için boş bir yere tıklayın veya bir tuşa basın</span>
          <label>
            Ekran koruyucu:{' '}
            <select
              value={minutes}
              onChange={(e) => {
                const n = Number(e.target.value);
                setMinutes(n);
                setSaverMinutes(n);
                if (!n) close(false);
              }}
            >
              {SAVER_OPTIONS.map((n) => (
                <option key={n} value={n}>
                  {n ? `${n} dakika sonra` : 'Kapalı'}
                </option>
              ))}
            </select>
          </label>
          {window.timay?.saver && (
            <label>
              <input
                type="checkbox"
                checked={lock}
                onChange={(e) => {
                  setLock(e.target.checked);
                  try {
                    localStorage.setItem(LOCK_KEY, e.target.checked ? '1' : '0');
                  } catch {
                    /* yok say */
                  }
                }}
              />{' '}
              Kapanınca Windows şifresi sorulsun
            </label>
          )}
          {win?.available && (
            <label>
              <input type="checkbox" checked={win.enabled} onChange={(e) => void window.timay?.saver?.set(e.target.checked).then(setWin)} />{' '}
              Windows ekran koruyucusu
            </label>
          )}
        </footer>
      )}
    </div>
  );
}
