/**
 * Mobile game buttons must work for a third finger while stick/look pointers
 * are held. Compatibility clicks are unreliable for non-primary touches.
 * Activate touch/pen presses directly; retain ordinary mouse/keyboard clicks.
 */
export function bindPointerAction(element, action, {
  releaseTarget = element?.ownerDocument?.defaultView ?? globalThis.window,
  now = () => globalThis.performance?.now?.() ?? Date.now(),
} = {}) {
  let activePointer = null;
  let lastTouchAt = -Infinity;
  let disposed = false;
  const listeners = [];
  const listen = (target, type, callback) => {
    if (!target?.addEventListener) return;
    target.addEventListener(type, callback);
    listeners.push(() => target.removeEventListener?.(type, callback));
  };
  const release = (event) => {
    if (event?.pointerId !== activePointer) return;
    const id = activePointer;
    activePointer = null;
    try {
      if (element.hasPointerCapture?.(id)) element.releasePointerCapture?.(id);
    } catch { /* A removed/hidden button may already have lost capture. */ }
  };
  listen(element, 'pointerdown', (event) => {
    if (disposed || element.disabled || !['touch', 'pen'].includes(event.pointerType)) return;
    event.preventDefault();
    event.stopPropagation?.();
    // A second finger on the same toggle must not undo the first press.
    if (activePointer !== null) return;
    activePointer = event.pointerId;
    lastTouchAt = now();
    try { element.setPointerCapture?.(event.pointerId); }
    catch { /* Window release listeners cover browsers without capture. */ }
    action(event);
  });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    listen(element, type, release);
  }
  for (const type of ['pointerup', 'pointercancel']) listen(releaseTarget, type, release);
  listen(element, 'click', (event) => {
    if (disposed || element.disabled) return;
    const directTouchClick = ['touch', 'pen'].includes(event.pointerType);
    const compatibilityClick = event.sourceCapabilities?.firesTouchEvents
      || (event.pointerType !== 'mouse' && event.detail > 0 && now() - lastTouchAt < 900);
    if (directTouchClick || compatibilityClick) {
      event.preventDefault();
      return;
    }
    // Keyboard/accessibility clicks have detail=0 and no touch pointer.
    action(event);
  });
  return () => {
    if (disposed) return;
    disposed = true;
    if (activePointer !== null) release({ pointerId: activePointer });
    for (const unlisten of listeners) unlisten();
  };
}
