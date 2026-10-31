import type { User } from './auth.ts';
import { assertCaseVisible, getCase } from './cases.ts';
import { AI_MODEL, type AiModel } from './claude.ts';
import { getContract } from './contracts.ts';
import type { DB } from './db.ts';
import { ApiError } from './errors.ts';
import { createPetition } from './petitions.ts';

/*
 * Yapay zekâ (Claude): hukuk asistanı sohbeti, dava dosyasından dilekçe taslağı, sözleşmeyi
 * anlamsal okuma, kararın davaya göre lehte/aleyhte sınıflandırılması ve infaz hesabı.
 * Sunucuda ANTHROPIC_API_KEY yoksa hepsi kapalıdır; açıklayıcı bir hata döner.
 * Yapay zekânın her çıktısı taslaktır: avukat kontrolü ve büro onayı akışı aynen geçerlidir.
 */

const COMMON = `Sen Türkiye'de çalışan bir avukatlık bürosunun yapay zekâ yardımcısısın. Türkçe, açık ve düzgün bir hukuk diliyle yaz.
Kurallar:
- Dayanak göster: kanun adı ve madde numarası (ör. "TBK m.344", "HMK m.119"), Yargıtay kararı biliyorsan daire, esas ve karar numarasıyla. Emin olmadığın numarayı uydurma; "doğrulanmalı" diye belirt.
- Mevzuat sık değişir. Bilgin güncel olmayabilir; süre, oran ve harç gibi değerlerde "güncel mevzuattan teyit edin" uyarısını ekle.
- Sana verilen dosya bilgilerine dayan; dosyada olmayan olguyu varsayma, eksik bilgiyi açıkça sor ya da belirt.
- Kesin hüküm verme; son kararı avukat verir.`;

export const MODES = {
  genel: { label: 'Hukuk asistanı', hint: 'Soru sorun, strateji tartışın, metin yazdırın.', prompt: 'Avukatın sorularını yanıtla, strateji öner, gerekirse metin taslağı yaz.' },
  dilekce: {
    label: 'Dilekçe yazımı',
    hint: 'Dava dosyasını seçin; dilekçeyi birlikte yazalım.',
    prompt: 'Dilekçe, cevap dilekçesi, ihtarname ve benzeri metinleri HMK m.119 düzenine uygun (mahkeme, taraflar, konu, açıklamalar, hukuki sebepler, deliller, sonuç ve istem) yaz.',
  },
  sozlesme: {
    label: 'Sözleşme danışmanı',
    hint: 'Sözleşme seçin; maddeleri, riskleri ve öneriler üzerine konuşalım.',
    prompt: 'Sözleşmeyi madde madde değerlendir, riskleri hangi taraf aleyhine işlediğiyle birlikte açıkla ve somut madde önerileri yaz.',
  },
  ictihat: {
    label: 'İçtihat analizi',
    hint: 'Karar metnini yapıştırın; davanıza etkisini konuşalım.',
    prompt: 'Verilen karar metinlerini davaya göre değerlendir: hangi ilkeyi koyuyor, davamızın lehine mi aleyhine mi, dilekçede nasıl kullanılır.',
  },
  infaz: {
    label: 'İnfaz danışmanı',
    hint: 'Ceza infazı, koşullu salıverilme ve denetimli serbestlik soruları.',
    prompt: '5275 sayılı Ceza ve Güvenlik Tedbirlerinin İnfazı Hakkında Kanun (özellikle m.105/A, m.107, geçici maddeler) çerçevesinde hesap yap ve adım adım göster.',
  },
} as const;
export type Mode = keyof typeof MODES;
const isMode = (m: unknown): m is Mode => typeof m === 'string' && m in MODES;

function need(model: AiModel | null): AiModel {
  if (!model) throw new ApiError(503, 'Yapay zekâ kapalı: sunucuya Claude API anahtarı (ANTHROPIC_API_KEY) eklenmemiş.');
  return model;
}

