import { Fragment, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { api } from './api';
import type { Go } from './App';
import { Card, Empty, ErrorText, Field, formatDate, Icon, PageHeader, Stat, Tabs, useAsync } from './ui';

/*
 * Yapay zekâ (Claude): hukuk asistanı sohbeti, dilekçe taslağı, sözleşme okuma, içtihat
 * değerlendirme ve infaz hesabı. Her çıktı taslaktır; son söz avukatındır.
 */

interface Status {
  enabled: boolean;
  model: string;
  modes: { key: string; label: string; hint: string }[];
}
interface ChatSummary {
  id: number;
  mode: string;
  title: string;
  case_title: string | null;
  contract_title: string | null;
  updated_at: string;
  messages: number;
}
interface Chat {
  id: number;
  mode: string;
  title: string;
  case_id: number | null;
  contract_id: number | null;
  case_title: string;
  contract_title: string;
  messages: { id: number; role: 'user' | 'assistant'; content: string; created_at: string }[];
}

let statusCache: Status | null = null;
export function useAiStatus() {
  const [status, setStatus] = useState<Status | null>(statusCache);
  useEffect(() => {
    api<Status>('/ai/status')
      .then((s) => {
        statusCache = s;
        setStatus(s);
      })
      .catch(() => undefined);
  }, []);
  return status;
}

export function AiOff() {
  return (
    <div className="callout warn">
      <Icon name="alert" />
      <div>
        <strong>Yapay zekâ henüz bağlı değil.</strong>
        <div className="small">
          Sunucuya Claude API anahtarı eklenince bu bölüm kendiliğinden çalışır. Anahtar Render’da <code>ANTHROPIC_API_KEY</code> adıyla eklenir.
        </div>
      </div>
    </div>
  );
}

function Thinking({ label = 'Yapay zekâ çalışıyor' }: { label?: string }) {
  return (
    <div className="ai-thinking">
      <span className="ai-dots">
        <i />
        <i />
        <i />
      </span>
      {label}… Uzun dosyalarda bir iki dakika sürebilir.
    </div>
  );
}

/** Claude'un yazdığı basit Markdown'ı (başlık, madde, kalın) okunur hâle getirir. */
export function RichText({ text }: { text: string }) {
  const inline = (s: string) => s.split(/(\*\*[^*]+\*\*)/g).map((p, i) => (p.startsWith('**') && p.endsWith('**') ? <strong key={i}>{p.slice(2, -2)}</strong> : <Fragment key={i}>{p}</Fragment>));
  const out: ReactNode[] = [];
  text.split('\n').forEach((line, i) => {
    const h = line.match(/^#{1,4}\s+(.*)$/);
    if (h) out.push(<h4 key={i}>{inline(h[1])}</h4>);
    else if (/^\s*[-*•]\s+/.test(line)) out.push(<div key={i} className="ai-li">• {inline(line.replace(/^\s*[-*•]\s+/, ''))}</div>);
    else if (/^\s*---+\s*$/.test(line)) out.push(<hr key={i} />);
    else out.push(<div key={i}>{line ? inline(line) : ' '}</div>);
  });
  return <div className="ai-text">{out}</div>;
}

function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      className="ghost small-btn"
      onClick={() => {
        void navigator.clipboard.writeText(text);
        setDone(true);
        setTimeout(() => setDone(false), 1500);
      }}
    >
      {done ? 'Kopyalandı' : 'Kopyala'}
    </button>
  );
}

/* ---------- Ana sayfa ---------- */

type AiTab = 'asistan' | 'infaz' | 'ictihat';

export function AiView({ go, chatId, tab: initialTab }: { go: Go; chatId?: number; tab?: string }) {
  const status = useAiStatus();
  const [tab, setTab] = useState<AiTab>((initialTab as AiTab) ?? 'asistan');
  return (
    <div className="page">
      <PageHeader title="Yapay zekâ" subtitle={status?.enabled ? `Claude (${status.model}) bağlı · çıktılar taslaktır, avukat kontrolü gerekir` : 'Claude ile hukuk asistanı, dilekçe, sözleşme, içtihat ve infaz hesabı'} />
      {status && !status.enabled && <AiOff />}
      <Tabs
        value={tab}
        onChange={setTab}
        items={[
          ['asistan', 'Asistan'],
          ['ictihat', 'İçtihat değerlendir'],
          ['infaz', 'İnfaz hesabı'],
        ]}
      />
      {tab === 'asistan' && <Assistant go={go} initialId={chatId} status={status} />}
      {tab === 'ictihat' && <DecisionTab />}
      {tab === 'infaz' && <InfazTab />}
    </div>
  );
}

