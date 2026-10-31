import { useEffect, useState, type FormEvent } from 'react';
import { api } from './api';
import type { Go } from './App';
import { ExportButtons } from './Export';
import { Card, Empty, ErrorText, Field, formatDate, formatTL, Icon, PageHeader, Stat, Tabs, today, useAsync } from './ui';

/*
 * Arabuluculuk: arabulucu avukatın dosyaları, tarafları ve toplantıları; sıradaki adım, yasal süre,
 * tarifeden ücret hesabı ve profil bilgileriyle doldurulmuş belge taslakları (UDF / Word).
 */

interface Meta {
  kinds: Record<string, { label: string; weeks: number | null; ext: number }>;
  statuses: Record<string, string>;
  docs: Record<string, string>;
  year: number;
}
interface Party {
  id: number;
  side: 'basvurucu' | 'karsi';
  name: string;
  id_no: string;
  address: string;
  phone: string;
  email: string;
  lawyer: string;
}
interface Meeting {
  id: number;
  date: string;
  time: string;
  place: string;
  method: string;
  note: string;
}
interface Fee {
  year: number;
  hourly: number;
  total: number;
  treasury: number;
  byParties: number;
  perSide: number;
  lines: string[];
}
interface Deadline {
  weeks: number;
  ext: number;
  due: string;
  extended: string;
}
interface MFile {
  id: number;
  buro_no: string;
  arb_no: string;
  kind: string;
  kind_label: string;
  mandatory: boolean;
  subject: string;
  claim_kurus: number;
  assigned_date: string;
  adliye: string;
  status: string;
  status_label: string;
  result_kurus: number;
  hours: number;
  result_terms: string;
  note: string;
  parties: Party[];
  meetings: Meeting[];
  deadline: Deadline | null;
  next: { text: string; doc: string };
  fee: Fee;
}
interface Row {
  id: number;
  arb_no: string;
  buro_no: string;
  kind_label: string;
  subject: string;
  status: string;
  status_label: string;
  applicants: string | null;
  respondents: string | null;
  next_meeting: string | null;
  deadline: Deadline | null;
  mediator: string;
}

const CLOSED = ['anlasma', 'kismi', 'anlasmama', 'sonlandi'];
const tl = (k: number) => formatTL(Math.round(k * 100));
const daysLeft = (d: string) => Math.ceil((Date.parse(d) - Date.parse(today())) / 86_400_000);

function useMeta() {
  return useAsync(() => api<Meta>('/mediation/meta'), []);
}

function Profile({ onClose }: { onClose: () => void }) {
  const p = useAsync(() => api<Record<string, string>>('/mediation/profile'), []);
  const [form, setForm] = useState<Record<string, string> | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (p.data) setForm(p.data);
  }, [p.data]);
  if (!form) return <ErrorText error={p.error} />;
  const set = (k: string) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });
  return (
    <Card title="Arabulucu profilim" actions={<button className="ghost" onClick={onClose}>Kapat</button>}>
      <p className="muted small">Davet mektubu, tutanak ve ücret hesabına bu bilgiler yazılır.</p>
      <form
        className="form-grid cols-3"
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            setForm(await api('/mediation/profile', { method: 'PUT', body: form }));
            setMsg('Profil kaydedildi.');
            setErr(null);
          } catch (ex) {
            setErr((ex as Error).message);
          }
        }}
      >
        <Field label="Arabulucu sicil no">
          <input value={form.sicil_no} onChange={set('sicil_no')} />
        </Field>
        <Field label="T.C. kimlik no">
          <input value={form.id_no} onChange={set('id_no')} />
        </Field>
        <Field label="Telefon">
          <input value={form.phone} onChange={set('phone')} />
        </Field>
        <Field label="E-posta">
          <input value={form.email} onChange={set('email')} />
        </Field>
        <Field label="IBAN">
          <input value={form.iban} onChange={set('iban')} />
        </Field>
        <Field label="Büro adresi" wide>
          <input value={form.address} onChange={set('address')} />
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

