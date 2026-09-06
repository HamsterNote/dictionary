import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

const server = await createServer({ logLevel: 'error', server: { middlewareMode: true } });

try {
  const { DictionaryCorrectionDetailsContent } = await server.ssrLoadModule(
    '/src/DictionaryCorrectionDetailsDialog.tsx',
  );
  const changes = [
    { after: '/nəʊt/', before: '/noʊt/', field: 'phonetic', origin: 'user' },
  ];

  // Given an editable user correction; When its detail content is rendered; Then deletion is offered.
  const userMarkup = renderToStaticMarkup(
    createElement(DictionaryCorrectionDetailsContent, {
      changes,
      onClose: () => undefined,
      onDelete: () => undefined,
    }),
  );
  assert.match(userMarkup, />删除纠错</u);

  // Given a correction without a user deletion callback; Then the destructive action is absent.
  const systemMarkup = renderToStaticMarkup(
    createElement(DictionaryCorrectionDetailsContent, {
      changes: [{ ...changes[0], origin: 'system' }],
      onClose: () => undefined,
    }),
  );
  assert.doesNotMatch(systemMarkup, />删除纠错</u);
} finally {
  await server.close();
}
