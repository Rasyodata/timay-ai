import type { User } from './auth.ts';
import type { DB } from './db.ts';
import { ApiError } from './errors.ts';
import { optionalDate, ownedCaseId, toKurus } from './money.ts';

/**
 * Miras yönetimi: yasal mirasçılık payları (TMK 495-499), saklı paylar (TMK 506),
 * net tereke ve ölüm tarihinden doğan süreler.
 */

export const RELATIONS = ['es', 'cocuk', 'torun', 'anne', 'baba', 'kardes', 'buyukebeveyn'];
const SIDES = ['', 'anne', 'baba', 'iki'];

// ---------- Kesir ----------
type Frac = [number, number];
const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : Math.abs(a));
const norm = ([n, d]: Frac): Frac => {
  const g = gcd(n, d) || 1;
  return [n / g, d / g];
};
const mul = (a: Frac, b: Frac): Frac => norm([a[0] * b[0], a[1] * b[1]]);
const div = (a: Frac, k: number): Frac => norm([a[0], a[1] * k]);
const add = (a: Frac, b: Frac): Frac => norm([a[0] * b[1] + b[0] * a[1], a[1] * b[1]]);
const ZERO: Frac = [0, 1];

export interface Heir {
  id: number;
  name: string;
  relation: string;
  alive: number | boolean;
  parent_id: number | null;
  side: string;
}

export interface HeirShare {
  id: number;
  share: Frac;
  reserved: Frac;
  note: string;
}

/** Yasal paylar. Dönen dizide pay almayanlar 0 pay ve açıklamayla yer alır. */
export function legalShares(heirs: Heir[]): { shares: HeirShare[]; group: string; warnings: string[] } {
  const result = new Map<number, HeirShare>(heirs.map((h) => [h.id, { id: h.id, share: ZERO, reserved: ZERO, note: '' }]));
  const give = (id: number, f: Frac) => {
    const r = result.get(id)!;
    r.share = add(r.share, f);
  };
  const alive = (h: Heir) => Boolean(h.alive);
  const spouse = heirs.find((h) => h.relation === 'es' && alive(h));
  const warnings: string[] = [];
  let group = '';
  let spouseShare: Frac = [1, 1];

  // 1. zümre: altsoy (çocuklar; ölmüş çocuğun yerine onun çocukları)
  const stirps = heirs
    .filter((h) => h.relation === 'cocuk')
    .map((child) => ({ child, grandchildren: heirs.filter((g) => g.relation === 'torun' && g.parent_id === child.id && alive(g)) }))
    .filter((s) => alive(s.child) || s.grandchildren.length > 0);

  if (stirps.length > 0) {
    group = 'Birinci zümre (altsoy)';
    const pool: Frac = spouse ? [3, 4] : [1, 1];
    spouseShare = [1, 4];
    for (const s of stirps) {
      const part = div(pool, stirps.length);
      if (alive(s.child)) give(s.child.id, part);
      else for (const g of s.grandchildren) give(g.id, div(part, s.grandchildren.length));
    }
  } else {
    // 2. zümre: anne, baba ve onların altsoyu (kardeşler)
    const parentSide = (side: 'anne' | 'baba') => {
      const parent = heirs.find((h) => h.relation === side);
      const siblings = heirs.filter((h) => h.relation === 'kardes' && alive(h) && (h.side === side || h.side === 'iki' || h.side === ''));
      return { parent: parent && alive(parent) ? parent : undefined, siblings };
    };
    const mother = parentSide('anne');
    const father = parentSide('baba');
    const hasSide = (s: typeof mother) => Boolean(s.parent) || s.siblings.length > 0;

    if (hasSide(mother) || hasSide(father)) {
      group = 'İkinci zümre (anne, baba ve kardeşler)';
      const pool: Frac = spouse ? [1, 2] : [1, 1];
      spouseShare = [1, 2];
      const sides = [mother, father].filter(hasSide);
      // Bir tarafta kimse yoksa o tarafın payı diğer tarafa geçer (TMK 496/3).
      for (const s of sides) {
        const part = div(pool, sides.length === 2 ? 2 : 1);
        if (s.parent) give(s.parent.id, part);
        else for (const sib of s.siblings) give(sib.id, div(part, s.siblings.length));
      }
      if (heirs.some((h) => h.relation === 'kardes' && h.side === '')) {
        warnings.push('Bazı kardeşlerin ana-baba bir mi, yalnız anne ya da baba bir mi olduğu seçilmedi; tam kardeş sayıldı.');
      }
    } else {
      const grandparents = heirs.filter((h) => h.relation === 'buyukebeveyn' && alive(h));
      if (grandparents.length > 0) {
        group = 'Üçüncü zümre (büyükanne ve büyükbabalar)';
        const pool: Frac = spouse ? [1, 4] : [1, 1];
        spouseShare = [3, 4];
        for (const g of grandparents) give(g.id, div(pool, grandparents.length));
        warnings.push('Üçüncü zümrede ölmüş büyükanne-büyükbabanın altsoyu (amca, hala, dayı, teyze) hesaba katılmadı; uzman kontrolü gerekir.');
      } else if (spouse) {
        group = 'Yalnızca sağ kalan eş';
        spouseShare = [1, 1];
      } else {
        group = 'Yasal mirasçı yok';
        warnings.push('Yasal mirasçı bulunmadığında miras Devlete kalır (TMK 501).');
      }
    }
  }
  if (spouse) give(spouse.id, spouseShare);

  // Saklı paylar (TMK 506): altsoy 1/2, anne-baba 1/4, eş altsoy veya anne-baba ile tamamı, diğer hallerde 3/4.
  for (const h of heirs) {
    const r = result.get(h.id)!;
    if (!alive(h)) r.note = 'Vefat etmiş';
    else if (r.share[0] === 0) r.note = 'Önde gelen mirasçı olduğu için pay almıyor';
    const rate: Frac =
      h.relation === 'cocuk' || h.relation === 'torun'
        ? [1, 2]
        : h.relation === 'anne' || h.relation === 'baba'
          ? [1, 4]
          : h.relation === 'es'
            ? group.startsWith('Birinci') || group.startsWith('İkinci')
              ? [1, 1]
              : [3, 4]
            : ZERO;
    r.reserved = mul(r.share, rate);
  }
  return { shares: [...result.values()], group, warnings };
}

