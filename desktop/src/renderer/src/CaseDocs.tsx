import { useEffect, useState } from 'react';
import { api, type CaseDocument, type ContractDetail, type OpposingDetail } from './api';
import type { Go } from './App';
import { FilePick } from './Clm';
import { DOC_FORMATS, mimeOf, readDocument, toBase64 } from './docread';
import { Card, Empty, ErrorText, Field, formatDate, Icon, useAsync } from './ui';

const KINDS: [string, string][] = [
  ['dilekce', 'Dilekçe'],
  ['karar', 'Karar / ara karar'],
  ['bilirkisi', 'Bilirkişi raporu'],
  ['tutanak', 'Tutanak'],
  ['sozlesme', 'Sözleşme'],
  ['delil', 'Delil'],
  ['diger', 'Diğer'],
];
const KIND_LABEL = Object.fromEntries(KINDS);

function guessKind(name: string) {
  const n = name.toLocaleLowerCase('tr');
  if (/dilek|cevap|replik|düplik|itiraz|istinaf|temyiz/.test(n)) return 'dilekce';
  if (/karar|hüküm|gerekçe/.test(n)) return 'karar';
  if (/bilirki/.test(n)) return 'bilirkisi';
  if (/tutanak|duruşma|celse/.test(n)) return 'tutanak';
  if (/sözleşme|sozlesme|protokol/.test(n)) return 'sozlesme';
  return 'diger';
}

function size(bytes: number) {
  return bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function ext(name: string) {
  return (name.split('.').pop() ?? '').toUpperCase();
}

function blobOf(doc: { fileBase64: string; mime_type: string }) {
  const bin = atob(doc.fileBase64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: doc.mime_type });
}

