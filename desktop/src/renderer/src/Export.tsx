import { useState } from 'react';
import { api } from './api';
import { Icon } from './ui';

/** Metni UYAP (.udf) ya da Word (.docx) olarak indirir. */
export function downloadBase64(fileName: string, base64: string, type: string) {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

const TYPES = { udf: 'application/octet-stream', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' };

export function ExportButtons({ title, body }: { title: string; body: string }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  async function run(format: 'udf' | 'docx') {
    setBusy(format);
    setErr(null);
    try {
      const r = await api<{ fileName: string; base64: string }>('/export', { body: { format, title, body } });
      downloadBase64(r.fileName, r.base64, TYPES[format]);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  }
  return (
    <>
      <button onClick={() => run('udf')} disabled={Boolean(busy) || !body.trim()} title="UYAP Doküman Editörü ile açılır; UYAP'a doğrudan yüklenebilir">
        <Icon name="download" /> UYAP (UDF)
      </button>
      <button onClick={() => run('docx')} disabled={Boolean(busy) || !body.trim()}>
        <Icon name="download" /> Word
      </button>
      {err && <span className="error small">{err}</span>}
    </>
  );
}
