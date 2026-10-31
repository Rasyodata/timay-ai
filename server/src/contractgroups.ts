/*
 * Sözleşme dosyaları ve sözleşme yaşam döngüsü.
 * - Dosya: bir işin birden çok sözleşmesi ya da toplu incelenen benzer sözleşmeler (ör. 10 kat karşılığı).
 *   Her sözleşmenin riski ayrı, dosyanın toplu riski ve ortak sorunları birlikte hesaplanır.
 * - Fesih: sözleşme sona erdirilir, açık taahhütler kapatılır, fesih bildirimi taslağı hazırlanır.
 * - Yenileme: eski sözleşme kapatılıp yerine yenisi açılır; açık taahhütler istenirse taşınır.
 * - Ek sözleşme: asıl sözleşmeye bağlı ek protokol.
 */
import type { User } from './auth.ts';
import { bandOf, combinedRisk, getPlaybook, setSide, TOPICS, type Side } from './clm.ts';
import { createContract, getContract } from './contracts.ts';
import type { DB } from './db.ts';
import { ApiError } from './errors.ts';
import { ownedCaseId } from './money.ts';

interface GroupRow {
  id: number;
  title: string;
  kind: string;
  side: string;
  case_id: number | null;
  note: string;
  created_at: string;
}

const SIDES = ['arsa_sahibi', 'yuklenici', 'genel', ''];

function loadGroup(db: DB, user: User, id: number) {
  const g = db.prepare('SELECT id, title, kind, side, case_id, note, created_at FROM contract_groups WHERE id = ? AND office_id = ?').get(id, user.office_id) as
    | GroupRow
    | undefined;
  if (!g) throw new ApiError(404, 'Sözleşme dosyası bulunamadı.');
  return g;
}

export function listGroups(db: DB, user: User) {
  return db
    .prepare(
      `SELECT g.id, g.title, g.kind, g.side, g.created_at,
        (SELECT COUNT(*) FROM contracts c WHERE c.group_id = g.id) AS contracts,
        (SELECT COALESCE(SUM(value_kurus), 0) FROM contracts c WHERE c.group_id = g.id) AS value_kurus
       FROM contract_groups g WHERE g.office_id = ? ORDER BY g.id DESC`,
    )
    .all(user.office_id);
}

