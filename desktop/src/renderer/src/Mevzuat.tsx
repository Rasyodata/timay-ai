import { useState, type FormEvent } from 'react';
import { api } from './api';
import type { Go } from './App';
import { Card, Empty, ErrorText, Field, formatDate, Icon, useAsync } from './ui';

/*
 * Mevzuat takibi: değişen kanun maddesini girin; o maddeye dayanan sözleşme ve dilekçeler listelenir.
 */

interface Impact {
  type: 'contract' | 'petition';
  id: number;
  title: string;
  status: string;
  context: string;
  refs: string[];
  snippet: string;
}

interface Change {
  id: number;
  law: string;
  articles: number[];
  title: string;
  effective_date: string;
  summary: string;
  affected: number;
  impact: Impact[];
}

export function LawChanges({ go }: { go: Go }) {
  const laws = useAsync(() => api<{ short: string; name: string }[]>('/laws'), []);
  const list = useAsync(() => api<Change[]>('/law-changes'), []);
  const [form, setForm] = useState({ law: 'TBK', articles: '', effectiveDate: '', summary: '' });
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState<number | null>(null);

  async function add(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    try {
      const c = await api<Change>('/law-changes', { body: form });
      setForm({ ...form, articles: '', summary: '' });
      setOpen(c.id);
      list.reload();
    } catch (ex) {
      setErr((ex as Error).message);
    }
  }

  async function remove(id: number) {
    await api(`/law-changes/${id}`, { method: 'DELETE' });
    list.reload();
  }

  return (
    <div className="stack">
      <Card title="Mevzuat değişikliği ekle">
        <p className="muted small">Değişen kanun maddesini girin; büronuzdaki yürürlükteki sözleşmeler ve açık dosyalardaki dilekçeler taranır, o maddeye dayananlar listelenir.</p>
        <form className="form-grid" onSubmit={add}>
          <Field label="Kanun">
            <select value={form.law} onChange={(e) => setForm({ ...form, law: e.target.value })}>
              {laws.data?.map((l) => (
                <option key={l.short} value={l.short}>
                  {l.short} · {l.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Değişen maddeler">
            <input value={form.articles} onChange={(e) => setForm({ ...form, articles: e.target.value })} placeholder="ör. 344, 347 (boşsa kanunun tamamı)" />
          </Field>
          <Field label="Yürürlük tarihi">
            <input type="date" value={form.effectiveDate} onChange={(e) => setForm({ ...form, effectiveDate: e.target.value })} />
          </Field>
          <Field label="Ne değişti?" wide>
            <input value={form.summary} onChange={(e) => setForm({ ...form, summary: e.target.value })} placeholder="ör. Konut kira artış sınırı kaldırıldı" />
          </Field>
          <div className="form-actions">
            <button className="primary" type="submit">
              <Icon name="search" /> Ekle ve etkisini bul
            </button>
          </div>
        </form>
        <ErrorText error={err} />
      </Card>

      <Card title="İzlenen değişiklikler" className="flush">
        {!list.data?.length ? (
          <Empty icon="book">Henüz mevzuat değişikliği girilmedi.</Empty>
        ) : (
          <ul className="law-list">
            {list.data.map((c) => (
              <li key={c.id}>
                <div className="law-head" onClick={() => setOpen(open === c.id ? null : c.id)}>
                  <span className={`rf-pill ${c.affected ? 'b-yuksek' : 'b-dusuk'}`}>{c.affected}</span>
                  <span className="item-text">
                    <strong>{c.title}</strong>
                    <span>
                      {[c.effective_date && `Yürürlük ${formatDate(c.effective_date)}`, c.summary, c.affected ? `${c.affected} belge etkileniyor` : 'Etkilenen belge yok'].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                  <button
                    className="ghost icon-btn"
                    title="Sil"
                    onClick={(e) => {
                      e.stopPropagation();
                      remove(c.id);
                    }}
                  >
                    <Icon name="trash" />
                  </button>
                </div>
                {open === c.id && c.impact.length > 0 && (
                  <ul className="law-impact">
                    {c.impact.map((i) => (
                      <li key={`${i.type}-${i.id}`} className="clickable" onClick={() => go(i.type === 'contract' ? { name: 'contract', id: i.id } : { name: 'petition', id: i.id })}>
                        <span className="tag">{i.type === 'contract' ? 'Sözleşme' : 'Dilekçe'}</span>
                        <span className="item-text">
                          <strong>
                            {i.title}
                            {i.context && <span className="muted"> · {i.context}</span>}
                          </strong>
                          <span>
                            {i.refs.join(', ')} {i.snippet && <q>{i.snippet}</q>}
                          </span>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
