import { useEffect, useMemo, useState } from 'react';
import { api, type User } from './api';
import type { Go } from './App';
import { Card, Empty, ErrorText, formatTL, Icon, Stat, useAsync, type IconName } from './ui';

export interface Activity {
  at: string;
  user_id: number;
  user_name: string;
  module: string;
  text: string;
}

interface LawyerRow {
  id: number;
  name: string;
  role: string;
  is_ceo: number;
  open_cases: number;
  petitions_written: number;
  approvals: number;
  open_tasks: number;
  overdue_tasks: number;
  minutes: number;
  hearings: number;
  actions30: number;
  last_seen: string;
}

interface CeoPanel {
  kpis: {
    lawyers: number;
    openCases: number;
    newCases30: number;
    petitionsInReview: number;
    approved30: number;
    hearings7: number;
    overdueTasks: number;
    activeContracts: number;
    openEnforcement: number;
    hours30: number;
  };
  lawyers: LawyerRow[];
  trend: { months: string[]; cases: number[]; petitions: number[]; contracts: number[]; income: number[] | null; expense: number[] | null };
  areas: { label: string; n: number }[];
  petitionStatus: { label: string; n: number }[];
  alerts: { kind: string; text: string; who: string; date: string }[];
  feed: Activity[];
  financeHidden: boolean;
}

const MODULE_ICON: Record<string, IconName> = {
  Dava: 'folder',
  Dilekçe: 'pen',
  Onay: 'check',
  Sözleşme: 'contract',
  Belge: 'file',
  Görev: 'kanban',
  İcra: 'gavel',
  Tebligat: 'inbox',
  Zaman: 'clock',
  Vekâlet: 'shield',
  Not: 'pin',
  'Yapay zekâ': 'spark',
  Muhasebe: 'wallet',
};

const MONTHS = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'];
const monthLabel = (ym: string) => MONTHS[Number(ym.slice(5, 7)) - 1] ?? ym;

const PETITION_LABEL: Record<string, string> = { taslak: 'Taslak', incelemede: 'Onay bekliyor', duzeltme: 'Düzeltmede', onayli: 'Onaylı' };

/** Sunucu saati UTC ("2026-11-03 06:10:00"); yerel saate çevrilir. */
function parseAt(at: string) {
  return new Date(at.includes('T') ? at : `${at.replace(' ', 'T')}Z`);
}

export function ago(at: string) {
  if (!at) return 'henüz hareket yok';
  const mins = Math.max(0, Math.round((Date.now() - parseAt(at).getTime()) / 60000));
  if (mins < 1) return 'az önce';
  if (mins < 60) return `${mins} dk önce`;
  const h = Math.round(mins / 60);
  if (h < 24) return `${h} sa önce`;
  const d = Math.round(h / 24);
  return d === 1 ? 'dün' : `${d} gün önce`;
}

function clock(at: string) {
  return parseAt(at).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
}

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Günaydın' : h < 18 ? 'İyi günler' : 'İyi akşamlar';
}

export function roleTitle(u: Pick<User, 'role' | 'is_ceo' | 'is_admin'>) {
  if (u.is_ceo) return 'CEO · Avukat · Direktör';
  return u.role === 'avukat' ? 'Avukat' : 'Stajyer';
}

