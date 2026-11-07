import { createRoot } from 'react-dom/client';
import { DictionaryContent } from '../../src/DictionaryContent';
import { pronunciationAudioManifest } from '../../src/pronunciation-audio/index';
import { createPronunciationBrowserController } from '../../src/pronunciation-audio/browser';
import '../../src/dictionary.css';

const word = new URLSearchParams(location.search).get('word') ?? 'hello';
const entry = pronunciationAudioManifest.entries.find((candidate) => candidate.word === word);
if (entry === undefined) throw new Error('请使用已核验的真实样本');
const pronunciation = createPronunciationBrowserController();
window.addEventListener('pagehide', () => {
  pronunciation.dispose();
});
const root = document.getElementById('root');
if (root === null) throw new Error('root missing');
createRoot(root).render(
  <DictionaryContent
    keyword={entry.word}
    phonetic={entry.phonetic}
    pronunciation={pronunciation}
    sources={[
      {
        id: 'real-fixture',
        label: 'Real audio fixture',
        meanings: [{ id: 'meaning', definition: `${entry.word} 的真实录音验收` }],
      },
    ]}
  />,
);
