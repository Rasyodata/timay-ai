import { createHash, randomBytes } from 'node:crypto';
import type { Request, Response } from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import * as z from 'zod/v4';
import { getUser, type User } from './auth.ts';
import { caseContext } from './ai.ts';
import { listCases } from './cases.ts';
import { checkCitations } from './citations.ts';
import type { DB } from './db.ts';
import { getDecision, searchArchive } from './decisions.ts';
import { analyzeFacts } from './emsal.ts';
import { ApiError } from './errors.ts';
import { listChanges } from './mevzuat.ts';
import { listTebligat } from './tebligat.ts';
import * as yargitay from './yargitay.ts';

/*
 * Claude bağlantısı (MCP): avukat kendi Claude hesabına (claude.ai, Claude masaüstü) Timay'ı
 * "özel bağlayıcı" olarak ekler. Claude sohbet ederken büronun karar arşivinde, Yargıtay'da ve
 * mevzuat kayıtlarında arar; anahtarda izin verildiyse dava dosyalarını okur. Araçlar yalnızca okur,
 * Timay'da hiçbir şeyi değiştirmez. Her anahtar bir kullanıcıya bağlıdır ve tek tıkla iptal edilir.
 */

const PREFIX = 'tmy_';
const hash = (token: string) => createHash('sha256').update(token).digest('hex');

interface KeyRow {
  id: number;
  office_id: number;
  user_id: number;
  label: string;
  allow_cases: number;
  created_at: string;
  last_used_at: string;
  revoked_at: string;
}

export function listKeys(db: DB, user: User) {
  return (
    db
      .prepare(`SELECT k.id, k.user_id, u.name AS user_name, k.label, k.allow_cases, k.created_at, k.last_used_at FROM mcp_keys k JOIN users u ON u.id = k.user_id
        WHERE k.office_id = ? AND k.revoked_at = '' ${user.is_admin ? '' : 'AND k.user_id = ?'} ORDER BY k.id DESC`)
      .all(...(user.is_admin ? [user.office_id] : [user.office_id, user.id])) as (KeyRow & { user_name: string })[]
  ).map((k) => ({ ...k, allow_cases: Boolean(k.allow_cases) }));
}

/** Yeni anahtar üretir. Anahtarın kendisi yalnızca bu yanıtta görünür; sunucuda özeti saklanır. */
export function createKey(db: DB, user: User, input: { label?: string; allowCases?: boolean }) {
  const token = `${PREFIX}${randomBytes(24).toString('hex')}`;
  const label = String(input.label ?? '').trim().slice(0, 80) || 'Claude';
  const r = db
    .prepare('INSERT INTO mcp_keys (office_id, user_id, label, token_hash, allow_cases) VALUES (?, ?, ?, ?, ?)')
    .run(user.office_id, user.id, label, hash(token), input.allowCases ? 1 : 0);
  return { id: Number(r.lastInsertRowid), label, token, path: `/mcp/${token}` };
}

export function revokeKey(db: DB, user: User, id: number) {
  const row = db.prepare("SELECT user_id FROM mcp_keys WHERE id = ? AND office_id = ? AND revoked_at = ''").get(id, user.office_id) as { user_id: number } | undefined;
  if (!row) throw new ApiError(404, 'Bağlantı anahtarı bulunamadı.');
  if (row.user_id !== user.id && !user.is_admin) throw new ApiError(403, 'Başkasının anahtarını yalnızca yönetici iptal edebilir.');
  db.prepare("UPDATE mcp_keys SET revoked_at = datetime('now') WHERE id = ?").run(id);
  return { ok: true };
}

/** Anahtarı doğrular; kullanıcıyı ve dava dosyası iznini döner. */
export function keyUser(db: DB, token: string): { user: User; allowCases: boolean; keyId: number } {
  if (!token.startsWith(PREFIX)) throw new ApiError(401, 'Geçersiz bağlantı anahtarı.');
  const row = db.prepare("SELECT id, user_id, allow_cases FROM mcp_keys WHERE token_hash = ? AND revoked_at = ''").get(hash(token)) as
    | { id: number; user_id: number; allow_cases: number }
    | undefined;
  if (!row) throw new ApiError(401, 'Bağlantı anahtarı geçersiz ya da iptal edilmiş. Timay’da yeni anahtar oluşturun.');
  db.prepare("UPDATE mcp_keys SET last_used_at = datetime('now') WHERE id = ?").run(row.id);
  return { user: getUser(db, row.user_id), allowCases: Boolean(row.allow_cases), keyId: row.id };
}

const text = (value: unknown) => ({ content: [{ type: 'text' as const, text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }] });
const fail = (e: unknown) => ({
  isError: true,
  content: [{ type: 'text' as const, text: e instanceof ApiError ? e.message : e instanceof Error ? e.message : 'Beklenmeyen hata.' }],
});
async function safe(fn: () => unknown) {
  try {
    return text(await fn());
  } catch (e) {
    return fail(e);
  }
}

