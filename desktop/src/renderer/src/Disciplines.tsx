import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { api } from './api';
import { ErrorText, Icon } from './ui';

/*
 * 10 ajanlı inceleme ekranı: belge on ayrı gözle okunur.
 * 1 Avukat, 2 Savcı, 3 Hâkim, 4 Karşı Taraf, 5 Bilirkişi, 6 Süre, 7 Delil, 8 Mevzuat, 9 İçtihat;
 * 10. Baş Ajan hepsini birleştirip önce neyin düzeltileceğini söyler.
 * Standart analiz kurallarla anında çalışır; derin analizde yapay zekâ her ajanın gözüyle ayrıca okur.
 * Her ajan çalışırken neyi kontrol ettiği ekranda adım adım görünür.
 */

type Level = 'iyi' | 'uyari' | 'kritik';
export type Analysis = 'standart' | 'derin';
export type Side = 'biz' | 'karsi';

export interface DocKind {
  id: string;
  label: string;
}

interface Finding {
  level: Level;
  text: string;
  basis?: string;
  quote?: string;
  ai?: boolean;
  verified?: boolean;
}

interface Discipline {
  no: number;
  id: string;
  title: string;
  lens: string;
  score: number;
  findings: Finding[];
}

export interface DisciplineReview {
  kind: string;
  kindLabel: string;
  disciplines: Discipline[];
  summary: {
    score: number;
    verdict: 'hazir' | 'duzeltme' | 'ciddi';
    verdictLabel: string;
    critical: number;
    warnings: number;
    priorities: (Finding & { discipline: string })[];
  };
  ai: boolean;
  analysis: Analysis;
  side: Side;
  note?: string;
  elapsedMs?: number;
}

export const DOC_KIND_OPTIONS: DocKind[] = [
  { id: 'dava', label: 'Dava dilekçesi' },
  { id: 'cevap', label: 'Davaya cevap' },
  { id: 'icra', label: 'İcra takip talebi' },
  { id: 'ihtarname', label: 'İhtarname' },
  { id: 'ihtar_cevap', label: 'İhtara cevap' },
  { id: 'itiraz', label: 'İtiraz dilekçesi' },
  { id: 'kanun_yolu', label: 'İstinaf / temyiz' },
];

/* ---------- Ajanlar: ad, ikon, renk ve kontrol adımları ---------- */

export interface AgentMeta {
  id: string;
  title: string;
  lens: string;
  color: string;
  icon: string;
  steps: string[];
}

