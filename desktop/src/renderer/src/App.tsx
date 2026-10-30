import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import {
  api,
  ApiError,
  getServerUrl,
  hasToken,
  setServerUrl,
  setToken,
  STATUS_LABEL,
  type CaseDetail,
  type CaseSummary,
  type OpposingDetail,
  type OpposingSummary,
  type PetitionDetail,
  type PetitionSummary,
  type User,
} from './api';
import { ApprovalRecord, HighlightedText, needsAck, TeyitPanel } from './Teyit';

type View =
  | { name: 'cases' }
  | { name: 'case'; id: number }
  | { name: 'petition'; id: number }
  | { name: 'opposing'; id: number }
  | { name: 'team' }
  | { name: 'decisions' };

export function App() {
  const [user, setUser] = useState<User | null>(null);
  const [checking, setChecking] = useState(hasToken());

  useEffect(() => {
    if (!hasToken()) return;
    api<User>('/me')
      .then(setUser)
      .catch(() => setToken(null))
      .finally(() => setChecking(false));
  }, []);

  if (checking) return <div className="center muted">Yükleniyor…</div>;
  if (!user) return <AuthScreen onLogin={setUser} />;
  return (
    <Shell
      user={user}
      onLogout={() => {
        setToken(null);
        setUser(null);
      }}
    />
  );
}

function useAsync<T>(load: () => Promise<T>, deps: unknown[]) {
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

function ErrorText({ error }: { error: string | null }) {
  return error ? <p className="error">{error}</p> : null;
}

function AuthScreen({ onLogin }: { onLogin: (u: User) => void }) {
  const [mode, setMode] = useState<'login' | 'register' | 'invite'>('login');
  const [form, setForm] = useState({ officeName: '', name: '', email: '', password: '', token: '' });
  const [error, setError] = useState<string | null>(null);
  const [server, setServer] = useState(getServerUrl());
  const [editingServer, setEditingServer] = useState(false);
  const field = (key: keyof typeof form) => ({
    value: form[key],
    onChange: (e: { target: { value: string } }) => setForm({ ...form, [key]: e.target.value }),
  });

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const path = mode === 'login' ? '/login' : mode === 'register' ? '/register' : '/invites/accept';
      const result = await api<{ token: string; user: User }>(path, { body: form });
      setToken(result.token);
      onLogin(result.user);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <div className="center">
      <form className="card auth" onSubmit={submit}>
        <h1>Timay</h1>
        <p className="muted">Avukat onaylı yapay zekâ hukuk asistanı</p>
        <div className="tabs">
          <button type="button" className={mode === 'login' ? 'active' : ''} onClick={() => setMode('login')}>
            Giriş
          </button>
          <button type="button" className={mode === 'register' ? 'active' : ''} onClick={() => setMode('register')}>
            Büro aç
          </button>
          <button type="button" className={mode === 'invite' ? 'active' : ''} onClick={() => setMode('invite')}>
            Davet kodu
          </button>
        </div>
        {mode === 'register' && (
          <label>
            Büro adı
            <input {...field('officeName')} required />
          </label>
        )}
        {mode === 'invite' && (
          <label>
            Davet kodu
            <input {...field('token')} required />
          </label>
        )}
        {mode !== 'login' && (
          <label>
            Ad soyad
            <input {...field('name')} required />
          </label>
        )}
        {mode !== 'invite' && (
          <label>
            E-posta
            <input type="email" {...field('email')} required />
          </label>
        )}
        <label>
          Şifre
          <input type="password" minLength={8} {...field('password')} required />
        </label>
        <ErrorText error={error} />
        <button className="primary" type="submit">
          {mode === 'login' ? 'Giriş yap' : mode === 'register' ? 'Büroyu oluştur' : 'Hesabı oluştur'}
        </button>
        {editingServer ? (
          <div className="row server">
            <input value={server} onChange={(e) => setServer(e.target.value)} placeholder="https://" />
            <button
              type="button"
              onClick={() => {
                setServerUrl(server);
                setServer(getServerUrl());
                setEditingServer(false);
              }}
            >
              Kaydet
            </button>
          </div>
        ) : (
          <p className="muted small server">
            Sunucu: {server}{' '}
            <button type="button" className="link" onClick={() => setEditingServer(true)}>
              Değiştir
            </button>
          </p>
        )}
      </form>
    </div>
  );
}