const tr = (d: string | null | undefined) => (d ? d.split('-').reverse().join('.') : '');

/** Bir kullanıcı için MCP sunucusu: araçlar kullanıcının yetkisiyle çalışır. */
export function buildServer(db: DB, user: User, allowCases: boolean, fetchImpl: yargitay.Fetch) {
  const server = new McpServer(
    { name: 'timay', version: '1.0.0' },
    {
      instructions: `Timay, ${user.name} adlı avukatın hukuk bürosu programıdır. Yargıtay kararı ararken önce arsivde_karar_ara, bulunamazsa yargitayda_ara kullan; kararı alıntılamadan önce karar_metni ile tam metni oku ve esas/karar numarasını metinden aynen al. Dilekçe yazdıysan atif_kontrol ile atıfları denetle. Sonuçlar hukuki görüş değildir; son kararı avukat verir.`,
    },
  );

  server.registerTool(
    'arsivde_karar_ara',
    {
      title: 'Büro arşivinde karar ara',
      description: 'Büronun Yargıtay karar arşivinde kavram, kelime ya da esas/karar numarasıyla (ör. 2021/1234) arar. Sonuçlar uygunluk yüzdesine göre sıralanır.',
      inputSchema: {
        sorgu: z.string().describe('Aranacak kavram ya da numara, ör. "haklı fesih kıdem tazminatı"'),
        daire: z.string().optional().describe('ör. "9. Hukuk Dairesi"'),
        yil: z.string().optional().describe('Karar yılı, ör. "2023"'),
      },
      annotations: { readOnlyHint: true },
    },
    ({ sorgu, daire, yil }) =>
      safe(() => {
        const r = searchArchive(db, { q: sorgu, chamber: daire, year: yil, limit: 15 });
        return {
          toplam: r.total,
          kararlar: (r.items as unknown as { id: number; court: string; chamber: string; esas_no: string; karar_no: string; decision_date: string; excerpt: string; relevance: number | null }[]).map((d) => ({
            id: d.id,
            karar: `${d.court} ${d.chamber} E. ${d.esas_no} K. ${d.karar_no}`,
            tarih: tr(d.decision_date),
            uygunluk: d.relevance,
            ozet: d.excerpt,
          })),
        };
      }),
  );

  server.registerTool(
    'karar_metni',
    {
      title: 'Kararın tam metni',
      description: 'Arşivdeki bir kararın tam metnini getirir (id, arsivde_karar_ara sonucundan).',
      inputSchema: { id: z.number().int().describe('Kararın arşiv numarası') },
      annotations: { readOnlyHint: true },
    },
    ({ id }) =>
      safe(() => {
        const d = getDecision(db, id) as { court: string; chamber: string; esas_no: string; karar_no: string; decision_date: string; source_url: string; text: string };
        return `${d.court} ${d.chamber} E. ${d.esas_no} K. ${d.karar_no} ${tr(d.decision_date)}\nKaynak: ${d.source_url || 'büro arşivi'}\n\n${d.text}`;
      }),
  );

  server.registerTool(
    'yargitayda_ara',
    {
      title: "Yargıtay'da çevrimiçi ara",
      description: "Adalet Bakanlığı'nın resmî karar veritabanında (Bedesten) Yargıtay kararı arar. Tam metni okumak için kararı Timay'da arşive eklemek gerekir.",
      inputSchema: {
        sorgu: z.string().describe('Aranacak ifade'),
        daire: z.string().optional(),
        yil_baslangic: z.string().optional(),
        yil_bitis: z.string().optional(),
        sayfa: z.number().int().min(1).optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    ({ sorgu, daire, yil_baslangic, yil_bitis, sayfa }) =>
      safe(async () => {
        try {
          const r = await yargitay.search(db, fetchImpl, { q: sorgu, chamber: daire ?? '', yearFrom: yil_baslangic ?? '', yearTo: yil_bitis ?? '', page: String(sayfa ?? 1) });
          return {
            toplam: r.total,
            kararlar: r.items.map((d) => ({ karar: `${d.court} ${d.chamber} E. ${d.esasNo} K. ${d.kararNo}`, tarih: tr(d.date), arsivde: d.archiveId ? `evet (id ${d.archiveId})` : 'hayır' })),
          };
        } catch {
          throw new ApiError(502, "Yargıtay karar veritabanına sunucudan ulaşılamadı. Timay masaüstü uygulamasında Yargıtay kararları › Yargıtay'da ara sekmesinden arayıp arşive ekleyin; sonra arsivde_karar_ara ile bulunur.");
        }
      }),
  );

  server.registerTool(
    'olaydan_emsal',
    {
      title: 'Olaydan emsal bul',
      description: 'Olay anlatımındaki hukuki meseleleri (ör. işe iade, temerrüt nedeniyle tahliye) ve dayanak maddeleri çıkarır, büro arşivindeki uygun kararları getirir.',
      inputSchema: { olay: z.string().describe('Olayın anlatımı ya da dilekçe metni') },
      annotations: { readOnlyHint: true },
    },
    ({ olay }) =>
      safe(async () => {
        const r = await analyzeFacts(db, user, { text: olay }, null);
        return { meseleler: r.concepts.map((c) => ({ mesele: c.label, dayanak: c.basis, arama: c.query })), maddeler: r.articles, arsivdeki_kararlar: r.archive };
      }),
  );

  server.registerTool(
    'atif_kontrol',
    {
      title: 'Karar atıflarını denetle',
      description: 'Metindeki Yargıtay karar atıflarını (esas/karar numarası) büro arşivine göre denetler: arşivde bulunan, bulunmayan.',
      inputSchema: { metin: z.string().describe('Dilekçe ya da metin') },
      annotations: { readOnlyHint: true },
    },
    ({ metin }) => safe(() => checkCitations(db, metin)),
  );

  server.registerTool(
    'mevzuat_degisiklikleri',
    {
      title: 'Mevzuat değişiklikleri',
      description: 'Büronun takip ettiği mevzuat değişikliği kayıtları ve etkilediği maddeler.',
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    () => safe(() => listChanges(db, user)),
  );

  if (allowCases) {
    server.registerTool(
      'dava_dosyalari',
      {
        title: 'Dava dosyaları',
        description: 'Avukatın görebildiği dava dosyalarını listeler (başlık, mahkeme, esas no, müvekkil, sonraki duruşma).',
        inputSchema: { arama: z.string().optional().describe('Başlık, müvekkil ya da esas numarasında geçen ifade') },
        annotations: { readOnlyHint: true },
      },
      ({ arama }) =>
        safe(() => {
          const q = (arama ?? '').toLocaleLowerCase('tr');
          return (listCases(db, user) as { id: number; title: string; court: string; esas_no: string; client: string; status: string; next_hearing: string | null }[])
            .filter((c) => !q || `${c.title} ${c.client} ${c.esas_no} ${c.court}`.toLocaleLowerCase('tr').includes(q))
            .slice(0, 50)
            .map((c) => ({ id: c.id, baslik: c.title, mahkeme: c.court, esas_no: c.esas_no, muvekkil: c.client, durum: c.status, sonraki_durusma: tr(c.next_hearing) }));
        }),
    );
    server.registerTool(
      'dava_dosyasi',
      {
        title: 'Dava dosyasını oku',
        description: 'Dava dosyasının bilgilerini, olaylarını, duruşmalarını, belgelerinin metnini ve son dilekçelerini getirir.',
        inputSchema: { id: z.number().int().describe('dava_dosyalari sonucundaki id') },
        annotations: { readOnlyHint: true },
      },
      ({ id }) => safe(() => caseContext(db, user, id)),
    );
    server.registerTool(
      'sureler_ve_tebligatlar',
      {
        title: 'Süreler ve tebligatlar',
        description: 'Takipteki yasal süreler (son günüyle) ve süresi henüz takibe alınmamış tebligatlar.',
        inputSchema: {},
        annotations: { readOnlyHint: true },
      },
      () =>
        safe(() => {
          const sureler = (
            db
              .prepare(
                `SELECT d.title, d.due_date, d.basis, k.title AS case_title FROM legal_deadlines d LEFT JOIN cases k ON k.id = d.case_id
                 WHERE d.office_id = ? AND d.done = 0 ORDER BY d.due_date LIMIT 50`,
              )
              .all(user.office_id) as { title: string; due_date: string; basis: string; case_title: string | null }[]
          ).map((d) => ({ sure: d.title, son_gun: tr(d.due_date), dayanak: d.basis, dosya: d.case_title }));
          const tebligatlar = listTebligat(db, user, { status: 'islenmedi' }).map((t) => ({ evrak: t.subject, gonderen: t.sender, teblig: tr(t.served_date), dosya: t.case_title }));
          return { sureler, takibe_alinmamis_tebligatlar: tebligatlar };
        }),
    );
  }
  return server;
}

/** Express işleyicisi: POST /mcp/:key (durumsuz Streamable HTTP). */
export function mcpHandler(db: DB, fetchImpl: yargitay.Fetch) {
  return async (req: Request, res: Response) => {
    let auth;
    try {
      auth = keyUser(db, String(req.params.key ?? ''));
    } catch (e) {
      res.status(401).json({ jsonrpc: '2.0', error: { code: -32001, message: e instanceof Error ? e.message : 'Yetkisiz.' }, id: null });
      return;
    }
    const server = buildServer(db, auth.user, auth.allowCases, fetchImpl);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on('close', () => {
      transport.close();
      server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (e) {
      console.error('MCP isteği başarısız:', e);
      if (!res.headersSent) res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'Sunucu hatası.' }, id: null });
    }
  };
}
