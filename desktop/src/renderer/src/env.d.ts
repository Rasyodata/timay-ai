/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_TIMAY_SERVER_URL?: string;
}

interface Window {
  /** Masaüstü uygulamasının ön yükleme köprüsü (tarayıcıda yoktur). */
  timay?: { bedesten: (path: 'searchDocuments' | 'getDocumentContent', data: unknown) => Promise<unknown> };
}

declare module 'utif' {
  interface IFD {
    width: number;
    height: number;
  }
  const UTIF: {
    decode(buf: ArrayBuffer): IFD[];
    decodeImage(buf: ArrayBuffer, ifd: IFD): void;
    toRGBA8(ifd: IFD): Uint8Array;
  };
  export default UTIF;
}
