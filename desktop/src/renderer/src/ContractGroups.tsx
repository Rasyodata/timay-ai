import { useState, type FormEvent } from 'react';
import { api, type ContractDetail } from './api';
import type { Go } from './App';
import { FilePick } from './Clm';
import { DOC_ACCEPT, documentText } from './docread';
import { RefreshBar, RowRefresh } from './Refresh';
import { Card, Empty, ErrorText, Field, formatDate, formatTL, Icon, PageHeader, useAsync } from './ui';

/*
 * Sözleşme dosyaları: bir işin sözleşmeleri ya da toplu incelenen benzer sözleşmeler.
 * Her sözleşmenin riski ayrı, dosyanın toplu riski ve ortak sorunları birlikte gösterilir.
 */

type Band = 'dusuk' | 'orta' | 'yuksek';

export interface GroupSummary {
  id: number;
  title: string;
  kind: string;
  side: string;
  created_at: string;
  contracts: number;
  value_kurus: number;
}

interface GroupContract {
  id: number;
  title: string;
  kind: string;
  status: string;
  value_kurus: number;
  end_date: string;
  relation: string;
  terminated_at: string;
  open_obligations: number;
  late_obligations: number;
  risk: { genel: number; madde: number; ictihat: number; band: Band } | null;
  against: number;
  missing: number;
}

interface GroupDetail extends Omit<GroupSummary, 'contracts'> {
  note: string;
  contracts: GroupContract[];
  summary: {
    count: number;
    reviewed: number;
    toplu: number;
    band: Band;
    average: number;
    max: number;
    worst: { id: number; title: string } | null;
    bands: Record<Band, number>;
    value_kurus: number;
    open_obligations: number;
    late_obligations: number;
    active: number;
    terminated: number;
  };
  common: { key: string; title: string; topic: string; severity: string; verdict: string; contracts: { id: number; title: string }[] }[];
}

export const KIND_OPTIONS: [string, string][] = [
  ['kat-karsiligi', 'Kat karşılığı inşaat'],
  ['hizmet', 'Hizmet'],
  ['satis', 'Satış'],
  ['kira-konut', 'Kira'],
  ['gizlilik', 'Gizlilik'],
  ['', 'Karışık / diğer'],
];
const KIND_LABEL = Object.fromEntries(KIND_OPTIONS);
const BAND_LABEL: Record<Band, string> = { dusuk: 'Düşük risk', orta: 'Orta risk', yuksek: 'Yüksek risk' };
const STATUS_LABEL: Record<string, string> = { taslak: 'Taslak', yururlukte: 'Yürürlükte', sona_erdi: 'Sona erdi' };
const RELATION_LABEL: Record<string, string> = { ek: 'Ek sözleşme', yenileme: 'Yenileme' };

