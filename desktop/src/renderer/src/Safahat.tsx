import { useEffect, useState } from 'react';
import { api } from './api';
import { Card, ErrorText, Field, formatDate, Icon, today, useAsync } from './ui';

/*
 * Safahat: davanın aşama çizelgesi, sıradaki duruşmaya kalan gün ve her yeni aşamada
 * kendiliğinden hesaplanan süre ile "sıradaki adım" önerileri.
 */

interface Suggestions {
  stage: string;
  deadline: { ruleId: string; title: string; basis: string; date: string; notes: string[] } | null;
  steps: { title: string; due: string }[];
}

export interface Safahat {
  current: { stage: string; title: string; date: string } | null;
  entries: { id: number; stage: string; title: string; date: string; note: string; user_name: string }[];
  timeline: { id: string; title: string; state: 'done' | 'current' | 'todo'; date: string }[];
  nextHearing: { date: string; time: string; days: number } | null;
  suggestions: Suggestions | null;
  nextStage: string | null;
  stages: { id: string; title: string; hint: string; main: boolean }[];
  created?: { deadline: unknown; tasks: unknown[] };
}

function daysLabel(days: number) {
  return days === 0 ? 'Bugün' : days === 1 ? 'Yarın' : `${days} gün`;
}

/** Dava sayfasının üstündeki aşama şeridi. */
export function SafahatStrip({ caseId, reloadKey, onOpen }: { caseId: number; reloadKey: number; onOpen: () => void }) {
  const s = useAsync(() => api<Safahat>(`/cases/${caseId}/safahat`), [caseId, reloadKey]);
  if (!s.data) return null;
  const d = s.data;
  return (
    <div className="sf-strip">
      <ol className="sf-line" onClick={onOpen} title="Safahatı aç">
        {d.timeline.map((t, i) => (
          <li key={t.id} className={`sf-step s-${t.state}`}>
            <span className="sf-dot">{t.state === 'done' ? <Icon name="check" /> : i + 1}</span>
            <span className="sf-label">
              {t.title}
              {t.date && <small>{formatDate(t.date)}</small>}
            </span>
          </li>
        ))}
      </ol>
      <div className={`sf-hearing ${d.nextHearing && d.nextHearing.days <= 3 ? 'soon' : ''}`}>
        {d.nextHearing ? (
          <>
            <strong>{daysLabel(d.nextHearing.days)}</strong>
            <span>
              sonra duruşma · {formatDate(d.nextHearing.date)} {d.nextHearing.time}
            </span>
          </>
        ) : (
          <>
            <strong>—</strong>
            <span>İleri tarihli duruşma yok</span>
          </>
        )}
      </div>
    </div>
  );
}

/** Safahat sekmesi: yeni aşama ekleme (öneriler ve süre önizlemesiyle) ve geçmiş. */
export function SafahatTab({ caseId, onChanged }: { caseId: number; onChanged: () => void }) {
  const s = useAsync(() => api<Safahat>(`/cases/${caseId}/safahat`), [caseId]);
  const [stage, setStage] = useState('');
  const [date, setDate] = useState(today());
  const [note, setNote] = useState('');
  const [preview, setPreview] = useState<Suggestions | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [withDeadline, setWithDeadline] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    if (s.data && !stage) setStage(s.data.nextStage ?? 'acilis');
  }, [s.data]);

  useEffect(() => {
    if (!stage) return;
    api<Suggestions>(`/cases/${caseId}/safahat/preview`, { body: { stage, date } })
      .then((p) => {
        setPreview(p);
        setPicked(new Set(p.steps.map((x) => x.title)));
      })
      .catch((e) => setErr((e as Error).message));
  }, [stage, date]);

  async function save() {
    setBusy(true);
    setErr(null);
    try {
      const r = await api<Safahat>(`/cases/${caseId}/safahat`, { body: { stage, date, note, createDeadline: withDeadline, steps: [...picked] } });
      s.setData(r);
      const parts = [r.created?.deadline ? '1 süre' : '', r.created?.tasks.length ? `${r.created.tasks.length} görev` : ''].filter(Boolean);
      setDone(`${r.current?.title ?? 'Aşama'} kaydedildi${parts.length ? `; ${parts.join(' ve ')} oluşturuldu` : ''}.`);
      setStage(r.nextStage ?? '');
      setNote('');
      setDate(today());
      onChanged();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: number) {
    s.setData(await api<Safahat>(`/cases/${caseId}/safahat/${id}`, { method: 'DELETE' }));
    onChanged();
  }

  const d = s.data;
  return (
    <div className="grid-main-side">
      <Card title="Yeni safahat">
        <div className="form-grid">
          <Field label="Aşama">
            <select value={stage} onChange={(e) => setStage(e.target.value)}>
              {d?.stages.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.title}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Tarih (tebliğ / karar / işlem günü)">
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="Not" wide>
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="ör. Tensipte 2 hafta kesin süre verildi" />
          </Field>
        </div>
        {d && <p className="muted small">{d.stages.find((x) => x.id === stage)?.hint}</p>}
        {preview?.deadline && (
          <label className={`sf-deadline ${withDeadline ? 'on' : ''}`}>
            <input type="checkbox" checked={withDeadline} onChange={(e) => setWithDeadline(e.target.checked)} />
            <span>
              <strong>
                {preview.deadline.title}: son gün {formatDate(preview.deadline.date)}
              </strong>
              <span className="muted small">
                {preview.deadline.basis}
                {preview.deadline.notes.length ? ` · ${preview.deadline.notes.join(' ')}` : ''} · 3 gün ve 1 gün kala bildirim gelir.
              </span>
            </span>
          </label>
        )}
        {preview && preview.steps.length > 0 && (
          <>
            <h4 className="sf-head">Sıradaki adımlar (görev olarak açılır)</h4>
            <ul className="sf-steps">
              {preview.steps.map((x) => (
                <li key={x.title}>
                  <label>
                    <input
                      type="checkbox"
                      checked={picked.has(x.title)}
                      onChange={(e) => {
                        const n = new Set(picked);
                        if (e.target.checked) n.add(x.title);
                        else n.delete(x.title);
                        setPicked(n);
                      }}
                    />
                    <span>{x.title}</span>
                    <span className="muted small">{formatDate(x.due)}</span>
                  </label>
                </li>
              ))}
            </ul>
          </>
        )}
        <ErrorText error={err} />
        {done && <p className="success small">{done}</p>}
        <div className="form-actions">
          <button className="primary" disabled={busy || !stage} onClick={save}>
            Safahatı kaydet
          </button>
        </div>
      </Card>
      <Card title="Safahat geçmişi" className="flush">
        {!d?.entries.length ? (
          <p className="muted small inset-note top">Henüz aşama girilmedi. İlk kayıt olarak "Dava açıldı"yı girin.</p>
        ) : (
          <ul className="sf-history">
            {d.entries.map((e) => (
              <li key={e.id}>
                <span className="sf-history-date">{formatDate(e.date)}</span>
                <span className="item-text">
                  <strong>{e.title}</strong>
                  <span>{[e.note, e.user_name].filter(Boolean).join(' · ')}</span>
                </span>
                <button className="ghost icon-btn" title="Sil" onClick={() => remove(e.id)}>
                  <Icon name="trash" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
