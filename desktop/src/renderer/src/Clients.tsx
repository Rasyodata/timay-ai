import { useEffect, useState, type FormEvent } from 'react';
import { api, ENFORCEMENT_STATUS_LABEL } from './api';
import type { Go } from './App';
import { Card, Empty, ErrorText, Field, formatTL, Icon, PageHeader, Stat, useAsync } from './ui';

/*
 * Müvekkiller: müvekkilin iletişim bilgileri ve büronun onunla ilgili her şeyi (davalar, icra,
 * sözleşmeler, danışmanlık, arabuluculuk, muhasebe) tek kartta. Büro anteti de burada tanımlanır.
 */

interface Client {
  id: number;
  name: string;
  kind: 'kisi' | 'sirket';
  id_no: string;
  phone: string;
  email: string;
  address: string;
  note: string;
  cases?: number;
}
interface Card_ extends Omit<Client, 'cases'> {
  cases: { id: number; title: string; court: string; esas_no: string; status: string }[];
  enforcement: { id: number; debtor: string; office_name: string; file_no: string; status: string }[];
  contracts: { id: number; title: string; status: string }[];
  consultancy: { id: number; name: string; status: string }[];
  mediation: { id: number; subject: string; status: string }[];
  finance: { gelir: number; masraf: number; gider: number; entries: number };
}

function ClientForm({ initial, onSaved, onCancel }: { initial?: Partial<Omit<Client, 'cases'>>; onSaved: (c: Card_) => void; onCancel: () => void }) {
  const [form, setForm] = useState({
    name: initial?.name ?? '',
    kind: initial?.kind ?? 'kisi',
    idNo: initial?.id_no ?? '',
    phone: initial?.phone ?? '',
    email: initial?.email ?? '',
    address: initial?.address ?? '',
    note: initial?.note ?? '',
  });
  const [err, setErr] = useState<string | null>(null);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });
  async function submit(e: FormEvent) {
    e.preventDefault();
    try {
      onSaved(await api<Card_>(initial?.id ? `/clients/${initial.id}` : '/clients', { method: initial?.id ? 'PUT' : 'POST', body: form }));
    } catch (ex) {
      setErr((ex as Error).message);
    }
  }
  return (
    <form className="form-grid cols-3" onSubmit={submit}>
      <Field label="Ad soyad / unvan">
        <input value={form.name} onChange={set('name')} required autoFocus />
      </Field>
      <Field label="Tür">
        <select value={form.kind} onChange={set('kind')}>
          <option value="kisi">Gerçek kişi</option>
          <option value="sirket">Şirket / kurum</option>
        </select>
      </Field>
      <Field label={form.kind === 'sirket' ? 'Vergi no' : 'T.C. kimlik no'}>
        <input value={form.idNo} onChange={set('idNo')} />
      </Field>
      <Field label="Telefon">
        <input value={form.phone} onChange={set('phone')} />
      </Field>
      <Field label="E-posta">
        <input value={form.email} onChange={set('email')} />
      </Field>
      <Field label="Adres">
        <input value={form.address} onChange={set('address')} />
      </Field>
      <Field label="Not" wide>
        <input value={form.note} onChange={set('note')} />
      </Field>
      <div className="form-actions">
        <ErrorText error={err} />
        <button type="button" onClick={onCancel}>
          Vazgeç
        </button>
        <button className="primary" type="submit">
          Kaydet
        </button>
      </div>
    </form>
  );
}

