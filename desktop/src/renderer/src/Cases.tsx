import { useState, type FormEvent } from 'react';
import {
  api,
  type Area,
  type CaseDetail,
  type CaseSummary,
  type FinanceReport,
  type OpposingDetail,
  type OpposingSummary,
  type PetitionDetail,
  type PetitionSummary,
  type Task,
  type Template,
  type User,
} from './api';
import { InsightsPanel } from './Insights';
import { RefreshAllButton, RefreshBar, RowRefresh } from './Refresh';
import type { Go } from './App';
import { TaskList } from './Agenda';
import { CaseDocuments } from './CaseDocs';
import { CasePowers } from './Powers';
import { DOC_KIND_OPTIONS } from './Disciplines';
import { skeleton } from './skeletons';
import { FilePick } from './Clm';
import { documentText } from './docread';
import { Card, DueLabel, Empty, ErrorText, Field, formatDate, formatTL, Icon, PageHeader, StatusBadge, Tabs, today, useAsync } from './ui';

export function useAreas() {
  return useAsync(() => api<Area[]>('/areas'), []).data ?? [];
}

export function areaName(areas: Area[], id: string) {
  return areas.find((a) => a.id === id)?.name ?? '';
}

/** Şablondaki [MAHKEME] ve [ESAS NO] yerlerini dosya bilgileriyle doldurur. */
export function fillTemplate(body: string, c: Pick<CaseDetail, 'court' | 'esas_no'>) {
  let out = body;
  if (c.court) out = out.replaceAll('[MAHKEME]', c.court.toLocaleUpperCase('tr'));
  if (c.esas_no) out = out.replaceAll('[ESAS NO]', c.esas_no);
  return out;
}

export async function createFromTemplate(caseId: number, templateId: string) {
  const [template, c] = await Promise.all([api<Template>(`/templates/${templateId}`), api<CaseDetail>(`/cases/${caseId}`)]);
  return api<PetitionDetail>('/petitions', { body: { caseId, title: template.title, body: fillTemplate(template.body, c) } });
}

