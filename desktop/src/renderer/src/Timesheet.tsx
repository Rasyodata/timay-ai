import { useEffect, useState, type FormEvent } from 'react';
import { api, type CaseSummary, type User } from './api';
import type { Go } from './App';
import { Card, Empty, ErrorText, Field, formatDate, formatTL, Icon, PageHeader, Stat, today, useAsync } from './ui';

/*
 * Zaman takibi: dosyaya harcanan süre kronometreyle ya da elle girilir; saat ücretli kayıtlar
 * seçilip muhasebeye gelir olarak aktarılır.
 */

interface Entry {
  id: number;
  user_id: number;
  user_name: string;
  case_id: number | null;
  case_title: string | null;
  client: string;
  date: string;
  minutes: number;
  live_minutes: number;
  description: string;
  rate_kurus: number;
  billable: boolean;
  running: boolean;
  running_since: string;
  amount_kurus: number;
  invoiced: boolean;
}

interface Listing {
  items: Entry[];
  running: Entry | null;
  totals: { minutes: number; billableMinutes: number; openAmountKurus: number; invoicedAmountKurus: number };
}

const RATE_KEY = 'timay-hourly-rate';
const hm = (m: number) => `${Math.floor(m / 60)} sa ${String(m % 60).padStart(2, '0')} dk`;

function savedRate() {
  try {
    return localStorage.getItem(RATE_KEY) ?? '';
  } catch {
    return '';
  }
}

function Clock({ since }: { since: string }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const s = Math.max(0, Math.floor((now - Date.parse(`${since.replace(' ', 'T')}Z`)) / 1000));
  const p = (n: number) => String(n).padStart(2, '0');
  return <span className="timer-clock">{`${p(Math.floor(s / 3600))}:${p(Math.floor((s % 3600) / 60))}:${p(s % 60)}`}</span>;
}

