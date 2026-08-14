import { DictionaryLicenseInfo } from './DictionaryLicenseInfo';
import { getDictionaryLicenseInfo } from './dictionaryLicenseInfo';

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

export interface VocabularyPackSupplementImpact {
  readonly gzipBytes: number;
  readonly labels: readonly string[];
}

interface VocabularyPackPickerProps {
  readonly activeIds: ReadonlySet<string>;
  readonly errorMessage?: string;
  readonly estimatedGzipBytes: number;
  readonly loadingIds: ReadonlySet<string>;
  readonly onToggle: (id: string, enabled: boolean) => void;
  readonly groups: readonly VocabularyPackGroup[];
  readonly supplementImpacts: ReadonlyMap<string, VocabularyPackSupplementImpact>;
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
  supplementImpacts,
}: VocabularyPackPickerProps) {
  return (
    <fieldset className="vocabulary-picker">
      <legend>可选词库</legend>
      <p className="vocabulary-picker__hint">
        按语言与学习目标分组，勾选后才会加载；多个词库按词头
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
                  const inputId = `vocabulary-pack-${option.id}`;
                  const license = getDictionaryLicenseInfo(option.id);
                  const supplementImpact = supplementImpacts.get(option.id);
                  return (
                    <div className="vocabulary-picker__option" key={option.id}>
                      <input
                        aria-busy={isLoading}
                        aria-disabled={isLoading}
                        checked={activeIds.has(option.id) || isLoading}
                        id={inputId}
                        onChange={(event) => {
                          if (isLoading) return;
                          onToggle(option.id, event.currentTarget.checked);
                        }}
                        type="checkbox"
                      />
                      <label className="vocabulary-picker__option-label" htmlFor={inputId}>
                        <span className="vocabulary-picker__name-row">
                          <span className="vocabulary-picker__name">{option.label}</span>
                          {supplementImpact === undefined ? null : (
                            <span className="vocabulary-picker__supplements">
                              + {supplementImpact.labels.join(' · ')}
                            </span>
                          )}
                        </span>
                        <span className="vocabulary-picker__size">
                          {isLoading
                            ? '加载中…'
                            : `${option.entryCount.toLocaleString('zh-CN')} 词 · ${formatKilobytes(option.gzipBytes + (supplementImpact?.gzipBytes ?? 0))}`}
                        </span>
                      </label>
                      <DictionaryLicenseInfo dictionaryLabel={option.label} license={license} />
                    </div>
                  );
                })}
              </div>
            </fieldset>
          );
        })}
      </div>
      <p aria-live="polite" className="vocabulary-picker__loading" role="status">
        {loadingIds.size > 0 ? '正在加载所选词库…' : ''}
      </p>
      <output aria-live="polite" className="vocabulary-picker__estimate">
        根入口与已启用数据快照（gzip）：约 {formatKilobytes(estimatedGzipBytes)}
      </output>
      {errorMessage ? (
        <p className="vocabulary-picker__error" role="alert">
          {errorMessage}
        </p>
      ) : null}
      <p className="vocabulary-picker__note">快照估算，不等同于构建后 JS 块大小。</p>
    </fieldset>
  );
}