export function aiStatus(model: AiModel | null) {
  return {
    enabled: model !== null,
    model: AI_MODEL,
    modes: Object.entries(MODES).map(([key, m]) => ({ key, label: m.label, hint: m.hint })),
  };
}

const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}\n[… metin kısaltıldı]` : s);

/** Dava dosyasının yapay zekâya verilecek özeti: bilgiler, duruşmalar, belgeler, son dilekçeler. */
export function caseContext(db: DB, user: User, caseId: number) {
  const c = getCase(db, user, caseId);
  const docs = db
    .prepare("SELECT title, kind, text FROM case_documents WHERE case_id = ? AND text <> '' ORDER BY id DESC LIMIT 12")
    .all(caseId) as { title: string; kind: string; text: string }[];
  const petitions = db
    .prepare(
      `SELECT p.title, p.status, v.body FROM petitions p JOIN petition_versions v ON v.petition_id = p.id
       WHERE p.case_id = ? AND v.version = (SELECT MAX(version) FROM petition_versions WHERE petition_id = p.id)
       ORDER BY p.id DESC LIMIT 3`,
    )
    .all(caseId) as { title: string; status: string; body: string }[];
  let budget = 80000;
  const take = (s: string, n: number) => {
    const t = cut(s, Math.min(n, Math.max(budget, 0)));
    budget -= t.length;
    return t;
  };
  const hearings = (c.hearings as { date: string; time: string; note?: string }[]).map((h) => `- ${h.date} ${h.time ?? ''} ${h.note ?? ''}`.trim()).join('\n');
  return `<dava_dosyasi>
Başlık: ${c.title}
Mahkeme: ${c.court || '-'}  Esas no: ${c.esas_no || '-'}  Alan: ${c.area || '-'}  Durum: ${c.status}
Müvekkil: ${c.client || '-'}
Taraflar: ${c.parties || '-'}
Olaylar:
${take(c.facts || '(yazılmamış)', 20000)}
${hearings ? `Duruşmalar:\n${hearings}\n` : ''}${docs.map((d) => `<belge baslik="${d.title}" tur="${d.kind}">\n${take(d.text, 15000)}\n</belge>`).join('\n')}
${petitions.map((p) => `<dilekce baslik="${p.title}" durum="${p.status}">\n${take(p.body, 12000)}\n</dilekce>`).join('\n')}
</dava_dosyasi>`;
}

function contractContext(db: DB, user: User, contractId: number) {
  const c = getContract(db, user, contractId);
  return `<sozlesme baslik="${c.title}" tur="${c.kind}" taraflar="${c.parties}" baslangic="${c.start_date}" bitis="${c.end_date}">
