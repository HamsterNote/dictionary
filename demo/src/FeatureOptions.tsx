interface FeatureOptionsProps {
  readonly pronunciationEnabled: boolean;
  readonly onPronunciationToggle: (enabled: boolean) => void;
}

export function FeatureOptions({
  pronunciationEnabled,
  onPronunciationToggle,
}: FeatureOptionsProps) {
  return (
    <fieldset className="feature-options">
      <legend>可选功能</legend>
      <label className="feature-options__option">
        <input
          checked={pronunciationEnabled}
          onChange={(event) => {
            onPronunciationToggle(event.currentTarget.checked);
          }}
          type="checkbox"
        />
        <span>
          <span className="feature-options__name">Kokoro 英文朗读</span>
          <span className="feature-options__description">
            勾选后显示朗读按钮；<span className="feature-options__keep">首次点击才下载</span>
            <span className="feature-options__keep">约 92 MB 语音模型</span>。
          </span>
        </span>
      </label>
    </fieldset>
  );
}