/** Sözleşmeler sayfasındaki "Sözleşme dosyaları" listesi. */
export function GroupsList({ go, onBulk }: { go: Go; onBulk: () => void }) {
  const groups = useAsync(() => api<GroupSummary[]>('/contract-groups'), []);
  return (
    <Card className="flush" title="Sözleşme dosyaları" actions={<button onClick={onBulk}><Icon name="upload" /> Toplu sözleşme ekle</button>}>
      <ErrorText error={groups.error} />
      {groups.data?.length === 0 ? (
        <Empty icon="folder">Henüz sözleşme dosyası yok. Bir işin sözleşmelerini ya da benzer sözleşmeleri (ör. 10 kat karşılığı) toplu ekleyip birlikte inceleyin.</Empty>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Dosya</th>
              <th>Tür</th>
              <th className="num">Sözleşme</th>
              <th className="num">Toplam bedel</th>
              <th>Açılış</th>
              <th className="num">Güncelle</th>
            </tr>
          </thead>
          <tbody>
            {groups.data?.map((g) => (
              <tr key={g.id} className="clickable" onClick={() => go({ name: 'contract-group', id: g.id })}>
                <td>
                  <Icon name="folder" /> <strong>{g.title}</strong>
                </td>
                <td className="muted">{KIND_LABEL[g.kind] ?? 'Karışık'}</td>
                <td className="num">{g.contracts}</td>
                <td className="num">{g.value_kurus ? formatTL(g.value_kurus) : '—'}</td>
                <td>{formatDate(g.created_at)}</td>
                <td className="num">
                  <RowRefresh entity="group" id={g.id} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}

/** Toplu sözleşme ekleme: yeni ya da var olan dosyaya birden çok dosya (Word, PDF, UYAP, TIF, resim). */
export function BulkAdd({ go, groupId, onClose }: { go: Go; groupId?: number; onClose: () => void }) {
  const groups = useAsync(() => api<GroupSummary[]>('/contract-groups'), []);
  const [target, setTarget] = useState<string>(groupId ? String(groupId) : 'new');
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState('kat-karsiligi');
  const [side, setSide] = useState('arsa_sahibi');
  const [files, setFiles] = useState<File[]>([]);
  const [progress, setProgress] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    try {
      if (!files.length) throw new Error('En az bir sözleşme dosyası seçin.');
      let id = target === 'new' ? 0 : Number(target);
      if (!id) {
        if (!title.trim()) throw new Error('Dosya adı yazın.');
        id = (await api<GroupDetail>('/contract-groups', { body: { title, kind, side } })).id;
      }
      const items: { title: string; body: string }[] = [];
      for (let i = 0; i < files.length; i++) {
        const f = files[i];
        setProgress(`${i + 1}/${files.length} · ${f.name} okunuyor…`);
        const body = await documentText(f, (m) => setProgress(`${i + 1}/${files.length} · ${f.name} · ${m}`));
        items.push({ title: f.name.replace(/\.[^.]+$/, ''), body });
      }
      setProgress('Sözleşmeler inceleniyor…');
      await api(`/contract-groups/${id}/bulk`, { body: { items, kind, side } });
      go({ name: 'contract-group', id });
    } catch (ex) {
      setErr((ex as Error).message);
      setProgress(null);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form className="modal bulk-modal" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h3>
          <Icon name="upload" /> Toplu sözleşme ekle
        </h3>
        <p className="muted small">Her dosya ayrı bir sözleşme olur. Hepsi aynı dosyada toplanır; tek tek riskleri, toplu riski ve ortak sorunları görürsünüz.</p>
        <Field label="Sözleşme dosyası">
          <select value={target} onChange={(e) => setTarget(e.target.value)}>
            <option value="new">Yeni dosya aç</option>
            {groups.data?.map((g) => (
              <option key={g.id} value={g.id}>
                {g.title} ({g.contracts})
              </option>
            ))}
          </select>
        </Field>
        {target === 'new' && (
          <Field label="Dosya adı">
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="ör. Kadıköy Moda projesi – kat malikleri" autoFocus />
          </Field>
        )}
        <div className="form-grid">
          <Field label="Sözleşme türü">
            <select value={kind} onChange={(e) => setKind(e.target.value)}>
              {KIND_OPTIONS.map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Biz kimi temsil ediyoruz?">
            <select value={side} onChange={(e) => setSide(e.target.value)}>
              <option value="arsa_sahibi">Arsa sahibi</option>
              <option value="yuklenici">Yüklenici</option>
              <option value="genel">Genel / tarafsız</option>
            </select>
          </Field>
        </div>
        <div className="bulk-files">
          <FilePick label="Dosyaları seç" multiple accept={DOC_ACCEPT} onFile={(f) => setFiles((cur) => [...cur, f])} />
          {files.length > 0 && (
            <ul className="bulk-list">
              {files.map((f, i) => (
                <li key={i}>
                  <Icon name="file" /> {f.name}
                  <button type="button" className="link small" onClick={() => setFiles(files.filter((_, j) => j !== i))}>
                    çıkar
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        {progress && <p className="small">{progress}</p>}
        <ErrorText error={err} />
        <div className="form-actions">
          <button type="button" onClick={onClose}>
            Vazgeç
          </button>
          <button type="submit" className="primary" disabled={Boolean(progress)}>
            {files.length ? `${files.length} sözleşmeyi ekle ve incele` : 'Ekle ve incele'}
          </button>
        </div>
      </form>
    </div>
  );
}

/** Sözleşme dosyası sayfası: toplu risk, sözleşme bazında risk ve ortak sorunlar. */
export function ContractGroupView({ id, go }: { id: number; go: Go }) {
  const g = useAsync(() => api<GroupDetail>(`/contract-groups/${id}`), [id]);
  const [bulk, setBulk] = useState(false);
  const d = g.data;
  if (!d) return <div className="page">{g.error ? <ErrorText error={g.error} /> : <p className="muted">Açılıyor…</p>}</div>;
  const s = d.summary;
  const sorted = [...d.contracts].sort((a, b) => (b.risk?.genel ?? -1) - (a.risk?.genel ?? -1));

  return (
    <div className="page">
      {bulk && <BulkAdd go={go} groupId={id} onClose={() => { setBulk(false); g.reload(); }} />}
      <PageHeader
        back={() => go({ name: 'contracts' })}
        title={d.title}
        subtitle={`Sözleşme dosyası · ${KIND_LABEL[d.kind] ?? 'Karışık'} · ${s.count} sözleşme`}
        actions={
          <button className="primary" onClick={() => setBulk(true)}>
            <Icon name="upload" /> Sözleşme ekle
          </button>
        }
      />
      <RefreshBar entity="group" id={id} onDone={g.reload} />
      <div className="group-top">
        <div className={`group-risk b-${s.band}`}>
          <span className="muted small">Toplu risk</span>
          <strong>{s.reviewed ? s.toplu : '—'}</strong>
          <span>{s.reviewed ? BAND_LABEL[s.band] : 'Metni olan sözleşme yok'}</span>
          <span className="muted small">Ortalama {s.average} · en yüksek {s.max}</span>
        </div>
        <div className="kpi-row group-kpis">
          <div className="kpi">
            <span className="kpi-label">Toplam bedel</span>
            <span className="kpi-value">{formatTL(s.value_kurus)}</span>
          </div>
          <div className={`kpi ${s.bands.yuksek ? 't-kritik' : 't-iyi'}`}>
            <span className="kpi-label">Yüksek riskli</span>
            <span className="kpi-value">{s.bands.yuksek}</span>
            <span className="kpi-hint">
              {s.bands.orta} orta, {s.bands.dusuk} düşük
            </span>
          </div>
          <div className={`kpi ${s.late_obligations ? 't-kritik' : ''}`}>
            <span className="kpi-label">Açık taahhüt</span>
            <span className="kpi-value">{s.open_obligations}</span>
            <span className="kpi-hint">{s.late_obligations} gecikmiş</span>
          </div>
          <div className="kpi">
            <span className="kpi-label">Yürürlükte / feshedilen</span>
            <span className="kpi-value">
              {s.active} / {s.terminated}
            </span>
          </div>
          {s.worst && (
            <button className="kpi t-kritik clickable" onClick={() => go({ name: 'contract', id: s.worst!.id })}>
              <span className="kpi-label">En riskli sözleşme</span>
              <span className="kpi-value small-value">{s.worst.title}</span>
              <span className="kpi-hint">{s.max}/100 · aç</span>
            </button>
          )}
        </div>
      </div>

      <div className="grid-main-side wide-side">
        <Card title="Sözleşmeler ve riskleri" className="flush">
          {sorted.length === 0 ? (
            <Empty icon="contract">Bu dosyada sözleşme yok. "Sözleşme ekle" ile toplu yükleyin.</Empty>
          ) : (
            <ul className="group-list">
              {sorted.map((c) => (
                <li key={c.id} className="clickable" onClick={() => go({ name: 'contract', id: c.id })}>
                  <div className="group-item-head">
                    <strong>{c.title}</strong>
                    <span className="muted small">
                      {STATUS_LABEL[c.status] ?? c.status}
                      {c.relation && ` · ${RELATION_LABEL[c.relation]}`}
                      {c.value_kurus ? ` · ${formatTL(c.value_kurus)}` : ''}
                      {c.late_obligations ? ` · ${c.late_obligations} gecikmiş taahhüt` : ''}
                    </span>
                  </div>
                  {c.risk ? (
                    <div className="group-item-risk">
                      <span className="risk-track">
                        <span className={`b-${c.risk.band}`} style={{ width: `${c.risk.genel}%` }} />
                      </span>
                      <span className={`disc-pill b-${c.risk.band === 'dusuk' ? 'iyi' : c.risk.band === 'orta' ? 'uyari' : 'kritik'}`}>{c.risk.genel}</span>
                      <span className="muted small">
                        {c.against} aleyhte, {c.missing} eksik
                      </span>
                    </div>
                  ) : (
                    <span className="muted small">Metin yok</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="Ortak sorunlar" className="flush">
          <p className="muted small inset-note top">Birden çok sözleşmede tekrar eden maddeler. Bir kez düzeltip hepsine uygulayın.</p>
          {d.common.length === 0 ? (
            <Empty icon="check">Ortak sorun bulunmadı.</Empty>
          ) : (
            <ul className="items common-issues">
              {d.common.map((i) => (
                <li key={i.key}>
                  <span className={`sev s-${i.severity}`}>{i.contracts.length}</span>
                  <span className="item-text">
                    <strong>{i.title}</strong>
                    <span>
                      {i.topic} · {i.verdict === 'eksik' ? 'eksik madde' : i.verdict === 'aleyhte' ? 'aleyhte' : 'mevzuat'} · {i.contracts.map((c) => c.title).join(', ')}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- yaşam döngüsü (sözleşme sayfası)

interface Relations {
  relation: string;
  parent: { id: number; title: string; status: string } | null;
  children: { id: number; title: string; status: string; relation: string; created_at: string }[];
  group: { id: number; title: string } | null;
}

/** Sözleşme sayfasında: fesih, yeni sözleşme (yenileme), ek sözleşme ve bağlı sözleşmeler. */
export function ContractLifecycle({ data, go, onChanged }: { data: ContractDetail & { terminated_at?: string; termination_reason?: string }; go: Go; onChanged: () => void }) {
  const rel = useAsync(() => api<Relations>(`/contracts/${data.id}/relations`), [data.id, data.status]);
  const [mode, setMode] = useState<null | 'fesih' | 'yenile' | 'ek'>(null);
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [reason, setReason] = useState('');
  const [carry, setCarry] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const open = data.obligations.filter((o) => !o.done).length;

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setErr(null);
    try {
      await fn();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Sözleşmenin akıbeti" className="lifecycle">
      {rel.data?.group && (
        <p className="small">
          <Icon name="folder" /> Dosya:{' '}
          <button className="link" onClick={() => go({ name: 'contract-group', id: rel.data!.group!.id })}>
            {rel.data.group.title}
          </button>
        </p>
      )}
      {rel.data?.parent && (
        <p className="small">
          {RELATION_LABEL[rel.data.relation] ?? 'Bağlı'} · asıl sözleşme:{' '}
          <button className="link" onClick={() => go({ name: 'contract', id: rel.data!.parent!.id })}>
            {rel.data.parent.title}
          </button>
        </p>
      )}
      {data.terminated_at ? (
        <p className="warning small">
          {formatDate(data.terminated_at)} tarihinde sona erdi{data.termination_reason ? `: ${data.termination_reason}` : '.'}
        </p>
      ) : (
        <div className="lifecycle-actions">
          <button className={mode === 'fesih' ? 'active' : ''} onClick={() => setMode(mode === 'fesih' ? null : 'fesih')}>
            <Icon name="alert" /> Fesih
          </button>
          <button className={mode === 'yenile' ? 'active' : ''} onClick={() => setMode(mode === 'yenile' ? null : 'yenile')}>
            <Icon name="contract" /> Kapat ve yeni sözleşme
          </button>
          <button className={mode === 'ek' ? 'active' : ''} onClick={() => setMode(mode === 'ek' ? null : 'ek')}>
            <Icon name="plus" /> Ek sözleşme
          </button>
        </div>
      )}
      {mode === 'fesih' && (
        <div className="lifecycle-form">
          <p className="small">
            Sözleşme "Sona erdi" olur ve {open} açık taahhüt kapatılır. Fesih bildirimi (ihtarname) taslağı hazırlanır.
          </p>
          <div className="form-grid">
            <Field label="Fesih tarihi">
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </Field>
            <Field label="Fesih sebebi">
              <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="ör. Yüklenici teslim süresini 9 ay aştı" />
            </Field>
          </div>
          <button
            className="danger"
            disabled={busy}
            onClick={() =>
              run(async () => {
                const r = await api<{ notice: string }>(`/contracts/${data.id}/terminate`, { body: { date, reason } });
                setNotice(r.notice);
                setMode(null);
                onChanged();
              })
            }
          >
            Sözleşmeyi feshet
          </button>
        </div>
      )}
      {mode === 'yenile' && (
        <div className="lifecycle-form">
          <p className="small">Bu sözleşme kapatılır ve aynı taraflarla yeni bir sözleşme açılır. Eski metin yeni sözleşmeye taşınır, orada düzenlersiniz.</p>
          <label className="check-line">
            <input type="checkbox" checked={carry} onChange={(e) => setCarry(e.target.checked)} /> Açık {open} taahhüdü yeni sözleşmeye taşı
          </label>
          <button
            className="primary"
            disabled={busy}
            onClick={() =>
              run(async () => {
                const r = await api<{ contract: ContractDetail }>(`/contracts/${data.id}/renew`, { body: { carryObligations: carry } });
                go({ name: 'contract', id: r.contract.id });
              })
            }
          >
            Kapat ve yeni sözleşme aç
          </button>
        </div>
      )}
      {mode === 'ek' && (
        <div className="lifecycle-form">
          <p className="small">Asıl sözleşmeye bağlı bir ek sözleşme (ek protokol) taslağı açılır; değişen maddeleri yazarsınız.</p>
          <button
            className="primary"
            disabled={busy}
            onClick={() =>
              run(async () => {
                const c = await api<ContractDetail>(`/contracts/${data.id}/addendum`, { body: {} });
                go({ name: 'contract', id: c.id });
              })
            }
          >
            Ek sözleşme oluştur
          </button>
        </div>
      )}
      {notice && (
        <div className="lifecycle-notice">
          <Field label="Fesih bildirimi taslağı (kopyalayıp düzenleyin)">
            <textarea rows={12} className="mono" defaultValue={notice} />
          </Field>
          <button onClick={() => navigator.clipboard?.writeText(notice)}>Kopyala</button>
        </div>
      )}
      {rel.data && rel.data.children.length > 0 && (
        <>
          <h3 className="small-head">Bağlı sözleşmeler</h3>
          <ul className="items compact">
            {rel.data.children.map((c) => (
              <li key={c.id} className="clickable" onClick={() => go({ name: 'contract', id: c.id })}>
                <span className="item-text">
                  <strong>{c.title}</strong>
                  <span>
                    {RELATION_LABEL[c.relation] ?? ''} · {STATUS_LABEL[c.status] ?? c.status} · {formatDate(c.created_at)}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
      <ErrorText error={err} />
    </Card>
  );
}
