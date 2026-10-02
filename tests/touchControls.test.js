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
    forward: 0, sideways: 0, steer: 0, sprint: false, throttle: 0, brake: false,
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

test('touch HUD removes its initial hidden attribute and avoids per-frame DOM writes', () => {
  let hidden = true;
  let hiddenWrites = 0;
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
    get hidden() { return hidden; },
    set hidden(value) { hiddenWrites++; hidden = value; },
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
  assert.equal(hiddenWrites, 0);
  assert.equal(thumbWrites, 0);

  controls.setVisible(true);
  assert.equal(root.hidden, false);
  controls.input.startStick(1, 100, 40, 100, 100);
  for (let frame = 0; frame < 120; frame++) {
    controls.setVisible(true);
    controls.setMode('walking');
    controls.setAction('INSPECT', false);
  }
  assert.equal(hiddenWrites, 1);
  assert.equal(modeWrites, 1);
  assert.equal(labelWrites, 0);
  assert.equal(disabledWrites, 1);
  assert.ok(controls.input.snapshot().forward > 0.9);

  for (let frame = 0; frame < 120; frame++) controls.setVisible(false);
  assert.equal(root.hidden, true);
  assert.equal(hiddenWrites, 2);
  assert.equal(thumbWrites, 1);
  assert.equal(controls.input.snapshot().forward, 0);
});

function touchHudFixture({ onAction = () => {}, onLook = () => {} } = {}) {
  const element = (dataset = {}) => {
    const listeners = new Map();
    const classes = new Set();
    const attributes = new Map();
    return {
      dataset, attributes, hidden: false, disabled: false, textContent: '', style: {},
      classList: {
        contains: (name) => classes.has(name),
        add: (name) => classes.add(name),
        remove: (name) => classes.delete(name),
        toggle(name, active) {
          const selected = active ?? !classes.has(name);
          if (selected) classes.add(name); else classes.delete(name);
          return selected;
        },
      },
      addEventListener(type, listener) {
        if (!listeners.has(type)) listeners.set(type, []);
        listeners.get(type).push(listener);
      },
      setAttribute(name, value) { attributes.set(name, value); },
      setPointerCapture() {},
      getBoundingClientRect() { return { left: 50, top: 50, width: 100, height: 100 }; },
      dispatch(type, pointer = {}) {
        for (const listener of listeners.get(type) ?? []) {
          listener({ pointerId: 1, clientX: 100, clientY: 100,
            preventDefault() {}, ...pointer });
        }
      },
    };
  };
  const stick = element();
  const thumb = element();
  const look = element();
  const action = element({ touchAction: 'interact' });
  const sprint = element({ touchAction: 'sprint' });
  const more = element();
  const tools = element();
  tools.hidden = true;
  const map = element({ touchAction: 'map' });
  const throttle = element({ touchHold: 'throttle' });
  const selectors = { '#touch-stick': stick, '#touch-stick-thumb': thumb,
    '#touch-look': look, '#touch-action': action, '#touch-sprint': sprint,
    '#touch-more': more, '#touch-tools': tools };
  const root = {
    hidden: true, dataset: {},
    querySelector: (selector) => selectors[selector],
    querySelectorAll(selector) {
      return selector === '[data-touch-hold]' ? [throttle]
        : selector === '[data-touch-action]' ? [action, sprint, map] : [];
    },
  };
  const controls = createTouchControls(root, { onAction, onLook });
  return { root, controls, stick, look, sprint, more, tools, map, throttle, action };
}

test('sprint toggles without taking movement or look away from the two thumbs', () => {
  const lookDeltas = [];
  let hud;
  hud = touchHudFixture({
    onLook: (dx, dy) => lookDeltas.push([dx, dy]),
    onAction: (action) => { if (action === 'sprint') hud.controls.toggleSprint(); },
  });
  hud.controls.setVisible(true);
  hud.controls.setMode('walking');
  hud.stick.dispatch('pointerdown', { pointerId: 1, clientY: 40 });
  hud.look.dispatch('pointerdown', { pointerId: 2, clientX: 500, clientY: 200 });
  hud.sprint.dispatch('click');
  assert.equal(hud.controls.input.snapshot().sprint, true);
  assert.equal(hud.sprint.attributes.get('aria-pressed'), 'true');
  hud.look.dispatch('pointermove', { pointerId: 2, clientX: 520, clientY: 207 });
  assert.deepEqual(lookDeltas, [[20, 7]]);
  assert.ok(hud.controls.input.snapshot().forward > 0.9);
  hud.look.dispatch('pointercancel', { pointerId: 2 });
  assert.ok(hud.controls.input.snapshot().forward > 0.9);
  assert.equal(hud.controls.input.snapshot().sprint, true);
  hud.sprint.dispatch('click');
  assert.equal(hud.controls.input.snapshot().sprint, false);
  assert.equal(hud.sprint.attributes.get('aria-pressed'), 'false');
});

