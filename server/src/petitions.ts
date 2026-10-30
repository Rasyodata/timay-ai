import type { User } from './auth.ts';
import { assertCaseVisible } from './cases.ts';
import { checkCitations } from './citations.ts';
import type { DB } from './db.ts';
import { ApiError } from './errors.ts';
import { buildReport, needsAck, runDeepCheck, type DeepChecker, type TeyitReport } from './teyit.ts';

export type PetitionStatus = 'taslak' | 'incelemede' | 'duzeltme' | 'onayli';

export interface Petition {
  id: number;
  case_id: number;
  title: string;
  status: PetitionStatus;
  author_id: number;
  created_at: string;
}

interface Version {
  version: number;
  body: string;
  created_by: number;
  created_at: string;
}

function loadPetition(db: DB, user: User, petitionId: number): Petition {
  const petition = db
    .prepare(
      `SELECT p.* FROM petitions p JOIN cases c ON c.id = p.case_id
       WHERE p.id = ? AND c.office_id = ?`,
    )
    .get(petitionId, user.office_id) as Petition | undefined;
  if (!petition) throw new ApiError(404, 'Dilekçe bulunamadı.');
  if (!user.all_cases) assertCaseVisible(db, user, petition.case_id);
  return petition;
}

function latestVersion(db: DB, petitionId: number): Version {
  return db
    .prepare(
      'SELECT version, body, created_by, created_at FROM petition_versions WHERE petition_id = ? ORDER BY version DESC LIMIT 1',
    )
    .get(petitionId) as Version;
}

function report(db: DB, petitionId: number, version: Version): TeyitReport {
  return buildReport(db, { type: 'petition', id: petitionId, version: version.version }, version.body);
}

function ackedKeys(db: DB, petitionId: number, version: number, userId: number): string[] {
  return (
    db
      .prepare('SELECT item_key FROM teyit_acks WHERE petition_id = ? AND version = ? AND user_id = ?')
      .all(petitionId, version, userId) as { item_key: string }[]
  ).map((r) => r.item_key);
}

/** İnceleme yapabilecek kişi: yazanlardan biri olmayan avukat. */
function assertReviewer(db: DB, user: User, petition: Petition) {
  if (user.role !== 'avukat' || !user.can_approve) throw new ApiError(403, 'Onay yetkiniz yok. Büro yöneticisinden isteyin.');
  const writers = db
    .prepare('SELECT DISTINCT created_by FROM petition_versions WHERE petition_id = ?')
    .all(petition.id) as { created_by: number }[];
  if (petition.author_id === user.id || writers.some((w) => w.created_by === user.id)) {
    throw new ApiError(403, 'Dilekçeyi yazan avukat kendi dilekçesini onaylayamaz.');
  }
}

function setStatus(db: DB, petitionId: number, status: PetitionStatus) {
  db.prepare('UPDATE petitions SET status = ? WHERE id = ?').run(status, petitionId);
}

export function createPetition(db: DB, user: User, input: { caseId: number; title: string; body: string }) {
  const owned = db.prepare('SELECT 1 FROM cases WHERE id = ? AND office_id = ?').get(input.caseId, user.office_id);
  if (!owned) throw new ApiError(404, 'Dava dosyası bulunamadı.');
  if (!input.title?.trim()) throw new ApiError(400, 'Dilekçe başlığı zorunludur.');
  return db.transaction(() => {
    const result = db
      .prepare("INSERT INTO petitions (case_id, title, status, author_id) VALUES (?, ?, 'taslak', ?)")
      .run(input.caseId, input.title.trim(), user.id);
    const id = Number(result.lastInsertRowid);
    db.prepare('INSERT INTO petition_versions (petition_id, version, body, created_by) VALUES (?, 1, ?, ?)').run(
      id,
      input.body ?? '',
      user.id,
    );
    return getPetition(db, user, id);
  })();
}

