import { useState } from 'react';
import { api } from './api';
import { ExportButtons } from './Export';
import { Card, ErrorText, formatDate, Icon, useAsync } from './ui';

/*
 * Dava özeti ve strateji: dosyanın tamamından çıkarılan özet, önceliklendirilmiş yol haritası
 * ve müvekkile gönderilecek durum raporu.
 */

interface Summary {
  case: { title: string; court: string; esas_no: string; client: string; parties: string; area: string; facts: string };
  stage: { title: string; date: string } | null;
  nextHearing: { date: string; time: string; days: number } | null;
  risk: { score: number; band: 'yuksek' | 'orta' | 'dusuk'; issues: number };
  deadlines: { title: string; due_date: string }[];
  tasks: { title: string; due_date: string; assignee: string }[];
  documents: { kind: string; n: number }[];
  petitions: { id: number; title: string; score: number | null; verdict: string }[];
  notes: string[];
  strategy: { level: 'acil' | 'onemli' | 'plan'; text: string }[];
  report: string;
  ai: boolean;
}

const LEVEL = { acil: 'Acil', onemli: 'Önemli', plan: 'Plan' };
const BAND = { yuksek: 'Yüksek risk', orta: 'Orta risk', dusuk: 'Düşük risk' };

export function CaseSummaryTab({ caseId, reloadKey }: { caseId: number; reloadKey: number }) {
  const s = useAsync(() => api<Summary>(`/cases/${caseId}/summary`), [caseId, reloadKey]);
  const [copied, setCopied] = useState(false);
  if (!s.data) return <ErrorText error={s.error} />;
  const d = s.data;
  return (
    <div className="sum-layout">
      <div className="stack">
        <Card title="Dava özeti">
          <dl className="sum-grid">
            <dt>Mahkeme</dt>
            <dd>{[d.case.court, d.case.esas_no && `${d.case.esas_no} E.`].filter(Boolean).join(' · ') || '—'}</dd>
            <dt>Müvekkil</dt>
            <dd>{d.case.client || '—'}</dd>
            <dt>Taraflar</dt>
            <dd>{d.case.parties || '—'}</dd>
            <dt>Aşama</dt>
            <dd>{d.stage ? `${d.stage.title} (${formatDate(d.stage.date)})` : 'Girilmedi'}</dd>
            <dt>Sıradaki duruşma</dt>
            <dd>{d.nextHearing ? `${formatDate(d.nextHearing.date)} ${d.nextHearing.time} · ${d.nextHearing.days} gün sonra` : 'Yok'}</dd>
            <dt>Risk</dt>
            <dd>
              <span className={`rf-pill b-${d.risk.band}`}>{d.risk.score}</span> {BAND[d.risk.band]} · {d.risk.issues} uyarı
            </dd>
            <dt>Belgeler</dt>
            <dd>{d.documents.reduce((n, x) => n + x.n, 0)} belge</dd>
            <dt>Dilekçeler</dt>
            <dd>
              {d.petitions.length
                ? d.petitions.map((p) => (
                    <span key={p.id} className="sum-pet">
                      {p.title}
                      {p.score !== null && <span className={`disc-pill b-${p.score >= 80 ? 'iyi' : p.score >= 50 ? 'uyari' : 'kritik'}`}>{p.score}</span>}
                    </span>
                  ))
                : '—'}
            </dd>
          </dl>
          {d.case.facts && (
            <>
              <h4 className="sf-head">Olay</h4>
              <p className="small">{d.case.facts}</p>
            </>
          )}
          {d.notes.length > 0 && (
            <>
              <h4 className="sf-head">Sabit notlar</h4>
              <ul className="sum-notes">
                {d.notes.map((n, i) => (
                  <li key={i}>{n}</li>
                ))}
              </ul>
            </>
          )}
        </Card>
        <Card title="Strateji ve yol haritası">
          {d.strategy.length === 0 ? (
            <p className="muted small">Dosyada acil bir iş görünmüyor.</p>
          ) : (
            <ol className="strategy">
              {d.strategy.map((x, i) => (
                <li key={i} className={`st-${x.level}`}>
                  <span className={`st-tag st-${x.level}`}>{LEVEL[x.level]}</span>
                  {x.text}
                </li>
              ))}
            </ol>
          )}
          <p className="muted small">{d.ai ? 'Yapay zekâ değerlendirmesi dahil.' : 'Dosyadaki bilgilerden çıkarıldı. Yapay zekâ bağlandığında metinlerden ayrıca strateji yazılacak.'}</p>
        </Card>
      </div>
      <Card
        title="Müvekkile durum raporu"
        actions={
          <>
            <button
              onClick={() => {
                navigator.clipboard?.writeText(d.report);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }}
            >
              <Icon name="file" /> {copied ? 'Kopyalandı' : 'Kopyala'}
            </button>
            <ExportButtons title={`Durum raporu - ${d.case.title}`} body={d.report} />
          </>
        }
      >
        <textarea className="editor mono sum-report" readOnly value={d.report} />
      </Card>
    </div>
  );
}