function Shell({ user, onLogout }: { user: User; onLogout: () => void }) {
  const [view, setView] = useState<View>({ name: 'cases' });
  const nav = (name: 'cases' | 'team' | 'decisions', label: string) => (
    <button className={view.name === name ? 'active' : ''} onClick={() => setView({ name } as View)}>
      {label}
    </button>
  );

  let content: ReactNode;
  switch (view.name) {
    case 'cases':
      content = <CasesView open={(id) => setView({ name: 'case', id })} />;
      break;
    case 'case':
      content = (
        <CaseView
          id={view.id}
          openPetition={(id) => setView({ name: 'petition', id })}
          openOpposing={(id) => setView({ name: 'opposing', id })}
        />
      );
      break;
    case 'petition':
      content = <PetitionView id={view.id} user={user} back={(caseId) => setView({ name: 'case', id: caseId })} />;
      break;
    case 'opposing':
      content = <OpposingView id={view.id} back={(caseId) => setView({ name: 'case', id: caseId })} />;
      break;
    case 'team':
      content = <TeamView user={user} />;
      break;
    case 'decisions':
      content = <DecisionsView user={user} />;
      break;
  }

  return (
    <div className="shell">
      <nav className="sidebar">
        <div className="brand">Timay</div>
        {nav('cases', 'Dava dosyaları')}
        {nav('decisions', 'İçtihat arşivi')}
        {nav('team', 'Ekip')}
        <div className="spacer" />
        <div className="muted small">
          {user.name}
          <br />
          {user.role === 'avukat' ? 'Avukat' : 'Stajyer'}
        </div>
        <button onClick={onLogout}>Çıkış</button>
      </nav>
      <main>{content}</main>
    </div>
  );
}

