import { contextBridge } from 'electron';

contextBridge.exposeInMainWorld('timay', {
  serverUrl: process.env.TIMAY_SERVER_URL ?? 'http://localhost:4000',
});
