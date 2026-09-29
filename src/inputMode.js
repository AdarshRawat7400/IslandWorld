/** Prefer mouse controls when a device exposes a fine pointer, even if it also has touch. */
export function useTouchControls({ primaryCoarse = false, anyFine = false } = {}) {
  return Boolean(primaryCoarse && !anyFine);
}
