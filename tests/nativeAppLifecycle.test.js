import assert from 'node:assert/strict';
import test from 'node:test';
import { bindNativeAppLifecycle, createNativeLifecycleController,
  isNativeAndroid, nativeBackAction } from '../src/nativeAppLifecycle.js';

const android = { isNativePlatform: () => true, getPlatform: () => 'android' };

test('only a real native Android bridge selects the APK lifecycle', () => {
  assert.equal(isNativeAndroid(), false);
  assert.equal(isNativeAndroid({ isNativePlatform: () => false,
    getPlatform: () => 'android' }), false);
  assert.equal(isNativeAndroid({ ...android, getPlatform: () => 'ios' }), false);
  assert.equal(isNativeAndroid({ isNativePlatform() { throw new Error('unavailable'); } }), false);
  assert.equal(isNativeAndroid(android), true);
});

test('Android Back closes the top game overlay before changing the menu', () => {
  assert.equal(nativeBackAction({ started: true, wheelOpen: true, mapOpen: true,
    menuOpen: true }), 'wheel');
  assert.equal(nativeBackAction({ started: true, mapOpen: true, menuOpen: true }), 'map');
  assert.equal(nativeBackAction({ started: true, menuOpen: true }), 'resume');
  assert.equal(nativeBackAction({ started: true }), 'menu');
  assert.equal(nativeBackAction({ menuOpen: true }), 'none');
});

test('background pause deduplicates native and visibility events; foreground remains paused', () => {
  const calls = [];
  const controller = createNativeLifecycleController({
    onPause: () => calls.push('pause'), onForeground: () => calls.push('foreground'),
    onResume: () => calls.push('resume') });
  controller.setAppActive(false);
  controller.setAppActive(false);
  assert.deepEqual(calls, ['pause']);
  assert.equal(controller.resumeFromGesture(), false);
  controller.setAppActive(true);
  controller.setAppActive(true);
  assert.deepEqual(calls, ['pause', 'foreground']);
  assert.deepEqual(controller.getState(), { active: true, paused: true, disposed: false });
  assert.equal(controller.resumeFromGesture(), true);
  assert.equal(controller.resumeFromGesture(), true);
  assert.deepEqual(calls, ['pause', 'foreground', 'resume']);
  assert.equal(controller.getState().paused, false);
});

test('Back has no game or exit effect while backgrounded or after disposal', () => {
  const calls = [];
  const controller = createNativeLifecycleController({ getUiState: () => ({ started: true }),
    onBack: action => calls.push(action) });
  assert.equal(controller.handleBack(), 'menu');
  controller.setAppActive(false);
  assert.equal(controller.handleBack(), 'none');
  controller.setAppActive(true);
  controller.dispose();
  assert.equal(controller.handleBack(), 'none');
  assert.equal(controller.resumeFromGesture(), false);
  controller.setAppActive(false);
  assert.deepEqual(calls, ['menu']);
});

test('ordinary browsers never import the native SDK or register host events', async () => {
  let loads = 0;
  const result = await bindNativeAppLifecycle({ capacitor: null,
    loadApp: async () => { loads++; throw new Error('must not load'); } });
  assert.equal(result, null);
  assert.equal(loads, 0);
});

test('host state and Back are connected to existing callbacks and listeners are removable', async () => {
  const handlers = new Map();
  const calls = [];
  const removed = [];
  const controller = createNativeLifecycleController({ getUiState: () => ({ started: true,
    menuOpen: true }), onPause: () => calls.push('pause'),
    onForeground: () => calls.push('foreground'), onBack: action => calls.push(action) });
  const binding = await bindNativeAppLifecycle({ capacitor: android, controller,
    loadApp: async () => ({ App: {
      async addListener(event, callback) {
        handlers.set(event, callback);
        return { async remove() { removed.push(event); handlers.delete(event); } };
      },
      async getState() { return { isActive: false }; },
    } }) });
  assert.deepEqual(calls, ['pause']);
  handlers.get('appStateChange')({ isActive: true });
  handlers.get('backButton')({ canGoBack: false });
  assert.deepEqual(calls, ['pause', 'foreground', 'resume']);
  await binding.dispose();
  await binding.dispose();
  assert.deepEqual(removed.sort(), ['appStateChange', 'backButton']);
  assert.equal(handlers.size, 0);
});

test('partially installed host listeners are removed if initialization fails', async () => {
  let removed = 0;
  const controller = createNativeLifecycleController();
  await assert.rejects(bindNativeAppLifecycle({ capacitor: android, controller,
    loadApp: async () => ({ App: {
      async addListener(event) {
        if (event === 'backButton') throw new Error('bridge unavailable');
        return { async remove() { removed++; } };
      },
    } }) }), /bridge unavailable/);
  assert.equal(removed, 1);
});

test('awaits the SDK module namespace without assimilating its thenable native plugin proxy', async () => {
  let thenReads = 0;
  const events = [];
  const app = new Proxy({
    async addListener(event) {
      events.push(event);
      return { async remove() {} };
    },
    async getState() { return { isActive: true }; },
  }, { get(target, key) {
    if (key === 'then') {
      thenReads++;
      throw new Error('Capacitor App.then is not a real promise method');
    }
    return Reflect.get(target, key);
  } });
  const binding = await bindNativeAppLifecycle({ capacitor: android,
    controller: createNativeLifecycleController(),
    loadApp: async () => ({ App: app }) });
  assert.equal(thenReads, 0);
  assert.deepEqual(events, ['appStateChange', 'backButton']);
  await binding.dispose();
});