/** Dava dosyasının belgeleri: UYAP, PDF, Word, TIF ve resimler; yazısı okunur ve aranabilir saklanır. */
export function CaseDocuments({ caseId, go }: { caseId: number; go: Go }) {
  const docs = useAsync(() => api<CaseDocument[]>(`/cases/${caseId}/documents`), [caseId]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [notes, setNotes] = useState<string[]>([]);
  const [openId, setOpenId] = useState<number | null>(null);

  async function upload(file: File) {
    setBusy(true);
    setErr(null);
    try {
      if (file.size > 15 * 1024 * 1024) throw new Error(`${file.name}: dosya 15 MB’tan büyük olamaz.`);
      let text = '';
      let ocr = false;
      try {
        const r = await readDocument(file);
        text = r.text ?? '';
        ocr = Boolean(r.ocr);
      } catch (e) {
        // Yazısı okunamasa da asıl dosya saklanır.
        setNotes((n) => [...n, `${file.name}: yazısı okunamadı (${(e as Error).message}). Dosya yine de eklendi.`]);
      }
      const saved = await api<CaseDocument>(`/cases/${caseId}/documents`, {
        body: {
          fileName: file.name,
          mimeType: file.type || mimeOf(file.name),
          fileBase64: toBase64(await file.arrayBuffer()),
          text,
          ocr,
          kind: guessKind(file.name),
        },
      });
      docs.reload();
      setOpenId(saved.id);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  // Birden çok dosya seçildiğinde sırayla okunur.
  const [queue, setQueue] = useState<File[]>([]);
  useEffect(() => {
    if (busy || queue.length === 0) return;
    const [next, ...rest] = queue;
    setQueue(rest);
    upload(next);
  }, [busy, queue]);

  return (
    <div className="grid-main-side wide-side">
      <Card
        title={`Belgeler (${docs.data?.length ?? 0})`}
        className="flush"
        actions={<FilePick label="Belge ekle" primary multiple busy={busy} onFile={(f) => setQueue((q) => [...q, f])} />}
      >
        <p className="muted small inset-note top">
          {DOC_FORMATS} eklenebilir. Fotoğraf, TIF ve taranmış PDF’lerdeki yazı bilgisayarınızda Türkçe olarak okunur.
          {queue.length > 0 && ` Sırada ${queue.length} dosya var.`}
        </p>
        <ErrorText error={err ?? docs.error} />
        {notes.map((n) => (
          <p key={n} className="warning small inset-note">
            {n}
          </p>
        ))}
        {docs.data?.length === 0 ? (
          <Empty icon="folder">Henüz belge yok. UYAP’tan indirdiğiniz dosyaları, karşı tarafın dilekçelerini ya da müvekkilin gönderdiği fotoğrafları ekleyin.</Empty>
        ) : (
          <ul className="items doc-list">
            {docs.data?.map((d) => (
              <li key={d.id} className={`clickable ${openId === d.id ? 'selected' : ''}`} onClick={() => setOpenId(d.id)}>
                <span className={`file-badge f-${ext(d.file_name).toLowerCase()}`}>{ext(d.file_name)}</span>
                <span className="item-text">
                  <strong>{d.title}</strong>
                  <span>
                    {KIND_LABEL[d.kind] ?? 'Diğer'} · {size(d.size)} · {formatDate(d.created_at)} · {d.created_by_name}
                    {d.ocr ? ' · resimden okundu' : ''}
                    {!d.text_length ? ' · yazısı yok' : ''}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {openId ? (
        <DocumentViewer
          key={openId}
          id={openId}
          caseId={caseId}
          go={go}
          onChanged={docs.reload}
          onDeleted={() => {
            setOpenId(null);
            docs.reload();
          }}
        />
      ) : (
        <Card title="Belge">
          <Empty icon="file">Okumak için bir belge seçin.</Empty>
        </Card>
      )}
    </div>
  );
}

function DocumentViewer({ id, caseId, go, onChanged, onDeleted }: { id: number; caseId: number; go: Go; onChanged: () => void; onDeleted: () => void }) {
  const doc = useAsync(() => api<CaseDocument & { text: string; fileBase64: string }>(`/case-documents/${id}?file=1`), [id]);
  const [text, setText] = useState<string | null>(null);
  const [title, setTitle] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const d = doc.data;

  useEffect(() => {
    if (!d || !/^image\/(jpeg|png|bmp|gif|webp)$/.test(d.mime_type)) return;
    const url = URL.createObjectURL(blobOf(d));
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [d]);

  if (!d) return <Card title="Belge">{doc.error ? <ErrorText error={doc.error} /> : <p className="muted">Açılıyor…</p>}</Card>;
  const body = text ?? d.text;
  const name = title ?? d.title;

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setErr(null);
    try {
      await fn();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function download() {
    const url = URL.createObjectURL(blobOf(d!));
    const a = document.createElement('a');
    a.href = url;
    a.download = d!.file_name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  return (
    <Card
      title={
        <input className="title-input" value={name} onChange={(e) => setTitle(e.target.value)} aria-label="Belge adı" />
      }
      className="doc-viewer"
    >
      <div className="doc-meta">
        <Field label="Tür">
          <select
            value={d.kind}
            onChange={(e) =>
              run(async () => {
                await api(`/case-documents/${id}`, { method: 'PUT', body: { kind: e.target.value } });
                doc.reload();
                onChanged();
              })
            }
          >
            {KINDS.map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
        </Field>
        <span className="muted small">
          {d.file_name} · {size(d.size)}
          {d.ocr ? ' · yazı resimden okundu, kontrol edin' : ''}
        </span>
      </div>
      {preview && <img className="doc-preview" src={preview} alt={d.title} />}
      <Field label={d.ocr ? 'Okunan yazı (düzeltebilirsiniz)' : 'Belge metni'}>
        <textarea rows={16} className="mono" value={body} onChange={(e) => setText(e.target.value)} placeholder="Bu belgede okunabilir yazı bulunamadı." />
      </Field>
      <ErrorText error={err} />
      <div className="form-actions doc-actions">
        <button className="ghost danger" disabled={busy} onClick={() => run(async () => { await api(`/case-documents/${id}`, { method: 'DELETE' }); onDeleted(); })}>
          <Icon name="trash" /> Sil
        </button>
        <button onClick={download}>
          <Icon name="download" /> Asıl dosyayı indir
        </button>
        {(text !== null || title !== null) && (
          <button
            className="primary"
            disabled={busy}
            onClick={() =>
              run(async () => {
                await api(`/case-documents/${id}`, { method: 'PUT', body: { text: body, title: name } });
                setText(null);
                setTitle(null);
                doc.reload();
                onChanged();
              })
            }
          >
            Kaydet
          </button>
        )}
      </div>
      {body.trim() && (
        <div className="doc-send">
          <span className="muted small">Bu belgeyi:</span>
          <button
            disabled={busy}
            onClick={() =>
              run(async () => {
                const o = await api<OpposingDetail>(`/cases/${caseId}/opposing`, { body: { title: name, body } });
                go({ name: 'opposing', id: o.id });
              })
            }
          >
            <Icon name="shield" /> Karşı taraf dilekçesi olarak teyit et
          </button>
          <button
            disabled={busy}
            onClick={() =>
              run(async () => {
                const c = await api<ContractDetail>('/contracts', { body: { title: name, kind: 'kat-karsiligi', caseId } });
                await api(`/contracts/${c.id}/side`, { method: 'PUT', body: { side: 'arsa_sahibi' } });
                await api(`/contracts/${c.id}/versions`, { body: { text: body, fileName: d.file_name, source: 'karsi' } });
                go({ name: 'contract', id: c.id });
              })
            }
          >
            <Icon name="contract" /> Sözleşme incelemesine gönder
          </button>
        </div>
      )}
    </Card>
  );
}
