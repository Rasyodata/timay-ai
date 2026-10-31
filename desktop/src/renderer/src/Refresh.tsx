import { useEffect, useState } from 'react';
import { api } from './api';
import type { Go } from './App';
import { ErrorText, Icon } from './ui';

/*
 * Güncelle: dosyanın analizini (risk, eksikler, uyarılar) programın bugünkü kurallarıyla yeniden çalıştırır.
 * Program güncellenince eski analizler "güncel değil" görünür; Güncelle'ye basınca farklar listelenir.
 */

export type Entity = 'case' | 'contract' | 'group';
type Level = 'yuksek' | 'orta' | 'dusuk';

interface Issue {
  key: string;
  level: Level;
  text: string;
}

interface RefreshResult {
  engine: string;
  at: string;
  current: { title: string; risk: number; band: Level; issues: Issue[] };
  previous: { engine: string; at: string; risk: number; band: Level } | null;
  changes: { riskDelta: number; added: Issue[]; resolved: Issue[] };
}

interface Status {
  engine: string;
  last: { engine: string; at: string; risk: number; band: Level; user_name: string; issues: number } | null;
  stale: boolean;
}

interface AllResult {
  count: number;
  added: number;
  resolved: number;
  changed: { entity: Entity; id: number; title: string; before: number | null; after: number; added: number; resolved: number }[];
}

const BAND_LABEL: Record<Level, string> = { dusuk: 'Düşük risk', orta: 'Orta risk', yuksek: 'Yüksek risk' };
const ENTITY_LABEL: Record<Entity, string> = { case: 'Dava', contract: 'Sözleşme', group: 'Sözleşme dosyası' };

