import { useState, type FormEvent } from 'react';
import { api, type User } from './api';
import { ErrorText, PageHeader, useAsync } from './ui';

export function TeamView({ user }: { user: User }) {
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
    <div className="page narrow">
      <PageHeader title="Ekip" subtitle="Büronuzdaki avukatlar ve stajyerler" />
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
    </div>
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

export function DecisionsView({ user }: { user: User }) {
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
    <div className="page">
      <PageHeader title="İçtihat arşivi" subtitle="Dilekçelerdeki karar atıfları bu arşivle teyit edilir" />
      <div className="two-col">
      <div>
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
      </div>
    </div>
  );
}