export function createGroup(db: DB, user: User, input: { title?: string; kind?: string; side?: string; caseId?: number | null; note?: string }) {
  if (!input.title?.trim()) throw new ApiError(400, 'Dosya adı zorunludur.');
  if (input.side && !SIDES.includes(input.side)) throw new ApiError(400, 'Geçersiz taraf.');
  const r = db
    .prepare('INSERT INTO contract_groups (office_id, title, kind, side, case_id, note, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(user.office_id, input.title.trim(), input.kind ?? '', input.side ?? '', ownedCaseId(db, user.office_id, input.caseId), input.note ?? '', user.id);
  return getGroup(db, user, Number(r.lastInsertRowid));
}

export function updateGroup(db: DB, user: User, id: number, input: { title?: string; note?: string; side?: string }) {
  const g = loadGroup(db, user, id);
  if (input.side !== undefined && !SIDES.includes(input.side)) throw new ApiError(400, 'Geçersiz taraf.');
  db.prepare('UPDATE contract_groups SET title = ?, note = ?, side = ? WHERE id = ?').run(
    input.title?.trim() || g.title,
    input.note ?? g.note,
    input.side ?? g.side,
    id,
  );
  return getGroup(db, user, id);
}

export function deleteGroup(db: DB, user: User, id: number) {
  loadGroup(db, user, id);
  // Sözleşmeler silinmez, dosyadan çıkarılır.
  db.prepare('UPDATE contracts SET group_id = NULL WHERE group_id = ? AND office_id = ?').run(id, user.office_id);
  db.prepare('DELETE FROM contract_groups WHERE id = ?').run(id);
  return { ok: true };
}

/** Var olan sözleşmeleri dosyaya ekler (ya da groupId null ile çıkarır). */
export function moveContracts(db: DB, user: User, groupId: number | null, ids: number[]) {
  if (groupId !== null) loadGroup(db, user, groupId);
  const st = db.prepare('UPDATE contracts SET group_id = ? WHERE id = ? AND office_id = ?');
  db.transaction(() => ids.forEach((id) => st.run(groupId, Number(id), user.office_id)))();
  return groupId === null ? { ok: true } : getGroup(db, user, groupId);
}

/** Toplu sözleşme ekleme: her dosya ayrı bir sözleşme olur. */
export function bulkAdd(
  db: DB,
  user: User,
  groupId: number,
  input: { items?: { title?: string; body?: string; parties?: string; value?: number | string }[]; kind?: string; side?: string },
) {
  const g = loadGroup(db, user, groupId);
  const items = (input.items ?? []).filter((i) => i.title?.trim() || i.body?.trim());
  if (!items.length) throw new ApiError(400, 'Eklenecek sözleşme yok.');
  if (items.length > 60) throw new ApiError(400, 'Bir seferde en çok 60 sözleşme eklenebilir.');
  const kind = input.kind ?? g.kind;
  const side = input.side ?? g.side;
  db.transaction(() => {
    items.forEach((it, i) => {
      const c = createContract(db, user, {
        title: it.title?.trim() || `${g.title} – ${i + 1}`,
        kind,
        body: it.body ?? '',
        parties: it.parties ?? '',
        value: it.value,
        caseId: g.case_id,
      });
      db.prepare('UPDATE contracts SET group_id = ? WHERE id = ?').run(groupId, c.id);
      if (side && side !== 'genel') setSide(db, user, c.id, side);
    });
  })();
  return getGroup(db, user, groupId);
}

/** Dosyanın sözleşmeleri, her birinin riski, toplu risk ve ortak sorunlar. */
export function getGroup(db: DB, user: User, id: number) {
  const g = loadGroup(db, user, id);
  const rows = db
    .prepare(
      `SELECT c.id, c.title, c.kind, c.side, c.body, c.status, c.value_kurus, c.end_date, c.relation, c.parent_id, c.terminated_at,
        (SELECT COUNT(*) FROM contract_obligations o WHERE o.contract_id = c.id AND o.done = 0) AS open_obligations,
        (SELECT COUNT(*) FROM contract_obligations o WHERE o.contract_id = c.id AND o.done = 0 AND o.due_date != '' AND o.due_date < date('now')) AS late_obligations
       FROM contracts c WHERE c.group_id = ? AND c.office_id = ? ORDER BY c.id`,
    )
    .all(id, user.office_id) as {
    id: number;
    title: string;
    kind: string;
    side: string;
    body: string;
    status: string;
    value_kurus: number;
    end_date: string;
    relation: string;
    parent_id: number | null;
    terminated_at: string;
    open_obligations: number;
    late_obligations: number;
  }[];
  const pb = getPlaybook(db, user);
  const issues = new Map<string, { key: string; title: string; topic: string; severity: string; verdict: string; contracts: { id: number; title: string }[] }>();
  const contracts = rows.map((c) => {
    const { body, ...rest } = c;
    if (!body.trim()) return { ...rest, risk: null as null | { genel: number; madde: number; ictihat: number; band: string }, against: 0, missing: 0 };
    const side = (c.side || g.side || 'genel') as Side;
    const r = combinedRisk(body, c.kind, side, pb);
    for (const f of r.result.findings) {
      if (f.verdict === 'lehte') continue;
      const cur = issues.get(f.key) ?? { key: f.key, title: f.title, topic: TOPICS[f.topic] ?? f.topic, severity: f.severity, verdict: f.verdict, contracts: [] };
      cur.contracts.push({ id: c.id, title: c.title });
      issues.set(f.key, cur);
    }
    return {
      ...rest,
      risk: { genel: r.risk.genel, madde: r.risk.madde, ictihat: r.risk.ictihat, band: r.risk.band },
      against: r.result.findings.filter((f) => f.verdict === 'aleyhte').length,
      missing: r.result.findings.filter((f) => f.verdict === 'eksik').length,
    };
  });
  const scored = contracts.filter((c) => c.risk);
  const scores = scored.map((c) => c.risk!.genel);
  const totalValue = rows.reduce((s, c) => s + c.value_kurus, 0);
  // Toplu risk: değere göre ağırlıklı ortalama; değer yoksa düz ortalama. En riskli sözleşme ayrıca gösterilir.
  const weighted = scored.reduce((s, c) => s + c.risk!.genel * (c.value_kurus || 1), 0) / Math.max(1, scored.reduce((s, c) => s + (c.value_kurus || 1), 0));
  const avg = scores.length ? Math.round(weighted) : 0;
  const max = scores.length ? Math.max(...scores) : 0;
  const worst = scored.find((c) => c.risk!.genel === max) ?? null;
  // Toplu risk, en kötü sözleşmeyi de hesaba katar: tek bir çok riskli sözleşme bütün işi etkiler.
  const toplu = scores.length ? Math.round(avg * 0.7 + max * 0.3) : 0;
  const sevRank = { yuksek: 0, orta: 1, dusuk: 2 } as Record<string, number>;
  const common = [...issues.values()].sort((a, b) => b.contracts.length - a.contracts.length || sevRank[a.severity] - sevRank[b.severity]);
  return {
    ...g,
    contracts,
    summary: {
      count: rows.length,
      reviewed: scored.length,
      toplu,
      band: bandOf(toplu),
      average: avg,
      max,
      worst: worst && { id: worst.id, title: worst.title },
      bands: { dusuk: scored.filter((c) => c.risk!.band === 'dusuk').length, orta: scored.filter((c) => c.risk!.band === 'orta').length, yuksek: scored.filter((c) => c.risk!.band === 'yuksek').length },
      value_kurus: totalValue,
      open_obligations: rows.reduce((s, c) => s + c.open_obligations, 0),
      late_obligations: rows.reduce((s, c) => s + c.late_obligations, 0),
      active: rows.filter((c) => c.status === 'yururlukte').length,
      terminated: rows.filter((c) => c.terminated_at).length,
    },
    /** Birden çok sözleşmede tekrar eden sorunlar en üstte: tek düzeltmeyle hepsine uygulanabilir. */
    common: common.slice(0, 25),
  };
}

// ---------------------------------------------------------------- yaşam döngüsü

function loadContract(db: DB, user: User, id: number) {
  const c = db.prepare('SELECT * FROM contracts WHERE id = ? AND office_id = ?').get(id, user.office_id) as
    | { id: number; title: string; kind: string; side: string; parties: string; body: string; status: string; value_kurus: number; case_id: number | null; group_id: number | null; terminated_at: string }
    | undefined;
  if (!c) throw new ApiError(404, 'Sözleşme bulunamadı.');
  return c;
}

function trDate(iso: string) {
  const [y, m, d] = iso.split('-');
  return `${d}.${m}.${y}`;
}

/** Sözleşmeyi fesheder: sona erdi yapar, açık taahhütleri kapatır, fesih bildirimi taslağı döner. */
export function terminateContract(db: DB, user: User, id: number, input: { date?: string; reason?: string; closeObligations?: boolean }) {
  const c = loadContract(db, user, id);
  if (c.terminated_at) throw new ApiError(400, 'Bu sözleşme zaten feshedilmiş.');
  const date = input.date && /^\d{4}-\d{2}-\d{2}$/.test(input.date) ? input.date : new Date().toISOString().slice(0, 10);
  const reason = input.reason?.trim() ?? '';
  const open = db.prepare('SELECT COUNT(*) AS n FROM contract_obligations WHERE contract_id = ? AND done = 0').get(id) as { n: number };
  db.transaction(() => {
    db.prepare("UPDATE contracts SET status = 'sona_erdi', terminated_at = ?, termination_reason = ? WHERE id = ?").run(date, reason, id);
    if (input.closeObligations !== false) db.prepare('UPDATE contract_obligations SET done = 1 WHERE contract_id = ? AND done = 0').run(id);
  })();
  const notice = `İHTARNAME (FESİH BİLDİRİMİ)

KEŞİDECİ: [MÜVEKKİL], [ADRES]
VEKİLİ: Av. [AD SOYAD]
MUHATAP: ${c.parties || '[KARŞI TARAF]'}
KONU: "${c.title}" başlıklı sözleşmenin feshi hakkındadır.

AÇIKLAMALAR:
1. Taraflar arasında "${c.title}" başlıklı sözleşme bulunmaktadır.
2. ${reason || '[Fesih sebebi: temerrüt, sözleşmeye aykırılık, haklı sebep …]'}
3. Bu nedenle sözleşme ${trDate(date)} tarihi itibarıyla feshedilmiştir. Fesihten doğan alacak ve tazminat haklarımız saklıdır.

İşbu ihtarnamenin tebliğinden itibaren [7] gün içinde [teslim / ödeme / tahliye] yükümlülüğünüzü yerine getirmenizi, aksi halde yasal yollara başvurulacağını ihtar ederiz.

Keşideci Vekili
Av. [AD SOYAD] (imza)`;
  return { contract: getContract(db, user, id), closedObligations: input.closeObligations === false ? 0 : open.n, notice };
}

/** Yeni sözleşme: eskisi kapatılır, yenisi aynı tür, taraf ve dosyayla açılır; açık taahhütler istenirse taşınır. */
export function renewContract(db: DB, user: User, id: number, input: { title?: string; body?: string; carryObligations?: boolean; startDate?: string; endDate?: string }) {
  const c = loadContract(db, user, id);
  const today = new Date().toISOString().slice(0, 10);
  let created = 0;
  const next = db.transaction(() => {
    const n = createContract(db, user, {
      title: input.title?.trim() || `${c.title} (yeni)`,
      kind: c.kind,
      parties: c.parties,
      body: input.body ?? c.body,
      value: c.value_kurus / 100,
      startDate: input.startDate,
      endDate: input.endDate,
      caseId: c.case_id,
    });
    db.prepare("UPDATE contracts SET parent_id = ?, relation = 'yenileme', group_id = ?, side = ? WHERE id = ?").run(id, c.group_id, c.side, n.id);
    const open = db.prepare('SELECT party, text, due_date, amount_kurus, direction, source FROM contract_obligations WHERE contract_id = ? AND done = 0').all(id) as {
      party: string;
      text: string;
      due_date: string;
      amount_kurus: number;
      direction: string;
      source: string;
    }[];
    if (input.carryObligations) {
      const ins = db.prepare('INSERT INTO contract_obligations (contract_id, party, text, due_date, amount_kurus, direction, source) VALUES (?, ?, ?, ?, ?, ?, ?)');
      for (const o of open) ins.run(n.id, o.party, o.text, o.due_date, o.amount_kurus, o.direction, o.source);
      created = open.length;
    }
    db.prepare('UPDATE contract_obligations SET done = 1 WHERE contract_id = ? AND done = 0').run(id);
    db.prepare("UPDATE contracts SET status = 'sona_erdi', terminated_at = CASE WHEN terminated_at = '' THEN ? ELSE terminated_at END, termination_reason = CASE WHEN termination_reason = '' THEN 'Yeni sözleşme ile yenilendi' ELSE termination_reason END WHERE id = ?").run(
      today,
      id,
    );
    return n.id;
  })();
  return { contract: getContract(db, user, next), carriedObligations: created };
}

/** Asıl sözleşmeye bağlı ek sözleşme (ek protokol). */
export function addAddendum(db: DB, user: User, id: number, input: { title?: string; body?: string }) {
  const c = loadContract(db, user, id);
  const count = (db.prepare("SELECT COUNT(*) AS n FROM contracts WHERE parent_id = ? AND relation = 'ek'").get(id) as { n: number }).n;
  const no = count + 1;
  const body =
    input.body ??
    `EK SÖZLEŞME – ${no}
("${c.title}" sözleşmesinin ekidir)

TARAFLAR: ${c.parties || '[TARAFLAR]'}

Madde 1 – Konu
Taraflar arasındaki "${c.title}" başlıklı sözleşmenin aşağıdaki hükümleri bu ek sözleşme ile değiştirilmiştir.

Madde 2 – Değişiklikler
[Asıl sözleşmenin … maddesi şu şekilde değiştirilmiştir: …]

Madde 3 – Diğer hükümler
Asıl sözleşmenin bu ek ile değiştirilmeyen hükümleri aynen geçerlidir. Bu ek sözleşme asıl sözleşmenin ayrılmaz parçasıdır.

Madde 4 – Yürürlük
Bu ek sözleşme taraflarca imzalandığı [GG.AA.YYYY] tarihinde yürürlüğe girer.

[TARAF 1 İMZA]            [TARAF 2 İMZA]`;
  const n = createContract(db, user, {
    title: input.title?.trim() || `${c.title} – Ek ${no}`,
    kind: c.kind,
    parties: c.parties,
    body,
    caseId: c.case_id,
  });
  db.prepare("UPDATE contracts SET parent_id = ?, relation = 'ek', group_id = ?, side = ? WHERE id = ?").run(id, c.group_id, c.side, n.id);
  return getContract(db, user, n.id);
}

/** Sözleşmenin asıl/ek/yenileme bağları. */
export function relations(db: DB, user: User, id: number) {
  const c = db.prepare('SELECT parent_id, relation, group_id FROM contracts WHERE id = ? AND office_id = ?').get(id, user.office_id) as
    | { parent_id: number | null; relation: string; group_id: number | null }
    | undefined;
  if (!c) throw new ApiError(404, 'Sözleşme bulunamadı.');
  const parent = c.parent_id ? db.prepare('SELECT id, title, status FROM contracts WHERE id = ?').get(c.parent_id) : null;
  const children = db.prepare('SELECT id, title, status, relation, created_at FROM contracts WHERE parent_id = ? ORDER BY id').all(id);
  const group = c.group_id ? db.prepare('SELECT id, title FROM contract_groups WHERE id = ?').get(c.group_id) : null;
  return { relation: c.relation, parent, children, group };
}