export function CasesView({ go }: { go: Go }) {
  const { data, error } = useAsync(() => api<CaseSummary[]>('/cases'), []);
  const areas = useAreas();
  const [q, setQ] = useState('');
  const [area, setArea] = useState('');
  const [status, setStatus] = useState<'acik' | 'kapali' | ''>('acik');
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ title: '', client: '', area: '', court: '', esasNo: '' });
  const [createError, setCreateError] = useState<string | null>(null);

  async function create(e: FormEvent) {
    e.preventDefault();
    try {
      const created = await api<CaseDetail>('/cases', { body: form });
      go({ name: 'case', id: created.id });
    } catch (err) {
      setCreateError((err as Error).message);
    }
  }

  const needle = q.toLocaleLowerCase('tr');
  const rows = (data ?? []).filter(
    (c) =>
      (!area || c.area === area) &&
      (!status || c.status === status) &&
      (!needle || [c.title, c.client, c.court, c.esas_no].join(' ').toLocaleLowerCase('tr').includes(needle)),
  );

  return (
    <div className="page">
      <PageHeader
        title="Dava dosyaları"
        subtitle={`${data?.length ?? 0} dosya`}
        actions={
          <>
            <RefreshAllButton entities={['case']} go={go} />
            <button className="primary" onClick={() => setCreating(!creating)}>
              <Icon name="plus" /> Yeni dosya
            </button>
          </>
        }
      />
      <InsightsPanel module="cases" />
      {creating && (
        <Card title="Yeni dava dosyası">
          <form className="form-grid" onSubmit={create}>
            <Field label="Dosya başlığı" wide>
              <input placeholder="ör. Ali Demir / X A.Ş. işçilik alacağı" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required />
            </Field>
            <Field label="Müvekkil">
              <input value={form.client} onChange={(e) => setForm({ ...form, client: e.target.value })} />
            </Field>
            <Field label="Hukuk alanı">
              <select value={form.area} onChange={(e) => setForm({ ...form, area: e.target.value })}>
                <option value="">Seçin</option>
                {areas.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Mahkeme">
              <input placeholder="ör. İstanbul 5. İş Mahkemesi" value={form.court} onChange={(e) => setForm({ ...form, court: e.target.value })} />
            </Field>
            <Field label="Esas no">
              <input placeholder="2026/123" value={form.esasNo} onChange={(e) => setForm({ ...form, esasNo: e.target.value })} />
            </Field>
            <div className="form-actions">
              <ErrorText error={createError} />
              <button type="button" onClick={() => setCreating(false)}>
                Vazgeç
              </button>
              <button className="primary" type="submit">
                Dosyayı aç
              </button>
            </div>
          </form>
        </Card>
      )}
      <div className="toolbar">
        <div className="search">
          <Icon name="search" />
          <input placeholder="Dosya, müvekkil, mahkeme ya da esas no ara" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <select value={area} onChange={(e) => setArea(e.target.value)}>
          <option value="">Tüm alanlar</option>
          {areas.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value as 'acik' | 'kapali' | '')}>
          <option value="acik">Açık dosyalar</option>
          <option value="kapali">Kapalı dosyalar</option>
          <option value="">Tümü</option>
        </select>
      </div>
      <ErrorText error={error} />
      <Card className="flush">
        {rows.length === 0 ? (
          <Empty icon="folder">{data?.length ? 'Aramaya uyan dosya yok.' : 'Henüz dava dosyası yok. Sağ üstten yeni dosya açın.'}</Empty>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Dosya</th>
                <th>Alan</th>
                <th>Mahkeme / Esas</th>
                <th>Sorumlu</th>
                <th>Sıradaki duruşma</th>
                <th>Dilekçe</th>
                <th className="num">Güncelle</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id} className="clickable" onClick={() => go({ name: 'case', id: c.id })}>
                  <td>
                    <strong>{c.title}</strong>
                    {c.client && <div className="muted small">{c.client}</div>}
                  </td>
                  <td>{c.area && <span className="tag">{areaName(areas, c.area)}</span>}</td>
                  <td>
                    {c.court}
                    {c.esas_no && <div className="muted small">{c.esas_no} E.</div>}
                  </td>
                  <td>{c.responsible_name}</td>
                  <td>{c.next_hearing ? <DueLabel date={c.next_hearing} /> : <span className="muted">—</span>}</td>
                  <td>{c.petition_count}</td>
                  <td className="num">
                    <RowRefresh entity="case" id={c.id} />
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

type CaseTab = 'genel' | 'belgeler' | 'dilekceler' | 'durusmalar' | 'karsi' | 'gorevler' | 'muhasebe';

export function CaseView({ id, user, go, initialTab }: { id: number; user: User; go: Go; initialTab?: string }) {
  const { data, error, setData, reload } = useAsync(() => api<CaseDetail>(`/cases/${id}`), [id]);
  const areas = useAreas();
  const [tab, setTab] = useState<CaseTab>((initialTab as CaseTab) ?? 'genel');

  if (!data) return <ErrorText error={error} />;

  return (
    <div className="page">
      <PageHeader
        back={() => go({ name: 'cases' })}
        title={data.title}
        subtitle={[areaName(areas, data.area), data.court, data.esas_no && `${data.esas_no} E.`, data.client && `Müvekkil: ${data.client}`]
          .filter(Boolean)
          .join(' · ')}
        actions={<span className={`badge ${data.status === 'acik' ? 'open' : 'closed'}`}>{data.status === 'acik' ? 'Açık' : 'Kapalı'}</span>}
      />
      <RefreshBar entity="case" id={data.id} onDone={reload} />
      <Tabs
        value={tab}
        onChange={setTab}
        items={[
          ['genel', 'Genel bilgiler'],
          ['belgeler', 'Belgeler'],
          ['dilekceler', 'Dilekçeler'],
          ['durusmalar', `Duruşmalar (${data.hearings.length})`],
          ['karsi', 'Karşı taraf'],
          ['gorevler', 'Görevler'],
          ...(user.can_finance ? ([['muhasebe', 'Masraf ve ücret']] as [CaseTab, string][]) : []),
        ]}
      />
      {tab === 'genel' && <CaseGeneral data={data} setData={setData} areas={areas} user={user} go={go} />}
      {tab === 'belgeler' && <CaseDocuments caseId={id} go={go} />}
      {tab === 'dilekceler' && <CasePetitions caseId={id} go={go} areas={areas} defaultArea={data.area} />}
      {tab === 'durusmalar' && <CaseHearings data={data} setData={setData} />}
      {tab === 'karsi' && <CaseOpposing caseId={id} go={go} />}
      {tab === 'gorevler' && <CaseTasks caseId={id} user={user} go={go} />}
      {tab === 'muhasebe' && <CaseFinance caseId={id} client={data.client} />}
    </div>
  );
}

function CaseGeneral({
  data,
  setData,
  areas,
  user,
  go,
}: {
  data: CaseDetail;
  setData: (d: CaseDetail) => void;
  areas: Area[];
  user: User;
  go: Go;
}) {
  const team = useAsync(() => api<User[]>('/users'), []).data ?? [];
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const set = (patch: Partial<CaseDetail>) => {
    setSaved(false);
    setData({ ...data, ...patch });
  };

  async function save(e: FormEvent) {
    e.preventDefault();
    try {
      setData(
        await api<CaseDetail>(`/cases/${data.id}`, {
          method: 'PUT',
          body: {
            title: data.title,
            court: data.court,
            esasNo: data.esas_no,
            parties: data.parties,
            facts: data.facts,
            area: data.area,
            client: data.client,
            status: data.status,
          },
        }),
      );
      setSaved(true);
      setErr(null);
    } catch (error) {
      setErr((error as Error).message);
    }
  }

  async function transfer(userId: number) {
    try {
      setData(await api<CaseDetail>(`/cases/${data.id}/responsible`, { method: 'PUT', body: { userId } }));
    } catch (error) {
      setErr((error as Error).message);
    }
  }

  return (
    <div className="grid-main-side">
      <Card title="Dosya bilgileri">
        <form className="form-grid" onSubmit={save}>
          <Field label="Başlık" wide>
            <input value={data.title} onChange={(e) => set({ title: e.target.value })} required />
          </Field>
          <Field label="Müvekkil">
            <input value={data.client} onChange={(e) => set({ client: e.target.value })} />
          </Field>
          <Field label="Hukuk alanı">
            <select value={data.area} onChange={(e) => set({ area: e.target.value })}>
              <option value="">Seçin</option>
              {areas.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Mahkeme">
            <input value={data.court} onChange={(e) => set({ court: e.target.value })} />
          </Field>
          <Field label="Esas no">
            <input value={data.esas_no} onChange={(e) => set({ esas_no: e.target.value })} placeholder="2026/123" />
          </Field>
          <Field label="Taraflar" wide>
            <textarea rows={3} value={data.parties} onChange={(e) => set({ parties: e.target.value })} />
          </Field>
          <Field label="Olaylar (Teyit, dilekçedeki olay iddialarını buna göre denetler)" wide>
            <textarea rows={8} value={data.facts} onChange={(e) => set({ facts: e.target.value })} />
          </Field>
          <Field label="Dosya durumu">
            <select value={data.status} onChange={(e) => set({ status: e.target.value as 'acik' | 'kapali' })}>
              <option value="acik">Açık</option>
              <option value="kapali">Kapalı</option>
            </select>
          </Field>
          <div className="form-actions">
            <ErrorText error={err} />
            {saved && <span className="ok-text">Kaydedildi</span>}
            <button className="primary" type="submit">
              Kaydet
            </button>
          </div>
        </form>
      </Card>
      <div className="stack">
        <Card title="Dosya sorumlusu">
          <p className="lead">{data.responsible_name || 'Atanmamış'}</p>
          {user.role === 'avukat' && (
            <Field label="Dosyayı devret">
              <select value="" onChange={(e) => e.target.value && transfer(Number(e.target.value))}>
                <option value="">Avukat seçin</option>
                {team
                  .filter((u) => u.role === 'avukat' && u.id !== data.responsible_id)
                  .map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
              </select>
            </Field>
          )}
          <p className="muted small">Devredilen avukat dosyanın sorumlusu olur ve dosya onun listesinde görünür.</p>
        </Card>
        <CasePowers caseId={data.id} go={go} />
      </div>
    </div>
  );
}

function CasePetitions({ caseId, go, areas, defaultArea }: { caseId: number; go: Go; areas: Area[]; defaultArea: string }) {
  const petitions = useAsync(() => api<PetitionSummary[]>(`/cases/${caseId}/petitions`), [caseId]);
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState('dava');
  const [area, setArea] = useState(defaultArea);
  const [err, setErr] = useState<string | null>(null);
  const templates = areas.find((a) => a.id === area)?.templates ?? [];

  async function blank(e: FormEvent) {
    e.preventDefault();
    try {
      const label = DOC_KIND_OPTIONS.find((k) => k.id === kind)?.label ?? 'Dilekçe';
      const c = await api<CaseDetail>(`/cases/${caseId}`);
      const p = await api<PetitionDetail>('/petitions', { body: { caseId, title: title.trim() || label, body: skeleton(kind, c) } });
      go({ name: 'petition', id: p.id, review: true });
    } catch (error) {
      setErr((error as Error).message);
    }
  }

  async function fromTemplate(templateId: string) {
    try {
      const p = await createFromTemplate(caseId, templateId);
      go({ name: 'petition', id: p.id, review: true });
    } catch (error) {
      setErr((error as Error).message);
    }
  }

  return (
    <div className="grid-main-side">
      <Card title="Dilekçeler" className="flush">
        {petitions.data?.length === 0 ? (
          <Empty icon="file">Bu dosyada henüz dilekçe yok. Sağdan şablonla ya da boş başlayın.</Empty>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Dilekçe</th>
                <th>Durum</th>
                <th>Yazan</th>
                <th>Tarih</th>
              </tr>
            </thead>
            <tbody>
              {petitions.data?.map((p) => (
                <tr key={p.id} className="clickable" onClick={() => go({ name: 'petition', id: p.id })}>
                  <td>
                    <strong>{p.title}</strong>
                  </td>
                  <td>
                    <StatusBadge status={p.status} />
                  </td>
                  <td>{p.author_name}</td>
                  <td>{formatDate(p.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      <div className="stack">
        <Card title="Şablondan dilekçe">
          <Field label="Hukuk alanı">
            <select value={area} onChange={(e) => setArea(e.target.value)}>
              <option value="">Seçin</option>
              {areas.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </Field>
          <ul className="items compact">
            {templates.map((t) => (
              <li key={t.id} className="clickable" onClick={() => fromTemplate(t.id)}>
                <span className="item-text">
                  <strong>{t.title}</strong>
                  <span>{t.description}</span>
                </span>
                <Icon name="plus" />
              </li>
            ))}
          </ul>
          {!area && <p className="muted small">Alan seçince şablonlar listelenir.</p>}
        </Card>
        <Card title="Yeni belge oluştur">
          <p className="muted small">Türü seçin; iskelet hazırlanır ve 8 disiplinli inceleme ekranı açılır.</p>
          <div className="doc-kind-grid">
            {DOC_KIND_OPTIONS.map((k) => (
              <button key={k.id} type="button" className={kind === k.id ? 'active' : ''} onClick={() => setKind(k.id)}>
                {k.label}
              </button>
            ))}
          </div>
          <form className="row" onSubmit={blank}>
            <input placeholder={DOC_KIND_OPTIONS.find((k) => k.id === kind)?.label ?? 'Başlık'} value={title} onChange={(e) => setTitle(e.target.value)} />
            <button type="submit" className="primary">
              Oluştur
            </button>
          </form>
        </Card>
        <ErrorText error={err ?? petitions.error} />
      </div>
    </div>
  );
}

function CaseHearings({ data, setData }: { data: CaseDetail; setData: (d: CaseDetail) => void }) {
  const [form, setForm] = useState({ date: today(), time: '', place: '', note: '' });
  const [err, setErr] = useState<string | null>(null);

  async function add(e: FormEvent) {
    e.preventDefault();
    try {
      setData(await api<CaseDetail>(`/cases/${data.id}/hearings`, { body: form }));
      setForm({ ...form, note: '' });
      setErr(null);
    } catch (error) {
      setErr((error as Error).message);
    }
  }

  async function remove(hearingId: number) {
    setData(await api<CaseDetail>(`/hearings/${hearingId}`, { method: 'DELETE' }));
  }

  return (
    <div className="grid-main-side">
      <Card title="Duruşmalar">
        {data.hearings.length === 0 ? (
          <Empty icon="calendar">Bu dosyada duruşma kaydı yok.</Empty>
        ) : (
          <ul className="items">
            {data.hearings.map((h) => (
              <li key={h.id}>
                <span className="date-chip">
                  <strong>{formatDate(h.date).slice(0, 5)}</strong>
                  <span>{h.time || '—'}</span>
                </span>
                <span className="item-text">
                  <strong>{formatDate(h.date)}</strong>
                  <span>{[h.place, h.note].filter(Boolean).join(' · ')}</span>
                </span>
                <DueLabel date={h.date} />
                <button className="ghost small" onClick={() => remove(h.id)}>
                  Sil
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card title="Duruşma ekle">
        <form className="form-grid" onSubmit={add}>
          <Field label="Tarih">
            <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} required />
          </Field>
          <Field label="Saat">
            <input type="time" value={form.time} onChange={(e) => setForm({ ...form, time: e.target.value })} />
          </Field>
          <Field label="Salon / yer" wide>
            <input value={form.place} onChange={(e) => setForm({ ...form, place: e.target.value })} />
          </Field>
          <Field label="Not (ör. tanık dinlenecek)" wide>
            <input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
          </Field>
          <div className="form-actions">
            <ErrorText error={err} />
            <button className="primary" type="submit">
              Ekle
            </button>
          </div>
        </form>
      </Card>
    </div>
  );
}

function CaseOpposing({ caseId, go }: { caseId: number; go: Go }) {
  const opposing = useAsync(() => api<OpposingSummary[]>(`/cases/${caseId}/opposing`), [caseId]);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [reading, setReading] = useState(false);

  async function fromFile(file: File) {
    setReading(true);
    setErr(null);
    try {
      const text = await documentText(file);
      if (!text.trim()) throw new Error('Dosyada okunabilir yazı bulunamadı.');
      setBody(text);
      if (!title.trim()) setTitle(file.name.replace(/\.[^.]+$/, ''));
    } catch (error) {
      setErr((error as Error).message);
    } finally {
      setReading(false);
    }
  }

  async function add(e: FormEvent) {
    e.preventDefault();
    try {
      const doc = await api<OpposingDetail>(`/cases/${caseId}/opposing`, { body: { title, body } });
      go({ name: 'opposing', id: doc.id });
    } catch (error) {
      setErr((error as Error).message);
    }
  }

  return (
    <div className="grid-main-side">
      <Card title="Karşı taraf dilekçeleri">
        {opposing.data?.length === 0 ? (
          <Empty icon="file">Karşı tarafın dilekçesini ekleyin; atıfları ve iddiaları teyit edilsin.</Empty>
        ) : (
          <ul className="items">
            {opposing.data?.map((o) => (
              <li key={o.id} className="clickable" onClick={() => go({ name: 'opposing', id: o.id })}>
                <span className="item-text">
                  <strong>{o.title}</strong>
                  <span>{formatDate(o.created_at)}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card title="Dilekçe ekle">
        <form className="form-grid" onSubmit={add}>
          <Field label="Başlık" wide>
            <input placeholder="ör. Davalı cevap dilekçesi" value={title} onChange={(e) => setTitle(e.target.value)} required />
          </Field>
          <Field label="Metin" wide>
            <textarea rows={8} value={body} onChange={(e) => setBody(e.target.value)} required placeholder="Metni yapıştırın ya da dosyadan alın" />
          </Field>
          <div className="form-actions">
            <ErrorText error={err} />
            <FilePick label="Dosyadan al (UYAP, PDF, TIF, resim)" busy={reading} onFile={fromFile} />
            <button className="primary" type="submit" disabled={reading}>
              Ekle ve teyit et
            </button>
          </div>
        </form>
      </Card>
    </div>
  );
}

function CaseTasks({ caseId, user, go }: { caseId: number; user: User; go: Go }) {
  const tasks = useAsync(() => api<Task[]>('/tasks'), [caseId]);
  return (
    <TaskList
      tasks={(tasks.data ?? []).filter((t) => t.case_id === caseId)}
      reload={tasks.reload}
      user={user}
      go={go}
      caseId={caseId}
    />
  );
}

function CaseFinance({ caseId, client }: { caseId: number; client: string }) {
  const report = useAsync(() => api<FinanceReport>(`/finance?caseId=${caseId}`), [caseId]);
  const [form, setForm] = useState({ kind: 'gelir', amount: '', description: '', date: today(), vatRate: '20', withholdingRate: '0' });
  const [err, setErr] = useState<string | null>(null);

  async function add(e: FormEvent) {
    e.preventDefault();
    try {
      await api('/finance', { body: { ...form, caseId, client, vatRate: Number(form.vatRate), withholdingRate: Number(form.withholdingRate) } });
      setForm({ ...form, amount: '', description: '' });
      setErr(null);
      report.reload();
    } catch (error) {
      setErr((error as Error).message);
    }
  }

  const s = report.data?.summary;
  return (
    <div className="grid-main-side">
      <Card title="Dosyanın parası" className="flush">
        {s && (
          <div className="mini-stats">
            <div>
              <span>Alınan ücret</span>
              <strong className="ok">{formatTL(s.income)}</strong>
            </div>
            <div>
              <span>Dosya masrafı</span>
              <strong className="bad">{formatTL(s.costs)}</strong>
            </div>
          </div>
        )}
        {report.data?.entries.length === 0 ? (
          <Empty icon="wallet">Bu dosyaya ücret ya da masraf girilmemiş.</Empty>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Tarih</th>
                <th>Tür</th>
                <th>Açıklama</th>
                <th className="num">Tutar</th>
              </tr>
            </thead>
            <tbody>
              {report.data?.entries.map((e) => (
                <tr key={e.id}>
                  <td>{formatDate(e.date)}</td>
                  <td>
                    <span className={`tag ${e.kind}`}>{e.kind === 'gelir' ? 'Ücret' : e.kind === 'masraf' ? 'Masraf' : 'Gider'}</span>
                  </td>
                  <td>{e.description}</td>
                  <td className="num">{formatTL(e.amount_kurus)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      <Card title="Ücret ya da masraf ekle">
        <form className="form-grid" onSubmit={add}>
          <Field label="Tür">
            <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
              <option value="gelir">Alınan vekâlet ücreti</option>
              <option value="masraf">Dosya masrafı (harç, bilirkişi, tebligat)</option>
            </select>
          </Field>
          <Field label="Tarih">
            <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} required />
          </Field>
          <Field label="Tutar (TL, KDV hariç)">
            <input inputMode="decimal" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} required />
          </Field>
          {form.kind === 'gelir' && (
            <Field label="KDV %">
              <input inputMode="decimal" value={form.vatRate} onChange={(e) => setForm({ ...form, vatRate: e.target.value })} />
            </Field>
          )}
          <Field label="Açıklama" wide>
            <input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="ör. Başvuru harcı" />
          </Field>
          <div className="form-actions">
            <ErrorText error={err} />
            <button className="primary" type="submit">
              Ekle
            </button>
          </div>
        </form>
      </Card>
    </div>
  );
}
