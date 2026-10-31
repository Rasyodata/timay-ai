import { useEffect, useState, type FormEvent } from 'react';
import { api, type CaseSummary, type DeadlineRule, type LegalDeadline, type Risk, type User } from './api';
import type { Go, View } from './App';
import { Card, DueLabel, Empty, ErrorText, Field, formatDate, Icon, PageHeader, Stat, Tabs, today, useAsync } from './ui';

const UNIT_LABEL = { gun: 'gün', hafta: 'hafta', ay: 'ay', yil: 'yıl' } as const;

export function riskLink(r: Risk): View | null {
  if (!r.link) return null;
  const { view, id } = r.link;
  if (id !== undefined && (view === 'case' || view === 'contract' || view === 'enforcement-file')) return { name: view, id };
  if (view === 'powers') return { name: 'powers', id };
  if (view === 'tasks' || view === 'deadlines') return { name: view };
  return null;
}

export function DeadlinesView({ go, initialTab }: { go: Go; initialTab?: string }) {
  const [tab, setTab] = useState<'riskler' | 'sureler' | 'hesap'>((initialTab as 'riskler') ?? 'riskler');
  const risks = useAsync(() => api<Risk[]>('/risks'), []);
  const list = useAsync(() => api<LegalDeadline[]>('/deadlines'), []);
  const r = risks.data ?? [];
  const high = r.filter((x) => x.level === 'yuksek').length;
  const reloadAll = () => {
    list.reload();
    risks.reload();
  };

  return (
    <div className="page">
      <PageHeader title="Önleyici hukuk" subtitle="Yasal süreler, zamanaşımları ve büro genelinde kaçırılabilecek riskler" />
      <div className="stats">
        <Stat icon="alert" label="Acil risk" value={high} tone={high ? 'red' : 'green'} onClick={() => setTab('riskler')} />
        <Stat icon="shield" label="Toplam uyarı" value={r.length} tone="amber" onClick={() => setTab('riskler')} />
        <Stat icon="clock" label="Takipteki süre" value={list.data?.length ?? 0} onClick={() => setTab('sureler')} />
        <Stat
          icon="calendar"
          label="7 gün içinde dolan"
          value={(list.data ?? []).filter((d) => d.due_date <= new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10)).length}
          tone="violet"
          onClick={() => setTab('sureler')}
        />
      </div>
      <Tabs
        value={tab}
        onChange={setTab}
        items={[
          ['riskler', `Risk uyarıları (${r.length})`],
          ['sureler', 'Süre takibi'],
          ['hesap', 'Süre hesaplayıcı'],
        ]}
      />
      {tab === 'riskler' && (
        <Card className="flush">
          <ErrorText error={risks.error} />
          {r.length === 0 ? (
            <Empty icon="shield">Şu an bir risk görünmüyor. Süreleri girdikçe ve dosyalar ilerledikçe burası kendiliğinden güncellenir.</Empty>
          ) : (
            <ul className="items risk-list">
              {r.map((x, i) => {
                const to = riskLink(x);
                return (
                  <li key={i} className={to ? 'clickable' : ''} onClick={() => to && go(to)}>
                    <span className={`risk-dot ${x.level}`} />
                    <span className="tag">{x.area}</span>
                    <span className="item-text">
                      <strong>{x.title}</strong>
                      <span>{x.detail}</span>
                    </span>
                    <span className={`risk-level ${x.level}`}>{x.level === 'yuksek' ? 'Acil' : 'Dikkat'}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      )}
      {tab === 'sureler' && <DeadlineList list={list.data ?? []} reload={reloadAll} go={go} error={list.error} />}
      {tab === 'hesap' && <Calculator onSaved={() => { reloadAll(); setTab('sureler'); }} />}
    </div>
  );
}

function DeadlineList({ list, reload, go, error }: { list: LegalDeadline[]; reload: () => void; go: Go; error: string | null }) {
  const [err, setErr] = useState<string | null>(null);
  async function act(path: string, method: string, body?: unknown) {
    try {
      await api(path, { method, body });
      reload();
    } catch (e) {
      setErr((e as Error).message);
    }
  }
  return (
    <Card title="Takipteki süreler" className="flush">
      <ErrorText error={error ?? err} />
      {list.length === 0 ? (
        <Empty icon="clock">Takipte süre yok. “Süre hesaplayıcı” sekmesinden tebliğ tarihini girip süreyi takibe alın.</Empty>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th />
              <th>Süre</th>
              <th>Dosya</th>
              <th>Sorumlu</th>
              <th>Son gün</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {list.map((d) => (
              <tr key={d.id}>
                <td className="check-cell">
                  <input type="checkbox" title="Tamamlandı" onChange={(e) => act(`/deadlines/${d.id}`, 'PUT', { done: e.target.checked })} />
                </td>
                <td>
                  <strong>{d.title}</strong>
                  <div className="muted small">
                    {[d.start_date && `başlangıç ${formatDate(d.start_date)}`, d.basis, d.note].filter(Boolean).join(' · ')}
                  </div>
                </td>
                <td>
                  {d.case_id ? (
                    <button className="link" onClick={() => go({ name: 'case', id: d.case_id! })}>
                      {d.case_title}
                    </button>
                  ) : (
                    <span className="muted">—</span>
                  )}
                </td>
                <td>{d.responsible_name}</td>
                <td>
                  <DueLabel date={d.due_date} />
                </td>
                <td>
                  <button className="ghost" title="Sil" onClick={() => act(`/deadlines/${d.id}`, 'DELETE')}>
                    ×
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}

function Calculator({ onSaved }: { onSaved: () => void }) {
  const rules = useAsync(() => api<DeadlineRule[]>('/deadline-rules'), []);
  const cases = useAsync(() => api<CaseSummary[]>('/cases'), []);
  const users = useAsync(() => api<User[]>('/users'), []);
  const [ruleId, setRuleId] = useState('hmk-istinaf');
  const [start, setStart] = useState(today());
  const [caseId, setCaseId] = useState('');
  const [responsibleId, setResponsibleId] = useState('');
  const [note, setNote] = useState('');
  const [result, setResult] = useState<{ date: string; notes: string[] } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const rule = rules.data?.find((r) => r.id === ruleId);
  const groups = [...new Set((rules.data ?? []).map((r) => r.group))];

  useEffect(() => {
    compute();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function compute(id = ruleId, s = start) {
    try {
      setResult(await api<{ date: string; notes: string[] }>('/deadlines/calculate', { body: { ruleId: id, start: s } }));
      setErr(null);
    } catch (e) {
      setResult(null);
      setErr((e as Error).message);
    }
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    try {
      await api('/deadlines', {
        body: { ruleId, start, caseId: caseId ? Number(caseId) : null, responsibleId: responsibleId ? Number(responsibleId) : undefined, note },
      });
      onSaved();
    } catch (ex) {
      setErr((ex as Error).message);
    }
  }

  return (
    <div className="grid-main-side">
      <Card title="Süre hesapla">
        <form className="form-grid" onSubmit={save}>
          <Field label="Süre türü" wide>
            <select
              value={ruleId}
              onChange={(e) => {
                setRuleId(e.target.value);
                compute(e.target.value);
              }}
            >
              {groups.map((g) => (
                <optgroup key={g} label={g}>
                  {rules.data!
                    .filter((r) => r.group === g)
                    .map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.title} ({r.amount} {UNIT_LABEL[r.unit]})
                      </option>
                    ))}
                </optgroup>
              ))}
            </select>
          </Field>
          <Field label={rule ? `Başlangıç: ${rule.start}` : 'Başlangıç tarihi'}>
            <input
              type="date"
              value={start}
              onChange={(e) => {
                setStart(e.target.value);
                compute(ruleId, e.target.value);
              }}
              required
            />
          </Field>
          <Field label="Dava dosyası">
            <select value={caseId} onChange={(e) => setCaseId(e.target.value)}>
              <option value="">—</option>
              {cases.data?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Sorumlu">
            <select value={responsibleId} onChange={(e) => setResponsibleId(e.target.value)}>
              <option value="">Ben</option>
              {users.data?.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Not">
            <input value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
          <div className="form-actions">
            <ErrorText error={err} />
            <button type="button" onClick={() => compute()}>
              Hesapla
            </button>
            <button className="primary" type="submit">
              <Icon name="plus" /> Takibe al ve ajandaya ekle
            </button>
          </div>
        </form>
      </Card>
      <Card title="Sonuç" className="sticky">
        {!result || !rule ? (
          <Empty icon="calendar">Süre türünü ve başlangıç tarihini seçin.</Empty>
        ) : (
          <div className="calc-result">
            <span className="muted">Son gün</span>
            <strong className="big-date">{formatDate(result.date)}</strong>
            <span className="muted small">
              {new Date(`${result.date}T00:00:00`).toLocaleDateString('tr-TR', { weekday: 'long' })} · <DueLabel date={result.date} />
            </span>
            <p>
              <strong>{rule.title}</strong>: {rule.amount} {UNIT_LABEL[rule.unit]}, {rule.start.toLocaleLowerCase('tr')} tarihinden itibaren ({rule.basis}).
            </p>
            {result.notes.map((n) => (
              <p key={n} className="warning small">
                {n}
              </p>
            ))}
            <p className="muted small">
              Dinî bayramlar ve hafta içine denk gelen yarım günler hesaba katılmaz. Kritik sürelerde son günü mutlaka kontrol edin.
            </p>
          </div>
        )}
      </Card>
    </div>
  );
}
