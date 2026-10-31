import { useState, type FormEvent } from 'react';
import { api, type AgendaEvent, type CaseSummary, type Task, type TaskStatus, type User } from './api';
import type { Go } from './App';
import { Card, DueLabel, Empty, ErrorText, Field, formatDate, Icon, PageHeader, Tabs, today, useAsync } from './ui';

const KIND_LABEL: Record<AgendaEvent['kind'], string> = {
  durusma: 'Duruşma',
  sure: 'Yasal süre',
  gorev: 'Görev',
  taahhut: 'Taahhüt',
  sozlesme: 'Sözleşme',
  not: 'Not',
};

const WEEKDAYS = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'];

function iso(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Ayın görünen ilk gününden (pazartesi) başlayan 6 haftalık gün listesi. */
function monthDays(year: number, month: number) {
  const first = new Date(year, month, 1);
  const start = new Date(year, month, 1 - ((first.getDay() + 6) % 7));
  return Array.from({ length: 42 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
}

export function AgendaView({ go }: { go: Go }) {
  const now = new Date();
  const [cursor, setCursor] = useState({ year: now.getFullYear(), month: now.getMonth() });
  const [selected, setSelected] = useState(today());
  const days = monthDays(cursor.year, cursor.month);
  const from = iso(days[0]);
  const to = iso(days[days.length - 1]);
  const events = useAsync(() => api<AgendaEvent[]>(`/agenda?from=${from}&to=${to}`), [from, to]);
  const cases = useAsync(() => api<CaseSummary[]>('/cases'), []);
  const [form, setForm] = useState({ time: '', title: '', note: '', caseId: '' });
  const [err, setErr] = useState<string | null>(null);

  const byDay = new Map<string, AgendaEvent[]>();
  for (const e of events.data ?? []) byDay.set(e.date, [...(byDay.get(e.date) ?? []), e]);
  const dayEvents = byDay.get(selected) ?? [];
  const title = new Date(cursor.year, cursor.month, 1).toLocaleDateString('tr-TR', { month: 'long', year: 'numeric' });

  function shift(delta: number) {
    const d = new Date(cursor.year, cursor.month + delta, 1);
    setCursor({ year: d.getFullYear(), month: d.getMonth() });
  }

  function open(e: AgendaEvent) {
    if (e.caseId && e.kind === 'durusma') go({ name: 'case', id: e.caseId, tab: 'durusmalar' });
    else if (e.contractId) go({ name: 'contract', id: e.contractId });
    else if (e.kind === 'gorev') go({ name: 'tasks' });
    else if (e.kind === 'sure') go({ name: 'deadlines' });
    else if (e.caseId) go({ name: 'case', id: e.caseId });
  }

  async function add(ev: FormEvent) {
    ev.preventDefault();
    try {
      await api('/agenda', { body: { date: selected, time: form.time, title: form.title, note: form.note, caseId: form.caseId ? Number(form.caseId) : null } });
      setForm({ time: '', title: '', note: '', caseId: '' });
      setErr(null);
      events.reload();
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  async function remove(id: number) {
    await api(`/agenda/${id}`, { method: 'DELETE' });
    events.reload();
  }

  return (
    <div className="page">
      <PageHeader
        title="Ajanda"
        subtitle="Duruşmalar, görevler, sözleşme taahhütleri ve notlarınız tek takvimde"
        actions={
          <>
            <button onClick={() => shift(-1)} title="Önceki ay">
              ‹
            </button>
            <button
              onClick={() => {
                setCursor({ year: now.getFullYear(), month: now.getMonth() });
                setSelected(today());
              }}
            >
              Bugün
            </button>
            <button onClick={() => shift(1)} title="Sonraki ay">
              ›
            </button>
          </>
        }
      />
      <ErrorText error={events.error} />
      <div className="grid-main-side">
        <Card title={<span className="capitalize">{title}</span>} className="flush">
          <div className="calendar">
            {WEEKDAYS.map((w) => (
              <div key={w} className="cal-head">
                {w}
              </div>
            ))}
            {days.map((d) => {
              const key = iso(d);
              const list = byDay.get(key) ?? [];
              const classes = ['cal-day', d.getMonth() !== cursor.month && 'other', key === today() && 'today', key === selected && 'selected']
                .filter(Boolean)
                .join(' ');
              return (
                <button key={key} className={classes} onClick={() => setSelected(key)}>
                  <span className="cal-num">{d.getDate()}</span>
                  {list.slice(0, 3).map((e) => (
                    <span key={`${e.kind}${e.id}`} className={`cal-event ${e.kind}`}>
                      {e.time && `${e.time} `}
                      {e.title}
                    </span>
                  ))}
                  {list.length > 3 && <span className="cal-more">+{list.length - 3} daha</span>}
                </button>
              );
            })}
          </div>
          <div className="legend">
            {(Object.keys(KIND_LABEL) as AgendaEvent['kind'][]).map((k) => (
              <span key={k}>
                <i className={`dot ${k}`} /> {KIND_LABEL[k]}
              </span>
            ))}
          </div>
        </Card>

        <div className="stack">
          <Card title={formatDate(selected)}>
            {dayEvents.length === 0 ? (
              <Empty icon="calendar">Bu gün için kayıt yok.</Empty>
            ) : (
              <ul className="items">
                {dayEvents.map((e) => (
                  <li key={`${e.kind}${e.id}`} className={e.kind === 'not' ? '' : 'clickable'} onClick={() => e.kind !== 'not' && open(e)}>
                    <span className={`tag ${e.kind}`}>{KIND_LABEL[e.kind]}</span>
                    <span className="item-text">
                      <strong>
                        {e.time && `${e.time} · `}
                        {e.title}
                      </strong>
                      {e.detail && <span>{e.detail}</span>}
                    </span>
                    {e.kind === 'not' && (
                      <button className="ghost" title="Sil" onClick={() => remove(e.id)}>
                        ×
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card title="Bu güne not ekle">
            <form className="form-grid" onSubmit={add}>
              <Field label="Başlık" wide>
                <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="ör. Müvekkil görüşmesi" required />
              </Field>
              <Field label="Saat">
                <input type="time" value={form.time} onChange={(e) => setForm({ ...form, time: e.target.value })} />
              </Field>
              <Field label="Dosya">
                <select value={form.caseId} onChange={(e) => setForm({ ...form, caseId: e.target.value })}>
                  <option value="">—</option>
                  {cases.data?.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.title}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Not" wide>
                <textarea rows={2} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
              </Field>
              <div className="form-actions">
                <ErrorText error={err} />
                <button className="primary" type="submit">
                  <Icon name="plus" /> Ekle
                </button>
              </div>
            </form>
          </Card>
        </div>
      </div>
    </div>
  );
}

export function TasksView({ user, go }: { user: User; go: Go }) {
  const [filter, setFilter] = useState<'mine' | 'all'>('mine');
  const [mode, setMode] = useState<'pano' | 'liste'>('pano');
  const tasks = useAsync(() => api<Task[]>(filter === 'mine' ? '/tasks?mine=1' : '/tasks'), [filter]);
  return (
    <div className="page">
      <PageHeader
        title="Görevler"
        subtitle="Büro içinde iş verin, devredin ve takip edin"
        actions={
          <div className="segmented compact">
            <button className={mode === 'pano' ? 'active' : ''} onClick={() => setMode('pano')}>
              <Icon name="kanban" /> Pano
            </button>
            <button className={mode === 'liste' ? 'active' : ''} onClick={() => setMode('liste')}>
              <Icon name="check" /> Liste
            </button>
          </div>
        }
      />
      <Tabs
        value={filter}
        onChange={setFilter}
        items={[
          ['mine', 'Bana verilenler'],
          ['all', 'Bürodaki tüm görevler'],
        ]}
      />
      <ErrorText error={tasks.error} />
      {mode === 'pano' ? (
        <TaskBoard tasks={tasks.data ?? []} reload={tasks.reload} user={user} go={go} />
      ) : (
        <TaskList tasks={tasks.data ?? []} reload={tasks.reload} user={user} go={go} />
      )}
    </div>
  );
}

const COLUMNS: [TaskStatus, string][] = [
  ['yapilacak', 'Yapılacak'],
  ['devam', 'Devam ediyor'],
  ['inceleme', 'İncelemede'],
  ['tamam', 'Tamamlandı'],
];

/** Hammurabi tarzı görev panosu: kartlar sürüklenerek taşınır; "Tamamlandı"ya yalnızca kontrol eden taşıyabilir. */
function TaskBoard({ tasks, reload, user, go }: { tasks: Task[]; reload: () => void; user: User; go: Go }) {
  const [err, setErr] = useState<string | null>(null);
  const [dragging, setDragging] = useState<number | null>(null);
  const [over, setOver] = useState<TaskStatus | null>(null);
  const [adding, setAdding] = useState(false);

  async function move(id: number, status: TaskStatus) {
    const task = tasks.find((t) => t.id === id);
    if (!task || task.status === status) return;
    try {
      await api(`/tasks/${id}`, { method: 'PUT', body: { status } });
      setErr(null);
      reload();
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  return (
    <>
      <div className="board-toolbar">
        <ErrorText error={err} />
        <button className="primary" onClick={() => setAdding(!adding)}>
          <Icon name="plus" /> Yeni görev
        </button>
      </div>
      {adding && (
        <NewTaskForm
          user={user}
          onAdded={() => {
            setAdding(false);
            reload();
          }}
        />
      )}
      <div className="board">
        {COLUMNS.map(([status, label]) => {
          const items = tasks.filter((t) => (t.status ?? (t.done ? 'tamam' : 'yapilacak')) === status);
          return (
            <section
              key={status}
              className={`board-col ${status} ${over === status ? 'over' : ''}`}
              onDragOver={(e) => {
                e.preventDefault();
                setOver(status);
              }}
              onDragLeave={() => setOver(null)}
              onDrop={(e) => {
                e.preventDefault();
                setOver(null);
                if (dragging !== null) move(dragging, status);
                setDragging(null);
              }}
            >
              <header>
                <span className={`dot ${status}`} />
                {label}
                <span className="count">{items.length}</span>
              </header>
              {items.length === 0 && <div className="board-empty">Kart yok</div>}
              {items.map((t) => (
                <article
                  key={t.id}
                  className="board-card"
                  draggable
                  onDragStart={() => setDragging(t.id)}
                  onDragEnd={() => setDragging(null)}
                >
                  <strong>{t.title}</strong>
                  {t.case_title && (
                    <button className="link small" onClick={() => t.case_id && go({ name: 'case', id: t.case_id })}>
                      {t.case_title}
                    </button>
                  )}
                  <div className="board-meta">
                    <span className="avatar sm" title={`Sorumlu: ${t.assignee_name}`}>
                      {t.assignee_name.slice(0, 1).toLocaleUpperCase('tr')}
                    </span>
                    <span className="muted small">{t.assignee_name}</span>
                    {t.due_date && <DueLabel date={t.due_date} />}
                  </div>
                  {t.reviewer_name && (
                    <div className="muted small">
                      <Icon name="shield" /> Kontrol: {t.reviewer_id === user.id ? 'ben' : t.reviewer_name}
                    </div>
                  )}
                  <select className="compact" value={t.status} onChange={(e) => move(t.id, e.target.value as TaskStatus)} title="Sütunu değiştir">
                    {COLUMNS.map(([k, l]) => (
                      <option key={k} value={k} disabled={k === 'tamam' && Boolean(t.reviewer_id) && t.reviewer_id !== user.id && t.status !== 'tamam'}>
                        {l}
                      </option>
                    ))}
                  </select>
                </article>
              ))}
            </section>
          );
        })}
      </div>
    </>
  );
}

function NewTaskForm({ user, caseId, onAdded }: { user: User; caseId?: number; onAdded: () => void }) {
  const users = useAsync(() => api<User[]>('/users'), []);
  const cases = useAsync(() => (caseId ? Promise.resolve([] as CaseSummary[]) : api<CaseSummary[]>('/cases')), [caseId]);
  const [form, setForm] = useState({ title: '', assigneeId: String(user.id), reviewerId: '', dueDate: '', caseId: '' });
  const [err, setErr] = useState<string | null>(null);

  async function add(e: FormEvent) {
    e.preventDefault();
    try {
      await api('/tasks', {
        body: {
          title: form.title,
          assigneeId: Number(form.assigneeId),
          reviewerId: form.reviewerId ? Number(form.reviewerId) : null,
          dueDate: form.dueDate || undefined,
          caseId: caseId ?? (form.caseId ? Number(form.caseId) : null),
        },
      });
      setForm({ ...form, title: '', dueDate: '' });
      setErr(null);
      onAdded();
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  return (
    <Card title="Yeni görev ver">
      <form className="form-grid" onSubmit={add}>
        <Field label="Görev" wide>
          <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="ör. Bilirkişi raporuna itiraz hazırla" required />
        </Field>
        <Field label="Kime">
          <select value={form.assigneeId} onChange={(e) => setForm({ ...form, assigneeId: e.target.value })}>
            {users.data?.map((u) => (
              <option key={u.id} value={u.id}>
                {u.id === user.id ? `${u.name} (ben)` : u.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Kontrol eden">
          <select value={form.reviewerId} onChange={(e) => setForm({ ...form, reviewerId: e.target.value })}>
            <option value="">— Yok (sorumlu tamamlar) —</option>
            {users.data?.map((u) => (
              <option key={u.id} value={u.id}>
                {u.id === user.id ? `${u.name} (ben)` : u.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Son tarih">
          <input type="date" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} />
        </Field>
        {!caseId && (
          <Field label="Dava dosyası">
            <select value={form.caseId} onChange={(e) => setForm({ ...form, caseId: e.target.value })}>
              <option value="">— Dosyaya bağlı değil —</option>
              {cases.data?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </select>
          </Field>
        )}
        <div className="form-actions">
          <ErrorText error={err} />
          <button className="primary" type="submit">
            <Icon name="plus" /> Görevi ver
          </button>
        </div>
      </form>
    </Card>
  );
}

export function TaskList({ tasks, reload, user, go, caseId }: { tasks: Task[]; reload: () => void; user: User; go: Go; caseId?: number }) {
  const users = useAsync(() => api<User[]>('/users'), []);
  const [err, setErr] = useState<string | null>(null);
  const [showDone, setShowDone] = useState(false);

  async function update(id: number, body: { done?: boolean; assigneeId?: number }) {
    try {
      await api(`/tasks/${id}`, { method: 'PUT', body });
      reload();
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  const open = tasks.filter((t) => !t.done);
  const done = tasks.filter((t) => t.done);
  const shown = showDone ? [...open, ...done] : open;

  return (
    <div className="grid-main-side">
      <Card
        title={`Açık görevler (${open.length})`}
        className="flush"
        actions={
          done.length > 0 && (
            <button className="link" onClick={() => setShowDone(!showDone)}>
              {showDone ? 'Bitenleri gizle' : `Bitenleri göster (${done.length})`}
            </button>
          )
        }
      >
        <ErrorText error={err} />
        {shown.length === 0 ? (
          <Empty icon="check">Açık görev yok.</Empty>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th />
                <th>Görev</th>
                <th>Sorumlu</th>
                <th>Son tarih</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((t) => (
                <tr key={t.id} className={t.done ? 'done' : ''}>
                  <td className="check-cell">
                    <input type="checkbox" checked={Boolean(t.done)} onChange={(e) => update(t.id, { done: e.target.checked })} />
                  </td>
                  <td>
                    <strong>{t.title}</strong>
                    <div className="muted small">
                      {t.case_title && !caseId && (
                        <button className="link" onClick={() => t.case_id && go({ name: 'case', id: t.case_id })}>
                          {t.case_title}
                        </button>
                      )}
                      {t.case_title && !caseId && ' · '}veren: {t.created_by_name}
                      {t.reviewer_name && ` · kontrol: ${t.reviewer_name}`}
                      {t.status === 'inceleme' && <span className="badge incelemede">İncelemede</span>}
                    </div>
                  </td>
                  <td>
                    <select
                      className="compact"
                      value={t.assignee_id}
                      onChange={(e) => update(t.id, { assigneeId: Number(e.target.value) })}
                      title="Görevi devret"
                    >
                      {users.data?.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.name}
                        </option>
                      )) ?? <option value={t.assignee_id}>{t.assignee_name}</option>}
                    </select>
                  </td>
                  <td>{t.due_date ? <DueLabel date={t.due_date} /> : <span className="muted">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      <NewTaskForm user={user} caseId={caseId} onAdded={reload} />
    </div>
  );
}