/** Yeni sürüm kaydeder. Onaylı ya da incelemedeki dilekçe değiştirilemez. */
export function saveVersion(db: DB, user: User, petitionId: number, body: string) {
  const petition = loadPetition(db, user, petitionId);
  if (petition.status === 'onayli') throw new ApiError(409, 'Onaylı dilekçe değiştirilemez.');
  if (petition.status === 'incelemede') {
    throw new ApiError(409, 'İncelemedeki dilekçe değiştirilemez; önce inceleme sonuçlanmalı.');
  }
  return db.transaction(() => {
    const next = latestVersion(db, petitionId).version + 1;
    db.prepare('INSERT INTO petition_versions (petition_id, version, body, created_by) VALUES (?, ?, ?, ?)').run(
      petitionId,
      next,
      body,
      user.id,
    );
    setStatus(db, petitionId, 'taslak');
    return getPetition(db, user, petitionId);
  })();
}

/** Arşivde karşılığı olmayan atıf ya da teyit edilemeyen (kırmızı) dayanak varsa incelemeye gönderilemez. */
export function submitForReview(db: DB, user: User, petitionId: number) {
  const petition = loadPetition(db, user, petitionId);
  if (petition.status !== 'taslak' && petition.status !== 'duzeltme') {
    throw new ApiError(409, 'Yalnızca taslak dilekçe incelemeye gönderilebilir.');
  }
  const version = latestVersion(db, petitionId);
  const missing = checkCitations(db, version.body).filter((c) => c.decisionId === null);
  const red = report(db, petitionId, version).items.filter((i) => i.status === 'kirmizi');
  if (red.length > 0) {
    throw new ApiError(
      422,
      `${red.length} dayanak teyit edilemedi (kırmızı): ${red.map((i) => i.quote).join('; ')}. Düzeltmeden incelemeye gönderilemez.`,
      { missing, red },
    );
  }
  setStatus(db, petitionId, 'incelemede');
  return getPetition(db, user, petitionId);
}

/** Dilekçeyi yazan dışında bir avukat onaylayabilir ya da düzeltme isteyebilir. */
export function review(
  db: DB,
  user: User,
  petitionId: number,
  input: { action: 'approve' | 'request_changes'; comment?: string },
) {
  const petition = loadPetition(db, user, petitionId);
  if (petition.status !== 'incelemede') throw new ApiError(409, 'Dilekçe incelemede değil.');
  assertReviewer(db, user, petition);
  const version = latestVersion(db, petitionId);
  if (input.action !== 'approve' && input.action !== 'request_changes') {
    throw new ApiError(400, 'Geçersiz inceleme işlemi.');
  }
  const comment = input.comment?.trim() ?? '';
  if (input.action === 'request_changes' && !comment) {
    throw new ApiError(400, 'Düzeltme isterken açıklama yazmalısınız.');
  }
  const teyit = report(db, petitionId, version);
  if (input.action === 'approve') {
    const acked = new Set(ackedKeys(db, petitionId, version.version, user.id));
    const unacked = teyit.items.filter((i) => needsAck(i) && !acked.has(i.key));
    if (unacked.length > 0) {
      throw new ApiError(422, 'Onaylamadan önce sarı ve gri dayanakları tek tek kontrol edip işaretleyin.', {
        unacked,
      });
    }
  }
  return db.transaction(() => {
    db.prepare('INSERT INTO reviews (petition_id, version, reviewer_id, action, comment) VALUES (?, ?, ?, ?, ?)').run(
      petitionId,
      version.version,
      user.id,
      input.action,
      comment,
    );
    if (input.action === 'approve') {
      const summary = { ...teyit.counts, total: teyit.items.length, deep: teyit.deepCheckedAt !== null };
      db.prepare('INSERT INTO approval_records (petition_id, version, reviewer_id, summary) VALUES (?, ?, ?, ?)').run(
        petitionId,
        version.version,
        user.id,
        JSON.stringify(summary),
      );
    }
    setStatus(db, petitionId, input.action === 'approve' ? 'onayli' : 'duzeltme');
    return getPetition(db, user, petitionId);
  })();
}

