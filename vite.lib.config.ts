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
        kokoro: resolve(import.meta.dirname, 'src/kokoro.ts'),
        'dictionary-packs/chinese-dictionary': resolve(
          import.meta.dirname,
          'src/dictionary-packs/chinese-dictionary.ts',
        ),
        'dictionary-packs/chinese-dictionary-words': resolve(
          import.meta.dirname,
          'src/dictionary-packs/chinese-dictionary-words.ts',
        ),
        'dictionary-packs/chinese-xinhua': resolve(
          import.meta.dirname,
          'src/dictionary-packs/chinese-xinhua.ts',
        ),
        'dictionary-packs/chinese-xinhua-words': resolve(
          import.meta.dirname,
          'src/dictionary-packs/chinese-xinhua-words.ts',
        ),
        'example-sentence-packs/bnc': resolve(
          import.meta.dirname,
          'src/example-sentence-packs/bnc.ts',
        ),
        'example-sentence-packs/cet4': resolve(
          import.meta.dirname,
          'src/example-sentence-packs/cet4.ts',
        ),
        'example-sentence-packs/cet6': resolve(
          import.meta.dirname,
          'src/example-sentence-packs/cet6.ts',
        ),
        'example-sentence-packs/core': resolve(
          import.meta.dirname,
          'src/example-sentence-packs/core.ts',
        ),
        'example-sentence-packs/gk': resolve(
          import.meta.dirname,
          'src/example-sentence-packs/gk.ts',
        ),
        'example-sentence-packs/gre': resolve(
          import.meta.dirname,
          'src/example-sentence-packs/gre.ts',
        ),
        'example-sentence-packs/ielts': resolve(
          import.meta.dirname,
          'src/example-sentence-packs/ielts.ts',
        ),
        'example-sentence-packs/ky': resolve(
          import.meta.dirname,
          'src/example-sentence-packs/ky.ts',
        ),
        'example-sentence-packs/toefl': resolve(
          import.meta.dirname,
          'src/example-sentence-packs/toefl.ts',
        ),
        'example-sentence-packs/zk': resolve(
          import.meta.dirname,
          'src/example-sentence-packs/zk.ts',
        ),
        'inflection-packs/forms': resolve(import.meta.dirname, 'src/inflection-packs/forms.ts'),
        'inflection-packs/reverse': resolve(import.meta.dirname, 'src/inflection-packs/reverse.ts'),
        'synonym-packs/bnc': resolve(import.meta.dirname, 'src/synonym-packs/bnc.ts'),
        'synonym-packs/cet4': resolve(import.meta.dirname, 'src/synonym-packs/cet4.ts'),
        'synonym-packs/cet6': resolve(import.meta.dirname, 'src/synonym-packs/cet6.ts'),
        'synonym-packs/core': resolve(import.meta.dirname, 'src/synonym-packs/core.ts'),
        'synonym-packs/gk': resolve(import.meta.dirname, 'src/synonym-packs/gk.ts'),
        'synonym-packs/gre': resolve(import.meta.dirname, 'src/synonym-packs/gre.ts'),
        'synonym-packs/ielts': resolve(import.meta.dirname, 'src/synonym-packs/ielts.ts'),
        'synonym-packs/ky': resolve(import.meta.dirname, 'src/synonym-packs/ky.ts'),
        'synonym-packs/toefl': resolve(import.meta.dirname, 'src/synonym-packs/toefl.ts'),
        'synonym-packs/zk': resolve(import.meta.dirname, 'src/synonym-packs/zk.ts'),
        'root-packs/bnc': resolve(import.meta.dirname, 'src/root-packs/bnc.ts'),
        'root-packs/cet4': resolve(import.meta.dirname, 'src/root-packs/cet4.ts'),
        'root-packs/cet6': resolve(import.meta.dirname, 'src/root-packs/cet6.ts'),
        'root-packs/core': resolve(import.meta.dirname, 'src/root-packs/core.ts'),
        'root-packs/gk': resolve(import.meta.dirname, 'src/root-packs/gk.ts'),
        'root-packs/gre': resolve(import.meta.dirname, 'src/root-packs/gre.ts'),
        'root-packs/ielts': resolve(import.meta.dirname, 'src/root-packs/ielts.ts'),
        'root-packs/ky': resolve(import.meta.dirname, 'src/root-packs/ky.ts'),
        'root-packs/toefl': resolve(import.meta.dirname, 'src/root-packs/toefl.ts'),
        'root-packs/zk': resolve(import.meta.dirname, 'src/root-packs/zk.ts'),
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
      external: [/^@hamster-note\/components(?:\/.*)?$/, 'react', 'react-dom', 'react/jsx-runtime'],
    },
    sourcemap: true,
    target: 'esnext',
  },
  worker: { format: 'es' },
});
