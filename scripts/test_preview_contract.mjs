import assert from 'node:assert/strict';
import { createElement } from 'react';
import { createServer } from 'vite';
const server = await createServer({
  configFile: false,
  logLevel: 'error',
  server: { middlewareMode: true },
});
try {
  const { calculatePreviewLayout: layout } = await server.ssrLoadModule(
    '/src/dictionaryPreviewLayout.ts',
  );
  const { groupDictionaryPreviewMeanings: group } = await server.ssrLoadModule(
    '/src/dictionaryPreviewGroups.ts',
  );
  const viewport = { left: 0, top: 0, right: 390, bottom: 844 };
  const anchor = { left: 120, top: 300, right: 150, bottom: 320 };
  assert.deepEqual(layout(anchor, viewport, 100), {
    safe: { left: 8, top: 8, right: 382, bottom: 836 },
    bottomSpace: 512,
    topSpace: 288,
    side: 'bottom',
    width: 280,
    height: 100,
    left: 102,
    top: 324,
  });
  assert.equal(layout({ ...anchor, top: 790, bottom: 810 }, viewport, 700).side, 'top');
  const limited = layout({ ...anchor, top: 200, bottom: 220 }, { ...viewport, bottom: 400 }, 700);
  assert.equal(limited.side, 'top');
  assert.equal(limited.height, 188);
  assert.equal(limited.top, 8);
  assert.equal(layout(anchor, { ...viewport, right: 135 }, 200), undefined);
  assert.equal(
    layout({ left: 10, right: 50, top: 100, bottom: 120 }, { ...viewport, bottom: 220 }, 700),
    undefined,
  );
  const defs = (id, pos, definition) => ({ id, partOfSpeech: pos, definition });
  const node = createElement('em', null, 'React definition');
  const groups = group({
    word: 'probe',
    sources: [
      {
        id: 'a',
        label: '甲',
        meanings: [
          defs('1', 'v.', 'A'),
          defs('2', 'n.', 'B'),
          defs('3', 'v.', 'C'),
          defs('4', ' ', 'D'),
          defs('5', 'empty', '  '),
        ],
      },
      {
        id: 'b',
        label: '乙',
        meanings: [defs('6', 'n.', 'E'), defs('7', 'adj.', node), defs('8', 'n.', 'B')],
      },
      ...['inflections', 'examples', 'synonyms', 'roots'].map((kind) => ({
        id: kind,
        kind,
        label: kind,
        meanings: [defs(kind, 'wrong', 'wrong')],
      })),
    ],
  });
  assert.deepEqual(
    groups.map((g) => g.partOfSpeech),
    ['v.', 'n.', 'adj.', '未标注词性'],
  );
  assert.deepEqual(
    groups[0].meanings.map((m) => m.definition),
    ['A', 'C'],
  );
  assert.deepEqual(
    groups[1].meanings.map((m) => [m.definition, m.sourceLabel]),
    [
      ['B', '甲'],
      ['E', '乙'],
      ['B', '乙'],
    ],
  );
  assert.equal(groups[2].meanings[0].definition, node);
  assert.deepEqual(group(undefined), []);
  console.log(
    'Preview positioning edge cases, full meaning order, ReactNode, duplicates and source-kind filtering passed.',
  );
} finally {
  await server.close();
}
