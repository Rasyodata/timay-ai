import { useEffect, useState } from 'react';
import { api, type CaseSummary, type PowerOfAttorney } from './api';
import { InsightsPanel } from './Insights';
import type { Go } from './App';
import { FilePick } from './Clm';
import { mimeOf, readDocument, toBase64 } from './docread';
import { Card, Empty, ErrorText, Field, formatDate, Icon, PageHeader, today, useAsync } from './ui';

/*
 * Vekâletname yönetimi: noter, yevmiye, tarih ve özel yetkiler; taranmış hâli; bağlı dava
 * dosyaları; azil, istifa ve süre takibi.
 */

const STATUS: Record<PowerOfAttorney['status'], { label: string; cls: string }> = {
  gecerli: { label: 'Geçerli', cls: 'onayli' },
  azil: { label: 'Azledildi', cls: 'duzeltme' },
  istifa: { label: 'İstifa edildi', cls: 'duzeltme' },
  sona_erdi: { label: 'Sona erdi', cls: 'closed' },
};

type PowersList = { powers: { key: string; label: string }[]; items: PowerOfAttorney[] };

function warning(p: PowerOfAttorney) {
  if (p.status !== 'gecerli') return p.cases.some((c) => c.status === 'acik') ? 'Açık dosyaya bağlı' : '';
  if (!p.expiry_date) return '';
  if (p.expiry_date < today()) return 'Süresi doldu';
  const days = Math.round((Date.parse(p.expiry_date) - Date.parse(today())) / 86_400_000);
  return days <= 30 ? `${days} gün sonra sona eriyor` : '';
}

