export interface VocabularyPackOption {
  readonly entryCount: number;
  readonly gzipBytes: number;
  readonly id: string;
  readonly label: string;
}

export interface VocabularyPackGroup {
  readonly id: string;
  readonly label: string;
  readonly options: readonly VocabularyPackOption[];
}

interface VocabularyPackPickerProps {
  readonly activeIds: ReadonlySet<string>;
  readonly errorMessage?: string;
  readonly estimatedGzipBytes: number;
  readonly loadingIds: ReadonlySet<string>;
  readonly onToggle: (id: string, enabled: boolean) => void;
  readonly groups: readonly VocabularyPackGroup[];
}

function formatKilobytes(bytes: number): string {
  return `${Math.round(bytes / 1024).toLocaleString('zh-CN')} kB`;
}

export function VocabularyPackPicker({
  activeIds,
  errorMessage,
  estimatedGzipBytes,
  loadingIds,
  onToggle,
  groups,
}: VocabularyPackPickerProps) {
  return (
    <fieldset className="vocabulary-picker">
      <legend>可选词汇包</legend>
      <p className="vocabulary-picker__hint">
        按学习目标分组，勾选后才会加载；多个词包按词头
        <span className="vocabulary-picker__keep">自动去重</span>。
      </p>
      <div className="vocabulary-picker__groups">
        {groups.map((group) => {
          const headingId = `vocabulary-pack-group-${group.id}`;
          return (
            <fieldset
              aria-labelledby={headingId}
              className="vocabulary-picker__group"
              key={group.id}
            >
              <legend className="vocabulary-picker__group-title" id={headingId}>
                {group.label}
              </legend>
              <div className="vocabulary-picker__options">
                {group.options.map((option) => {
                  const isLoading = loadingIds.has(option.id);
                  return (
                    <label className="vocabulary-picker__option" key={option.id}>
                      <input
                        aria-busy={isLoading}
                        aria-disabled={isLoading}
                        checked={activeIds.has(option.id) || isLoading}
                        onChange={(event) => {
                          if (isLoading) return;
                          onToggle(option.id, event.currentTarget.checked);
                        }}
                        type="checkbox"
                      />
                      <span className="vocabulary-picker__name">{option.label}</span>
                      <span className="vocabulary-picker__size">
                        {isLoading
                          ? '加载中…'
                          : `${option.entryCount.toLocaleString('zh-CN')} 词 · ${formatKilobytes(option.gzipBytes)}`}
                      </span>
                    </label>
                  );
                })}
              </div>
            </fieldset>
          );
        })}
      </div>
      <p aria-live="polite" className="vocabulary-picker__loading" role="status">
        {loadingIds.size > 0 ? '正在加载所选词汇包…' : ''}
      </p>
      <output aria-live="polite" className="vocabulary-picker__estimate">
        预计最终 JS 大小（gzip）：约 {formatKilobytes(estimatedGzipBytes)}
      </output>
      {errorMessage ? (
        <p className="vocabulary-picker__error" role="alert">
          {errorMessage}
        </p>
      ) : null}
      <p className="vocabulary-picker__note">保守累加估算，不含 React 与宿主应用代码。</p>
    </fieldset>
  );
}
