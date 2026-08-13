import { useEffect, useRef, useState } from 'react';
import { DictionaryPopover } from '../../src';

const MEANINGS = [
  {
    definition: (
      <>
        一小块保存下来的信息，用来帮助<span className="cjk-keep">记忆</span>、思考或与他人分享。
      </>
    ),
    example: (
      <>
        She left a note beside the keyboard. <span className="cjk-keep">她在键盘旁</span>
        留了一张便条。
      </>
    ),
    id: 'written-record',
    partOfSpeech: 'noun · 名词',
  },
  {
    definition: '留意、注意到某个细节，并把它作为值得记住的信息。',
    example: 'Please note the change in opening hours. 请留意开放时间的变化。',
    id: 'notice-detail',
    partOfSpeech: 'verb · 动词',
  },
] as const;

export function Demo() {
  const [isOpen, setIsOpen] = useState(true);
  const focusTargetRef = useRef<'popover' | 'trigger' | null>(null);
  const popoverRef = useRef<HTMLElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (isOpen && focusTargetRef.current === 'popover') {
      popoverRef.current?.focus();
    } else if (!isOpen && focusTargetRef.current === 'trigger') {
      triggerRef.current?.focus();
    }

    focusTargetRef.current = null;
  }, [isOpen]);

  return (
    <main className="demo-shell">
      <section className="demo-copy" aria-labelledby="demo-title">
        <p className="demo-eyebrow">@hamster-note/dictionary</p>
        <h1 id="demo-title">
          <span>不离开当前思路，</span>
          <span>读懂眼前的词。</span>
        </h1>
        <p className="demo-intro">
          一个面向 React 19 的轻量词典悬浮窗。<span className="cjk-keep">它把释义</span>
          、词性和例句<span className="cjk-keep">放进</span>安静的阅读表面， 适合
          <span className="cjk-keep">笔记</span>、编辑器和知识库产品。
        </p>
        <div className="demo-meta">
          <span>React 19</span>
          <span>TypeScript 6</span>
          <span>Vite 8</span>
        </div>
      </section>

      <section className="demo-stage" aria-label="词典悬浮窗演示">
        <div className="demo-document" aria-hidden="true">
          <span className="demo-document__label">Research note · 12 Aug</span>
          <p>
            Capture each useful <mark>note</mark> before the context disappears. Small observations
            become durable knowledge when they stay close to the work.
          </p>
        </div>

        <div className="demo-popover-slot">
          <DictionaryPopover
            meanings={MEANINGS}
            onClose={() => {
              focusTargetRef.current = 'trigger';
              setIsOpen(false);
            }}
            open={isOpen}
            phonetic="/noʊt/"
            ref={popoverRef}
            source="Oxford Learner’s Dictionaries"
            tabIndex={-1}
            word="note"
          />
          {isOpen ? null : (
            <button
              className="demo-trigger"
              onClick={() => {
                focusTargetRef.current = 'popover';
                setIsOpen(true);
              }}
              ref={triggerRef}
              type="button"
            >
              查看 “note” 的释义
            </button>
          )}
        </div>
      </section>
    </main>
  );
}
