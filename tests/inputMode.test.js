import assert from 'node:assert/strict';
import test from 'node:test';
import { useTouchControls } from '../src/inputMode.js';

test('touchscreen desktops retain mouse controls, mobile touch retains touch controls', () => {
  assert.equal(useTouchControls({ primaryCoarse: false, anyFine: true }), false);
  assert.equal(useTouchControls({ primaryCoarse: true, anyFine: true }), false);
  assert.equal(useTouchControls({ primaryCoarse: true, anyFine: false }), true);
});
