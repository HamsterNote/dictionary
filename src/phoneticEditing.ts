import type { DictionaryIpaKeyboardAction } from './DictionaryIpaKeyboard';

export interface PhoneticEditResult {
  readonly cursor: number;
  readonly value: string;
}

function graphemeOffsets(value: string): readonly number[] {
  const segmenter = new Intl.Segmenter('zh', { granularity: 'grapheme' });
  const offsets = [0];
  for (const segment of segmenter.segment(value)) {
    offsets.push(segment.index + segment.segment.length);
  }
  return offsets;
}

function graphemeIndexAt(offsets: readonly number[], position: number): number {
  const index = offsets.indexOf(position);
  return index === -1 ? offsets.length - 1 : index;
}

function deleteGraphemeRange(
  value: string,
  offsets: readonly number[],
  from: number,
  to: number,
): string {
  return value.slice(0, offsets[from] ?? 0) + value.slice(offsets[to] ?? value.length);
}

export function applyPhoneticAction(
  value: string,
  start: number,
  end: number,
  action: DictionaryIpaKeyboardAction,
): PhoneticEditResult {
  const offsets = graphemeOffsets(value);
  const startIndex = graphemeIndexAt(offsets, Math.min(start, end));
  const endIndex = graphemeIndexAt(offsets, Math.max(start, end));

  if (action.kind === 'move') {
    if (startIndex !== endIndex) {
      const anchor = action.direction === 'left' ? startIndex : endIndex;
      return { cursor: offsets[anchor] ?? 0, value };
    }
    const delta = action.direction === 'left' ? -1 : 1;
    const nextIndex = Math.min(Math.max(startIndex + delta, 0), offsets.length - 1);
    return { cursor: offsets[nextIndex] ?? 0, value };
  }

  if (action.kind === 'backspace') {
    if (startIndex === endIndex && startIndex === 0) return { cursor: 0, value };
    const from = startIndex === endIndex ? startIndex - 1 : startIndex;
    return {
      cursor: offsets[from] ?? 0,
      value: deleteGraphemeRange(value, offsets, from, endIndex),
    };
  }

  const head = value.slice(0, offsets[startIndex] ?? 0);
  const tail = value.slice(offsets[endIndex] ?? value.length);
  return {
    cursor: (offsets[startIndex] ?? 0) + action.symbol.length,
    value: head + action.symbol + tail,
  };
}

export function applyPhoneticForwardDelete(
  value: string,
  start: number,
  end: number,
): PhoneticEditResult {
  const offsets = graphemeOffsets(value);
  const startIndex = graphemeIndexAt(offsets, Math.min(start, end));
  const endIndex = graphemeIndexAt(offsets, Math.max(start, end));
  if (startIndex !== endIndex) {
    return {
      cursor: offsets[startIndex] ?? 0,
      value: deleteGraphemeRange(value, offsets, startIndex, endIndex),
    };
  }
  if (startIndex >= offsets.length - 1) return { cursor: offsets[startIndex] ?? 0, value };
  return {
    cursor: offsets[startIndex] ?? 0,
    value: deleteGraphemeRange(value, offsets, startIndex, startIndex + 1),
  };
}
