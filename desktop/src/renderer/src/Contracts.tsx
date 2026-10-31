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
import { ArmorTab, FilePick, fileToText, readContractFile as readFile, LibraryPanel, PlaybookPanel, ScheduleCard, SigningTab, VersionsTab } from './Clm';
import { Card, DueLabel, Empty, ErrorText, Field, formatDate, formatTL, Icon, PageHeader, Stat, Tabs, useAsync } from './ui';

const RISK_LABEL = { yuksek: 'Yüksek risk', orta: 'Orta risk', dusuk: 'Düşük risk' } as const;

export function ContractsView({ go }: { go: Go }) {
  const list = useAsync(() => api<ContractSummary[]>('/contracts'), []);
  const templates = useAsync(() => api<ContractTemplate[]>('/contract-templates'), []);
  const [mode, setMode] = useState<'list' | 'new' | 'review' | 'playbook' | 'library'>('list');
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
            <button onClick={() => setMode(mode === 'playbook' ? 'list' : 'playbook')}>
              <Icon name="shield" /> Kural bankası
            </button>
            <button onClick={() => setMode(mode === 'library' ? 'list' : 'library')}>
              <Icon name="library" /> Madde kütüphanesi
            </button>
            <button onClick={() => setMode('review')}>
              <Icon name="search" /> Karşı taraf taslağını incele
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
      {mode === 'review' && <QuickReview onClose={() => setMode('list')} onCreated={(id) => go({ name: 'contract', id })} />}
      {mode === 'playbook' && <PlaybookPanel />}
      {mode === 'library' && <LibraryPanel />}

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
          <textarea rows={14} className="mono" value={form.body} onChange={set('body')} placeholder="Şablon seçin, metni yapıştırın ya da dosyadan alın (Word, PDF, UYAP, TIF, resim)" />
        </Field>
        <div className="form-actions">
          <ErrorText error={err} />
          <FilePick
            label="Dosyadan al"
            onFile={async (f) => {
              try {
                const text = await fileToText(f);
                setForm((prev) => ({ ...prev, body: text, title: prev.title || f.name.replace(/\.[^.]+$/, '') }));
                setErr(null);
              } catch (ex) {
                setErr((ex as Error).message);
              }
            }}
          />
          <button className="primary" type="submit">
            Sözleşmeyi oluştur
          </button>
        </div>
      </form>
    </Card>
  );
}

