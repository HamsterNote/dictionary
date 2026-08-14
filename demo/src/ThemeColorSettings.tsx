import { THEME_ACCENTS, type ThemeAccentPreset } from '@hamster-note/components/theme';
import './themeColorSettings.css';

const THEME_OPTIONS = [
  'violet',
  'blue',
  'teal',
  'orange',
  'pink',
] satisfies readonly ThemeAccentPreset[];

const THEME_LABELS: Readonly<Record<ThemeAccentPreset, string>> = {
  blue: '蓝色',
  orange: '橙色',
  pink: '粉色',
  teal: '青色',
  violet: '紫色',
};

interface ThemeColorSettingsProps {
  readonly accent: ThemeAccentPreset;
  readonly onAccentChange: (accent: ThemeAccentPreset) => void;
}

export function ThemeColorSettings({ accent, onAccentChange }: ThemeColorSettingsProps) {
  return (
    <fieldset className="theme-color-settings">
      <legend>主题色</legend>
      <div className="theme-color-settings__options">
        {THEME_OPTIONS.map((option) => (
          <label className="theme-color-settings__option" key={option}>
            <input
              checked={accent === option}
              name="theme-accent"
              onChange={() => {
                onAccentChange(option);
              }}
              type="radio"
            />
            <span
              aria-hidden="true"
              className="theme-color-settings__swatch"
              style={{ backgroundColor: THEME_ACCENTS[option].accent }}
            />
            <span>{THEME_LABELS[option]}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
