import { useState, type FormEvent } from 'react';
import { downloadBase64, ExportButtons } from './Export';
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
  ['arac_haczi', 'Araç haczi'],
  ['tapu_haczi', 'Taşınmaz haczi'],
  ['tebligat', 'Tebligat çıkarıldı'],
  ['satis', 'Satış talebi'],
  ['tahsilat', 'Tahsilat (dosyaya yatan para)'],
  ['masraf', 'Masraf (harç, tebligat, vekâlet pulu…)'],
  ['reddiyat', 'Reddiyat (daireden çekilen para)'],
  ['muvekkile_odeme', 'Müvekkile ödeme'],
  ['diger', 'Diğer'],
];
const MONEY_ACTIONS = new Set(['tahsilat', 'masraf', 'reddiyat', 'muvekkile_odeme']);
const UYAP_PORTAL = 'https://avukatbeta.uyap.gov.tr/';
const ACTION_LABEL = Object.fromEntries(ACTIONS);

function percent(f: EnforcementFile) {
  const total = f.principal_kurus + f.interest_kurus;
  return total ? Math.min(100, Math.round((f.collected_kurus / total) * 100)) : 0;
}

export function EnforcementView({ go }: { go: Go }) {
  const list = useAsync(() => api<EnforcementFile[]>('/enforcement'), []);
  const cases = useAsync(() => api<CaseSummary[]>('/cases'), []);
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);
  const stale = useAsync(() => api<{ id: number; debtor: string; file_no: string; age: number | null }[]>('/enforcement/queries/overview'), []);
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
          <>
            <button onClick={() => setImporting(true)} title="Excel ya da CSV listesinden toplu dosya açın veya mevcut dosyaları güncelleyin">
              <Icon name="upload" /> Excel'den aktar
            </button>
            <button
              onClick={async () => {
                const r = await api<{ fileName: string; base64: string }>('/enforcement/export');
                downloadBase64(r.fileName, r.base64, 'text/csv');
              }}
            >
              <Icon name="download" /> Excel'e aktar
            </button>
            <button className="primary" onClick={() => setCreating(true)}>
              <Icon name="plus" /> Yeni icra dosyası
            </button>
          </>
        }
      />
      <InsightsPanel module="enforcement" />
      <ErrorText error={list.error} />
      <div className="stats">
        <Stat icon="gavel" label="Açık takip" value={open.length} tone="red" />
        <Stat icon="wallet" label="Toplam alacak (faiz dahil)" value={formatTL(open.reduce((n, f) => n + f.principal_kurus + f.interest_kurus, 0))} tone="violet" />
        <Stat icon="check" label="Tahsil edilen" value={formatTL(all.reduce((n, f) => n + f.collected_kurus, 0))} tone="green" />
        <Stat icon="alert" label="Kalan alacak" value={formatTL(open.reduce((n, f) => n + f.remaining_kurus, 0))} tone="amber" />
        <Stat icon="inbox" label="Dairede bekleyen para" value={formatTL(all.reduce((n, f) => n + f.at_office_kurus, 0))} tone="blue" />
      </div>
      {importing && <ImportFiles onClose={() => setImporting(false)} onDone={() => { list.reload(); stale.reload(); }} />}
      {(stale.data?.length ?? 0) > 0 && (
        <div className="callout warn">
          <Icon name="search" />
          <div>
            <strong>{stale.data!.length} açık dosyada borçlu sorgusu yapılmamış ya da 90 günden eski.</strong>
            <div className="small">
              {stale.data!.slice(0, 6).map((f, i) => (
                <span key={f.id}>
                  {i > 0 && ', '}
                  <button className="link small" onClick={() => go({ name: 'enforcement-file', id: f.id, tab: 'sorgu' })}>
                    {f.debtor}
                  </button>
                </span>
              ))}
              {stale.data!.length > 6 && ' …'}
            </div>
          </div>
        </div>
      )}

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
    debtorIdNo: '',
    interestType: 'sabit',
    fee: '',
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
        <Field label="Borçlu TC / VKN">
          <input value={form.debtorIdNo} onChange={set('debtorIdNo')} inputMode="numeric" />
        </Field>
        <Field label="Faiz türü">
          <select value={form.interestType} onChange={set('interestType')}>
            <option value="sabit">Sözleşme / sabit oran</option>
            <option value="yasal">Yasal faiz (oranı kendiliğinden)</option>
          </select>
        </Field>
        {form.interestType === 'sabit' && (
          <Field label="Yıllık faiz %">
            <input value={form.interestRate} onChange={set('interestRate')} inputMode="decimal" />
          </Field>
        )}
        <Field label="Vekâlet ücreti (TL)">
          <input value={form.fee} onChange={set('fee')} inputMode="decimal" />
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

