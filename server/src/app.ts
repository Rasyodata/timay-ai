import express, { type NextFunction, type Request, type Response } from 'express';
import * as agendaMod from './agenda.ts';
import * as auth from './auth.ts';
import * as cases from './cases.ts';
import * as consultancy from './consultancy.ts';
import * as clm from './clm.ts';
import * as contracts from './contracts.ts';
import { dashboard } from './dashboard.ts';
import * as enforcement from './enforcement.ts';
import * as finance from './finance.ts';
import * as tasks from './tasks.ts';
import { getTemplate, listAreas } from './templates.ts';
import { checkCitations } from './citations.ts';
import * as deadlines from './deadlines.ts';
import { readDocx, readUdf } from './docx.ts';
import type { DB } from './db.ts';
import { archiveStats, getDecision, searchArchive, searchDecisions, upsertDecision } from './decisions.ts';
import { ApiError } from './errors.ts';
import * as estates from './estates.ts';
import * as casedocs from './casedocs.ts';
import * as opposing from './opposing.ts';
import * as petitions from './petitions.ts';
import type { DeepChecker } from './teyit.ts';
import * as yargitay from './yargitay.ts';

type Handler = (req: Request, user: auth.User) => unknown;

export function createApp(db: DB, options: { deepChecker?: DeepChecker | null; fetch?: yargitay.Fetch } = {}) {
  const checker = options.deepChecker ?? null;
  const fetchImpl = options.fetch ?? (fetch as unknown as yargitay.Fetch);
  const app = express();
  app.use(express.json({ limit: '25mb' }));
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
  const authed = (fn: Handler) => async (req: Request, res: Response) => {
    const token = req.header('authorization')?.replace(/^Bearer /, '');
    res.json(await fn(req, auth.userFromToken(db, token)));
  };
  const id = (req: Request, name = 'id') => Number(req.params[name]);

  app.get('/api/health', (_req, res) => res.json({ ok: true, deepTeyit: checker !== null }));

  app.post('/api/register', open((req) => auth.registerOffice(db, req.body)));
  app.post('/api/login', open((req) => auth.login(db, req.body)));
  app.post('/api/invites/accept', open((req) => auth.acceptInvite(db, req.body)));
  app.get('/api/me', authed((_req, user) => user));
  app.get('/api/users', authed((_req, user) => auth.listOfficeUsers(db, user.office_id)));
  app.put('/api/users/:id/permissions', authed((req, user) => auth.setPermissions(db, user, id(req), req.body)));
  app.post('/api/invites', authed((req, user) => auth.createInvite(db, user, req.body)));

  app.get('/api/cases', authed((_req, user) => cases.listCases(db, user)));
  app.post('/api/cases', authed((req, user) => cases.createCase(db, user, req.body)));
  app.get('/api/cases/:id', authed((req, user) => cases.getCase(db, user, id(req))));
  app.put('/api/cases/:id', authed((req, user) => cases.updateCase(db, user, id(req), req.body)));
  app.get('/api/cases/:id/petitions', authed((req, user) => petitions.listPetitions(db, user, id(req))));
  app.put('/api/cases/:id/responsible', authed((req, user) => cases.transferCase(db, user, id(req), req.body)));
  app.post('/api/cases/:id/hearings', authed((req, user) => cases.addHearing(db, user, id(req), req.body)));
  app.delete('/api/hearings/:id', authed((req, user) => cases.deleteHearing(db, user, id(req))));
  app.get('/api/hearings', authed((_req, user) => cases.listHearings(db, user)));
  app.get('/api/cases/:id/opposing', authed((req, user) => opposing.listOpposing(db, user, id(req))));
  app.post('/api/cases/:id/opposing', authed((req, user) => opposing.createOpposing(db, user, id(req), req.body)));
  app.get('/api/cases/:id/documents', authed((req, user) => casedocs.listCaseDocuments(db, user, id(req))));
  app.post('/api/cases/:id/documents', authed((req, user) => casedocs.addCaseDocument(db, user, id(req), req.body ?? {})));
  app.get('/api/case-documents/:id', authed((req, user) => casedocs.getCaseDocument(db, user, id(req), req.query.file === '1')));
  app.put('/api/case-documents/:id', authed((req, user) => casedocs.updateCaseDocument(db, user, id(req), req.body ?? {})));
  app.delete('/api/case-documents/:id', authed((req, user) => casedocs.deleteCaseDocument(db, user, id(req))));
  app.get('/api/opposing/:id', authed((req, user) => opposing.getOpposing(db, user, id(req))));
  app.post('/api/opposing/:id/teyit/deep', authed((req, user) => opposing.deepCheckOpposing(db, user, id(req), checker)));

  app.post('/api/petitions', authed((req, user) => petitions.createPetition(db, user, req.body)));
  app.get('/api/petitions/:id', authed((req, user) => petitions.getPetition(db, user, id(req))));
  app.post('/api/petitions/:id/versions', authed((req, user) => petitions.saveVersion(db, user, id(req), req.body.body)));
  app.post('/api/petitions/:id/submit', authed((req, user) => petitions.submitForReview(db, user, id(req))));
  app.post('/api/petitions/:id/review', authed((req, user) => petitions.review(db, user, id(req), req.body)));
  app.post('/api/petitions/:id/teyit/ack', authed((req, user) => petitions.ackItem(db, user, id(req), req.body)));
  app.post('/api/petitions/:id/teyit/deep', authed((req, user) => petitions.deepCheck(db, user, id(req), checker)));

  app.get('/api/dashboard', authed((_req, user) => dashboard(db, user)));
  app.get('/api/areas', authed(() => listAreas()));
  app.get(
    '/api/templates/:tid',
    authed((req) => {
      const t = getTemplate(String(req.params.tid));
      if (!t) throw new ApiError(404, 'Şablon bulunamadı.');
      return t;
    }),
  );

  app.get('/api/agenda', authed((req, user) => agendaMod.agenda(db, user, req.query as Record<string, string>)));
  app.post('/api/agenda', authed((req, user) => agendaMod.addAgendaItem(db, user, req.body)));
  app.delete('/api/agenda/:id', authed((req, user) => agendaMod.deleteAgendaItem(db, user, id(req))));

  app.get('/api/tasks', authed((req, user) => tasks.listTasks(db, user, req.query as Record<string, string>)));
  app.post('/api/tasks', authed((req, user) => tasks.createTask(db, user, req.body)));
  app.put('/api/tasks/:id', authed((req, user) => tasks.updateTask(db, user, id(req), req.body)));

  app.get('/api/contract-templates', authed(() => contracts.CONTRACT_TEMPLATES));
  app.post('/api/contracts/analyze', authed((req) => contracts.analyzeContract(String(req.body.body ?? ''))));
  app.get('/api/contracts', authed((_req, user) => contracts.listContracts(db, user)));
  app.post('/api/contracts', authed((req, user) => contracts.createContract(db, user, req.body)));
  app.get('/api/contracts/:id', authed((req, user) => contracts.getContract(db, user, id(req))));
  app.put('/api/contracts/:id', authed((req, user) => contracts.updateContract(db, user, id(req), req.body)));
  app.post('/api/contracts/:id/submit', authed((req, user) => contracts.submitContract(db, user, id(req))));
  app.post('/api/contracts/:id/review', authed((req, user) => contracts.reviewContract(db, user, id(req), req.body)));
  app.post('/api/contracts/:id/obligations', authed((req, user) => contracts.addObligation(db, user, id(req), req.body)));
  app.put(
    '/api/obligations/:id',
    authed((req, user) => contracts.setObligationDone(db, user, id(req), Boolean(req.body.done))),
  );

  // Sözleşme zırhı
  app.get('/api/playbook', authed((_req, user) => clm.getPlaybook(db, user)));
  app.put('/api/playbook', authed((req, user) => clm.savePlaybook(db, user, req.body ?? {})));
  app.get('/api/clauses', authed((req, user) => ({ topics: clm.TOPICS, items: clm.listClauses(db, user, req.query as Record<string, string>) })));
  app.post('/api/clauses', authed((req, user) => clm.addClause(db, user, req.body ?? {})));
  app.delete('/api/clauses/:id', authed((req, user) => clm.deleteClause(db, user, id(req))));
  app.post(
    '/api/documents/extract',
    authed((req) => {
      const buf = Buffer.from(String(req.body?.fileBase64 ?? ''), 'base64');
      if (/\.udf$/i.test(String(req.body?.fileName ?? ''))) return { text: readUdf(buf), trackedChanges: 0 };
      const doc = readDocx(buf);
      return { text: doc.accepted, trackedChanges: doc.trackedChanges };
    }),
  );
  app.get('/api/contracts/:id/review', authed((req, user) => clm.contractReview(db, user, id(req))));
  app.put('/api/contracts/:id/side', authed((req, user) => clm.setSide(db, user, id(req), String(req.body.side ?? ''))));
  app.post('/api/contracts/:id/apply-clause', authed((req, user) => clm.applyClause(db, user, id(req), req.body ?? {})));
  app.get('/api/contracts/:id/versions', authed((req, user) => clm.listVersions(db, user, id(req))));
  app.post('/api/contracts/:id/versions', authed((req, user) => clm.uploadVersion(db, user, id(req), req.body ?? {})));
  app.get(
    '/api/contracts/:id/compare',
    authed((req, user) => clm.compareVersions(db, user, id(req), Number(req.query.from), Number(req.query.to))),
  );
  app.post(
    '/api/contracts/:id/export',
    authed((req, user) => {
      const out = clm.exportRedline(db, user, id(req));
      return { fileName: out.fileName, base64: out.buffer.toString('base64') };
    }),
  );
  app.post('/api/contracts/:id/lock', authed((req, user) => clm.lockContract(db, user, id(req), req.body ?? {})));
  app.get('/api/contracts/:id/signing', authed((req, user) => clm.signingState(db, user, id(req))));
  app.post(
    '/api/contracts/:id/signers/:signerId/sign',
    authed((req, user) => clm.markSigned(db, user, id(req), Number(req.params.signerId), req.body?.date)),
  );
  app.post('/api/contracts/:id/schedule', authed((req, user) => clm.buildSchedule(db, user, id(req), req.body ?? {})));
  app.put('/api/contracts/:id/units', authed((req, user) => clm.setUnits(db, user, id(req), req.body?.units)));
  app.get('/api/contracts/:id/alarms', authed((req, user) => clm.alarms(db, user, id(req))));
  app.get(
    '/api/contracts/:id/notice/:obligationId',
    authed((req, user) => clm.noticeDraft(db, user, id(req), Number(req.params.obligationId))),
  );
  app.put('/api/obligations/:id/direction', authed((req, user) => clm.setObligationDirection(db, user, id(req), String(req.body.direction ?? ''))));

  app.get('/api/finance', authed((req, user) => finance.financeReport(db, user, req.query as Record<string, string>)));
  app.post('/api/finance', authed((req, user) => finance.addEntry(db, user, req.body)));
  app.delete('/api/finance/:id', authed((req, user) => finance.deleteEntry(db, user, id(req))));

  app.get('/api/enforcement', authed((_req, user) => enforcement.listFiles(db, user)));
  app.post('/api/enforcement', authed((req, user) => enforcement.createFile(db, user, req.body)));
  app.get('/api/enforcement/:id', authed((req, user) => enforcement.getFile(db, user, id(req))));
  app.put('/api/enforcement/:id', authed((req, user) => enforcement.updateFile(db, user, id(req), req.body)));
  app.post('/api/enforcement/:id/actions', authed((req, user) => enforcement.addAction(db, user, id(req), req.body)));

  app.get('/api/consultancy', authed((_req, user) => consultancy.listClients(db, user)));
  app.post('/api/consultancy', authed((req, user) => consultancy.createClient(db, user, req.body)));
  app.get('/api/consultancy/:id', authed((req, user) => consultancy.getClient(db, user, id(req))));
  app.put('/api/consultancy/:id', authed((req, user) => consultancy.updateClient(db, user, id(req), req.body)));
  app.post('/api/consultancy/:id/records', authed((req, user) => consultancy.addRecord(db, user, id(req), req.body)));
  app.post('/api/consultancy/:id/invoice', authed((req, user) => consultancy.invoiceMonth(db, user, id(req), req.body)));
  app.delete('/api/consultancy-records/:id', authed((req, user) => consultancy.deleteRecord(db, user, id(req))));

  app.get('/api/estates', authed((_req, user) => estates.listEstates(db, user)));
  app.post('/api/estates', authed((req, user) => estates.createEstate(db, user, req.body)));
  app.get('/api/estates/:id', authed((req, user) => estates.getEstate(db, user, id(req))));
  app.put('/api/estates/:id', authed((req, user) => estates.updateEstate(db, user, id(req), req.body)));
  app.post('/api/estates/:id/heirs', authed((req, user) => estates.addHeir(db, user, id(req), req.body)));
  app.post('/api/estates/:id/items', authed((req, user) => estates.addItem(db, user, id(req), req.body)));
  app.put('/api/heirs/:id', authed((req, user) => estates.updateHeir(db, user, id(req), req.body)));
  app.delete('/api/heirs/:id', authed((req, user) => estates.deleteHeir(db, user, id(req))));
  app.delete('/api/estate-items/:id', authed((req, user) => estates.deleteItem(db, user, id(req))));

  app.get('/api/deadline-rules', authed(() => deadlines.RULES));
  app.post('/api/deadlines/calculate', authed((req) => deadlines.calculate(req.body)));
  app.get('/api/deadlines', authed((req, user) => deadlines.listDeadlines(db, user, req.query as Record<string, string>)));
  app.post('/api/deadlines', authed((req, user) => deadlines.createDeadline(db, user, req.body)));
  app.put('/api/deadlines/:id', authed((req, user) => deadlines.setDeadlineDone(db, user, id(req), Boolean(req.body.done))));
  app.delete('/api/deadlines/:id', authed((req, user) => deadlines.deleteDeadline(db, user, id(req))));
  app.get('/api/risks', authed((_req, user) => deadlines.risks(db, user)));

  app.get('/api/decisions', authed((req) => searchDecisions(db, String(req.query.q ?? ''))));
  app.get('/api/archive', authed((req) => searchArchive(db, req.query as Record<string, string>)));
  app.get('/api/archive/stats', authed(() => archiveStats(db)));
  app.get('/api/decisions/:id', authed((req) => getDecision(db, id(req))));
  app.post(
    '/api/decisions',
    authed((req, user) => {
      if (user.role !== 'avukat') throw new ApiError(403, 'Arşive yalnızca avukatlar karar ekleyebilir.');
      return { ok: true, id: upsertDecision(db, req.body) };
    }),
  );
  app.get('/api/yargitay/search', authed((req) => yargitay.search(db, fetchImpl, req.query as Record<string, string>)));
  app.post('/api/yargitay/body', authed((req) => yargitay.searchBody(req.body ?? {}, req.body?.withDates !== false)));
  app.post('/api/yargitay/map', authed((req) => {
    const result = yargitay.mapSearch(db, req.body?.data ?? req.body ?? {});
    return req.body?.filter ? { ...result, items: yargitay.filterYears(result.items, req.body.filter) } : result;
  }));
  app.post('/api/yargitay/import', authed((req, user) => yargitay.importDecision(db, fetchImpl, user, req.body ?? {})));
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
