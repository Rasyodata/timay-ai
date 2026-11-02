import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// Tarayıcı (web) sürümü: aynı ekranlar, Timay sunucusunun /uygulama/ adresinden açılır.
// timayplatform.com gibi sitelerin içine (iframe) de bu adres konur.
export default defineConfig({
  root: resolve(__dirname, 'src/renderer'),
  base: '/uygulama/',
  plugins: [react()],
  define: { 'import.meta.env.VITE_TIMAY_WEB': JSON.stringify('1') },
  build: { outDir: resolve(__dirname, 'out-web'), emptyOutDir: true },
});
