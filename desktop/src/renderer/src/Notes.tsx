import { useState } from 'react';
import { api } from './api';
import type { Go } from './App';
import { Card, Empty, ErrorText, formatDate, Icon, PageHeader, useAsync } from './ui';

/*
 * Akıllı notlar: #etiketler, sabitleme; nottaki tarih, tutar ve kanun maddeleri tanınır,
 * tarih tek tıkla süre ya da görev olur.
 */

export interface Note {
  id: number;
  case_id: number | null;
  case_title: string | null;
  body: string;
  tags: string[];
  pinned: boolean;
  author: string;
  created_at: string;
  updated_at: string;
  insights: { dates: string[]; amounts: string[]; articles: string[] };
}

function NoteCard({ n, go, onChanged, showCase }: { n: Note; go: Go; onChanged: () => void; showCase?: boolean }) {
  const [edit, setEdit] = useState(false);
  const [body, setBody] = useState(n.body);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function act(fn: () => Promise<unknown>, done?: string) {
    setErr(null);
    try {
      await fn();
      if (done) setMsg(done);
      onChanged();
    } catch (e) {
      setErr((e as Error).message);
    }
  }
  const title = n.body.split('\n')[0].replace(/#[\p{L}\d_-]+/gu, '').trim().slice(0, 80) || 'Not';

  return (
    <li className={`note ${n.pinned ? 'pinned' : ''}`}>
      {edit ? (
        <>
          <textarea rows={4} value={body} onChange={(e) => setBody(e.target.value)} autoFocus />
          <div className="row">
            <button className="primary" onClick={() => act(() => api(`/notes/${n.id}`, { method: 'PUT', body: { body } }).then(() => setEdit(false)))}>
              Kaydet
            </button>
            <button onClick={() => setEdit(false)}>Vazgeç</button>
          </div>
        </>
      ) : (
        <p className="note-body">{n.body}</p>
      )}
      {(n.tags.length > 0 || n.insights.dates.length > 0 || n.insights.amounts.length > 0 || n.insights.articles.length > 0) && (
        <div className="note-chips">
          {n.tags.map((t) => (
            <span key={t} className="tag">
              #{t}
            </span>
          ))}
          {n.insights.articles.map((a) => (
            <span key={a} className="tag t-law">
              {a}
            </span>
          ))}
          {n.insights.amounts.map((a) => (
            <span key={a} className="tag t-money">
              {a}
            </span>
          ))}
          {n.insights.dates.map((d) => (
            <span key={d} className="note-date">
              <Icon name="calendar" /> {formatDate(d)}
              <button className="link small" onClick={() => act(() => api('/deadlines', { body: { title, dueDate: d, caseId: n.case_id } }), `${formatDate(d)} süre olarak eklendi.`)}>
                süre yap
              </button>
              <button className="link small" onClick={() => act(() => api('/tasks', { body: { title, dueDate: d, caseId: n.case_id } }), `${formatDate(d)} görev olarak eklendi.`)}>
                görev yap
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="note-foot">
        <span className="muted small">
          {showCase && (n.case_title ? <button className="link small" onClick={() => go({ name: 'case', id: n.case_id!, tab: 'notlar' })}>{n.case_title}</button> : 'Büro notu')}
          {showCase && ' · '}
          {n.author} · {formatDate(n.updated_at.slice(0, 10))}
        </span>
        <span className="row">
          <button className="ghost icon-btn" title={n.pinned ? 'Sabitlemeyi kaldır' : 'Sabitle (dava özetinde görünür)'} onClick={() => act(() => api(`/notes/${n.id}`, { method: 'PUT', body: { pinned: !n.pinned } }))}>
            <Icon name="pin" />
          </button>
          <button className="ghost icon-btn" title="Düzenle" onClick={() => setEdit(true)}>
            <Icon name="pen" />
          </button>
          <button className="ghost icon-btn" title="Sil" onClick={() => act(() => api(`/notes/${n.id}`, { method: 'DELETE' }))}>
            <Icon name="trash" />
          </button>
        </span>
      </div>
      {msg && <p className="success small">{msg}</p>}
      <ErrorText error={err} />
    </li>
  );
}

function NoteComposer({ caseId, onAdded }: { caseId?: number; onAdded: () => void }) {
  const [body, setBody] = useState('');
  const [pinned, setPinned] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function add() {
    setErr(null);
    try {
      await api('/notes', { body: { caseId, body, pinned } });
      setBody('');
      setPinned(false);
      onAdded();
    } catch (e) {
      setErr((e as Error).message);
    }
  }
  return (
    <div className="note-composer">
      <textarea
        rows={3}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Not yazın. #etiket ekleyebilirsiniz; tarih (12.11.2026), tutar (45.000 TL) ve kanun maddesi (TBK 117) kendiliğinden tanınır."
        onKeyDown={(e) => e.key === 'Enter' && (e.ctrlKey || e.metaKey) && body.trim() && add()}
      />
      <div className="row">
        <label className="check-line">
          <input type="checkbox" checked={pinned} onChange={(e) => setPinned(e.target.checked)} /> Sabitle
        </label>
        <button className="primary" disabled={!body.trim()} onClick={add}>
          <Icon name="plus" /> Not ekle
        </button>
      </div>
      <ErrorText error={err} />
    </div>
  );
}

export function CaseNotes({ caseId, go }: { caseId: number; go: Go }) {
  const list = useAsync(() => api<Note[]>(`/notes?caseId=${caseId}`), [caseId]);
  return (
    <Card title="Akıllı notlar">
      <NoteComposer caseId={caseId} onAdded={list.reload} />
      <ErrorText error={list.error} />
      {list.data?.length === 0 ? (
        <Empty icon="pen">Bu dosyada not yok.</Empty>
      ) : (
        <ul className="notes">
          {list.data?.map((n) => <NoteCard key={`${n.id}-${n.updated_at}`} n={n} go={go} onChanged={list.reload} />)}
        </ul>
      )}
    </Card>
  );
}

export function NotesView({ go }: { go: Go }) {
  const [q, setQ] = useState('');
  const [tag, setTag] = useState('');
  const list = useAsync(() => api<Note[]>(`/notes?${new URLSearchParams({ q, tag })}`), [q, tag]);
  const tags = [...new Set((list.data ?? []).flatMap((n) => n.tags))];
  return (
    <div className="page">
      <PageHeader title="Akıllı notlar" subtitle="Büronun ve dosyaların notları; etiketle süzün, tarihleri süre ya da göreve çevirin" />
      <Card title="Büro notu ekle">
        <NoteComposer onAdded={list.reload} />
      </Card>
      <Card className="flush">
        <div className="toolbar inset">
          <label className="search">
            <Icon name="search" />
            <input placeholder="Notlarda ara" value={q} onChange={(e) => setQ(e.target.value)} />
          </label>
          <div className="note-tags">
            {tag && (
              <button className="tag active" onClick={() => setTag('')}>
                #{tag} ✕
              </button>
            )}
            {!tag &&
              tags.slice(0, 12).map((t) => (
                <button key={t} className="tag" onClick={() => setTag(t)}>
                  #{t}
                </button>
              ))}
          </div>
        </div>
        {list.data?.length === 0 ? (
          <Empty icon="pen">Not bulunamadı.</Empty>
        ) : (
          <ul className="notes inset">
            {list.data?.map((n) => <NoteCard key={`${n.id}-${n.updated_at}`} n={n} go={go} onChanged={list.reload} showCase />)}
          </ul>
        )}
      </Card>
    </div>
  );
}