// ---------- Süreler ----------
function addMonths(iso: string, months: number) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
}

export function estateDeadlines(deathDate: string) {
  if (!deathDate) return [];
  return [
    { title: 'Mirasın reddi (TMK 606)', date: addMonths(deathDate, 3), note: 'Ölümü öğrenmeden itibaren 3 ay; sulh hukuk mahkemesine beyan.' },
    { title: 'Veraset ve intikal vergisi beyannamesi', date: addMonths(deathDate, 4), note: 'Ölüm Türkiye’de gerçekleştiyse 4 ay (VİVK 10).' },
    { title: 'Resmî defter tutulması talebi (TMK 619)', date: addMonths(deathDate, 1), note: 'Mirasçılar 1 ay içinde isteyebilir.' },
    { title: 'Tenkis davası', date: addMonths(deathDate, 120), note: 'Saklı payın zedelendiğini öğrenmeden 1 yıl, her halde 10 yıl (TMK 571).' },
  ];
}

// ---------- Kayıtlar ----------
interface EstateRow {
  id: number;
  office_id: number;
  deceased: string;
  death_date: string;
  client: string;
  case_id: number | null;
  note: string;
}

function load(db: DB, user: User, id: number): EstateRow {
  const row = db.prepare('SELECT * FROM estates WHERE id = ? AND office_id = ?').get(id, user.office_id) as EstateRow | undefined;
  if (!row) throw new ApiError(404, 'Miras dosyası bulunamadı.');
  return row;
}

