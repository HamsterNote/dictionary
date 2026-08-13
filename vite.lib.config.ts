import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  build: {
    emptyOutDir: false,
    lib: {
      entry: {
        index: resolve(import.meta.dirname, 'src/library.ts'),
        'vocabulary-packs/bnc': resolve(import.meta.dirname, 'src/vocabulary-packs/bnc.ts'),
        'vocabulary-packs/cet4': resolve(import.meta.dirname, 'src/vocabulary-packs/cet4.ts'),
        'vocabulary-packs/cet6': resolve(import.meta.dirname, 'src/vocabulary-packs/cet6.ts'),
        'vocabulary-packs/gk': resolve(import.meta.dirname, 'src/vocabulary-packs/gk.ts'),
        'vocabulary-packs/gre': resolve(import.meta.dirname, 'src/vocabulary-packs/gre.ts'),
        'vocabulary-packs/ielts': resolve(import.meta.dirname, 'src/vocabulary-packs/ielts.ts'),
        'vocabulary-packs/ky': resolve(import.meta.dirname, 'src/vocabulary-packs/ky.ts'),
        'vocabulary-packs/toefl': resolve(import.meta.dirname, 'src/vocabulary-packs/toefl.ts'),
        'vocabulary-packs/zk': resolve(import.meta.dirname, 'src/vocabulary-packs/zk.ts'),
      },
      formats: ['es'],
      fileName: (_format, entryName) => `${entryName}.js`,
      cssFileName: 'dictionary',
    },
    rolldownOptions: {
      external: [
        /^@hamster-note\/components(?:\/.*)?$/,
        '@system-ui-js/multi-drag',
        '@system-ui-js/multi-drag-core',
        'loglevel',
        'react',
        'react-dom',
        'react/jsx-runtime',
      ],
    },
    sourcemap: true,
  },
});
