import { useState } from 'react';
import { api, type CaseSummary, type Template } from './api';
import type { Go } from './App';
import { createFromTemplate, useAreas } from './Cases';
import { Card, Empty, ErrorText, Icon, PageHeader, useAsync } from './ui';

export function TemplatesView({ go }: { go: Go }) {
  const areas = useAreas();
  const cases = useAsync(() => api<CaseSummary[]>('/cases'), []);
  const [areaId, setAreaId] = useState<string | null>(null);
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [caseId, setCaseId] = useState('');
  const [query, setQuery] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const template = useAsync(() => (templateId ? api<Template>(`/templates/${templateId}`) : Promise.resolve(null)), [templateId]);

  const q = query.trim().toLocaleLowerCase('tr');
  const visible = areas
    .filter((a) => !areaId || a.id === areaId)
    .map((a) => ({
      ...a,
      templates: a.templates.filter((t) => !q || `${t.title} ${t.description}`.toLocaleLowerCase('tr').includes(q)),
    }))
    .filter((a) => a.templates.length > 0);
  const total = areas.reduce((n, a) => n + a.templates.length, 0);

  async function use() {
    if (!templateId || !caseId) return;
    setBusy(true);
    try {
      const p = await createFromTemplate(Number(caseId), templateId);
      go({ name: 'petition', id: p.id });
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="page">
      <PageHeader title="Dilekçe şablonları" subtitle={`${areas.length} hukuk alanında ${total} hazır dilekçe. Şablonu seçin, dosyaya bağlayın, düzenleyip onaya gönderin.`} />
      <div className="toolbar">
        <label className="search">
          <Icon name="search" />
          <input placeholder="Şablon ara (ör. kıdem, nafaka, tahliye)" value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
      </div>
      <div className="chips">
        <button className={`chip ${areaId === null ? 'active' : ''}`} onClick={() => setAreaId(null)}>
          Tüm alanlar
        </button>
        {areas.map((a) => (
          <button key={a.id} className={`chip ${areaId === a.id ? 'active' : ''}`} onClick={() => setAreaId(a.id)}>
            {a.name} <span className="count">{a.templates.length}</span>
          </button>
        ))}
      </div>

      <div className="grid-main-side">
        <div className="stack">
          {visible.length === 0 && <Empty icon="book">Aramanıza uyan şablon yok.</Empty>}
          {visible.map((a) => (
            <Card key={a.id} title={a.name} className="area-card">
              <p className="muted small">{a.description}</p>
              <div className="template-grid">
                {a.templates.map((t) => (
                  <button key={t.id} className={`template ${templateId === t.id ? 'selected' : ''}`} onClick={() => setTemplateId(t.id)}>
                    <Icon name="file" />
                    <span>
                      <strong>{t.title}</strong>
                      <span>{t.description}</span>
                    </span>
                  </button>
                ))}
              </div>
            </Card>
          ))}
        </div>

        <div className="sticky">
          <Card title={template.data ? template.data.title : 'Önizleme'}>
            {!template.data ? (
              <Empty icon="file">Önizlemek için soldan bir şablon seçin.</Empty>
            ) : (
              <>
                <pre className="preview">{template.data.body}</pre>
                <div className="use-template">
                  <select value={caseId} onChange={(e) => setCaseId(e.target.value)}>
                    <option value="">Hangi dava dosyasına?</option>
                    {cases.data?.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.title}
                      </option>
                    ))}
                  </select>
                  <button className="primary" disabled={!caseId || busy} onClick={use}>
                    {busy ? 'Oluşturuluyor…' : 'Bu şablonla dilekçe oluştur'}
                  </button>
                  {cases.data?.length === 0 && (
                    <p className="muted small">
                      Önce bir{' '}
                      <button className="link" onClick={() => go({ name: 'cases' })}>
                        dava dosyası açın
                      </button>
                      .
                    </p>
                  )}
                  <ErrorText error={err} />
                </div>
              </>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
