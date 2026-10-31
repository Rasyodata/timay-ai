import { useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { api } from './api';
import { ErrorText, Icon, useAsync } from './ui';

/*
 * İş zekası paneli: her yönetim sayfasının üstünde göstergeler ve grafikler.
 * Veriyi sunucu hazırlar (/api/insights/:module); burada yalnızca çizilir.
 */

type Unit = 'adet' | 'tl' | 'saat' | 'gun' | 'yuzde';
type Tone = 'iyi' | 'uyari' | 'kritik' | '';

interface Kpi {
  label: string;
  value: number;
  unit: Unit;
  hint?: string;
  tone?: Tone;
}

interface Chart {
  id: string;
  title: string;
  kind: 'bars' | 'months' | 'parts';
  unit: Unit;
  series?: string[];
  stacked?: boolean;
  data: { label: string; values: number[]; tone?: Tone }[];
  note?: string;
}

interface Insights {
  kpis: Kpi[];
  charts: Chart[];
}

export type InsightModule = 'cases' | 'contracts' | 'powers' | 'enforcement' | 'consultancy' | 'estates' | 'tasks' | 'finance' | 'decisions';

const nf = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 1 });

export function formatValue(v: number, unit: Unit, compact = false) {
  if (unit === 'tl') {
    if (compact && Math.abs(v) >= 1_000_000) return `₺${nf.format(Math.round(v / 100_000) / 10)} mn`;
    if (compact && Math.abs(v) >= 10_000) return `₺${nf.format(Math.round(v / 1000))} bin`;
    return `₺${nf.format(Math.round(v))}`;
  }
  if (unit === 'yuzde') return `%${nf.format(v)}`;
  if (unit === 'saat') return `${nf.format(v)} sa`;
  if (unit === 'gun') return `${nf.format(v)} gün`;
  return nf.format(v);
}

function storageGet(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function storageSet(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // tarayıcı depolaması kapalıysa yalnızca bu oturumda hatırlanır
  }
}

/** Bir yönetim sayfasının analiz bölümü; açık/kapalı durumu bu bilgisayarda hatırlanır. */
export function InsightsPanel({ module, reloadKey }: { module: InsightModule; reloadKey?: unknown }) {
  const key = `timay-analiz-${module}`;
  const [open, setOpen] = useState(() => storageGet(key) !== '0');
  const data = useAsync(() => (open ? api<Insights>(`/insights/${module}`) : Promise.resolve(null)), [module, open, reloadKey]);

  function toggle() {
    storageSet(key, open ? '0' : '1');
    setOpen(!open);
  }

  return (
    <section className={`insights ${open ? 'open' : ''}`}>
      <button className="insights-toggle" onClick={toggle} aria-expanded={open}>
        <Icon name="chart" />
        <span>Analiz</span>
        <span className="muted small">{open ? 'Gizle' : 'Göster'}</span>
      </button>
      {open && (
        <>
          <ErrorText error={data.error} />
          {!data.data && !data.error && <p className="muted small">Analiz hazırlanıyor…</p>}
          {data.data && (
            <>
              <div className="kpi-row">
                {data.data.kpis.map((k) => (
                  <div key={k.label} className={`kpi ${k.tone ? `t-${k.tone}` : ''}`}>
                    <span className="kpi-label">{k.label}</span>
                    <span className="kpi-value">
                      {k.tone && k.tone !== 'iyi' && <Icon name={k.tone === 'kritik' ? 'alert' : 'clock'} />}
                      {formatValue(k.value, k.unit)}
                    </span>
                    {k.hint && <span className="kpi-hint">{k.hint}</span>}
                  </div>
                ))}
              </div>
              <div className="chart-grid">
                {data.data.charts.map((c) => (
                  <ChartCard key={c.id} chart={c} />
                ))}
              </div>
            </>
          )}
        </>
      )}
    </section>
  );
}

// ---------------------------------------------------------------- grafik kartı

function useTip() {
  const box = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<{ x: number; y: number; body: ReactNode } | null>(null);
  function show(e: MouseEvent, body: ReactNode) {
    const r = box.current?.getBoundingClientRect();
    if (!r) return;
    setTip({ x: e.clientX - r.left, y: e.clientY - r.top, body });
  }
  const node = tip && (
    <div className="chart-tip" style={{ left: tip.x, top: tip.y }} role="status">
      {tip.body}
    </div>
  );
  return { box, show, hide: () => setTip(null), node };
}

function color(i: number, tone?: Tone) {
  if (tone === 'iyi') return 'var(--ok)';
  if (tone === 'uyari') return 'var(--warn)';
  if (tone === 'kritik') return 'var(--bad)';
  return `var(--s${(i % 6) + 1})`;
}

function TipBody({ chart, row }: { chart: Chart; row: Chart['data'][number] }) {
  return (
    <>
      <strong>{row.label}</strong>
      {(chart.series ?? ['']).map((s, i) => (
        <span key={s || i} className="tip-line">
          {chart.series && <i style={{ background: color(i) }} />}
          {s && `${s}: `}
          {formatValue(row.values[i] ?? 0, chart.unit)}
        </span>
      ))}
    </>
  );
}

