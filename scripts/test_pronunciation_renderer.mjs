import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import { makeFixture } from './pronunciation_test_fixture.mjs';
const server = await createServer({
  logLevel: 'error',
  server: { middlewareMode: true, ws: false },
});
try {
  const contracts = await server.ssrLoadModule('/src/pronunciation-overlay/contracts.ts');
  const identity = await server.ssrLoadModule('/src/pronunciation-overlay/identity.ts');
  const { DictionaryPronunciationOverlay } = await server.ssrLoadModule(
    '/src/DictionaryPronunciationOverlay.tsx',
  );
  const { DictionaryContent } = await server.ssrLoadModule('/src/DictionaryContent.tsx');
  const f = makeFixture(contracts, identity, { fourRoles: true });
  const entries = identity.READ_ROLE_ORDER.map((role) => ({
    entryId: f.ids[role],
    role,
    word: 'read',
    conditions: f.scope({
      entry: contracts.knownScope([f.ids[role]]),
      role: contracts.knownScope([role]),
    }),
    readings: [
      {
        ...f.display,
        entryId: f.ids[role],
        role,
        accent: { class: 'unspecified', label: '未注明口音', unspecified: true },
        originalIpa: '[x]',
        notation: 'phonetic',
        reviewStatus: 'due',
        rawTags: ['rare', 'unknown-nonrestrictive'],
      },
      {
        ...f.display,
        entryId: f.ids[role],
        role,
        originalIpa: '/regional/',
        tier: 'supplemental',
        usage: ['archaic'],
        accent: { class: 'regional', label: 'Scotland', unspecified: false },
      },
      {
        ...f.display,
        entryId: f.ids[role],
        role,
        originalIpa: '/fragment',
        tier: 'evidence-only',
        accent: { class: 'unspecified', label: '未注明口音', unspecified: true },
      },
    ],
  }));
  const render = (props) =>
    renderToStaticMarkup(createElement(DictionaryPronunciationOverlay, props));
  const markup = render({ entries });
  for (const role of ['原形', '一般现在时', '过去式', '过去分词']) assert.ok(markup.includes(role));
  assert.equal((markup.match(/\[x\]/g) ?? []).length, 4);
  assert.match(markup, /未注明口音/u);
  assert.match(markup, /待复核/u);
  assert.match(markup, /unknown-nonrestrictive/u);
  assert.match(markup, /Scotland/u);
  assert.match(markup, /古旧/u);
  assert.match(markup, /片段证据，未作完整读法/u);
  assert.doesNotMatch(markup, /英：|UK|US|朗读/u);
  assert.doesNotMatch(markup, /纠错该读音/u);
  for (const url of Object.values(f.display.attribution).filter((value) =>
    value.startsWith('https:'),
  ))
    assert.ok(markup.includes(url.replaceAll('&', '&amp;')));
  assert.match(render({ entries, corrections: { values: [], onChange: () => {} } }), /纠错该读音/u);
  assert.doesNotMatch(
    render({ entries, corrections: { disabled: true, values: [], onChange: () => {} } }),
    /纠错该读音/u,
  );
  const props = {
    // 夹具词必须没有系统纠错（read 已获批准纠正，会覆盖 props.phonetic）。
    keyword: 'renderer-fixture-word',
    phonetic: '/old/',
    meanings: [{ id: 'read', definition: 'synthetic' }],
    corrections: { user: {} },
  };
  const legacy = renderToStaticMarkup(createElement(DictionaryContent, props));
  const opted = renderToStaticMarkup(
    createElement(DictionaryContent, {
      ...props,
      pronunciationOverlay: createElement(DictionaryPronunciationOverlay, { entries }),
    }),
  );
  assert.match(legacy, /英：\/old\//u);
  assert.doesNotMatch(opted, /英：/u);
  const blocked = renderToStaticMarkup(
    createElement(DictionaryContent, {
      ...props,
      corrections: { user: { 'renderer-fixture-word': { phonetic: '' } } },
      pronunciationOverlay: createElement(DictionaryPronunciationOverlay, { entries }),
      pronunciationCandidates: 'synthetic comparison',
    }),
  );
  assert.doesNotMatch(blocked, /dictionary-pronunciations/u);
  assert.match(blocked, /synthetic comparison/u);
  assert.match(blocked, /新读法暂未启用/u);
  console.log(
    'test_pronunciation_renderer: OK (SSR, four roles, original delimiters, attribution, legacy branch and protection)',
  );
} finally {
  await server.close();
}
