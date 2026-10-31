import { api, STATUS_LABEL, type Dashboard, type Risk, type User } from './api';
import type { Go } from './App';
import { riskLink } from './Deadlines';
import { RefreshAllButton } from './Refresh';
import { Card, DueLabel, Empty, ErrorText, formatDate, formatTL, PageHeader, Stat, useAsync } from './ui';

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Günaydın' : h < 18 ? 'İyi günler' : 'İyi akşamlar';
}

export function DashboardView({ user, go }: { user: User; go: Go }) {
  const { data, error } = useAsync(() => api<Dashboard>('/dashboard'), []);
  const risks = useAsync(() => api<Risk[]>('/risks'), []).data ?? [];
  const urgent = risks.filter((r) => r.level === 'yuksek');
  const dateText = new Date().toLocaleDateString('tr-TR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  return (
    <div className="page">
      <PageHeader
        title={`${greeting()}, ${user.name.split(' ')[0]}`}
        subtitle={dateText}
        actions={
          <>
            <RefreshAllButton go={go} />
            <button onClick={() => go({ name: 'templates' })}>Şablondan dilekçe</button>
            <button className="primary" onClick={() => go({ name: 'cases' })}>
              Yeni dava dosyası
            </button>
          </>
        }
      />
      <ErrorText error={error} />
      {data && (
        <>
          {urgent.length > 0 && (
            <Card
              title={`Acil risk uyarıları (${urgent.length})`}
              className="alert-card"
              actions={<button className="link" onClick={() => go({ name: 'deadlines' })}>Tümünü gör</button>}
            >
              <ul className="items">
                {urgent.slice(0, 4).map((r, i) => {
                  const to = riskLink(r);
                  return (
                    <li key={i} className={to ? 'clickable' : ''} onClick={() => to && go(to)}>
                      <span className="risk-dot yuksek" />
                      <span className="tag">{r.area}</span>
                      <span className="item-text">
                        <strong>{r.title}</strong>
                        <span>{r.detail}</span>
                      </span>
                    </li>
                  );
                })}
              </ul>
            </Card>
          )}
          <div className="stats">
            <Stat icon="folder" label="Açık dava dosyası" value={data.counts.openCases} onClick={() => go({ name: 'cases' })} />
            <Stat icon="clock" label="Onay bekleyen dilekçe" value={data.counts.inReview} tone="amber" />
            <Stat icon="check" label="Onaylı dilekçe" value={data.counts.approved} tone="green" />
            <Stat icon="contract" label="Yürürlükteki sözleşme" value={data.counts.activeContracts} tone="violet" onClick={() => go({ name: 'contracts' })} />
            <Stat icon="gavel" label="Açık icra takibi" value={data.counts.openEnforcement} tone="red" onClick={() => go({ name: 'enforcement' })} />
{!data.month.hidden && (
            <Stat
              icon="trend"
              label="Bu ay kâr"
              value={formatTL(data.month.profit)}
              tone={data.month.profit >= 0 ? 'green' : 'red'}
              onClick={() => go({ name: 'finance' })}
            />
            )}
          </div>

          <div className="grid-3">
            <Card title="Yaklaşan duruşmalar" actions={<button className="link" onClick={() => go({ name: 'agenda' })}>Ajanda</button>}>
              {data.hearings.length === 0 ? (
                <Empty icon="calendar">Önümüzdeki 30 günde duruşma yok.</Empty>
              ) : (
                <ul className="items">
                  {data.hearings.map((h) => (
                    <li key={h.id} className="clickable" onClick={() => go({ name: 'case', id: h.case_id, tab: 'durusmalar' })}>
                      <span className="date-chip">
                        <strong>{formatDate(h.date).slice(0, 5)}</strong>
                        <span>{h.time || '—'}</span>
                      </span>
                      <span className="item-text">
                        <strong>{h.case_title}</strong>
                        <span>{[h.case_court, h.place].filter(Boolean).join(' · ')}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card title="Onayınızı bekleyenler">
              {data.toReview.length === 0 && data.contractsToReview.length === 0 ? (
                <Empty icon="check">Onayınızı bekleyen dilekçe ya da sözleşme yok.</Empty>
              ) : (
                <ul className="items">
                  {data.toReview.map((p) => (
                    <li key={p.id} className="clickable" onClick={() => go({ name: 'petition', id: p.id })}>
                      <span className="item-text">
                        <strong>{p.title}</strong>
                        <span>
                          {p.case_title} · yazan {p.author_name}
                        </span>
                      </span>
                      <span className="badge incelemede">İncele</span>
                    </li>
                  ))}
                  {data.contractsToReview.map((c) => (
                    <li key={`c${c.id}`} className="clickable" onClick={() => go({ name: 'contract', id: c.id })}>
                      <span className="item-text">
                        <strong>{c.title}</strong>
                        <span>Sözleşme · gönderen {c.author_name}</span>
                      </span>
                      <span className="badge incelemede">İncele</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card title="Görevlerim" actions={<button className="link" onClick={() => go({ name: 'tasks' })}>Tümü</button>}>
              {data.tasks.length === 0 ? (
                <Empty icon="check">Açık göreviniz yok.</Empty>
              ) : (
                <ul className="items">
                  {data.tasks.map((t) => (
                    <li key={t.id} className="clickable" onClick={() => go({ name: 'tasks' })}>
                      <span className="item-text">
                        <strong>{t.title}</strong>
                        <span>{[t.case_title, `veren: ${t.created_by_name}`].filter(Boolean).join(' · ')}</span>
                      </span>
                      <DueLabel date={t.due_date} />
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>

          <div className="grid-3">
            <Card title="Taslaklarım">
              {data.myDrafts.length === 0 ? (
                <Empty icon="file">Üzerinde çalıştığınız dilekçe yok.</Empty>
              ) : (
                <ul className="items">
                  {data.myDrafts.map((p) => (
                    <li key={p.id} className="clickable" onClick={() => go({ name: 'petition', id: p.id })}>
                      <span className="item-text">
                        <strong>{p.title}</strong>
                        <span>{p.case_title}</span>
                      </span>
                      <span className={`badge ${p.status}`}>{STATUS_LABEL[p.status]}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card title="Sözleşme takvimi">
              {data.deadlines.length === 0 && data.expiring.length === 0 ? (
                <Empty icon="contract">Yaklaşan taahhüt ya da bitiş yok.</Empty>
              ) : (
                <ul className="items">
                  {data.deadlines.map((d) => (
                    <li key={`o${d.id}`} className="clickable" onClick={() => go({ name: 'contract', id: d.contract_id })}>
                      <span className="item-text">
                        <strong>{d.contract_title}</strong>
                        <span>
                          {d.text}
                          {d.amount_kurus > 0 && ` · ${formatTL(d.amount_kurus)}`}
                        </span>
                      </span>
                      <DueLabel date={d.due_date} />
                    </li>
                  ))}
                  {data.expiring.map((c) => (
                    <li key={`c${c.id}`} className="clickable" onClick={() => go({ name: 'contract', id: c.id })}>
                      <span className="item-text">
                        <strong>{c.title}</strong>
                        <span>Sözleşme sona eriyor</span>
                      </span>
                      <DueLabel date={c.end_date} />
                    </li>
                  ))}
                </ul>
              )}
            </Card>

{!data.month.hidden && (
            <Card title="Bu ay" actions={<button className="link" onClick={() => go({ name: 'finance' })}>Muhasebe</button>}>
              <dl className="money">
                <div>
                  <dt>Gelir</dt>
                  <dd className="ok">{formatTL(data.month.income)}</dd>
                </div>
                <div>
                  <dt>Gider</dt>
                  <dd className="bad">{formatTL(data.month.expense)}</dd>
                </div>
                <div className="total">
                  <dt>Kâr</dt>
                  <dd>{formatTL(data.month.profit)}</dd>
                </div>
              </dl>
            </Card>
            )}
          </div>
        </>
      )}
    </div>
  );
}
