// Sunucu adresi: kullanıcının girişte seçtiği adres, yoksa derleme sırasında verilen
// VITE_TIMAY_SERVER_URL, o da yoksa geliştirmede yerel sunucu, kurulumda Render sunucusu.
const DEFAULT_SERVER_URL =
  import.meta.env.VITE_TIMAY_SERVER_URL ||
  (import.meta.env.DEV ? 'http://localhost:4000' : 'https://timay-sunucu.onrender.com');

export function getServerUrl(): string {
  return localStorage.getItem('timay-server') || DEFAULT_SERVER_URL;
}

export function setServerUrl(value: string) {
  const clean = value.trim().replace(/\/+$/, '');
  if (!clean || clean === DEFAULT_SERVER_URL) localStorage.removeItem('timay-server');
  else localStorage.setItem('timay-server', clean);
}

export type Role = 'avukat' | 'stajyer';
export type PetitionStatus = 'taslak' | 'incelemede' | 'duzeltme' | 'onayli';

export interface User {
  id: number;
  office_id: number;
  name: string;
  email: string;
  role: Role;
}

export interface CaseSummary {
  id: number;
  title: string;
  court: string;
  esas_no: string;
  area: string;
  client: string;
  status: 'acik' | 'kapali';
  created_at: string;
  next_hearing?: string | null;
  petition_count?: number;
  responsible_name?: string;
}

export interface Hearing {
  id: number;
  case_id: number;
  date: string;
  time: string;
  place: string;
  note: string;
}

export interface CaseDetail extends CaseSummary {
  parties: string;
  facts: string;
  responsible_id: number | null;
  responsible_name: string;
  hearings: Hearing[];
}

export interface Area {
  id: string;
  name: string;
  description: string;
  templates: { id: string; area: string; title: string; description: string }[];
}

export interface Template {
  id: string;
  area: string;
  title: string;
  description: string;
  body: string;
}

export interface Task {
  id: number;
  title: string;
  due_date: string;
  done: number;
  assignee_id: number;
  assignee_name: string;
  created_by_name: string;
  case_id: number | null;
  case_title: string | null;
}

export interface AgendaEvent {
  kind: 'durusma' | 'gorev' | 'taahhut' | 'sozlesme' | 'not';
  id: number;
  date: string;
  time: string;
  title: string;
  detail: string;
  caseId: number | null;
  contractId: number | null;
}

export interface Dashboard {
  counts: { openCases: number; drafts: number; inReview: number; approved: number; activeContracts: number; openEnforcement: number };
  month: { income: number; expense: number; profit: number };
  toReview: { id: number; title: string; case_title: string; author_name: string }[];
  myDrafts: { id: number; title: string; status: PetitionStatus; case_title: string }[];
  hearings: { id: number; date: string; time: string; place: string; case_id: number; case_title: string; case_court: string }[];
  tasks: { id: number; title: string; due_date: string; case_title: string | null; created_by_name: string }[];
  deadlines: { id: number; text: string; due_date: string; amount_kurus: number; contract_id: number; contract_title: string }[];
  expiring: { id: number; title: string; end_date: string }[];
}

export type ContractStatus = 'taslak' | 'yururlukte' | 'sona_erdi';

export const CONTRACT_STATUS_LABEL: Record<ContractStatus, string> = {
  taslak: 'Taslak',
  yururlukte: 'Yürürlükte',
  sona_erdi: 'Sona erdi',
};

export interface ContractSummary {
  id: number;
  title: string;
  kind: string;
  parties: string;
  start_date: string;
  end_date: string;
  value_kurus: number;
  status: ContractStatus;
  open_obligations: number;
}

export interface ContractAnalysis {
  obligations: { party: string; text: string }[];
  payments: { text: string; amounts: string[] }[];
  dates: string[];
  risks: { level: 'yuksek' | 'orta' | 'dusuk'; title: string; note: string; quote: string }[];
}

export interface ContractDetail extends ContractSummary {
  body: string;
  obligations: { id: number; party: string; text: string; due_date: string; amount_kurus: number; done: number }[];
  analysis: ContractAnalysis;
}

export interface ContractTemplate {
  id: string;
  title: string;
  description: string;
  body: string;
}

export interface FinanceEntry {
  id: number;
  kind: 'gelir' | 'gider' | 'masraf';
  category: string;
  description: string;
  client: string;
  amount_kurus: number;
  vat_rate: number;
  withholding_rate: number;
  date: string;
  case_id: number | null;
  case_title: string | null;
}

export interface FinanceReport {
  entries: FinanceEntry[];
  summary: { income: number; expense: number; costs: number; profit: number; vatCollected: number; vatPaid: number; vatPayable: number; withholding: number };
  monthly: { month: string; income: number; expense: number; costs: number }[];
  byCase: { caseId: number; title: string; income: number; costs: number }[];
}

export const ENFORCEMENT_KIND_LABEL: Record<string, string> = {
  ilamsiz: 'İlamsız takip',
  ilamli: 'İlamlı takip',
  kambiyo: 'Kambiyo senedine dayalı',
  rehin: 'Rehnin paraya çevrilmesi',
  tahliye: 'Tahliye',
};

export const ENFORCEMENT_STATUS_LABEL: Record<string, string> = {
  derdest: 'Derdest',
  itiraz: 'İtiraz edildi',
  haciz: 'Haciz aşamasında',
  satis: 'Satış aşamasında',
  tahsil: 'Tahsil edildi',
  kapandi: 'Kapandı',
};

