import { useEffect, useState, type FormEvent } from 'react';
import { api, type CaseSummary, type DeadlineRule } from './api';
import type { Go } from './App';
import { Card, DueLabel, Empty, ErrorText, Field, formatDate, Icon, PageHeader, Stat, Tabs, today, useAsync } from './ui';

/*
 * Tebligat takibi: e-tebligat (UETS), posta, TK 21 ve ilanen tebligatlar. Tebliğ tarihi kanuna göre
 * hesaplanır, doğan süre önerilir ve tek tıkla süre takibine (ajanda, bildirim, risk) alınır.
 */

type Channel = 'e-tebligat' | 'posta' | 'tk21' | 'ilan';

interface Tebligat {
  id: number;
  case_id: number | null;
  case_title: string | null;
  channel: Channel;
  channel_label: string;
  sender: string;
  subject: string;
  received_date: string;
  served_date: string;
  rule_id: string;
  rule_title: string;
  deadline_id: number | null;
  due_date: string | null;
  status: 'islenmedi' | 'takipte' | 'tamam' | 'suresiz';
  author: string;
}

interface Meta {
  channels: Record<Channel, { label: string; days: number; basis: string }>;
  noDeadline: string;
}

interface ParsedRow {
  receivedDate: string;
  servedDate: string;
  sender: string;
  subject: string;
  esasNo: string;
  caseId: number | null;
  caseTitle: string;
  ruleId: string;
}

const STATUS: Record<Tebligat['status'], [string, string]> = {
  islenmedi: ['Süre takibe alınmadı', 'red'],
  takipte: ['Süre takipte', 'amber'],
  tamam: ['Tamamlandı', 'green'],
  suresiz: ['Süre doğurmaz', 'gray'],
};

function RuleSelect({ rules, value, onChange, noDeadline }: { rules: DeadlineRule[]; value: string; onChange: (v: string) => void; noDeadline: string }) {
  const groups = [...new Set(rules.map((r) => r.group))];
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">— süre türü seçin —</option>
      <option value={noDeadline}>Süre doğurmaz (davetiye, bilgi)</option>
      {groups.map((g) => (
        <optgroup key={g} label={g}>
          {rules
            .filter((r) => r.group === g)
            .map((r) => (
              <option key={r.id} value={r.id}>
                {r.title} ({r.basis})
              </option>
            ))}
        </optgroup>
      ))}
    </select>
  );
}

export function TebligatView({ go }: { go: Go }) {
  const [tab, setTab] = useState<'liste' | 'ekle' | 'uets'>('liste');
  const list = useAsync(() => api<Tebligat[]>('/tebligat'), []);
  const meta = useAsync(() => api<Meta>('/tebligat/meta'), []);
  const rules = useAsync(() => api<DeadlineRule[]>('/deadline-rules'), []);
  const cases = useAsync(() => api<CaseSummary[]>('/cases'), []);
  const items = list.data ?? [];
  const open = items.filter((t) => t.status === 'islenmedi').length;
  const week = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);

  return (
    <div className="page">
      <PageHeader
        title="Tebligatlar"
        subtitle="E-tebligat (UETS), posta ve ilanen tebligatlar. Tebliğ tarihi kanuna göre hesaplanır, doğan süre ajandaya ve bildirimlere işlenir."
      />
      <div className="stats">
        <Stat icon="alert" label="Süresi takibe alınmamış" value={open} tone={open ? 'red' : 'green'} onClick={() => setTab('liste')} />
        <Stat icon="inbox" label="Son 7 günde tebliğ" value={items.filter((t) => t.served_date >= week).length} />
        <Stat icon="clock" label="Süresi takipte" value={items.filter((t) => t.status === 'takipte').length} tone="amber" />
        <Stat icon="upload" label="UETS listesini yapıştır" value="Toplu" tone="violet" onClick={() => setTab('uets')} />
      </div>
      <Tabs
        value={tab}
        onChange={setTab}
        items={[
          ['liste', `Tebligatlar (${items.length})`],
          ['ekle', 'Tebligat ekle'],
          ['uets', 'UETS / UYAP listesinden toplu ekle'],
        ]}
      />
      {tab === 'liste' && (
        <TebligatList items={items} rules={rules.data ?? []} meta={meta.data} go={go} reload={list.reload} error={list.error} />
      )}
      {tab === 'ekle' && meta.data && (
        <AddForm
          meta={meta.data}
          rules={rules.data ?? []}
          cases={cases.data ?? []}
          onSaved={() => {
            list.reload();
            setTab('liste');
          }}
        />
      )}
      {tab === 'uets' && meta.data && (
        <BulkPaste
          meta={meta.data}
          rules={rules.data ?? []}
          cases={cases.data ?? []}
          onSaved={() => {
            list.reload();
            setTab('liste');
          }}
        />
      )}
    </div>
  );
}