function FeeCalculator({ meta }: { meta: Meta }) {
  const [form, setForm] = useState({ kind: 'is', parties: '2', status: 'anlasma', result: '', hours: '2', mandatory: true });
  const [fee, setFee] = useState<Fee | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    const t = setTimeout(() => {
      api<Fee>('/mediation/fee', { body: { ...form, parties: Number(form.parties), hours: Number(form.hours.replace(',', '.')) } }).then(
        (f) => {
          setFee(f);
          setErr(null);
        },
        (e) => setErr((e as Error).message),
      );
    }, 250);
    return () => clearTimeout(t);
  }, [form]);
  return (
    <Card title={`Ücret hesapla (${meta.year} tarifesi)`}>
      <div className="form-grid cols-3">
        <Field label="Uyuşmazlık türü">
          <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
            {Object.entries(meta.kinds).map(([k, v]) => (
              <option key={k} value={k}>
                {v.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Sonuç">
          <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
            <option value="anlasma">Anlaşma</option>
            <option value="anlasmama">Anlaşamama</option>
          </select>
        </Field>
        <Field label="Taraf sayısı">
          <input type="number" min={2} value={form.parties} onChange={(e) => setForm({ ...form, parties: e.target.value })} />
        </Field>
        {form.status === 'anlasma' ? (
          <Field label="Anlaşma tutarı (TL)">
            <input value={form.result} onChange={(e) => setForm({ ...form, result: e.target.value })} inputMode="decimal" placeholder="0 ise saat ücreti" />
          </Field>
        ) : (
          <Field label="Görüşme süresi (saat)">
            <input value={form.hours} onChange={(e) => setForm({ ...form, hours: e.target.value })} inputMode="decimal" />
          </Field>
        )}
        <label className="check-line">
          <input type="checkbox" checked={form.mandatory} onChange={(e) => setForm({ ...form, mandatory: e.target.checked })} /> Dava şartı (zorunlu) arabuluculuk
        </label>
      </div>
      <ErrorText error={err} />
      {fee && (
        <div className="fee-result">
          <strong className="fee-total">{tl(fee.total)}</strong>
          {fee.treasury > 0 && <span className="small">Hazineden: {tl(fee.treasury)} · Taraflardan: {tl(fee.byParties)}</span>}
          {fee.treasury === 0 && <span className="small">Her iki tarafa: {tl(fee.perSide)}</span>}
          <ul className="small muted">
            {fee.lines.map((l, i) => (
              <li key={i}>{l}</li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}

export function MediationView({ go }: { go: Go }) {
  const meta = useMeta();
  const list = useAsync(() => api<Row[]>('/mediation'), []);
  const [creating, setCreating] = useState(false);
  const [profile, setProfile] = useState(false);
  const [calc, setCalc] = useState(false);
  const [filter, setFilter] = useState<'acik' | 'tum'>('acik');
  const rows = (list.data ?? []).filter((r) => filter === 'tum' || !CLOSED.includes(r.status));
  const open = (list.data ?? []).filter((r) => !CLOSED.includes(r.status));
  const urgent = open.filter((r) => r.deadline && daysLeft(r.deadline.due) <= 7);
  return (
    <div className="page">
      <PageHeader
        title="Arabuluculuk"
        subtitle="Arabulucu olarak yürüttüğünüz dosyalar, toplantılar, tutanaklar ve ücret hesabı"
        actions={
          <>
            <button onClick={() => setCalc(!calc)}>
              <Icon name="calc" /> Ücret hesapla
            </button>
            <button onClick={() => setProfile(!profile)}>
              <Icon name="users" /> Arabulucu profilim
            </button>
            <button className="primary" onClick={() => setCreating(true)}>
              <Icon name="plus" /> Yeni arabuluculuk dosyası
            </button>
          </>
        }
      />
      <div className="stats">
        <Stat icon="folder" label="Açık dosya" value={open.length} />
        <Stat icon="calendar" label="Yaklaşan toplantı" value={open.filter((r) => r.next_meeting).length} tone="violet" />
        <Stat icon="alert" label="Süresi 7 gün içinde dolan" value={urgent.length} tone={urgent.length ? 'red' : 'green'} />
        <Stat icon="check" label="Anlaşmayla biten" value={(list.data ?? []).filter((r) => r.status === 'anlasma' || r.status === 'kismi').length} tone="green" />
      </div>
      {profile && <Profile onClose={() => setProfile(false)} />}
      {calc && meta.data && <FeeCalculator meta={meta.data} />}
      {creating && meta.data && <NewFile meta={meta.data} onCancel={() => setCreating(false)} onCreated={(id) => go({ name: 'mediation-file', id })} />}
      <ErrorText error={list.error} />
      <Card className="flush">
        <div className="toolbar inset">
          <Tabs
            value={filter}
            onChange={setFilter}
            items={[
              ['acik', 'Devam edenler'],
              ['tum', 'Tümü'],
            ]}
          />
        </div>
        {rows.length === 0 ? (
          <Empty icon="users">Arabuluculuk dosyası yok. Arabulucu sıfatınızla yürüttüğünüz dosyaları buraya ekleyin.</Empty>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Taraflar</th>
                <th>Tür / konu</th>
                <th>Sıradaki toplantı</th>
                <th>Yasal süre</th>
                <th>Durum</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="clickable" onClick={() => go({ name: 'mediation-file', id: r.id })}>
                  <td>
                    <strong>{r.applicants || '—'}</strong>
                    <div className="muted small">karşı: {r.respondents || '—'}</div>
                  </td>
                  <td>
                    {r.kind_label}
                    <div className="muted small">
                      {r.subject}
                      {r.arb_no && ` · ${r.arb_no}`}
                    </div>
                  </td>
                  <td>{r.next_meeting ? formatDate(r.next_meeting) : '—'}</td>
                  <td>
                    {r.deadline ? (
                      <span className={daysLeft(r.deadline.due) <= 3 ? 'error' : daysLeft(r.deadline.due) <= 7 ? 'warn-text' : ''}>
                        {formatDate(r.deadline.due)} ({daysLeft(r.deadline.due)} gün)
                      </span>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td>
                    <span className={`badge m-${r.status}`}>{r.status_label}</span>
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

function NewFile({ meta, onCancel, onCreated }: { meta: Meta; onCancel: () => void; onCreated: (id: number) => void }) {
  const [form, setForm] = useState({ kind: 'is', mandatory: true, subject: '', assignedDate: today(), buroNo: '', arbNo: '', adliye: '', claim: '', applicant: '', respondent: '' });
  const [err, setErr] = useState<string | null>(null);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });
  async function submit(e: FormEvent) {
    e.preventDefault();
    try {
      const f = await api<MFile>('/mediation', { body: form });
      if (form.applicant.trim()) await api(`/mediation/${f.id}/parties`, { body: { side: 'basvurucu', name: form.applicant } });
      if (form.respondent.trim()) await api(`/mediation/${f.id}/parties`, { body: { side: 'karsi', name: form.respondent } });
      onCreated(f.id);
    } catch (ex) {
      setErr((ex as Error).message);
    }
  }
  return (
    <Card title="Yeni arabuluculuk dosyası" actions={<button className="ghost" onClick={onCancel}>Kapat</button>}>
      <form className="form-grid cols-3" onSubmit={submit}>
        <Field label="Başvurucu">
          <input value={form.applicant} onChange={set('applicant')} />
        </Field>
        <Field label="Karşı taraf">
          <input value={form.respondent} onChange={set('respondent')} />
        </Field>
        <Field label="Uyuşmazlık türü">
          <select value={form.kind} onChange={set('kind')}>
            {Object.entries(meta.kinds).map(([k, v]) => (
              <option key={k} value={k}>
                {v.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Konu" wide>
          <input value={form.subject} onChange={set('subject')} placeholder="ör. kıdem ve ihbar tazminatı, fazla mesai" />
        </Field>
        <Field label="Görevlendirme tarihi">
          <input type="date" value={form.assignedDate} onChange={set('assignedDate')} />
        </Field>
        <Field label="Büro no">
          <input value={form.buroNo} onChange={set('buroNo')} placeholder="2026/1234" />
        </Field>
        <Field label="Arabuluculuk no">
          <input value={form.arbNo} onChange={set('arbNo')} />
        </Field>
        <Field label="Adliye">
          <input value={form.adliye} onChange={set('adliye')} placeholder="ör. İstanbul Anadolu" />
        </Field>
        <Field label="Talep tutarı (TL)">
          <input value={form.claim} onChange={set('claim')} inputMode="decimal" />
        </Field>
        <label className="check-line">
          <input type="checkbox" checked={form.mandatory} onChange={(e) => setForm({ ...form, mandatory: e.target.checked })} /> Dava şartı (zorunlu) arabuluculuk
        </label>
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

function DocsTab({ file, initial }: { file: MFile; initial: string }) {
  const meta = useMeta();
  const [type, setType] = useState(initial || 'davet');
  const [doc, setDoc] = useState<{ title: string; body: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    api<{ title: string; body: string }>(`/mediation/${file.id}/document`, { body: { type } }).then(setDoc, (e) => setErr((e as Error).message));
  }, [type, file]);
  return (
    <Card
      title="Belge hazırla"
      actions={
        <>
          <select value={type} onChange={(e) => setType(e.target.value)}>
            {Object.entries(meta.data?.docs ?? {}).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
          {doc && <ExportButtons title={doc.title} body={doc.body} />}
        </>
      }
    >
      <p className="muted small">Taslak, dosyadaki taraf ve toplantı bilgileriyle ve arabulucu profilinizle doldurulur. Metni burada düzenleyip UDF ya da Word olarak indirin.</p>
      <ErrorText error={err} />
      {doc && <textarea className="editor mono med-doc" value={doc.body} onChange={(e) => setDoc({ ...doc, body: e.target.value })} />}
    </Card>
  );
}

export function MediationFileView({ id, go }: { id: number; go: Go }) {
  const meta = useMeta();
  const { data, error, setData } = useAsync(() => api<MFile>(`/mediation/${id}`), [id]);
  const [tab, setTab] = useState('ozet');
  const [docType, setDocType] = useState('');
  const [party, setParty] = useState({ side: 'basvurucu', name: '', id_no: '', address: '', phone: '', email: '', lawyer: '' });
  const [meeting, setMeeting] = useState({ date: today(), time: '10:00', place: '', method: 'yuz_yuze', note: '' });
  const [err, setErr] = useState<string | null>(null);
  if (!data || !meta.data) return <ErrorText error={error ?? meta.error} />;
  const f = data;
  async function call(p: Promise<MFile>, reset?: () => void) {
    setErr(null);
    try {
      setData(await p);
      reset?.();
    } catch (e) {
      setErr((e as Error).message);
    }
  }
  const update = (body: Record<string, unknown>) => call(api<MFile>(`/mediation/${id}`, { method: 'PUT', body }));
  const left = f.deadline && !CLOSED.includes(f.status) ? daysLeft(f.deadline.due) : null;
  return (
    <div className="page">
      <PageHeader
        back={() => go({ name: 'mediation' })}
        title={`${f.parties.filter((p) => p.side === 'basvurucu').map((p) => p.name).join(', ') || 'Başvurucu'} / ${f.parties.filter((p) => p.side === 'karsi').map((p) => p.name).join(', ') || 'Karşı taraf'}`}
        subtitle={[f.kind_label, f.subject, f.arb_no && `Arb. No ${f.arb_no}`, f.buro_no && `Büro No ${f.buro_no}`].filter(Boolean).join(' · ')}
        actions={
          <select className={`status-select m-${f.status}`} value={f.status} onChange={(e) => update({ status: e.target.value })}>
            {Object.entries(meta.data.statuses).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        }
      />
      <div className="next-step">
        <Icon name="alert" />
        <div>
          <strong>Sıradaki adım:</strong> {f.next.text}
          {f.next.doc && (
            <button
              className="link small"
              onClick={() => {
                setDocType(f.next.doc);
                setTab('belge');
              }}
            >
              {meta.data.docs[f.next.doc]} hazırla →
            </button>
          )}
        </div>
      </div>
      <div className="stats">
        <Stat icon="users" label="Taraf" value={f.parties.length} />
        <Stat icon="calendar" label="Toplantı" value={f.meetings.length} tone="violet" />
        <Stat
          icon="clock"
          label={f.deadline ? `Yasal süre${left !== null ? `: ${left} gün kaldı` : ''} (${f.deadline.weeks}+${f.deadline.ext} hafta)` : 'Yasal süre'}
          value={f.deadline ? formatDate(f.deadline.due) : 'Yok'}
          tone={left !== null && left <= 3 ? 'red' : 'amber'}
        />
        <Stat icon="wallet" label="Arabuluculuk ücreti" value={tl(f.fee.total)} tone="green" />
      </div>
      <ErrorText error={err} />
      <Tabs
        value={tab}
        onChange={setTab}
        items={[
          ['ozet', 'Dosya bilgileri'],
          ['taraf', `Taraflar (${f.parties.length})`],
          ['toplanti', `Toplantılar (${f.meetings.length})`],
          ['belge', 'Belgeler'],
          ['ucret', 'Ücret'],
        ]}
      />
      {tab === 'ozet' && <Info file={f} meta={meta.data} onSave={update} />}
      {tab === 'taraf' && (
        <div className="grid-main-side">
          <Card title="Taraflar" className="flush">
            {f.parties.length === 0 ? (
              <Empty icon="users">Taraf eklenmedi.</Empty>
            ) : (
              <table className="table">
                <tbody>
                  {f.parties.map((p) => (
                    <tr key={p.id}>
                      <td>
                        <span className="badge">{p.side === 'basvurucu' ? 'Başvurucu' : 'Karşı taraf'}</span>
                      </td>
                      <td>
                        <strong>{p.name}</strong>
                        <div className="muted small">{[p.id_no, p.phone, p.email, p.address].filter(Boolean).join(' · ')}</div>
                        {p.lawyer && <div className="small">Vekil: {p.lawyer}</div>}
                      </td>
                      <td>
                        <button className="ghost icon-btn" title="Sil" onClick={() => call(api<MFile>(`/mediation-parties/${p.id}`, { method: 'DELETE' }))}>
                          <Icon name="trash" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
          <Card title="Taraf ekle">
            <form
              className="form-grid"
              onSubmit={(e) => {
                e.preventDefault();
                call(api<MFile>(`/mediation/${id}/parties`, { body: party }), () => setParty({ ...party, name: '', id_no: '', address: '', phone: '', email: '', lawyer: '' }));
              }}
            >
              <Field label="Taraf" wide>
                <select value={party.side} onChange={(e) => setParty({ ...party, side: e.target.value })}>
                  <option value="basvurucu">Başvurucu</option>
                  <option value="karsi">Karşı taraf</option>
                </select>
              </Field>
              <Field label="Ad soyad / unvan" wide>
                <input value={party.name} onChange={(e) => setParty({ ...party, name: e.target.value })} required />
              </Field>
              <Field label="T.C. / VKN">
                <input value={party.id_no} onChange={(e) => setParty({ ...party, id_no: e.target.value })} />
              </Field>
              <Field label="Telefon">
                <input value={party.phone} onChange={(e) => setParty({ ...party, phone: e.target.value })} />
              </Field>
              <Field label="E-posta" wide>
                <input value={party.email} onChange={(e) => setParty({ ...party, email: e.target.value })} />
              </Field>
              <Field label="Adres" wide>
                <input value={party.address} onChange={(e) => setParty({ ...party, address: e.target.value })} />
              </Field>
              <Field label="Vekili" wide>
                <input value={party.lawyer} onChange={(e) => setParty({ ...party, lawyer: e.target.value })} placeholder="ör. Av. Ayşe Kaya (İstanbul Barosu)" />
              </Field>
              <div className="form-actions">
                <button className="primary" type="submit">
                  <Icon name="plus" /> Ekle
                </button>
              </div>
            </form>
          </Card>
        </div>
      )}
      {tab === 'toplanti' && (
        <div className="grid-main-side">
          <Card title="Toplantılar" className="flush">
            {f.meetings.length === 0 ? (
              <Empty icon="calendar">Toplantı planlanmadı.</Empty>
            ) : (
              <ul className="timeline">
                {f.meetings.map((m) => (
                  <li key={m.id}>
                    <span className="when">
                      {formatDate(m.date)} {m.time}
                    </span>
                    <span className="item-text">
                      <strong>{m.method === 'telekonferans' ? 'Telekonferans / görüntülü' : m.place || 'Yüz yüze'}</strong>
                      {m.note && <span>{m.note}</span>}
                      <span className="row">
                        <button
                          className="link small"
                          onClick={() => {
                            setDocType('toplanti');
                            setTab('belge');
                          }}
                        >
                          Tutanak hazırla
                        </button>
                        <button className="link small" onClick={() => call(api<MFile>(`/mediation-meetings/${m.id}`, { method: 'DELETE' }))}>
                          Sil
                        </button>
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card title="Toplantı planla">
            <form
              className="form-grid"
              onSubmit={(e) => {
                e.preventDefault();
                call(api<MFile>(`/mediation/${id}/meetings`, { body: meeting }), () => setMeeting({ ...meeting, note: '' }));
              }}
            >
              <Field label="Tarih">
                <input type="date" value={meeting.date} onChange={(e) => setMeeting({ ...meeting, date: e.target.value })} required />
              </Field>
              <Field label="Saat">
                <input type="time" value={meeting.time} onChange={(e) => setMeeting({ ...meeting, time: e.target.value })} />
              </Field>
              <Field label="Yöntem" wide>
                <select value={meeting.method} onChange={(e) => setMeeting({ ...meeting, method: e.target.value })}>
                  <option value="yuz_yuze">Yüz yüze</option>
                  <option value="telekonferans">Telekonferans / görüntülü</option>
                </select>
              </Field>
              {meeting.method === 'yuz_yuze' && (
                <Field label="Yer" wide>
                  <input value={meeting.place} onChange={(e) => setMeeting({ ...meeting, place: e.target.value })} placeholder="ör. arabuluculuk bürosu adresi" />
                </Field>
              )}
              <Field label="Not" wide>
                <input value={meeting.note} onChange={(e) => setMeeting({ ...meeting, note: e.target.value })} />
              </Field>
              <div className="form-actions">
                <button className="primary" type="submit">
                  <Icon name="plus" /> Ekle
                </button>
              </div>
            </form>
          </Card>
        </div>
      )}
      {tab === 'belge' && <DocsTab file={f} initial={docType} />}
      {tab === 'ucret' && (
        <Card title={`Ücret hesabı (${f.fee.year} tarifesi)`}>
          <div className="fee-result">
            <strong className="fee-total">{tl(f.fee.total)}</strong>
            <span className="small">
              {f.fee.treasury > 0 ? `Hazineden ${tl(f.fee.treasury)} · ` : ''}Taraflardan {tl(f.fee.byParties)} (taraf başına {tl(f.fee.perSide)})
            </span>
            <ul className="small muted">
              {f.fee.lines.map((l, i) => (
                <li key={i}>{l}</li>
              ))}
            </ul>
          </div>
          <p className="muted small">Hesap, dosyanın durumu, anlaşma tutarı, taraf sayısı ve görüşme süresine göre yapılır; bunları "Dosya bilgileri" sekmesinden değiştirin. Tarife tutarları asgaridir.</p>
          <button
            onClick={() => {
              setDocType('ucret');
              setTab('belge');
            }}
          >
            <Icon name="file" /> Ücret hesabını belge olarak al
          </button>
        </Card>
      )}
    </div>
  );
}

function Info({ file, meta, onSave }: { file: MFile; meta: Meta; onSave: (b: Record<string, unknown>) => void }) {
  const money = (k: number) => (k ? (k / 100).toLocaleString('tr-TR', { minimumFractionDigits: 2 }) : '');
  const [form, setForm] = useState({
    kind: file.kind,
    mandatory: file.mandatory,
    subject: file.subject,
    assignedDate: file.assigned_date,
    buroNo: file.buro_no,
    arbNo: file.arb_no,
    adliye: file.adliye,
    claim: money(file.claim_kurus),
    result: money(file.result_kurus),
    hours: String(file.hours),
    resultTerms: file.result_terms,
    note: file.note,
  });
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });
  return (
    <Card title="Dosya bilgileri ve sonuç">
      <form
        className="form-grid cols-3"
        onSubmit={(e) => {
          e.preventDefault();
          onSave({ ...form, hours: Number(form.hours.replace(',', '.')) || 2 });
        }}
      >
        <Field label="Uyuşmazlık türü">
          <select value={form.kind} onChange={set('kind')}>
            {Object.entries(meta.kinds).map(([k, v]) => (
              <option key={k} value={k}>
                {v.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Konu" wide>
          <input value={form.subject} onChange={set('subject')} />
        </Field>
        <Field label="Görevlendirme tarihi">
          <input type="date" value={form.assignedDate} onChange={set('assignedDate')} />
        </Field>
        <Field label="Büro no">
          <input value={form.buroNo} onChange={set('buroNo')} />
        </Field>
        <Field label="Arabuluculuk no">
          <input value={form.arbNo} onChange={set('arbNo')} />
        </Field>
        <Field label="Adliye">
          <input value={form.adliye} onChange={set('adliye')} />
        </Field>
        <Field label="Talep tutarı (TL)">
          <input value={form.claim} onChange={set('claim')} inputMode="decimal" />
        </Field>
        <Field label="Anlaşma tutarı (TL)">
          <input value={form.result} onChange={set('result')} inputMode="decimal" />
        </Field>
        <Field label="Görüşme süresi (saat)">
          <input value={form.hours} onChange={set('hours')} inputMode="decimal" />
        </Field>
        <label className="check-line">
          <input type="checkbox" checked={form.mandatory} onChange={(e) => setForm({ ...form, mandatory: e.target.checked })} /> Dava şartı (zorunlu) arabuluculuk
        </label>
        <Field label="Anlaşma maddeleri (anlaşma belgesine yazılır)" wide>
          <textarea rows={5} value={form.resultTerms} onChange={set('resultTerms')} placeholder={'1. Karşı taraf başvurucuya … TL ödeyecektir.\n2. Ödeme … tarihine kadar yapılacaktır.'} />
        </Field>
        <Field label="Not" wide>
          <input value={form.note} onChange={set('note')} />
        </Field>
        <div className="form-actions">
          <button className="primary" type="submit">
            Kaydet
          </button>
        </div>
      </form>
    </Card>
  );
}
