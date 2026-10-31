import type { User } from './auth.ts';
import type { DB } from './db.ts';
import { createFile, ENFORCEMENT_KINDS, ENFORCEMENT_STATUSES, listFiles, updateFile } from './enforcement.ts';
import { ApiError } from './errors.ts';
import { readXlsx } from './files.ts';
import { DATE, toKurus } from './money.ts';

/*
 * İcra büroları için: borçlu sorguları (UYAP'ta yapılan SGK, araç, tapu, banka… sorgularının kaydı ve
 * sonuca göre haciz önerisi), Excel/CSV'den toplu dosya açma ve güncelleme, Excel'e dışa aktarma.
 * UYAP'ın herkese açık bir arayüzü olmadığı için sorgular avukatın kendi UYAP oturumunda yapılır.
 */

export const QUERY_KINDS = [
  { key: 'mernis', label: 'Mernis adres', hint: 'Adres bulunursa tebligatı bu adrese çıkarın (Tebligat K. 21/2).', action: 'tebligat' },
  { key: 'sgk', label: 'SGK (işyeri / emeklilik)', hint: 'Çalıştığı işyeri bulunursa maaş haczi müzekkeresi yazın (İİK 83, 355).', action: 'maas_haczi' },
  { key: 'egm', label: 'Araç (EGM)', hint: 'Araç kaydı varsa araç kaydına haciz şerhi ve yakalama talep edin.', action: 'arac_haczi' },
  { key: 'tapu', label: 'Taşınmaz (TAKBİS)', hint: 'Taşınmaz varsa tapu kaydına haciz şerhi koydurun.', action: 'tapu_haczi' },
  { key: 'banka', label: 'Banka hesapları', hint: 'Hesap varsa banka haczi / 89/1 haciz ihbarnamesi gönderin.', action: 'banka_haczi' },
  { key: 'gib', label: 'GİB (vergi / işyeri)', hint: 'Vergi kaydı ve işyeri adresi varsa işyerinde haciz yapılabilir.', action: 'haciz' },
  { key: 'gsm', label: 'GSM operatörleri', hint: 'Kayıtlı adresler tebligat ve haciz için kullanılabilir.', action: '' },
  { key: 'alacakli_dosya', label: 'Alacaklı olduğu dosyalar', hint: 'Borçlunun alacaklı olduğu dosyalara haciz koydurun (İİK 89).', action: 'haciz' },
  { key: 'posta_ceki', label: 'Posta çeki', hint: 'Hesap varsa haciz yazısı gönderin.', action: 'banka_haczi' },
  { key: 'dis_isleri', label: 'Dış İşleri (yurt dışı adres)', hint: 'Yurt dışı adresine tebligat için kullanılır.', action: '' },
  { key: 'iski', label: 'Su / elektrik aboneliği', hint: 'Abonelik adresi tebligat ve haciz için kullanılabilir.', action: '' },
] as const;

const KIND_KEYS: string[] = QUERY_KINDS.map((k) => k.key);
/** Bu kadar günden eski sorgu yenilenmeli. */
const STALE_DAYS = 90;

function ownFile(db: DB, user: User, fileId: number) {
  const f = db.prepare('SELECT id, debtor FROM enforcement_files WHERE id = ? AND office_id = ?').get(fileId, user.office_id) as { id: number; debtor: string } | undefined;
  if (!f) throw new ApiError(404, 'İcra dosyası bulunamadı.');
  return f;
}

export function listQueries(db: DB, user: User, fileId: number, today = new Date().toISOString().slice(0, 10)) {
  ownFile(db, user, fileId);
  const rows = db
    .prepare(
      `SELECT q.id, q.kind, q.date, q.found, q.result, u.name AS created_by_name FROM enforcement_queries q JOIN users u ON u.id = q.created_by
       WHERE q.file_id = ? ORDER BY q.date DESC, q.id DESC`,
    )
    .all(fileId) as { id: number; kind: string; date: string; found: number; result: string; created_by_name: string }[];
  const actions = new Set((db.prepare('SELECT action FROM enforcement_actions WHERE file_id = ?').all(fileId) as { action: string }[]).map((a) => a.action));
  const age = (d: string) => Math.floor((Date.parse(today) - Date.parse(d)) / 86_400_000);
  const kinds = QUERY_KINDS.map((k) => {
    const last = rows.find((r) => r.kind === k.key) ?? null;
    const stale = !last || age(last.date) > STALE_DAYS;
    // Sorgu bir şey bulduysa ve ilgili haciz yapılmadıysa öneri çıkar.
    const suggest = last?.found && k.action && !actions.has(k.action) ? k.hint : '';
    return { ...k, last, stale, age: last ? age(last.date) : null, suggest };
  });
  return { kinds, history: rows };
}

