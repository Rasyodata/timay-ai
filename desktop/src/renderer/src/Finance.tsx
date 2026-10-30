import { useState, type FormEvent } from 'react';
import { api, type CaseSummary, type FinanceEntry, type FinanceReport } from './api';
import type { Go } from './App';
import { Card, Empty, ErrorText, Field, formatDate, formatTL, Icon, PageHeader, Stat, Tabs, today, useAsync } from './ui';

const KIND_LABEL: Record<FinanceEntry['kind'], string> = { gelir: 'Gelir', gider: 'Büro gideri', masraf: 'Dava masrafı' };

const CATEGORIES: Record<FinanceEntry['kind'], string[]> = {
  gelir: ['Vekâlet ücreti', 'Danışmanlık ücreti', 'Karşı taraf vekâlet ücreti', 'Masraf iadesi', 'Diğer'],
  gider: ['Kira', 'Personel', 'Fatura', 'Kırtasiye', 'Yazılım', 'Vergi ve SGK', 'Diğer'],
  masraf: ['Harç', 'Tebligat', 'Bilirkişi', 'Keşif', 'Tanık', 'Yol', 'Diğer'],
};

type Period = 'month' | 'year' | 'all';

function range(period: Period) {
  const d = today();
  if (period === 'month') return `from=${d.slice(0, 7)}-01&to=${d.slice(0, 7)}-31`;
  if (period === 'year') return `from=${d.slice(0, 4)}-01-01&to=${d.slice(0, 4)}-12-31`;
  return '';
}

function monthName(ym: string) {
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('tr-TR', { month: 'short', year: 'numeric' });
}

