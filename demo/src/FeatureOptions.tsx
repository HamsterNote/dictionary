interface FeatureOptionsProps {
  readonly definitionWordPreviewEnabled: boolean;
  readonly onDefinitionWordPreviewToggle: (enabled: boolean) => void;
  readonly pronunciationEnabled: boolean;
  readonly onPronunciationToggle: (enabled: boolean) => void;
}

export function FeatureOptions({
  definitionWordPreviewEnabled,
  onDefinitionWordPreviewToggle,
  pronunciationEnabled,
  onPronunciationToggle,
}: FeatureOptionsProps) {
  return (
    <fieldset className="feature-options">
      <legend>可选功能</legend>
      <label className="feature-options__option">
        <input
          type="checkbox"
          checked={definitionWordPreviewEnabled}
          onChange={(event) => {
            onDefinitionWordPreviewToggle(event.currentTarget.checked);
          }}
        />
        <span className="feature-options__name">支持解释内点词汇</span>
      </label>
      <label className="feature-options__option">
        <input
          checked={pronunciationEnabled}
          onChange={(event) => {
            onPronunciationToggle(event.currentTarget.checked);
          }}
          type="checkbox"
        />
        <span>
          <span className="feature-options__name">改用 Kokoro AI 合成朗读</span>
          <span className="feature-options__description">
            默认播放 Commons 真人录音；勾选后改用 Kokoro，
            <span className="feature-options__keep">首次点击才下载</span>
            <span className="feature-options__keep">约 92 MB 语音模型</span>。
          </span>
        </span>
      </label>
    </fieldset>
  );
}