${cut(c.body || '(metin yok)', 90000)}
</sozlesme>`;
}

/* ---------- Asistan sohbeti ---------- */

interface ChatRow {
  id: number;
  user_id: number;
  mode: Mode;
  case_id: number | null;
  contract_id: number | null;
  title: string;
  created_at: string;
  updated_at: string;
}

function loadChat(db: DB, user: User, id: number) {
  const c = db.prepare('SELECT * FROM ai_chats WHERE id = ? AND office_id = ? AND user_id = ?').get(id, user.office_id, user.id) as ChatRow | undefined;
  if (!c) throw new ApiError(404, 'Sohbet bulunamadı.');
  return c;
}

export function listChats(db: DB, user: User) {
  return db
    .prepare(
      `SELECT a.id, a.mode, a.title, a.case_id, a.contract_id, a.updated_at, c.title AS case_title, k.title AS contract_title,
              (SELECT COUNT(*) FROM ai_messages m WHERE m.chat_id = a.id) AS messages
       FROM ai_chats a LEFT JOIN cases c ON c.id = a.case_id LEFT JOIN contracts k ON k.id = a.contract_id
       WHERE a.office_id = ? AND a.user_id = ? ORDER BY a.updated_at DESC, a.id DESC LIMIT 100`,
    )
    .all(user.office_id, user.id);
}

export function createChat(db: DB, user: User, input: { mode?: string; caseId?: number | null; contractId?: number | null; title?: string }) {
  const mode: Mode = isMode(input.mode) ? input.mode : 'genel';
  const caseId = input.caseId ? Number(input.caseId) : null;
  const contractId = input.contractId ? Number(input.contractId) : null;
  if (caseId) assertCaseVisible(db, user, caseId);
  if (contractId) getContract(db, user, contractId);
  const r = db
    .prepare('INSERT INTO ai_chats (office_id, user_id, mode, case_id, contract_id, title) VALUES (?, ?, ?, ?, ?, ?)')
    .run(user.office_id, user.id, mode, caseId, contractId, String(input.title ?? '').trim());
  return getChat(db, user, Number(r.lastInsertRowid));
}

export function getChat(db: DB, user: User, id: number) {
  const c = loadChat(db, user, id);
  const messages = db.prepare('SELECT id, role, content, model, created_at FROM ai_messages WHERE chat_id = ? ORDER BY id').all(id);
  const caseTitle = c.case_id ? (db.prepare('SELECT title FROM cases WHERE id = ?').get(c.case_id) as { title: string } | undefined)?.title : undefined;
  const contractTitle = c.contract_id ? (db.prepare('SELECT title FROM contracts WHERE id = ?').get(c.contract_id) as { title: string } | undefined)?.title : undefined;
  return { ...c, case_title: caseTitle ?? '', contract_title: contractTitle ?? '', messages };
}

export function deleteChat(db: DB, user: User, id: number) {
  loadChat(db, user, id);
  db.transaction(() => {
    db.prepare('DELETE FROM ai_messages WHERE chat_id = ?').run(id);
    db.prepare('DELETE FROM ai_chats WHERE id = ?').run(id);
  })();
  return { ok: true };
}

/** Kullanıcının mesajını gönderir; yanıt gelince ikisi birlikte kaydedilir. */
export async function sendMessage(db: DB, user: User, id: number, input: { content?: string }, model: AiModel | null) {
  const ai = need(model);
  const c = loadChat(db, user, id);
  const content = String(input.content ?? '').trim();
  if (!content) throw new ApiError(400, 'Mesaj boş olamaz.');
  if (content.length > 200000) throw new ApiError(400, 'Mesaj çok uzun.');
  const history = (db.prepare('SELECT role, content FROM ai_messages WHERE chat_id = ? ORDER BY id DESC LIMIT 40').all(id) as { role: 'user' | 'assistant'; content: string }[]).reverse();
  const context = [c.case_id ? caseContext(db, user, c.case_id) : '', c.contract_id ? contractContext(db, user, c.contract_id) : ''].filter(Boolean).join('\n\n');
  const office = db.prepare('SELECT name FROM offices WHERE id = ?').get(user.office_id) as { name: string } | undefined;
  const system = `${COMMON}\n\nGörev: ${MODES[c.mode].prompt}\nKonuştuğun kişi: ${user.name} (${user.role}), büro: ${office?.name ?? ''}. Bugünün tarihi: ${new Date().toISOString().slice(0, 10)}.${context ? `\n\nÜzerinde çalışılan dosya:\n${context}` : ''}`;
  const reply = await ai({ system, messages: [...history, { role: 'user', content }], effort: 'high', maxTokens: 32000 });
  db.transaction(() => {
    const ins = db.prepare('INSERT INTO ai_messages (chat_id, role, content, model) VALUES (?, ?, ?, ?)');
    ins.run(id, 'user', content, '');
    ins.run(id, 'assistant', reply.text, reply.model);
    db.prepare("UPDATE ai_chats SET updated_at = datetime('now'), title = CASE WHEN title = '' THEN ? ELSE title END WHERE id = ?").run(content.replace(/\s+/g, ' ').slice(0, 70), id);
  })();
  return getChat(db, user, id);
}

/* ---------- Dilekçe taslağı ---------- */

const PETITION_SCHEMA = {
  type: 'object',
  properties: { title: { type: 'string' }, body: { type: 'string' }, notes: { type: 'string' } },
  required: ['title', 'body', 'notes'],
  additionalProperties: false,
};

/** Dava dosyasından dilekçe taslağı yazar ve dosyaya "taslak" olarak ekler. */
export async function draftPetition(db: DB, user: User, input: { caseId?: number; kind?: string; instructions?: string }, model: AiModel | null) {
  const ai = need(model);
  const caseId = Number(input.caseId);
  if (!caseId) throw new ApiError(400, 'Dava dosyası seçin.');
  const kind = String(input.kind ?? '').trim() || 'dava dilekçesi';
  const context = caseContext(db, user, caseId);
  const r = await ai({
    system: `${COMMON}\n\nGörev: ${MODES.dilekce.prompt}\nYanıtın JSON: title (kısa dilekçe başlığı), body (dilekçenin tam metni, düz metin, başlıklar büyük harfle), notes (avukatın kontrol etmesi gereken noktalar ve eksik bilgiler, madde madde).`,
    messages: [{ role: 'user', content: `${context}\n\nYazılacak metin: ${kind}\n${input.instructions ? `Avukatın talimatı: ${input.instructions}` : ''}\n\nDosyada bulunmayan bilgiler için köşeli parantezle yer tutucu bırak (ör. [TC kimlik no]).` }],
    schema: PETITION_SCHEMA,
    effort: 'high',
  });
  const out = JSON.parse(r.text) as { title: string; body: string; notes: string };
  const petition = createPetition(db, user, { caseId, title: out.title || kind, body: out.body });
  saveResult(db, user, 'dilekce', (petition as { id: number }).id, caseId, kind, { notes: out.notes }, r.model);
  return { petition, notes: out.notes, model: r.model };
}

/* ---------- Sözleşmeyi anlamsal okuma ---------- */

const CONTRACT_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          verdict: { type: 'string', enum: ['lehte', 'aleyhte', 'eksik', 'notr'] },
          severity: { type: 'string', enum: ['yuksek', 'orta', 'dusuk'] },
          quote: { type: 'string' },
          note: { type: 'string' },
          basis: { type: 'string' },
          suggestion: { type: 'string' },
        },
        required: ['title', 'verdict', 'severity', 'quote', 'note', 'basis', 'suggestion'],
        additionalProperties: false,
      },
    },
  },
  required: ['summary', 'findings'],
  additionalProperties: false,
};

const norm = (s: string) => s.toLocaleLowerCase('tr').replace(/\s+/g, ' ').trim();

export async function reviewContract(db: DB, user: User, contractId: number, input: { side?: string }, model: AiModel | null) {
  const ai = need(model);
  const c = getContract(db, user, contractId);
  if (!c.body.trim()) throw new ApiError(400, 'Sözleşmenin metni yok; önce metni ekleyin.');
  const side = String(input.side ?? '').trim() || 'müvekkilimiz (taraflardan hangisi olduğu belirtilmedi; her bulguda kimin aleyhine olduğunu yaz)';
  const r = await ai({
    system: `${COMMON}\n\nGörev: Sözleşmeyi anlamsal olarak oku. Bizim taraf: ${side}. Her önemli maddeyi ve eksik kalan korumayı bulgu olarak yaz. verdict: bizim taraf için lehte/aleyhte, eksik (olması gereken madde yok) ya da notr. quote alanına sözleşmeden HARFİ HARFİNE kısa bir parça kopyala (eksik maddede boş bırak). basis: dayanak kanun maddesi veya yerleşik içtihat. suggestion: önerilen madde metni. summary: 3-5 cümlelik genel değerlendirme.`,
    messages: [{ role: 'user', content: contractContext(db, user, contractId) }],
    schema: CONTRACT_SCHEMA,
    effort: 'high',
  });
  const out = JSON.parse(r.text) as { summary: string; findings: { quote: string; verified?: boolean }[] };
  const body = norm(c.body);
  for (const f of out.findings) f.verified = !f.quote || body.includes(norm(f.quote));
  saveResult(db, user, 'sozlesme', contractId, c.case_id ?? null, side, out, r.model);
  return { ...out, model: r.model, created_at: new Date().toISOString() };
}

/* ---------- Karar: davaya göre lehte / aleyhte ---------- */

const DECISION_SCHEMA = {
  type: 'object',
  properties: {
    side: { type: 'string', enum: ['lehte', 'aleyhte', 'notr'] },
    principle: { type: 'string' },
    reason: { type: 'string' },
    quote: { type: 'string' },
    use: { type: 'string' },
  },
  required: ['side', 'principle', 'reason', 'quote', 'use'],
  additionalProperties: false,
};

export async function classifyDecision(db: DB, user: User, input: { caseId?: number; decisionId?: number; text?: string; title?: string }, model: AiModel | null) {
  const ai = need(model);
  const caseId = Number(input.caseId);
  if (!caseId) throw new ApiError(400, 'Dava dosyası seçin.');
  let text = String(input.text ?? '');
  let title = String(input.title ?? '');
  const decisionId = input.decisionId ? Number(input.decisionId) : null;
  if (decisionId) {
    const d = db.prepare('SELECT court, chamber, esas_no, karar_no, text FROM decisions WHERE id = ?').get(decisionId) as
      | { court: string; chamber: string; esas_no: string; karar_no: string; text: string }
      | undefined;
    if (!d) throw new ApiError(404, 'Karar bulunamadı.');
    text = d.text;
    title = `${d.court} ${d.chamber} E. ${d.esas_no} K. ${d.karar_no}`.replace(/\s+/g, ' ');
  }
  if (!text.trim()) throw new ApiError(400, 'Karar metni boş.');
  const r = await ai({
    system: `${COMMON}\n\nGörev: Verilen kararın, verilen davada müvekkilimizin lehine mi aleyhine mi olduğunu değerlendir. side: lehte/aleyhte/notr. principle: kararın koyduğu ilke (bir iki cümle). reason: neden lehte/aleyhte. quote: karardan bu ilkeyi gösteren cümleyi HARFİ HARFİNE kopyala. use: dilekçede nasıl kullanılır ya da karşı tarafın kullanmasına nasıl cevap verilir.`,
    messages: [{ role: 'user', content: `${caseContext(db, user, caseId)}\n\n<karar baslik="${title}">\n${cut(text, 60000)}\n</karar>` }],
    schema: DECISION_SCHEMA,
    effort: 'high',
  });
  const out = JSON.parse(r.text) as { side: string; principle: string; reason: string; quote: string; use: string };
  const verified = !out.quote || norm(text).includes(norm(out.quote));
  const result = { ...out, verified, title };
  saveResult(db, user, 'ictihat', decisionId, caseId, title, result, r.model);
  return { ...result, model: r.model };
}

/* ---------- İnfaz hesabı ---------- */

const INFAZ_SCHEMA = {
  type: 'object',
  properties: {
    category: { type: 'string' },
    ratio_num: { type: 'integer' },
    ratio_den: { type: 'integer' },
    fixed_days: { type: 'integer' },
    ds_days: { type: 'integer' },
    ratio_basis: { type: 'string' },
    ds_basis: { type: 'string' },
    steps: { type: 'array', items: { type: 'string' } },
    warnings: { type: 'array', items: { type: 'string' } },
  },
  required: ['category', 'ratio_num', 'ratio_den', 'fixed_days', 'ds_days', 'ratio_basis', 'ds_basis', 'steps', 'warnings'],
  additionalProperties: false,
};

export interface InfazInput {
  crime?: string;
  years?: number;
  months?: number;
  days?: number;
  life?: '' | 'muebbet' | 'agirlastirilmis';
  offenseDate?: string;
  startDate?: string;
  outsideDays?: number;
  ageAtOffense?: number;
  recidivist?: boolean;
  details?: string;
  caseId?: number | null;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const toDate = (s: string) => new Date(`${s}T00:00:00Z`);
const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (s: string, n: number) => {
  const d = toDate(s);
  d.setUTCDate(d.getUTCDate() + n);
  return iso(d);
};

/** Takvime göre ceza süresinin gün karşılığı (başlangıç tarihinden itibaren yıl/ay/gün eklenerek). */
export function sentenceDays(start: string, years: number, months: number, days: number) {
  const d = toDate(start);
  d.setUTCFullYear(d.getUTCFullYear() + years);
  d.setUTCMonth(d.getUTCMonth() + months);
  d.setUTCDate(d.getUTCDate() + days);
  return Math.round((d.getTime() - toDate(start).getTime()) / 86400000);
}

/** Oran ve denetimli serbestlik süresi belliyken tarihleri hesaplar (yapay zekâdan bağımsız, test edilir). */
export function infazDates(input: { startDate: string; totalDays: number; ratioNum: number; ratioDen: number; fixedDays: number; dsDays: number; outsideDays: number }) {
  const conditional = input.fixedDays > 0 ? input.fixedDays : Math.ceil((input.totalDays * input.ratioNum) / Math.max(input.ratioDen, 1));
  const kosullu = addDays(input.startDate, conditional + input.outsideDays);
  const ds = input.dsDays > 0 ? addDays(kosullu, -Math.min(input.dsDays, conditional)) : kosullu;
  return {
    conditional_days: conditional,
    kosullu_tarih: kosullu,
    ds_tarih: ds < input.startDate ? input.startDate : ds,
    ceza_bitis: input.totalDays > 0 ? addDays(input.startDate, input.totalDays + input.outsideDays) : '',
  };
}

export async function infazCalc(db: DB, user: User, input: InfazInput, model: AiModel | null) {
  const ai = need(model);
  const years = Math.max(0, Math.floor(Number(input.years) || 0));
  const months = Math.max(0, Math.floor(Number(input.months) || 0));
  const days = Math.max(0, Math.floor(Number(input.days) || 0));
  const life = input.life === 'muebbet' || input.life === 'agirlastirilmis' ? input.life : '';
  if (!life && years + months + days === 0) throw new ApiError(400, 'Ceza süresini girin.');
  if (!input.startDate || !DATE.test(input.startDate)) throw new ApiError(400, 'Cezaevine giriş (ilk gözaltı/tutuklama) tarihini girin.');
  if (input.offenseDate && !DATE.test(input.offenseDate)) throw new ApiError(400, 'Suç tarihi geçersiz.');
  if (!String(input.crime ?? '').trim()) throw new ApiError(400, 'Suçu yazın (ör. "TCK 142 nitelikli hırsızlık").');
  const caseId = input.caseId ? Number(input.caseId) : null;
  if (caseId) assertCaseVisible(db, user, caseId);
  const outsideDays = Math.max(0, Math.floor(Number(input.outsideDays) || 0));
  const totalDays = life ? 0 : sentenceDays(input.startDate, years, months, days);
  const facts = `Suç: ${input.crime}
