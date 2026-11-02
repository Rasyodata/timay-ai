import { useState, type FormEvent } from 'react';
import { api, getServerUrl } from './api';
import { Card, Empty, ErrorText, Field, formatDate, Icon, useAsync } from './ui';

/*
 * Claude bağlantısı (MCP): avukat kendi Claude hesabına Timay'ı "özel bağlayıcı" olarak ekler.
 * Claude sohbette büronun karar arşivinde, Yargıtay'da ve mevzuat kayıtlarında arar; izin verilirse
 * dava dosyalarını okur. Bağlantı adresi bir kez gösterilir, istenince iptal edilir.
 */

interface McpKey {
  id: number;
  user_name: string;
  label: string;
  allow_cases: boolean;
  created_at: string;
  last_used_at: string;
}

export function ClaudeConnect() {
  const keys = useAsync(() => api<McpKey[]>('/mcp-keys'), []);
  const [form, setForm] = useState({ label: 'Claude', allowCases: false });
  const [created, setCreated] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function create(e: FormEvent) {
    e.preventDefault();
    try {
      const r = await api<{ path: string }>('/mcp-keys', { body: form });
      setCreated(`${getServerUrl().replace(/\/$/, '')}${r.path}`);
      setCopied(false);
      setErr(null);
      keys.reload();
    } catch (ex) {
      setErr((ex as Error).message);
    }
  }

  async function revoke(id: number) {
    try {
      await api(`/mcp-keys/${id}`, { method: 'DELETE' });
      keys.reload();
    } catch (ex) {
      setErr((ex as Error).message);
    }
  }

  return (
    <div className="grid-main-side">
      <div>
        <Card title="Timay'ı kendi Claude hesabınıza bağlayın">
          <p>
            Claude ile (claude.ai ya da Claude masaüstü) sohbet ederken Claude, Timay’daki <strong>karar arşivinizde</strong>, <strong>Yargıtay’da</strong> ve{' '}
            <strong>mevzuat kayıtlarınızda</strong> arama yapar, karar metnini okur ve dilekçedeki atıfları denetler. İzin verirseniz dava dosyalarınızı, sürelerinizi ve
            tebligatlarınızı da okur. Claude Timay’da hiçbir şeyi değiştiremez; yalnızca okur.
          </p>
          <ol className="steps">
            <li>Aşağıdan “Bağlantı adresi oluştur”a basın ve adresi kopyalayın.</li>
            <li>
              claude.ai’de <strong>Ayarlar › Bağlayıcılar (Connectors) › Özel bağlayıcı ekle</strong>’ye girin.
            </li>
            <li>Ad olarak “Timay” yazın, adresi yapıştırın ve ekleyin.</li>
            <li>Sohbette araçlar menüsünden Timay’ı açın ve sorunuzu yazın: “Arşivimde işe iade ile ilgili kararları bul”.</li>
          </ol>
          <form className="form-grid" onSubmit={create}>
            <Field label="Bağlantının adı">
              <input value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} placeholder="ör. Claude, dizüstü" />
            </Field>
            <label className="check-line">
              <input type="checkbox" checked={form.allowCases} onChange={(e) => setForm({ ...form, allowCases: e.target.checked })} />
              Dava dosyalarımı, sürelerimi ve tebligatlarımı da okuyabilsin
            </label>
            {form.allowCases && (
              <p className="warning small">
                Dosya bilgileri (müvekkil adları, olaylar, belgeler) sohbet sırasında Claude’a (Anthropic) gönderilir. Müvekkil sırrı ve KVKK yükümlülüklerinizi göz önünde
                bulundurun.
              </p>
            )}
            <div className="form-actions">
              <ErrorText error={err} />
              <button className="primary" type="submit">
                <Icon name="plus" /> Bağlantı adresi oluştur
              </button>
            </div>
          </form>
          {created && (
            <div className="calc-result">
              <span className="muted">Bağlantı adresiniz (yalnızca şimdi gösterilir; şifre gibi saklayın, kimseyle paylaşmayın)</span>
              <code className="mono" style={{ wordBreak: 'break-all' }}>
                {created}
              </code>
              <button
                className="primary"
                onClick={() => {
                  void navigator.clipboard?.writeText(created);
                  setCopied(true);
                }}
              >
                {copied ? 'Kopyalandı' : 'Adresi kopyala'}
              </button>
            </div>
          )}
        </Card>
      </div>
      <Card title="Etkin bağlantılar" className="sticky flush">
        <ErrorText error={keys.error} />
        {keys.data && keys.data.length === 0 ? (
          <Empty icon="spark">Henüz bağlantı yok.</Empty>
        ) : (
          <ul className="items">
            {keys.data?.map((k) => (
              <li key={k.id}>
                <span className="item-text">
                  <strong>{k.label}</strong>
                  <span>
                    {k.user_name} · {k.allow_cases ? 'arşiv + dava dosyaları' : 'yalnız arşiv ve mevzuat'} · oluşturma {formatDate(k.created_at.slice(0, 10))}
                    {k.last_used_at ? ` · son kullanım ${formatDate(k.last_used_at.slice(0, 10))}` : ' · henüz kullanılmadı'}
                  </span>
                </span>
                <button onClick={() => revoke(k.id)}>İptal et</button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
