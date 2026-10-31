import { useEffect, useState } from 'react';
import { api } from './api';
import { ErrorText, Icon } from './ui';

/*
 * Çok disiplinli inceleme ekranı: belge sekiz ayrı gözle okunur.
 * 1 avukat, 2 savcı, 3 hâkim, 4 karşı taraf avukatı, 5 bilirkişi, 6 süre ve dava şartları,
 * 7 delil ve ispat; 8. disiplin hepsini birleştirip önce neyin düzeltileceğini söyler.
 */

type Level = 'iyi' | 'uyari' | 'kritik';

export interface DocKind {
  id: string;
  label: string;
}

interface Finding {
  level: Level;
  text: string;
  basis?: string;
  quote?: string;
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

const LENSES = [
  ['Avukat gözüyle', 'Müvekkilin bütün hakları istendi mi, aleyhe bir şey yazıldı mı?'],
  ['Savcı gözüyle', 'Olayda suç var mı, ceza boyutu müvekkili nasıl etkiler?'],
  ['Hâkim gözüyle', 'Usul ve şekil şartları tam mı, karar verilebilir mi?'],
  ['Karşı taraf avukatı gözüyle', 'Nereden saldırılır, hangi iddia çürütülür?'],
  ['Bilirkişi gözüyle', 'Tutarlar, faiz ve hesaplar tutarlı mı?'],
  ['Süre ve dava şartları', 'Arabuluculuk, zamanaşımı, hak düşürücü süreler'],
  ['Delil ve ispat', 'Her iddia delille desteklendi mi, ekler tam mı?'],
  ['Genel değerlendirme', 'Yedi disiplini birleştirir, önce neyin düzeltileceğini söyler.'],
];

const LEVEL_ICON = { iyi: 'check', uyari: 'clock', kritik: 'alert' } as const;

function band(score: number) {
  return score >= 80 ? 'iyi' : score >= 50 ? 'uyari' : 'kritik';
}

export function runDisciplines(input: { body: string; title?: string; kind?: string; caseId?: number | null }) {
  return api<DisciplineReview>('/disciplines', { body: input });
}

/** Tam ekran inceleme. body boşsa disiplinlerin neye bakacağını gösterir. */
export function DisciplineScreen({
  body,
  title,
  caseId,
  initialKind,
  onClose,
  onContinue,
  continueLabel,
}: {
  body: string;
  title?: string;
  caseId?: number | null;
  initialKind?: string;
  onClose: () => void;
  onContinue?: () => void;
  continueLabel?: string;
}) {
  const [kind, setKind] = useState(initialKind ?? '');
  const [review, setReview] = useState<DisciplineReview | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [step, setStep] = useState(0);
  const empty = !body.trim();

  useEffect(() => {
    if (empty) return;
    let alive = true;
    setReview(null);
    setStep(0);
    setErr(null);
    runDisciplines({ body, title, kind: kind || undefined, caseId })
      .then((r) => {
        if (!alive) return;
        setReview(r);
        if (!kind) setKind(r.kind);
      })
      .catch((e) => alive && setErr((e as Error).message));
    return () => {
      alive = false;
    };
  }, [body, kind]);

  // Disiplinler sırayla "çalışır": her biri kısa bir aralıkla açılır.
  useEffect(() => {
    if (!review || step >= 8) return;
    const t = setTimeout(() => setStep((s) => s + 1), step === 7 ? 1100 : 650);
    return () => clearTimeout(t);
  }, [review, step]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const done = review && step >= 8;
  const general = review?.disciplines[7];

  return (
    <div className="modal-backdrop disc-backdrop" onClick={onClose}>
      <div className="disc-screen" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Çok disiplinli inceleme">
        <div className="disc-head">
          <div>
            <h2>8 disiplinli inceleme</h2>
            <p className="muted small">{title || 'Belge'} · her disiplin metni kendi gözüyle okur, 8. disiplin hepsini birleştirir.</p>
          </div>
          <div className="disc-head-actions">
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
            <button className="ghost" onClick={onClose} aria-label="Kapat">
              Kapat
            </button>
          </div>
        </div>

        <ErrorText error={err} />
        {!empty && !done && (
          <div className="disc-progress" aria-live="polite">
            <div className="disc-progress-bar">
              <span style={{ width: `${(Math.min(step, 8) / 8) * 100}%` }} />
            </div>
            <span className="small">
              {review ? (
                <>
                  <strong>Disiplin {Math.min(step + 1, 8)}/8</strong> · {LENSES[Math.min(step, 7)][0]} {step === 7 ? 'tüm bulguları birleştiriyor…' : 'metni okuyor…'}
                </>
              ) : (
                'Metin hazırlanıyor…'
              )}
            </span>
          </div>
        )}

        {done && general && review && (
          <div className={`disc-verdict v-${review.summary.verdict}`}>
            <div className="disc-score">
              <strong>{review.summary.score}</strong>
              <span>/100</span>
            </div>
            <div className="disc-verdict-text">
              <strong>{review.summary.verdictLabel}</strong>
              <span>
                {review.summary.critical} kritik, {review.summary.warnings} uyarı · {review.kindLabel}
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

        <div className="disc-grid">
          {LENSES.map(([name, lens], i) => {
            const d = review?.disciplines[i];
            const shown = review && step > i;
            const state = empty ? 'idle' : shown ? 'done' : (review ? step === i : i === 0) ? 'running' : 'waiting';
            return (
              <section key={name} className={`disc-card s-${state} ${shown && d ? `b-${band(d.score)}` : ''} ${i === 7 ? 'disc-general' : ''}`}>
                <div className="disc-card-head">
                  <span className="disc-no">{i + 1}</span>
                  <div className="disc-title">
                    <strong>{name}</strong>
                    <span className="muted small">{lens}</span>
                  </div>
                  {state === 'running' && <span className="disc-spinner" aria-label="Çalışıyor" />}
                  {state === 'waiting' && <span className="muted small">Sırada</span>}
                  {shown && d && <span className={`disc-pill b-${band(d.score)}`}>{d.score}</span>}
                </div>
                {shown && d && (
                  <ul className="disc-findings">
                    {d.findings.map((f, j) => (
                      <li key={j} className={`l-${f.level}`}>
                        <Icon name={LEVEL_ICON[f.level]} />
                        <div>
                          <span>{f.text}</span>
                          {f.basis && <span className="disc-basis">{f.basis}</span>}
                          {f.quote && <q>{f.quote}</q>}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
                {state === 'idle' && <p className="muted small">Metin yazılınca bu disiplin çalışır.</p>}
                {state === 'running' && (
                  <div className="disc-reading" aria-hidden="true">
                    <span />
                    <span />
                    <span />
                  </div>
                )}
              </section>
            );
          })}
        </div>

        <div className="disc-foot">
          <span className="muted small">
            {review?.ai
              ? 'Yapay zekâ incelemesi dahil.'
              : 'Kurallara dayalı hızlı inceleme. Yapay zekâ bağlandığında her disiplin metni ayrıca okuyacak.'}
          </span>
          <div className="row">
            <button onClick={onClose}>{empty ? 'Yazmaya başla' : 'Düzeltmeye dön'}</button>
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
