import test from 'node:test';
import assert from 'node:assert/strict';
import { shotBlockedByStructures } from '../server/lineOfSight.js';

test('prison perimeter blocks shots beside the gate but leaves its center open', () => {
  assert.equal(shotBlockedByStructures(
    { x: -65, y: 45, z: 112 }, { x: -65, y: 45, z: 98 }), true);
  assert.equal(shotBlockedByStructures(
    { x: -58, y: 45, z: 112 }, { x: -58, y: 45, z: 98 }), false);
  assert.equal(shotBlockedByStructures(
    { x: -58, y: 55, z: 112 }, { x: -58, y: 55, z: 98 }), false,
  'open gate has no invisible blocking plane overhead');
});

test('cell block masonry blocks hits while its entry remains passable below the header', () => {
  assert.equal(shotBlockedByStructures(
    { x: -50, y: 48, z: 45 }, { x: -50, y: 48, z: 31 }), true);
  assert.equal(shotBlockedByStructures(
    { x: -40, y: 48, z: 45 }, { x: -40, y: 48, z: 31 }), false);
  assert.equal(shotBlockedByStructures(
    { x: -40, y: 52, z: 45 }, { x: -40, y: 52, z: 31 }), true,
  'stone header above the door is solid');
});

test('outbuilding doorway is open at eye level; side wall and roofline are solid', () => {
  assert.equal(shotBlockedByStructures(
    { x: -76, y: 47, z: 77 }, { x: -76, y: 47, z: 68 }), false);
  assert.equal(shotBlockedByStructures(
    { x: -81, y: 47, z: 77 }, { x: -81, y: 47, z: 68 }), true);
  assert.equal(shotBlockedByStructures(
    { x: -76, y: 50, z: 77 }, { x: -76, y: 50, z: 68 }), true);
});

test('main lighthouse masonry blocks a human-height shot; high shot clears its tower', () => {
  assert.equal(shotBlockedByStructures(
    { x: -285, y: 43, z: -140 }, { x: -255, y: 43, z: -140 }), true);
  assert.equal(shotBlockedByStructures(
    { x: -285, y: 75, z: -140 }, { x: -255, y: 75, z: -140 }), false);
});