function CasesView({ open }: { open: (id: number) => void }) {
  const { data, error } = useAsync(() => api<CaseSummary[]>('/cases'), []);
  const [title, setTitle] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);

  async function create(e: FormEvent) {
    e.preventDefault();
    try {
      const created = await api<CaseDetail>('/cases', { body: { title } });
      open(created.id);
    } catch (err) {
      setCreateError((err as Error).message);
    }
  }

  return (
    <section>
      <h2>Dava dosyaları</h2>
      <form className="row" onSubmit={create}>
        <input placeholder="Yeni dava başlığı, ör. Ahmet Yılmaz / X A.Ş. işçilik alacağı" value={title} onChange={(e) => setTitle(e.target.value)} required />
        <button className="primary" type="submit">
          Dosya aç
        </button>
      </form>
      <ErrorText error={error ?? createError} />
      <table>
        <thead>
          <tr>
            <th>Başlık</th>
            <th>Mahkeme</th>
            <th>Esas no</th>
            <th>Açılış</th>
          </tr>
        </thead>
        <tbody>
          {data?.map((c) => (
            <tr key={c.id} className="clickable" onClick={() => open(c.id)}>
              <td>{c.title}</td>
              <td>{c.court}</td>
              <td>{c.esas_no}</td>
              <td>{c.created_at.slice(0, 10)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {data?.length === 0 && <p className="muted">Henüz dava dosyası yok.</p>}
    </section>
  );
}

function CaseView({
  id,
  openPetition,
  openOpposing,
}: {
  id: number;
  openPetition: (id: number) => void;
  openOpposing: (id: number) => void;
}) {
  const { data, error, setData } = useAsync(() => api<CaseDetail>(`/cases/${id}`), [id]);
  const petitions = useAsync(() => api<PetitionSummary[]>(`/cases/${id}/petitions`), [id]);
  const opposing = useAsync(() => api<OpposingSummary[]>(`/cases/${id}/opposing`), [id]);
  const [opposingTitle, setOpposingTitle] = useState('');
  const [opposingBody, setOpposingBody] = useState('');
  const [saved, setSaved] = useState(false);
  const [petitionTitle, setPetitionTitle] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);

  if (!data) return <ErrorText error={error} />;

  const field = (key: 'title' | 'court' | 'esas_no' | 'parties' | 'facts') => ({
    value: data[key],
    onChange: (e: { target: { value: string } }) => {
      setSaved(false);
      setData({ ...data, [key]: e.target.value });
    },
  });

  async function save(e: FormEvent) {
    e.preventDefault();
    try {
      await api(`/cases/${id}`, {
        method: 'PUT',
        body: { title: data!.title, court: data!.court, esasNo: data!.esas_no, parties: data!.parties, facts: data!.facts },
      });
      setSaved(true);
    } catch (err) {
      setActionError((err as Error).message);
    }
  }

  async function newPetition(e: FormEvent) {
    e.preventDefault();
    try {
      const p = await api<PetitionDetail>('/petitions', { body: { caseId: id, title: petitionTitle, body: '' } });
      openPetition(p.id);
    } catch (err) {
      setActionError((err as Error).message);
    }
  }

  async function addOpposing(e: FormEvent) {
    e.preventDefault();
    try {
      const doc = await api<OpposingDetail>(`/cases/${id}/opposing`, { body: { title: opposingTitle, body: opposingBody } });
      openOpposing(doc.id);
    } catch (err) {
      setActionError((err as Error).message);
    }
  }

  return (
    <section className="two-col">
      <form className="card" onSubmit={save}>
        <h2>Dava dosyası</h2>
        <label>
          Başlık
          <input {...field('title')} required />
        </label>
        <div className="row">
          <label>
            Mahkeme
            <input {...field('court')} />
          </label>
          <label>
            Esas no
            <input {...field('esas_no')} placeholder="2026/123" />
          </label>
        </div>
        <label>
          Taraflar
          <textarea rows={3} {...field('parties')} />
        </label>
        <label>
          Olaylar
          <textarea rows={8} {...field('facts')} />
        </label>
        <div className="row">
          <button className="primary" type="submit">
            Kaydet
          </button>
          {saved && <span className="muted">Kaydedildi</span>}
        </div>
      </form>
      <div className="card">
        <h2>Dilekçeler</h2>
        <form className="row" onSubmit={newPetition}>
          <input placeholder="Dilekçe başlığı" value={petitionTitle} onChange={(e) => setPetitionTitle(e.target.value)} required />
          <button type="submit">Yeni dilekçe</button>
        </form>
        <ErrorText error={actionError ?? petitions.error} />
        <ul className="list">
          {petitions.data?.map((p) => (
            <li key={p.id} className="clickable" onClick={() => openPetition(p.id)}>
              <span>{p.title}</span>
              <StatusBadge status={p.status} />
              <span className="muted small">{p.author_name}</span>
            </li>
          ))}
        </ul>
        <h2 className="section-gap">Karşı taraf dilekçeleri</h2>
        <p className="muted small">Karşı tarafın dilekçesini yapıştırın; atıfları ve iddiaları teyit edilsin.</p>
        <form onSubmit={addOpposing}>
          <input
            className="full"
            placeholder="Başlık, ör. Davalı cevap dilekçesi"
            value={opposingTitle}
            onChange={(e) => setOpposingTitle(e.target.value)}
            required
          />
          <textarea rows={4} placeholder="Dilekçe metni" value={opposingBody} onChange={(e) => setOpposingBody(e.target.value)} required />
          <button type="submit">Ekle ve teyit et</button>
        </form>
        <ErrorText error={opposing.error} />
        <ul className="list">
          {opposing.data?.map((o) => (
            <li key={o.id} className="clickable" onClick={() => openOpposing(o.id)}>
              <span>{o.title}</span>
              <span className="muted small">{o.created_at.slice(0, 10)}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function OpposingView({ id, back }: { id: number; back: (caseId: number) => void }) {
  const { data, error, setData } = useAsync(() => api<OpposingDetail>(`/opposing/${id}`), [id]);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  if (!data) return <ErrorText error={error} />;

  async function deep() {
    setBusy(true);
    setActionError(null);
    try {
      setData(await api<OpposingDetail>(`/opposing/${id}/teyit/deep`, { body: {} }));
    } catch (err) {
      setActionError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <div className="row">
        <button onClick={() => back(data.case_id)}>← Dava dosyası</button>
        <h2 className="grow">{data.title}</h2>
        <span className="badge">Karşı taraf</span>
      </div>
      <div className="two-col wide-left">
        <div className="card">
          <HighlightedText body={data.body} items={data.teyit.items} />
        </div>
        <div className="card">
          <p className="muted small">Kırmızı dayanaklar karşı tarafın dilekçesinde doğrulanamayan noktalardır; cevabınızda kullanabilirsiniz.</p>
          <TeyitPanel report={data.teyit} onDeep={deep} deepBusy={busy} />
          <ErrorText error={actionError} />
        </div>
      </div>
    </section>
  );
}

function StatusBadge({ status }: { status: PetitionDetail['status'] }) {
  return <span className={`badge ${status}`}>{STATUS_LABEL[status]}</span>;
}

function PetitionView({ id, user, back }: { id: number; user: User; back: (caseId: number) => void }) {
  const { data, error, setData } = useAsync(() => api<PetitionDetail>(`/petitions/${id}`), [id]);
  const [body, setBody] = useState('');
  const [comment, setComment] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [colored, setColored] = useState(false);

  useEffect(() => {
    if (data) setBody(data.body);
  }, [data?.id, data?.version]);

  if (!data) return <ErrorText error={error} />;

  const editable = data.status === 'taslak' || data.status === 'duzeltme';
  const dirty = body !== data.body;
  const isWriter = data.author_id === user.id || data.versions.some((v) => v.created_by === user.id);
  const canReview = data.status === 'incelemede' && user.role === 'avukat' && !isWriter;

  const unacked = data.teyit.items.filter((i) => needsAck(i) && !data.acks.includes(i.key)).length;

  async function run(path: string, payload?: unknown) {
    setActionError(null);
    setBusy(path);
    try {
      setData(await api<PetitionDetail>(`/petitions/${id}${path}`, { body: payload ?? {} }));
      if (path === '/review') setComment('');
    } catch (err) {
      const e = err as ApiError;
      setActionError(e.message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <section>
      <div className="row">
        <button onClick={() => back(data.case_id)}>← Dava dosyası</button>
        <h2 className="grow">{data.title}</h2>
        <StatusBadge status={data.status} />
        <span className="muted small">Sürüm {data.version}</span>
      </div>
      <div className="two-col wide-left">
        <div className="card">
          {editable && !colored ? (
            <textarea className="editor" value={body} onChange={(e) => setBody(e.target.value)} />
          ) : (
            <HighlightedText body={editable ? body : data.body} items={data.teyit.items} />
          )}
          <div className="row">
            {editable && (
              <button onClick={() => setColored(!colored)} disabled={dirty && !colored} title={dirty ? 'Önce kaydedin' : ''}>
                {colored ? 'Düzenlemeye dön' : 'Renkli görünüm'}
              </button>
            )}
            {editable && (
              <button disabled={!dirty} onClick={() => run('/versions', { body })}>
                Yeni sürüm olarak kaydet
              </button>
            )}
            {editable && (
              <button className="primary" disabled={dirty} onClick={() => run('/submit')} title={dirty ? 'Önce kaydedin' : ''}>
                İncelemeye gönder
              </button>
            )}
          </div>
          {canReview && (
            <div className="review">
              <textarea rows={3} placeholder="İnceleme notu (düzeltme isterken zorunlu)" value={comment} onChange={(e) => setComment(e.target.value)} />
              <div className="row">
                <button
                  className="primary"
                  disabled={unacked > 0 || busy !== null}
                  onClick={() => run('/review', { action: 'approve', comment })}
                  title={unacked > 0 ? 'Önce sarı ve gri dayanakları işaretleyin' : ''}
                >
                  Onayla
                </button>
                <button onClick={() => run('/review', { action: 'request_changes', comment })}>Düzeltme iste</button>
                {unacked > 0 && <span className="muted small">Onay için {unacked} dayanağı işaretleyin.</span>}
              </div>
            </div>
          )}
          {data.status === 'incelemede' && isWriter && (
            <p className="muted small">Dilekçe incelemede. Yazan dışında bir avukatın onayı bekleniyor.</p>
          )}
          {data.status === 'onayli' && data.approval && <ApprovalRecord approval={data.approval} />}
          <ErrorText error={actionError} />
        </div>
        <div className="card">
          {dirty && <p className="muted small">Teyit raporu son kaydedilen sürüme aittir.</p>}
          <TeyitPanel
            report={data.teyit}
            acks={data.acks}
            canAck={canReview}
            onAck={(key, checked) => run('/teyit/ack', { key, checked })}
            onDeep={() => run('/teyit/deep')}
            deepBusy={busy === '/teyit/deep'}
          />
          <h3>İnceleme geçmişi</h3>
          {data.reviews.length === 0 && <p className="muted small">Henüz inceleme yok.</p>}
          <ul className="list">
            {data.reviews.map((r, i) => (
              <li key={i} className="column">
                <strong>
                  {r.reviewer_name}: {r.action === 'approve' ? 'onayladı' : 'düzeltme istedi'} (sürüm {r.version})
                </strong>
                {r.comment && <span>{r.comment}</span>}
                <span className="muted small">{r.created_at}</span>
              </li>
            ))}
          </ul>
          <h3>Sürümler</h3>
          <ul className="list">
            {data.versions.map((v) => (
              <li key={v.version}>
                <span>Sürüm {v.version}</span>
                <span className="muted small">
                  {v.created_by_name}, {v.created_at}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

function TeamView({ user }: { user: User }) {
  const { data, error } = useAsync(() => api<User[]>('/users'), []);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'avukat' | 'stajyer'>('avukat');
  const [invite, setInvite] = useState<string | null>(null);
  const [inviteError, setInviteError] = useState<string | null>(null);

  async function send(e: FormEvent) {
    e.preventDefault();
    try {
      const r = await api<{ token: string }>('/invites', { body: { email, role } });
      setInvite(r.token);
      setEmail('');
    } catch (err) {
      setInviteError((err as Error).message);
    }
  }

  return (
    <section>
      <h2>Ekip</h2>
      <ErrorText error={error} />
      <ul className="list">
        {data?.map((u) => (
          <li key={u.id}>
            <span>{u.name}</span>
            <span className="muted small">{u.email}</span>
            <span className="badge">{u.role === 'avukat' ? 'Avukat' : 'Stajyer'}</span>
          </li>
        ))}
      </ul>
      {user.role === 'avukat' && (
        <form className="card" onSubmit={send}>
          <h3>Ekibe davet et</h3>
          <div className="row">
            <input type="email" placeholder="E-posta" value={email} onChange={(e) => setEmail(e.target.value)} required />
            <select value={role} onChange={(e) => setRole(e.target.value as 'avukat' | 'stajyer')}>
              <option value="avukat">Avukat</option>
              <option value="stajyer">Stajyer</option>
            </select>
            <button className="primary" type="submit">
              Davet oluştur
            </button>
          </div>
          <ErrorText error={inviteError} />
          {invite && (
            <p>
              Davet kodu: <code>{invite}</code>
              <br />
              <span className="muted small">Bu kodu davet ettiğiniz kişiye iletin; giriş ekranındaki “Davet kodu” sekmesine yazacak.</span>
            </p>
          )}
        </form>
      )}
    </section>
  );
}

interface DecisionRow {
  id: number;
  court: string;
  chamber: string;
  esas_no: string;
  karar_no: string;
  decision_date: string;
  source_url: string;
  excerpt: string;
}

function DecisionsView({ user }: { user: User }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<DecisionRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ court: '', chamber: '', esasNo: '', kararNo: '', decisionDate: '', sourceUrl: '', text: '' });
  const [added, setAdded] = useState(false);

  async function search(e: FormEvent) {
    e.preventDefault();
    try {
      setResults(await api<DecisionRow[]>(`/decisions?q=${encodeURIComponent(q)}`));
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function add(e: FormEvent) {
    e.preventDefault();
    try {
      await api('/decisions', { body: form });
      setAdded(true);
      setForm({ court: '', chamber: '', esasNo: '', kararNo: '', decisionDate: '', sourceUrl: '', text: '' });
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const field = (key: keyof typeof form) => ({
    value: form[key],
    onChange: (e: { target: { value: string } }) => {
      setAdded(false);
      setForm({ ...form, [key]: e.target.value });
    },
  });

  return (
    <section className="two-col">
      <div>
        <h2>İçtihat arşivi</h2>
        <form className="row" onSubmit={search}>
          <input placeholder="Kavram, esas ya da karar numarası" value={q} onChange={(e) => setQ(e.target.value)} />
          <button className="primary" type="submit">
            Ara
          </button>
        </form>
        <ErrorText error={error} />
        {results?.length === 0 && <p className="muted">Sonuç bulunamadı.</p>}
        <ul className="list">
          {results?.map((d) => (
            <li key={d.id} className="column">
              <strong>
                {d.court} {d.chamber} · {d.esas_no} E. / {d.karar_no} K. {d.decision_date && `· ${d.decision_date}`}
              </strong>
              <span className="small">{d.excerpt}</span>
              {d.source_url && (
                <a href={d.source_url} target="_blank" rel="noreferrer" className="small">
                  Kaynağı aç
                </a>
              )}
            </li>
          ))}
        </ul>
      </div>
      {user.role === 'avukat' && (
        <form className="card" onSubmit={add}>
          <h3>Arşive karar ekle</h3>
          <p className="muted small">Yalnızca resmî kaynaktan (Yargıtay, UYAP Emsal) doğruladığınız kararları ekleyin.</p>
          <div className="row">
            <label>
              Mahkeme
              <input {...field('court')} placeholder="Yargıtay" required />
            </label>
            <label>
              Daire
              <input {...field('chamber')} placeholder="9. Hukuk Dairesi" />
            </label>
          </div>
          <div className="row">
            <label>
              Esas no
              <input {...field('esasNo')} placeholder="2021/1234" required />
            </label>
            <label>
              Karar no
              <input {...field('kararNo')} placeholder="2022/5678" required />
            </label>
            <label>
              Tarih
              <input type="date" {...field('decisionDate')} />
            </label>
          </div>
          <label>
            Kaynak bağlantısı
            <input {...field('sourceUrl')} placeholder="https://" />
          </label>
          <label>
            Karar metni
            <textarea rows={6} {...field('text')} />
          </label>
          <div className="row">
            <button className="primary" type="submit">
              Ekle
            </button>
            {added && <span className="muted">Eklendi</span>}
          </div>
        </form>
      )}
    </section>
  );
}