export function ClientsView({ go }: { go: Go }) {
  const [q, setQ] = useState('');
  const list = useAsync(() => api<{ clients: Client[]; suggestions: { name: string; n: number }[] }>(`/clients?${new URLSearchParams({ q })}`), [q]);
  const [creating, setCreating] = useState<Partial<Client> | null>(null);
  const [err, setErr] = useState<string | null>(null);
  return (
    <div className="page">
      <PageHeader
        title="Müvekkiller"
        subtitle="Müvekkil bilgileri ve adına kayıtlı davalar, icra dosyaları, sözleşmeler ve muhasebe tek kartta"
        actions={
          <button className="primary" onClick={() => setCreating({})}>
            <Icon name="plus" /> Yeni müvekkil
          </button>
        }
      />
      {creating && (
        <Card title="Yeni müvekkil">
          <ClientForm key={creating.name ?? ''} initial={creating} onCancel={() => setCreating(null)} onSaved={(c) => go({ name: 'client', id: c.id })} />
        </Card>
      )}
      <ErrorText error={list.error ?? err} />
      {(list.data?.suggestions.length ?? 0) > 0 && (
        <div className="callout">
          <Icon name="users" />
          <div>
            <strong>Dosyalarınızda geçen ama kartı olmayan müvekkiller</strong>
            <div className="client-suggest">
              {list.data!.suggestions.map((s) => (
                <button
                  key={s.name}
                  className="tag"
                  title="Kart aç"
                  onClick={async () => {
                    try {
                      setErr(null);
                      await api('/clients', { body: { name: s.name } });
                      list.reload();
                    } catch (e) {
                      setErr((e as Error).message);
                    }
                  }}
                >
                  + {s.name} ({s.n})
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
      <Card className="flush">
        <div className="toolbar inset">
          <label className="search">
            <Icon name="search" />
            <input placeholder="Ad, T.C./vergi no, telefon veya e-posta ile ara" value={q} onChange={(e) => setQ(e.target.value)} />
          </label>
        </div>
        {list.data?.clients.length === 0 ? (
          <Empty icon="users">Müvekkil kartı yok. Yukarıdaki önerilerden ya da "Yeni müvekkil" ile ekleyin.</Empty>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Müvekkil</th>
                <th>T.C. / vergi no</th>
                <th>İletişim</th>
                <th className="num">Dava</th>
              </tr>
            </thead>
            <tbody>
              {list.data?.clients.map((c) => (
                <tr key={c.id} className="clickable" onClick={() => go({ name: 'client', id: c.id })}>
                  <td>
                    <strong>{c.name}</strong>
                    <div className="muted small">{c.kind === 'sirket' ? 'Şirket / kurum' : 'Gerçek kişi'}</div>
                  </td>
                  <td>{c.id_no || '—'}</td>
                  <td className="small">{[c.phone, c.email].filter(Boolean).join(' · ') || '—'}</td>
                  <td className="num">{c.cases}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}

export function ClientView({ id, go }: { id: number; go: Go }) {
  const { data, error, setData } = useAsync(() => api<Card_>(`/clients/${id}`), [id]);
  const [edit, setEdit] = useState(false);
  if (!data) return <ErrorText error={error} />;
  const c = data;
  const total = c.cases.length + c.enforcement.length + c.contracts.length + c.consultancy.length + c.mediation.length;
  return (
    <div className="page">
      <PageHeader
        back={() => go({ name: 'clients' })}
        title={c.name}
        subtitle={[c.kind === 'sirket' ? 'Şirket / kurum' : 'Gerçek kişi', c.id_no, c.phone, c.email].filter(Boolean).join(' · ')}
        actions={
          <button onClick={() => setEdit(!edit)}>
            <Icon name="pen" /> Bilgileri düzenle
          </button>
        }
      />
      {edit && (
        <Card title="Müvekkil bilgileri">
          <ClientForm
            initial={c}
            onCancel={() => setEdit(false)}
            onSaved={(n) => {
              setData(n);
              setEdit(false);
            }}
          />
        </Card>
      )}
      <div className="stats">
        <Stat icon="folder" label="Dava dosyası" value={c.cases.length} />
        <Stat icon="gavel" label="İcra dosyası" value={c.enforcement.length} tone="red" />
        <Stat icon="wallet" label="Gelir (ücret)" value={formatTL(c.finance.gelir)} tone="green" />
        <Stat icon="file" label="Masraf" value={formatTL(c.finance.masraf)} tone="amber" />
      </div>
      {c.address && <p className="small">Adres: {c.address}</p>}
      {c.note && <p className="muted small">{c.note}</p>}
      {total === 0 && <Empty icon="folder">Bu müvekkil adına kayıtlı dosya yok. Dava açarken "Müvekkil" alanına aynı adı yazın.</Empty>}
      <div className="grid-2">
        {c.cases.length > 0 && (
          <Card title="Dava dosyaları" className="flush">
            <ul className="client-list">
              {c.cases.map((x) => (
                <li key={x.id} className="clickable" onClick={() => go({ name: 'case', id: x.id })}>
                  <strong>{x.title}</strong>
                  <span className="muted small">{[x.court, x.esas_no && `${x.esas_no} E.`].filter(Boolean).join(' · ')}</span>
                </li>
              ))}
            </ul>
          </Card>
        )}
        {c.enforcement.length > 0 && (
          <Card title="İcra dosyaları" className="flush">
            <ul className="client-list">
              {c.enforcement.map((x) => (
                <li key={x.id} className="clickable" onClick={() => go({ name: 'enforcement-file', id: x.id })}>
                  <strong>Borçlu: {x.debtor}</strong>
                  <span className="muted small">{[x.office_name, x.file_no, ENFORCEMENT_STATUS_LABEL[x.status]].filter(Boolean).join(' · ')}</span>
                </li>
              ))}
            </ul>
          </Card>
        )}
        {c.contracts.length > 0 && (
          <Card title="Sözleşmeler" className="flush">
            <ul className="client-list">
              {c.contracts.map((x) => (
                <li key={x.id} className="clickable" onClick={() => go({ name: 'contract', id: x.id })}>
                  <strong>{x.title}</strong>
                </li>
              ))}
            </ul>
          </Card>
        )}
        {c.consultancy.length > 0 && (
          <Card title="Danışmanlık" className="flush">
            <ul className="client-list">
              {c.consultancy.map((x) => (
                <li key={x.id} className="clickable" onClick={() => go({ name: 'consultancy-client', id: x.id })}>
                  <strong>{x.name}</strong>
                  <span className="muted small">{x.status}</span>
                </li>
              ))}
            </ul>
          </Card>
        )}
        {c.mediation.length > 0 && (
          <Card title="Arabuluculuk" className="flush">
            <ul className="client-list">
              {c.mediation.map((x) => (
                <li key={x.id} className="clickable" onClick={() => go({ name: 'mediation-file', id: x.id })}>
                  <strong>{x.subject || 'Arabuluculuk dosyası'}</strong>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>
    </div>
  );
}

/** Büro anteti: UDF ve Word çıktılarının başına yazılır. */
export function LetterheadCard() {
  const l = useAsync(() => api<{ letterhead: string; useLetterhead: boolean }>('/office/letterhead'), []);
  const [form, setForm] = useState<{ letterhead: string; useLetterhead: boolean } | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (l.data) setForm(l.data);
  }, [l.data]);
  if (!form) return <ErrorText error={l.error} />;
  return (
    <Card title="Büro anteti">
      <p className="muted small">Dilekçe, sözleşme, tutanak ve hesapların UDF ve Word çıktılarının en üstüne yazılır (en fazla 6 satır).</p>
      <textarea
        rows={4}
        value={form.letterhead}
        onChange={(e) => setForm({ ...form, letterhead: e.target.value })}
        placeholder={'YILMAZ HUKUK BÜROSU\nAv. Ayşe Yılmaz · İstanbul Barosu\nCaferağa Mah. … Kadıköy / İstanbul · 0216 000 00 00 · buro@ornek.com'}
      />
      <label className="check-line">
        <input type="checkbox" checked={form.useLetterhead} onChange={(e) => setForm({ ...form, useLetterhead: e.target.checked })} /> Çıktılara antet ekle
      </label>
      <div className="form-actions">
        {msg && <span className="success-note">{msg}</span>}
        <ErrorText error={err} />
        <button
          className="primary"
          onClick={async () => {
            try {
              setForm(await api('/office/letterhead', { method: 'PUT', body: form }));
              setMsg('Antet kaydedildi.');
              setErr(null);
            } catch (e) {
              setErr((e as Error).message);
            }
          }}
        >
          Kaydet
        </button>
      </div>
    </Card>
  );
}
