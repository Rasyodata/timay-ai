import { useState, type FormEvent } from 'react';
import { api, RELATION_LABEL, type CaseSummary, type EstateDetail, type EstateSummary } from './api';
import type { Go } from './App';
import { Card, DueLabel, Empty, ErrorText, Field, formatDate, formatTL, Icon, PageHeader, Stat, useAsync } from './ui';

const SIDE_LABEL: Record<string, string> = { iki: 'ana-baba bir', anne: 'anne bir', baba: 'baba bir', '': '' };
const ASSET_CATEGORIES = ['Taşınmaz', 'Araç', 'Banka hesabı', 'Hisse / fon', 'Şirket payı', 'Alacak', 'Diğer'];
const DEBT_CATEGORIES = ['Kredi', 'Vergi', 'Kişisel borç', 'Cenaze giderleri', 'Diğer'];

function frac([n, d]: [number, number]) {
  return n === 0 ? '—' : d === 1 ? 'Tamamı' : `${n}/${d}`;
}

function pct([n, d]: [number, number]) {
  return n === 0 ? '' : `%${((n / d) * 100).toLocaleString('tr-TR', { maximumFractionDigits: 2 })}`;
}

export function EstatesView({ go }: { go: Go }) {
  const list = useAsync(() => api<EstateSummary[]>('/estates'), []);
  const cases = useAsync(() => api<CaseSummary[]>('/cases'), []);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ deceased: '', deathDate: '', client: '', caseId: '' });
  const [err, setErr] = useState<string | null>(null);

  async function create(e: FormEvent) {
    e.preventDefault();
    try {
      const d = await api<EstateDetail>('/estates', { body: { ...form, caseId: form.caseId ? Number(form.caseId) : null } });
      go({ name: 'estate', id: d.id });
    } catch (ex) {
      setErr((ex as Error).message);
    }
  }

  return (
    <div className="page">
      <PageHeader
        title="Miras yönetimi"
        subtitle="Mirasçılık payları, saklı paylar, tereke ve miras süreleri"
        actions={
          <button className="primary" onClick={() => setCreating(true)}>
            <Icon name="plus" /> Yeni miras dosyası
          </button>
        }
      />
      <ErrorText error={list.error} />
      {creating && (
        <Card title="Yeni miras dosyası" actions={<button className="ghost" onClick={() => setCreating(false)}>Kapat</button>}>
          <form className="form-grid" onSubmit={create}>
            <Field label="Murisin (ölen kişinin) adı">
              <input value={form.deceased} onChange={(e) => setForm({ ...form, deceased: e.target.value })} required />
            </Field>
            <Field label="Ölüm tarihi">
              <input type="date" value={form.deathDate} onChange={(e) => setForm({ ...form, deathDate: e.target.value })} />
            </Field>
            <Field label="Müvekkil">
              <input value={form.client} onChange={(e) => setForm({ ...form, client: e.target.value })} />
            </Field>
            <Field label="İlgili dava dosyası">
              <select value={form.caseId} onChange={(e) => setForm({ ...form, caseId: e.target.value })}>
                <option value="">—</option>
                {cases.data?.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title}
                  </option>
                ))}
              </select>
            </Field>
            <div className="form-actions">
              <ErrorText error={err} />
              <button className="primary" type="submit">
                Dosyayı aç
              </button>
            </div>
          </form>
        </Card>
      )}
      <Card className="flush">
        {!list.data?.length ? (
          <Empty icon="tree">Henüz miras dosyası yok. Murisi, mirasçıları ve tereke kalemlerini girin; paylar kendiliğinden hesaplanır.</Empty>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Muris</th>
                <th>Ölüm tarihi</th>
                <th>Müvekkil</th>
                <th>Mirasçı</th>
                <th className="num">Net tereke</th>
                <th>Dava dosyası</th>
              </tr>
            </thead>
            <tbody>
              {list.data.map((e) => (
                <tr key={e.id} className="clickable" onClick={() => go({ name: 'estate', id: e.id })}>
                  <td>
                    <strong>{e.deceased}</strong>
                  </td>
                  <td>{formatDate(e.death_date) || '—'}</td>
                  <td>{e.client || '—'}</td>
                  <td>{e.heir_count}</td>
                  <td className={`num ${e.net_kurus < 0 ? 'bad-text' : ''}`}>{formatTL(e.net_kurus)}</td>
                  <td className="muted">{e.case_title ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}

export function EstateView({ id, go }: { id: number; go: Go }) {
  const { data, error, setData } = useAsync(() => api<EstateDetail>(`/estates/${id}`), [id]);
  const [heir, setHeir] = useState({ name: '', relation: 'cocuk', alive: true, parentId: '', side: 'iki' });
  const [item, setItem] = useState({ kind: 'varlik' as 'varlik' | 'borc', category: 'Taşınmaz', title: '', value: '' });
  const [err, setErr] = useState<string | null>(null);
  const [added, setAdded] = useState<string[]>([]);

  if (!data) return <ErrorText error={error} />;

  async function call(path: string, body?: unknown, method?: string) {
    try {
      setData(await api<EstateDetail>(path, { body, method }));
      setErr(null);
      return true;
    } catch (ex) {
      setErr((ex as Error).message);
      return false;
    }
  }

  async function addHeir(e: FormEvent) {
    e.preventDefault();
    const ok = await call(`/estates/${id}/heirs`, { ...heir, parentId: heir.parentId ? Number(heir.parentId) : null });
    if (ok) setHeir({ ...heir, name: '' });
  }

  async function addItem(e: FormEvent) {
    e.preventDefault();
    if (await call(`/estates/${id}/items`, item)) setItem({ ...item, title: '', value: '' });
  }

  async function toAgenda(d: EstateDetail['deadlines'][number]) {
    try {
      await api('/agenda', { body: { date: d.date, title: `${d.title}: ${data!.deceased}`, note: d.note, caseId: data!.case_id } });
      setAdded([...added, d.title]);
    } catch (ex) {
      setErr((ex as Error).message);
    }
  }

  const children = data.heirs.filter((h) => h.relation === 'cocuk');
  const shareOf = (heirId: number) => data.shares.find((s) => s.id === heirId)!;
  const parentName = (pid: number | null) => data.heirs.find((h) => h.id === pid)?.name;

  return (
    <div className="page">
      <PageHeader
        back={() => go({ name: 'estates' })}
        title={`${data.deceased} mirası`}
        subtitle={[data.death_date && `Ölüm: ${formatDate(data.death_date)}`, data.client && `Müvekkil: ${data.client}`, data.case_title].filter(Boolean).join(' · ')}
      />
      <div className="stats">
        <Stat icon="wallet" label="Tereke varlıkları" value={formatTL(data.totals.assets)} tone="green" />
        <Stat icon="alert" label="Tereke borçları" value={formatTL(data.totals.debts)} tone="red" />
        <Stat icon="check" label="Net tereke" value={formatTL(data.totals.net)} tone={data.totals.net >= 0 ? 'violet' : 'red'} />
        <Stat icon="users" label="Mirasçı" value={data.heirs.filter((h) => h.alive).length} tone="amber" />
      </div>
      <ErrorText error={err} />
      {data.warnings.map((w) => (
        <p key={w} className="warning">
          <Icon name="alert" /> {w}
        </p>
      ))}

      <div className="grid-main-side">
        <div className="stack">
          <Card title="Mirasçılar ve paylar" className="flush" actions={data.group && <span className="tag">{data.group}</span>}>
            {data.heirs.length === 0 ? (
              <Empty icon="users">Mirasçıları sağdaki formdan ekleyin. Vefat etmiş çocukları da ekleyin; payları torunlara geçer.</Empty>
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>Mirasçı</th>
                    <th>Yakınlık</th>
                    <th className="num">Yasal pay</th>
                    <th className="num">Tutar</th>
                    <th className="num">Saklı pay</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {data.heirs.map((h) => {
                    const s = shareOf(h.id);
                    return (
                      <tr key={h.id} className={h.alive ? '' : 'done'}>
                        <td>
                          <strong>{h.name}</strong>
                          {s.note && <div className="muted small">{s.note}</div>}
                        </td>
                        <td>
                          {RELATION_LABEL[h.relation]}
                          {h.relation === 'torun' && <div className="muted small">{parentName(h.parent_id)} yoluyla</div>}
                          {h.relation === 'kardes' && h.side && <div className="muted small">{SIDE_LABEL[h.side]}</div>}
                        </td>
                        <td className="num">
                          <strong>{frac(s.share)}</strong>
                          <div className="muted small">{pct(s.share)}</div>
                        </td>
                        <td className="num">{s.amount_kurus ? formatTL(s.amount_kurus) : '—'}</td>
                        <td className="num">
                          {frac(s.reserved)}
                          {s.reserved_kurus > 0 && <div className="muted small">{formatTL(s.reserved_kurus)}</div>}
                        </td>
                        <td>
                          <label className="ack" title="Sağ mı?">
                            <input type="checkbox" checked={Boolean(h.alive)} onChange={(e) => call(`/heirs/${h.id}`, { alive: e.target.checked }, 'PUT')} />
                            Sağ
                          </label>
                          <button className="ghost" title="Sil" onClick={() => call(`/heirs/${h.id}`, undefined, 'DELETE')}>
                            ×
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
            <p className="muted small inset-note">
              Paylar TMK 495-499'a, saklı paylar TMK 506'ya göre hesaplanır. Vasiyetname, mirastan feragat ve evlatlık gibi özel durumları ayrıca kontrol edin.
            </p>
          </Card>

          <Card title="Tereke" className="flush">
            {data.items.length === 0 ? (
              <Empty icon="wallet">Varlık ve borçları ekleyin; net tereke ve her mirasçının tutarı hesaplanır.</Empty>
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>Kalem</th>
                    <th>Tür</th>
                    <th className="num">Değer</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((i) => (
                    <tr key={i.id}>
                      <td>
                        <strong>{i.title}</strong>
                        {i.category && <div className="muted small">{i.category}</div>}
                      </td>
                      <td>
                        <span className={`tag ${i.kind === 'varlik' ? 'gelir' : 'gider'}`}>{i.kind === 'varlik' ? 'Varlık' : 'Borç'}</span>
                      </td>
                      <td className={`num ${i.kind === 'borc' ? 'bad-text' : ''}`}>
                        {i.kind === 'borc' && '−'}
                        {formatTL(i.value_kurus)}
                      </td>
                      <td>
                        <button className="ghost" title="Sil" onClick={() => call(`/estate-items/${i.id}`, undefined, 'DELETE')}>
                          ×
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>

          <Card title="Miras süreleri">
            {data.deadlines.length === 0 ? (
              <Empty icon="clock">Süreleri görmek için ölüm tarihini girin.</Empty>
            ) : (
              <ul className="items">
                {data.deadlines.map((d) => (
                  <li key={d.title}>
                    <span className="item-text">
                      <strong>{d.title}</strong>
                      <span>{d.note}</span>
                    </span>
                    <DueLabel date={d.date} />
                    {added.includes(d.title) ? (
                      <span className="badge onayli">Ajandada</span>
                    ) : (
                      <button className="link" onClick={() => toAgenda(d)}>
                        Ajandaya ekle
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="stack">
          <Card title="Mirasçı ekle">
            <form className="form-grid" onSubmit={addHeir}>
              <Field label="Ad soyad" wide>
                <input value={heir.name} onChange={(e) => setHeir({ ...heir, name: e.target.value })} required />
              </Field>
              <Field label="Yakınlık">
                <select value={heir.relation} onChange={(e) => setHeir({ ...heir, relation: e.target.value })}>
                  {Object.entries(RELATION_LABEL).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Durum">
                <select value={heir.alive ? '1' : '0'} onChange={(e) => setHeir({ ...heir, alive: e.target.value === '1' })}>
                  <option value="1">Sağ</option>
                  <option value="0">Muristen önce vefat</option>
                </select>
              </Field>
              {heir.relation === 'torun' && (
                <Field label="Hangi çocuğun çocuğu" wide>
                  <select value={heir.parentId} onChange={(e) => setHeir({ ...heir, parentId: e.target.value })} required>
                    <option value="">Seçin</option>
                    {children.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </Field>
              )}
              {heir.relation === 'kardes' && (
                <Field label="Kardeşlik" wide>
                  <select value={heir.side} onChange={(e) => setHeir({ ...heir, side: e.target.value })}>
                    <option value="iki">Ana-baba bir (tam kardeş)</option>
                    <option value="anne">Yalnız anne bir</option>
                    <option value="baba">Yalnız baba bir</option>
                  </select>
                </Field>
              )}
              <div className="form-actions">
                <button className="primary" type="submit">
                  <Icon name="plus" /> Ekle
                </button>
              </div>
            </form>
          </Card>
          <Card title="Tereke kalemi ekle">
            <div className="segmented">
              <button type="button" className={item.kind === 'varlik' ? 'active' : ''} onClick={() => setItem({ ...item, kind: 'varlik', category: ASSET_CATEGORIES[0] })}>
                Varlık
              </button>
              <button type="button" className={item.kind === 'borc' ? 'active' : ''} onClick={() => setItem({ ...item, kind: 'borc', category: DEBT_CATEGORIES[0] })}>
                Borç
              </button>
            </div>
            <form className="form-grid" onSubmit={addItem}>
              <Field label="Açıklama" wide>
                <input value={item.title} onChange={(e) => setItem({ ...item, title: e.target.value })} placeholder="ör. Kadıköy daire, 3 ada 15 parsel" required />
              </Field>
              <Field label="Tür">
                <select value={item.category} onChange={(e) => setItem({ ...item, category: e.target.value })}>
                  {(item.kind === 'varlik' ? ASSET_CATEGORIES : DEBT_CATEGORIES).map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </Field>
              <Field label="Değer (TL)">
                <input value={item.value} onChange={(e) => setItem({ ...item, value: e.target.value })} inputMode="decimal" />
              </Field>
              <div className="form-actions">
                <button className="primary" type="submit">
                  <Icon name="plus" /> Ekle
                </button>
              </div>
            </form>
          </Card>
        </div>
      </div>
    </div>
  );
}
