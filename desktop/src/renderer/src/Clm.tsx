import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import {
  api,
  type ArmorFinding,
  type ArmorReview,
  type Clause,
  type ContractAlarm,
  type ContractDetail,
  type ContractVersion,
  type HiddenChange,
  type Playbook,
  type Signing,
  type User,
} from './api';
import { DOC_ACCEPT, documentText, readDocument, READ_PROGRESS } from './docread';
import { Card, Empty, ErrorText, Field, formatDate, Icon, useAsync } from './ui';

// ---------------------------------------------------------------------------
// Dosya okuma: Word ve UYAP belgesi sunucuda, PDF / TIF / resim bu bilgisayarda (OCR) okunur
// ---------------------------------------------------------------------------

/** Sözleşme dosyasını okur; Word dosyası değişiklikleri izle bilgisiyle sunucuya gider. */
export function readContractFile(file: File) {
  return readDocument(file, undefined, { keepDocx: true });
}

/** Dosyadan yalnızca metni çıkarır (yeni sözleşme oluştururken). */
export const fileToText = (file: File) => documentText(file);

function downloadBase64(fileName: string, base64: string, type: string) {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function FilePick({
  label,
  accept = DOC_ACCEPT,
  onFile,
  busy,
  multiple,
  primary,
}: {
  label: string;
  accept?: string;
  onFile: (f: File) => void;
  busy?: boolean;
  multiple?: boolean;
  primary?: boolean;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<string | null>(null);
  useEffect(() => {
    if (!busy) {
      setStatus(null);
      return;
    }
    const on = (e: Event) => setStatus((e as CustomEvent<string>).detail);
    window.addEventListener(READ_PROGRESS, on);
    return () => window.removeEventListener(READ_PROGRESS, on);
  }, [busy]);
  return (
    <>
      <button type="button" className={primary ? 'primary' : ''} onClick={() => ref.current?.click()} disabled={busy}>
        <Icon name="upload" /> {busy ? (status ?? 'Okunuyor…') : label}
      </button>
      <input
        ref={ref}
        type="file"
        accept={accept}
        multiple={multiple}
        hidden
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = '';
          files.forEach((f) => onFile(f));
        }}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// Faz 2: Risk puanı ve lehte / aleyhte paneli
// ---------------------------------------------------------------------------

const VERDICT = {
  lehte: { label: 'Lehte', cls: 'v-lehte' },
  aleyhte: { label: 'Aleyhte', cls: 'v-aleyhte' },
  eksik: { label: 'Eksik', cls: 'v-eksik' },
  mevzuat: { label: 'Mevzuat', cls: 'v-mevzuat' },
} as const;

const BAND = { dusuk: 'Düşük risk', orta: 'Orta risk', yuksek: 'Yüksek risk' } as const;
const BAND_NOTE = {
  dusuk: 'Büro standartlarına uyumlu. Hızlıca onaylanabilir.',
  orta: 'İncelenip revize edilmesi gereken maddeler var.',
  yuksek: 'Büyük mali veya hukuki tehlike. Aleyhte maddeleri düzeltmeden imzalatmayın.',
} as const;
const SIDE = { arsa_sahibi: 'Arsa sahibi', yuklenici: 'Yüklenici', genel: 'Genel' } as const;

export function ScoreRing({ score, band }: { score: number; band: keyof typeof BAND }) {
  const r = 34;
  const c = 2 * Math.PI * r;
  return (
    <div className={`score-ring b-${band}`}>
      <svg viewBox="0 0 80 80" width="88" height="88" aria-hidden>
        <circle cx="40" cy="40" r={r} className="track" />
        <circle cx="40" cy="40" r={r} className="bar" strokeDasharray={`${(score / 100) * c} ${c}`} transform="rotate(-90 40 40)" />
      </svg>
      <span className="score-num">{score}</span>
    </div>
  );
}

function Highlighted({ body, findings, active, onPick }: { body: string; findings: ArmorFinding[]; active: string | null; onPick: (key: string) => void }) {
  const segments = useMemo(() => {
    const marks: { start: number; end: number; f: ArmorFinding }[] = [];
    for (const f of findings) {
      if (!f.quote) continue;
      const start = body.indexOf(f.quote);
      if (start < 0 || marks.some((m) => start < m.end && start + f.quote.length > m.start)) continue;
      marks.push({ start, end: start + f.quote.length, f });
    }
    marks.sort((a, b) => a.start - b.start);
    const out: { text: string; f?: ArmorFinding }[] = [];
    let pos = 0;
    for (const m of marks) {
      out.push({ text: body.slice(pos, m.start) });
      out.push({ text: body.slice(m.start, m.end), f: m.f });
      pos = m.end;
    }
    out.push({ text: body.slice(pos) });
    return out;
  }, [body, findings]);
  return (
    <div className="armor-text">
      {segments.map((s, i) =>
        s.f ? (
          <mark key={i} id={`q-${s.f.key}`} className={`${VERDICT[s.f.verdict].cls} ${active === s.f.key ? 'active' : ''}`} onClick={() => onPick(s.f!.key)}>
            {s.text}
          </mark>
        ) : (
          <span key={i}>{s.text}</span>
        ),
      )}
    </div>
  );
}

export function ArmorTab({ data, onChanged }: { data: ContractDetail; onChanged: () => void }) {
  const review = useAsync(() => api<ArmorReview>(`/contracts/${data.id}/review`), [data.id, data.body, data.side]);
  const [active, setActive] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [upload, setUpload] = useState<{ trackedChanges: number; hidden: HiddenChange[]; fileName: string } | null>(null);
  const locked = Boolean(data.locked_at);

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setErr(null);
    try {
      await fn();
      onChanged();
      review.reload();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const r = review.data;
  if (!data.body.trim()) {
    return (
      <Card>
        <Empty icon="contract">İnceleme için sözleşme metnini girin ya da karşı tarafın taslağını yükleyin.</Empty>
        <div className="center-actions">
          <FilePick
            label="Belge yükle (Word, PDF, UYAP, TIF, resim)"
            busy={busy}
            onFile={(f) =>
              run(async () => {
                const file = await readContractFile(f);
                await api(`/contracts/${data.id}/versions`, { body: { ...file, source: 'karsi' } });
              })
            }
          />
        </div>
        <ErrorText error={err} />
      </Card>
    );
  }

  const counts = { lehte: 0, aleyhte: 0, eksik: 0, mevzuat: 0 };
  r?.findings.forEach((f) => counts[f.verdict]++);

  return (
    <>
      <Card className="armor-head">
        {r && (
          <div className="armor-summary">
            <ScoreRing score={r.score} band={r.band} />
            <div>
              <div className={`band-label b-${r.band}`}>
                {BAND[r.band]} · {r.score}/100
              </div>
              <p className="muted small">{BAND_NOTE[r.band]}</p>
              <div className="verdict-counts">
                <span className="v-aleyhte">{counts.aleyhte} aleyhte</span>
                <span className="v-eksik">{counts.eksik} eksik</span>
                <span className="v-mevzuat">{counts.mevzuat} mevzuat</span>
                <span className="v-lehte">{counts.lehte} lehte</span>
              </div>
            </div>
            <div className="armor-actions">
              <label className="inline-field">
                Biz kimiz?
                <select value={data.side || 'genel'} onChange={(e) => run(() => api(`/contracts/${data.id}/side`, { method: 'PUT', body: { side: e.target.value } }))}>
                  {Object.entries(SIDE).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </label>
              {!locked && (
                <FilePick
                  label="Karşı taraftan gelen taslağı yükle"
                  busy={busy}
                  onFile={(f) =>
                    run(async () => {
                      const file = await readContractFile(f);
                      const res = await api<{ trackedChanges: number; hidden: HiddenChange[] }>(`/contracts/${data.id}/versions`, { body: { ...file, source: 'karsi' } });
                      setUpload({ ...res, fileName: file.fileName });
                    })
                  }
                />
              )}
              <button
                className="primary"
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    const out = await api<{ fileName: string; base64: string }>(`/contracts/${data.id}/export`, { body: {} });
                    downloadBase64(out.fileName, out.base64, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
                  })
                }
              >
                <Icon name="download" /> Word’e aktar (değişiklikleri izle)
              </button>
            </div>
          </div>
        )}
        <ErrorText error={err ?? review.error} />
        {upload && <UploadResult result={upload} onClose={() => setUpload(null)} />}
      </Card>
      {r && (
        <div className="armor-split">
          <Card title="Sözleşme metni" className="armor-left">
            <Highlighted
              body={data.body}
              findings={r.findings}
              active={active}
              onPick={(k) => {
                setActive(k);
                document.getElementById(`f-${k}`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
              }}
            />
          </Card>
          <Card title="Analiz" className="armor-right flush">
            <ul className="finding-list">
              {r.findings.map((f) => {
                const suggestions = r.suggestions[f.topic] ?? [];
                return (
                  <li
                    key={f.key}
                    id={`f-${f.key}`}
                    className={`${VERDICT[f.verdict].cls} ${active === f.key ? 'active' : ''}`}
                    onClick={() => {
                      setActive(f.key);
                      if (f.quote) document.getElementById(`q-${f.key}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    }}
                  >
                    <div className="finding-head">
                      <span className={`verdict-pill ${VERDICT[f.verdict].cls}`}>{VERDICT[f.verdict].label}</span>
                      <strong>{f.title}</strong>
                      {f.severity === 'yuksek' && f.verdict !== 'lehte' && <span className="risk-level yuksek">Kritik</span>}
                    </div>
                    <p className="small">{f.note}</p>
                    {f.verdict !== 'lehte' && suggestions.length > 0 && !locked && (
                      <button
                        className="link"
                        onClick={(e) => {
                          e.stopPropagation();
                          setOpen(open === f.key ? null : f.key);
                        }}
                      >
                        <Icon name="pen" /> {f.quote ? 'Düzenle' : 'Madde ekle'} ({suggestions.length} öneri)
                      </button>
                    )}
                    {open === f.key && (
                      <div className="suggestions" onClick={(e) => e.stopPropagation()}>
                        <p className="muted small">
                          {f.quote ? 'Bu madde yerine kütüphanemizdeki şu maddeyi koymak ister misiniz?' : 'Kütüphanemizdeki şu madde eklensin mi?'}
                        </p>
                        {suggestions.map((s) => (
                          <div key={s.id} className="suggestion">
                            <strong className="small">{s.title}</strong>
                            <p className="small">{s.body}</p>
                            <button
                              className="primary small-btn"
                              disabled={busy}
                              onClick={() =>
                                run(async () => {
                                  await api(`/contracts/${data.id}/apply-clause`, { body: { quote: f.quote, clauseId: s.id } });
                                  setOpen(null);
                                })
                              }
                            >
                              <Icon name="check" /> Kabul et
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </Card>
        </div>
      )}
    </>
  );
}

function UploadResult({ result, onClose }: { result: { trackedChanges: number; hidden: HiddenChange[]; fileName: string }; onClose: () => void }) {
  return (
    <div className={`upload-result ${result.hidden.length ? 'danger' : 'ok'}`}>
      <div className="row-between">
        <strong>
          {result.fileName} yüklendi · {result.trackedChanges} izlenen değişiklik
        </strong>
        <button className="ghost" onClick={onClose}>
          ×
        </button>
      </div>
      {result.hidden.length === 0 ? (
        <p className="small">Gizli değişiklik yok: karşı tarafın yaptığı tüm değişiklikler “Değişiklikleri İzle” ile işaretlenmiş.</p>
      ) : (
        <>
          <p className="small">
            <strong>Dikkat: Karşı taraf {result.hidden.length} yerde “Değişiklikleri İzle” kapalıyken gizli değişiklik yaptı.</strong>
          </p>
          <HiddenList items={result.hidden} />
        </>
      )}
    </div>
  );
}

function HiddenList({ items }: { items: HiddenChange[] }) {
  return (
    <ul className="hidden-list">
      {items.map((h, i) => (
        <li key={i}>
          <span className="muted small">{h.context || `${h.paragraph}. paragraf`}</span>
          <div>
            {h.removed && <del>{h.removed}</del>} {h.added && <ins>{h.added}</ins>}
          </div>
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// Faz 3: Versiyonlar ve imza
// ---------------------------------------------------------------------------

export function VersionsTab({ id }: { id: number }) {
  const list = useAsync(() => api<ContractVersion[]>(`/contracts/${id}/versions`), [id]);
  const [pair, setPair] = useState<[number, number] | null>(null);
  const diff = useAsync(
    () => (pair ? api<{ parts: { op: 'eq' | 'ins' | 'del'; text: string }[] }>(`/contracts/${id}/compare?from=${pair[0]}&to=${pair[1]}`) : Promise.resolve(null)),
    [pair?.[0], pair?.[1]],
  );
  const rows = list.data ?? [];
  return (
    <div className="grid-main-side wide-side">
      <Card title="Versiyon geçmişi" className="flush">
        <ErrorText error={list.error} />
        {rows.length === 0 ? (
          <Empty icon="file">Henüz versiyon yok. Karşı tarafın taslağını yüklediğinizde ya da Word’e aktardığınızda versiyonlar burada birikir.</Empty>
        ) : (
          <ul className="items version-list">
            {rows.map((v, i) => {
              const hidden = v.meta.hidden ?? [];
              const prev = rows[i + 1];
              return (
                <li key={v.id}>
                  <span className={`version-badge ${v.source}`}>v{v.version}</span>
                  <span className="item-text">
                    <strong>{v.source === 'karsi' ? 'Karşı taraftan geldi' : v.meta.note || 'Bizim versiyonumuz'}</strong>
                    <span>
                      {formatDate(v.created_at.slice(0, 10))} · {v.created_by_name}
                      {v.file_name && ` · ${v.file_name}`}
                      {v.source === 'karsi' && ` · ${v.meta.trackedChanges ?? 0} izlenen değişiklik`}
                    </span>
                    {hidden.length > 0 && (
                      <span className="hidden-alert">
                        <Icon name="alert" /> {hidden.length} gizli değişiklik yakalandı
                      </span>
                    )}
                    {hidden.length > 0 && <HiddenList items={hidden} />}
                  </span>
                  {prev && (
                    <button className="link" onClick={() => setPair([prev.version, v.version])}>
                      Önceki ile karşılaştır
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>
      <Card title={pair ? `v${pair[0]} → v${pair[1]} farkları` : 'Karşılaştırma'} className="sticky">
        {!diff.data ? (
          <Empty icon="file">İki versiyonu karşılaştırmak için soldan seçin.</Empty>
        ) : (
          <div className="armor-text diff">
            {diff.data.parts.map((p, i) => (p.op === 'eq' ? <span key={i}>{p.text}</span> : p.op === 'ins' ? <ins key={i}>{p.text}</ins> : <del key={i}>{p.text}</del>))}
          </div>
        )}
      </Card>
    </div>
  );
}

export function SigningTab({ data, onChanged }: { data: ContractDetail; onChanged: () => void }) {
  const state = useAsync(() => api<Signing>(`/contracts/${data.id}/signing`), [data.id, data.locked_at]);
  const team = useAsync(() => api<User[]>('/users'), []);
  const [signers, setSigners] = useState<{ name: string; role: string }[]>([]);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (signers.length || !team.data) return;
    const admins = team.data.filter((u) => u.is_admin).map((u) => ({ name: u.name, role: 'Büro yöneticisi' }));
    const parties = data.parties
      .split(/\s*(?:\/|,| ve |;)\s*/)
      .filter(Boolean)
      .map((p) => ({ name: p, role: 'Karşı taraf' }));
    setSigners([...admins, ...parties]);
  }, [team.data]);

  async function act(fn: () => Promise<unknown>) {
    try {
      await fn();
      setErr(null);
      state.reload();
      onChanged();
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  const s = state.data;
  if (s && s.locked_at) {
    return (
      <Card title="İmza sırası">
        <p className="muted small">Sözleşme {formatDate(s.locked_at.slice(0, 10))} tarihinde imzaya kilitlendi; metin artık değiştirilemez. İmzalar sırayla alınır.</p>
        <ol className="sign-list">
          {s.signers.map((x) => (
            <li key={x.id} className={x.signed_at ? 'signed' : s.next === x.id ? 'next' : ''}>
              <span className="sign-pos">{x.position}</span>
              <span className="item-text">
                <strong>{x.name}</strong>
                <span>{x.role}</span>
              </span>
              {x.signed_at ? (
                <span className="badge onayli">İmzaladı · {formatDate(x.signed_at)}</span>
              ) : s.next === x.id ? (
                <button className="primary" onClick={() => act(() => api(`/contracts/${data.id}/signers/${x.id}/sign`, { body: {} }))}>
                  İmzaladı olarak işaretle
                </button>
              ) : (
                <span className="muted small">Sırada bekliyor</span>
              )}
            </li>
          ))}
        </ol>
        {!s.next && <p className="success-note">Tüm imzalar tamamlandı. Sözleşme yürürlüğe girdi ve teslim / ödeme takvimi çıkarıldı.</p>}
        <p className="muted small">E-imza ve DocuSign bağlantısı ilerleyen adımda eklenecek; şimdilik imzalar elle işaretlenir.</p>
        <ErrorText error={err} />
      </Card>
    );
  }
  return (
    <Card title="İmzaya gönder">
      {data.review_status !== 'onayli' ? (
        <Empty icon="check">İmzaya göndermeden önce sözleşme bir meslektaş tarafından onaylanmalı. Yukarıdaki “Onaya gönder” düğmesini kullanın.</Empty>
      ) : (
        <form
          className="form-grid"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            act(() => api(`/contracts/${data.id}/lock`, { body: { signers } }));
          }}
        >
          <p className="muted small wide">
            Taraflar mutabık kaldığında sözleşme kilitlenir ve imzacılara sırayla gönderilir. Sıra, büronuzun yetki tablosuna göre önerildi; değiştirebilirsiniz.
          </p>
          {signers.map((x, i) => (
            <div key={i} className="signer-row wide">
              <span className="sign-pos">{i + 1}</span>
              <input value={x.name} placeholder="Ad soyad / unvan" onChange={(e) => setSigners(signers.map((y, j) => (j === i ? { ...y, name: e.target.value } : y)))} />
              <input value={x.role} placeholder="Görevi" onChange={(e) => setSigners(signers.map((y, j) => (j === i ? { ...y, role: e.target.value } : y)))} />
              <button type="button" className="ghost" onClick={() => setSigners(signers.filter((_, j) => j !== i))}>
                ×
              </button>
            </div>
          ))}
          <div className="form-actions">
            <ErrorText error={err} />
            <button type="button" onClick={() => setSigners([...signers, { name: '', role: '' }])}>
              <Icon name="plus" /> İmzacı ekle
            </button>
            <button className="primary" type="submit">
              Kilitle ve imzaya gönder
            </button>
          </div>
        </form>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Faz 4: Takvim, gecikme alarmı ve ihtarname
// ---------------------------------------------------------------------------

export function ScheduleCard({ data, onChanged }: { data: ContractDetail; onChanged: () => void }) {
  const alarms = useAsync(() => api<ContractAlarm[]>(`/contracts/${data.id}/alarms`), [data.id, data.obligations.length, data.units]);
  const [permit, setPermit] = useState(data.permit_date);
  const [units, setUnits] = useState(String(data.units || 1));
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function extract() {
    try {
      if (Number(units) !== data.units) await api(`/contracts/${data.id}/units`, { method: 'PUT', body: { units: Number(units) } });
      const r = await api<{ added: number; needsPermitDate: boolean }>(`/contracts/${data.id}/schedule`, { body: { ruhsatDate: permit || undefined } });
      setMsg(
        `${r.added} yeni tarih takvime eklendi.${r.needsPermitDate ? ' Ruhsat tarihine bağlı süreler için ruhsat tarihini girin.' : ''}`,
      );
      setErr(null);
      onChanged();
      alarms.reload();
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  return (
    <>
      <Card title="İmza sonrası otomasyon">
        <p className="muted small">
          Sözleşmedeki “imzadan / ruhsattan itibaren … ay” gibi süreleri okuyup teslim ve ödeme tarihlerini takvime ekler. Geciken her taahhüt için gecikme tazminatını hesaplar.
        </p>
        <div className="form-grid cols-3">
          <Field label="İmza (başlangıç) tarihi">
            <input value={data.start_date ? formatDate(data.start_date) : 'Bilgiler sekmesinden girin'} disabled />
          </Field>
          <Field label="Yapı ruhsatı tarihi">
            <input type="date" value={permit} onChange={(e) => setPermit(e.target.value)} />
          </Field>
          <Field label="Bağımsız bölüm sayısı">
            <input value={units} onChange={(e) => setUnits(e.target.value)} inputMode="numeric" />
          </Field>
        </div>
        <div className="form-actions">
          {msg && <span className="success-note">{msg}</span>}
          <ErrorText error={err} />
          <button className="primary" onClick={extract}>
            <Icon name="calendar" /> Sözleşmeden takvim çıkar
          </button>
        </div>
      </Card>
      {(alarms.data ?? []).length > 0 && (
        <Card title="Gecikme alarmları" className="flush alarm-card">
          <ul className="items">
            {alarms.data!.map((a) => (
              <li key={a.obligation.id}>
                <span className="risk-dot yuksek" />
                <span className="item-text">
                  <strong>
                    {a.obligation.party ? `${a.obligation.party}: ` : ''}
                    {a.days} gün gecikti
                  </strong>
                  <span>{a.obligation.text}</span>
                  {a.penalty > 0 && (
                    <span className="penalty">
                      İşlemiş gecikme tazminatı: <strong>{a.penalty.toLocaleString('tr-TR', { minimumFractionDigits: 2 })} TL</strong> ({a.basis})
                    </span>
                  )}
                </span>
                <button
                  onClick={async () => setNotice((await api<{ text: string }>(`/contracts/${data.id}/notice/${a.obligation.id}`)).text)}
                >
                  İhtarname taslağı
                </button>
              </li>
            ))}
          </ul>
        </Card>
      )}
      {notice && (
        <Card
          title="İhtarname taslağı"
          actions={
            <>
              <button onClick={() => navigator.clipboard?.writeText(notice)}>Kopyala</button>
              <button className="ghost" onClick={() => setNotice(null)}>
                ×
              </button>
            </>
          }
        >
          <textarea className="editor" value={notice} onChange={(e) => setNotice(e.target.value)} rows={18} />
        </Card>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Faz 1: Kural bankası ve madde kütüphanesi
// ---------------------------------------------------------------------------

const PB_FIELDS: { key: keyof Playbook; label: string; group: string; unit?: string }[] = [
  { key: 'courtCity', label: 'Yetkili mahkeme (şehir)', group: 'Tüm sözleşmeler' },
  { key: 'maxPenalty', label: 'Bize karşı en yüksek cezai şart', group: 'Tüm sözleşmeler', unit: 'TL' },
  { key: 'allowArbitration', label: 'Tahkime izin ver', group: 'Tüm sözleşmeler' },
  { key: 'requireForceMajeure', label: 'Mücbir sebep maddesi zorunlu', group: 'Tüm sözleşmeler' },
  { key: 'requireLiabilityCap', label: 'Sorumluluk üst sınırı zorunlu', group: 'Tüm sözleşmeler' },
  { key: 'requireConfidentiality', label: 'Gizlilik maddesi zorunlu', group: 'Tüm sözleşmeler' },
  { key: 'minOwnerShare', label: 'Arsa sahibine en az kalacak pay', group: 'Kat karşılığı inşaat', unit: '%' },
  { key: 'maxDeliveryMonths', label: 'En uzun teslim süresi', group: 'Kat karşılığı inşaat', unit: 'ay' },
  { key: 'minDelayPenalty', label: 'Bağımsız bölüm başına aylık en az gecikme tazminatı', group: 'Kat karşılığı inşaat', unit: 'TL' },
  { key: 'requireGuarantee', label: 'Teminat mektubu zorunlu', group: 'Kat karşılığı inşaat' },
  { key: 'stagedTitleTransfer', label: 'Tapu aşamalı devredilmeli', group: 'Kat karşılığı inşaat' },
  { key: 'requireNotary', label: 'Noterde düzenleme şekli zorunlu', group: 'Kat karşılığı inşaat' },
  { key: 'requireIskan', label: 'İskânlı teslim zorunlu', group: 'Kat karşılığı inşaat' },
  { key: 'forbidAssignment', label: 'Yüklenici devredemesin', group: 'Kat karşılığı inşaat' },
  { key: 'requireInsurance', label: 'İnşaat sigortası zorunlu', group: 'Kat karşılığı inşaat' },
];

export function PlaybookPanel() {
  const pb = useAsync(() => api<Playbook>('/playbook'), []);
  const [form, setForm] = useState<Playbook | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (pb.data) setForm(pb.data);
  }, [pb.data]);
  if (!form) return <ErrorText error={pb.error} />;
  const groups = [...new Set(PB_FIELDS.map((f) => f.group))];
  return (
    <Card
      title="Kural bankası (playbook)"
      actions={
        <button
          className="primary"
          onClick={async () => {
            try {
              setForm(await api<Playbook>('/playbook', { method: 'PUT', body: form }));
              setMsg('Kaydedildi. Tüm sözleşmeler bu kurallarla puanlanır.');
              setErr(null);
            } catch (e) {
              setErr((e as Error).message);
            }
          }}
        >
          Kaydet
        </button>
      }
    >
      <p className="muted small">Büronuzun kabul edebileceği sınırlar. Sözleşmeler yüklendiği an bu kurallara göre lehte / aleyhte işaretlenir ve 0–100 arası risk puanı alır.</p>
      {groups.map((g) => (
        <div key={g} className="pb-group">
          <h4>{g}</h4>
          <div className="form-grid cols-3">
            {PB_FIELDS.filter((f) => f.group === g).map((f) => {
              const v = form[f.key];
              return typeof v === 'boolean' ? (
                <label key={f.key} className="switch-row">
                  <input type="checkbox" checked={v} onChange={(e) => setForm({ ...form, [f.key]: e.target.checked })} />
                  {f.label}
                </label>
              ) : (
                <Field key={f.key} label={`${f.label}${f.unit ? ` (${f.unit})` : ''}`}>
                  <input value={String(v)} onChange={(e) => setForm({ ...form, [f.key]: typeof v === 'number' ? e.target.value : e.target.value } as Playbook)} />
                </Field>
              );
            })}
          </div>
        </div>
      ))}
      {msg && <p className="success-note">{msg}</p>}
      <ErrorText error={err} />
    </Card>
  );
}

export function LibraryPanel() {
  const lib = useAsync(() => api<{ topics: Record<string, string>; items: Clause[] }>('/clauses'), []);
  const [topic, setTopic] = useState('');
  const [form, setForm] = useState({ kind: 'kat-karsiligi', topic: 'teslim', title: '', body: '' });
  const [err, setErr] = useState<string | null>(null);
  const topics = lib.data?.topics ?? {};
  const items = (lib.data?.items ?? []).filter((c) => !topic || c.topic === topic);
  return (
    <div className="grid-main-side">
      <Card title={`Onaylı madde kütüphanesi (${lib.data?.items.length ?? 0})`} className="flush">
        <div className="toolbar inset">
          <select value={topic} onChange={(e) => setTopic(e.target.value)}>
            <option value="">Tüm konular</option>
            {Object.entries(topics).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </div>
        <ul className="items clause-list">
          {items.map((c) => (
            <li key={c.id}>
              <span className="item-text">
                <strong>
                  <span className="tag">{topics[c.topic] ?? c.topic}</span> {c.title}
                </strong>
                <span>{c.body}</span>
              </span>
              <button
                className="ghost"
                title="Sil"
                onClick={async () => {
                  await api(`/clauses/${c.id}`, { method: 'DELETE' });
                  lib.reload();
                }}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      </Card>
      <Card title="Güvenli madde ekle">
        <form
          className="form-grid"
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              await api('/clauses', { body: form });
              setForm({ ...form, title: '', body: '' });
              setErr(null);
              lib.reload();
            } catch (ex) {
              setErr((ex as Error).message);
            }
          }}
        >
          <Field label="Sözleşme türü">
            <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
              <option value="kat-karsiligi">Kat karşılığı inşaat</option>
              <option value="genel">Tüm sözleşmeler</option>
            </select>
          </Field>
          <Field label="Konu">
            <select value={form.topic} onChange={(e) => setForm({ ...form, topic: e.target.value })}>
              {Object.entries(topics).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Başlık" wide>
            <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required />
          </Field>
          <Field label="Madde metni" wide>
            <textarea rows={6} value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} required />
          </Field>
          <div className="form-actions">
            <ErrorText error={err} />
            <button className="primary" type="submit">
              <Icon name="plus" /> Kütüphaneye ekle
            </button>
          </div>
        </form>
      </Card>
    </div>
  );
}
