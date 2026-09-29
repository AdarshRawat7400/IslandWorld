import test from 'node:test';
import assert from 'node:assert/strict';
import { createTouchControls, createTouchInput, stickVector } from '../src/touchControls.js';

test('touch stick has a center dead zone and a bounded diagonal response', () => {
  assert.deepEqual(stickVector(4, 3), { x: 0, y: 0 });
  const diagonal = stickVector(200, -200);
  assert.ok(Math.abs(Math.hypot(diagonal.x, diagonal.y) - 1) < 1e-9);
  assert.ok(diagonal.x > 0 && diagonal.y < 0);
});

test('walking and looking keep independent pointers, then release without drift', () => {
  const input = createTouchInput();
  assert.equal(input.startStick(1, 100, 40, 100, 100), true);
  assert.equal(input.startLook(2, 500, 200), true);
  assert.equal(input.startStick(3, 100, 100, 100, 100), false);
  assert.ok(input.snapshot().forward > 0.9);
  assert.deepEqual(input.moveLook(2, 530, 212), { x: 30, y: 12 });
  assert.equal(input.moveLook(3, 540, 212), null);
  assert.equal(input.endStick(3), false);
  assert.ok(input.snapshot().forward > 0.9);
  assert.equal(input.endStick(1), true);
  assert.equal(input.snapshot().forward, 0);
  assert.equal(input.endLook(2), true);
  assert.equal(input.moveLook(2, 550, 230), null);
});

test('driving pedals work with simultaneous steering and clear on pause', () => {
  const input = createTouchInput();
  input.startStick(1, 160, 100, 100, 100);
  input.hold('throttle', true);
  assert.ok(input.snapshot().steer > 0.9);
  assert.equal(input.snapshot().throttle, 1);
  input.hold('brake', true);
  assert.equal(input.snapshot().brake, true);
  input.hold('throttle', false);
  input.hold('reverse', true);
  assert.equal(input.snapshot().throttle, -1);
  input.reset();
  assert.deepEqual(input.snapshot(), {
    forward: 0, sideways: 0, steer: 0, throttle: 0, brake: false,
    ascend: 0, descend: 0, boost: false,
  });
});

test('drone lift controls can be held together with flight stick and reset on pause', () => {
  const input = createTouchInput();
  input.startStick(1, 100, 40, 100, 100);
  input.hold('ascend', true, 2);
  input.hold('boost', true, 3);
  assert.ok(input.snapshot().forward > 0.9);
  assert.equal(input.snapshot().ascend, 1);
  assert.equal(input.snapshot().boost, true);
  input.hold('descend', true, 4);
  assert.equal(input.snapshot().descend, 1);
  input.hold('ascend', false, 2);
  assert.equal(input.snapshot().ascend, 0);
  input.reset();
  assert.deepEqual([input.snapshot().ascend, input.snapshot().descend, input.snapshot().boost],
    [0, 0, false]);
});

test('a second touch releasing a pedal does not cancel the first finger', () => {
  const input = createTouchInput();
  input.startStick(1, 160, 100, 100, 100);
  input.hold('reverse', true, 4);
  input.hold('reverse', true, 5);
  input.hold('brake', true, 6);
  input.hold('reverse', false, 5);
  assert.equal(input.isHeld('reverse'), true);
  assert.ok(input.snapshot().steer > 0.9);
  assert.equal(input.snapshot().throttle, -1);
  assert.equal(input.snapshot().brake, true);
  input.hold('brake', false, 6);
  assert.equal(input.snapshot().brake, false);
  input.hold('reverse', false, 4);
  assert.equal(input.snapshot().throttle, 0);
});

test('unchanged touch HUD state does not rewrite DOM every render frame', () => {
  let hidden = true;
  let toggles = 0;
  let modeWrites = 0;
  let thumbWrites = 0;
  let labelWrites = 0;
  let disabledWrites = 0;
  let mode;
  let label = 'INSPECT';
  let disabled = false;
  const target = { addEventListener() {} };
  const thumb = { style: {
    set transform(value) { thumbWrites++; },
  } };
  const action = {
    get textContent() { return label; },
    set textContent(value) { labelWrites++; label = value; },
    get disabled() { return disabled; },
    set disabled(value) { disabledWrites++; disabled = value; },
  };
  const root = {
    classList: {
      contains(name) { return name === 'hidden' && hidden; },
      toggle(name, value) { assert.equal(name, 'hidden'); toggles++; hidden = value; },
    },
    dataset: {
      get mode() { return mode; },
      set mode(value) { modeWrites++; mode = value; },
    },
    querySelector(selector) {
      return { '#touch-stick': target, '#touch-stick-thumb': thumb,
        '#touch-look': target, '#touch-action': action }[selector];
    },
    querySelectorAll() { return []; },
  };
  const controls = createTouchControls(root, { onLook() {}, onAction() {} });
  for (let frame = 0; frame < 120; frame++) controls.setVisible(false);
  assert.equal(toggles, 0);
  assert.equal(thumbWrites, 0);

  controls.setVisible(true);
  controls.input.startStick(1, 100, 40, 100, 100);
  for (let frame = 0; frame < 120; frame++) {
    controls.setVisible(true);
    controls.setMode('walking');
    controls.setAction('INSPECT', false);
  }
  assert.equal(toggles, 1);
  assert.equal(modeWrites, 1);
  assert.equal(labelWrites, 0);
  assert.equal(disabledWrites, 1);
  assert.ok(controls.input.snapshot().forward > 0.9);

  for (let frame = 0; frame < 120; frame++) controls.setVisible(false);
  assert.equal(toggles, 2);
  assert.equal(thumbWrites, 1);
  assert.equal(controls.input.snapshot().forward, 0);
});
