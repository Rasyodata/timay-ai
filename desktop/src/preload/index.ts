import { contextBridge, ipcRenderer } from 'electron';

// Yargıtay karar veritabanına avukatın bilgisayarından ulaşmak için (bkz. main/index.ts).
contextBridge.exposeInMainWorld('timay', {
  bedesten: (path: 'searchDocuments' | 'getDocumentContent', data: unknown) => ipcRenderer.invoke('bedesten', path, data),
});