export function FinanceView({ go }: { go: Go }) {
  const [period, setPeriod] = useState<Period>('year');
  const report = useAsync(() => api<FinanceReport>(`/finance?${range(period)}`), [period]);
  const cases = useAsync(() => api<CaseSummary[]>('/cases'), []);
  const [kindFilter, setKindFilter] = useState<'all' | FinanceEntry['kind']>('all');
  const r = report.data;

  async function remove(id: number) {
    await api(`/finance/${id}`, { method: 'DELETE' });
    report.reload();
  }

  const maxMonth = Math.max(1, ...(r?.monthly ?? []).map((m) => Math.max(m.income, m.expense + m.costs)));
  const entries = (r?.entries ?? []).filter((e) => kindFilter === 'all' || e.kind === kindFilter);

  return (
    <div className="page">
      <PageHeader
        title="Hukuk muhasebesi"
        subtitle="Davalardan alınan ücretler, masraflar, büro giderleri, kâr-zarar ve vergi"
        actions={
          <Tabs
            value={period}
            onChange={setPeriod}
            items={[
              ['month', 'Bu ay'],
              ['year', 'Bu yıl'],
              ['all', 'Tümü'],
            ]}
          />
        }
      />
      <ErrorText error={report.error} />
      {r && (
        <>
          <div className="stats">
            <Stat icon="trend" label="Gelir" value={formatTL(r.summary.income)} tone="green" />
            <Stat icon="wallet" label="Büro giderleri" value={formatTL(r.summary.expense)} tone="red" />
            <Stat icon="gavel" label="Dava masrafları" value={formatTL(r.summary.costs)} tone="amber" />
            <Stat icon="check" label={r.summary.profit >= 0 ? 'Net kâr' : 'Net zarar'} value={formatTL(r.summary.profit)} tone={r.summary.profit >= 0 ? 'green' : 'red'} />
          </div>

          <div className="grid-3">
            <Card title="Vergi özeti">
              <dl className="money">
                <div>
                  <dt>Tahsil edilen KDV</dt>
                  <dd>{formatTL(r.summary.vatCollected)}</dd>
                </div>
                <div>
                  <dt>Ödenen (indirilecek) KDV</dt>
                  <dd>{formatTL(r.summary.vatPaid)}</dd>
                </div>
                <div className="total">
                  <dt>Ödenecek KDV</dt>
                  <dd className={r.summary.vatPayable > 0 ? 'bad' : 'ok'}>{formatTL(r.summary.vatPayable)}</dd>
                </div>
                <div>
                  <dt>Müvekkilin kestiği stopaj</dt>
                  <dd>{formatTL(r.summary.withholding)}</dd>
                </div>
              </dl>
              <p className="muted small">Serbest meslek makbuzu tutarları üzerinden hesaplanır; beyanname öncesi mali müşavirinizle kontrol edin.</p>
            </Card>

            <Card title="Aylık gelir ve gider" className="span-2">
              {r.monthly.length === 0 ? (
                <Empty icon="trend">Bu dönemde kayıt yok.</Empty>
              ) : (
                <div className="bars">
                  {r.monthly.map((m) => (
                    <div key={m.month} className="bar-group" title={`Gelir ${formatTL(m.income)} · Gider ${formatTL(m.expense + m.costs)}`}>
                      <div className="bar-pair">
                        <span className="bar income" style={{ height: `${(m.income / maxMonth) * 100}%` }} />
                        <span className="bar expense" style={{ height: `${((m.expense + m.costs) / maxMonth) * 100}%` }} />
                      </div>
                      <span className="bar-label">{monthName(m.month)}</span>
                    </div>
                  ))}
                </div>
              )}
              <div className="legend">
                <span>
                  <i className="dot income" /> Gelir
                </span>
                <span>
                  <i className="dot expense" /> Gider ve masraf
                </span>
              </div>
            </Card>
          </div>

          <div className="grid-main-side">
            <div className="stack">
              <Card
                title="Hareketler"
                className="flush"
                actions={
                  <Tabs
                    value={kindFilter}
                    onChange={setKindFilter}
                    items={[
                      ['all', 'Tümü'],
                      ['gelir', 'Gelir'],
                      ['gider', 'Gider'],
                      ['masraf', 'Masraf'],
                    ]}
                  />
                }
              >
                {entries.length === 0 ? (
                  <Empty icon="wallet">Kayıt yok. Sağdaki formdan ilk kaydı ekleyin.</Empty>
                ) : (
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Tarih</th>
                        <th>Tür</th>
                        <th>Açıklama</th>
                        <th>Dosya / müvekkil</th>
                        <th className="num">Tutar</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {entries.map((e) => (
                        <tr key={e.id}>
                          <td>{formatDate(e.date)}</td>
                          <td>
                            <span className={`tag ${e.kind}`}>{KIND_LABEL[e.kind]}</span>
                          </td>
                          <td>
                            {e.description || e.category}
                            {e.description && e.category && <div className="muted small">{e.category}</div>}
                          </td>
                          <td>
                            {e.case_id ? (
                              <button className="link" onClick={() => go({ name: 'case', id: e.case_id!, tab: 'muhasebe' })}>
                                {e.case_title}
                              </button>
                            ) : (
                              <span className="muted">{e.client || '—'}</span>
                            )}
                          </td>
                          <td className={`num ${e.kind === 'gelir' ? 'ok-text' : 'bad-text'}`}>
                            {e.kind === 'gelir' ? '+' : '−'}
                            {formatTL(e.amount_kurus)}
                          </td>
                          <td>
                            <button className="ghost" title="Sil" onClick={() => remove(e.id)}>
                              ×
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </Card>

              <Card title="Dosya bazında kâr-zarar" className="flush">
                {r.byCase.length === 0 ? (
                  <Empty icon="folder">Dosyaya bağlı kayıt yok.</Empty>
                ) : (
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Dava dosyası</th>
                        <th className="num">Alınan</th>
                        <th className="num">Masraf</th>
                        <th className="num">Net</th>
                      </tr>
                    </thead>
                    <tbody>
                      {r.byCase.map((c) => (
                        <tr key={c.caseId} className="clickable" onClick={() => go({ name: 'case', id: c.caseId, tab: 'muhasebe' })}>
                          <td>{c.title}</td>
                          <td className="num">{formatTL(c.income)}</td>
                          <td className="num">{formatTL(c.costs)}</td>
                          <td className={`num ${c.income - c.costs >= 0 ? 'ok-text' : 'bad-text'}`}>{formatTL(c.income - c.costs)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </Card>
            </div>
            <EntryForm cases={cases.data ?? []} onAdded={report.reload} />
          </div>
        </>
      )}
    </div>
  );
}

function EntryForm({ cases, onAdded }: { cases: CaseSummary[]; onAdded: () => void }) {
  const blank = { kind: 'gelir' as FinanceEntry['kind'], amount: '', date: today(), category: 'Vekâlet ücreti', description: '', client: '', caseId: '', vatRate: '20', withholdingRate: '20' };
  const [form, setForm] = useState(blank);
  const [err, setErr] = useState<string | null>(null);
  const set = (key: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [key]: e.target.value });

  function setKind(kind: FinanceEntry['kind']) {
    setForm({ ...form, kind, category: CATEGORIES[kind][0], withholdingRate: kind === 'gelir' ? '20' : '0', vatRate: kind === 'masraf' ? '0' : '20' });
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    try {
      const c = cases.find((x) => String(x.id) === form.caseId);
      await api('/finance', {
        body: {
          ...form,
          caseId: form.caseId ? Number(form.caseId) : null,
          client: form.client || c?.client || '',
          vatRate: Number(form.vatRate),
          withholdingRate: Number(form.withholdingRate),
        },
      });
      setForm({ ...blank, kind: form.kind, category: form.category, vatRate: form.vatRate, withholdingRate: form.withholdingRate });
      setErr(null);
      onAdded();
    } catch (ex) {
      setErr((ex as Error).message);
    }
  }

  return (
    <Card title="Yeni kayıt" className="sticky">
      <div className="segmented">
        {(Object.keys(KIND_LABEL) as FinanceEntry['kind'][]).map((k) => (
          <button key={k} type="button" className={form.kind === k ? 'active' : ''} onClick={() => setKind(k)}>
            {KIND_LABEL[k]}
          </button>
        ))}
      </div>
      <form className="form-grid" onSubmit={submit}>
        <Field label="Tutar (TL, KDV hariç)">
          <input value={form.amount} onChange={set('amount')} placeholder="ör. 15.000" inputMode="decimal" required />
        </Field>
        <Field label="Tarih">
          <input type="date" value={form.date} onChange={set('date')} required />
        </Field>
        <Field label="Kategori">
          <select value={form.category} onChange={set('category')}>
            {CATEGORIES[form.kind].map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </Field>
        <Field label="Dava dosyası">
          <select value={form.caseId} onChange={set('caseId')}>
            <option value="">—</option>
            {cases.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Açıklama" wide>
          <input value={form.description} onChange={set('description')} />
        </Field>
        {form.kind === 'gelir' && (
          <Field label="Müvekkil" wide>
            <input value={form.client} onChange={set('client')} placeholder="Dosya seçildiyse dosyadaki müvekkil kullanılır" />
          </Field>
        )}
        <Field label="KDV %">
          <select value={form.vatRate} onChange={set('vatRate')}>
            {['0', '1', '10', '20'].map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
        </Field>
        {form.kind === 'gelir' && (
          <Field label="Stopaj %">
            <select value={form.withholdingRate} onChange={set('withholdingRate')}>
              {['0', '20'].map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
          </Field>
        )}
        <div className="form-actions">
          <ErrorText error={err} />
          <button className="primary" type="submit">
            <Icon name="plus" /> Kaydet
          </button>
        </div>
      </form>
    </Card>
  );
}
