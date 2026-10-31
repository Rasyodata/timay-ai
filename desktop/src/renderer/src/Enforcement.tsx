import { useState, type FormEvent } from 'react';
import { api, ENFORCEMENT_KIND_LABEL, ENFORCEMENT_STATUS_LABEL, type CaseSummary, type EnforcementFile } from './api';
import { InsightsPanel } from './Insights';
import type { Go } from './App';
import { Card, Empty, ErrorText, Field, formatDate, formatTL, Icon, PageHeader, Stat, Tabs, today, useAsync } from './ui';

const ACTIONS: [string, string][] = [
  ['takip', 'Takip açıldı'],
  ['odeme_emri', 'Ödeme emri tebliğ edildi'],
  ['itiraz', 'Borçlu itiraz etti'],
  ['itirazin_iptali', 'İtirazın iptali / kaldırılması'],
  ['haciz', 'Haciz yapıldı'],
  ['maas_haczi', 'Maaş haczi'],
  ['banka_haczi', 'Banka haczi'],
  ['satis', 'Satış talebi'],
  ['tahsilat', 'Tahsilat'],
  ['diger', 'Diğer'],
];
const ACTION_LABEL = Object.fromEntries(ACTIONS);

function percent(f: EnforcementFile) {
  const total = f.principal_kurus + f.interest_kurus;
  return total ? Math.min(100, Math.round((f.collected_kurus / total) * 100)) : 0;
}