export function listEstates(db: DB, user: User) {
  return db
    .prepare(
      `SELECT e.*, k.title AS case_title,
        (SELECT COUNT(*) FROM estate_heirs h WHERE h.estate_id = e.id) AS heir_count,
        (SELECT COALESCE(SUM(CASE WHEN kind = 'varlik' THEN value_kurus ELSE -value_kurus END), 0) FROM estate_items i WHERE i.estate_id = e.id) AS net_kurus
       FROM estates e LEFT JOIN cases k ON k.id = e.case_id WHERE e.office_id = ? ORDER BY e.id DESC`,
    )
    .all(user.office_id);
}

export function createEstate(db: DB, user: User, input: { deceased?: string; deathDate?: string; client?: string; caseId?: number | null; note?: string }) {
  if (!input.deceased?.trim()) throw new ApiError(400, 'Murisin adı zorunludur.');
  const r = db
    .prepare('INSERT INTO estates (office_id, deceased, death_date, client, case_id, note, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(
      user.office_id,
      input.deceased.trim(),
      optionalDate(input.deathDate, 'Ölüm tarihi'),
      input.client ?? '',
      ownedCaseId(db, user.office_id, input.caseId),
      input.note ?? '',
      user.id,
    );
  return getEstate(db, user, Number(r.lastInsertRowid));
}

export function updateEstate(db: DB, user: User, id: number, input: { deceased?: string; deathDate?: string; client?: string; caseId?: number | null; note?: string }) {
  const e = load(db, user, id);
  db.prepare('UPDATE estates SET deceased = ?, death_date = ?, client = ?, case_id = ?, note = ? WHERE id = ?').run(
    input.deceased?.trim() || e.deceased,
    input.deathDate !== undefined ? optionalDate(input.deathDate, 'Ölüm tarihi') : e.death_date,
    input.client ?? e.client,
    input.caseId !== undefined ? ownedCaseId(db, user.office_id, input.caseId) : e.case_id,
    input.note ?? e.note,
    id,
  );
  return getEstate(db, user, id);
}

export function getEstate(db: DB, user: User, id: number) {
  const e = load(db, user, id);
  const heirs = db.prepare('SELECT * FROM estate_heirs WHERE estate_id = ? ORDER BY id').all(id) as Heir[];
  const items = db.prepare('SELECT * FROM estate_items WHERE estate_id = ? ORDER BY kind DESC, id').all(id) as {
    kind: string;
    value_kurus: number;
  }[];
  const assets = items.filter((i) => i.kind === 'varlik').reduce((n, i) => n + i.value_kurus, 0);
  const debts = items.filter((i) => i.kind === 'borc').reduce((n, i) => n + i.value_kurus, 0);
  const net = assets - debts;
  const calc = legalShares(heirs);
  const shares = calc.shares.map((s) => ({
    ...s,
    amount_kurus: net > 0 ? Math.round((net * s.share[0]) / s.share[1]) : 0,
    reserved_kurus: net > 0 ? Math.round((net * s.reserved[0]) / s.reserved[1]) : 0,
  }));
  const caseTitle = e.case_id ? (db.prepare('SELECT title FROM cases WHERE id = ?').get(e.case_id) as { title: string }).title : null;
  return {
    ...e,
    case_title: caseTitle,
    heirs,
    items,
    totals: { assets, debts, net },
    shares,
    group: calc.group,
    warnings: [...calc.warnings, ...(debts > assets ? ['Borçlar varlıklardan fazla: mirasın reddi süresine dikkat edin.'] : [])],
    deadlines: estateDeadlines(e.death_date),
  };
}

