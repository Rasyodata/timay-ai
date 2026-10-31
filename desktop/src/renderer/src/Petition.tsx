import { useEffect, useState } from 'react';
import { ExportButtons } from './Export';
import { api, type ApiError, type OpposingDetail, type PetitionDetail, type User } from './api';
import { DisciplineScreen } from './Disciplines';
import { ApprovalRecord, HighlightedText, needsAck, TeyitPanel } from './Teyit';
import { ErrorText, Icon, PageHeader, StatusBadge, useAsync } from './ui';

export function OpposingView({ id, back }: { id: number; back: (caseId: number) => void }) {
  const { data, error, setData } = useAsync(() => api<OpposingDetail>(`/opposing/${id}`), [id]);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [disc, setDisc] = useState(false);

  if (!data) return <ErrorText error={error} />;

  async function deep() {
    setBusy(true);
    setActionError(null);
    try {
      setData(await api<OpposingDetail>(`/opposing/${id}/teyit/deep`, { body: {} }));
    } catch (err) {
      setActionError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page">
      <PageHeader back={() => back(data.case_id)} title={data.title} subtitle="Karşı taraf dilekçesi" actions={<span className="badge">Karşı taraf</span>} />
      {disc && <DisciplineScreen body={data.body} title={data.title} caseId={data.case_id} onClose={() => setDisc(false)} />}
      <div className="two-col wide-left">
        <div className="card">
          <HighlightedText body={data.body} items={data.teyit.items} />
        </div>
        <div className="card">
          <p className="muted small">Kırmızı dayanaklar karşı tarafın dilekçesinde doğrulanamayan noktalardır; cevabınızda kullanabilirsiniz.</p>
          <button onClick={() => setDisc(true)}>
            <Icon name="shield" /> 8 disiplinle incele
          </button>
          <TeyitPanel report={data.teyit} onDeep={deep} deepBusy={busy} />
          <ErrorText error={actionError} />
        </div>
      </div>
    </div>
  );
}

export function PetitionView({ id, user, back, autoReview }: { id: number; user: User; back: (caseId: number) => void; autoReview?: boolean }) {
  const { data, error, setData } = useAsync(() => api<PetitionDetail>(`/petitions/${id}`), [id]);
  const [body, setBody] = useState('');
  const [comment, setComment] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [colored, setColored] = useState(false);
  const [disc, setDisc] = useState<null | 'view' | 'submit'>(autoReview ? 'view' : null);

  useEffect(() => {
    if (data) setBody(data.body);
  }, [data?.id, data?.version]);

  if (!data) return <ErrorText error={error} />;

  const editable = data.status === 'taslak' || data.status === 'duzeltme';
  const dirty = body !== data.body;
  const isWriter = data.author_id === user.id || data.versions.some((v) => v.created_by === user.id);
  const canReview = data.status === 'incelemede' && user.role === 'avukat' && !isWriter;

  const unacked = data.teyit.items.filter((i) => needsAck(i) && !data.acks.includes(i.key)).length;

  async function run(path: string, payload?: unknown) {
    setActionError(null);
    setBusy(path);
    try {
      setData(await api<PetitionDetail>(`/petitions/${id}${path}`, { body: payload ?? {} }));
      if (path === '/review') setComment('');
    } catch (err) {
      const e = err as ApiError;
      setActionError(e.message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="page">
      <PageHeader
        back={() => back(data.case_id)}
        title={data.title}
        subtitle={`Sürüm ${data.version}`}
        actions={<StatusBadge status={data.status} />}
      />
      {disc && (
        <DisciplineScreen
          body={editable ? body : data.body}
          title={data.title}
          caseId={data.case_id}
          onClose={() => setDisc(null)}
          onContinue={disc === 'submit' ? () => { setDisc(null); run('/submit'); } : undefined}
          continueLabel="İncelemeye gönder"
        />
      )}
      <div className="two-col wide-left">
        <div className="card">
          {editable && !colored ? (
            <textarea className="editor" value={body} onChange={(e) => setBody(e.target.value)} />
          ) : (
            <HighlightedText body={editable ? body : data.body} items={data.teyit.items} />
          )}
          <div className="row">
            {editable && (
              <button onClick={() => setColored(!colored)} disabled={dirty && !colored} title={dirty ? 'Önce kaydedin' : ''}>
                {colored ? 'Düzenlemeye dön' : 'Renkli görünüm'}
              </button>
            )}
            {editable && (
              <button disabled={!dirty} onClick={() => run('/versions', { body })}>
                Yeni sürüm olarak kaydet
              </button>
            )}
            <button onClick={() => setDisc('view')}>
              <Icon name="shield" /> 8 disiplinle incele
            </button>
            <ExportButtons title={data.title} body={editable ? body : data.body} />
            {editable && (
              <button className="primary" disabled={dirty} onClick={() => setDisc('submit')} title={dirty ? 'Önce kaydedin' : ''}>
                İncelemeye gönder
              </button>
            )}
          </div>
          {canReview && (
            <div className="review">
              <textarea rows={3} placeholder="İnceleme notu (düzeltme isterken zorunlu)" value={comment} onChange={(e) => setComment(e.target.value)} />
              <div className="row">
                <button
                  className="primary"
                  disabled={unacked > 0 || busy !== null}
                  onClick={() => run('/review', { action: 'approve', comment })}
                  title={unacked > 0 ? 'Önce sarı ve gri dayanakları işaretleyin' : ''}
                >
                  Onayla
                </button>
                <button onClick={() => run('/review', { action: 'request_changes', comment })}>Düzeltme iste</button>
                {unacked > 0 && <span className="muted small">Onay için {unacked} dayanağı işaretleyin.</span>}
              </div>
            </div>
          )}
          {data.status === 'incelemede' && isWriter && (
            <p className="muted small">Dilekçe incelemede. Yazan dışında bir avukatın onayı bekleniyor.</p>
          )}
          {data.status === 'onayli' && data.approval && <ApprovalRecord approval={data.approval} />}
          <ErrorText error={actionError} />
        </div>
        <div className="card">
          {dirty && <p className="muted small">Teyit raporu son kaydedilen sürüme aittir.</p>}
          <TeyitPanel
            report={data.teyit}
            acks={data.acks}
            canAck={canReview}
            onAck={(key, checked) => run('/teyit/ack', { key, checked })}
            onDeep={() => run('/teyit/deep')}
            deepBusy={busy === '/teyit/deep'}
          />
          <h3>İnceleme geçmişi</h3>
          {data.reviews.length === 0 && <p className="muted small">Henüz inceleme yok.</p>}
          <ul className="list">
            {data.reviews.map((r, i) => (
              <li key={i} className="column">
                <strong>
                  {r.reviewer_name}: {r.action === 'approve' ? 'onayladı' : 'düzeltme istedi'} (sürüm {r.version})
                </strong>
                {r.comment && <span>{r.comment}</span>}
                <span className="muted small">{r.created_at}</span>
              </li>
            ))}
          </ul>
          <h3>Sürümler</h3>
          <ul className="list">
            {data.versions.map((v) => (
              <li key={v.version}>
                <span>Sürüm {v.version}</span>
                <span className="muted small">
                  {v.created_by_name}, {v.created_at}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
