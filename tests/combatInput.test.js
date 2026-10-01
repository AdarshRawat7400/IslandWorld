import test from 'node:test';
import assert from 'node:assert/strict';
import { createCombatMouseInput } from '../src/combatInput.js';

function fixture() {
  const aim = [];
  const trigger = [];
  let shots = 0;
  const input = createCombatMouseInput({
    onAim: (value) => aim.push(value),
    onTriggerChange: (value) => trigger.push(value),
    onFire: () => { shots += 1; },
  });
  return { input, aim, trigger, get shots() { return shots; } };
}

test('right-held aim permits left fire and left release keeps aim held', () => {
  const f = fixture();
  f.input.handleMouseDown({ button: 2, buttons: 2 });
  assert.deepEqual(f.aim, [true]);
  f.input.handleMouseDown({ button: 0, buttons: 3 });
  assert.equal(f.shots, 1);
  assert.deepEqual(f.trigger, [true]);
  f.input.handleMouseUp({ button: 0, buttons: 2 });
  assert.deepEqual(f.trigger, [true, false]);
  assert.deepEqual(f.aim, [true]);
  f.input.handleMouseDown({ button: 0, buttons: 3 });
  assert.equal(f.shots, 2, 'each semiautomatic click fires once while aiming');
  f.input.handleMouseUp({ button: 2, buttons: 1 });
  assert.deepEqual(f.aim, [true, false]);
  assert.equal(f.input.state.firing, true);
  f.input.handleMouseUp({ button: 0, buttons: 0 });
  assert.equal(f.input.state.firing, false);
});

test('aim can begin and end during a held automatic trigger without extra shots', () => {
  const f = fixture();
  f.input.handleMouseDown({ button: 0, buttons: 1 });
  f.input.handleMouseDown({ button: 2, buttons: 3 });
  f.input.handleMouseDown({ button: 2, buttons: 3 });
  assert.equal(f.shots, 1);
  assert.deepEqual(f.trigger, [true]);
  f.input.handleMouseUp({ button: 2, buttons: 1 });
  assert.equal(f.input.state.firing, true);
  assert.deepEqual(f.aim, [true, false]);
  f.input.reset();
  f.input.reset();
  assert.deepEqual(f.trigger, [true, false]);
  assert.deepEqual(f.input.state, { buttons: 0, aiming: false, firing: false });
});

test('blocked combat and fallback drag cannot start a held trigger', () => {
  const f = fixture();
  f.input.handleMouseDown({ button: 2, buttons: 2 }, { canAim: false, canFire: false });
  f.input.handleMouseDown({ button: 0, buttons: 3 }, { canAim: false, canFire: false });
  assert.equal(f.shots, 0);
  assert.deepEqual(f.trigger, []);
  assert.deepEqual(f.aim, []);
  f.input.handleMouseUp({ button: 0, buttons: 2 }, { canAim: true, canFire: false });
  assert.equal(f.input.state.aiming, true);
  f.input.handleMouseDown({ button: 0, buttons: 3 }, { canAim: true, canFire: false });
  assert.equal(f.shots, 0, 'fallback click-to-fire is handled on drag release by the caller');
  f.input.reset();
  assert.deepEqual(f.aim, [true, false]);
});

test('synthetic events without a buttons mask preserve the other held button', () => {
  const f = fixture();
  f.input.handleMouseDown({ button: 2 });
  f.input.handleMouseDown({ button: 0 });
  assert.deepEqual(f.input.state, { buttons: 3, aiming: true, firing: true });
  f.input.handleMouseUp({ button: 0 });
  assert.equal(f.input.state.aiming, true);
  f.input.handleMouseUp({ button: 2 });
  assert.deepEqual(f.input.state, { buttons: 0, aiming: false, firing: false });
});