export function addHeir(db: DB, user: User, estateId: number, input: { name?: string; relation?: string; alive?: boolean; parentId?: number | null; side?: string }) {
  load(db, user, estateId);
  if (!input.name?.trim()) throw new ApiError(400, 'Mirasçının adı zorunludur.');
  if (!RELATIONS.includes(input.relation ?? '')) throw new ApiError(400, 'Geçersiz yakınlık.');
  if (!SIDES.includes(input.side ?? '')) throw new ApiError(400, 'Geçersiz kardeş tarafı.');
  let parentId: number | null = null;
  if (input.relation === 'torun') {
    const parent = db
      .prepare("SELECT id FROM estate_heirs WHERE id = ? AND estate_id = ? AND relation = 'cocuk'")
      .get(Number(input.parentId), estateId) as { id: number } | undefined;
    if (!parent) throw new ApiError(400, 'Torunun hangi çocuğun altsoyu olduğunu seçin.');
    parentId = parent.id;
  }
  if (input.relation === 'es' && db.prepare("SELECT 1 FROM estate_heirs WHERE estate_id = ? AND relation = 'es'").get(estateId)) {
    throw new ApiError(400, 'Eş zaten eklenmiş.');
  }
  if (
    (input.relation === 'anne' || input.relation === 'baba') &&
    db.prepare('SELECT 1 FROM estate_heirs WHERE estate_id = ? AND relation = ?').get(estateId, input.relation)
  ) {
    throw new ApiError(400, `${input.relation === 'anne' ? 'Anne' : 'Baba'} zaten eklenmiş.`);
  }
  db.prepare('INSERT INTO estate_heirs (estate_id, name, relation, alive, parent_id, side) VALUES (?, ?, ?, ?, ?, ?)').run(
    estateId,
    input.name.trim(),
    input.relation,
    input.alive === false ? 0 : 1,
    parentId,
    input.relation === 'kardes' ? (input.side ?? '') : '',
  );
  return getEstate(db, user, estateId);
}

function heirEstate(db: DB, user: User, heirId: number) {
  const row = db
    .prepare('SELECT h.estate_id FROM estate_heirs h JOIN estates e ON e.id = h.estate_id WHERE h.id = ? AND e.office_id = ?')
    .get(heirId, user.office_id) as { estate_id: number } | undefined;
  if (!row) throw new ApiError(404, 'Mirasçı bulunamadı.');
  return row.estate_id;
}

export function updateHeir(db: DB, user: User, heirId: number, input: { alive?: boolean }) {
  const estateId = heirEstate(db, user, heirId);
  if (input.alive !== undefined) db.prepare('UPDATE estate_heirs SET alive = ? WHERE id = ?').run(input.alive ? 1 : 0, heirId);
  return getEstate(db, user, estateId);
}

export function deleteHeir(db: DB, user: User, heirId: number) {
  const estateId = heirEstate(db, user, heirId);
  db.transaction(() => {
    db.prepare('DELETE FROM estate_heirs WHERE parent_id = ?').run(heirId);
    db.prepare('DELETE FROM estate_heirs WHERE id = ?').run(heirId);
  })();
  return getEstate(db, user, estateId);
}

export function addItem(db: DB, user: User, estateId: number, input: { kind?: string; category?: string; title?: string; value?: number | string }) {
  load(db, user, estateId);
  if (input.kind !== 'varlik' && input.kind !== 'borc') throw new ApiError(400, 'Kalem türü varlık ya da borç olmalı.');
  if (!input.title?.trim()) throw new ApiError(400, 'Kalem adı zorunludur.');
  db.prepare('INSERT INTO estate_items (estate_id, kind, category, title, value_kurus) VALUES (?, ?, ?, ?, ?)').run(
    estateId,
    input.kind,
    input.category ?? '',
    input.title.trim(),
    toKurus(input.value, 'Değer'),
  );
  return getEstate(db, user, estateId);
}

export function deleteItem(db: DB, user: User, itemId: number) {
  const row = db
    .prepare('SELECT i.estate_id FROM estate_items i JOIN estates e ON e.id = i.estate_id WHERE i.id = ? AND e.office_id = ?')
    .get(itemId, user.office_id) as { estate_id: number } | undefined;
  if (!row) throw new ApiError(404, 'Kalem bulunamadı.');
  db.prepare('DELETE FROM estate_items WHERE id = ?').run(itemId);
  return getEstate(db, user, row.estate_id);
}
