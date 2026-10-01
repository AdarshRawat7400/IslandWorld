import assert from 'node:assert/strict';
import test from 'node:test';
import { createPlayerStateBuffer, interpolateAngle } from '../src/multiplayerInterpolation.js';

const player = (id, x, extra = {}) => ({ id, x, y: 20, z: 0, yaw: 0,
  pitch: 0, mode: 'walk', dead: false, ...extra });

test('interpolates remote movement behind snapshot arrival time', () => {
  const buffer = createPlayerStateBuffer({ delayMs: 100 });
  buffer.push(player('a', 0), 1000);
  buffer.push(player('a', 10), 1100);
  assert.equal(buffer.sample('a', 1150).x, 5);
  assert.equal(buffer.sample('a', 1300).x, 10);
});

test('interpolates facing over the short angle arc', () => {
  const turn = interpolateAngle(Math.PI - 0.1, -Math.PI + 0.1, 0.5);
  assert.ok(Math.abs(turn - Math.PI) < 0.01);
});

test('snaps to deaths, mode switches, and large teleports', () => {
  const buffer = createPlayerStateBuffer({ delayMs: 100 });
  buffer.push(player('a', 0), 1000);
  buffer.push(player('a', 10, { dead: true }), 1100);
  assert.equal(buffer.sample('a', 1150).x, 10);
  buffer.push(player('a', 12, { dead: false }), 1200);
  assert.equal(buffer.sample('a', 1250).x, 12);
  buffer.push(player('a', 90), 1300);
  assert.equal(buffer.sample('a', 1350).x, 90);
});

test('can remove a departed player without affecting others', () => {
  const buffer = createPlayerStateBuffer();
  buffer.push(player('a', 1), 1000);
  buffer.push(player('b', 2), 1000);
  buffer.remove('a');
  assert.equal(buffer.sample('a', 1100), null);
  assert.equal(buffer.sample('b', 1100).x, 2);
});
