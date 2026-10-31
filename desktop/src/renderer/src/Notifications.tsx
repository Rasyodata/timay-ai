import { useEffect, useRef, useState } from 'react';
import { api } from './api';
import type { Go, View } from './App';
import { Icon } from './ui';

/*
 * Bildirim merkezi (zil): süreler (3 gün, 1 gün, son gün), duruşmalar, görevler ve onay istekleri.
 * Yeni kritik bildirimler Windows bildirimi olarak da gösterilir.
 */

interface Notice {
  key: string;
  level: 'kritik' | 'uyari' | 'bilgi';
  kind: 'sure' | 'durusma' | 'gorev' | 'onay';
  title: string;
  detail: string;
  date: string;
  link: { view: string; id?: number; tab?: string };
  read: boolean;
}

interface Payload {
  items: Notice[];
  unread: number;
}

const KIND_ICON = { sure: 'clock', durusma: 'gavel', gorev: 'check', onay: 'pen' } as const;
const SHOWN_KEY = 'timay-notified';

function shown(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(SHOWN_KEY) ?? '[]') as string[]);
  } catch {
    return new Set();
  }
}

function toView(l: Notice['link']): View {
  return { name: l.view, id: l.id, tab: l.tab } as unknown as View;
}

/** Okunmamış kritik bildirimleri bir kez Windows bildirimi olarak gösterir. */
function desktopNotify(items: Notice[], go: Go) {
  if (typeof Notification === 'undefined') return;
  const seen = shown();
  const fresh = items.filter((i) => !i.read && i.level !== 'bilgi' && !seen.has(i.key)).slice(0, 3);
  for (const n of fresh) {
    try {
      const note = new Notification(n.title, { body: n.detail });
      note.onclick = () => go(toView(n.link));
    } catch {
      // Bildirim izni yoksa sessizce geç.
    }
    seen.add(n.key);
  }
  try {
    localStorage.setItem(SHOWN_KEY, JSON.stringify([...seen].slice(-400)));
  } catch {
    // depolama kullanılamıyor
  }
}

export function NotificationBell({ go }: { go: Go }) {
  const [data, setData] = useState<Payload | null>(null);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  async function load(notify = false) {
    try {
      const d = await api<Payload>('/notifications');
      setData(d);
      if (notify) desktopNotify(d.items, go);
    } catch {
      // bağlantı yoksa zil boş kalır
    }
  }

  useEffect(() => {
    load(true);
    const t = setInterval(() => load(true), 10 * 60 * 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [open]);

  async function pick(n: Notice) {
    setOpen(false);
    go(toView(n.link));
    if (!n.read) setData(await api<Payload>('/notifications/read', { body: { keys: [n.key] } }));
  }

  async function readAll() {
    setData(await api<Payload>('/notifications/read', { body: { all: true } }));
  }

  return (
    <div className="nf" ref={ref}>
      <button
        className={`ghost nf-bell ${data?.unread ? 'has' : ''}`}
        onClick={() => {
          setOpen(!open);
          if (!open) load();
        }}
        title="Bildirimler"
        aria-label={`Bildirimler${data?.unread ? `, ${data.unread} okunmamış` : ''}`}
      >
        <Icon name="bell" />
        {Boolean(data?.unread) && <span className="nf-badge">{data!.unread > 99 ? '99+' : data!.unread}</span>}
      </button>
      {open && (
        <div className="nf-panel" role="dialog" aria-label="Bildirimler">
          <div className="nf-head">
            <strong>Bildirimler</strong>
            {Boolean(data?.unread) && (
              <button className="link small" onClick={readAll}>
                Tümünü okundu say
              </button>
            )}
          </div>
          {!data?.items.length ? (
            <p className="muted small nf-empty">Bildirim yok. Süreler son güne 3 gün ve 1 gün kala burada görünür.</p>
          ) : (
            <ul className="nf-list">
              {data.items.map((n) => (
                <li key={n.key} className={`l-${n.level} ${n.read ? 'read' : ''}`} onClick={() => pick(n)}>
                  <span className="nf-icon">
                    <Icon name={KIND_ICON[n.kind]} />
                  </span>
                  <span className="nf-text">
                    <strong>{n.title}</strong>
                    <span>{n.detail}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
