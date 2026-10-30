import type { ReactNode } from 'react';
import { KIND_LABEL, TEYIT_LABEL, type PetitionDetail, type TeyitItem, type TeyitReport } from './api';

export function needsAck(item: TeyitItem) {
  return item.status === 'sari' || item.status === 'gri';
}

/** Metni, teyit edilen dayanaklar renkli işaretlenmiş olarak gösterir. */
export function HighlightedText({ body, items }: { body: string; items: TeyitItem[] }) {
  const marks: { start: number; end: number; item: TeyitItem }[] = [];
  for (const item of items) {
    let from = 0;
    for (;;) {
      const start = body.indexOf(item.quote, from);
      if (start < 0 || !item.quote) break;
      const end = start + item.quote.length;
      if (!marks.some((m) => start < m.end && end > m.start)) marks.push({ start, end, item });
      from = end;
    }
  }
  marks.sort((a, b) => a.start - b.start);
  const parts: ReactNode[] = [];
  let pos = 0;
  for (const m of marks) {
    if (m.start > pos) parts.push(body.slice(pos, m.start));
    parts.push(
      <mark key={m.start} className={`teyit ${m.item.status}`} title={`${TEYIT_LABEL[m.item.status]}: ${m.item.note}`}>
        {body.slice(m.start, m.end)}
      </mark>,
    );
    pos = m.end;
  }
  parts.push(body.slice(pos));
  return <div className="editor highlighted">{parts}</div>;
}

export function TeyitSummary({ report }: { report: TeyitReport }) {
  return (
    <div className="teyit-summary">
      {(['yesil', 'sari', 'kirmizi', 'gri'] as const).map((s) => (
        <span key={s} className={`chip ${s}`}>
          {report.counts[s]} {TEYIT_LABEL[s].toLocaleLowerCase('tr')}
        </span>
      ))}
    </div>
  );
}

export function TeyitPanel({
  report,
  acks,
  canAck,
  onAck,
  onDeep,
  deepBusy,
}: {
  report: TeyitReport;
  acks?: string[];
  canAck?: boolean;
  onAck?: (key: string, checked: boolean) => void;
  onDeep?: () => void;
  deepBusy?: boolean;
}) {
  return (
    <div>
      <h3>Teyit raporu</h3>
      <TeyitSummary report={report} />
      {onDeep && (
        <div className="row">
          <button onClick={onDeep} disabled={deepBusy}>
            {deepBusy ? 'Claude denetliyor… (1-2 dakika)' : report.deepCheckedAt ? 'Derin teyidi yenile' : 'Derin teyit (Claude)'}
          </button>
          <span className="muted small">
            {report.deepCheckedAt ? `Son derin teyit: ${report.deepCheckedAt}` : 'Kararların anlamı ve olay iddiaları henüz denetlenmedi.'}
          </span>
        </div>
      )}
      {report.items.length === 0 && <p className="muted small">Metinde karar, kanun maddesi ya da olay dayanağı bulunamadı.</p>}
      <ul className="list teyit-list">
        {report.items.map((item) => (
          <li key={item.key} className={`column teyit-item ${item.status}`}>
            <div className="teyit-head">
              <span className={`dot ${item.status}`} />
              <strong>{KIND_LABEL[item.kind]}</strong>
              <span className="muted small">{TEYIT_LABEL[item.status]}</span>
              {item.deep && <span className="muted small">· Claude</span>}
            </div>
            <span className="quote">“{item.quote}”</span>
            <span className="small">{item.note}</span>
            {item.source && (
              <span className="small muted">
                Kaynak:{' '}
                {item.source.url ? (
                  <a href={item.source.url} target="_blank" rel="noreferrer">
                    {item.source.label}
                  </a>
                ) : (
                  item.source.label
                )}
                {item.source.quote && <em> — “{item.source.quote}”</em>}
              </span>
            )}
            {canAck && needsAck(item) && (
              <label className="ack">
                <input
                  type="checkbox"
                  checked={acks?.includes(item.key) ?? false}
                  onChange={(e) => onAck?.(item.key, e.target.checked)}
                />
                Bu dayanağı kaynağından kontrol ettim
              </label>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ApprovalRecord({ approval }: { approval: NonNullable<PetitionDetail['approval']> }) {
  const s = approval.summary;
  return (
    <div className="approval-record">
      <strong>Onay kaydı</strong>
      <span>
        {s.total} dayanaktan {s.yesil} tanesi kaynağıyla teyit edildi, {s.sari + s.gri} tanesi avukat tarafından tek tek
        kontrol edildi{s.deep ? ' (Claude derin teyidi yapıldı)' : ''}.
      </span>
      <span>
        Av. {approval.reviewer_name} tarafından {approval.created_at} tarihinde onaylandı (sürüm {approval.version}).
      </span>
    </div>
  );
}