export function addQuery(db: DB, user: User, fileId: number, input: { kind?: string; date?: string; found?: boolean; result?: string }) {
  ownFile(db, user, fileId);
  if (!KIND_KEYS.includes(String(input.kind))) throw new ApiError(400, 'Geçersiz sorgu türü.');
  const date = input.date || new Date().toISOString().slice(0, 10);
  if (!DATE.test(date)) throw new ApiError(400, 'Tarih YYYY-AA-GG biçiminde olmalı.');
  db.prepare('INSERT INTO enforcement_queries (office_id, file_id, kind, date, found, result, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
    user.office_id,
    fileId,
    input.kind,
    date,
    input.found ? 1 : 0,
    String(input.result ?? '').trim(),
    user.id,
  );
  return listQueries(db, user, fileId);
}

export function deleteQuery(db: DB, user: User, id: number) {
  const q = db.prepare('SELECT file_id FROM enforcement_queries WHERE id = ? AND office_id = ?').get(id, user.office_id) as { file_id: number } | undefined;
  if (!q) throw new ApiError(404, 'Sorgu bulunamadı.');
  db.prepare('DELETE FROM enforcement_queries WHERE id = ?').run(id);
  return listQueries(db, user, q.file_id);
}

/** Bütün açık dosyalarda sorgu durumu: hiç sorgulanmamış ya da sorgusu eskimiş dosyalar. */
export function queryOverview(db: DB, user: User, today = new Date().toISOString().slice(0, 10)) {
  const rows = db
    .prepare(
      `SELECT f.id, f.debtor, f.file_no, MAX(q.date) AS last FROM enforcement_files f LEFT JOIN enforcement_queries q ON q.file_id = f.id
       WHERE f.office_id = ? AND f.status NOT IN ('tahsil', 'kapandi') GROUP BY f.id`,
    )
    .all(user.office_id) as { id: number; debtor: string; file_no: string; last: string | null }[];
  return rows
    .map((r) => ({ ...r, age: r.last ? Math.floor((Date.parse(today) - Date.parse(r.last)) / 86_400_000) : null }))
    .filter((r) => r.age === null || r.age > STALE_DAYS);
}

/* ---------- Excel / CSV ile toplu aktarım ---------- */

const norm = (s: string) =>
  s
    .toLocaleLowerCase('tr')
    .replace(/ı/g, 'i')
    .replace(/ş/g, 's')
    .replace(/ğ/g, 'g')
    .replace(/ü/g, 'u')
    .replace(/ö/g, 'o')
    .replace(/ç/g, 'c')
    .replace(/â/g, 'a')
    .replace(/[^a-z0-9]/g, '');

// Sütun başlığı → alan. Başlıklar Türkçe karakterli/karaktersiz, boşluklu yazılabilir.
const HEADERS: [string, string[]][] = [
  ['debtor', ['borclu', 'borcluadi', 'borcluadisoyadi', 'borcluunvan']],
  ['creditor', ['alacakli', 'muvekkil', 'alacakliadi']],
  ['officeName', ['icradairesi', 'daire', 'icramudurlugu', 'icra']],
  ['fileNo', ['dosyano', 'esasno', 'esas', 'dosya', 'takipno']],
  ['kind', ['takipturu', 'tur', 'takiptipi']],
  ['principal', ['asilalacak', 'alacak', 'tutar', 'alacaktutari', 'anapara']],
  ['interestRate', ['faiz', 'faizorani', 'yillikfaiz']],
  ['startDate', ['takiptarihi', 'tarih', 'acilistarihi']],
  ['debtorIdNo', ['tc', 'tckn', 'tckimlikno', 'vkn', 'vergino', 'tcvkn', 'kimlikno']],
  ['debtorAddress', ['adres', 'borcluadresi']],
  ['status', ['durum', 'asama']],
  ['note', ['not', 'aciklama']],
];

