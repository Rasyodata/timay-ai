/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_TIMAY_SERVER_URL?: string;
}

interface Window {
  /** Masaüstü uygulamasının ön yükleme köprüsü (tarayıcıda yoktur). */
  timay?: {
    bedesten: (path: 'searchDocuments' | 'getDocumentContent', data: unknown) => Promise<unknown>;
    backup?: {
      defaultFolder(): Promise<string>;
      pickFolder(current?: string): Promise<string | null>;
      save(fileName: string, base64: string, folder?: string): Promise<string | null>;
      auto(fileName: string, base64: string, folder: string, keep: number): Promise<string>;
      list(folder?: string): Promise<{ name: string; path: string; size: number; date: string }[]>;
      open(path?: string): Promise<{ name: string; base64: string } | null>;
      show(path?: string): Promise<void>;
      mail(path: string, to?: string): Promise<void>;
    };
  };
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