export const AGENTS: AgentMeta[] = [
  {
    id: 'avukat',
    title: 'Avukat Ajanı',
    lens: 'Müvekkilin bütün hakları istendi mi, aleyhe bir şey yazıldı mı?',
    color: '#2552c8',
    icon: 'M3 8h18v12H3zM8 8V5h8v3M3 13h18M11 13v2h2v-2',
    steps: ['Talepler tek tek okunuyor', 'Fazlaya ilişkin haklar aranıyor', 'Müvekkil aleyhine ifade taranıyor'],
  },
  {
    id: 'savci',
    title: 'Savcı Ajanı',
    lens: 'Olayda suç var mı, ceza boyutu müvekkili nasıl etkiler?',
    color: '#6b46c1',
    icon: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6zM12 8v5M12 16v.5',
    steps: ['Suç unsuru taranıyor', 'TCK karşılıkları eşleştiriliyor', 'Ceza boyutu değerlendiriliyor'],
  },
  {
    id: 'hakim',
    title: 'Hâkim Ajanı',
    lens: 'Usul ve şekil şartları tam mı, karar verilebilir mi?',
    color: '#0f1d33',
    icon: 'M14 4l6 6M11 7l6 6M8 10l5-5 6 6-5 5zM10 12l-7 7M3 21h10',
    steps: ['HMK 119 unsurları sayılıyor', 'Görev ve yetki kontrol ediliyor', 'Sonuç ve istem okunuyor'],
  },
  {
    id: 'karsi',
    title: 'Karşı Taraf Ajanı',
    lens: 'Karşı taraf avukatı nereden saldırır, hangi iddia çürütülür?',
    color: '#c0352b',
    icon: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 1v5M12 18v5M1 12h5M18 12h5',
    steps: ['Belirsiz ifadeler aranıyor', 'Zamanaşımı itirazı deneniyor', 'Çürütülebilir iddialar işaretleniyor'],
  },
  {
    id: 'bilirkisi',
    title: 'Bilirkişi Ajanı',
    lens: 'Tutarlar, faiz ve hesaplar tutarlı mı?',
    color: '#0e7c86',
    icon: 'M6 3h12v18H6zM9 7h6M9 12h.01M12 12h.01M15 12h.01M9 16h.01M12 16h.01M15 16h.01',
    steps: ['Tutarlar toplanıyor', 'Faiz ve hesap tutarlılığı', 'Dava değeriyle karşılaştırılıyor'],
  },
  {
    id: 'sure',
    title: 'Süre Ajanı',
    lens: 'Arabuluculuk, zamanaşımı, hak düşürücü süreler, dava şartları',
    color: '#a86b00',
    icon: 'M6 3h12M6 21h12M7 3v3l5 6-5 6v3M17 3v3l-5 6 5 6v3',
    steps: ['Arabuluculuk şartı kontrol ediliyor', 'Zamanaşımı hesaplanıyor', 'Hak düşürücü süreler sayılıyor'],
  },
  {
    id: 'delil',
    title: 'Delil Ajanı',
    lens: 'Her iddia delille desteklendi mi, ekler tam mı?',
    color: '#17824a',
    icon: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM21 21l-5-5M8 11l2 2 4-4',
    steps: ['Deliller bölümü aranıyor', 'Tanıklar ve ekler sayılıyor', 'İddia–delil eşleşmesi yapılıyor'],
  },
  {
    id: 'mevzuat',
    title: 'Mevzuat Ajanı',
    lens: 'Kanun maddeleri var mı, değişmiş mi, güncel mi?',
    color: '#1d43a8',
    icon: 'M5 4h10a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3zM5 17a3 3 0 0 1 3-3h10M9 8h5',
    steps: ['Kanun atıfları çıkarılıyor', 'Madde numaraları doğrulanıyor', 'Değişiklik kayıtları karşılaştırılıyor'],
  },
  {
    id: 'ictihat',
    title: 'İçtihat Ajanı',
    lens: 'Yargıtay kararları arşivde var mı, künyeler doğru mu?',
    color: '#8a4b14',
    icon: 'M4 4h4v16H4zM10 4h4v16h-4zM16 5l3.5-1 3 15.5-3.5 1z',
    steps: ['Yargıtay künyeleri çıkarılıyor', 'Karar arşivinde aranıyor', 'Uydurma künye kontrolü yapılıyor'],
  },
  {
    id: 'genel',
    title: 'Baş Ajan',
    lens: 'Dokuz ajanın bulgularını birleştirir, önce neyin düzeltileceğini söyler.',
    color: '#c9a45c',
    icon: 'M3 8l4 4 5-7 5 7 4-4-2 11H5zM5 22h14',
    steps: ['Bulgular birleştiriliyor', 'Öncelik sırası çıkarılıyor', 'Güven puanı hesaplanıyor'],
  },
];

export function AgentIcon({ agent, size = 22 }: { agent: AgentMeta; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={agent.icon} />
    </svg>
  );
}

