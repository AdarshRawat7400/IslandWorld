import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { createLighthouseGlare } from '../src/lighthouseGlare.js';

test('eye glare appears only for a visible, unobstructed beacon', () => {
  const properties = new Map();
  const element = { style: {
    opacity: '0', setProperty: (name, value) => properties.set(name, value),
  } };
  const camera = new THREE.PerspectiveCamera(72, 16 / 9, 0.08, 3200);
  camera.position.set(0, 40, 0);
  camera.lookAt(0, 70, -1800);
  const beacon = { viewerFlash: 1, worldPosition: new THREE.Vector3(0, 70, -1800) };
  const clearGlare = createLighthouseGlare(element, () => -8);
  clearGlare.update(camera, [beacon]);
  assert.ok(Number(element.style.opacity) > 0.5);
  assert.equal(properties.get('--flare-x'), '50.00%');

  camera.lookAt(0, 70, 1800);
  clearGlare.update(camera, [beacon]);
  assert.equal(element.style.opacity, '0');

  camera.lookAt(0, 70, -1800);
  const blockedGlare = createLighthouseGlare(element, () => 200);
  blockedGlare.update(camera, [beacon]);
  assert.equal(element.style.opacity, '0');
});
