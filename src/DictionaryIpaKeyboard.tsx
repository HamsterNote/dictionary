import { DICTIONARY_IPA_KEY_GROUPS } from './dictionaryIpaKeys';

export type DictionaryIpaKeyboardAction =
  | { readonly kind: 'backspace' }
  | { readonly kind: 'insert'; readonly symbol: string }
  | { readonly kind: 'move'; readonly direction: 'left' | 'right' };

interface DictionaryIpaKeyboardProps {
  readonly onAction: (action: DictionaryIpaKeyboardAction) => void;
}

export function DictionaryIpaKeyboard({ onAction }: DictionaryIpaKeyboardProps) {
  return (
    <div className="dictionary-correction__keyboard">
      {DICTIONARY_IPA_KEY_GROUPS.map((group) => (
        <div className="dictionary-correction__keyboard-group" key={group.label}>
          <p className="dictionary-correction__keyboard-label">{group.label}</p>
          <div className="dictionary-correction__keyboard-keys">
            {group.keys.map((key) => (
              <button
                aria-label={`插入 ${key}`}
                className="dictionary-correction__key"
                key={key}
                onClick={() => {
                  onAction({ kind: 'insert', symbol: key });
                }}
                onPointerDown={(event) => {
                  event.preventDefault();
                }}
                type="button"
              >
                {key}
              </button>
            ))}
          </div>
        </div>
      ))}
      <div className="dictionary-correction__keyboard-controls">
        <button
          aria-label="向左移动光标"
          className="dictionary-correction__key dictionary-correction__key--control"
          onClick={() => {
            onAction({ direction: 'left', kind: 'move' });
          }}
          onPointerDown={(event) => {
            event.preventDefault();
          }}
          type="button"
        >
          ←
        </button>
        <button
          aria-label="向右移动光标"
          className="dictionary-correction__key dictionary-correction__key--control"
          onClick={() => {
            onAction({ direction: 'right', kind: 'move' });
          }}
          onPointerDown={(event) => {
            event.preventDefault();
          }}
          type="button"
        >
          →
        </button>
        <button
          aria-label="删除前一个字符"
          className="dictionary-correction__key dictionary-correction__key--control"
          onClick={() => {
            onAction({ kind: 'backspace' });
          }}
          onPointerDown={(event) => {
            event.preventDefault();
          }}
          type="button"
        >
          ⌫
        </button>
      </div>
    </div>
  );
}