/** Diğer modüllerde (dava, sözleşme, icra) ajanların kontrol adımları. */
export type AgentModule = 'dilekce' | 'dava' | 'sozlesme' | 'grup' | 'icra';
const CONTRACT_STEPS: Record<string, string[]> = {
  avukat: ['Lehe / aleyhe maddeler ayrılıyor', 'Taahhütler okunuyor', 'Eksik koruyucu maddeler aranıyor'],
  savci: ['Cezai sorumluluk doğuran maddeler', 'Sahtecilik / güveni kötüye kullanma riski', 'Yasak işlem kontrolü'],
  hakim: ['Şekil şartı (yazılı / resmî)', 'Geçerlilik ve ehliyet', 'Yetkili mahkeme / tahkim'],
  karsi: ['Karşı tarafın kaçış maddeleri', 'Tek taraflı fesih hakları', 'Yorum riskleri'],
  bilirkisi: ['Bedel ve ödeme planı', 'Cezai şart ve faiz', 'Kur ve endeksleme'],
  sure: ['Başlangıç ve bitiş tarihleri', 'Fesih bildirim süreleri', 'Gecikmiş taahhütler'],
  delil: ['İmza ve ekler', 'Teslim tutanakları', 'Bildirim yolları (noter, KEP)'],
  mevzuat: ['TBK / TTK maddeleri', 'Emredici hükümler', 'Mevzuat değişiklikleri'],
  ictihat: ['Benzer Yargıtay kararları', 'Lehte / aleyhte içtihat', 'Cezai şart indirimi kararları'],
};
export const MODULE_STEPS: Partial<Record<AgentModule, Record<string, string[]>>> = {
  dava: {
    avukat: ['Müvekkil bilgileri okunuyor', 'Talepler ve strateji gözden geçiriliyor', 'Vekâletname kontrol ediliyor'],
    savci: ['Olaylarda suç unsuru taranıyor', 'Ceza boyutu değerlendiriliyor', 'Şikâyet süresi kontrol ediliyor'],
    hakim: ['Mahkeme ve esas no kontrol ediliyor', 'Taraf bilgileri sayılıyor', 'Usul eksikleri aranıyor'],
    karsi: ['Karşı tarafın itirazları öngörülüyor', 'Zayıf iddialar işaretleniyor', 'Cevap riskleri tartılıyor'],
    bilirkisi: ['Dava değeri ve harç', 'Alacak hesapları', 'Masraf ve gider avansı'],
    sure: ['Duruşma tarihleri', 'Kesin süreler', 'Zamanaşımı ve arabuluculuk'],
    delil: ['Dosyadaki belgeler sayılıyor', 'Delil–iddia eşleşmesi', 'Eksik ekler aranıyor'],
    mevzuat: ['Dayanak kanunlar', 'Madde güncelliği', 'Mevzuat değişiklik kayıtları'],
    ictihat: ['Dilekçelerdeki künyeler', 'Karar arşivinde arama', 'Emsal ihtiyacı'],
  },
  sozlesme: CONTRACT_STEPS,
  grup: CONTRACT_STEPS,
  icra: {
    avukat: ['Tahsil imkânları değerlendiriliyor', 'Sorgu sonuçları okunuyor', 'Sonraki adım öneriliyor'],
    savci: ['Mal kaçırma şüphesi', 'Karşılıksız çek / suç boyutu', 'Şikâyet yolları'],
    hakim: ['Borçlu kimlik ve adres', 'Takip türü ve dayanak', 'Usul eksikleri'],
    karsi: ['Borçlu itirazları', 'İtirazın iptali / kaldırılması', 'Şikâyet riskleri'],
    bilirkisi: ['Asıl alacak ve faiz', 'Masraf ve vekâlet ücreti', 'Kalan borç hesabı'],
    sure: ['Haciz isteme süresi (İİK 78)', 'Hareketsizlik süresi', 'İtiraz süreleri'],
    delil: ['Mal varlığı sorguları', 'Sorgu tarihleri', 'Tebligat belgeleri'],
    mevzuat: ['İİK maddeleri', 'Faiz mevzuatı (3095)', 'Güncel değişiklikler'],
    ictihat: ['İlam ve kesinleşme', 'İcra hukuk kararları', 'Emsal kontrolü'],
  },
};
const stepsOf = (a: AgentMeta, module?: AgentModule) => MODULE_STEPS[module ?? 'dilekce']?.[a.id] ?? a.steps;

