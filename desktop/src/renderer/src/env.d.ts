/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_TIMAY_SERVER_URL?: string;
}

interface Window {
  /** Masaüstü uygulamasının ön yükleme köprüsü (tarayıcıda yoktur). */
  timay?: { bedesten: (path: 'searchDocuments' | 'getDocumentContent', data: unknown) => Promise<unknown> };
}
