import { useState, type FormEvent } from 'react';
import { api, type ArchiveDecision, type OnlineDecision, type User } from './api';
import { Card, Empty, ErrorText, Field, formatDate, Icon, PageHeader, Stat, Tabs, useAsync } from './ui';

const CHAMBERS = [
  'Hukuk Genel Kurulu',
  'Ceza Genel Kurulu',
  ...Array.from({ length: 12 }, (_, i) => `${i + 1}. Hukuk Dairesi`),
  ...Array.from({ length: 12 }, (_, i) => `${i + 1}. Ceza Dairesi`),
];

function title(d: { chamber: string; court: string; esas_no?: string; karar_no?: string; esasNo?: string; kararNo?: string }) {
  return `${d.court} ${d.chamber} · ${d.esas_no ?? d.esasNo} E. / ${d.karar_no ?? d.kararNo} K.`;
}

export function DecisionsView({ user }: { user: User }) {
  const [tab, setTab] = useState<'arsiv' | 'yargitay' | 'ekle'>('arsiv');
  const stats = useAsync(() => api<{ total: number; chambers: { chamber: string; n: number }[] }>('/archive/stats'), []);
  const [openId, setOpenId] = useState<number | null>(null);

  return (
    <div className="page">
      <PageHeader
        title="Yargıtay kararları"
        subtitle="Büronuzun karar arşivi. Dilekçelerdeki karar atıfları Teyit ile bu arşive göre denetlenir."
      />
      <div className="stats">
        <Stat icon="scale" label="Arşivdeki karar" value={stats.data?.total ?? 0} />
        <Stat icon="book" label="Daire" value={stats.data?.chambers.length ?? 0} tone="violet" />
        <Stat icon="search" label="Yargıtay'da çevrimiçi ara" value="Ara" tone="green" onClick={() => setTab('yargitay')} />
      </div>
      <Tabs
        value={tab}
        onChange={setTab}
        items={[
          ['arsiv', 'Arşivde ara'],
          ['yargitay', "Yargıtay'da ara ve arşive ekle"],
          ...(user.role === 'avukat' ? ([['ekle', 'Elle karar ekle']] as ['ekle', string][]) : []),
        ]}
      />
      <div className="grid-main-side wide-side">
        <div>
          {tab === 'arsiv' && <ArchiveSearch onOpen={setOpenId} />}
          {tab === 'yargitay' && (
            <OnlineSearch
              onImported={(id) => {
                setOpenId(id);
                stats.reload();
              }}
            />
          )}
          {tab === 'ekle' && (
            <ManualAdd
              onAdded={(id) => {
                setOpenId(id);
                stats.reload();
              }}
            />
          )}
        </div>
        <div className="sticky">
          <DecisionPanel id={openId} />
        </div>
      </div>
    </div>
  );
}