function useOptions() {
  const cases = useAsync(() => api<{ id: number; title: string; status: string }[]>('/cases'), []);
  const contracts = useAsync(() => api<{ id: number; title: string }[]>('/contracts'), []);
  return { cases: cases.data ?? [], contracts: contracts.data ?? [] };
}

function Assistant({ go, initialId, status }: { go: Go; initialId?: number; status: Status | null }) {
  const list = useAsync(() => api<ChatSummary[]>('/ai/chats'), []);
  const [active, setActive] = useState<number | null>(initialId ?? null);
  const [creating, setCreating] = useState(false);
  const chats = list.data ?? [];

  useEffect(() => {
    if (active === null && chats.length) setActive(chats[0].id);
    if (list.data && !chats.length) setCreating(true);
  }, [list.data]);

  return (
    <div className="ai-layout">
      <Card
        className="ai-side"
        title="Sohbetler"
        actions={
          <button className="small-btn" onClick={() => setCreating(true)}>
            <Icon name="plus" /> Yeni
          </button>
        }
      >
        {chats.length === 0 && <p className="muted small">Henüz sohbet yok.</p>}
        <ul className="ai-chat-list">
          {chats.map((c) => (
            <li
              key={c.id}
              className={c.id === active && !creating ? 'active' : ''}
              onClick={() => {
                setActive(c.id);
                setCreating(false);
              }}
            >
              <strong>{c.title || 'Yeni sohbet'}</strong>
              <span className="muted small">
                {status?.modes.find((m) => m.key === c.mode)?.label ?? c.mode}
                {c.case_title ? ` · ${c.case_title}` : ''}
                {c.contract_title ? ` · ${c.contract_title}` : ''}
              </span>
            </li>
          ))}
        </ul>
      </Card>
      <div className="ai-main">
        {creating ? (
          <NewChat
            status={status}
            onCreated={(c) => {
              setCreating(false);
              setActive(c.id);
              list.reload();
            }}
            onCancel={chats.length ? () => setCreating(false) : undefined}
          />
        ) : active ? (
          <ChatPane
            key={active}
            id={active}
            go={go}
            enabled={!!status?.enabled}
            onChanged={list.reload}
            onDeleted={() => {
              setActive(null);
              list.reload();
            }}
          />
        ) : (
          <Empty icon="spark">Soldan bir sohbet seçin ya da yeni sohbet başlatın.</Empty>
        )}
      </div>
    </div>
  );
}