const KIND_WORDS: [string, string][] = [
  ['ilamsiz', 'ilamsiz'],
  ['genel', 'ilamsiz'],
  ['ilamli', 'ilamli'],
  ['kambiyo', 'kambiyo'],
  ['cek', 'kambiyo'],
  ['senet', 'kambiyo'],
  ['rehin', 'rehin'],
  ['ipotek', 'rehin'],
  ['tahliye', 'tahliye'],
];
const STATUS_WORDS: [string, string][] = [
  ['derdest', 'derdest'],
  ['itiraz', 'itiraz'],
  ['haciz', 'haciz'],
  ['satis', 'satis'],
  ['tahsil', 'tahsil'],
  ['kapa', 'kapandi'],
  ['infaz', 'kapandi'],
];

const validDate = (d: string) => DATE.test(d) && !Number.isNaN(Date.parse(d)) && new Date(Date.parse(d)).toISOString().slice(0, 10) === d;

function toDate(v: string) {
  const s = v.trim();
  if (!s) return '';
  if (DATE.test(s)) return s;
  const m = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
  if (m) {
    const iso = `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
    return validDate(iso) ? iso : s;
  }
  // Excel gün numarası (1900 tabanlı).
  if (/^\d{5}(\.\d+)?$/.test(s)) return new Date(Date.UTC(1899, 11, 30) + Math.floor(Number(s)) * 86_400_000).toISOString().slice(0, 10);
  return s;
}

function toTable(fileName: string, buf: Buffer): string[][] {
  if (/\.xlsx$/i.test(fileName)) {
    const text = readXlsx(buf);
    // İlk sayfa: "[Sayfa]" satırından sonraki satırlar, bir sonraki sayfaya kadar.
    const lines = text.split('\n');
    const out: string[][] = [];
    let sheets = 0;
    for (const l of lines) {
      if (/^\[.*\]$/.test(l)) {
        if (++sheets > 1) break;
        continue;
      }
      out.push(l.split('\t'));
    }
    return out;
  }
  if (/\.(csv|txt)$/i.test(fileName)) {
    let text = buf.toString('utf8').replace(/^﻿/, '');
    if (text.includes('�')) text = buf.toString('latin1');
    const lines = text.split(/\r?\n/).filter((l) => l.trim());
    const sep = (lines[0].match(/;/g)?.length ?? 0) >= (lines[0].match(/,/g)?.length ?? 0) ? ';' : ',';
    return lines.map((l) => {
      const cells: string[] = [];
      let cur = '';
      let q = false;
      for (let i = 0; i < l.length; i++) {
        const c = l[i];
        if (c === '"') {
          if (q && l[i + 1] === '"') {
            cur += '"';
            i++;
          } else q = !q;
        } else if (c === sep && !q) {
          cells.push(cur);
          cur = '';
        } else cur += c;
      }
      cells.push(cur);
      return cells.map((x) => x.trim());
    });
  }
  throw new ApiError(400, 'Excel (.xlsx) ya da CSV dosyası seçin.');
}

export interface ImportRow {
  line: number;
  values: Record<string, string>;
  match: { id: number; debtor: string } | null;
  op: 'yeni' | 'guncelle' | 'hata';
  error: string;
}

/**
 * Dosyayı okur, sütunları tanır, her satır için ne yapılacağını söyler. commit verilirse uygular:
 * aynı icra dairesi + dosya numarası büroda varsa o dosya güncellenir (kayıtMatik gibi), yoksa yeni dosya açılır.
 */
export function importFiles(db: DB, user: User, input: { fileName?: string; base64?: string; commit?: boolean }) {
  const table = toTable(String(input.fileName ?? ''), Buffer.from(String(input.base64 ?? ''), 'base64'));
  if (table.length < 2) throw new ApiError(400, 'Dosyada başlık satırı ve en az bir kayıt olmalı.');
  const header = table[0].map(norm);
  const columns: Record<string, number> = {};
  for (const [field, names] of HEADERS) {
    const i = header.findIndex((h) => names.includes(h));
    if (i >= 0) columns[field] = i;
  }
  if (columns.debtor === undefined && columns.fileNo === undefined)
    throw new ApiError(400, 'Başlık satırında en az "Borçlu" ya da "Dosya No" sütunu olmalı.');
  const existing = db.prepare('SELECT id, debtor, office_name, file_no FROM enforcement_files WHERE office_id = ?').all(user.office_id) as {
    id: number;
    debtor: string;
    office_name: string;
    file_no: string;
  }[];
  const key = (office: string, no: string) => `${norm(office)}|${no.replace(/\s/g, '')}`;
  const byKey = new Map(existing.filter((e) => e.file_no).map((e) => [key(e.office_name, e.file_no), e]));

  const rows: ImportRow[] = [];
  for (let r = 1; r < table.length; r++) {
    const cells = table[r];
    if (cells.every((c) => !c.trim())) continue;
    const values: Record<string, string> = {};
    for (const [field, i] of Object.entries(columns)) values[field] = (cells[i] ?? '').trim();
    if (values.kind) values.kind = KIND_WORDS.find(([w]) => norm(values.kind).includes(w))?.[1] ?? values.kind;
    if (values.status) values.status = STATUS_WORDS.find(([w]) => norm(values.status).includes(w))?.[1] ?? values.status;
    if (values.startDate) values.startDate = toDate(values.startDate);
    if (values.interestRate) values.interestRate = values.interestRate.replace('%', '').replace(',', '.').trim();
    const match = values.fileNo ? (byKey.get(key(values.officeName ?? '', values.fileNo)) ?? null) : null;
    let error = '';
    if (!match && !values.debtor) error = 'Borçlu adı yok.';
    else if (values.kind && !ENFORCEMENT_KINDS.includes(values.kind)) error = `Takip türü tanınmadı: ${values.kind}`;
    else if (values.status && !ENFORCEMENT_STATUSES.includes(values.status)) error = `Durum tanınmadı: ${values.status}`;
    else if (values.startDate && !validDate(values.startDate)) error = `Tarih tanınmadı: ${values.startDate}`;
    else
      try {
        toKurus(values.principal, 'Asıl alacak');
        if (values.interestRate && !Number.isFinite(Number(values.interestRate))) throw new ApiError(400, 'Faiz oranı sayı değil.');
      } catch (e) {
        error = (e as Error).message;
      }
    rows.push({ line: r + 1, values, match: match ? { id: match.id, debtor: match.debtor } : null, op: error ? 'hata' : match ? 'guncelle' : 'yeni', error });
  }

  const fields = Object.keys(columns);
  const summary = { yeni: rows.filter((r) => r.op === 'yeni').length, guncelle: rows.filter((r) => r.op === 'guncelle').length, hata: rows.filter((r) => r.op === 'hata').length };
  if (!input.commit) return { fields, rows: rows.slice(0, 500), total: rows.length, summary, done: false };

  const apply = db.transaction(() => {
    for (const r of rows) {
      if (r.op === 'hata') continue;
      const v = r.values;
      // Boş hücreler mevcut değeri silmez.
      const body: Record<string, string | number> = Object.fromEntries(Object.entries(v).filter(([, x]) => x !== ''));
      if (body.interestRate !== undefined) body.interestRate = Number(body.interestRate);
      if (r.op === 'guncelle') updateFile(db, user, r.match!.id, body);
      else createFile(db, user, body);
    }
  });
  apply();
  return { fields, rows: [], total: rows.length, summary, done: true };
}

const EXPORT_COLUMNS: [string, string][] = [
  ['Borçlu', 'debtor'],
  ['TC/VKN', 'debtor_id_no'],
  ['Alacaklı', 'creditor'],
  ['İcra Dairesi', 'office_name'],
  ['Dosya No', 'file_no'],
  ['Takip Türü', 'kind'],
  ['Takip Tarihi', 'start_date'],
  ['Asıl Alacak', 'principal_kurus'],
  ['Faiz', 'interest_kurus'],
  ['Masraf ve Vekâlet', 'expense_kurus'],
  ['Tahsilat', 'collected_kurus'],
  ['Kalan', 'remaining_kurus'],
  ['Dairede Bekleyen', 'at_office_kurus'],
  ['Durum', 'status'],
  ['Adres', 'debtor_address'],
  ['Not', 'note'],
];

/** Bütün icra dosyaları, Excel'in doğrudan açtığı CSV (noktalı virgül, UTF-8 BOM). */
export function exportFiles(db: DB, user: User) {
  const files = listFiles(db, user) as unknown as Record<string, string | number>[];
  const cell = (v: unknown, k: string) => {
    const s = k.endsWith('_kurus') ? (Number(v) / 100).toFixed(2).replace('.', ',') : String(v ?? '');
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [EXPORT_COLUMNS.map(([h]) => h).join(';'), ...files.map((f) => EXPORT_COLUMNS.map(([, k]) => cell(f[k], k)).join(';'))];
  const day = new Date().toISOString().slice(0, 10);
  return { fileName: `Icra-Dosyalari-${day}.csv`, base64: Buffer.from('﻿' + lines.join('\r\n'), 'utf8').toString('base64'), count: files.length };
}