function TebligatList({ items, rules, meta, go, reload, error }: { items: Tebligat[]; rules: DeadlineRule[]; meta: Meta | null; go: Go; reload: () => void; error: string | null }) {
  const [err, setErr] = useState<string | null>(null);
  const [pick, setPick] = useState<Record<number, string>>({});
  async function act(path: string, method: string, body?: unknown) {
    try {
      await api(path, { method, body });
      setErr(null);
      reload();
    } catch (e) {
      setErr((e as Error).message);
    }
  }
  return (
    <Card className="flush">
      <ErrorText error={error ?? err} />
      {items.length === 0 ? (
        <Empty icon="inbox">Henüz tebligat yok. “Tebligat ekle” ile tek tek girin ya da UETS’teki listeyi kopyalayıp “toplu ekle” sekmesine yapıştırın.</Empty>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Tebliğ edilen</th>
              <th>Dosya</th>
              <th>Geliş / tebliğ</th>
              <th>Süre</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {items.map((t) => {
              const [label, tone] = STATUS[t.status];
              const ruleValue = pick[t.id] ?? t.rule_id;
              return (
                <tr key={t.id}>
                  <td>
                    <strong>{t.subject}</strong>
                    <div className="muted small">{[t.channel_label, t.sender].filter(Boolean).join(' · ')}</div>
                  </td>
                  <td>
                    {t.case_id ? (
                      <button className="link" onClick={() => go({ name: 'case', id: t.case_id! })}>
                        {t.case_title}
                      </button>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                  <td>
                    <div className="small">{formatDate(t.received_date)}</div>
                    <strong title={meta?.channels[t.channel].basis}>{formatDate(t.served_date)}</strong>
                  </td>
                  <td>
                    <span className={`badge t-${tone}`}>{label}</span>
                    {t.deadline_id && t.due_date ? (
                      <div className="small">
                        {t.rule_title}: <DueLabel date={t.due_date} />
                      </div>
                    ) : t.status === 'islenmedi' && meta ? (
                      <div className="inline-form">
                        <RuleSelect rules={rules} value={ruleValue} noDeadline={meta.noDeadline} onChange={(v) => setPick({ ...pick, [t.id]: v })} />
                        {ruleValue === meta.noDeadline ? (
                          <button onClick={() => act(`/tebligat/${t.id}`, 'PUT', { ruleId: meta.noDeadline })}>Kaydet</button>
                        ) : (
                          <button className="primary" disabled={!ruleValue} onClick={() => act(`/tebligat/${t.id}/track`, 'POST', { ruleId: ruleValue })}>
                            Takibe al
                          </button>
                        )}
                      </div>
                    ) : null}
                  </td>
                  <td>
                    <button className="ghost" title="Sil" onClick={() => act(`/tebligat/${t.id}`, 'DELETE')}>
                      ×
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </Card>
  );
}

function AddForm({ meta, rules, cases, onSaved }: { meta: Meta; rules: DeadlineRule[]; cases: CaseSummary[]; onSaved: () => void }) {
  const [form, setForm] = useState({ caseId: '', channel: 'e-tebligat' as Channel, receivedDate: today(), sender: '', subject: '', ruleId: '', note: '', track: true });
  const [ruleTouched, setRuleTouched] = useState(false);
  const [served, setServed] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const area = cases.find((c) => String(c.id) === form.caseId)?.area ?? '';

  useEffect(() => {
    if (!form.receivedDate) return;
    const t = setTimeout(() => {
      api<{ ruleId: string; servedDate: string }>('/tebligat/suggest', { body: { subject: form.subject, area, channel: form.channel, receivedDate: form.receivedDate } })
        .then((r) => {
          setServed(r.servedDate);
          if (!ruleTouched) setForm((f) => ({ ...f, ruleId: r.ruleId }));
        })
        .catch(() => setServed(''));
    }, 250);
    return () => clearTimeout(t);
  }, [form.subject, form.channel, form.receivedDate, area, ruleTouched]);

  async function save(e: FormEvent) {
    e.preventDefault();
    try {
      await api('/tebligat', { body: { ...form, caseId: form.caseId ? Number(form.caseId) : null } });
      onSaved();
    } catch (ex) {
      setErr((ex as Error).message);
    }
  }
  const rule = rules.find((r) => r.id === form.ruleId);

  return (
    <div className="grid-main-side">
      <Card title="Tebligat ekle">
        <form className="form-grid" onSubmit={save}>
          <Field label="Tebliğ edilen evrak" wide>
            <input value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} placeholder="ör. Gerekçeli karar, bilirkişi raporu, ödeme emri" required />
          </Field>
          <Field label="Dava dosyası">
            <select value={form.caseId} onChange={(e) => setForm({ ...form, caseId: e.target.value })}>
              <option value="">—</option>
              {cases.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Gönderen (mahkeme, icra dairesi, kurum)">
            <input value={form.sender} onChange={(e) => setForm({ ...form, sender: e.target.value })} />
          </Field>
          <Field label="Tebligat şekli">
            <select value={form.channel} onChange={(e) => setForm({ ...form, channel: e.target.value as Channel })}>
              {(Object.keys(meta.channels) as Channel[]).map((k) => (
                <option key={k} value={k}>
                  {meta.channels[k].label}
                </option>
              ))}
            </select>
          </Field>
          <Field label={form.channel === 'e-tebligat' ? 'Elektronik adrese ulaştığı gün' : form.channel === 'ilan' ? 'Son ilan tarihi' : 'Tebliğ tarihi'}>
            <input type="date" value={form.receivedDate} onChange={(e) => setForm({ ...form, receivedDate: e.target.value })} required />
          </Field>
          <Field label="Doğan süre" wide>
            <RuleSelect
              rules={rules}
              value={form.ruleId}
              noDeadline={meta.noDeadline}
              onChange={(v) => {
                setRuleTouched(true);
                setForm({ ...form, ruleId: v });
              }}
            />
          </Field>
          <Field label="Not" wide>
            <input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
          </Field>
          <label className="check-line">
            <input type="checkbox" checked={form.track} onChange={(e) => setForm({ ...form, track: e.target.checked })} />
            Süreyi hemen takibe al (ajandaya ve bildirimlere eklenir)
          </label>
          <div className="form-actions">
            <ErrorText error={err} />
            <button className="primary" type="submit">
              <Icon name="plus" /> Kaydet
            </button>
          </div>
        </form>
      </Card>
      <Card title="Tebliğ tarihi" className="sticky">
        {served ? (
          <div className="calc-result">
            <span className="muted">Tebliğ edilmiş sayıldığı gün</span>
            <strong className="big-date">{formatDate(served)}</strong>
            <p className="muted small">{meta.channels[form.channel].basis}</p>
            {rule && (
              <p>
                Doğan süre: <strong>{rule.title}</strong> ({rule.basis}). Süre {formatDate(served)} tarihinden itibaren işler.
              </p>
            )}
            {form.ruleId === meta.noDeadline && <p className="muted small">Bu tebligat süre doğurmaz olarak kaydedilecek.</p>}
            <p className="warning small">E-tebligatta erken okumak tebliğ tarihini değiştirmez. Kritik sürelerde UETS’teki tarihi mutlaka kontrol edin.</p>
          </div>
        ) : (
          <Empty icon="calendar">Tarihi girin.</Empty>
        )}
      </Card>
    </div>
  );
}

function BulkPaste({ meta, rules, cases, onSaved }: { meta: Meta; rules: DeadlineRule[]; cases: CaseSummary[]; onSaved: () => void }) {
  const [text, setText] = useState('');
  const [rows, setRows] = useState<(ParsedRow & { keep: boolean })[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function parse() {
    try {
      const r = await api<ParsedRow[]>('/tebligat/parse', { body: { text } });
      setRows(r.map((x) => ({ ...x, keep: true })));
      setErr(r.length ? null : 'Metinde tarih içeren satır bulunamadı. UETS’te listeyi seçip kopyalayın (Ctrl+A, Ctrl+C) ve buraya yapıştırın.');
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  async function saveAll() {
    if (!rows) return;
    setBusy(true);
    let n = 0;
    try {
      for (const r of rows.filter((x) => x.keep)) {
        await api('/tebligat', {
          body: { caseId: r.caseId, channel: 'e-tebligat', receivedDate: r.receivedDate, sender: r.sender, subject: r.subject, ruleId: r.ruleId, track: Boolean(r.ruleId && r.ruleId !== meta.noDeadline) },
        });
        n++;
      }
      onSaved();
    } catch (e) {
      setErr(`${n} tebligat eklendi, sonra hata oluştu: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  const set = (i: number, patch: Partial<ParsedRow & { keep: boolean }>) => setRows((rs) => rs && rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  return (
    <Card title="UETS / UYAP tebligat listesinden toplu ekle">
      <p className="muted small">
        UETS’te (e-tebligat) ya da UYAP Avukat Portal’daki tebligat listesini seçip kopyalayın, buraya yapıştırın. Her satırdaki tarih, gönderen kurum, evrak ve esas
        numarası ayrılır; esas numarası büronuzdaki bir dosyayla eşleşirse dosya kendiliğinden seçilir.
      </p>
      <textarea rows={8} className="mono" value={text} onChange={(e) => setText(e.target.value)} placeholder="Listeyi buraya yapıştırın" />
      <div className="form-actions">
        <ErrorText error={err} />
        <button className="primary" disabled={!text.trim()} onClick={parse}>
          Satırları ayır
        </button>
      </div>
      {rows && rows.length > 0 && (
        <>
          <table className="table">
            <thead>
              <tr>
                <th />
                <th>Evrak / gönderen</th>
                <th>Dosya</th>
                <th>Tebliğ</th>
                <th>Doğan süre</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  <td className="check-cell">
                    <input type="checkbox" checked={r.keep} onChange={(e) => set(i, { keep: e.target.checked })} />
                  </td>
                  <td>
                    <input value={r.subject} onChange={(e) => set(i, { subject: e.target.value })} />
                    <div className="muted small">{[r.sender, r.esasNo && `${r.esasNo} E.`].filter(Boolean).join(' · ')}</div>
                  </td>
                  <td>
                    <select value={r.caseId ?? ''} onChange={(e) => set(i, { caseId: e.target.value ? Number(e.target.value) : null })}>
                      <option value="">—</option>
                      {cases.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.title}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <div className="small">{formatDate(r.receivedDate)}</div>
                    <strong>{formatDate(r.servedDate)}</strong>
                  </td>
                  <td>
                    <RuleSelect rules={rules} value={r.ruleId} noDeadline={meta.noDeadline} onChange={(v) => set(i, { ruleId: v })} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="form-actions">
            <span className="muted small">Süre türü seçilen satırların süresi takibe alınır.</span>
            <button className="primary" disabled={busy || !rows.some((r) => r.keep)} onClick={saveAll}>
              {busy ? 'Ekleniyor…' : `${rows.filter((r) => r.keep).length} tebligatı ekle`}
            </button>
          </div>
        </>
      )}
    </Card>
  );
}
