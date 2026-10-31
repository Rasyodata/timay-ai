import { contextBridge, ipcRenderer } from 'electron';

// Yargıtay karar veritabanına avukatın bilgisayarından ulaşmak için (bkz. main/index.ts).
contextBridge.exposeInMainWorld('timay', {
  bedesten: (path: 'searchDocuments' | 'getDocumentContent', data: unknown) => ipcRenderer.invoke('bedesten', path, data),
  backup: {
    defaultFolder: () => ipcRenderer.invoke('backup:defaultFolder'),
    pickFolder: (current?: string) => ipcRenderer.invoke('backup:pickFolder', current),
    save: (fileName: string, base64: string, folder?: string) => ipcRenderer.invoke('backup:save', fileName, base64, folder),
    auto: (fileName: string, base64: string, folder: string, keep: number) => ipcRenderer.invoke('backup:auto', fileName, base64, folder, keep),
    list: (folder?: string) => ipcRenderer.invoke('backup:list', folder),
    open: (path?: string) => ipcRenderer.invoke('backup:open', path),
    show: (path?: string) => ipcRenderer.invoke('backup:show', path),
    mail: (path: string, to?: string) => ipcRenderer.invoke('backup:mail', path, to),
  },
});
