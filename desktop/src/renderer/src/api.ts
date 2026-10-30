declare global {
  interface Window {
    timay: { serverUrl: string };
  }
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
  created_at: string;
}

export interface CaseDetail extends CaseSummary {
  parties: string;
  facts: string;
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

export interface PetitionDetail {
  id: number;
  case_id: number;
  title: string;
  status: PetitionStatus;
  author_id: number;
  body: string;
  version: number;
  citations: Citation[];
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
    res = await fetch(`${window.timay.serverUrl}/api${path}`, {
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