function QuickReview({ onClose, onCreated }: { onClose: () => void; onCreated: (id: number) => void }) {
  const [kind, setKind] = useState('kat-karsiligi');
  const [side, setSide] = useState('arsa_sahibi');
  const [body, setBody] = useState('');
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function start(file?: File) {
    setBusy(true);
    setErr(null);
    try {
      const name = title.trim() || file?.name.replace(/\.[^.]+$/, '') || 'Karşı taraf taslağı';
      // Önce dosya okunur (resimse OCR); okunamazsa boş sözleşme açılmaz.
      const payload: { fileBase64?: string; text?: string } = file ? await readFile(file) : { text: body };
      if (!payload.fileBase64 && !payload.text?.trim()) throw new Error('Dosyada okunabilir yazı bulunamadı.');
      const c = await api<ContractDetail>('/contracts', { body: { title: name, kind } });
      await api(`/contracts/${c.id}/side`, { method: 'PUT', body: { side } });
      await api(`/contracts/${c.id}/versions`, { body: { ...payload, source: 'karsi' } });
      onCreated(c.id);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Karşı taraf taslağını incele" actions={<button className="ghost" onClick={onClose}>Kapat</button>}>
      <p className="muted small">
        Karşı taraftan gelen taslağı yükleyin: Word, PDF, UYAP (.udf), TIF ya da fotoğraf (JPG, PNG, BMP). Fotoğraf ve taranmış belgelerdeki yazı bilgisayarınızda okunur. Timay saniyeler içinde 0–100 arası risk puanı verir, lehte ve aleyhte maddeleri işaretler,
        eksik ve mevzuata aykırı hükümleri gösterir ve kütüphanenizden düzeltme önerir.
      </p>
      <div className="form-grid cols-3">
        <Field label="Sözleşme türü">
          <select value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="kat-karsiligi">Kat karşılığı inşaat</option>
            <option value="hizmet">Hizmet</option>
            <option value="satis">Satış</option>
            <option value="kira-konut">Kira</option>
            <option value="gizlilik">Gizlilik</option>
            <option value="">Diğer</option>
          </select>
        </Field>
        <Field label="Biz kimi temsil ediyoruz?">
          <select value={side} onChange={(e) => setSide(e.target.value)}>
            <option value="arsa_sahibi">Arsa sahibi</option>
            <option value="yuklenici">Yüklenici</option>
            <option value="genel">Genel</option>
          </select>
        </Field>
        <Field label="Sözleşme adı">
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Dosya adından alınır" />
        </Field>
      </div>
      <div className="upload-drop">
        <FilePick label="Dosya yükle ve incele" busy={busy} onFile={(f) => start(f)} />
        <span className="muted small">ya da metni aşağıya yapıştırın</span>
      </div>
      <textarea rows={8} className="mono" value={body} onChange={(e) => setBody(e.target.value)} placeholder="Sözleşme metnini buraya yapıştırın" />
      <div className="form-actions">
        <ErrorText error={err} />
        <button className="primary" disabled={!body.trim() || busy} onClick={() => start()}>
          İncele
        </button>
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
  const { data, error, setData, reload } = useAsync(() => api<ContractDetail>(`/contracts/${id}`), [id]);
  const [tab, setTab] = useState<'metin' | 'zirh' | 'taahhut' | 'versiyon' | 'imza' | 'bilgi'>('zirh');
  const [body, setBody] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [ob, setOb] = useState({ party: '', text: '', dueDate: '', amount: '' });
  const [info, setInfo] = useState({ title: '', parties: '', startDate: '', endDate: '', value: '' });
  const [comment, setComment] = useState('');

  useEffect(() => {
    if (!data) return;
    setBody(data.body);
    setInfo({ title: data.title, parties: data.parties, startDate: data.start_date, endDate: data.end_date, value: data.value_kurus ? String(data.value_kurus / 100).replace('.', ',') : '' });
  }, [data?.id, data?.body]);

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
        <Stat
          icon="shield"
          label={data.armor ? `Risk puanı · ${data.armor.critical} kritik madde` : 'Risk puanı'}
          value={data.armor ? `${data.armor.score}/100` : '—'}
          tone={!data.armor ? 'blue' : data.armor.band === 'yuksek' ? 'red' : data.armor.band === 'orta' ? 'amber' : 'green'}
          onClick={() => setTab('zirh')}
        />
        <Stat icon="clock" label="Açık taahhüt" value={open.length} tone="amber" onClick={() => setTab('taahhut')} />
        <Stat icon="wallet" label="Açık ödeme toplamı" value={formatTL(open.reduce((n, o) => n + o.amount_kurus, 0))} tone="violet" onClick={() => setTab('taahhut')} />
        <Stat icon="calendar" label="Bitiş" value={data.end_date ? formatDate(data.end_date) : 'Süresiz'} />
      </div>
      <ApprovalBar data={data} user={user} comment={comment} setComment={setComment} onAction={reviewAction} />
      <Tabs
        value={tab}
        onChange={setTab}
        items={[
          ['zirh', 'İnceleme ve risk puanı'],
          ['taahhut', `Takvim ve taahhütler (${open.length})`],
          ['versiyon', 'Versiyonlar'],
          ['imza', data.locked_at ? 'İmza (kilitli)' : 'İmza'],
          ['metin', 'Sözleşme metni'],
          ['bilgi', 'Bilgiler'],
        ]}
      />
      <ErrorText error={err} />

      {tab === 'zirh' && <ArmorTab data={data} onChanged={reload} />}
      {tab === 'versiyon' && <VersionsTab id={data.id} />}
      {tab === 'imza' && <SigningTab data={data} onChanged={reload} />}

      {tab === 'metin' && (
        <Card
          actions={
            <button className="primary" disabled={body === data.body || Boolean(data.locked_at)} onClick={() => save({ body })}>
              Kaydet
            </button>
          }
          title="Sözleşme metni"
        >
          <textarea className="editor mono" value={body} onChange={(e) => setBody(e.target.value)} readOnly={Boolean(data.locked_at)} />
        </Card>
      )}

      {tab === 'taahhut' && <ScheduleCard data={data} onChanged={reload} />}
      {tab === 'taahhut' && (
        <div className="grid-main-side">
          <Card title="Taahhüt ve ödeme takvimi" className="flush">
            {data.obligations.length === 0 ? (
              <Empty icon="clock">Henüz takipte taahhüt yok. “Sözleşmeden takvim çıkar” ile tarihleri otomatik ekleyin ya da aşağıdaki listeden “Takibe al” deyin.</Empty>
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

      {tab === 'taahhut' && data.body.trim() && (
        <Card title="Metinde bulunan taahhüt ve ödemeler">
          <AnalysisPanel analysis={data.analysis} onAddObligation={(party, text) => addOb(undefined, { party, text })} />
        </Card>
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
