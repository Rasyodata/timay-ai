import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { STATUS_LABEL, type PetitionStatus } from './api';

export function useAsync<T>(load: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(() => {
    load()
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((e: Error) => setError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(reload, [reload]);
  return { data, error, reload, setData };
}

export function ErrorText({ error }: { error: string | null | undefined }) {
  return error ? <p className="error">{error}</p> : null;
}

export function StatusBadge({ status }: { status: PetitionStatus }) {
  return <span className={`badge ${status}`}>{STATUS_LABEL[status]}</span>;
}

export function PageHeader({
  title,
  subtitle,
  actions,
  back,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  back?: () => void;
}) {
  return (
    <header className="page-header">
      {back && (
        <button className="ghost back" onClick={back} title="Geri">
          <Icon name="back" />
        </button>
      )}
      <div className="grow">
        <h1>{title}</h1>
        {subtitle && <p className="subtitle">{subtitle}</p>}
      </div>
      {actions && <div className="actions">{actions}</div>}
    </header>
  );
}

export function Card({ title, actions, children, className = '' }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`card ${className}`}>
      {(title || actions) && (
        <div className="card-head">
          {title && <h2>{title}</h2>}
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

export function Stat({ icon, label, value, tone = 'blue', onClick }: { icon: IconName; label: string; value: ReactNode; tone?: string; onClick?: () => void }) {
  return (
    <button className={`stat ${onClick ? 'clickable' : ''}`} onClick={onClick} disabled={!onClick}>
      <span className={`stat-icon ${tone}`}>
        <Icon name={icon} />
      </span>
      <span className="stat-text">
        <span className="stat-value">{value}</span>
        <span className="stat-label">{label}</span>
      </span>
    </button>
  );
}

export function Empty({ icon = 'inbox', children }: { icon?: IconName; children: ReactNode }) {
  return (
    <div className="empty">
      <Icon name={icon} />
      <p>{children}</p>
    </div>
  );
}

export function Tabs<T extends string>({ value, onChange, items }: { value: T; onChange: (v: T) => void; items: [T, string][] }) {
  return (
    <div className="tabbar">
      {items.map(([key, label]) => (
        <button key={key} className={value === key ? 'active' : ''} onClick={() => onChange(key)}>
          {label}
        </button>
      ))}
    </div>
  );
}

export function Field({ label, children, wide }: { label: string; children: ReactNode; wide?: boolean }) {
  return (
    <label className={`field ${wide ? 'wide' : ''}`}>
      <span>{label}</span>
      {children}
    </label>
  );
}

export function formatTL(kurus: number) {
  return (kurus / 100).toLocaleString('tr-TR', { style: 'currency', currency: 'TRY', maximumFractionDigits: 2 });
}

export function formatDate(iso: string | null | undefined) {
  if (!iso) return '';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return d && m && y ? `${d}.${m}.${y}` : iso;
}

export function today() {
  return new Date().toISOString().slice(0, 10);
}

export function daysUntil(iso: string) {
  return Math.round((Date.parse(iso) - Date.parse(today())) / 86_400_000);
}

export function DueLabel({ date }: { date: string }) {
  if (!date) return null;
  const d = daysUntil(date);
  const tone = d < 0 ? 'bad' : d <= 3 ? 'warn' : 'muted';
  const text = d < 0 ? `${-d} gün geçti` : d === 0 ? 'Bugün' : d === 1 ? 'Yarın' : `${d} gün sonra`;
  return (
    <span className={`due ${tone}`}>
      {formatDate(date)} · {text}
    </span>
  );
}

export type IconName =
  | 'home'
  | 'folder'
  | 'calendar'
  | 'book'
  | 'scale'
  | 'contract'
  | 'wallet'
  | 'gavel'
  | 'check'
  | 'users'
  | 'logout'
  | 'plus'
  | 'back'
  | 'inbox'
  | 'file'
  | 'clock'
  | 'alert'
  | 'search'
  | 'trend'
  | 'briefcase'
  | 'tree'
  | 'upload'
  | 'download'
  | 'pen'
  | 'library'
  | 'calc'
  | 'kanban'
  | 'gear'
  | 'trash'
  | 'filter'
  | 'moon'
  | 'sun'
  | 'shield'
  | 'chart'
  | 'refresh'
  | 'bell';

const PATHS: Record<IconName, string> = {
  bell: 'M6 16V11a6 6 0 0 1 12 0v5l2 2H4zM10 20a2 2 0 0 0 4 0',
  refresh: 'M20 11a8 8 0 0 0-14.6-4.5M4 4v4h4M4 13a8 8 0 0 0 14.6 4.5M20 20v-4h-4',
  home: 'M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
  folder: 'M3 6a1 1 0 0 1 1-1h5l2 2h9a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z',
  calendar: 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4',
  book: 'M5 4h10a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3zM5 17a3 3 0 0 1 3-3h10',
  scale: 'M12 3v18M7 21h10M5 7h14M5 7l-3 7a3 3 0 0 0 6 0zM19 7l-3 7a3 3 0 0 0 6 0z',
  contract: 'M7 3h7l5 5v13H7zM14 3v5h5M10 13h6M10 17h6',
  wallet: 'M3 7h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM3 7l12-4 2 4M16 13h2',
  gavel: 'M14 4l6 6M11 7l6 6M8 10l5-5 6 6-5 5zM10 12l-7 7M3 21h10',
  check: 'M4 12l5 5L20 6',
  users: 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 21a7 7 0 0 1 14 0M17 11a3 3 0 1 0 0-6M22 21a6 6 0 0 0-5-6',
  logout: 'M15 4h4v16h-4M10 17l5-5-5-5M15 12H3',
  plus: 'M12 5v14M5 12h14',
  back: 'M15 5l-7 7 7 7',
  inbox: 'M3 13l3-8h12l3 8v6H3zM3 13h5l1 2h6l1-2h5',
  file: 'M7 3h7l5 5v13H7zM14 3v5h5',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2',
  alert: 'M12 3l10 18H2zM12 10v5M12 18v.5',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM21 21l-5-5',
  trend: 'M3 17l6-6 4 4 8-8M15 7h6v6',
  briefcase: 'M3 8h18v12H3zM8 8V5h8v3M3 13h18',
  shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6zM9 12l2 2 4-4',
  upload: 'M12 16V4M7 9l5-5 5 5M4 17v3h16v-3',
  download: 'M12 4v12M7 11l5 5 5-5M4 17v3h16v-3',
  pen: 'M4 20h4L19 9l-4-4L4 16zM13 7l4 4',
  library: 'M4 4h4v16H4zM10 4h4v16h-4zM16 5l3.5-1 3 15.5-3.5 1z',
  calc: 'M6 3h12v18H6zM9 7h6M9 12h.01M12 12h.01M15 12h.01M9 16h.01M12 16h.01M15 16h.01',
  kanban: 'M4 4h4v16H4zM10 4h4v10h-4zM16 4h4v13h-4z',
  filter: 'M3 5h18l-7 8v6l-4 2v-8z',
  trash: 'M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 11v6M14 11v6',
  gear: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  moon: 'M20 14A8 8 0 1 1 10 4a6 6 0 0 0 10 10z',
  sun: 'M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4',
  chart: 'M4 20h16M6 20V11M11 20V5M16 20v-7M21 20V9',
  tree: 'M12 3v6M12 9H6v5M12 9h6v5M6 14v3M18 14v3M4 17h4v4H4zM16 17h4v4h-4zM10 3h4',
};

export function Icon({ name }: { name: IconName }) {
  return (
    <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={PATHS[name]} />
    </svg>
  );
}
