import { useState, type FormEvent } from 'react';
import { api, type User } from './api';
import { Card, ErrorText, PageHeader, useAsync } from './ui';

const PERMS: { key: 'is_admin' | 'can_finance' | 'can_approve' | 'all_cases'; body: string; label: string; hint: string }[] = [
  { key: 'is_admin', body: 'isAdmin', label: 'Büro yöneticisi', hint: 'Ekibe davet eder, yetkileri değiştirir' },
  { key: 'can_approve', body: 'canApprove', label: 'Onay verebilir', hint: 'Başkasının dilekçe ve sözleşmesini onaylar' },
  { key: 'can_finance', body: 'canFinance', label: 'Muhasebe', hint: 'Gelir, gider ve kâr-zararı görür' },
  { key: 'all_cases', body: 'allCases', label: 'Tüm dosyalar', hint: 'Kapalıysa yalnız kendi ve görevli olduğu dosyalar' },
];

export function TeamView({ user }: { user: User }) {
  const { data, error, reload } = useAsync(() => api<User[]>('/users'), []);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'avukat' | 'stajyer'>('avukat');
  const [invite, setInvite] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function send(e: FormEvent) {
    e.preventDefault();
    try {
      const r = await api<{ token: string }>('/invites', { body: { email, role } });
      setInvite(r.token);
      setEmail('');
      setErr(null);
    } catch (ex) {
      setErr((ex as Error).message);
    }
  }

  async function change(u: User, body: Record<string, unknown>) {
    try {
      await api(`/users/${u.id}/permissions`, { method: 'PUT', body });
      setErr(null);
      reload();
    } catch (ex) {
      setErr((ex as Error).message);
    }
  }

  return (
    <div className="page">
      <PageHeader title="Ekip ve yetkiler" subtitle="Büronuzdaki avukatlar, stajyerler ve her birinin neleri yapabileceği" />
      <ErrorText error={error ?? err} />
      <Card className="flush">
        <table className="table">
          <thead>
            <tr>
              <th>Kişi</th>
              <th>Rol</th>
              {PERMS.map((p) => (
                <th key={p.key} title={p.hint}>
                  {p.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data?.map((u) => (
              <tr key={u.id}>
                <td>
                  <strong>{u.name}</strong>
                  {u.id === user.id && <span className="muted small"> (siz)</span>}
                  <div className="muted small">{u.email}</div>
                </td>
                <td>
                  {user.is_admin ? (
                    <select className="compact" value={u.role} onChange={(e) => change(u, { role: e.target.value })}>
                      <option value="avukat">Avukat</option>
                      <option value="stajyer">Stajyer</option>
                    </select>
                  ) : (
                    <span className="badge">{u.role === 'avukat' ? 'Avukat' : 'Stajyer'}</span>
                  )}
                </td>
                {PERMS.map((p) => (
                  <td key={p.key} className="perm-cell">
                    <label className="switch" title={p.hint}>
                      <input
                        type="checkbox"
                        checked={Boolean(u[p.key])}
                        disabled={!user.is_admin || (p.key === 'can_approve' && u.role === 'stajyer')}
                        onChange={(e) => change(u, { [p.body]: e.target.checked })}
                      />
                      <span />
                    </label>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        <p className="muted small inset-note">
          {PERMS.map((p) => `${p.label}: ${p.hint.toLocaleLowerCase('tr')}`).join(' · ')}. Stajyerler onay veremez.
          {!user.is_admin && ' Yetkileri yalnızca büro yöneticisi değiştirebilir.'}
        </p>
      </Card>
      {Boolean(user.is_admin) && (
        <Card title="Ekibe davet et">
          <form className="row" onSubmit={send}>
            <input type="email" placeholder="E-posta" value={email} onChange={(e) => setEmail(e.target.value)} required />
            <select value={role} onChange={(e) => setRole(e.target.value as 'avukat' | 'stajyer')}>
              <option value="avukat">Avukat</option>
              <option value="stajyer">Stajyer</option>
            </select>
            <button className="primary" type="submit">
              Davet oluştur
            </button>
          </form>
          {invite && (
            <p>
              Davet kodu: <code>{invite}</code>
              <br />
              <span className="muted small">Bu kodu davet ettiğiniz kişiye iletin; giriş ekranındaki “Davet kodu” sekmesine yazacak.</span>
            </p>
          )}
        </Card>
      )}
    </div>
  );
}
