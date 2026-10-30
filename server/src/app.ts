import express, { type NextFunction, type Request, type Response } from 'express';
import * as auth from './auth.ts';
import * as cases from './cases.ts';
import { checkCitations } from './citations.ts';
import type { DB } from './db.ts';
import { searchDecisions, upsertDecision } from './decisions.ts';
import { ApiError } from './errors.ts';
import * as petitions from './petitions.ts';

type Handler = (req: Request, user: auth.User) => unknown;

export function createApp(db: DB) {
  const app = express();
  app.use(express.json({ limit: '5mb' }));
  // Masaüstü uygulaması file:// kökeninden istek atar; kimlik doğrulama çerezle değil
  // Bearer token ile yapıldığı için tüm kökenlere izin vermek güvenlidir.
  app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'content-type, authorization');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE');
    if (req.method === 'OPTIONS') {
      res.sendStatus(204);
      return;
    }
    next();
  });

  const open = (fn: (req: Request) => unknown) => (req: Request, res: Response) => res.json(fn(req));
  const authed = (fn: Handler) => (req: Request, res: Response) => {
    const token = req.header('authorization')?.replace(/^Bearer /, '');
    res.json(fn(req, auth.userFromToken(db, token)));
  };
  const id = (req: Request, name = 'id') => Number(req.params[name]);

  app.get('/api/health', (_req, res) => res.json({ ok: true }));

  app.post('/api/register', open((req) => auth.registerOffice(db, req.body)));
  app.post('/api/login', open((req) => auth.login(db, req.body)));
  app.post('/api/invites/accept', open((req) => auth.acceptInvite(db, req.body)));
  app.get('/api/me', authed((_req, user) => user));
  app.get('/api/users', authed((_req, user) => auth.listOfficeUsers(db, user.office_id)));
  app.post('/api/invites', authed((req, user) => auth.createInvite(db, user, req.body)));

  app.get('/api/cases', authed((_req, user) => cases.listCases(db, user)));
  app.post('/api/cases', authed((req, user) => cases.createCase(db, user, req.body)));
  app.get('/api/cases/:id', authed((req, user) => cases.getCase(db, user, id(req))));
  app.put('/api/cases/:id', authed((req, user) => cases.updateCase(db, user, id(req), req.body)));
  app.get('/api/cases/:id/petitions', authed((req, user) => petitions.listPetitions(db, user, id(req))));

  app.post('/api/petitions', authed((req, user) => petitions.createPetition(db, user, req.body)));
  app.get('/api/petitions/:id', authed((req, user) => petitions.getPetition(db, user, id(req))));
  app.post('/api/petitions/:id/versions', authed((req, user) => petitions.saveVersion(db, user, id(req), req.body.body)));
  app.post('/api/petitions/:id/submit', authed((req, user) => petitions.submitForReview(db, user, id(req))));
  app.post('/api/petitions/:id/review', authed((req, user) => petitions.review(db, user, id(req), req.body)));

  app.get('/api/decisions', authed((req) => searchDecisions(db, String(req.query.q ?? ''))));
  app.post(
    '/api/decisions',
    authed((req, user) => {
      if (user.role !== 'avukat') throw new ApiError(403, 'Arşive yalnızca avukatlar karar ekleyebilir.');
      upsertDecision(db, req.body);
      return { ok: true };
    }),
  );
  app.post('/api/citations/check', authed((req) => checkCitations(db, String(req.body.body ?? ''))));

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof ApiError) {
      res.status(err.status).json({ error: err.message, details: err.details });
      return;
    }
    console.error(err);
    res.status(500).json({ error: 'Beklenmeyen bir hata oluştu.' });
  });

  return app;
}
