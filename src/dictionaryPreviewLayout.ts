export interface PreviewRect {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

export function intersectPreviewRects(a: PreviewRect, b: PreviewRect): PreviewRect {
  return {
    left: Math.max(a.left, b.left),
    top: Math.max(a.top, b.top),
    right: Math.min(a.right, b.right),
    bottom: Math.min(a.bottom, b.bottom),
  };
}
const nonempty = (r: PreviewRect) => r.right > r.left && r.bottom > r.top;

/** Client rects, visual viewport and the body portal all use layout-viewport CSS pixels. */
export function getPreviewViewport(anchor: HTMLElement): PreviewRect {
  const view = anchor.ownerDocument.defaultView ?? window;
  const visual = view.visualViewport;
  let rect: PreviewRect = { left: 0, top: 0, right: view.innerWidth, bottom: view.innerHeight };
  if (visual)
    rect = intersectPreviewRects(rect, {
      left: visual.offsetLeft,
      top: visual.offsetTop,
      right: visual.offsetLeft + visual.width,
      bottom: visual.offsetTop + visual.height,
    });
  // Intersect a same-origin host's actually visible frame area (keyboard and pinch zoom).
  try {
    const frame = view.frameElement as HTMLElement | null;
    const outer = view.parent;
    if (frame) {
      const box = frame.getBoundingClientRect();
      const visual = outer.visualViewport;
      const visible = {
        left: visual?.offsetLeft ?? 0,
        top: visual?.offsetTop ?? 0,
        right: (visual?.offsetLeft ?? 0) + (visual?.width ?? outer.innerWidth),
        bottom: (visual?.offsetTop ?? 0) + (visual?.height ?? outer.innerHeight),
      };
      const sx = box.width / (frame.offsetWidth || box.width);
      const sy = box.height / (frame.offsetHeight || box.height);
      const left = box.left + frame.clientLeft * sx,
        top = box.top + frame.clientTop * sy;
      rect = intersectPreviewRects(rect, {
        left: (visible.left - left) / sx,
        top: (visible.top - top) / sy,
        right: (visible.right - left) / sx,
        bottom: (visible.bottom - top) / sy,
      });
    }
  } catch {
    /* Cross-origin frames use their own content viewport. */
  }
  for (
    let parent = anchor.parentElement;
    parent && parent !== anchor.ownerDocument.body;
    parent = parent.parentElement
  ) {
    const style = view.getComputedStyle(parent);
    const box = parent.getBoundingClientRect();
    const sx = parent.offsetWidth ? box.width / parent.offsetWidth : 1;
    const sy = parent.offsetHeight ? box.height / parent.offsetHeight : 1;
    const left = box.left + parent.clientLeft * sx;
    const top = box.top + parent.clientTop * sy;
    if (/auto|scroll|hidden|clip/.test(style.overflowX))
      rect = {
        ...rect,
        left: Math.max(rect.left, left),
        right: Math.min(rect.right, left + parent.clientWidth * sx),
      };
    if (/auto|scroll|hidden|clip/.test(style.overflowY))
      rect = {
        ...rect,
        top: Math.max(rect.top, top),
        bottom: Math.min(rect.bottom, top + parent.clientHeight * sy),
      };
  }
  return rect;
}

const fragments = new WeakMap<HTMLElement, number>();
export function selectPreviewFragment(anchor: HTMLElement, point?: { x: number; y: number }) {
  const viewport = getPreviewViewport(anchor);
  const candidates = Array.from(anchor.getClientRects())
    .map((rect, index) => ({ index, rect: intersectPreviewRects(rect, viewport) }))
    .filter(({ rect }) => nonempty(rect));
  if (point)
    candidates.sort((a, b) => {
      const distance = (r: PreviewRect) =>
        Math.hypot(
          Math.max(r.left - point.x, 0, point.x - r.right),
          Math.max(r.top - point.y, 0, point.y - r.bottom),
        );
      const da = distance(a.rect),
        db = distance(b.rect);
      return (
        da - db ||
        (da === 0
          ? (a.rect.right - a.rect.left) * (a.rect.bottom - a.rect.top) -
            (b.rect.right - b.rect.left) * (b.rect.bottom - b.rect.top)
          : 0) ||
        a.index - b.index
      );
    });
  fragments.set(anchor, candidates[0]?.index ?? 0);
}

export function getPreviewAnchor(
  anchor: HTMLElement,
  viewport: PreviewRect,
): PreviewRect | undefined {
  if (
    !anchor.isConnected ||
    anchor.ownerDocument.defaultView?.getComputedStyle(anchor).visibility === 'hidden'
  )
    return undefined;
  const rect = anchor.getClientRects()[fragments.get(anchor) ?? 0];
  if (!rect) return undefined;
  const visible = intersectPreviewRects(rect, viewport);
  return nonempty(visible) ? visible : undefined;
}

export function calculatePreviewLayout(
  anchor: PreviewRect,
  viewport: PreviewRect,
  naturalHeight: number,
) {
  const safe = {
    left: viewport.left + 8,
    top: viewport.top + 8,
    right: viewport.right - 8,
    bottom: viewport.bottom - 8,
  };
  const bottomSpace = Math.max(0, safe.bottom - anchor.bottom - 4);
  const topSpace = Math.max(0, anchor.top - safe.top - 4);
  const width = Math.min(280, safe.right - safe.left);
  if (width < 120 || Math.max(bottomSpace, topSpace) < 128) return undefined;
  const height = Math.min(naturalHeight, 420, 0.6 * (viewport.bottom - viewport.top));
  const side =
    bottomSpace >= height
      ? 'bottom'
      : topSpace >= height
        ? 'top'
        : bottomSpace >= topSpace
          ? 'bottom'
          : 'top';
  const actualHeight = Math.min(height, side === 'bottom' ? bottomSpace : topSpace);
  return {
    safe,
    bottomSpace,
    topSpace,
    side,
    width,
    height: actualHeight,
    left: Math.min(Math.max(anchor.left, safe.left), safe.right - width),
    top: side === 'bottom' ? anchor.bottom + 4 : anchor.top - 4 - actualHeight,
  };
}