/** SQLite "YYYY-MM-DD HH:MM:SS" (UTC) → yerel "31.10.2026 14:05". */
export function when(at: string) {
  const d = new Date(at.replace(' ', 'T') + 'Z');
  if (Number.isNaN(d.getTime())) return at;
  return d.toLocaleString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function Delta({ value }: { value: number }) {
  if (!value) return <span className="muted small">değişmedi</span>;
  return (
    <span className={`rf-delta ${value > 0 ? 'up' : 'down'}`}>
      {value > 0 ? '▲' : '▼'} {Math.abs(value)}
    </span>
  );
}

function IssueList({ items }: { items: Issue[] }) {
  return (
    <ul className="rf-issues">
      {items.map((i) => (
        <li key={i.key} className={`l-${i.level}`}>
          <span className={`rf-dot b-${i.level}`} />
          {i.text}
        </li>
      ))}
    </ul>
  );
}

/** Dosya sayfasının üstündeki şerit: son analiz, "güncel değil" uyarısı ve Güncelle düğmesi. */
export function RefreshBar({ entity, id, onDone }: { entity: Entity; id: number; onDone?: () => void }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [result, setResult] = useState<RefreshResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setResult(null);
    api<Status>(`/refresh/${entity}/${id}`)
      .then(setStatus)
      .catch(() => setStatus(null));
  }, [entity, id]);

  async function run() {
    setBusy(true);
    setErr(null);
    try {
      // Kısa bekleme: avukat analizin yeniden çalıştığını görsün.
      const [r] = await Promise.all([api<RefreshResult>(`/refresh/${entity}/${id}`, { method: 'POST' }), new Promise((ok) => setTimeout(ok, 700))]);
      setResult(r);
      setOpen(true);
      setStatus({ engine: r.engine, stale: false, last: { engine: r.engine, at: r.at, risk: r.current.risk, band: r.current.band, user_name: '', issues: r.current.issues.length } });
      onDone?.();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const last = status?.last;
  return (
    <div className={`rf-bar ${status?.stale ? 'stale' : ''} ${busy ? 'busy' : ''}`}>
      <div className="rf-line">
        <Icon name="refresh" />
        <div className="rf-text">
          {busy ? (
            <strong>Analiz yeniden çalışıyor: riskler, eksikler, süreler…</strong>
          ) : !last ? (
            <strong>Bu dosya henüz güncellenmedi.</strong>
          ) : status?.stale ? (
            <strong>Program güncellendi; bu dosyanın analizi eski kurallarla yapılmış.</strong>
          ) : (
            <strong>
              Analiz güncel · {BAND_LABEL[last.band]} ({last.risk}/100) · {last.issues} uyarı
            </strong>
          )}
          <span className="muted small">
            {last ? `Son güncelleme ${when(last.at)}${last.user_name ? ` · ${last.user_name}` : ''}` : 'Güncelle\'ye basınca riskler, eksikler ve uyarılar baştan hesaplanır.'}
          </span>
        </div>
        {result && (
          <button className="ghost small" onClick={() => setOpen(!open)}>
            {open ? 'Sonucu gizle' : 'Sonucu göster'}
          </button>
        )}
        <button className={status?.stale ? 'primary' : ''} disabled={busy} onClick={run}>
          {busy ? <span className="disc-spinner" /> : <Icon name="refresh" />} Güncelle
        </button>
      </div>
      {busy && <div className="rf-progress" aria-hidden="true" />}
      <ErrorText error={err} />
      {result && open && (
        <div className="rf-result">
          <div className="rf-score">
            <div className={`rf-risk b-${result.current.band}`}>
              <strong>{result.current.risk}</strong>
              <span>{BAND_LABEL[result.current.band]}</span>
            </div>
            <div className="small">
              {result.previous ? (
                <>
                  Önceki analiz {when(result.previous.at)}: {result.previous.risk}/100 · <Delta value={result.changes.riskDelta} />
                </>
              ) : (
                'İlk analiz.'
              )}
            </div>
          </div>
          {result.previous && result.changes.added.length > 0 && (
            <>
              <h4>Yeni çıkan ({result.changes.added.length})</h4>
              <IssueList items={result.changes.added} />
            </>
          )}
          {result.previous && result.changes.resolved.length > 0 && (
            <>
              <h4 className="ok">Giderilen ({result.changes.resolved.length})</h4>
              <ul className="rf-issues resolved">
                {result.changes.resolved.map((i) => (
                  <li key={i.key}>
                    <Icon name="check" /> {i.text}
                  </li>
                ))}
              </ul>
            </>
          )}
          <h4>Güncel eksikler ve riskler ({result.current.issues.length})</h4>
          {result.current.issues.length ? <IssueList items={result.current.issues} /> : <p className="muted small">Uyarı yok.</p>}
        </div>
      )}
    </div>
  );
}

/** Listede her dosyanın yanındaki küçük Güncelle düğmesi. */
export function RowRefresh({ entity, id }: { entity: Entity; id: number }) {
  const [busy, setBusy] = useState(false);
  const [r, setR] = useState<RefreshResult | null>(null);
  const [err, setErr] = useState(false);
  async function run(e: React.MouseEvent) {
    e.stopPropagation();
    setBusy(true);
    setErr(false);
    try {
      setR(await api<RefreshResult>(`/refresh/${entity}/${id}`, { method: 'POST' }));
    } catch {
      setErr(true);
    } finally {
      setBusy(false);
    }
  }
  const title = r
    ? `${BAND_LABEL[r.current.band]} ${r.current.risk}/100 · ${r.current.issues.length} uyarı${r.previous ? ` · ${r.changes.added.length} yeni, ${r.changes.resolved.length} giderildi` : ''}`
    : 'Analizi güncelle';
  return (
    <span className="rf-row" onClick={(e) => e.stopPropagation()}>
      {r && (
        <span className={`rf-pill b-${r.current.band}`} title={title}>
          {r.current.risk}
          {r.previous && r.changes.riskDelta !== 0 && <small>{r.changes.riskDelta > 0 ? ` ▲${r.changes.riskDelta}` : ` ▼${-r.changes.riskDelta}`}</small>}
        </span>
      )}
      {err && <span className="error small">hata</span>}
      <button className="ghost icon-btn" onClick={run} disabled={busy} title={title} aria-label="Güncelle">
        {busy ? <span className="disc-spinner" /> : <Icon name="refresh" />}
      </button>
    </span>
  );
}

/** Liste sayfasının başındaki "Tümünü güncelle" düğmesi ve sonuç penceresi. */
export function RefreshAllButton({ entities, go, onDone }: { entities?: Entity[]; go: Go; onDone?: () => void }) {
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<AllResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  async function run() {
    setBusy(true);
    setErr(null);
    try {
      const [r] = await Promise.all([api<AllResult>('/refresh-all', { body: entities ? { entities } : {} }), new Promise((ok) => setTimeout(ok, 900))]);
      setRes(r);
      onDone?.();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function open(c: AllResult['changed'][number]) {
    setRes(null);
    go(c.entity === 'case' ? { name: 'case', id: c.id } : c.entity === 'contract' ? { name: 'contract', id: c.id } : { name: 'contract-group', id: c.id });
  }
  return (
    <>
      <button onClick={run} disabled={busy} title="Bütün dosyaların analizini yeniden çalıştırır">
        {busy ? <span className="disc-spinner" /> : <Icon name="refresh" />} {busy ? 'Güncelleniyor…' : 'Tümünü güncelle'}
      </button>
      {err && <span className="error small">{err}</span>}
      {res && (
        <div className="modal-backdrop" onClick={() => setRes(null)}>
          <div className="modal rf-modal" onClick={(e) => e.stopPropagation()}>
            <h3>
              <Icon name="refresh" /> {res.count} dosya güncellendi
            </h3>
            <p className="small">
              {res.added} yeni uyarı çıktı, {res.resolved} uyarı giderildi. {res.changed.length ? 'Değişen dosyalar en riskliden başlayarak:' : 'Hiçbir dosyada değişiklik yok.'}
            </p>
            {res.changed.length > 0 && (
              <ul className="rf-all">
                {res.changed.map((c) => (
                  <li key={`${c.entity}-${c.id}`} className="clickable" onClick={() => open(c)}>
                    <span className={`rf-pill b-${c.after > 70 ? 'yuksek' : c.after > 30 ? 'orta' : 'dusuk'}`}>{c.after}</span>
                    <span className="rf-all-text">
                      <strong>{c.title}</strong>
                      <span className="muted small">
                        {ENTITY_LABEL[c.entity]}
                        {c.before === null ? ' · ilk analiz' : ` · önce ${c.before}`}
                        {c.added ? ` · ${c.added} yeni` : ''}
                        {c.resolved ? ` · ${c.resolved} giderildi` : ''}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <div className="form-actions">
              <button className="primary" onClick={() => setRes(null)}>
                Tamam
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