export function EnforcementView({ go }: { go: Go }) {
  const list = useAsync(() => api<EnforcementFile[]>('/enforcement'), []);
  const cases = useAsync(() => api<CaseSummary[]>('/cases'), []);
  const [creating, setCreating] = useState(false);
  const [filter, setFilter] = useState<'open' | 'all'>('open');
  const files = (list.data ?? []).filter((f) => filter === 'all' || !['tahsil', 'kapandi'].includes(f.status));
  const all = list.data ?? [];
  const open = all.filter((f) => !['tahsil', 'kapandi'].includes(f.status));

  return (
    <div className="page">
      <PageHeader
        title="İcra takibi"
        subtitle="Takip dosyaları, faiz hesabı, haciz ve tahsilat kayıtları"
        actions={
          <button className="primary" onClick={() => setCreating(true)}>
            <Icon name="plus" /> Yeni icra dosyası
          </button>
        }
      />
      <InsightsPanel module="enforcement" />
      <ErrorText error={list.error} />
      <div className="stats">
        <Stat icon="gavel" label="Açık takip" value={open.length} tone="red" />
        <Stat icon="wallet" label="Toplam alacak (faiz dahil)" value={formatTL(open.reduce((n, f) => n + f.principal_kurus + f.interest_kurus, 0))} tone="violet" />
        <Stat icon="check" label="Tahsil edilen" value={formatTL(all.reduce((n, f) => n + f.collected_kurus, 0))} tone="green" />
        <Stat icon="alert" label="Kalan alacak" value={formatTL(open.reduce((n, f) => n + f.remaining_kurus, 0))} tone="amber" />
      </div>

      {creating && <NewFile cases={cases.data ?? []} onCancel={() => setCreating(false)} onCreated={(id) => go({ name: 'enforcement-file', id })} />}

      <Card className="flush">
        <div className="toolbar inset">
          <Tabs
            value={filter}
            onChange={setFilter}
            items={[
              ['open', 'Devam edenler'],
              ['all', 'Tümü'],
            ]}
          />
        </div>
        {files.length === 0 ? (
          <Empty icon="gavel">İcra dosyası yok.</Empty>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Borçlu</th>
                <th>İcra dairesi / dosya</th>
                <th>Tür</th>
                <th className="num">Alacak + faiz</th>
                <th>Tahsilat</th>
                <th>Durum</th>
              </tr>
            </thead>
            <tbody>
              {files.map((f) => (
                <tr key={f.id} className="clickable" onClick={() => go({ name: 'enforcement-file', id: f.id })}>
                  <td>
                    <strong>{f.debtor}</strong>
                    {f.creditor && <div className="muted small">Alacaklı: {f.creditor}</div>}
                  </td>
                  <td>
                    {f.office_name || '—'}
                    {f.file_no && <div className="muted small">{f.file_no} E.</div>}
                  </td>
                  <td>{ENFORCEMENT_KIND_LABEL[f.kind] ?? f.kind}</td>
                  <td className="num">{formatTL(f.principal_kurus + f.interest_kurus)}</td>
                  <td>
                    <div className="progress" title={`${percent(f)}%`}>
                      <span style={{ width: `${percent(f)}%` }} />
                    </div>
                    <span className="muted small">{formatTL(f.collected_kurus)}</span>
                  </td>
                  <td>
                    <span className={`badge e-${f.status}`}>{ENFORCEMENT_STATUS_LABEL[f.status] ?? f.status}</span>
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

function NewFile({ cases, onCancel, onCreated }: { cases: CaseSummary[]; onCancel: () => void; onCreated: (id: number) => void }) {
  const [form, setForm] = useState({
    debtor: '',
    creditor: '',
    officeName: '',
    fileNo: '',
    kind: 'ilamsiz',
    principal: '',
    interestRate: '24',
    startDate: today(),
    caseId: '',
    note: '',
  });
  const [err, setErr] = useState<string | null>(null);
  const set = (key: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [key]: e.target.value });

  async function submit(e: FormEvent) {
    e.preventDefault();
    try {
      const f = await api<EnforcementFile>('/enforcement', {
        body: { ...form, interestRate: Number(form.interestRate.replace(',', '.')), caseId: form.caseId ? Number(form.caseId) : null },
      });
      onCreated(f.id);
    } catch (ex) {
      setErr((ex as Error).message);
    }
  }

  return (
    <Card title="Yeni icra dosyası" actions={<button className="ghost" onClick={onCancel}>Kapat</button>}>
      <form className="form-grid cols-3" onSubmit={submit}>
        <Field label="Borçlu">
          <input value={form.debtor} onChange={set('debtor')} required />
        </Field>
        <Field label="Alacaklı (müvekkil)">
          <input value={form.creditor} onChange={set('creditor')} />
        </Field>
        <Field label="Takip türü">
          <select value={form.kind} onChange={set('kind')}>
            {Object.entries(ENFORCEMENT_KIND_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </Field>
        <Field label="İcra dairesi">
          <input value={form.officeName} onChange={set('officeName')} placeholder="ör. İstanbul 12. İcra Dairesi" />
        </Field>
        <Field label="Dosya no">
          <input value={form.fileNo} onChange={set('fileNo')} placeholder="2026/1234" />
        </Field>
        <Field label="Takip tarihi">
          <input type="date" value={form.startDate} onChange={set('startDate')} />
        </Field>
        <Field label="Asıl alacak (TL)">
          <input value={form.principal} onChange={set('principal')} inputMode="decimal" required />
        </Field>
        <Field label="Yıllık faiz %">
          <input value={form.interestRate} onChange={set('interestRate')} inputMode="decimal" />
        </Field>
        <Field label="İlgili dava dosyası">
          <select value={form.caseId} onChange={set('caseId')}>
            <option value="">—</option>
            {cases.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
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
            Dosyayı aç
          </button>
        </div>
      </form>
    </Card>
  );
}

export function EnforcementFileView({ id, go }: { id: number; go: Go }) {
  const { data, error, setData } = useAsync(() => api<EnforcementFile>(`/enforcement/${id}`), [id]);
  const [form, setForm] = useState({ date: today(), action: 'tahsilat', amount: '', note: '' });
  const [err, setErr] = useState<string | null>(null);

  if (!data) return <ErrorText error={error} />;

  async function addAction(e: FormEvent) {
    e.preventDefault();
    try {
      setData(await api<EnforcementFile>(`/enforcement/${id}/actions`, { body: { ...form, action: form.action } }));
      setForm({ ...form, amount: '', note: '' });
      setErr(null);
    } catch (ex) {
      setErr((ex as Error).message);
    }
  }

  async function setStatus(status: string) {
    setData(await api<EnforcementFile>(`/enforcement/${id}`, { method: 'PUT', body: { status } }));
  }

  return (
    <div className="page">
      <PageHeader
        back={() => go({ name: 'enforcement' })}
        title={`${data.debtor}`}
        subtitle={[ENFORCEMENT_KIND_LABEL[data.kind], data.office_name, data.file_no && `${data.file_no} E.`, data.creditor && `Alacaklı: ${data.creditor}`]
          .filter(Boolean)
          .join(' · ')}
        actions={
          <select className={`status-select e-${data.status}`} value={data.status} onChange={(e) => setStatus(e.target.value)}>
            {Object.entries(ENFORCEMENT_STATUS_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        }
      />
      <div className="stats">
        <Stat icon="wallet" label="Asıl alacak" value={formatTL(data.principal_kurus)} />
        <Stat icon="trend" label={`İşlemiş faiz (%${data.interest_rate} yıllık)`} value={formatTL(data.interest_kurus)} tone="amber" />
        <Stat icon="check" label="Tahsil edilen" value={formatTL(data.collected_kurus)} tone="green" />
        <Stat icon="alert" label="Kalan" value={formatTL(data.remaining_kurus)} tone={data.remaining_kurus > 0 ? 'red' : 'green'} />
      </div>
      <div className="progress big">
        <span style={{ width: `${percent(data)}%` }} />
      </div>
      <p className="muted small">
        Faiz {formatDate(data.start_date)} tarihinden bugüne basit faizle hesaplanır. Tahsilatlar kalan alacaktan düşülür.
      </p>
      <div className="grid-main-side">
        <Card title="İşlem geçmişi" className="flush">
          {!data.actions?.length ? (
            <Empty icon="clock">Henüz işlem kaydı yok.</Empty>
          ) : (
            <ul className="timeline">
              {data.actions.map((a) => (
                <li key={a.id} className={a.action === 'tahsilat' ? 'money' : ''}>
                  <span className="when">{formatDate(a.date)}</span>
                  <span className="item-text">
                    <strong>
                      {ACTION_LABEL[a.action] ?? a.action}
                      {a.amount_kurus > 0 && ` · ${formatTL(a.amount_kurus)}`}
                    </strong>
                    <span>
                      {a.note && `${a.note} · `}
                      {a.created_by_name}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="İşlem ekle">
          <form className="form-grid" onSubmit={addAction}>
            <Field label="İşlem" wide>
              <select value={form.action} onChange={(e) => setForm({ ...form, action: e.target.value })}>
                {ACTIONS.map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Tarih">
              <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} required />
            </Field>
            <Field label="Tutar (TL)">
              <input value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} inputMode="decimal" />
            </Field>
            <Field label="Not" wide>
              <input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
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
  );
}
