import { useLayoutEffect, useRef } from 'react';
import {
  calculatePreviewLayout,
  getPreviewAnchor,
  getPreviewViewport,
} from './dictionaryPreviewLayout';

/** Position only this preview, in its body portal. Never move the reader or focus by scrolling. */
export function useDictionaryPreviewLayout(
  anchor: HTMLElement,
  onClose: () => void,
  onUnavailable: () => void,
  focusOnMount: boolean,
) {
  const ref = useRef<HTMLDivElement>(null);
  const focused = useRef(false);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const view = anchor.ownerDocument.defaultView ?? window;
    let frame = 0;
    let ended = false;
    const update = () => {
      if (ended) return;
      const viewport = getPreviewViewport(anchor);
      const a = getPreviewAnchor(anchor, viewport);
      if (!a || anchor.ownerDocument.hidden) {
        element.style.visibility = 'hidden';
        ended = true;
        onClose();
        return;
      }
      element.style.width = `${String(Math.max(0, Math.min(280, viewport.right - viewport.left - 16)))}px`;
      const header = element.querySelector<HTMLElement>('.dictionary-word-preview__heading');
      const body = element.querySelector<HTMLElement>('.dictionary-word-preview__body');
      if (!header || !body) return;
      const style = view.getComputedStyle(element);
      // Body scrollHeight retains all definitions even when the previous placement was constrained.
      const naturalHeight =
        header.scrollHeight +
        body.scrollHeight +
        12 +
        parseFloat(style.paddingTop) +
        parseFloat(style.paddingBottom) +
        2;
      const layout = calculatePreviewLayout(a, viewport, naturalHeight);
      if (!layout) {
        element.style.visibility = 'hidden';
        ended = true;
        onUnavailable();
        return;
      }
      Object.assign(element.style, {
        left: `${String(layout.left)}px`,
        top: `${String(layout.top)}px`,
        height: `${String(layout.height)}px`,
        visibility: 'visible',
      });
      element.dataset['side'] = layout.side;
      element.dataset['layout'] = JSON.stringify({ anchor: a, viewport, naturalHeight, ...layout });
      if (focusOnMount && !focused.current) {
        element.focus({ preventScroll: true });
        focused.current = true;
      }
    };
    const tick = () => {
      update();
      if (!ended) frame = view.requestAnimationFrame(tick);
    };
    // Also follow animated/transformed ancestors, which ResizeObserver does not report.
    tick();
    view.addEventListener('scroll', update, true);
    view.addEventListener('resize', update);
    view.visualViewport?.addEventListener('scroll', update);
    view.visualViewport?.addEventListener('resize', update);
    anchor.ownerDocument.addEventListener('visibilitychange', update);
    const observer = new ResizeObserver(update);
    observer.observe(anchor);
    observer.observe(element);
    const body = element.querySelector('.dictionary-word-preview__body');
    if (body) observer.observe(body);
    const mutation = new MutationObserver(update);
    mutation.observe(anchor.ownerDocument.body, { childList: true, subtree: true });
    return () => {
      ended = true;
      view.cancelAnimationFrame(frame);
      observer.disconnect();
      mutation.disconnect();
      view.removeEventListener('scroll', update, true);
      view.removeEventListener('resize', update);
      view.visualViewport?.removeEventListener('scroll', update);
      view.visualViewport?.removeEventListener('resize', update);
      anchor.ownerDocument.removeEventListener('visibilitychange', update);
    };
  });
  return ref;
}