interface Ledger {
  date: string;
  kind: 'baslangic' | 'masraf' | 'tahsilat' | 'hesap';
  label: string;
  amount_kurus: number;
  applied?: { masraf: number; faiz: number; anapara: number };
  interest_kurus: number;
  balance: { anapara: number; faiz: number; masraf: number; toplam: number };
}
interface Account {
  asOf: string;
  lines: Ledger[];
  interest_total_kurus: number;
  expense_total_kurus: number;
  collected_kurus: number;
  remaining: Ledger['balance'];
  at_office_kurus: number;
  at_lawyer_kurus: number;
  report: string;
}
interface QueryKind {
  key: string;
  label: string;
  hint: string;
  last: { id: number; date: string; found: number; result: string; created_by_name: string } | null;
  stale: boolean;
  age: number | null;
  suggest: string;
}

function AccountTab({ id, version }: { id: number; version: number }) {
  const [date, setDate] = useState(today());
  const acc = useAsync(() => api<Account>(`/enforcement/${id}/account?date=${date}`), [id, date, version]);
  const d = acc.data;
  return (
    <div className="stack">
      <Card
        title="Dosya hesabı"
        actions={
          <label className="inline-field">
            Hesap tarihi <input type="date" value={date} onChange={(e) => setDate(e.target.value || today())} />
          </label>
        }
      >
        <ErrorText error={acc.error} />
        {d && (
          <>
            <div className="stats">
              <Stat icon="wallet" label="Kalan asıl alacak" value={formatTL(d.remaining.anapara)} />
              <Stat icon="trend" label="Kalan faiz" value={formatTL(d.remaining.faiz)} tone="amber" />
              <Stat icon="file" label="Kalan masraf + vekâlet" value={formatTL(d.remaining.masraf)} tone="violet" />
              <Stat icon="alert" label="Toplam kalan borç" value={formatTL(d.remaining.toplam)} tone={d.remaining.toplam > 0 ? 'red' : 'green'} />
            </div>
            <table className="table ledger">
              <thead>
                <tr>
                  <th>Tarih</th>
                  <th>İşlem</th>
                  <th className="num">Tutar</th>
                  <th className="num">İşleyen faiz</th>
                  <th>Mahsup (masraf / faiz / asıl)</th>
                  <th className="num">Kalan borç</th>
                </tr>
              </thead>
              <tbody>
                {d.lines.map((l, i) => (
                  <tr key={i} className={`lg-${l.kind}`}>
                    <td>{formatDate(l.date)}</td>
                    <td>{l.label}</td>
                    <td className="num">{l.amount_kurus ? formatTL(l.amount_kurus) : ''}</td>
                    <td className="num">{l.interest_kurus ? formatTL(l.interest_kurus) : ''}</td>
                    <td className="small">{l.applied ? `${formatTL(l.applied.masraf)} / ${formatTL(l.applied.faiz)} / ${formatTL(l.applied.anapara)}` : ''}</td>
                    <td className="num">
                      <strong>{formatTL(l.balance.toplam)}</strong>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="muted small">Tahsilatlar TBK 100 uyarınca önce masraf ve vekâlet ücretine, sonra faize, kalanı asıl alacağa sayılır. Faiz kalan asıl alacak üzerinden işler.</p>
          </>
        )}
      </Card>
      {d && (
        <div className="grid-2">
          <Card title="Para nerede?">
            <dl className="sum-grid">
              <dt>Dosyaya yatan (tahsilat)</dt>
              <dd>{formatTL(d.collected_kurus)}</dd>
              <dt>İcra dairesinde bekleyen</dt>
              <dd>
                <strong className={d.at_office_kurus > 0 ? 'success' : ''}>{formatTL(d.at_office_kurus)}</strong>
                {d.at_office_kurus > 0 && <span className="muted small"> · reddiyat talep edin</span>}
              </dd>
              <dt>Avukatta, müvekkile ödenecek</dt>
              <dd>{formatTL(d.at_lawyer_kurus)}</dd>
            </dl>
          </Card>
          <Card title="Kapak hesabı" actions={<ExportButtons title="Dosya hesabı" body={d.report} />}>
            <textarea className="editor mono sum-report" readOnly value={d.report} />
          </Card>
        </div>
      )}
    </div>
  );
}

function QueriesTab({ id, onAction }: { id: number; onAction: () => void }) {
  const q = useAsync(() => api<{ kinds: QueryKind[]; history: { id: number; kind: string; date: string; found: number; result: string; created_by_name: string }[] }>(`/enforcement/${id}/queries`), [id]);
  const [open, setOpen] = useState<string | null>(null);
  const [form, setForm] = useState({ date: today(), found: false, result: '' });
  const [err, setErr] = useState<string | null>(null);
  const label = Object.fromEntries((q.data?.kinds ?? []).map((k) => [k.key, k.label]));

  async function save(kind: string) {
    setErr(null);
    try {
      q.setData(await api(`/enforcement/${id}/queries`, { body: { kind, ...form } }));
      setOpen(null);
      setForm({ date: today(), found: false, result: '' });
      onAction();
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  return (
    <div className="stack">
      <div className="callout">
        <Icon name="search" />
        <div className="small">
          Sorgular UYAP Avukat Portal'da kendi e-imzanızla yapılır (UYAP'ın dışarıya açık bir bağlantısı yoktur). Sonucu buraya kaydedin; Timay hangi sorgunun eskidiğini ve bulunan mala göre hangi haczin yapılması gerektiğini söyler.
          <div>
            <button className="link small" onClick={() => window.open(UYAP_PORTAL)}>
              UYAP Avukat Portal'ı aç
            </button>
          </div>
        </div>
      </div>
      <ErrorText error={q.error ?? err} />
      <div className="q-grid">
        {q.data?.kinds.map((k) => (
          <div key={k.key} className={`q-card ${k.last ? (k.last.found ? 'found' : 'empty') : 'none'} ${k.stale ? 'stale' : ''}`}>
            <div className="q-head">
              <strong>{k.label}</strong>
              {k.last ? (
                <span className={`badge ${k.last.found ? 'e-tahsil' : ''}`}>{k.last.found ? 'Bulundu' : 'Kayıt yok'}</span>
              ) : (
                <span className="badge e-itiraz">Sorgulanmadı</span>
              )}
            </div>
            {k.last && (
              <p className="small">
                {formatDate(k.last.date)} · {k.age} gün önce{k.stale && <strong className="error"> · yenileyin</strong>}
                {k.last.result && <span className="q-result">{k.last.result}</span>}
              </p>
            )}
            {k.suggest && (
              <p className="q-suggest small">
                <Icon name="alert" /> {k.suggest}
              </p>
            )}
            {open === k.key ? (
              <div className="q-form">
                <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
                <label className="check-line">
                  <input type="checkbox" checked={form.found} onChange={(e) => setForm({ ...form, found: e.target.checked })} /> Kayıt bulundu
                </label>
                <textarea rows={2} placeholder="Sonuç (ör. 34 ABC 123 plakalı araç, X AŞ işyeri)" value={form.result} onChange={(e) => setForm({ ...form, result: e.target.value })} />
                <div className="row">
                  <button className="primary" onClick={() => save(k.key)}>
                    Kaydet
                  </button>
                  <button onClick={() => setOpen(null)}>Vazgeç</button>
                </div>
              </div>
            ) : (
              <button className="link small" onClick={() => setOpen(k.key)}>
                Sonuç gir
              </button>
            )}
          </div>
        ))}
      </div>
      {(q.data?.history.length ?? 0) > 0 && (
        <Card title="Sorgu geçmişi" className="flush">
          <table className="table">
            <tbody>
              {q.data!.history.map((h) => (
                <tr key={h.id}>
                  <td>{formatDate(h.date)}</td>
                  <td>{label[h.kind] ?? h.kind}</td>
                  <td>{h.found ? 'Bulundu' : 'Kayıt yok'}</td>
                  <td className="small">{h.result}</td>
                  <td className="muted small">{h.created_by_name}</td>
                  <td>
                    <button className="ghost icon-btn" title="Sil" onClick={async () => q.setData(await api(`/enforcement-queries/${h.id}`, { method: 'DELETE' }))}>
                      <Icon name="trash" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}

function DebtorTab({ data, onSaved }: { data: EnforcementFile; onSaved: (f: EnforcementFile) => void }) {
  const tl = (k: number) => (k ? (k / 100).toLocaleString('tr-TR', { minimumFractionDigits: 2 }) : '');
  const [form, setForm] = useState({
    debtor: data.debtor,
    debtorIdNo: data.debtor_id_no,
    debtorAddress: data.debtor_address,
    creditor: data.creditor,
    officeName: data.office_name,
    fileNo: data.file_no,
    startDate: data.start_date,
    principal: tl(data.principal_kurus),
    interestType: data.interest_type,
    interestRate: String(data.interest_rate),
    preInterest: tl(data.pre_interest_kurus),
    fee: tl(data.fee_kurus),
    note: data.note,
  });
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const set = (key: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [key]: e.target.value });
  async function save(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    try {
      onSaved(await api<EnforcementFile>(`/enforcement/${data.id}`, { method: 'PUT', body: { ...form, interestRate: Number(form.interestRate.replace(',', '.')) || 0 } }));
      setMsg('Föy kaydedildi.');
    } catch (ex) {
      setErr((ex as Error).message);
    }
  }
  return (
    <Card title="Föy bilgileri">
      <form className="form-grid cols-3" onSubmit={save}>
        <Field label="Borçlu">
          <input value={form.debtor} onChange={set('debtor')} required />
        </Field>
        <Field label="TC / VKN">
          <input value={form.debtorIdNo} onChange={set('debtorIdNo')} />
        </Field>
        <Field label="Alacaklı">
          <input value={form.creditor} onChange={set('creditor')} />
        </Field>
        <Field label="Borçlu adresi" wide>
          <input value={form.debtorAddress} onChange={set('debtorAddress')} />
        </Field>
        <Field label="İcra dairesi">
          <input value={form.officeName} onChange={set('officeName')} />
        </Field>
        <Field label="Dosya no">
          <input value={form.fileNo} onChange={set('fileNo')} />
        </Field>
        <Field label="Takip tarihi">
          <input type="date" value={form.startDate} onChange={set('startDate')} />
        </Field>
        <Field label="Asıl alacak (TL)">
          <input value={form.principal} onChange={set('principal')} inputMode="decimal" />
        </Field>
        <Field label="Takip öncesi işlemiş faiz (TL)">
          <input value={form.preInterest} onChange={set('preInterest')} inputMode="decimal" />
        </Field>
        <Field label="Vekâlet ücreti (TL)">
          <input value={form.fee} onChange={set('fee')} inputMode="decimal" />
        </Field>
        <Field label="Faiz türü">
          <select value={form.interestType} onChange={set('interestType')}>
            <option value="sabit">Sözleşme / sabit oran</option>
            <option value="yasal">Yasal faiz (oranı kendiliğinden)</option>
          </select>
        </Field>
        {form.interestType === 'sabit' && (
          <Field label="Yıllık faiz %">
            <input value={form.interestRate} onChange={set('interestRate')} inputMode="decimal" />
          </Field>
        )}
        <Field label="Not" wide>
          <input value={form.note} onChange={set('note')} />
        </Field>
        <div className="form-actions">
          {msg && <span className="success-note">{msg}</span>}
          <ErrorText error={err} />
          <button className="primary" type="submit">
            Kaydet
          </button>
        </div>
      </form>
    </Card>
  );
}

export function EnforcementFileView({ id, go, initialTab }: { id: number; go: Go; initialTab?: string }) {
  const { data, error, setData } = useAsync(() => api<EnforcementFile>(`/enforcement/${id}`), [id]);
  const [tab, setTab] = useState(initialTab ?? 'hesap');
  const [version, setVersion] = useState(0);
  const [form, setForm] = useState({ date: today(), action: 'tahsilat', amount: '', note: '' });
  const [err, setErr] = useState<string | null>(null);

  if (!data) return <ErrorText error={error} />;

  async function addAction(e: FormEvent) {
    e.preventDefault();
    try {
      setData(await api<EnforcementFile>(`/enforcement/${id}/actions`, { body: form }));
      setForm({ ...form, amount: '', note: '' });
      setErr(null);
      setVersion((v) => v + 1);
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
        <Stat icon="trend" label={data.interest_type === 'yasal' ? 'İşlemiş faiz (yasal)' : `İşlemiş faiz (%${data.interest_rate} yıllık)`} value={formatTL(data.interest_kurus)} tone="amber" />
        <Stat icon="check" label="Tahsil edilen" value={formatTL(data.collected_kurus)} tone="green" />
        <Stat icon="alert" label="Kalan borç" value={formatTL(data.remaining_kurus)} tone={data.remaining_kurus > 0 ? 'red' : 'green'} />
        <Stat icon="inbox" label="Dairede bekleyen" value={formatTL(data.at_office_kurus)} tone="blue" />
      </div>
      <div className="progress big">
        <span style={{ width: `${percent(data)}%` }} />
      </div>
      <Tabs
        value={tab}
        onChange={setTab}
        items={[
          ['hesap', 'Dosya hesabı'],
          ['islem', `İşlemler (${data.actions?.length ?? 0})`],
          ['sorgu', 'Borçlu sorguları'],
          ['foy', 'Föy bilgileri'],
        ]}
      />
      {tab === 'hesap' && <AccountTab id={id} version={version} />}
      {tab === 'sorgu' && <QueriesTab id={id} onAction={() => setVersion((v) => v + 1)} />}
      {tab === 'foy' && (
        <DebtorTab
          data={data}
          onSaved={(f) => {
            setData(f);
            setVersion((v) => v + 1);
          }}
        />
      )}
      {tab === 'islem' && (
        <div className="grid-main-side">
          <Card title="İşlem geçmişi" className="flush">
            {!data.actions?.length ? (
              <Empty icon="clock">Henüz işlem kaydı yok.</Empty>
            ) : (
              <ul className="timeline">
                {data.actions.map((a) => (
                  <li key={a.id} className={MONEY_ACTIONS.has(a.action) ? 'money' : ''}>
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
      )}
    </div>
  );
}

interface ImportResult {
  fields: string[];
  rows: { line: number; values: Record<string, string>; match: { id: number; debtor: string } | null; op: 'yeni' | 'guncelle' | 'hata'; error: string }[];
  total: number;
  summary: { yeni: number; guncelle: number; hata: number };
  done: boolean;
}
const FIELD_LABEL: Record<string, string> = {
  debtor: 'Borçlu',
  creditor: 'Alacaklı',
  officeName: 'İcra dairesi',
  fileNo: 'Dosya no',
  kind: 'Tür',
  principal: 'Asıl alacak',
  interestRate: 'Faiz %',
  startDate: 'Takip tarihi',
  debtorIdNo: 'TC/VKN',
  debtorAddress: 'Adres',
  status: 'Durum',
  note: 'Not',
};

function ImportFiles({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [file, setFile] = useState<{ fileName: string; base64: string } | null>(null);
  const [res, setRes] = useState<ImportResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function pick(f: File | undefined) {
    if (!f) return;
    setErr(null);
    setRes(null);
    const buf = new Uint8Array(await f.arrayBuffer());
    let bin = '';
    for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    const body = { fileName: f.name, base64: btoa(bin) };
    setFile(body);
    try {
      setRes(await api<ImportResult>('/enforcement/import', { body }));
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  async function commit() {
    if (!file) return;
    setBusy(true);
    try {
      setRes(await api<ImportResult>('/enforcement/import', { body: { ...file, commit: true } }));
      onDone();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Excel'den toplu aktarım" actions={<button className="ghost" onClick={onClose}>Kapat</button>}>
      <p className="muted small">
        İlk satırı başlık olan bir Excel (.xlsx) ya da CSV dosyası seçin. Tanınan sütunlar: Borçlu, TC/VKN, Alacaklı, İcra Dairesi, Dosya No, Takip Türü, Asıl Alacak, Faiz Oranı,
        Takip Tarihi, Adres, Durum, Not. Aynı icra dairesi ve dosya numarası Timay'da varsa o dosya güncellenir (boş hücreler değiştirmez), yoksa yeni dosya açılır.
      </p>
      <input type="file" accept=".xlsx,.csv,.txt" onChange={(e) => pick(e.target.files?.[0])} />
      <ErrorText error={err} />
      {res && res.done && (
        <p className="success-note">
          Aktarıldı: {res.summary.yeni} yeni dosya açıldı, {res.summary.guncelle} dosya güncellendi{res.summary.hata ? `, ${res.summary.hata} satır atlandı` : ''}.
        </p>
      )}
      {res && !res.done && (
        <>
          <div className="bk-summary">
            <span className="tag">{res.summary.yeni} yeni</span>
            <span className="tag">{res.summary.guncelle} güncelleme</span>
            {res.summary.hata > 0 && <span className="tag t-bad">{res.summary.hata} hatalı satır</span>}
          </div>
          <div className="import-preview">
            <table className="table">
              <thead>
                <tr>
                  <th>Satır</th>
                  <th>İşlem</th>
                  {res.fields.map((f) => (
                    <th key={f}>{FIELD_LABEL[f] ?? f}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {res.rows.map((r) => (
                  <tr key={r.line} className={`imp-${r.op}`}>
                    <td>{r.line}</td>
                    <td>{r.op === 'yeni' ? 'Yeni dosya' : r.op === 'guncelle' ? `Güncelle: ${r.match?.debtor}` : r.error}</td>
                    {res.fields.map((f) => (
                      <td key={f}>{r.values[f]}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="form-actions">
            <button className="primary" disabled={busy || res.summary.yeni + res.summary.guncelle === 0} onClick={commit}>
              <Icon name="upload" /> {busy ? 'Aktarılıyor…' : `${res.summary.yeni + res.summary.guncelle} kaydı aktar`}
            </button>
          </div>
        </>
      )}
    </Card>
  );
}
