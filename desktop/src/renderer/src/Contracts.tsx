import { useEffect, useState, type FormEvent } from 'react';
import {
  api,
  CONTRACT_STATUS_LABEL,
  type ContractAnalysis,
  type ContractDetail,
  type ContractStatus,
  type ContractSummary,
  type ContractTemplate,
  type User,
} from './api';
import type { Go } from './App';
import { Card, DueLabel, Empty, ErrorText, Field, formatDate, formatTL, Icon, PageHeader, Stat, Tabs, useAsync } from './ui';

const RISK_LABEL = { yuksek: 'Yüksek risk', orta: 'Orta risk', dusuk: 'Düşük risk' } as const;

export function ContractsView({ go }: { go: Go }) {
  const list = useAsync(() => api<ContractSummary[]>('/contracts'), []);
  const templates = useAsync(() => api<ContractTemplate[]>('/contract-templates'), []);
  const [mode, setMode] = useState<'list' | 'new' | 'review'>('list');
  const [filter, setFilter] = useState<'all' | ContractStatus>('all');
  const [query, setQuery] = useState('');

  const rows = (list.data ?? []).filter(
    (c) => (filter === 'all' || c.status === filter) && `${c.title} ${c.parties}`.toLocaleLowerCase('tr').includes(query.trim().toLocaleLowerCase('tr')),
  );
  const active = (list.data ?? []).filter((c) => c.status === 'yururlukte');

  return (
    <div className="page">
      <PageHeader
        title="Sözleşme yönetimi"
        subtitle="Sözleşme oluşturun, inceleyin; taahhütleri, ödemeleri ve riskleri takip edin"
        actions={
          <>
            <button onClick={() => setMode('review')}>
              <Icon name="search" /> Sözleşme incele
            </button>
            <button className="primary" onClick={() => setMode('new')}>
              <Icon name="plus" /> Yeni sözleşme
            </button>
          </>
        }
      />
      <ErrorText error={list.error} />
      <div className="stats">
        <Stat icon="contract" label="Toplam sözleşme" value={list.data?.length ?? 0} />
        <Stat icon="check" label="Yürürlükte" value={active.length} tone="green" />
        <Stat icon="clock" label="Açık taahhüt" value={(list.data ?? []).reduce((n, c) => n + c.open_obligations, 0)} tone="amber" />
        <Stat icon="wallet" label="Yürürlükteki toplam bedel" value={formatTL(active.reduce((n, c) => n + c.value_kurus, 0))} tone="violet" />
      </div>

      {mode === 'new' && <NewContract templates={templates.data ?? []} onCancel={() => setMode('list')} onCreated={(id) => go({ name: 'contract', id })} />}
      {mode === 'review' && <QuickReview onClose={() => setMode('list')} />}

      <Card className="flush">
        <div className="toolbar inset">
          <label className="search">
            <Icon name="search" />
            <input placeholder="Sözleşme ya da taraf ara" value={query} onChange={(e) => setQuery(e.target.value)} />
          </label>
          <Tabs
            value={filter}
            onChange={setFilter}
            items={[
              ['all', 'Tümü'],
              ['taslak', 'Taslak'],
              ['yururlukte', 'Yürürlükte'],
              ['sona_erdi', 'Sona erdi'],
            ]}
          />
        </div>
        {rows.length === 0 ? (
          <Empty icon="contract">Henüz sözleşme yok. “Yeni sözleşme” ile hazır şablondan başlayın.</Empty>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Sözleşme</th>
                <th>Taraflar</th>
                <th>Süre</th>
                <th className="num">Bedel</th>
                <th>Açık taahhüt</th>
                <th>Durum</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id} className="clickable" onClick={() => go({ name: 'contract', id: c.id })}>
                  <td>
                    <strong>{c.title}</strong>
                  </td>
                  <td className="muted">{c.parties}</td>
                  <td>
                    {formatDate(c.start_date)}
                    {c.end_date && ` – ${formatDate(c.end_date)}`}
                  </td>
                  <td className="num">{c.value_kurus ? formatTL(c.value_kurus) : '—'}</td>
                  <td>{c.open_obligations > 0 ? <span className="badge incelemede">{c.open_obligations}</span> : <span className="muted">—</span>}</td>
                  <td>
                    <span className={`badge c-${c.status}`}>{CONTRACT_STATUS_LABEL[c.status]}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}

function NewContract({ templates, onCancel, onCreated }: { templates: ContractTemplate[]; onCancel: () => void; onCreated: (id: number) => void }) {
  const [form, setForm] = useState({ kind: '', title: '', parties: '', startDate: '', endDate: '', value: '', body: '' });
  const [err, setErr] = useState<string | null>(null);
  const set = (key: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [key]: e.target.value });

  function pick(id: string) {
    const t = templates.find((x) => x.id === id);
    setForm({ ...form, kind: id, title: form.title || (t?.title ?? ''), body: t?.body ?? '' });
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    try {
      const c = await api<ContractDetail>('/contracts', { body: form });
      onCreated(c.id);
    } catch (ex) {
      setErr((ex as Error).message);
    }
  }

  return (
    <Card title="Yeni sözleşme" actions={<button className="ghost" onClick={onCancel}>Kapat</button>}>
      <div className="template-grid">
        <button className={`template ${form.kind === '' ? 'selected' : ''}`} onClick={() => setForm({ ...form, kind: '', body: '' })}>
          <Icon name="file" />
          <span>
            <strong>Boş sözleşme</strong>
            <span>Kendi metninizi yazın ya da yapıştırın</span>
          </span>
        </button>
        {templates.map((t) => (
          <button key={t.id} className={`template ${form.kind === t.id ? 'selected' : ''}`} onClick={() => pick(t.id)}>
            <Icon name="contract" />
            <span>
              <strong>{t.title}</strong>
              <span>{t.description}</span>
            </span>
          </button>
        ))}
      </div>
      <form className="form-grid" onSubmit={submit}>
        <Field label="Sözleşme adı">
          <input value={form.title} onChange={set('title')} required />
        </Field>
        <Field label="Taraflar">
          <input value={form.parties} onChange={set('parties')} placeholder="ör. Ahmet Yılmaz – Deniz Ltd. Şti." />
        </Field>
        <Field label="Başlangıç">
          <input type="date" value={form.startDate} onChange={set('startDate')} />
        </Field>
        <Field label="Bitiş">
          <input type="date" value={form.endDate} onChange={set('endDate')} />
        </Field>
        <Field label="Sözleşme bedeli (TL)">
          <input value={form.value} onChange={set('value')} placeholder="ör. 250.000" inputMode="decimal" />
        </Field>
        <Field label="Sözleşme metni" wide>
          <textarea rows={14} className="mono" value={form.body} onChange={set('body')} placeholder="Şablon seçin ya da metni buraya yapıştırın" />
        </Field>
        <div className="form-actions">
          <ErrorText error={err} />
          <button className="primary" type="submit">
            Sözleşmeyi oluştur
          </button>
        </div>
      </form>
    </Card>
  );
}

function QuickReview({ onClose }: { onClose: () => void }) {
  const [body, setBody] = useState('');
  const [result, setResult] = useState<ContractAnalysis | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function run() {
    try {
      setResult(await api<ContractAnalysis>('/contracts/analyze', { body: { body } }));
      setErr(null);
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  return (
    <Card title="Sözleşme incele" actions={<button className="ghost" onClick={onClose}>Kapat</button>}>
      <p className="muted small">
        Karşı taraftan gelen sözleşmeyi yapıştırın. Timay riskli maddeleri, eksik hükümleri, tarafların taahhütlerini ve ödeme yükümlülüklerini
        çıkarır. Metin kaydedilmez.
      </p>
      <div className="grid-main-side">
        <div>
          <textarea rows={16} className="mono" value={body} onChange={(e) => setBody(e.target.value)} placeholder="Sözleşme metnini buraya yapıştırın" />
          <div className="form-actions">
            <ErrorText error={err} />
            <button className="primary" disabled={!body.trim()} onClick={run}>
              İncele
            </button>
          </div>
        </div>
        <div>{result ? <AnalysisPanel analysis={result} /> : <Empty icon="search">Sonuçlar burada görünecek.</Empty>}</div>
      </div>
    </Card>
  );
}

function AnalysisPanel({ analysis, onAddObligation }: { analysis: ContractAnalysis; onAddObligation?: (party: string, text: string) => void }) {
  const high = analysis.risks.filter((r) => r.level === 'yuksek').length;
  return (
    <div className="analysis">
      <div className="mini-stats">
        <span className={high ? 'bad' : 'ok'}>
          <strong>{analysis.risks.length}</strong> risk ({high} yüksek)
        </span>
        <span>
          <strong>{analysis.obligations.length}</strong> taahhüt
        </span>
        <span>
          <strong>{analysis.payments.length}</strong> ödeme
        </span>
      </div>
      <h3>Riskler</h3>
      {analysis.risks.length === 0 ? (
        <p className="muted small">Bilinen risk kalıbı bulunmadı.</p>
      ) : (
        <ul className="risks">
          {analysis.risks.map((r, i) => (
            <li key={i} className={`risk ${r.level}`}>
              <span className={`risk-level ${r.level}`}>{RISK_LABEL[r.level]}</span>
              <strong>{r.title}</strong>
              <p>{r.note}</p>
              {r.quote && <blockquote>{r.quote}</blockquote>}
            </li>
          ))}
        </ul>
      )}
      <h3>Taahhütler</h3>
      {analysis.obligations.length === 0 ? (
        <p className="muted small">Taahhüt cümlesi bulunamadı.</p>
      ) : (
        <ul className="items compact">
          {analysis.obligations.map((o, i) => (
            <li key={i}>
              <span className="tag">{o.party || 'Taraf'}</span>
              <span className="item-text">
                <span>{o.text}</span>
              </span>
              {onAddObligation && (
                <button className="link" onClick={() => onAddObligation(o.party, o.text)}>
                  Takibe al
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      <h3>Ödemeler ve borçlar</h3>
      {analysis.payments.length === 0 ? (
        <p className="muted small">Ödeme hükmü bulunamadı.</p>
      ) : (
        <ul className="items compact">
          {analysis.payments.map((p, i) => (
            <li key={i}>
              <span className="item-text">
                <span>{p.text}</span>
              </span>
              <span className="money-tag">{p.amounts.join(', ')}</span>
            </li>
          ))}
        </ul>
      )}
      {analysis.dates.length > 0 && (
        <>
          <h3>Geçen tarihler</h3>
          <div className="chips">
            {analysis.dates.map((d) => (
              <span key={d} className="chip static">
                {d}
              </span>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export function ContractView({ id, user, go }: { id: number; user: User; go: Go }) {
  const { data, error, setData } = useAsync(() => api<ContractDetail>(`/contracts/${id}`), [id]);
  const [tab, setTab] = useState<'metin' | 'analiz' | 'taahhut' | 'bilgi'>('analiz');
  const [body, setBody] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [ob, setOb] = useState({ party: '', text: '', dueDate: '', amount: '' });
  const [info, setInfo] = useState({ title: '', parties: '', startDate: '', endDate: '', value: '' });
  const [comment, setComment] = useState('');

  useEffect(() => {
    if (!data) return;
    setBody(data.body);
    setInfo({ title: data.title, parties: data.parties, startDate: data.start_date, endDate: data.end_date, value: data.value_kurus ? String(data.value_kurus / 100).replace('.', ',') : '' });
  }, [data?.id]);

  if (!data) return <ErrorText error={error} />;

  async function save(payload: unknown) {
    try {
      setData(await api<ContractDetail>(`/contracts/${id}`, { method: 'PUT', body: payload }));
      setErr(null);
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  async function addOb(e?: FormEvent, preset?: { party: string; text: string }) {
    e?.preventDefault();
    try {
      setData(await api<ContractDetail>(`/contracts/${id}/obligations`, { body: preset ?? ob }));
      if (!preset) setOb({ party: '', text: '', dueDate: '', amount: '' });
      setErr(null);
    } catch (ex) {
      setErr((ex as Error).message);
    }
  }

  async function reviewAction(path: string, body: unknown = {}) {
    try {
      setData(await api<ContractDetail>(`/contracts/${id}${path}`, { body }));
      setComment('');
      setErr(null);
    } catch (ex) {
      setErr((ex as Error).message);
    }
  }

  async function toggle(obId: number, done: boolean) {
    setData(await api<ContractDetail>(`/obligations/${obId}`, { method: 'PUT', body: { done } }));
  }

  const open = data.obligations.filter((o) => !o.done);
  const high = data.analysis.risks.filter((r) => r.level === 'yuksek').length;

  return (
    <div className="page">
      <PageHeader
        back={() => go({ name: 'contracts' })}
        title={data.title}
        subtitle={[data.parties, data.start_date && `${formatDate(data.start_date)}${data.end_date ? ` – ${formatDate(data.end_date)}` : ''}`, data.value_kurus ? formatTL(data.value_kurus) : '']
          .filter(Boolean)
          .join(' · ')}
        actions={
          <select className={`status-select c-${data.status}`} value={data.status} onChange={(e) => save({ status: e.target.value })}>
            {(Object.keys(CONTRACT_STATUS_LABEL) as ContractStatus[]).map((s) => (
              <option key={s} value={s}>
                {CONTRACT_STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        }
      />
      <div className="stats">
        <Stat icon="alert" label="Yüksek risk" value={high} tone={high ? 'red' : 'green'} onClick={() => setTab('analiz')} />
        <Stat icon="clock" label="Açık taahhüt" value={open.length} tone="amber" onClick={() => setTab('taahhut')} />
        <Stat icon="wallet" label="Açık ödeme toplamı" value={formatTL(open.reduce((n, o) => n + o.amount_kurus, 0))} tone="violet" onClick={() => setTab('taahhut')} />
        <Stat icon="calendar" label="Bitiş" value={data.end_date ? formatDate(data.end_date) : 'Süresiz'} />
      </div>
      <ApprovalBar data={data} user={user} comment={comment} setComment={setComment} onAction={reviewAction} />
      <Tabs
        value={tab}
        onChange={setTab}
        items={[
          ['analiz', 'İnceleme ve riskler'],
          ['taahhut', `Taahhüt ve borçlar (${open.length})`],
          ['metin', 'Sözleşme metni'],
          ['bilgi', 'Bilgiler'],
        ]}
      />
      <ErrorText error={err} />

      {tab === 'analiz' && (
        <Card>
          {data.body.trim() ? (
            <AnalysisPanel analysis={data.analysis} onAddObligation={(party, text) => addOb(undefined, { party, text })} />
          ) : (
            <Empty icon="contract">İnceleme için önce sözleşme metnini girin.</Empty>
          )}
        </Card>
      )}

      {tab === 'metin' && (
        <Card
          actions={
            <button className="primary" disabled={body === data.body} onClick={() => save({ body })}>
              Kaydet
            </button>
          }
          title="Sözleşme metni"
        >
          <textarea className="editor mono" value={body} onChange={(e) => setBody(e.target.value)} />
        </Card>
      )}

      {tab === 'taahhut' && (
        <div className="grid-main-side">
          <Card title="Taahhüt ve ödeme takvimi" className="flush">
            {data.obligations.length === 0 ? (
              <Empty icon="clock">Henüz takipte taahhüt yok. İnceleme sekmesinden “Takibe al” ile ekleyebilirsiniz.</Empty>
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th />
                    <th>Taahhüt / borç</th>
                    <th>Taraf</th>
                    <th>Son tarih</th>
                    <th className="num">Tutar</th>
                  </tr>
                </thead>
                <tbody>
                  {data.obligations.map((o) => (
                    <tr key={o.id} className={o.done ? 'done' : ''}>
                      <td className="check-cell">
                        <input type="checkbox" checked={Boolean(o.done)} onChange={(e) => toggle(o.id, e.target.checked)} />
                      </td>
                      <td>{o.text}</td>
                      <td>{o.party && <span className="tag">{o.party}</span>}</td>
                      <td>{o.due_date ? <DueLabel date={o.due_date} /> : <span className="muted">—</span>}</td>
                      <td className="num">{o.amount_kurus ? formatTL(o.amount_kurus) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
          <Card title="Taahhüt ekle">
            <form className="form-grid" onSubmit={addOb}>
              <Field label="Taahhüt ya da borç" wide>
                <textarea rows={2} value={ob.text} onChange={(e) => setOb({ ...ob, text: e.target.value })} required />
              </Field>
              <Field label="Taraf">
                <input value={ob.party} onChange={(e) => setOb({ ...ob, party: e.target.value })} placeholder="ör. Kiracı" />
              </Field>
              <Field label="Son tarih">
                <input type="date" value={ob.dueDate} onChange={(e) => setOb({ ...ob, dueDate: e.target.value })} />
              </Field>
              <Field label="Tutar (TL)" wide>
                <input value={ob.amount} onChange={(e) => setOb({ ...ob, amount: e.target.value })} inputMode="decimal" />
              </Field>
              <div className="form-actions">
                <button className="primary" type="submit">
                  <Icon name="plus" /> Ekle
                </button>
              </div>
            </form>
          </Card>
        </div>
      )}

      {tab === 'bilgi' && (
        <Card title="Sözleşme bilgileri">
          <form
            className="form-grid"
            onSubmit={(e) => {
              e.preventDefault();
              save(info);
            }}
          >
            <Field label="Sözleşme adı">
              <input value={info.title} onChange={(e) => setInfo({ ...info, title: e.target.value })} />
            </Field>
            <Field label="Taraflar">
              <input value={info.parties} onChange={(e) => setInfo({ ...info, parties: e.target.value })} />
            </Field>
            <Field label="Başlangıç">
              <input type="date" value={info.startDate} onChange={(e) => setInfo({ ...info, startDate: e.target.value })} />
            </Field>
            <Field label="Bitiş">
              <input type="date" value={info.endDate} onChange={(e) => setInfo({ ...info, endDate: e.target.value })} />
            </Field>
            <Field label="Bedel (TL)">
              <input value={info.value} onChange={(e) => setInfo({ ...info, value: e.target.value })} inputMode="decimal" />
            </Field>
            <div className="form-actions">
              <button className="primary" type="submit">
                Kaydet
              </button>
            </div>
          </form>
        </Card>
      )}
    </div>
  );
}

const REVIEW_LABEL = { '': 'Onaya gönderilmedi', incelemede: 'Onay bekliyor', onayli: 'Onaylı', duzeltme: 'Düzeltme istendi' } as const;

function ApprovalBar({
  data,
  user,
  comment,
  setComment,
  onAction,
}: {
  data: ContractDetail;
  user: User;
  comment: string;
  setComment: (v: string) => void;
  onAction: (path: string, body?: unknown) => void;
}) {
  const canReview = data.review_status === 'incelemede' && user.role === 'avukat' && Boolean(user.can_approve) && data.submitted_by !== user.id;
  const last = data.reviews.find((r) => r.action !== 'submit');
  return (
    <div className={`approval-bar ${data.review_status || 'none'}`}>
      <div className="approval-state">
        <Icon name={data.review_status === 'onayli' ? 'check' : data.review_status === 'duzeltme' ? 'alert' : 'clock'} />
        <span>
          <strong>Avukat onayı: {REVIEW_LABEL[data.review_status]}</strong>
          <span className="muted small">
            {data.review_status === 'incelemede' && `${data.submitted_by_name} gönderdi; gönderen dışında bir avukatın onayı gerekiyor.`}
            {data.review_status === 'onayli' && last && `${last.user_name} onayladı · ${last.created_at.slice(0, 16)}. Metin değişirse onay düşer.`}
            {data.review_status === 'duzeltme' && last && `${last.user_name}: “${last.comment}”`}
            {data.review_status === '' && 'Sözleşmeyi göndermeden önce başka bir avukata onaylatın.'}
          </span>
        </span>
      </div>
      <div className="approval-actions">
        {(data.review_status === '' || data.review_status === 'duzeltme') && (
          <button className="primary" onClick={() => onAction('/submit')}>
            Onaya gönder
          </button>
        )}
        {canReview && (
          <>
            <input placeholder="Not (düzeltme isterken zorunlu)" value={comment} onChange={(e) => setComment(e.target.value)} />
            <button onClick={() => onAction('/review', { action: 'request_changes', comment })}>Düzeltme iste</button>
            <button className="primary" onClick={() => onAction('/review', { action: 'approve', comment })}>
              Onayla
            </button>
          </>
        )}
      </div>
    </div>
  );
}