export function PowersView({ go, initialId }: { go: Go; initialId?: number }) {
  const [q, setQ] = useState('');
  const list = useAsync(() => api<PowersList>(`/powers?${new URLSearchParams({ q })}`), [q]);
  const [selected, setSelected] = useState<number | 'new' | null>(initialId ?? null);

  return (
    <div className="page">
      <PageHeader
        title="Vekâletnameler"
        subtitle="Noter, yevmiye ve özel yetkiler; bağlı dosyalar; azil, istifa ve süre takibi"
        actions={
          <button className="primary" onClick={() => setSelected('new')}>
            <Icon name="plus" /> Yeni vekâletname
          </button>
        }
      />
      <InsightsPanel module="powers" />
      <div className="grid-main-side wide-side">
        <Card className="flush">
          <div className="toolbar inset">
            <label className="search">
              <Icon name="search" />
              <input placeholder="Müvekkil, yevmiye no ya da noter ara" value={q} onChange={(e) => setQ(e.target.value)} />
            </label>
          </div>
          <ErrorText error={list.error} />
          {list.data?.items.length === 0 ? (
            <Empty icon="pen">
              Henüz vekâletname yok. “Yeni vekâletname”ye basıp taranmış vekâletnameyi (PDF, TIF, JPG) yükleyin; noter, yevmiye, tarih ve yetkiler otomatik okunur.
            </Empty>
          ) : (
            <ul className="items poa-list">
              {list.data?.items.map((p) => {
                const w = warning(p);
                return (
                  <li key={p.id} className={`clickable ${selected === p.id ? 'selected' : ''}`} onClick={() => setSelected(p.id)}>
                    <span className="item-text">
                      <strong>{p.client}</strong>
                      <span>
                        {[p.kind === 'ozel' ? 'Özel' : 'Genel', p.notary, p.journal_no && `Yevmiye ${p.journal_no}`, p.issue_date && formatDate(p.issue_date)]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                      <span>
                        {p.cases.length ? `${p.cases.length} dosya` : 'Dosyaya bağlı değil'} · {p.powers.length} özel yetki
                      </span>
                    </span>
                    {w && <span className="risk-level yuksek">{w}</span>}
                    <span className={`badge ${STATUS[p.status].cls}`}>{STATUS[p.status].label}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
        {selected === null ? (
          <Card title="Vekâletname">
            <Empty icon="pen">Bir vekâletname seçin ya da yenisini ekleyin.</Empty>
          </Card>
        ) : (
          <PoaEditor
            key={selected}
            id={selected === 'new' ? null : selected}
            powers={list.data?.powers ?? []}
            go={go}
            onSaved={(id) => {
              list.reload();
              setSelected(id);
            }}
            onDeleted={() => {
              list.reload();
              setSelected(null);
            }}
          />
        )}
      </div>
    </div>
  );
}

const blank = {
  client: '',
  kind: 'genel' as 'genel' | 'ozel',
  notary: '',
  journalNo: '',
  issueDate: '',
  expiryDate: '',
  lawyers: '',
  powers: [] as string[],
  note: '',
  caseIds: [] as number[],
  status: 'gecerli' as PowerOfAttorney['status'],
  statusDate: '',
};

function PoaEditor({
  id,
  powers,
  go,
  onSaved,
  onDeleted,
}: {
  id: number | null;
  powers: { key: string; label: string }[];
  go: Go;
  onSaved: (id: number) => void;
  onDeleted: () => void;
}) {
  const cases = useAsync(() => api<CaseSummary[]>('/cases'), []);
  const [form, setForm] = useState(blank);
  const [file, setFile] = useState<{ fileName: string; mimeType: string; fileBase64: string; text: string } | null>(null);
  const [existing, setExisting] = useState<PowerOfAttorney | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    if (id === null) return;
    api<PowerOfAttorney>(`/powers/${id}?file=1`)
      .then((p) => {
        setExisting(p);
        setForm({
          client: p.client,
          kind: p.kind,
          notary: p.notary,
          journalNo: p.journal_no,
          issueDate: p.issue_date,
          expiryDate: p.expiry_date,
          lawyers: p.lawyers,
          powers: p.powers,
          note: p.note,
          caseIds: p.cases.map((c) => c.id),
          status: p.status,
          statusDate: p.status_date,
        });
      })
      .catch((e) => setErr((e as Error).message));
  }, [id]);

  const b64 = file?.fileBase64 ?? existing?.fileBase64 ?? null;
  const mime = file?.mimeType ?? existing?.mime_type ?? '';
  useEffect(() => {
    if (!b64 || !/^image\/(jpeg|png|bmp|gif|webp)$/.test(mime)) return setPreview(null);
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [b64, mime]);

  const set = (k: keyof typeof blank) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });

  async function scan(f: File) {
    setBusy(true);
    setErr(null);
    setNote(null);
    try {
      if (f.size > 15 * 1024 * 1024) throw new Error('Dosya 15 MB’tan büyük olamaz.');
      const fileBase64 = toBase64(await f.arrayBuffer());
      let text = '';
      try {
        text = (await readDocument(f)).text ?? '';
      } catch (e) {
        setNote(`Yazı okunamadı (${(e as Error).message}); bilgileri elle girin.`);
      }
      setFile({ fileName: f.name, mimeType: f.type || mimeOf(f.name), fileBase64, text });
      if (text.trim()) {
        const p = await api<{ journalNo: string; notary: string; issueDate: string; powers: string[]; kind: 'genel' | 'ozel'; client: string; lawyers: string }>('/powers/parse', { body: { text } });
        setForm((cur) => ({
          ...cur,
          journalNo: cur.journalNo || p.journalNo,
          notary: cur.notary || p.notary,
          issueDate: cur.issueDate || p.issueDate,
          kind: p.kind,
          client: cur.client || p.client,
          lawyers: cur.lawyers || p.lawyers,
          powers: [...new Set([...cur.powers, ...p.powers])],
        }));
        const found = [p.client && 'müvekkil', p.lawyers && 'vekil', p.notary && 'noter', p.journalNo && 'yevmiye', p.issueDate && 'tarih', p.powers.length && `${p.powers.length} özel yetki`].filter(Boolean);
        setNote(found.length ? `Belgeden okundu: ${found.join(', ')}. Lütfen kontrol edin.` : 'Belgeden bilgi çıkarılamadı; elle girin.');
      }
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    setBusy(true);
    setErr(null);
    try {
      const body = { ...form, ...(file ?? {}) };
      const saved = id === null ? await api<PowerOfAttorney>('/powers', { body }) : await api<PowerOfAttorney>(`/powers/${id}`, { method: 'PUT', body });
      onSaved(saved.id);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function download() {
    if (!b64) return;
    const a = document.createElement('a');
    a.href = `data:${mime};base64,${b64}`;
    a.download = file?.fileName ?? existing?.file_name ?? 'vekaletname';
    a.click();
  }

  const openCases = (cases.data ?? []).filter((c) => c.status === 'acik' || form.caseIds.includes(c.id));

  return (
    <Card title={id === null ? 'Yeni vekâletname' : form.client || 'Vekâletname'} className="poa-editor">
      <div className="upload-drop">
        <FilePick label={b64 ? 'Taramayı değiştir' : 'Taranmış vekâletnameyi yükle'} busy={busy} onFile={scan} />
        <span className="muted small">PDF, TIF, JPG, PNG, BMP ya da UYAP. Noter, yevmiye, tarih ve yetkiler okunur.</span>
      </div>
      {note && <p className="warning small">{note}</p>}
      {preview && <img className="doc-preview" src={preview} alt="Vekâletname" />}
      {b64 && !preview && (
        <p className="small">
          <Icon name="file" /> {file?.fileName ?? existing?.file_name}{' '}
          <button className="link" onClick={download}>
            İndir
          </button>
        </p>
      )}
      <div className="form-grid">
        <Field label="Müvekkil" wide>
          <input value={form.client} onChange={set('client')} placeholder="ör. Ayşe Yılmaz / Deniz İnşaat Ltd. Şti." />
        </Field>
        <Field label="Tür">
          <select value={form.kind} onChange={set('kind')}>
            <option value="genel">Genel dava vekâletnamesi</option>
            <option value="ozel">Özel vekâletname</option>
          </select>
        </Field>
        <Field label="Noter">
          <input value={form.notary} onChange={set('notary')} placeholder="ör. İstanbul 12. Noterliği" />
        </Field>
        <Field label="Yevmiye no">
          <input value={form.journalNo} onChange={set('journalNo')} />
        </Field>
        <Field label="Düzenleme tarihi">
          <input type="date" value={form.issueDate} onChange={set('issueDate')} />
        </Field>
        <Field label="Geçerlilik sonu (varsa)">
          <input type="date" value={form.expiryDate} onChange={set('expiryDate')} />
        </Field>
        <Field label="Vekil avukatlar">
          <input value={form.lawyers} onChange={set('lawyers')} placeholder="ör. Av. Mehmet Kaya, Av. Zeynep Ak" />
        </Field>
      </div>
      <div className="poa-section">
        <span className="field-label">Özel yetkiler (HMK m.74)</span>
        <div className="check-grid">
          {powers.map((p) => (
            <label key={p.key} className="check-line">
              <input
                type="checkbox"
                checked={form.powers.includes(p.key)}
                onChange={(e) => setForm({ ...form, powers: e.target.checked ? [...form.powers, p.key] : form.powers.filter((k) => k !== p.key) })}
              />
              {p.label}
            </label>
          ))}
        </div>
        {!form.powers.includes('ahzu_kabz') && <p className="muted small">Ahzu kabz yetkisi yoksa tahsil edilen para avukat adına alınamaz.</p>}
      </div>
      <div className="poa-section">
        <span className="field-label">Bağlı dava dosyaları</span>
        {openCases.length === 0 ? (
          <p className="muted small">Açık dava dosyası yok.</p>
        ) : (
          <div className="check-grid">
            {openCases.map((c) => (
              <label key={c.id} className="check-line">
                <input
                  type="checkbox"
                  checked={form.caseIds.includes(c.id)}
                  onChange={(e) => setForm({ ...form, caseIds: e.target.checked ? [...form.caseIds, c.id] : form.caseIds.filter((x) => x !== c.id) })}
                />
                {c.title}
                {form.caseIds.includes(c.id) && (
                  <button className="link small" type="button" onClick={() => go({ name: 'case', id: c.id })}>
                    aç
                  </button>
                )}
              </label>
            ))}
          </div>
        )}
      </div>
      {id !== null && (
        <div className="form-grid poa-section">
          <Field label="Durum">
            <select
              value={form.status}
              onChange={(e) => setForm({ ...form, status: e.target.value as typeof form.status, statusDate: form.statusDate || new Date().toISOString().slice(0, 10) })}
            >
              {Object.entries(STATUS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v.label}
                </option>
              ))}
            </select>
          </Field>
          {form.status !== 'gecerli' && (
            <Field label={form.status === 'azil' ? 'Azil tarihi' : form.status === 'istifa' ? 'İstifa tarihi' : 'Sona erme tarihi'}>
              <input type="date" value={form.statusDate} onChange={set('statusDate')} />
            </Field>
          )}
          {form.status === 'istifa' && (
            <p className="muted small wide">İstifa eden avukat, istifanın tebliğinden itibaren 15 gün işi takip etmek zorundadır (Av. K. m.41).</p>
          )}
        </div>
      )}
      <Field label="Not">
        <textarea rows={2} value={form.note} onChange={set('note')} />
      </Field>
      {(file?.text || existing?.text) && (
        <details className="poa-text">
          <summary className="small">Belgeden okunan yazı</summary>
          <pre className="small">{file?.text || existing?.text}</pre>
        </details>
      )}
      <ErrorText error={err} />
      <div className="form-actions doc-actions">
        {id !== null && (
          <button
            className="ghost danger"
            disabled={busy}
            onClick={async () => {
              try {
                await api(`/powers/${id}`, { method: 'DELETE' });
                onDeleted();
              } catch (e) {
                setErr((e as Error).message);
              }
            }}
          >
            <Icon name="trash" /> Sil
          </button>
        )}
        <button className="primary" disabled={busy} onClick={save}>
          {busy ? 'Bekleyin…' : 'Kaydet'}
        </button>
      </div>
    </Card>
  );
}

/** Dava dosyasının genel bilgilerinde görünen vekâletname özeti. */
export function CasePowers({ caseId, go }: { caseId: number; go: Go }) {
  const list = useAsync(() => api<PowersList>(`/powers?caseId=${caseId}`), [caseId]);
  const items = list.data?.items ?? [];
  const labels = Object.fromEntries((list.data?.powers ?? []).map((p) => [p.key, p.label]));
  const valid = items.filter((p) => p.status === 'gecerli');
  return (
    <Card
      title="Vekâletname"
      className="case-powers"
      actions={
        <button className="link" onClick={() => go({ name: 'powers' })}>
          Vekâletnameler
        </button>
      }
    >
      {list.data && valid.length === 0 && <p className="warning small">Bu dosyada geçerli vekâletname kaydı yok.</p>}
      <ul className="items">
        {items.map((p) => (
          <li key={p.id} className="clickable" onClick={() => go({ name: 'powers', id: p.id })}>
            <span className="item-text">
              <strong>{p.client}</strong>
              <span>
                {[p.notary, p.journal_no && `Yevmiye ${p.journal_no}`, p.issue_date && formatDate(p.issue_date)].filter(Boolean).join(' · ')}
              </span>
              <span>{p.powers.length ? p.powers.map((k) => labels[k] ?? k).join(', ') : 'Özel yetki yok'}</span>
            </span>
            <span className={`badge ${STATUS[p.status].cls}`}>{STATUS[p.status].label}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
