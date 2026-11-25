import { type PointerEvent as ReactPointerEvent, useCallback, useEffect, useRef } from 'react';

type PendingHold = { id: number; x: number; y: number; timer: number };

export function useIngredientHold() {
  const pending = useRef<PendingHold>();
  const completed = useRef<{ id: number; released: boolean; vibrateOnRelease: boolean }>();
  const cancelHold = useCallback(() => {
    if (!pending.current) return;
    window.clearTimeout(pending.current.timer);
    pending.current = undefined;
  }, []);

  useEffect(() => {
    function onPointerDown(event: PointerEvent) {
      if (event.pointerType === 'touch' && pending.current && pending.current.id !== event.pointerId) cancelHold();
      const hold = completed.current;
      if (event.isPrimary && hold && (hold.released || hold.id === event.pointerId)) completed.current = undefined;
    }

    function onPointerMove(event: PointerEvent) {
      const hold = pending.current;
      if (hold?.id === event.pointerId && Math.hypot(event.clientX - hold.x, event.clientY - hold.y) > 8) cancelHold();
    }

    function endPointer(event: PointerEvent) {
      if (pending.current?.id === event.pointerId) cancelHold();
      const hold = completed.current;
      if (hold?.id !== event.pointerId) return;
      if (!hold.released && hold.vibrateOnRelease && event.type === 'pointerup') navigator.vibrate?.(15);
      hold.released = true;
    }

    function onMouseDown(event: MouseEvent) {
      // Touch release can synthesize a mouse down over the new selection strip.
      // Keep its default focus change from moving focus off the selected row.
      if (completed.current?.released) event.preventDefault();
    }

    function onClick(event: MouseEvent) {
      const hold = completed.current;
      if (!hold || event.detail === 0) return;
      // Some browsers emit a MouseEvent for a touch click. Capture it even if
      // inserting the selection strip moved the held row away from the pointer.
      if ('pointerId' in event && event.pointerId !== hold.id) return;
      completed.current = undefined;
      event.preventDefault();
      event.stopPropagation();
    }

    function onPageInactive() {
      cancelHold();
      if (completed.current) completed.current.released = true;
    }

    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('pointermove', onPointerMove, true);
    window.addEventListener('pointerup', endPointer, true);
    window.addEventListener('pointercancel', endPointer, true);
    window.addEventListener('lostpointercapture', endPointer, true);
    window.addEventListener('mousedown', onMouseDown, true);
    window.addEventListener('click', onClick, true);
    window.addEventListener('scroll', cancelHold, true);
    window.addEventListener('blur', onPageInactive);
    document.addEventListener('visibilitychange', onPageInactive);
    return () => {
      cancelHold();
      completed.current = undefined;
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('pointermove', onPointerMove, true);
      window.removeEventListener('pointerup', endPointer, true);
      window.removeEventListener('pointercancel', endPointer, true);
      window.removeEventListener('lostpointercapture', endPointer, true);
      window.removeEventListener('mousedown', onMouseDown, true);
      window.removeEventListener('click', onClick, true);
      window.removeEventListener('scroll', cancelHold, true);
      window.removeEventListener('blur', onPageInactive);
      document.removeEventListener('visibilitychange', onPageInactive);
    };
  }, [cancelHold]);

  function startHold(event: ReactPointerEvent<HTMLButtonElement>, onHold: (row: HTMLButtonElement) => void) {
    if (!event.isPrimary || event.button !== 0 || pending.current) return;
    const { currentTarget: row, pointerId: id, clientX: x, clientY: y } = event;
    const timer = window.setTimeout(() => {
      pending.current = undefined;
      if (!row.isConnected || document.hidden) return;
      // A first touch grants activation on pointerup, after the hold timer.
      const vibrateOnRelease = navigator.userActivation?.hasBeenActive === false;
      completed.current = { id, released: false, vibrateOnRelease };
      onHold(row);
      if (!vibrateOnRelease) navigator.vibrate?.(15);
    }, 450);
    pending.current = { id, x, y, timer };
  }

  return { startHold, cancelHold };
}