Ceza: ${life ? (life === 'muebbet' ? 'müebbet hapis' : 'ağırlaştırılmış müebbet hapis') : `${years} yıl ${months} ay ${days} gün hapis (${totalDays} gün)`}
Suç tarihi: ${input.offenseDate || 'belirtilmedi'}
Cezaevine giriş (ilk gözaltı/tutuklama): ${input.startDate}
Hükümlünün suç tarihindeki yaşı: ${input.ageAtOffense ?? 'belirtilmedi'}
Tekerrür: ${input.recidivist ? 'var' : 'yok'}
Ek bilgi: ${input.details || '-'}`;
  const r = await ai({
    system: `${COMMON}\n\nGörev: ${MODES.infaz.prompt}
Hükümlü için koşullu salıverilme oranını ve denetimli serbestlik süresini belirle. Suç tarihine göre uygulanacak hükmü (geçici maddeler, lehe kanun) dikkate al.
JSON: category (suçun infaz rejimi bakımından türü), ratio_num/ratio_den (koşullu salıverilme oranı, ör. 1/2 → 1 ve 2; müebbette 0 ve 1), fixed_days (müebbet gibi sabit süreli rejimde koşullu salıverilme için yatılacak gün; değilse 0), ds_days (koşullu salıverilmeden önce denetimli serbestlikte geçirilebilecek en fazla gün; uygulanmıyorsa 0), ratio_basis ve ds_basis (madde numarasıyla dayanak), steps (hesabın adımları), warnings (belirsizlikler, istisnalar, teyit edilmesi gerekenler).
Tarih hesabını sen yapma; sunucu oran ve günlerden tarihleri hesaplayacak.`,
    messages: [{ role: 'user', content: facts }],
    schema: INFAZ_SCHEMA,
    effort: 'high',
  });
  const rule = JSON.parse(r.text) as { category: string; ratio_num: number; ratio_den: number; fixed_days: number; ds_days: number; ratio_basis: string; ds_basis: string; steps: string[]; warnings: string[] };
  if (!rule.fixed_days && (!rule.ratio_den || rule.ratio_num <= 0 || rule.ratio_num > rule.ratio_den)) throw new ApiError(422, 'Yapay zekâ geçerli bir koşullu salıverilme oranı veremedi; bilgileri ayrıntılandırıp tekrar deneyin.');
  const dates = infazDates({ startDate: input.startDate, totalDays, ratioNum: rule.ratio_num, ratioDen: rule.ratio_den, fixedDays: rule.fixed_days, dsDays: rule.ds_days, outsideDays });
  const result = { ...rule, ...dates, total_days: totalDays, outside_days: outsideDays, start_date: input.startDate };
  saveResult(db, user, 'infaz', null, caseId, facts, result, r.model);
  return { ...result, model: r.model };
}

/* ---------- Kayıtlı sonuçlar ---------- */

function saveResult(db: DB, user: User, kind: string, refId: number | null, caseId: number | null, input: string, result: unknown, model: string) {
  db.prepare('INSERT INTO ai_results (office_id, kind, ref_id, case_id, input, result, model, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
    user.office_id,
    kind,
    refId,
    caseId,
    input,
    JSON.stringify(result),
    model,
    user.id,
  );
}

/** Bir kaydın son yapay zekâ sonucu (ör. sözleşmenin son okuması). */
export function lastResult(db: DB, user: User, kind: string, refId: number) {
  if (kind === 'sozlesme') getContract(db, user, refId);
  const r = db
    .prepare('SELECT result, model, created_at FROM ai_results WHERE office_id = ? AND kind = ? AND ref_id = ? ORDER BY id DESC LIMIT 1')
    .get(user.office_id, kind, refId) as { result: string; model: string; created_at: string } | undefined;
  return r ? { ...JSON.parse(r.result), model: r.model, created_at: r.created_at } : null;
}

/** Kullanıcının son infaz hesapları. */
export function infazHistory(db: DB, user: User) {
  return (
    db
      .prepare("SELECT id, input, result, created_at FROM ai_results WHERE office_id = ? AND kind = 'infaz' AND created_by = ? ORDER BY id DESC LIMIT 20")
      .all(user.office_id, user.id) as { id: number; input: string; result: string; created_at: string }[]
  ).map((r) => ({ id: r.id, input: r.input, created_at: r.created_at, ...JSON.parse(r.result) }));
}
