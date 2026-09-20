import { useState } from 'react';
import type { DictionaryCorrectionMap } from '../../src';
import './correctionLists.css';

interface CorrectionListsProps {
  readonly system: DictionaryCorrectionMap;
  readonly user: DictionaryCorrectionMap;
  readonly onRemoveSystem: (word: string) => void;
  readonly onRemoveUser: (word: string) => void;
  readonly onRestoreSystem: () => void;
  readonly removedCount: number;
}

export function CorrectionLists(props: CorrectionListsProps) {
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const run = (action: () => void, message: string) => {
    try {
      action();
      setError('');
      setStatus(message);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '删除失败，请检查浏览器存储权限。');
      setStatus('');
    }
  };
  const groups = [
    { title: '系统纠错', map: props.system, remove: props.onRemoveSystem },
    { title: '用户纠错', map: props.user, remove: props.onRemoveUser },
  ];

  return (
    <section className="correction-lists" aria-labelledby="correction-lists-title">
      <h2 id="correction-lists-title">已纠错列表</h2>
      <p>按原词头列出补丁。用户纠错优先于系统纠错，删除后回退到下一层数据。</p>
      {groups.map(({ title, map, remove }) => {
        const entries = Object.entries(map).sort(([a], [b]) => a.localeCompare(b, 'zh-CN'));
        return (
          <section key={title} aria-label={title}>
            <h3>
              {title} <span>({entries.length})</span>
            </h3>
            {entries.length === 0 ? (
              <p>暂无{title}</p>
            ) : (
              <ul>
                {entries.map(([word, patch]) => (
                  <li key={word}>
                    <div>
                      <strong>{word}</strong>
                      <dl>
                        {patch.word !== undefined ? (
                          <>
                            <dt>词头</dt>
                            <dd>{patch.word}</dd>
                          </>
                        ) : null}
                        {patch.phonetic !== undefined ? (
                          <>
                            <dt>音标</dt>
                            <dd>{patch.phonetic}</dd>
                          </>
                        ) : null}
                        {patch.meaning !== undefined ? (
                          <>
                            <dt>释义</dt>
                            <dd>{patch.meaning}</dd>
                          </>
                        ) : null}
                      </dl>
                    </div>
                    <button
                      type="button"
                      aria-label={`删除${title} ${word}`}
                      onClick={() => {
                        run(() => {
                          remove(word);
                        }, `已删除${title}：${word}`);
                      }}
                    >
                      删除
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}
      <p>
        系统纠错文件：<code>src/data/dictionarySystemCorrections.json</code>
        。系统删除仅在当前浏览器的 Demo 中生效，不修改源码。
      </p>
      {props.removedCount > 0 ? (
        <button
          type="button"
          onClick={() => {
            run(props.onRestoreSystem, '已恢复系统纠错');
          }}
        >
          恢复系统纠错 ({props.removedCount})
        </button>
      ) : null}
      <p role="status">{status}</p>
      {error ? <p role="alert">{error}</p> : null}
    </section>
  );
}