test('additional fingers use sprint and tools without clicks or interrupting walking and looking', () => {
  const actions = [], lookDeltas = [];
  let hud;
  hud = touchHudFixture({
    onLook: (dx, dy) => lookDeltas.push([dx, dy]),
    onAction(action) {
      actions.push(action);
      if (action === 'sprint') hud.controls.toggleSprint();
    },
  });
  hud.controls.setVisible(true);
  hud.controls.setMode('walking');
  hud.stick.dispatch('pointerdown', { pointerId: 1, pointerType: 'touch', clientY: 40 });
  hud.look.dispatch('pointerdown', { pointerId: 2, pointerType: 'touch', clientX: 500, clientY: 200 });
  const third = { pointerId: 3, pointerType: 'touch', isPrimary: false };
  hud.sprint.dispatch('pointerdown', third);
  hud.sprint.dispatch('pointerup', third);
  hud.sprint.dispatch('click', { ...third, detail: 1 });
  assert.equal(hud.controls.input.snapshot().sprint, true, 'emulated click must not undo sprint');
  hud.more.dispatch('pointerdown', third);
  hud.more.dispatch('pointerup', third);
  hud.more.dispatch('click', { ...third, detail: 1 });
  assert.equal(hud.tools.hidden, false, 'MORE opens using a secondary finger without a click');
  hud.map.dispatch('pointerdown', { ...third, pointerId: 4 });
  hud.map.dispatch('pointercancel', { ...third, pointerId: 4 });
  hud.map.dispatch('click', { ...third, pointerId: 4, detail: 1 });
  assert.deepEqual(actions, ['sprint', 'map']);
  assert.equal(hud.tools.hidden, true);
  hud.stick.dispatch('pointercancel', { pointerId: 4 });
  hud.look.dispatch('lostpointercapture', { pointerId: 4 });
  hud.look.dispatch('pointermove', { pointerId: 2, clientX: 517, clientY: 209 });
  assert.deepEqual(lookDeltas, [[17, 9]], 'the original look finger is still active');
  assert.ok(hud.controls.input.snapshot().forward > 0.9, 'the walking finger is still held');
  assert.equal(hud.controls.input.snapshot().sprint, true);
  hud.controls.dispose();
});

test('hiding controls and changing movement mode clear sprint, pointers and pedals', () => {
  const hud = touchHudFixture();
  hud.controls.setVisible(true);
  hud.controls.setMode('walking');
  const activate = () => {
    hud.stick.dispatch('pointerdown', { pointerId: 1, clientY: 40 });
    hud.look.dispatch('pointerdown', { pointerId: 2 });
    hud.throttle.dispatch('pointerdown', { pointerId: 3 });
    hud.controls.setSprint(true);
    hud.more.dispatch('click');
  };
  activate();
  hud.controls.setMode('walking');
  assert.equal(hud.controls.input.snapshot().sprint, true);
  assert.ok(hud.controls.input.snapshot().forward > 0.9);
  const assertReset = () => {
    const snapshot = hud.controls.input.snapshot();
    assert.equal(snapshot.sprint, false);
    assert.equal(snapshot.forward, 0);
    assert.equal(snapshot.throttle, 0);
    assert.equal(hud.controls.input.moveLook(2, 200, 200), null);
    assert.equal(hud.sprint.classList.contains('pressed'), false);
    assert.equal(hud.tools.hidden, true);
    assert.equal(hud.more.attributes.get('aria-expanded'), 'false');
  };
  hud.controls.setMode('driving');
  assertReset();
  hud.controls.setMode('walking');
  activate();
  hud.controls.setVisible(false);
  assertReset();
  hud.controls.setVisible(true);
  assert.equal(hud.controls.input.snapshot().sprint, false);
});

test('crouching can disable sprint without cancelling movement or looking', () => {
  const hud = touchHudFixture();
  hud.controls.input.startStick(1, 100, 40, 100, 100);
  hud.controls.input.startLook(2, 500, 200);
  hud.controls.toggleSprint();
  hud.controls.setSprintAvailable(false);
  assert.equal(hud.sprint.disabled, true);
  assert.equal(hud.controls.input.snapshot().sprint, false);
  assert.equal(hud.controls.toggleSprint(), false);
  assert.ok(hud.controls.input.snapshot().forward > 0.9);
  assert.deepEqual(hud.controls.input.moveLook(2, 505, 203), { x: 5, y: 3 });
  hud.controls.setSprintAvailable(true);
  assert.equal(hud.sprint.disabled, false);
  assert.equal(hud.controls.input.snapshot().sprint, false);
  assert.equal(hud.controls.toggleSprint(), true);
});

test('secondary tools stay folded after an action and USE appears only when useful', () => {
  const actions = [];
  const hud = touchHudFixture({ onAction: (action) => actions.push(action) });
  hud.more.dispatch('click');
  assert.equal(hud.tools.hidden, false);
  assert.equal(hud.more.attributes.get('aria-expanded'), 'true');
  hud.map.dispatch('click');
  assert.deepEqual(actions, ['map']);
  assert.equal(hud.tools.hidden, true);
  assert.equal(hud.more.attributes.get('aria-expanded'), 'false');
  hud.controls.setAction('USE', false);
  assert.equal(hud.action.hidden, true);
  assert.equal(hud.action.disabled, true);
  hud.controls.setAction('TALK', true);
  assert.equal(hud.action.hidden, false);
  assert.equal(hud.action.disabled, false);
  assert.equal(hud.action.textContent, 'TALK');
});
