import type { User } from './auth.ts';
import { checkCitations } from './citations.ts';
import type { DB } from './db.ts';
import { ApiError } from './errors.ts';

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
  return petition;
}

function latestVersion(db: DB, petitionId: number): Version {
  return db
    .prepare(
      'SELECT version, body, created_by, created_at FROM petition_versions WHERE petition_id = ? ORDER BY version DESC LIMIT 1',
    )
    .get(petitionId) as Version;
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

/** Arşivde karşılığı olmayan atıf varsa incelemeye gönderilemez. */
export function submitForReview(db: DB, user: User, petitionId: number) {
  const petition = loadPetition(db, user, petitionId);
  if (petition.status !== 'taslak' && petition.status !== 'duzeltme') {
    throw new ApiError(409, 'Yalnızca taslak dilekçe incelemeye gönderilebilir.');
  }
  const citations = checkCitations(db, latestVersion(db, petitionId).body);
  const missing = citations.filter((c) => c.decisionId === null);
  if (missing.length > 0) {
    throw new ApiError(422, 'Arşivde bulunmayan karar atıfları var.', { missing });
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
  if (user.role !== 'avukat') throw new ApiError(403, 'Yalnızca avukatlar inceleme yapabilir.');
  const version = latestVersion(db, petitionId);
  const writers = db
    .prepare('SELECT DISTINCT created_by FROM petition_versions WHERE petition_id = ?')
    .all(petitionId) as { created_by: number }[];
  if (petition.author_id === user.id || writers.some((w) => w.created_by === user.id)) {
    throw new ApiError(403, 'Dilekçeyi yazan avukat kendi dilekçesini onaylayamaz.');
  }
  if (input.action !== 'approve' && input.action !== 'request_changes') {
    throw new ApiError(400, 'Geçersiz inceleme işlemi.');
  }
  const comment = input.comment?.trim() ?? '';
  if (input.action === 'request_changes' && !comment) {
    throw new ApiError(400, 'Düzeltme isterken açıklama yazmalısınız.');
  }
  return db.transaction(() => {
    db.prepare('INSERT INTO reviews (petition_id, version, reviewer_id, action, comment) VALUES (?, ?, ?, ?, ?)').run(
      petitionId,
      version.version,
      user.id,
      input.action,
      comment,
    );
    setStatus(db, petitionId, input.action === 'approve' ? 'onayli' : 'duzeltme');
    return getPetition(db, user, petitionId);
  })();
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
  return {
    ...petition,
    body: versions[0].body,
    version: versions[0].version,
    citations: checkCitations(db, versions[0].body),
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
