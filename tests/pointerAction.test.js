import assert from 'node:assert/strict';
import test from 'node:test';
import { bindPointerAction } from '../src/pointerAction.js';

function target() {
  const events = new Map();
  const captured = new Set();
  return { disabled: false,
    addEventListener(type, callback) {
      if (!events.has(type)) events.set(type, new Set());
      events.get(type).add(callback);
    },
    removeEventListener(type, callback) { events.get(type)?.delete(callback); },
    setPointerCapture(id) { captured.add(id); },
    hasPointerCapture(id) { return captured.has(id); },
    releasePointerCapture(id) { captured.delete(id); },
    emit(type, event = {}) {
      const fullEvent = { preventDefault() {}, stopPropagation() {}, ...event };
      for (const callback of events.get(type) ?? []) callback(fullEvent);
    },
    listenerCount: () => [...events.values()].reduce((sum, set) => sum + set.size, 0),
  };
}

test('a non-primary third finger activates without requiring a compatibility click', () => {
  const button = target();
  let calls = 0;
  const dispose = bindPointerAction(button, () => calls++);
  button.emit('pointerdown', { pointerType: 'touch', pointerId: 3, isPrimary: false });
  assert.equal(calls, 1);
  button.emit('pointerup', { pointerId: 3 });
  button.emit('click', { pointerType: 'touch', pointerId: 3, detail: 1 });
  assert.equal(calls, 1, 'synthetic click must not toggle the action a second time');
  dispose();
});

test('unrelated release/cancel events do not release an action finger', () => {
  const button = target(), win = target();
  let calls = 0;
  const dispose = bindPointerAction(button, () => calls++, { releaseTarget: win });
  button.emit('pointerdown', { pointerType: 'touch', pointerId: 3 });
  win.emit('pointercancel', { pointerId: 1 });
  button.emit('lostpointercapture', { pointerId: 2 });
  button.emit('pointerdown', { pointerType: 'touch', pointerId: 4 });
  assert.equal(calls, 1, 'a second finger must not flip a still-held toggle');
  win.emit('pointerup', { pointerId: 3 });
  button.emit('pointerdown', { pointerType: 'touch', pointerId: 4 });
  assert.equal(calls, 2);
  dispose();
});

test('mouse, keyboard and accessibility actions remain usable after a touch', () => {
  const button = target();
  let calls = 0;
  let time = 100;
  const dispose = bindPointerAction(button, () => calls++, { now: () => time });
  button.emit('pointerdown', { pointerType: 'pen', pointerId: 7 });
  button.emit('pointerup', { pointerId: 7 });
  button.emit('click', { detail: 1, sourceCapabilities: { firesTouchEvents: true } });
  button.emit('click', { detail: 1 });
  assert.equal(calls, 1, 'old-style compatibility MouseEvents are also deduplicated');
  button.emit('click', { detail: 0 });
  button.emit('pointerdown', { pointerType: 'mouse', pointerId: 8 });
  button.emit('click', { pointerType: 'mouse', detail: 1 });
  assert.equal(calls, 3);
  time += 1000;
  button.emit('click', { detail: 1 });
  assert.equal(calls, 4);
  dispose();
});

test('failed capture still releases through the window and cleanup removes all listeners', () => {
  const button = target(), win = target();
  button.setPointerCapture = () => { throw new Error('capture unavailable'); };
  let calls = 0;
  const dispose = bindPointerAction(button, () => calls++, { releaseTarget: win });
  button.disabled = true;
  button.emit('pointerdown', { pointerType: 'touch', pointerId: 3 });
  assert.equal(calls, 0);
  button.disabled = false;
  button.emit('pointerdown', { pointerType: 'touch', pointerId: 3 });
  win.emit('pointercancel', { pointerId: 3 });
  button.emit('pointerdown', { pointerType: 'touch', pointerId: 4 });
  assert.equal(calls, 2);
  dispose(); dispose();
  assert.equal(button.listenerCount(), 0);
  assert.equal(win.listenerCount(), 0);
  button.emit('pointerdown', { pointerType: 'touch', pointerId: 5 });
  assert.equal(calls, 2);
});
