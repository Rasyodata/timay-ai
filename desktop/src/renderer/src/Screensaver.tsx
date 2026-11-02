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
export const SAVER_OPTIONS = [0, 2, 5, 10, 15];
export function saverMinutes() {
  try {
    const v = localStorage.getItem(KEY);
    return v === null ? 5 : Number(v) || 0;
  } catch {
    return 5;
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

export function Screensaver({ go }: { go: Go }) {
  const [open, setOpen] = useState(false);
  const [minutes, setMinutes] = useState(saverMinutes);
  const [i, setI] = useState(0);
  const [now, setNow] = useState(new Date());
  const last = useRef(Date.now());

  // Hareketsizlik sayacı
  useEffect(() => {
    const touch = () => {
      last.current = Date.now();
    };
    const show = () => {
      setI(0);
      setOpen(true);
    };
    window.addEventListener(SHOW, show);
    const events = ['mousemove', 'mousedown', 'keydown', 'wheel', 'touchstart'] as const;
    for (const e of events) window.addEventListener(e, touch, { passive: true });
    const t = window.setInterval(() => {
      if (minutes > 0 && !open && Date.now() - last.current >= minutes * 60_000) {
        setI(Math.floor(Math.random() * SLIDES.length));
        setOpen(true);
      }
    }, 5000);
    return () => {
      for (const e of events) window.removeEventListener(e, touch);
      window.removeEventListener(SHOW, show);
      window.clearInterval(t);
    };
  }, [minutes, open]);

  // Slayt ve saat
  useEffect(() => {
    if (!open) return;
    const s = window.setInterval(() => setI((x) => (x + 1) % SLIDES.length), SLIDE_MS);
    const c = window.setInterval(() => setNow(new Date()), 1000);
    const key = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') setI((x) => (x + 1) % SLIDES.length);
      else if (e.key === 'ArrowLeft') setI((x) => (x - 1 + SLIDES.length) % SLIDES.length);
      else close();
    };
    window.addEventListener('keydown', key);
    return () => {
      window.clearInterval(s);
      window.clearInterval(c);
      window.removeEventListener('keydown', key);
    };
  }, [open]);

  const close = () => {
    last.current = Date.now();
    setOpen(false);
  };

  if (!open) return null;
  const s = SLIDES[i];
  const time = now.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
  const date = now.toLocaleDateString('tr-TR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  return (
    <div className="saver" onClick={close} style={{ ['--saver-c' as string]: s.color }}>
      <div className="saver-bg" aria-hidden="true">
        <span className="orb o1" />
        <span className="orb o2" />
        <span className="orb o3" />
        <span className="grid" />
      </div>

      <header className="saver-top">
        <div className="saver-brand">
          <span className="logo-mark">T</span>
          <span>
            <strong>Timay</strong>
            <small>Avukat onaylı yapay zekâ hukuk programı</small>
          </span>
        </div>
        <div className="saver-clock">
          <strong>{time}</strong>
          <small>{date}</small>
        </div>
      </header>

      <section key={i} className="saver-card" onClick={(e) => e.stopPropagation()}>
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
          <button
            className="saver-cta"
            onClick={() => {
              close();
              go({ name: s.view } as View);
            }}
          >
            {s.kicker} modülünü aç →
          </button>
        </div>
        <div className="saver-progress" key={`p${i}`} />
      </section>

      <nav className="saver-dots" onClick={(e) => e.stopPropagation()}>
        {SLIDES.map((x, k) => (
          <button key={x.view} className={k === i ? 'on' : ''} onClick={() => setI(k)} title={x.kicker} />
        ))}
      </nav>

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
              if (!n) close();
            }}
          >
            {SAVER_OPTIONS.map((n) => (
              <option key={n} value={n}>
                {n ? `${n} dakika sonra` : 'Kapalı'}
              </option>
            ))}
          </select>
        </label>
      </footer>
    </div>
  );
}