/** İnceleyen avukat sarı/gri bir dayanağı kontrol ettiğini işaretler (ya da işareti kaldırır). */
export function ackItem(db: DB, user: User, petitionId: number, input: { key: string; checked: boolean }) {
  const petition = loadPetition(db, user, petitionId);
  if (petition.status !== 'incelemede') throw new ApiError(409, 'Dilekçe incelemede değil.');
  assertReviewer(db, user, petition);
  const version = latestVersion(db, petitionId);
  const item = report(db, petitionId, version).items.find((i) => i.key === input.key);
  if (!item) throw new ApiError(404, 'Dayanak bulunamadı.');
  if (input.checked) {
    db.prepare('INSERT OR IGNORE INTO teyit_acks (petition_id, version, item_key, user_id) VALUES (?, ?, ?, ?)').run(
      petitionId,
      version.version,
      item.key,
      user.id,
    );
  } else {
    db.prepare('DELETE FROM teyit_acks WHERE petition_id = ? AND version = ? AND item_key = ? AND user_id = ?').run(
      petitionId,
      version.version,
      item.key,
      user.id,
    );
  }
  return getPetition(db, user, petitionId);
}

/** Son sürümü Claude ile derin teyitten geçirir; aynı sürüm için sonuç saklanır. */
export async function deepCheck(db: DB, user: User, petitionId: number, checker: DeepChecker | null) {
  const petition = loadPetition(db, user, petitionId);
  const version = latestVersion(db, petitionId);
  const { facts } = db.prepare('SELECT facts FROM cases WHERE id = ?').get(petition.case_id) as { facts: string };
  await runDeepCheck(db, checker, { type: 'petition', id: petitionId, version: version.version }, version.body, facts, user.id);
  return getPetition(db, user, petitionId);
}

export function getPetition(db: DB, user: User, petitionId: number) {
  const petition = loadPetition(db, user, petitionId);
  const versions = db
    .prepare(
      `SELECT v.version, v.body, v.created_at, v.created_by, u.name AS created_by_name
       FROM petition_versions v JOIN users u ON u.id = v.created_by
       WHERE v.petition_id = ? ORDER BY v.version DESC`,
    )
    .all(petitionId) as {
      version: number;
      body: string;
      created_at: string;
      created_by: number;
      created_by_name: string;
    }[];
  const reviews = db
    .prepare(
      `SELECT r.version, r.action, r.comment, r.created_at, u.name AS reviewer_name
       FROM reviews r JOIN users u ON u.id = r.reviewer_id
       WHERE r.petition_id = ? ORDER BY r.id DESC`,
    )
    .all(petitionId);
  const approval = db
    .prepare(
      `SELECT a.version, a.summary, a.created_at, u.name AS reviewer_name
       FROM approval_records a JOIN users u ON u.id = a.reviewer_id
       WHERE a.petition_id = ? ORDER BY a.id DESC LIMIT 1`,
    )
    .get(petitionId) as { version: number; summary: string; created_at: string; reviewer_name: string } | undefined;
  return {
    ...petition,
    body: versions[0].body,
    version: versions[0].version,
    citations: checkCitations(db, versions[0].body),
    teyit: report(db, petitionId, versions[0]),
    acks: ackedKeys(db, petitionId, versions[0].version, user.id),
    approval: approval ? { ...approval, summary: JSON.parse(approval.summary) } : null,
    versions,
    reviews,
  };
}

export function listPetitions(db: DB, user: User, caseId: number) {
  return db
    .prepare(
      `SELECT p.id, p.title, p.status, p.created_at, u.name AS author_name
       FROM petitions p JOIN cases c ON c.id = p.case_id JOIN users u ON u.id = p.author_id
       WHERE p.case_id = ? AND c.office_id = ? ORDER BY p.id DESC`,
    )
    .all(caseId, user.office_id);
}