function ArchiveSearch({ onOpen }: { onOpen: (id: number) => void }) {
  const [form, setForm] = useState({ q: '', chamber: '', year: '' });
  const [query, setQuery] = useState(form);
  const result = useAsync(
    () => api<{ total: number; items: ArchiveDecision[] }>(`/archive?${new URLSearchParams({ ...query, limit: '50' })}`),
    [query.q, query.chamber, query.year],
  );

  function submit(e: FormEvent) {
    e.preventDefault();
    setQuery(form);
  }

  return (
    <Card className="flush">
      <form className="toolbar inset" onSubmit={submit}>
        <label className="search">
          <Icon name="search" />
          <input placeholder="Kavram (ör. haklı fesih kıdem) ya da 2021/1234" value={form.q} onChange={(e) => setForm({ ...form, q: e.target.value })} />
        </label>
        <select value={form.chamber} onChange={(e) => setForm({ ...form, chamber: e.target.value })}>
          <option value="">Tüm daireler</option>
          {CHAMBERS.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
        <input className="year" placeholder="Yıl" value={form.year} onChange={(e) => setForm({ ...form, year: e.target.value })} maxLength={4} />
        <button className="primary" type="submit">
          Ara
        </button>
      </form>
      <ErrorText error={result.error} />
      {result.data && result.data.items.length === 0 ? (
        <Empty icon="scale">Arşivde sonuç yok. “Yargıtay'da ara” sekmesinden kararı bulup arşive ekleyebilirsiniz.</Empty>
      ) : (
        <>
          {result.data && <p className="muted small inset-note top">{result.data.total} karar</p>}
          <ul className="items decision-list">
            {result.data?.items.map((d) => (
              <li key={d.id} className="clickable" onClick={() => onOpen(d.id)}>
                <span className="item-text">
                  <strong>{title(d)}</strong>
                  <span>
                    {d.decision_date && `${formatDate(d.decision_date)} · `}
                    {d.excerpt}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </Card>
  );
}

function OnlineSearch({ onImported }: { onImported: (id: number) => void }) {
  const [form, setForm] = useState({ q: '', chamber: '', exact: false, exclude: '', yearFrom: '', yearTo: '' });
  const [advanced, setAdvanced] = useState(false);
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<{ total: number; items: OnlineDecision[] } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function search(p = 1) {
    setBusy('search');
    setErr(null);
    try {
      const bedesten = window.timay?.bedesten;
      const input = { ...form, exact: form.exact ? '1' : '', page: String(p) };
      if (bedesten) {
        // Karar veritabanına bu bilgisayardan ulaşılır; sunucu arama gövdesini kurar ve arşivdekileri işaretler.
        const run = async (withDates: boolean) => {
          const data = await api<Record<string, unknown>>('/yargitay/body', { body: { ...input, withDates } });
          return (await bedesten('searchDocuments', data)) as { data?: unknown; metadata?: { FMTE?: string } };
        };
        const dated = Boolean(form.yearFrom || form.yearTo);
        let raw = dated ? await run(true).catch(() => ({}) as { data?: unknown; metadata?: { FMTE?: string } }) : await run(true);
        // Tarih süzgeci kabul edilmezse tarihsiz arar, yıl aralığını sonuçta uygular.
        if (!raw.data && dated) raw = await run(false);
        if (!raw.data) throw new Error(raw.metadata?.FMTE || 'Karar veritabanından geçersiz yanıt alındı.');
        setResult(await api('/yargitay/map', { body: { data: raw.data, filter: { yearFrom: form.yearFrom, yearTo: form.yearTo } } }));
      } else {
        setResult(await api(`/yargitay/search?${new URLSearchParams(input)}`));
      }
      setPage(p);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function importDoc(d: OnlineDecision) {
    setBusy(d.documentId);
    try {
      const body: Record<string, unknown> = { documentId: d.documentId, date: d.date, chamber: d.chamber };
      const bedesten = window.timay?.bedesten;
      if (bedesten) {
        const raw = (await bedesten('getDocumentContent', { documentId: d.documentId })) as { data?: { content?: string; mimeType?: string } };
        if (!raw.data?.content) throw new Error('Karar metni alınamadı.');
        body.content = raw.data.content;
        body.mimeType = raw.data.mimeType;
      }
      const saved = await api<ArchiveDecision>('/yargitay/import', { body });
      setResult((r) => r && { ...r, items: r.items.map((x) => (x.documentId === d.documentId ? { ...x, archiveId: saved.id } : x)) });
      onImported(saved.id);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card className="flush">
      <form
        className="toolbar inset"
        onSubmit={(e) => {
          e.preventDefault();
          search(1);
        }}
      >
        <label className="search">
          <Icon name="search" />
          <input placeholder="Yargıtay kararlarında ara (ör. işe iade geçerli neden)" value={form.q} onChange={(e) => setForm({ ...form, q: e.target.value })} required />
        </label>
        <select value={form.chamber} onChange={(e) => setForm({ ...form, chamber: e.target.value })}>
          <option value="">Tüm daireler</option>
          {CHAMBERS.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
        <button type="button" className={advanced ? 'active' : ''} onClick={() => setAdvanced(!advanced)}>
          <Icon name="filter" /> Filtreler
        </button>
        <button className="primary" type="submit" disabled={busy === 'search'}>
          {busy === 'search' ? 'Aranıyor…' : 'Ara'}
        </button>
        {advanced && (
          <div className="search-filters">
            <label className="check-line">
              <input type="checkbox" checked={form.exact} onChange={(e) => setForm({ ...form, exact: e.target.checked })} />
              Tam ifade olarak ara
            </label>
            <label className="field full">
              <span>Geçmesin (virgülle ayırın)</span>
              <input value={form.exclude} onChange={(e) => setForm({ ...form, exclude: e.target.value })} placeholder="ör. kira, tahliye" />
            </label>
            <label className="field">
              <span>Karar yılı (başlangıç)</span>
              <input type="number" min={1950} max={2100} value={form.yearFrom} onChange={(e) => setForm({ ...form, yearFrom: e.target.value })} placeholder="ör. 2018" />
            </label>
            <label className="field">
              <span>Karar yılı (bitiş)</span>
              <input type="number" min={1950} max={2100} value={form.yearTo} onChange={(e) => setForm({ ...form, yearTo: e.target.value })} placeholder="ör. 2025" />
            </label>
          </div>
        )}
      </form>
      <ErrorText error={err} />
      {!result ? (
        <Empty icon="scale">Adalet Bakanlığı'nın resmî karar veritabanında arayın. Bulduğunuz kararı tek tıkla, tam metniyle arşive ekleyin.</Empty>
      ) : result.items.length === 0 ? (
        <Empty icon="scale">Sonuç bulunamadı.</Empty>
      ) : (
        <>
          <p className="muted small inset-note top">{result.total.toLocaleString('tr-TR')} karar bulundu</p>
          <ul className="items decision-list">
            {result.items.map((d) => (
              <li key={d.documentId}>
                <span className="item-text">
                  <strong>{title(d)}</strong>
                  <span>{d.date && formatDate(d.date)}</span>
                </span>
                {d.archiveId ? (
                  <button className="link" onClick={() => onImported(d.archiveId!)}>
                    Arşivde · aç
                  </button>
                ) : (
                  <button onClick={() => importDoc(d)} disabled={busy !== null}>
                    {busy === d.documentId ? 'Ekleniyor…' : 'Arşive ekle'}
                  </button>
                )}
              </li>
            ))}
          </ul>
          <div className="pager">
            <button disabled={page <= 1 || busy !== null} onClick={() => search(page - 1)}>
              ‹ Önceki
            </button>
            <span className="muted small">Sayfa {page}</span>
            <button disabled={page * 10 >= result.total || busy !== null} onClick={() => search(page + 1)}>
              Sonraki ›
            </button>
          </div>
        </>
      )}
    </Card>
  );
}

function ManualAdd({ onAdded }: { onAdded: (id: number) => void }) {
  const blank = { court: 'Yargıtay', chamber: '', esasNo: '', kararNo: '', decisionDate: '', sourceUrl: '', text: '' };
  const [form, setForm] = useState(blank);
  const [err, setErr] = useState<string | null>(null);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });

  async function add(e: FormEvent) {
    e.preventDefault();
    try {
      const r = await api<{ id: number }>('/decisions', { body: form });
      setForm(blank);
      setErr(null);
      onAdded(r.id);
    } catch (ex) {
      setErr((ex as Error).message);
    }
  }

  return (
    <Card title="Elle karar ekle">
      <p className="muted small">Yalnızca resmî kaynaktan (Yargıtay, UYAP Emsal) doğruladığınız kararları ekleyin.</p>
      <form className="form-grid cols-3" onSubmit={add}>
        <Field label="Mahkeme">
          <input value={form.court} onChange={set('court')} required />
        </Field>
        <Field label="Daire">
          <input value={form.chamber} onChange={set('chamber')} placeholder="9. Hukuk Dairesi" list="chambers" />
          <datalist id="chambers">
            {CHAMBERS.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </Field>
        <Field label="Karar tarihi">
          <input type="date" value={form.decisionDate} onChange={set('decisionDate')} />
        </Field>
        <Field label="Esas no">
          <input value={form.esasNo} onChange={set('esasNo')} placeholder="2021/1234" required />
        </Field>
        <Field label="Karar no">
          <input value={form.kararNo} onChange={set('kararNo')} placeholder="2022/5678" required />
        </Field>
        <Field label="Kaynak bağlantısı">
          <input value={form.sourceUrl} onChange={set('sourceUrl')} placeholder="https://" />
        </Field>
        <Field label="Karar metni" wide>
          <textarea rows={10} value={form.text} onChange={set('text')} />
        </Field>
        <div className="form-actions">
          <ErrorText error={err} />
          <button className="primary" type="submit">
            Arşive ekle
          </button>
        </div>
      </form>
    </Card>
  );
}

function DecisionPanel({ id }: { id: number | null }) {
  const d = useAsync(() => (id ? api<ArchiveDecision>(`/decisions/${id}`) : Promise.resolve(null)), [id]);
  const [copied, setCopied] = useState(false);
  if (!id || !d.data) {
    return (
      <Card title="Karar metni">
        <ErrorText error={d.error} />
        <Empty icon="file">Okumak için bir karar seçin.</Empty>
      </Card>
    );
  }
  const k = d.data;
  const citation = `${k.court} ${k.chamber} ${k.esas_no} E., ${k.karar_no} K.${k.decision_date ? ` ve ${formatDate(k.decision_date)} tarihli` : ''} kararı`;
  return (
    <Card
      title={`${k.chamber || k.court}`}
      actions={
        <button
          onClick={() => {
            navigator.clipboard?.writeText(citation).catch(() => undefined);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
        >
          {copied ? 'Kopyalandı' : 'Atıf olarak kopyala'}
        </button>
      }
    >
      <p className="lead">
        {k.esas_no} E. / {k.karar_no} K. {k.decision_date && `· ${formatDate(k.decision_date)}`}
      </p>
      <p className="muted small">{citation}</p>
      <pre className="preview decision-text">{k.text || 'Metin eklenmemiş.'}</pre>
      {k.source_url && (
        <a href={k.source_url} target="_blank" rel="noreferrer" className="small">
          Resmî kaynakta aç
        </a>
      )}
    </Card>
  );
}