function ChartCard({ chart }: { chart: Chart }) {
  const [table, setTable] = useState(false);
  const empty = chart.data.every((d) => d.values.every((v) => !v));
  return (
    <div className="chart-card">
      <div className="chart-head">
        <h3>{chart.title}</h3>
        {!empty && (
          <button className="link small" onClick={() => setTable(!table)}>
            {table ? 'Grafik' : 'Tablo'}
          </button>
        )}
      </div>
      {chart.series && !empty && !table && (
        <div className="chart-legend">
          {chart.series.map((s, i) => (
            <span key={s}>
              <i style={{ background: color(i) }} /> {s}
            </span>
          ))}
        </div>
      )}
      {empty ? (
        <p className="muted small chart-empty">Henüz veri yok.</p>
      ) : table ? (
        <DataTable chart={chart} />
      ) : chart.kind === 'months' ? (
        <Months chart={chart} />
      ) : chart.kind === 'parts' ? (
        <Parts chart={chart} />
      ) : (
        <Bars chart={chart} />
      )}
      {chart.note && <p className="muted small chart-note">{chart.note}</p>}
    </div>
  );
}

function DataTable({ chart }: { chart: Chart }) {
  return (
    <table className="chart-table">
      <thead>
        <tr>
          <th></th>
          {(chart.series ?? ['Değer']).map((s) => (
            <th key={s}>{s}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {chart.data.map((d) => (
          <tr key={d.label}>
            <td>{d.label}</td>
            {(chart.series ?? ['']).map((_, i) => (
              <td key={i}>{formatValue(d.values[i] ?? 0, chart.unit)}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Sıralı yatay çubuklar; çok serili ise yan yana (ya da bütünün parçasıysa üst üste). */
function Bars({ chart }: { chart: Chart }) {
  const tip = useTip();
  const totals = chart.data.map((d) => (chart.stacked ? d.values.reduce((s, v) => s + v, 0) : Math.max(...d.values)));
  const max = Math.max(1, ...totals.map(Math.abs));
  return (
    <div className="bi-bars" ref={tip.box} onMouseLeave={tip.hide}>
      {chart.data.map((d, row) => (
        <div key={d.label} className="bi-bar-row" onMouseMove={(e) => tip.show(e, <TipBody chart={chart} row={d} />)}>
          <span className="bi-bar-label" title={d.label}>
            {d.label}
          </span>
          <span className={`bi-bar-track ${chart.series && !chart.stacked ? 'grouped' : ''}`}>
            {chart.stacked ? (
              <span className="bi-bar-stack" style={{ width: `${(totals[row] / max) * 100}%` }}>
                {d.values.map((v, i) =>
                  v > 0 ? <span key={i} className="bi-bar" style={{ flexGrow: v, background: color(i) }} /> : null,
                )}
              </span>
            ) : (
              d.values.map((v, i) => (
                v === 0 ? (
                  <span key={i} className="bi-bar-zero" />
                ) : (
                <span
                  key={i}
                  className="bi-bar"
                  style={{ width: `${(Math.abs(v) / max) * 100}%`, background: chart.series ? color(i) : d.tone ? color(0, d.tone) : 'var(--s1)' }}
                />
                )
              ))
            )}
          </span>
          <span className="bi-bar-value">
            {chart.series && !chart.stacked ? d.values.map((v) => formatValue(v, chart.unit, true)).join(' / ') : formatValue(totals[row], chart.unit, true)}
          </span>
        </div>
      ))}
      {tip.node}
    </div>
  );
}

/** Aylık sütunlar (tek eksen). */
function Months({ chart }: { chart: Chart }) {
  const tip = useTip();
  const max = Math.max(1, ...chart.data.flatMap((d) => d.values));
  const total = chart.data.reduce((s, d) => s + d.values[0], 0);
  const last = chart.data.at(-1)!;
  return (
    <>
      {!chart.series && (
        <p className="chart-summary">
          <strong>{formatValue(last.values[0], chart.unit)}</strong> <span className="muted small">bu ay · 12 ayda {formatValue(total, chart.unit)}</span>
        </p>
      )}
      <div className="bi-months" ref={tip.box} onMouseLeave={tip.hide}>
        <span className="bi-months-max muted">{formatValue(max, chart.unit, true)}</span>
        {chart.data.map((d) => (
          <div key={d.label} className="bi-month" onMouseMove={(e) => tip.show(e, <TipBody chart={chart} row={d} />)}>
            <div className="bi-month-bars">
              {d.values.map((v, i) => (
                <span key={i} className="bi-col" style={{ height: `${(v / max) * 100}%`, background: color(i) }} />
              ))}
            </div>
            <span className="bi-month-label">{d.label.split(' ')[0]}</span>
          </div>
        ))}
        {tip.node}
      </div>
    </>
  );
}

/** Bir bütünün dağılımı: tek parçalı çubuk ve değerli açıklama. */
function Parts({ chart }: { chart: Chart }) {
  const tip = useTip();
  const total = chart.data.reduce((s, d) => s + d.values[0], 0);
  return (
    <div className="bi-parts" ref={tip.box} onMouseLeave={tip.hide}>
      <div className="bi-parts-bar">
        {chart.data.map((d, i) =>
          d.values[0] > 0 ? (
            <span
              key={d.label}
              style={{ flexGrow: d.values[0], background: color(i, d.tone) }}
              onMouseMove={(e) => tip.show(e, <TipBody chart={chart} row={d} />)}
            />
          ) : null,
        )}
      </div>
      <ul className="bi-parts-legend">
        {chart.data.map((d, i) => (
          <li key={d.label}>
            <i style={{ background: color(i, d.tone) }} />
            <span>{d.label}</span>
            <strong>{formatValue(d.values[0], chart.unit)}</strong>
            <span className="muted">%{total ? Math.round((d.values[0] / total) * 100) : 0}</span>
          </li>
        ))}
      </ul>
      {tip.node}
    </div>
  );
}