const ANALYSIS_KEY = 'timay-analiz';
/** Kullanıcının son seçtiği analiz türü (bu bilgisayarda hatırlanır). */
export function useAnalysis(): [Analysis, (a: Analysis) => void] {
  const [a, setA] = useState<Analysis>(() => {
    try {
      return localStorage.getItem(ANALYSIS_KEY) === 'derin' ? 'derin' : 'standart';
    } catch {
      return 'standart';
    }
  });
  return [
    a,
    (v) => {
      setA(v);
      try {
        localStorage.setItem(ANALYSIS_KEY, v);
      } catch {
        /* yok say */
      }
    },
  ];
}

/* ---------- Standart / Derin Analiz seçici ---------- */

export function AnalysisSwitch({ value, onChange, aiEnabled, compact }: { value: Analysis; onChange: (a: Analysis) => void; aiEnabled?: boolean; compact?: boolean }) {
  return (
    <div className={`analysis-switch ${compact ? 'compact' : ''}`} role="radiogroup" aria-label="Analiz türü">
      <button type="button" role="radio" aria-checked={value === 'standart'} className={value === 'standart' ? 'on' : ''} onClick={() => onChange('standart')}>
        <Icon name="clock" />
        <span>
          <strong>Standart Analiz</strong>
          {!compact && <small>Hızlı yanıt</small>}
        </span>
      </button>
      <button
        type="button"
        role="radio"
        aria-checked={value === 'derin'}
        className={value === 'derin' ? 'on derin' : ''}
        onClick={() => onChange('derin')}
        title={aiEnabled === false ? 'Yapay zekâ bağlanınca 10 ajan ayrıca yapay zekâyla okur; şimdilik kurallarla çalışır.' : '10 ajan her konuyu ayrı ayrı denetler'}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M6 3h12M6 21h12M7 3v3l5 6-5 6v3M17 3v3l-5 6 5 6v3" />
        </svg>
        <span>
          <strong>Derin Analiz</strong>
          {!compact && <small>10 ajan denetler</small>}
        </span>
      </button>
    </div>
  );
}

/* ---------- Kısa ajan şeridi: yapay zekâ yazarken ajanların sırayla çalıştığını gösterir ---------- */

export function AgentStrip({ label = 'Ajan kurulu çalışıyor' }: { label?: string }) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 700);
    return () => clearInterval(t);
  }, []);
  // Her ajan 3 adım çalışır; ilk tur bitince Baş Ajan birleştirmeyi sürdürür.
  const pos = Math.min(tick, AGENTS.length * 3 - 1);
  const active = Math.floor(pos / 3);
  const agent = AGENTS[active];
  const step = active === AGENTS.length - 1 ? tick % 3 : pos % 3;
  return (
    <div className="agent-strip" aria-live="polite">
      <div className="agent-strip-row">
        {AGENTS.map((a, i) => (
          <span
            key={a.id}
            className={`agent-chip ${i < active ? 'done' : i === active ? 'run' : ''}`}
            style={{ '--agent': a.color } as CSSProperties}
            title={`${i + 1}. ${a.title}`}
          >
            <AgentIcon agent={a} size={16} />
            {i < active && <i className="agent-chip-ok">✓</i>}
          </span>
        ))}
      </div>
      <div className="agent-strip-text">
        <strong>{label}</strong> · {active + 1}/10 <span style={{ color: agent.color }}>{agent.title}</span>: {agent.steps[step]}…
      </div>
      <div className="agent-strip-bar">
        <span style={{ width: `${((pos + 1) / (AGENTS.length * 3)) * 100}%` }} />
      </div>
    </div>
  );
}

/* ---------- Tam ekran 10 ajanlı inceleme ---------- */

const LEVEL_ICON = { iyi: 'check', uyari: 'clock', kritik: 'alert' } as const;
const TICK_MS = 230;
const PER_AGENT = 4; // 3 kontrol adımı + sonuç

function band(score: number): Level {
  return score >= 80 ? 'iyi' : score >= 50 ? 'uyari' : 'kritik';
}

