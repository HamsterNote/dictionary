import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig(({ mode }) => ({
  root: resolve(import.meta.dirname, 'demo'),
  base: mode === 'production' ? '/dictionary/' : '/',
  plugins: [react()],
  server: {
    host: true,
    port: 9489,
    strictPort: true,
  },
  preview: {
    host: true,
    port: 9489,
    strictPort: true,
  },
  build: {
    outDir: resolve(import.meta.dirname, 'demo-dist'),
    emptyOutDir: true,
  },
}));