/** Kayan şerit: büroda o an kim ne yapıyor. 30 saniyede bir yenilenir; üstüne gelince durur. */
export function ActivityTicker({ initial }: { initial?: Activity[] }) {
  const [items, setItems] = useState<Activity[]>(initial ?? []);
  useEffect(() => {
    let alive = true;
    const load = () =>
      api<Activity[]>('/ceo/feed')
        .then((f) => alive && setItems(f))
        .catch(() => undefined);
    if (!initial) load();
    const t = window.setInterval(load, 30000);
    return () => {
      alive = false;
      window.clearInterval(t);
    };
  }, []);
  const shown = items.slice(0, 30);
  // Akış kısa olsa da şerit dolsun: içerik iki kez yazılır, yarısı kadar kayınca başa döner.
  const duration = Math.max(40, shown.length * 7);
  return (
    <div className="ceo-ticker" aria-label="Büroda son hareketler">
      <span className="ceo-ticker-live">
        <span className="pulse" /> CANLI
      </span>
      <div className="ceo-ticker-window">
        {shown.length === 0 ? (
          <span className="ceo-ticker-empty">Avukatlar çalıştıkça yaptıkları burada kayarak görünecek.</span>
        ) : (
          <div className="ceo-ticker-track" style={{ animationDuration: `${duration}s` }}>
            {[0, 1].map((copy) =>
              shown.map((a, i) => (
                <span key={`${copy}-${i}`} className="ceo-ticker-item" aria-hidden={copy === 1}>
                  <span className="t-time">{clock(a.at)}</span>
                  <Icon name={MODULE_ICON[a.module] ?? 'spark'} />
                  <strong>{a.user_name}</strong>
                  <span>{a.text}</span>
                </span>
              )),
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function useNow() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 30000);
    return () => window.clearInterval(t);
  }, []);
  return now;
}

/** Gruplu sütun grafiği: aynı birimdeki (adet) serileri aylara göre yan yana gösterir. */
function GroupedBars({
  months,
  series,
  format = (v: number) => String(v),
}: {
  months: string[];
  series: { name: string; values: number[]; cls: string }[];
  format?: (v: number) => string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...series.flatMap((s) => s.values));
  const W = 560;
  const H = 200;
  const pad = { l: 8, r: 8, t: 16, b: 26 };
  const gw = (W - pad.l - pad.r) / months.length;
  const bw = Math.min(22, (gw - 18) / series.length - 2);
  const y = (v: number) => pad.t + (H - pad.t - pad.b) * (1 - v / max);
  return (
    <div className="ceo-chart">
      <div className="ceo-legend">
        {series.map((s) => (
          <span key={s.name}>
            <i className={`sw ${s.cls}`} /> {s.name}
          </span>
        ))}
      </div>
      <div className="ceo-chart-box">
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={series.map((s) => s.name).join(', ')}>
          {[0.5, 1].map((f) => (
            <line key={f} className="grid" x1={pad.l} x2={W - pad.r} y1={y(max * f)} y2={y(max * f)} />
          ))}
          <line className="axis" x1={pad.l} x2={W - pad.r} y1={y(0)} y2={y(0)} />
          {months.map((m, i) => {
            const gx = pad.l + i * gw;
            const start = gx + (gw - series.length * (bw + 2)) / 2;
            return (
              <g key={m} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
                <rect className="hit" x={gx} y={pad.t} width={gw} height={H - pad.t - pad.b} />
                {series.map((s, k) => {
                  const v = s.values[i];
                  const h = Math.max(v > 0 ? 3 : 0, y(0) - y(v));
                  return <rect key={s.name} className={`bar ${s.cls}`} x={start + k * (bw + 2)} y={y(0) - h} width={bw} height={h} rx={Math.min(4, bw / 2)} />;
                })}
                <text className="tick" x={gx + gw / 2} y={H - 8} textAnchor="middle">
                  {monthLabel(m)}
                </text>
              </g>
            );
          })}
        </svg>
        {hover !== null && (
          <div className="ceo-tip" style={{ left: `${((pad.l + (hover + 0.5) * gw) / W) * 100}%` }}>
            <strong>
              {monthLabel(months[hover])} {months[hover].slice(0, 4)}
            </strong>
            {series.map((s) => (
              <span key={s.name}>
                <i className={`sw ${s.cls}`} /> {s.name}: <b>{format(s.values[hover])}</b>
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** Yatay çubuklar: tek seri, en büyükten küçüğe; değer çubuğun yanında yazılı. */
function HBars({ rows, onClick }: { rows: { label: string; n: number }[]; onClick?: () => void }) {
  const max = Math.max(1, ...rows.map((r) => r.n));
  if (rows.length === 0) return <Empty icon="folder">Henüz açık dosya yok.</Empty>;
  return (
    <ul className="ceo-hbars">
      {rows.map((r) => (
        <li key={r.label} onClick={onClick} className={onClick ? 'clickable' : ''} title={`${r.label}: ${r.n}`}>
          <span className="lbl">{r.label}</span>
          <span className="track">
            <span className="fill" style={{ width: `${(r.n / max) * 100}%` }} />
          </span>
          <span className="val">{r.n}</span>
        </li>
      ))}
    </ul>
  );
}

function hours(minutes: number) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h === 0 && m === 0 ? '—' : `${h} sa${m ? ` ${m} dk` : ''}`;
}

export function CeoView({ user, go, onLawyerHome }: { user: User; go: Go; onLawyerHome?: () => void }) {
  const [tick, setTick] = useState(0);
  const { data, error } = useAsync(() => api<CeoPanel>('/ceo'), [tick]);
  const now = useNow();
  const [moduleFilter, setModuleFilter] = useState('');
  useEffect(() => {
    // Göstergeler 2 dakikada bir tazelenir.
    const t = window.setInterval(() => setTick((k) => k + 1), 120000);
    return () => window.clearInterval(t);
  }, []);
  const modules = useMemo(() => Array.from(new Set((data?.feed ?? []).map((a) => a.module))), [data]);
  const feed = (data?.feed ?? []).filter((a) => !moduleFilter || a.module === moduleFilter);
  const maxActions = Math.max(1, ...(data?.lawyers ?? []).map((l) => l.actions30));
  const k = data?.kpis;
  const dateText = now.toLocaleDateString('tr-TR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const firstName = user.name.split(' ')[0];
  const income = data?.trend.income ?? null;
  const expense = data?.trend.expense ?? null;
  const incomeMonth = income ? income[income.length - 1] : 0;
  const expenseMonth = expense ? expense[expense.length - 1] : 0;

  return (
    <div className="page ceo-page">
      <header className="ceo-hero">
        <div>
          <span className="ceo-eyebrow">Yönetim paneli</span>
          <h1>
            {greeting()}, {firstName}
          </h1>
          <p>
            {dateText} · saat {now.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}
          </p>
          <div className="ceo-roles">
            {user.is_ceo ? (
              <>
                <span>
                  <Icon name="chart" /> CEO
                </span>
                <span>
                  <Icon name="scale" /> Avukat
                </span>
                <span>
                  <Icon name="briefcase" /> Direktör
                </span>
              </>
            ) : (
              <span>
                <Icon name="gear" /> Büro yöneticisi
              </span>
            )}
          </div>
        </div>
        <div className="ceo-hero-actions">
          {onLawyerHome && (
            <button onClick={onLawyerHome}>
              <Icon name="scale" /> Avukat ana sayfam
            </button>
          )}
          <button onClick={() => go({ name: 'team' })}>
            <Icon name="users" /> Ekip ve yetkiler
          </button>
          <button className="primary" onClick={() => setTick((t) => t + 1)}>
            <Icon name="refresh" /> Yenile
          </button>
        </div>
      </header>

      {data ? <ActivityTicker key={tick} initial={data.feed} /> : <ActivityTicker />}
      <ErrorText error={error} />

      {data && k && (
        <>
          <div className="stats ceo-stats">
            <Stat icon="users" label="Avukat" value={k.lawyers} onClick={() => go({ name: 'team' })} />
            <Stat icon="folder" label={`Açık dosya · son 30 günde +${k.newCases30}`} value={k.openCases} onClick={() => go({ name: 'cases' })} />
            <Stat icon="clock" label="Onay bekleyen dilekçe" value={k.petitionsInReview} tone="amber" />
            <Stat icon="check" label="30 günde onaylanan" value={k.approved30} tone="green" />
            <Stat icon="calendar" label="7 gün içinde duruşma" value={k.hearings7} tone="violet" onClick={() => go({ name: 'agenda' })} />
            <Stat icon="alert" label="Geciken görev" value={k.overdueTasks} tone={k.overdueTasks ? 'red' : 'green'} onClick={() => go({ name: 'tasks' })} />
            <Stat icon="contract" label="Yürürlükte sözleşme" value={k.activeContracts} tone="violet" onClick={() => go({ name: 'contracts' })} />
            <Stat icon="gavel" label="Açık icra takibi" value={k.openEnforcement} tone="red" onClick={() => go({ name: 'enforcement' })} />
            <Stat icon="clock" label="30 günde çalışılan saat" value={k.hours30.toLocaleString('tr-TR')}onClick={() => go({ name: 'time' })} />
            {!data.financeHidden && (
              <Stat
                icon="wallet"
                label="Bu ay kâr"
                value={formatTL(incomeMonth - expenseMonth)}
                tone={incomeMonth - expenseMonth >= 0 ? 'green' : 'red'}
                onClick={() => go({ name: 'finance' })}
              />
            )}
          </div>

          <Card title="Avukatların performansı (son 30 gün)" className="flush">
            <div className="table-scroll">
              <table className="table ceo-table">
                <thead>
                  <tr>
                    <th>Avukat</th>
                    <th className="num">Açık dosya</th>
                    <th className="num">Dilekçe yazdı</th>
                    <th className="num">Onay verdi</th>
                    <th className="num">Açık görev</th>
                    <th className="num">Duruşma (30 gün)</th>
                    <th className="num">Çalışılan süre</th>
                    <th>Hareket</th>
                    <th>Son hareket</th>
                  </tr>
                </thead>
                <tbody>
                  {data.lawyers.map((l) => (
                    <tr key={l.id}>
                      <td>
                        <span className="ceo-person">
                          <span className="avatar">{l.name.slice(0, 1).toLocaleUpperCase('tr')}</span>
                          <span>
                            <strong>{l.name}</strong>
                            <span className="muted small">{l.is_ceo ? 'CEO · Avukat · Direktör' : l.role === 'avukat' ? 'Avukat' : 'Stajyer'}</span>
                          </span>
                        </span>
                      </td>
                      <td className="num">{l.open_cases}</td>
                      <td className="num">{l.petitions_written}</td>
                      <td className="num">{l.approvals}</td>
                      <td className="num">
                        {l.open_tasks}
                        {l.overdue_tasks > 0 && <span className="badge duzeltme"> {l.overdue_tasks} gecikmiş</span>}
                      </td>
                      <td className="num">{l.hearings}</td>
                      <td className="num">{hours(l.minutes)}</td>
                      <td>
                        <span className="ceo-meter" title={`${l.actions30} hareket`}>
                          <span style={{ width: `${(l.actions30 / maxActions) * 100}%` }} />
                        </span>
                        <span className="small"> {l.actions30}</span>
                      </td>
                      <td className="muted small">{ago(l.last_seen)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <div className="ceo-grid">
            <Card title="Aylık iş hacmi (son 6 ay)">
              <GroupedBars
                months={data.trend.months}
                series={[
                  { name: 'Yeni dava', values: data.trend.cases, cls: 's1' },
                  { name: 'Dilekçe', values: data.trend.petitions, cls: 's2' },
                  { name: 'Sözleşme', values: data.trend.contracts, cls: 's3' },
                ]}
              />
            </Card>
            {income && expense ? (
              <Card title="Gelir ve gider (son 6 ay)" actions={<button className="link" onClick={() => go({ name: 'finance' })}>Muhasebe</button>}>
                <GroupedBars
                  months={data.trend.months}
                  format={formatTL}
                  series={[
                    { name: 'Gelir', values: income, cls: 's1' },
                    { name: 'Gider ve masraf', values: expense, cls: 's2' },
                  ]}
                />
              </Card>
            ) : (
              <Card title="Gelir ve gider">
                <Empty icon="wallet">Muhasebe yetkiniz olmadığı için tutarlar gizli.</Empty>
              </Card>
            )}
            <Card title="Açık dosyalar · hukuk alanına göre" actions={<button className="link" onClick={() => go({ name: 'cases' })}>Dosyalar</button>}>
              <HBars rows={data.areas} onClick={() => go({ name: 'cases' })} />
            </Card>
            <Card title="Dilekçelerin durumu">
              <HBars rows={data.petitionStatus.map((p) => ({ label: PETITION_LABEL[p.label] ?? p.label, n: p.n }))} />
            </Card>
          </div>

          <div className="ceo-grid two">
            <Card
              title="Bütün hareketler"
              actions={
                <select className="compact" value={moduleFilter} onChange={(e) => setModuleFilter(e.target.value)}>
                  <option value="">Tüm modüller</option>
                  {modules.map((m) => (
                    <option key={m}>{m}</option>
                  ))}
                </select>
              }
            >
              {feed.length === 0 ? (
                <Empty icon="spark">Henüz hareket yok.</Empty>
              ) : (
                <ul className="ceo-timeline">
                  {feed.map((a, i) => (
                    <li key={i}>
                      <span className="dot">
                        <Icon name={MODULE_ICON[a.module] ?? 'spark'} />
                      </span>
                      <span className="body">
                        <span>
                          <strong>{a.user_name}</strong> {a.text}
                        </span>
                        <span className="muted small">
                          {a.module} · {ago(a.at)} · {clock(a.at)}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
            <Card title="Dikkat isteyenler" className="alert-card">
              {data.alerts.length === 0 ? (
                <Empty icon="check">Geciken görev ya da bu hafta duruşma yok.</Empty>
              ) : (
                <ul className="items">
                  {data.alerts.map((a, i) => (
                    <li key={i} className="clickable" onClick={() => go({ name: a.kind === 'Duruşma' ? 'agenda' : 'tasks' })}>
                      <span className={`risk-dot ${a.kind === 'Duruşma' ? 'orta' : 'yuksek'}`} />
                      <span className="tag">{a.kind}</span>
                      <span className="item-text">
                        <strong>{a.text}</strong>
                        <span>
                          {a.who} · {a.date}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

/** İlk girişte (yönetici geçici şifreyle açtıysa) kendi şifresini belirletir. */
export function ChangePasswordDialog({ user, onDone, onCancel }: { user: User; onDone: (u: User) => void; onCancel?: () => void }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const forced = Boolean(user.must_change_password);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (next !== again) return setErr('Yeni şifreler birbirini tutmuyor.');
    try {
      onDone(await api<User>('/me/password', { body: { current, next } }));
    } catch (ex) {
      setErr((ex as Error).message);
    }
  }
  return (
    <div className="modal-backdrop">
      <form className="modal card" onSubmit={save}>
        <h2>{forced ? `Hoş geldiniz, ${user.name}` : 'Şifremi değiştir'}</h2>
        {forced && <p className="muted">Hesabınız geçici şifreyle açıldı. Devam etmeden önce yalnız sizin bileceğiniz bir şifre belirleyin.</p>}
        <label className="field">
          <span>{forced ? 'Geçici şifre' : 'Şu anki şifre'}</span>
          <input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} required autoFocus />
        </label>
        <label className="field">
          <span>Yeni şifre (en az 8 karakter)</span>
          <input type="password" minLength={8} value={next} onChange={(e) => setNext(e.target.value)} required />
        </label>
        <label className="field">
          <span>Yeni şifre (tekrar)</span>
          <input type="password" minLength={8} value={again} onChange={(e) => setAgain(e.target.value)} required />
        </label>
        <ErrorText error={err} />
        <div className="row end">
          {!forced && onCancel && (
            <button type="button" onClick={onCancel}>
              Vazgeç
            </button>
          )}
          <button className="primary" type="submit">
            Şifreyi kaydet
          </button>
        </div>
      </form>
    </div>
  );
}