export function runDisciplines(input: { body: string; title?: string; kind?: string; caseId?: number | null; analysis?: Analysis; side?: Side }) {
  return api<DisciplineReview>('/disciplines', { body: input });
}

/** Tam ekran inceleme. body boşsa ajanların neye bakacağını gösterir. */
export function DisciplineScreen({
  body,
  title,
  caseId,
  initialKind,
  initialAnalysis,
  initialSide = 'biz',
  allowSide,
  onClose,
  onContinue,
  continueLabel,
  runner,
  module,
  heading,
}: {
  body: string;
  title?: string;
  caseId?: number | null;
  initialKind?: string;
  initialAnalysis?: Analysis;
  initialSide?: Side;
  allowSide?: boolean;
  onClose: () => void;
  onContinue?: () => void;
  continueLabel?: string;
  /** Verilirse belge yerine bu çalıştırılır (dava, sözleşme, icra analizi). */
  runner?: (analysis: Analysis) => Promise<DisciplineReview>;
  module?: AgentModule;
  heading?: string;
}) {
  const [kind, setKind] = useState(initialKind ?? '');
  const [preferred] = useAnalysis();
  const [analysis, setAnalysis] = useState<Analysis>(initialAnalysis ?? preferred);
  const [side, setSide] = useState<Side>(initialSide);
  const [review, setReview] = useState<DisciplineReview | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const empty = !runner && !body.trim();
  const total = AGENTS.length * PER_AGENT;
  const holdAt = (AGENTS.length - 1) * PER_AGENT; // Baş Ajan sonuç gelene kadar bekler

  useEffect(() => {
    if (empty) return;
    let alive = true;
    setReview(null);
    setTick(0);
    setErr(null);
    (runner ? runner(analysis) : runDisciplines({ body, title, kind: kind || undefined, caseId, analysis, side }))
      .then((r) => {
        if (!alive) return;
        setReview(r);
        if (!kind && !runner) setKind(r.kind);
      })
      .catch((e) => alive && setErr((e as Error).message));
    return () => {
      alive = false;
    };
  }, [body, kind, analysis, side]);

  // Ajanlar sırayla çalışır; her biri kendi kontrol adımlarını tek tek işaretler.
  useEffect(() => {
    if (empty || err || tick >= total) return;
    const waiting = !review && tick >= holdAt + 2;
    const t = setTimeout(() => setTick((s) => (waiting ? holdAt : s + 1)), waiting ? 900 : TICK_MS);
    return () => clearTimeout(t);
  }, [review, tick, empty, err]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const done = !!review && tick >= total;
  const active = Math.min(Math.floor(tick / PER_AGENT), AGENTS.length - 1);
  const agentNow = AGENTS[active];
  const stepNow = Math.min(tick % PER_AGENT, 2);
  const elapsed = review?.elapsedMs != null ? (review.elapsedMs < 100 ? 'anında' : `${(review.elapsedMs / 1000).toFixed(1)} sn`) : null;
  const findings = useMemo(() => new Map(review?.disciplines.map((d) => [d.id, d]) ?? []), [review]);

  return (
    <div className="modal-backdrop disc-backdrop" onClick={onClose}>
      <div className="disc-screen" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="10 ajanlı inceleme">
        <div className="disc-head">
          <div>
            <h2>
              <span className="ajan-title-badge">10 Ajan</span> {heading ?? (side === 'karsi' ? 'Karşı taraf belgesi incelemesi' : 'Hukuki denetim')}
            </h2>
            <p className="muted small">
              {title || 'Belge'} · her ajan kendi gözüyle inceler, 10. Baş Ajan hepsini birleştirir.
            </p>
          </div>
          <div className="disc-head-actions">
            <AnalysisSwitch value={analysis} onChange={setAnalysis} compact />
            {allowSide && !runner && (
              <label className="disc-kind">
                <span className="muted small">Belge kimin?</span>
                <select value={side} onChange={(e) => setSide(e.target.value as Side)}>
                  <option value="biz">Bizim belgemiz</option>
                  <option value="karsi">Karşı tarafın belgesi / kararı</option>
                </select>
              </label>
            )}
            {!runner && (
            <label className="disc-kind">
              <span className="muted small">Belge türü</span>
              <select value={kind} onChange={(e) => setKind(e.target.value)}>
                {!kind && <option value="">Otomatik</option>}
                {DOC_KIND_OPTIONS.map((k) => (
                  <option key={k.id} value={k.id}>
                    {k.label}
                  </option>
                ))}
              </select>
            </label>
            )}
            <button className="ghost" onClick={onClose} aria-label="Kapat">
              Kapat
            </button>
          </div>
        </div>

        <ErrorText error={err} />

        {/* Ajan hattı: on ajan soldan sağa çalışır */}
        {!empty && (
          <div className="ajan-pipeline" aria-live="polite">
            <div className="ajan-pipe-row">
              {AGENTS.map((a, i) => {
                const st = done || i < active ? 'done' : i === active ? 'run' : 'wait';
                return (
                  <div key={a.id} className={`ajan-node n-${st}`} style={{ '--agent': a.color } as CSSProperties}>
                    <span className="ajan-node-icon">
                      <AgentIcon agent={a} size={18} />
                    </span>
                    <span className="ajan-node-no">{i + 1}</span>
                  </div>
                );
              })}
              <div className="ajan-pipe-line">
                <span style={{ width: `${(Math.min(tick, total) / total) * 100}%` }} />
              </div>
            </div>
            <div className="ajan-pipe-text small">
              {done ? (
                <>
                  <strong>10 ajan işini bitirdi.</strong> {review?.analysis === 'derin' ? 'Derin analiz (kurallar + yapay zekâ).' : 'Standart analiz (kurallar).'}
                  {elapsed && <span className="muted"> · {elapsed}</span>}
                </>
              ) : (
                <>
                  <strong style={{ color: agentNow.color }}>
                    {active + 1}/10 · {agentNow.title}
                  </strong>{' '}
                  {!review && active === AGENTS.length - 1 ? (analysis === 'derin' ? 'yapay zekâ ajanları metni okuyor…' : 'sonuçlar bekleniyor…') : `${stepsOf(agentNow, module)[stepNow].toLocaleLowerCase('tr')}…`}
                </>
              )}
              {!done && review && (
                <button className="link small" onClick={() => setTick(total)}>
                  Animasyonu geç
                </button>
              )}
            </div>
          </div>
        )}

        {review?.note && done && (
          <div className="callout warn" style={{ margin: '10px 22px 0' }}>
            <Icon name="alert" />
            <div className="small">{review.note}</div>
          </div>
        )}
        {review && done && review.side === 'karsi' && (
          <div className="callout" style={{ margin: '10px 22px 0' }}>
            <Icon name="shield" />
            <div className="small">Bu belge karşı tarafın. Kırmızı ve sarı bulgular karşı tarafın zayıf noktalarıdır; cevap dilekçenizde kullanın.</div>
          </div>
        )}

        {done && review && (
          <div className={`disc-verdict v-${review.summary.verdict}`}>
            <div className="disc-score">
              <strong>{review.summary.score}</strong>
              <span>/100</span>
            </div>
            <div className="disc-verdict-text">
              <strong>{review.summary.verdictLabel}</strong>
              <span>
                {review.summary.critical} kritik, {review.summary.warnings} uyarı{review.kindLabel ? ` · ${review.kindLabel}` : ''}
                {review.ai ? ' · yapay zekâ dahil' : ''}
              </span>
              {review.summary.priorities.length > 0 && (
                <ol className="disc-priorities">
                  {review.summary.priorities.slice(0, 5).map((p, i) => (
                    <li key={i} className={`l-${p.level}`}>
                      <span className="muted">{p.discipline}:</span> {p.text}
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </div>
        )}

        <div className="disc-grid ajan-grid">
          {AGENTS.map((a, i) => {
            const d = findings.get(a.id);
            const finished = !empty && (done || i < active) && !!review;
            const pending = !empty && i < active && !review;
            const running = !empty && !done && i === active;
            const state = empty ? 'idle' : finished ? 'done' : pending ? 'pending' : running ? 'running' : 'waiting';
            const b = finished && d ? band(d.score) : null;
            return (
              <section
                key={a.id}
                className={`disc-card ajan-card s-${state} ${b ? `b-${b}` : ''} ${a.id === 'genel' ? 'disc-general' : ''}`}
                style={{ '--agent': a.color, animationDelay: finished && done && tick === total ? `${i * 60}ms` : undefined } as CSSProperties}
              >
                {running && <span className="ajan-scan" aria-hidden="true" />}
                <div className="disc-card-head">
                  <span className={`ajan-badge ${running ? 'spin' : ''}`}>
                    <AgentIcon agent={a} />
                    {b && <i className={`ajan-badge-mark m-${b}`}>{b === 'iyi' ? '✓' : '!'}</i>}
                  </span>
                  <div className="disc-title">
                    <strong>
                      <span className="ajan-no">{i + 1}</span> {a.title}
                    </strong>
                    <span className="muted small">{a.lens}</span>
                  </div>
                  {state === 'waiting' && <span className="muted small">Sırada</span>}
                  {state === 'pending' && <span className="muted small">Okudu ✓</span>}
                  {finished && d && <span className={`disc-pill b-${b}`}>{d.score}</span>}
                </div>

                {(running || pending) && (
                  <ul className="ajan-steps">
                    {stepsOf(a, module).map((s, j) => {
                      const sd = pending || (running && (j < stepNow || (j === 2 && tick % PER_AGENT === 3)));
                      const sr = running && j === stepNow && !sd;
                      return (
                        <li key={s} className={sd ? 'ok' : sr ? 'run' : ''}>
                          <span className="ajan-step-mark">{sd ? '✓' : sr ? '' : '○'}</span>
                          {s}
                        </li>
                      );
                    })}
                  </ul>
                )}

                {finished && d && (
                  <>
                    <div className="ajan-checked small muted">✓ {a.steps.length} kontrol yapıldı{d.findings.some((f) => f.ai) ? ' · yapay zekâ okudu' : ''}</div>
                    <ul className="disc-findings">
                      {d.findings.map((f, j) => (
                        <li key={j} className={`l-${f.level}`}>
                          <Icon name={LEVEL_ICON[f.level]} />
                          <div>
                            <span>
                              {f.ai && <span className="ajan-ai-tag">YZ</span>}
                              {f.text}
                            </span>
                            {f.basis && <span className="disc-basis">{f.basis}</span>}
                            {f.quote && <q>{f.quote}</q>}
                            {f.ai && f.quote && f.verified === false && <span className="warn-text small">⚠ Bu alıntı metinde aynen bulunamadı, kontrol edin.</span>}
                          </div>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
                {state === 'idle' && (
                  <ul className="ajan-steps idle">
                    {stepsOf(a, module).map((s) => (
                      <li key={s}>
                        <span className="ajan-step-mark">○</span>
                        {s}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            );
          })}
        </div>

        <div className="disc-foot">
          <span className="muted small">
            {review?.ai
              ? 'Kurallar ve yapay zekâ birlikte inceledi. Son söz avukatındır.'
              : analysis === 'derin'
                ? 'Derin analiz yapay zekâ bağlıyken her ajanın gözüyle ayrıca okur.'
                : 'Standart analiz: kurallara dayalı, anında ve ücretsiz. Daha ayrıntılı inceleme için Derin Analiz’i seçin.'}
          </span>
          <div className="row">
            <button onClick={onClose}>{runner ? 'Kapat' : empty ? 'Yazmaya başla' : 'Düzeltmeye dön'}</button>
            {onContinue && done && (
              <button className={review?.summary.verdict === 'hazir' ? 'primary' : ''} onClick={onContinue}>
                {continueLabel ?? 'Devam et'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