function NewChat({ status, onCreated, onCancel }: { status: Status | null; onCreated: (c: Chat) => void; onCancel?: () => void }) {
  const { cases, contracts } = useOptions();
  const [mode, setMode] = useState('genel');
  const [caseId, setCaseId] = useState('');
  const [contractId, setContractId] = useState('');
  const [err, setErr] = useState<string | null>(null);
  async function submit(e: FormEvent) {
    e.preventDefault();
    try {
      onCreated(await api<Chat>('/ai/chats', { body: { mode, caseId: caseId ? Number(caseId) : null, contractId: contractId ? Number(contractId) : null } }));
    } catch (ex) {
      setErr((ex as Error).message);
    }
  }
  return (
    <Card title="Yeni sohbet">
      <div className="ai-modes">
        {(status?.modes ?? []).map((m) => (
          <button key={m.key} type="button" className={`ai-mode ${mode === m.key ? 'active' : ''}`} onClick={() => setMode(m.key)}>
            <strong>{m.label}</strong>
            <span className="small muted">{m.hint}</span>
          </button>
        ))}
      </div>
      <form className="form-grid cols-2" onSubmit={submit}>
        <Field label="Dava dosyası (isteğe bağlı)">
          <select value={caseId} onChange={(e) => setCaseId(e.target.value)}>
            <option value="">Dosya seçilmedi</option>
            {cases.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Sözleşme (isteğe bağlı)">
          <select value={contractId} onChange={(e) => setContractId(e.target.value)}>
            <option value="">Sözleşme seçilmedi</option>
            {contracts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </select>
        </Field>
        <p className="muted small" style={{ gridColumn: '1 / -1' }}>
          Dosya seçerseniz yapay zekâ dosyanın bilgilerini, olaylarını, belgelerini ve son dilekçelerini okuyarak yanıt verir.
        </p>
        <div className="form-actions">
          <button className="primary">Sohbeti başlat</button>
          {onCancel && (
            <button type="button" className="ghost" onClick={onCancel}>
              Vazgeç
            </button>
          )}
        </div>
        <ErrorText error={err} />
      </form>
    </Card>
  );
}

const STARTERS: Record<string, string[]> = {
  genel: ['Bu dosyada en güçlü ve en zayıf yönlerimiz neler?', 'Zamanaşımı ve hak düşürücü süreleri kontrol et.', 'Müvekkile durumu sade bir dille anlatan bir e-posta yaz.'],
  dilekce: ['Bu dosya için dava dilekçesi taslağı yaz.', 'Karşı tarafın cevap dilekçesine karşı cevaba cevap yaz.', 'İstinaf dilekçesinde hangi gerekçeleri ileri sürmeliyiz?'],
  sozlesme: ['Bu sözleşmede müvekkilimiz için en riskli 5 madde hangisi?', 'Eksik olan koruyucu maddeleri yaz.', 'Fesih ve cezai şart maddelerini yeniden yaz.'],
  ictihat: ['Aşağıdaki kararı davamız açısından değerlendir:'],
  infaz: ['5 yıl hapis cezası alan, ilk kez suç işleyen hükümlü ne zaman denetimli serbestliğe çıkar?'],
};

function ChatPane({ id, go, enabled, onChanged, onDeleted }: { id: number; go: Go; enabled: boolean; onChanged: () => void; onDeleted: () => void }) {
  const { data, error, setData } = useAsync(() => api<Chat>(`/ai/chats/${id}`), [id]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [data?.messages.length, busy]);
  if (!data) return <ErrorText error={error} />;

  async function send(content: string) {
    if (!content.trim() || busy) return;
    setBusy(true);
    setErr(null);
    try {
      setData(await api<Chat>(`/ai/chats/${id}/messages`, { body: { content } }));
      setText('');
      onChanged();
    } catch (ex) {
      setErr((ex as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    if (!confirm('Bu sohbet silinsin mi?')) return;
    await api(`/ai/chats/${id}`, { method: 'DELETE' });
    onDeleted();
  }

  return (
    <Card
      title={data.title || 'Yeni sohbet'}
      actions={
        <>
          {data.case_id && (
            <button className="ghost small-btn" onClick={() => go({ name: 'case', id: data.case_id! })}>
              <Icon name="folder" /> {data.case_title}
            </button>
          )}
          {data.contract_id && (
            <button className="ghost small-btn" onClick={() => go({ name: 'contract', id: data.contract_id! })}>
              <Icon name="contract" /> {data.contract_title}
            </button>
          )}
          <button className="ghost small-btn" onClick={remove} title="Sohbeti sil">
            <Icon name="trash" />
          </button>
        </>
      }
    >
      <div className="ai-messages">
        {data.messages.length === 0 && (
          <div className="ai-starters">
            <p className="muted small">Örnek sorular:</p>
            {(STARTERS[data.mode] ?? STARTERS.genel).map((s) => (
              <button key={s} className="ghost small-btn" onClick={() => setText(s)}>
                {s}
              </button>
            ))}
          </div>
        )}
        {data.messages.map((m) => (
          <div key={m.id} className={`ai-msg ${m.role}`}>
            {m.role === 'assistant' ? <RichText text={m.content} /> : <div className="ai-text">{m.content}</div>}
            {m.role === 'assistant' && (
              <div className="ai-msg-actions">
                <CopyButton text={m.content} />
              </div>
            )}
          </div>
        ))}
        {busy && <Thinking label="Yazıyor" />}
        <div ref={end} />
      </div>
      <ErrorText error={err} />
      <form
        className="ai-input"
        onSubmit={(e) => {
          e.preventDefault();
          void send(text);
        }}
      >
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={enabled ? 'Sorunuzu yazın. Göndermek için Ctrl+Enter.' : 'Yapay zekâ bağlanınca yazabilirsiniz.'}
          rows={3}
          disabled={!enabled || busy}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              void send(text);
            }
          }}
        />
        <button className="primary" disabled={!enabled || busy || !text.trim()}>
          Gönder
        </button>
      </form>
    </Card>
  );
}

/* ---------- İçtihat değerlendirme ---------- */

interface DecisionResult {
  side: 'lehte' | 'aleyhte' | 'notr';
  principle: string;
  reason: string;
  quote: string;
  use: string;
  verified: boolean;
  title: string;
}
const SIDE: Record<string, { cls: string; label: string }> = {
  lehte: { cls: 'v-lehte', label: 'Lehimize' },
  aleyhte: { cls: 'v-aleyhte', label: 'Aleyhimize' },
  notr: { cls: 'v-mevzuat', label: 'Nötr' },
};

export function DecisionResultView({ r }: { r: DecisionResult }) {
  return (
    <div className="ai-result">
      <div className="finding-head">
        <span className={`verdict-pill ${SIDE[r.side]?.cls}`}>{SIDE[r.side]?.label ?? r.side}</span>
        {r.title && <strong>{r.title}</strong>}
      </div>
      <p>
        <strong>İlke:</strong> {r.principle}
      </p>
      <p>
        <strong>Neden:</strong> {r.reason}
      </p>
      {r.quote && (
        <blockquote className="ai-quote">
          “{r.quote}”
          <div className="small">{r.verified ? <span className="ok-text">✓ Karar metninde aynen geçiyor</span> : <span className="warn-text">⚠ Bu cümle karar metninde aynen bulunamadı, kontrol edin</span>}</div>
        </blockquote>
      )}
      <p>
        <strong>Nasıl kullanılır:</strong> {r.use}
      </p>
    </div>
  );
}

function DecisionTab() {
  const { cases } = useOptions();
  const [caseId, setCaseId] = useState('');
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<DecisionResult | null>(null);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    setResult(null);
    try {
      setResult(await api<DecisionResult>('/ai/classify-decision', { body: { caseId: Number(caseId), title, text } }));
    } catch (ex) {
      setErr((ex as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="grid-2">
      <Card title="Karar davamızın lehine mi, aleyhine mi?">
        <form className="form-grid" onSubmit={submit}>
          <Field label="Dava dosyası">
            <select value={caseId} onChange={(e) => setCaseId(e.target.value)} required>
              <option value="">Seçin</option>
              {cases.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Karar künyesi (isteğe bağlı)">
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Yargıtay 3. HD, E. 2024/123 K. 2024/456" />
          </Field>
          <Field label="Karar metni" wide>
            <textarea value={text} onChange={(e) => setText(e.target.value)} rows={12} required placeholder="Karar metnini buraya yapıştırın." />
          </Field>
          <div className="form-actions">
            <button className="primary" disabled={busy}>
              Değerlendir
            </button>
          </div>
        </form>
        <ErrorText error={err} />
      </Card>
      <Card title="Sonuç">{busy ? <Thinking /> : result ? <DecisionResultView r={result} /> : <p className="muted small">Dosyayı seçip kararı yapıştırın.</p>}</Card>
    </div>
  );
}

/* ---------- İnfaz hesabı ---------- */

interface InfazResult {
  id?: number;
  input?: string;
  created_at?: string;
  category: string;
  ratio_num: number;
  ratio_den: number;
  fixed_days: number;
  ds_days: number;
  ratio_basis: string;
  ds_basis: string;
  steps: string[];
  warnings: string[];
  conditional_days: number;
  kosullu_tarih: string;
  ds_tarih: string;
  ceza_bitis: string;
  total_days: number;
  outside_days: number;
  start_date: string;
}

function InfazResultView({ r }: { r: InfazResult }) {
  return (
    <div className="ai-result">
      <div className="stats">
        <Stat icon="calendar" tone="green" label="Denetimli serbestliğe çıkış" value={formatDate(r.ds_tarih)} />
        <Stat icon="clock" tone="blue" label="Koşullu salıverilme" value={formatDate(r.kosullu_tarih)} />
        {r.ceza_bitis && <Stat icon="check" tone="violet" label="Cezanın bitişi" value={formatDate(r.ceza_bitis)} />}
      </div>
      <p>
        <strong>Suç türü:</strong> {r.category}
      </p>
      <p>
        <strong>Koşullu salıverilme:</strong> {r.fixed_days ? `${r.fixed_days} gün (sabit süre)` : `${r.ratio_num}/${r.ratio_den} oranı, ${r.conditional_days} gün`} · <span className="muted">{r.ratio_basis}</span>
      </p>
      <p>
        <strong>Denetimli serbestlik:</strong> {r.ds_days ? `koşullu salıverilmeden ${r.ds_days} gün önce` : 'uygulanmıyor'} · <span className="muted">{r.ds_basis}</span>
      </p>
      {r.outside_days > 0 && <p className="small muted">Cezaevi dışında geçen {r.outside_days} gün tarihlere eklendi.</p>}
      {r.steps.length > 0 && (
        <>
          <h4>Hesabın adımları</h4>
          <ol className="small">
            {r.steps.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ol>
        </>
      )}
      {r.warnings.length > 0 && (
        <div className="callout warn">
          <Icon name="alert" />
          <ul className="small">
            {r.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </div>
      )}
      <p className="muted small">Tahmini hesaptır. Kesin tarih için UYAP’taki infaz hesap pusulasıyla karşılaştırın; iyi hal, disiplin cezası ve sonradan gelen mahsuplar tarihi değiştirir.</p>
    </div>
  );
}

function InfazTab() {
  const { cases } = useOptions();
  const history = useAsync(() => api<InfazResult[]>('/ai/infaz'), []);
  const [form, setForm] = useState({ crime: '', years: '', months: '', days: '', life: '', offenseDate: '', startDate: '', outsideDays: '', ageAtOffense: '', recidivist: false, details: '', caseId: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<InfazResult | null>(null);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    setResult(null);
    try {
      setResult(
        await api<InfazResult>('/ai/infaz', {
          body: {
            ...form,
            years: Number(form.years) || 0,
            months: Number(form.months) || 0,
            days: Number(form.days) || 0,
            outsideDays: Number(form.outsideDays) || 0,
            ageAtOffense: form.ageAtOffense ? Number(form.ageAtOffense) : undefined,
            caseId: form.caseId ? Number(form.caseId) : null,
          },
        }),
      );
      history.reload();
    } catch (ex) {
      setErr((ex as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="grid-2">
        <Card title="Hükümlü ve ceza bilgileri">
          <form className="form-grid cols-3" onSubmit={submit}>
            <Field label="Suç (kanun maddesiyle)" wide>
              <input value={form.crime} onChange={set('crime')} required placeholder="TCK 142/2 nitelikli hırsızlık" />
            </Field>
            <Field label="Ceza türü">
              <select value={form.life} onChange={set('life')}>
                <option value="">Süreli hapis</option>
                <option value="muebbet">Müebbet hapis</option>
                <option value="agirlastirilmis">Ağırlaştırılmış müebbet</option>
              </select>
            </Field>
            {!form.life && (
              <>
                <Field label="Yıl">
                  <input type="number" min={0} value={form.years} onChange={set('years')} />
                </Field>
                <Field label="Ay">
                  <input type="number" min={0} value={form.months} onChange={set('months')} />
                </Field>
                <Field label="Gün">
                  <input type="number" min={0} value={form.days} onChange={set('days')} />
                </Field>
              </>
            )}
            <Field label="Suç tarihi">
              <input type="date" value={form.offenseDate} onChange={set('offenseDate')} />
            </Field>
            <Field label="Cezaevine giriş (ilk gözaltı/tutuklama)">
              <input type="date" value={form.startDate} onChange={set('startDate')} required />
            </Field>
            <Field label="Arada dışarıda geçen gün">
              <input type="number" min={0} value={form.outsideDays} onChange={set('outsideDays')} placeholder="0" />
            </Field>
            <Field label="Suç tarihindeki yaşı">
              <input type="number" min={12} value={form.ageAtOffense} onChange={set('ageAtOffense')} />
            </Field>
            <Field label="Dava dosyası (isteğe bağlı)">
              <select value={form.caseId} onChange={set('caseId')}>
                <option value="">Seçilmedi</option>
                {cases.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title}
                  </option>
                ))}
              </select>
            </Field>
            <label className="inline-field">
              <input type="checkbox" checked={form.recidivist} onChange={(e) => setForm({ ...form, recidivist: e.target.checked })} /> Tekerrür var
            </label>
            <Field label="Ek bilgi (örgüt, terör, cinsel suç, birden çok ceza, kadına şiddet vb.)" wide>
              <textarea rows={3} value={form.details} onChange={set('details')} />
            </Field>
            <div className="form-actions">
              <button className="primary" disabled={busy}>
                Hesapla
              </button>
            </div>
          </form>
          <ErrorText error={err} />
        </Card>
        <Card title="Sonuç">{busy ? <Thinking label="Hesaplıyor" /> : result ? <InfazResultView r={result} /> : <p className="muted small">Bilgileri girip “Hesapla”ya basın. Oranı yapay zekâ mevzuata göre belirler, tarihleri program hesaplar.</p>}</Card>
      </div>
      {(history.data ?? []).length > 0 && (
        <Card title="Son hesaplar">
          <table className="table">
            <thead>
              <tr>
                <th>Tarih</th>
                <th>Bilgiler</th>
                <th>Denetimli serbestlik</th>
                <th>Koşullu salıverilme</th>
              </tr>
            </thead>
            <tbody>
              {history.data!.map((h) => (
                <tr key={h.id} className="clickable" onClick={() => setResult(h)}>
                  <td>{formatDate(h.created_at)}</td>
                  <td className="small">{(h.input ?? '').split('\n').slice(0, 2).join(' · ')}</td>
                  <td>{formatDate(h.ds_tarih)}</td>
                  <td>{formatDate(h.kosullu_tarih)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </>
  );
}

/* ---------- Dava dosyasında: dilekçe taslağı ve sohbet ---------- */

const PETITION_KINDS = ['Dava dilekçesi', 'Cevap dilekçesi', 'Cevaba cevap dilekçesi', 'İkinci cevap dilekçesi', 'Beyan dilekçesi', 'Bilirkişi raporuna itiraz', 'İstinaf dilekçesi', 'Temyiz dilekçesi', 'İhtiyati tedbir talebi', 'İhtarname'];

export function CaseAiTab({ caseId, go }: { caseId: number; go: Go }) {
  const status = useAiStatus();
  const [kind, setKind] = useState(PETITION_KINDS[0]);
  const [instructions, setInstructions] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<{ petition: { id: number; title: string }; notes: string } | null>(null);
  async function draft(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      setDone(await api('/ai/petition-draft', { body: { caseId, kind, instructions } }));
    } catch (ex) {
      setErr((ex as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function ask() {
    try {
      const c = await api<Chat>('/ai/chats', { body: { mode: 'genel', caseId } });
      go({ name: 'ai', chatId: c.id });
    } catch (ex) {
      setErr((ex as Error).message);
    }
  }
  return (
    <>
      {status && !status.enabled && <AiOff />}
      <div className="grid-2">
        <Card title="Yapay zekâ ile dilekçe taslağı">
          <p className="muted small">Dosyanın bilgileri, olayları, belgeleri ve önceki dilekçeleri okunur; taslak “Dilekçeler” sekmesine eklenir ve büronun onay akışından geçer.</p>
          <form className="form-grid" onSubmit={draft}>
            <Field label="Ne yazılsın?">
              <select value={kind} onChange={(e) => setKind(e.target.value)}>
                {PETITION_KINDS.map((k) => (
                  <option key={k}>{k}</option>
                ))}
              </select>
            </Field>
            <Field label="Talimatınız (isteğe bağlı)" wide>
              <textarea rows={4} value={instructions} onChange={(e) => setInstructions(e.target.value)} placeholder="Ör. Fazlaya ilişkin haklar saklı tutulsun, belirsiz alacak davası olarak açılsın, ihtiyati haciz de istensin." />
            </Field>
            <div className="form-actions">
              <button className="primary" disabled={busy || !status?.enabled}>
                Taslağı yaz
              </button>
            </div>
          </form>
          {busy && <Thinking label="Dilekçe yazılıyor" />}
          <ErrorText error={err} />
          {done && (
            <div className="ai-result">
              <p>
                <strong>“{done.petition.title}”</strong> taslak olarak eklendi.
              </p>
              {done.notes && (
                <>
                  <h4>Kontrol etmeniz gerekenler</h4>
                  <RichText text={done.notes} />
                </>
              )}
              <button className="primary" onClick={() => go({ name: 'petition', id: done.petition.id })}>
                Dilekçeyi aç
              </button>
            </div>
          )}
        </Card>
        <Card title="Bu dosya hakkında sor">
          <p className="muted small">Strateji, zamanaşımı, delil, karşı tarafın iddiaları, müvekkile yazılacak e-posta… Yapay zekâ dosyanın tamamını okuyarak yanıtlar.</p>
          <button className="primary" onClick={ask} disabled={!status?.enabled}>
            <Icon name="spark" /> Sohbet başlat
          </button>
        </Card>
      </div>
    </>
  );
}

/* ---------- Sözleşmede: anlamsal okuma ---------- */

interface ContractAi {
  summary: string;
  findings: { title: string; verdict: 'lehte' | 'aleyhte' | 'eksik' | 'notr'; severity: 'yuksek' | 'orta' | 'dusuk'; quote: string; note: string; basis: string; suggestion: string; verified?: boolean }[];
  model: string;
  created_at: string;
}
const VERDICT: Record<string, { cls: string; label: string }> = {
  lehte: { cls: 'v-lehte', label: 'Lehte' },
  aleyhte: { cls: 'v-aleyhte', label: 'Aleyhte' },
  eksik: { cls: 'v-eksik', label: 'Eksik' },
  notr: { cls: 'v-mevzuat', label: 'Nötr' },
};
const SEV_ORDER = { yuksek: 0, orta: 1, dusuk: 2 };

export function ContractAiTab({ id }: { id: number }) {
  const status = useAiStatus();
  const last = useAsync(() => api<ContractAi | null>(`/ai/contracts/${id}/review`), [id]);
  const [side, setSide] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const r = last.data;
  async function run() {
    setBusy(true);
    setErr(null);
    try {
      last.setData(await api<ContractAi>(`/ai/contracts/${id}/review`, { body: { side } }));
    } catch (ex) {
      setErr((ex as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const findings = [...(r?.findings ?? [])].sort((a, b) => (a.verdict === 'lehte' ? 1 : 0) - (b.verdict === 'lehte' ? 1 : 0) || SEV_ORDER[a.severity] - SEV_ORDER[b.severity]);
  return (
    <>
      {status && !status.enabled && <AiOff />}
      <Card
        title="Yapay zekâ ile sözleşme okuma"
        actions={
          <div className="row">
            <input value={side} onChange={(e) => setSide(e.target.value)} placeholder="Bizim taraf (ör. kiracı, arsa sahibi)" />
            <button className="primary" onClick={run} disabled={busy || !status?.enabled}>
              {r ? 'Yeniden oku' : 'Oku'}
            </button>
          </div>
        }
      >
        <p className="muted small">Kural tabanlı incelemeye ek olarak yapay zekâ sözleşmeyi anlamıyla okur: gizli riskleri, eksik korumaları ve önerilen madde metinlerini yazar. Alıntılar sözleşme metninde aranır.</p>
        {busy && <Thinking label="Sözleşme okunuyor" />}
        <ErrorText error={err} />
        {r && !busy && (
          <>
            <div className="ai-result">
              <RichText text={r.summary} />
              <p className="muted small">Son okuma: {formatDate(r.created_at)}</p>
            </div>
            <ul className="finding-list">
              {findings.map((f, i) => (
                <li key={i} className={VERDICT[f.verdict]?.cls}>
                  <div className="finding-head">
                    <span className={`verdict-pill ${VERDICT[f.verdict]?.cls}`}>{VERDICT[f.verdict]?.label}</span>
                    <strong>{f.title}</strong>
                    {f.severity === 'yuksek' && f.verdict !== 'lehte' && <span className="risk-level yuksek">Kritik</span>}
                    {f.basis && <span className="muted small">{f.basis}</span>}
                  </div>
                  {f.quote && (
                    <blockquote className="ai-quote small">
                      “{f.quote}” {f.verified === false && <span className="warn-text">⚠ metinde aynen bulunamadı</span>}
                    </blockquote>
                  )}
                  <p className="small">{f.note}</p>
                  {f.suggestion && (
                    <div className="suggestions">
                      <div className="small muted">Önerilen madde</div>
                      <div className="small">{f.suggestion}</div>
                      <CopyButton text={f.suggestion} />
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}
        {!r && !busy && <p className="muted small">Henüz yapay zekâ okuması yapılmadı.</p>}
      </Card>
    </>
  );
}
