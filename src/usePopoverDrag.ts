import { DragBase, DragOperationType, type Pose } from '@system-ui-js/multi-drag';
import { type RefObject, useEffect } from 'react';

interface PopoverDragOptions {
  readonly enabled: boolean;
  readonly popoverRef: RefObject<HTMLElement | null>;
}

export function usePopoverDrag({ enabled, popoverRef }: PopoverDragOptions): void {
  useEffect(() => {
    if (!enabled) return;
    const popover = popoverRef.current;
    if (popover === null) return;
    const handle = popover.querySelector<HTMLButtonElement>('.dictionary-popover__drag-handle');
    if (handle === null) return;

    let position = { x: 0, y: 0 };
    let isDisposed = false;
    const previousTouchAction = handle.style.touchAction;

    const setPosition = (nextPosition: Readonly<{ x: number; y: number }>): void => {
      const viewportInset = 8;
      const rect = popover.getBoundingClientRect();
      const viewport = window.visualViewport;
      const viewportWidth = viewport?.width ?? document.documentElement.clientWidth;
      const viewportHeight = viewport?.height ?? document.documentElement.clientHeight;
      const originLeft = rect.left - position.x;
      const originTop = rect.top - position.y;
      const minimumX = viewportInset - originLeft;
      const maximumX = Math.max(
        minimumX,
        viewportWidth - viewportInset - (originLeft + rect.width),
      );
      const minimumY = viewportInset - originTop;
      const nextX = Math.min(Math.max(nextPosition.x, minimumX), maximumX);
      const nextY = Math.min(
        Math.max(nextPosition.y, minimumY),
        Math.max(minimumY, viewportHeight - 44 - originTop),
      );
      position = { x: nextX, y: nextY };
      popover.style.setProperty('--dictionary-drag-x', `${String(nextX)}px`);
      popover.style.setProperty('--dictionary-drag-y', `${String(nextY)}px`);
    };

    const createDrag = (): DragBase => {
      const drag = new DragBase(
        handle,
        {
          inertial: false,
          maxFingerCount: 1,
          getPose: (): Pose => ({
            height: popover.offsetHeight,
            position,
            width: popover.offsetWidth,
          }),
          setPose: (_target, pose): void => {
            if (pose.position !== undefined) setPosition(pose.position);
          },
          setPoseOnEnd: (_target, pose): void => {
            if (pose.position !== undefined) setPosition(pose.position);
          },
        },
        { drag: true },
      );
      drag.addEventListener(DragOperationType.AllEnd, () => {
        queueMicrotask(() => {
          if (isDisposed) return;
          drag.destroy();
          activeDrag = createDrag();
        });
      });
      return drag;
    };

    let activeDrag = createDrag();
    const handleKeyDown = (event: KeyboardEvent): void => {
      const step = event.shiftKey ? 4 : 12;
      const nextPosition =
        event.key === 'ArrowLeft'
          ? { x: position.x - step, y: position.y }
          : event.key === 'ArrowRight'
            ? { x: position.x + step, y: position.y }
            : event.key === 'ArrowUp'
              ? { x: position.x, y: position.y - step }
              : event.key === 'ArrowDown'
                ? { x: position.x, y: position.y + step }
                : event.key === 'Escape' || event.key === 'Home'
                  ? { x: 0, y: 0 }
                  : undefined;
      if (nextPosition === undefined) return;
      event.preventDefault();
      setPosition(nextPosition);
    };
    const keepInViewport = (): void => {
      if (position.x === 0 && position.y === 0) return;
      setPosition(position);
    };
    handle.addEventListener('keydown', handleKeyDown);
    window.addEventListener('resize', keepInViewport);
    window.visualViewport?.addEventListener('resize', keepInViewport);

    return () => {
      isDisposed = true;
      activeDrag.destroy();
      handle.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('resize', keepInViewport);
      window.visualViewport?.removeEventListener('resize', keepInViewport);
      handle.style.touchAction = previousTouchAction;
    };
  }, [enabled, popoverRef]);
}
