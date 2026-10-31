import { useEffect, useState } from 'react';
import { api } from './api';
import type { Go, View } from './App';
import { Empty, ErrorText, Icon, PageHeader, Tabs } from './ui';

/*
 * Tam metin arama: dosyalar, belgeler (resimden okunan yazı dahil), dilekçeler, sözleşmeler, notlar, kararlar.
 */

interface Hit {
  type: 'case' | 'document' | 'petition' | 'contract' | 'note' | 'decision';
  id: number;
  title: string;
  context: string;
  snippet: string;
  score: number;
  link: { name: string; id?: number; tab?: string };
}

const TYPE_LABEL: Record<Hit['type'], string> = {
  case: 'Dava',
  document: 'Belge',
  petition: 'Dilekçe',
  contract: 'Sözleşme',
  note: 'Not',
  decision: 'Karar',
};
const TYPE_ICON = { case: 'folder', document: 'file', petition: 'pen', contract: 'contract', note: 'book', decision: 'scale' } as const;

function Highlight({ text, q }: { text: string; q: string }) {
  const words = q
    .toLocaleLowerCase('tr')
    .split(/\s+/)
    .filter((w) => w.length >= 2)
    .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (!words.length) return <>{text}</>;
  const parts = text.split(new RegExp(`(${words.join('|')})`, 'giu'));
  return (
    <>
      {parts.map((p, i) => (i % 2 ? <mark key={i}>{p}</mark> : p))}
    </>
  );
}

export function SearchView({ go, initial }: { go: Go; initial?: string }) {
  const [q, setQ] = useState(initial ?? '');
  const [type, setType] = useState<'' | Hit['type']>('');
  const [res, setRes] = useState<{ total: number; counts: Record<string, number>; hits: Hit[] } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (q.trim().length < 2) {
      setRes(null);
      return;
    }
    const t = setTimeout(() => {
      api<{ total: number; counts: Record<string, number>; hits: Hit[] }>(`/search?${new URLSearchParams({ q })}`)
        .then((r) => {
          setRes(r);
          setErr(null);
        })
        .catch((e) => setErr((e as Error).message));
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  const hits = (res?.hits ?? []).filter((h) => !type || h.type === type);
  return (
    <div className="page">
      <PageHeader title="Ara" subtitle="Dosyalar, belgeler (taranmış belgelerin yazısı dahil), dilekçeler, sözleşmeler, notlar ve kararlar" />
      <label className="search big-search">
        <Icon name="search" />
        <input autoFocus placeholder="ör. fazla mesai tanık, 2026/412, Deniz İnşaat" value={q} onChange={(e) => setQ(e.target.value)} />
      </label>
      <ErrorText error={err} />
      {res && (
        <>
          <Tabs
            value={type}
            onChange={setType}
            items={[
              ['', `Tümü (${res.total})`],
              ...(Object.keys(TYPE_LABEL) as Hit['type'][]).filter((k) => res.counts[k]).map((k) => [k, `${TYPE_LABEL[k]} (${res.counts[k]})`] as ['' | Hit['type'], string]),
            ]}
          />
          {hits.length === 0 ? (
            <Empty icon="search">Sonuç yok.</Empty>
          ) : (
            <ul className="search-hits">
              {hits.map((h) => (
                <li key={`${h.type}-${h.id}`} className="clickable" onClick={() => go({ name: h.link.name, id: h.link.id, tab: h.link.tab } as unknown as View)}>
                  <span className="sh-icon">
                    <Icon name={TYPE_ICON[h.type]} />
                  </span>
                  <span className="item-text">
                    <strong>
                      <Highlight text={h.title} q={q} />
                    </strong>
                    <span className="muted small">
                      {TYPE_LABEL[h.type]}
                      {h.context ? ` · ${h.context}` : ''}
                    </span>
                    <span className="sh-snippet">
                      <Highlight text={h.snippet} q={q} />
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      {!res && q.trim().length < 2 && <p className="muted small">En az iki harf yazın. Ctrl+K ile her sayfadan aramaya gelebilirsiniz.</p>}
    </div>
  );
}
