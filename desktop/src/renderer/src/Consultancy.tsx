import { useEffect, useState, type FormEvent } from 'react';
import { api, CONSULT_KIND_LABEL, type ConsultancyClient, type ConsultancyDetail, type User } from './api';
import type { Go } from './App';
import { Card, Empty, ErrorText, Field, formatDate, formatTL, Icon, PageHeader, Stat, Tabs, today, useAsync } from './ui';

export function hours(minutes: number) {
  return `${(minutes / 60).toLocaleString('tr-TR', { maximumFractionDigits: 1 })} sa`;
}

function monthName(ym: string) {
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('tr-TR', { month: 'long', year: 'numeric' });
}

function tl(kurus: number) {
  return kurus ? String(kurus / 100).replace('.', ',') : '';
}

export function ConsultancyView({ go }: { go: Go }) {
  const list = useAsync(() => api<ConsultancyClient[]>('/consultancy'), []);
  const [creating, setCreating] = useState(false);
  const [filter, setFilter] = useState<'aktif' | 'all'>('aktif');
  const all = list.data ?? [];
  const active = all.filter((c) => c.status === 'aktif');
  const rows = filter === 'all' ? all : active;

  return (
    <div className="page">
      <PageHeader
        title="Danışmanlık yönetimi"
        subtitle="Sürekli danışmanlık verdiğiniz müvekkiller, aylık ücretler, çalışma saatleri ve faturalama"
        actions={
          <button className="primary" onClick={() => setCreating(true)}>
            <Icon name="plus" /> Yeni danışmanlık müvekkili
          </button>
        }
      />
      <ErrorText error={list.error} />
      <div className="stats">
        <Stat icon="briefcase" label="Aktif danışmanlık" value={active.length} />
        <Stat icon="wallet" label="Aylık sabit ücret toplamı" value={formatTL(active.reduce((n, c) => n + c.monthly_fee_kurus, 0))} tone="violet" />
        <Stat icon="clock" label="Bu ay çalışılan" value={hours(active.reduce((n, c) => n + (c.month_minutes ?? 0), 0))} tone="amber" />
        <Stat icon="trend" label="Bu ay tahakkuk" value={formatTL(active.reduce((n, c) => n + (c.month_charge ?? 0), 0))} tone="green" />
      </div>

      {creating && <ClientForm title="Yeni danışmanlık müvekkili" onCancel={() => setCreating(false)} onSaved={(id) => go({ name: 'consultancy-client', id })} />}

      <Card className="flush">
        <div className="toolbar inset">
          <Tabs
            value={filter}
            onChange={setFilter}
            items={[
              ['aktif', 'Aktif'],
              ['all', 'Tümü'],
            ]}
          />
        </div>
        {rows.length === 0 ? (
          <Empty icon="briefcase">Henüz danışmanlık müvekkili yok. Aylık danışmanlık verdiğiniz şirketleri buraya ekleyin.</Empty>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Müvekkil</th>
                <th>Sorumlu</th>
                <th className="num">Aylık ücret</th>
                <th>Bu ay kullanım</th>
                <th className="num">Bu ay tahakkuk</th>
                <th>Son çalışma</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => {
                const used = c.month_minutes ?? 0;
                const pct = c.included_minutes ? Math.min(100, Math.round((used / c.included_minutes) * 100)) : 0;
                return (
                  <tr key={c.id} className="clickable" onClick={() => go({ name: 'consultancy-client', id: c.id })}>
                    <td>
                      <strong>{c.name}</strong>
                      {c.status === 'pasif' && <span className="badge closed"> Pasif</span>}
                      {c.contact && <div className="muted small">{c.contact}</div>}
                    </td>
                    <td>{c.responsible_name}</td>
                    <td className="num">{formatTL(c.monthly_fee_kurus)}</td>
                    <td>
                      {c.included_minutes > 0 ? (
                        <>
                          <div className={`progress ${used > c.included_minutes ? 'over' : ''}`}>
                            <span style={{ width: `${pct}%` }} />
                          </div>
                          <span className="muted small">
                            {hours(used)} / {hours(c.included_minutes)}
                          </span>
                        </>
                      ) : (
                        <span className="muted small">{hours(used)}</span>
                      )}
                    </td>
                    <td className="num">{formatTL(c.month_charge ?? 0)}</td>
                    <td>{c.last_record ? formatDate(c.last_record) : <span className="muted">—</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}

function ClientForm({
  title,
  initial,
  onCancel,
  onSaved,
}: {
  title: string;
  initial?: ConsultancyDetail;
  onCancel?: () => void;
  onSaved: (id: number, data: ConsultancyDetail) => void;
}) {
  const users = useAsync(() => api<User[]>('/users'), []);
  const [form, setForm] = useState({
    name: initial?.name ?? '',
    contact: initial?.contact ?? '',
    taxNo: initial?.tax_no ?? '',
    monthlyFee: tl(initial?.monthly_fee_kurus ?? 0),
    includedHours: initial ? String(initial.included_minutes / 60).replace('.', ',') : '',
    extraHourFee: tl(initial?.extra_hour_kurus ?? 0),
    startDate: initial?.start_date ?? today(),
    endDate: initial?.end_date ?? '',
    responsibleId: initial?.responsible_id ? String(initial.responsible_id) : '',
    note: initial?.note ?? '',
  });
  const [err, setErr] = useState<string | null>(null);
  const set = (key: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [key]: e.target.value });

  async function submit(e: FormEvent) {
    e.preventDefault();
    try {
      const body = { ...form, responsibleId: form.responsibleId ? Number(form.responsibleId) : undefined };
      const saved = initial
        ? await api<ConsultancyDetail>(`/consultancy/${initial.id}`, { method: 'PUT', body })
        : await api<ConsultancyDetail>('/consultancy', { body });
      setErr(null);
      onSaved(saved.id, saved);
    } catch (ex) {
      setErr((ex as Error).message);
    }
  }

  return (
    <Card title={title} actions={onCancel && <button className="ghost" onClick={onCancel}>Kapat</button>}>
      <form className="form-grid cols-3" onSubmit={submit}>
        <Field label="Müvekkil (şirket ya da kişi)">
          <input value={form.name} onChange={set('name')} required />
        </Field>
        <Field label="Yetkili / iletişim">
          <input value={form.contact} onChange={set('contact')} placeholder="ör. Ahmet Kaya, 0532 …" />
        </Field>
        <Field label="Vergi no">
          <input value={form.taxNo} onChange={set('taxNo')} />
        </Field>
        <Field label="Aylık sabit ücret (TL, KDV hariç)">
          <input value={form.monthlyFee} onChange={set('monthlyFee')} inputMode="decimal" placeholder="ör. 25.000" />
        </Field>
        <Field label="Pakete dahil saat (aylık)">
          <input value={form.includedHours} onChange={set('includedHours')} inputMode="decimal" placeholder="ör. 10" />
        </Field>
        <Field label="Aşan saat ücreti (TL)">
          <input value={form.extraHourFee} onChange={set('extraHourFee')} inputMode="decimal" placeholder="ör. 3.000" />
        </Field>
        <Field label="Başlangıç">
          <input type="date" value={form.startDate} onChange={set('startDate')} />
        </Field>
        <Field label="Bitiş">
          <input type="date" value={form.endDate} onChange={set('endDate')} />
        </Field>
        <Field label="Sorumlu avukat">
          <select value={form.responsibleId} onChange={set('responsibleId')}>
            <option value="">{initial ? '—' : 'Ben'}</option>
            {users.data?.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Not" wide>
          <input value={form.note} onChange={set('note')} />
        </Field>
        <div className="form-actions">
          <ErrorText error={err} />
          <button className="primary" type="submit">
            Kaydet
          </button>
        </div>
      </form>
    </Card>
  );
}

export function ConsultancyClientView({ id, go }: { id: number; go: Go }) {
  const { data, error, setData } = useAsync(() => api<ConsultancyDetail>(`/consultancy/${id}`), [id]);
  const [tab, setTab] = useState<'kayit' | 'aylar' | 'bilgi'>('kayit');
  const [form, setForm] = useState({ date: today(), kind: 'gorus', subject: '', hours: '', note: '' });
  const [err, setErr] = useState<string | null>(null);
  const [monthFilter, setMonthFilter] = useState('');

  useEffect(() => setMonthFilter(''), [id]);

  if (!data) return <ErrorText error={error} />;

  async function call(path: string, body?: unknown, method?: string) {
    try {
      setData(await api<ConsultancyDetail>(path, { body, method }));
      setErr(null);
      return true;
    } catch (ex) {
      setErr((ex as Error).message);
      return false;
    }
  }

  async function add(e: FormEvent) {
    e.preventDefault();
    if (await call(`/consultancy/${id}/records`, form)) setForm({ ...form, subject: '', hours: '', note: '' });
  }

  const current = data.months.find((m) => m.month === today().slice(0, 7));
  const records = monthFilter ? data.records.filter((r) => r.date.startsWith(monthFilter)) : data.records;
  const totalInvoiced = data.months.reduce((n, m) => n + (m.invoiced ?? 0), 0);

  return (
    <div className="page">
      <PageHeader
        back={() => go({ name: 'consultancy' })}
        title={data.name}
        subtitle={[
          'Danışmanlık',
          data.responsible_name && `Sorumlu: ${data.responsible_name}`,
          data.start_date && `${formatDate(data.start_date)}${data.end_date ? ` – ${formatDate(data.end_date)}` : ''}`,
          data.contact,
        ]
          .filter(Boolean)
          .join(' · ')}
        actions={
          <select className="status-select" value={data.status} onChange={(e) => call(`/consultancy/${id}`, { status: e.target.value }, 'PUT')}>
            <option value="aktif">Aktif</option>
            <option value="pasif">Pasif</option>
          </select>
        }
      />
      <div className="stats">
        <Stat icon="wallet" label="Aylık sabit ücret" value={formatTL(data.monthly_fee_kurus)} />
        <Stat
          icon="clock"
          label={data.included_minutes ? `Bu ay kullanım (paket ${hours(data.included_minutes)})` : 'Bu ay çalışılan'}
          value={hours(current?.minutes ?? 0)}
          tone={current && current.extraMinutes > 0 ? 'red' : 'amber'}
        />
        <Stat icon="trend" label="Bu ay tahakkuk" value={formatTL(current?.total ?? data.monthly_fee_kurus)} tone="green" onClick={() => setTab('aylar')} />
        <Stat icon="check" label="Toplam faturalanan" value={formatTL(totalInvoiced)} tone="violet" onClick={() => setTab('aylar')} />
      </div>
      <Tabs
        value={tab}
        onChange={setTab}
        items={[
          ['kayit', `Çalışma kayıtları (${data.records.length})`],
          ['aylar', 'Aylık hesap ve fatura'],
          ['bilgi', 'Sözleşme bilgileri'],
        ]}
      />
      <ErrorText error={err} />

      {tab === 'kayit' && (
        <div className="grid-main-side">
          <Card
            title="Verilen hizmetler"
            className="flush"
            actions={
              <select className="compact" value={monthFilter} onChange={(e) => setMonthFilter(e.target.value)}>
                <option value="">Tüm aylar</option>
                {data.months.map((m) => (
                  <option key={m.month} value={m.month}>
                    {monthName(m.month)}
                  </option>
                ))}
              </select>
            }
          >
            {records.length === 0 ? (
              <Empty icon="clock">Kayıt yok. Verdiğiniz her görüşü, toplantıyı ve incelemeyi süresiyle kaydedin.</Empty>
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>Tarih</th>
                    <th>Konu</th>
                    <th>Avukat</th>
                    <th className="num">Süre</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {records.map((r) => (
                    <tr key={r.id}>
                      <td>{formatDate(r.date)}</td>
                      <td>
                        <span className="tag">{CONSULT_KIND_LABEL[r.kind] ?? r.kind}</span> <strong>{r.subject}</strong>
                        {r.note && <div className="muted small">{r.note}</div>}
                      </td>
                      <td>{r.user_name}</td>
                      <td className="num">{hours(r.minutes)}</td>
                      <td>
                        <button className="ghost" title="Sil" onClick={() => call(`/consultancy-records/${r.id}`, undefined, 'DELETE')}>
                          ×
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
          <Card title="Çalışma kaydet">
            <form className="form-grid" onSubmit={add}>
              <Field label="Konu" wide>
                <input value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} placeholder="ör. Bayilik sözleşmesi incelendi" required />
              </Field>
              <Field label="Tür">
                <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
                  {Object.entries(CONSULT_KIND_LABEL).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Tarih">
                <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} required />
              </Field>
              <Field label="Süre (saat)">
                <input value={form.hours} onChange={(e) => setForm({ ...form, hours: e.target.value })} inputMode="decimal" placeholder="ör. 1,5" />
              </Field>
              <Field label="Not" wide>
                <textarea rows={2} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
              </Field>
              <div className="form-actions">
                <button className="primary" type="submit">
                  <Icon name="plus" /> Kaydet
                </button>
              </div>
            </form>
          </Card>
        </div>
      )}

      {tab === 'aylar' && (
        <Card title="Aylık hesap" className="flush">
          <table className="table">
            <thead>
              <tr>
                <th>Ay</th>
                <th className="num">Çalışılan</th>
                <th className="num">Aşan süre</th>
                <th className="num">Sabit ücret</th>
                <th className="num">Ek ücret</th>
                <th className="num">Toplam</th>
                <th>Fatura</th>
              </tr>
            </thead>
            <tbody>
              {data.months.map((m) => (
                <tr key={m.month}>
                  <td className="capitalize">{monthName(m.month)}</td>
                  <td className="num">{hours(m.minutes)}</td>
                  <td className={`num ${m.extraMinutes ? 'bad-text' : ''}`}>{m.extraMinutes ? hours(m.extraMinutes) : '—'}</td>
                  <td className="num">{formatTL(m.fee)}</td>
                  <td className="num">{m.extra ? formatTL(m.extra) : '—'}</td>
                  <td className="num">
                    <strong>{formatTL(m.total)}</strong>
                  </td>
                  <td>
                    {m.invoiced !== null ? (
                      <span className="badge onayli">Muhasebeye işlendi</span>
                    ) : (
                      <button className="link" disabled={m.total <= 0} onClick={() => call(`/consultancy/${id}/invoice`, { month: m.month })}>
                        Muhasebeye gelir olarak işle
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted small inset-note">
            Gelir kaydı %20 KDV ve %20 stopajla, ayın son günü tarihiyle Muhasebe'ye eklenir. Faturalanan ayın kayıtları silinemez.
          </p>
        </Card>
      )}

      {tab === 'bilgi' && <ClientForm key={data.id} title="Danışmanlık sözleşmesi bilgileri" initial={data} onSaved={(_id, d) => setData(d)} />}
    </div>
  );
}