export function TimesheetView({ user, go }: { user: User; go: Go }) {
  const month = today().slice(0, 7);
  const [range, setRange] = useState({ from: `${month}-01`, to: today(), open: false });
  const list = useAsync(
    () => api<Listing>(`/time?${new URLSearchParams({ from: range.from, to: range.to, ...(range.open ? { open: '1' } : {}) })}`),
    [range.from, range.to, range.open],
  );
  const cases = useAsync(() => api<CaseSummary[]>('/cases'), []);
  const [selected, setSelected] = useState<number[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const t = list.data?.totals;

  async function act(path: string, body?: unknown, method?: string) {
    try {
      const r = await api<unknown>(path, { body, method });
      setErr(null);
      list.reload();
      return r;
    } catch (e) {
      setErr((e as Error).message);
      return null;
    }
  }

  async function invoice() {
    const r = (await act('/time/invoice', { ids: selected })) as { amountKurus: number } | null;
    if (r) setSelected([]);
  }

  const selectedTotal = (list.data?.items ?? []).filter((e) => selected.includes(e.id)).reduce((a, e) => a + e.amount_kurus, 0);

  return (
    <div className="page">
      <PageHeader title="Zaman takibi" subtitle="Dosyalara harcanan süreyi kronometreyle tutun, saat ücretiyle faturalayıp muhasebeye aktarın." />
      <div className="stats">
        <Stat icon="clock" label="Toplam süre" value={t ? hm(t.minutes) : '—'} />
        <Stat icon="check" label="Ücretli süre" value={t ? hm(t.billableMinutes) : '—'} tone="green" />
        {Boolean(user.can_finance) && <Stat icon="wallet" label="Faturalanmamış" value={t ? formatTL(t.openAmountKurus) : '—'} tone="amber" />}
        {Boolean(user.can_finance) && <Stat icon="trend" label="Faturalanan" value={t ? formatTL(t.invoicedAmountKurus) : '—'} tone="violet" />}
      </div>
      <Timer running={list.data?.running ?? null} cases={cases.data ?? []} act={act} />
      <div className="grid-main-side">
        <Card
          title="Kayıtlar"
          className="flush"
          actions={
            <div className="toolbar">
              <input type="date" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} />
              <input type="date" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} />
              <label className="check-line">
                <input type="checkbox" checked={range.open} onChange={(e) => setRange({ ...range, open: e.target.checked })} /> Yalnız faturalanmamış
              </label>
            </div>
          }
        >
          <ErrorText error={list.error ?? err} />
          {list.data && list.data.items.length === 0 ? (
            <Empty icon="clock">Bu dönemde kayıt yok. Kronometreyi başlatın ya da sağdan elle ekleyin.</Empty>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  {Boolean(user.can_finance) && <th />}
                  <th>Tarih</th>
                  <th>İş</th>
                  <th>Dosya / müvekkil</th>
                  <th>Süre</th>
                  <th>Tutar</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {list.data?.items.map((e) => (
                  <tr key={e.id}>
                    {Boolean(user.can_finance) && (
                      <td className="check-cell">
                        <input
                          type="checkbox"
                          disabled={e.invoiced || e.running || !e.billable || e.rate_kurus === 0}
                          checked={selected.includes(e.id)}
                          onChange={(ev) => setSelected(ev.target.checked ? [...selected, e.id] : selected.filter((x) => x !== e.id))}
                        />
                      </td>
                    )}
                    <td>{formatDate(e.date)}</td>
                    <td>
                      <strong>{e.description || 'Dosya çalışması'}</strong>
                      <div className="muted small">{e.user_name}</div>
                    </td>
                    <td>
                      {e.case_id ? (
                        <button className="link" onClick={() => go({ name: 'case', id: e.case_id! })}>
                          {e.case_title}
                        </button>
                      ) : null}
                      <div className="muted small">{e.client}</div>
                    </td>
                    <td>{e.running ? <span className="badge t-amber">çalışıyor</span> : hm(e.minutes)}</td>
                    <td>
                      {e.billable ? (e.rate_kurus ? formatTL(e.amount_kurus) : <span className="muted small">ücret yok</span>) : <span className="muted small">ücretsiz</span>}
                      {e.invoiced && <div className="badge t-green">faturalandı</div>}
                    </td>
                    <td>
                      {!e.invoiced && !e.running && (
                        <button className="ghost" title="Sil" onClick={() => act(`/time/${e.id}`, undefined, 'DELETE')}>
                          ×
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {Boolean(user.can_finance) && selected.length > 0 && (
            <div className="form-actions inset">
              <span>
                {selected.length} kayıt · <strong>{formatTL(selectedTotal)}</strong> (KDV hariç)
              </span>
              <button className="primary" onClick={invoice}>
                <Icon name="wallet" /> Faturala, muhasebeye gelir olarak aktar
              </button>
            </div>
          )}
        </Card>
        <ManualEntry cases={cases.data ?? []} act={act} />
      </div>
    </div>
  );
}

function CaseSelect({ cases, value, onChange }: { cases: CaseSummary[]; value: string; onChange: (v: string) => void }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">— dosya yok (genel iş) —</option>
      {cases.map((c) => (
        <option key={c.id} value={c.id}>
          {c.title}
        </option>
      ))}
    </select>
  );
}

function Timer({ running, cases, act }: { running: Entry | null; cases: CaseSummary[]; act: (p: string, b?: unknown, m?: string) => Promise<unknown> }) {
  const [form, setForm] = useState({ caseId: '', description: '', rate: savedRate(), billable: true });
  async function start(e: FormEvent) {
    e.preventDefault();
    try {
      localStorage.setItem(RATE_KEY, form.rate);
    } catch {
      /* tarayıcı depolaması kapalı olabilir */
    }
    await act('/time/start', { ...form, caseId: form.caseId ? Number(form.caseId) : null });
  }
  if (running) {
    return (
      <Card>
        <div className="timer-card">
          <Clock since={running.running_since} />
          <div className="grow">
            <strong>{running.description || 'Dosya çalışması'}</strong>
            <div className="muted small">{[running.case_title, running.client].filter(Boolean).join(' · ') || 'Genel iş'}</div>
          </div>
          <button className="primary" onClick={() => act(`/time/${running.id}/stop`)}>
            Durdur ve kaydet
          </button>
        </div>
      </Card>
    );
  }
  return (
    <Card title="Kronometre">
      <form className="form-grid cols-3" onSubmit={start}>
        <Field label="Dosya">
          <CaseSelect cases={cases} value={form.caseId} onChange={(v) => setForm({ ...form, caseId: v })} />
        </Field>
        <Field label="Yapılan iş">
          <input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="ör. Cevap dilekçesi yazımı" />
        </Field>
        <Field label="Saat ücreti (TL, KDV hariç)">
          <input value={form.rate} onChange={(e) => setForm({ ...form, rate: e.target.value })} placeholder="ör. 2.500" inputMode="decimal" />
        </Field>
        <label className="check-line">
          <input type="checkbox" checked={form.billable} onChange={(e) => setForm({ ...form, billable: e.target.checked })} /> Ücretli (faturalanır)
        </label>
        <div className="form-actions">
          <button className="primary" type="submit">
            <Icon name="clock" /> Başlat
          </button>
        </div>
      </form>
    </Card>
  );
}

function ManualEntry({ cases, act }: { cases: CaseSummary[]; act: (p: string, b?: unknown, m?: string) => Promise<unknown> }) {
  const blank = { caseId: '', date: today(), hours: '', description: '', rate: savedRate(), billable: true };
  const [form, setForm] = useState(blank);
  async function save(e: FormEvent) {
    e.preventDefault();
    const r = await act('/time', { ...form, caseId: form.caseId ? Number(form.caseId) : null });
    if (r) setForm({ ...blank, rate: form.rate });
  }
  return (
    <Card title="Elle ekle" className="sticky">
      <form className="form-grid" onSubmit={save}>
        <Field label="Dosya" wide>
          <CaseSelect cases={cases} value={form.caseId} onChange={(v) => setForm({ ...form, caseId: v })} />
        </Field>
        <Field label="Tarih">
          <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} required />
        </Field>
        <Field label="Süre (saat, ör. 1,5)">
          <input value={form.hours} onChange={(e) => setForm({ ...form, hours: e.target.value })} inputMode="decimal" required />
        </Field>
        <Field label="Yapılan iş" wide>
          <input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} required />
        </Field>
        <Field label="Saat ücreti (TL)">
          <input value={form.rate} onChange={(e) => setForm({ ...form, rate: e.target.value })} inputMode="decimal" />
        </Field>
        <label className="check-line">
          <input type="checkbox" checked={form.billable} onChange={(e) => setForm({ ...form, billable: e.target.checked })} /> Ücretli
        </label>
        <div className="form-actions">
          <button className="primary" type="submit">
            <Icon name="plus" /> Ekle
          </button>
        </div>
      </form>
    </Card>
  );
}