export interface EnforcementFile {
  id: number;
  office_name: string;
  file_no: string;
  kind: string;
  creditor: string;
  debtor: string;
  principal_kurus: number;
  interest_rate: number;
  start_date: string;
  status: string;
  note: string;
  collected_kurus: number;
  interest_kurus: number;
  remaining_kurus: number;
  actions?: { id: number; date: string; action: string; amount_kurus: number; note: string; created_by_name: string }[];
}

export const CONSULT_KIND_LABEL: Record<string, string> = {
  gorus: 'Hukuki görüş',
  gorusme: 'Telefon / görüşme',
  toplanti: 'Toplantı',
  sozlesme: 'Sözleşme incelemesi',
  yazisma: 'Yazışma / ihtarname',
  diger: 'Diğer',
};

export interface ConsultancyClient {
  id: number;
  name: string;
  contact: string;
  tax_no: string;
  monthly_fee_kurus: number;
  included_minutes: number;
  extra_hour_kurus: number;
  start_date: string;
  end_date: string;
  status: 'aktif' | 'pasif';
  responsible_id: number | null;
  responsible_name: string;
  note: string;
  month_minutes?: number;
  month_charge?: number;
  last_record?: string | null;
}

export interface ConsultancyDetail extends ConsultancyClient {
  records: { id: number; date: string; kind: string; subject: string; minutes: number; note: string; user_name: string }[];
  months: { month: string; minutes: number; extraMinutes: number; fee: number; extra: number; total: number; invoiced: number | null }[];
}

export const RELATION_LABEL: Record<string, string> = {
  es: 'Eş',
  cocuk: 'Çocuk',
  torun: 'Torun',
  anne: 'Anne',
  baba: 'Baba',
  kardes: 'Kardeş',
  buyukebeveyn: 'Büyükanne / büyükbaba',
};

export interface EstateSummary {
  id: number;
  deceased: string;
  death_date: string;
  client: string;
  case_id: number | null;
  case_title: string | null;
  heir_count: number;
  net_kurus: number;
}

export interface EstateDetail extends Omit<EstateSummary, 'heir_count' | 'net_kurus'> {
  note: string;
  heirs: { id: number; name: string; relation: string; alive: number; parent_id: number | null; side: string }[];
  items: { id: number; kind: 'varlik' | 'borc'; category: string; title: string; value_kurus: number }[];
  totals: { assets: number; debts: number; net: number };
  shares: { id: number; share: [number, number]; reserved: [number, number]; note: string; amount_kurus: number; reserved_kurus: number }[];
  group: string;
  warnings: string[];
  deadlines: { title: string; date: string; note: string }[];
}

export interface PetitionSummary {
  id: number;
  title: string;
  status: PetitionStatus;
  author_name: string;
  created_at: string;
}

export interface Citation {
  raw: string;
  esasNo: string;
  kararNo: string;
  decisionId: number | null;
  court: string | null;
  sourceUrl: string | null;
}

export type TeyitStatus = 'yesil' | 'sari' | 'kirmizi' | 'gri';
export type TeyitKind = 'karar' | 'kanun' | 'olgu';

export interface TeyitItem {
  key: string;
  kind: TeyitKind;
  quote: string;
  status: TeyitStatus;
  note: string;
  source: { label: string; url?: string; quote?: string } | null;
  deep: boolean;
}

export interface TeyitReport {
  items: TeyitItem[];
  counts: Record<TeyitStatus, number>;
  deepCheckedAt: string | null;
}

export const TEYIT_LABEL: Record<TeyitStatus, string> = {
  yesil: 'Teyit edildi',
  sari: 'Kontrol edilmeli',
  kirmizi: 'Teyit edilemedi',
  gri: 'Sonuçsuz',
};

export const KIND_LABEL: Record<TeyitKind, string> = {
  karar: 'Karar',
  kanun: 'Kanun',
  olgu: 'Olay',
};

export interface OpposingSummary {
  id: number;
  title: string;
  created_at: string;
}

export interface OpposingDetail extends OpposingSummary {
  case_id: number;
  body: string;
  teyit: TeyitReport;
}

export interface PetitionDetail {
  id: number;
  case_id: number;
  title: string;
  status: PetitionStatus;
  author_id: number;
  body: string;
  version: number;
  citations: Citation[];
  teyit: TeyitReport;
  acks: string[];
  approval: {
    version: number;
    created_at: string;
    reviewer_name: string;
    summary: Record<TeyitStatus, number> & { total: number; deep: boolean };
  } | null;
  versions: { version: number; body: string; created_at: string; created_by: number; created_by_name: string }[];
  reviews: { version: number; action: 'approve' | 'request_changes'; comment: string; created_at: string; reviewer_name: string }[];
}

export const STATUS_LABEL: Record<PetitionStatus, string> = {
  taslak: 'Taslak',
  incelemede: 'İncelemede',
  duzeltme: 'Düzeltme istendi',
  onayli: 'Onaylı',
};

export class ApiError extends Error {
  constructor(
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

let token: string | null = localStorage.getItem('timay-token');

export function setToken(value: string | null) {
  token = value;
  if (value) localStorage.setItem('timay-token', value);
  else localStorage.removeItem('timay-token');
}

export function hasToken() {
  return token !== null;
}

export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${getServerUrl()}/api${path}`, {
      method: init.method ?? (init.body === undefined ? 'GET' : 'POST'),
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
  } catch {
    throw new ApiError('Sunucuya bağlanılamadı. İnternet bağlantınızı kontrol edin.');
  }
  const data = await res.json();
  if (!res.ok) {
    if (res.status === 401) setToken(null);
    throw new ApiError(data.error ?? 'Bir hata oluştu.', data.details);
  }
  return data as T;
}
