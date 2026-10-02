/** Android host integration is optional: ordinary browsers never load the SDK. */
export function isNativeAndroid(capacitor = globalThis.Capacitor) {
  try {
    return Boolean(capacitor?.isNativePlatform?.()
      && capacitor?.getPlatform?.() === 'android');
  } catch {
    return false;
  }
}

export function nativeBackAction({ wheelOpen = false, mapOpen = false,
  menuOpen = false, started = false } = {}) {
  if (wheelOpen) return 'wheel';
  if (mapOpen) return 'map';
  if (menuOpen && started) return 'resume';
  if (started) return 'menu';
  // Consume Back at the title screen; Home / Android's app switcher remain usable.
  return 'none';
}

/**
 * The native host can disappear without a reliable DOM blur. Pausing releases
 * held inputs and audio once, but foregrounding does not restart gameplay or a
 * microphone. Only an explicit Resume/Back gesture resumes the paused game.
 */
export function createNativeLifecycleController({ getUiState = () => ({}),
  onPause = () => {}, onForeground = () => {}, onResume = () => {},
  onBack = () => {} } = {}) {
  let active = true;
  let paused = false;
  let disposed = false;
  function setAppActive(value) {
    if (disposed) return;
    const next = Boolean(value);
    if (next === active) return;
    active = next;
    if (!active) {
      paused = true;
      onPause();
    } else onForeground();
  }
  function resumeFromGesture() {
    if (disposed || !active) return false;
    if (paused) {
      paused = false;
      onResume();
    }
    return true;
  }
  function handleBack() {
    if (disposed || !active) return 'none';
    const action = nativeBackAction(getUiState());
    if (action !== 'none') onBack(action);
    return action;
  }
  return { setAppActive, resumeFromGesture, handleBack,
    getState: () => ({ active, paused, disposed }),
    dispose() { disposed = true; } };
}

export async function bindNativeAppLifecycle({ controller,
  capacitor = globalThis.Capacitor,
  loadApp = () => import('@capacitor/app'),
} = {}) {
  if (!isNativeAndroid(capacitor)) return null;
  if (!controller?.setAppActive || !controller?.handleBack) {
    throw new TypeError('Android lifecycle requires a controller.');
  }
  // Capacitor plugin proxies expose a method for every property, including
  // "then". Returning/awaiting the App proxy itself therefore assimilates it as
  // a thenable. Await the plain module namespace and only then extract App.
  const { App: app } = await loadApp();
  const subscriptions = [];
  try {
    subscriptions.push(await app.addListener('appStateChange', ({ isActive }) => {
      controller.setAppActive(isActive);
    }));
    subscriptions.push(await app.addListener('backButton', () => controller.handleBack()));
    const state = await app.getState();
    controller.setAppActive(state.isActive);
  } catch (error) {
    await Promise.allSettled(subscriptions.map(handle => handle.remove()));
    throw error;
  }
  return { async dispose() {
    controller.dispose();
    await Promise.allSettled(subscriptions.splice(0).map(handle => handle.remove()));
  } };
}
