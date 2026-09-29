import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createOffshoreLighthouse, lighthouseFlashAtViewer }
  from '../src/offshoreLighthouse.js';

const lensPosition = new THREE.Vector3(0, 80, 0);

test('a revolving lens gives a short, aligned flash with distance and fog loss', () => {
  const cameraPosition = new THREE.Vector3(0, 80, 1800);
  const aligned = lighthouseFlashAtViewer({ heading: 0, lensPosition,
    cameraPosition, fogDensity: 0.0019, night: 1, weather: 'clear' });
  const offAxis = lighthouseFlashAtViewer({ heading: 0.28, lensPosition,
    cameraPosition, fogDensity: 0.0019, night: 1, weather: 'clear' });
  const opposite = lighthouseFlashAtViewer({ heading: Math.PI, lensPosition,
    cameraPosition, fogDensity: 0.0019, night: 1, weather: 'clear' });
  const storm = lighthouseFlashAtViewer({ heading: 0, lensPosition,
    cameraPosition, fogDensity: 0.0054, night: 1, weather: 'storm' });
  const distant = lighthouseFlashAtViewer({ heading: 0, lensPosition,
    cameraPosition: new THREE.Vector3(0, 80, 2800), fogDensity: 0.0054,
    night: 1, weather: 'storm' });
  const daylight = lighthouseFlashAtViewer({ heading: 0, lensPosition,
    cameraPosition, fogDensity: 0.0019, night: 0, weather: 'clear' });
  assert.ok(aligned > 0.6 && aligned <= 1);
  assert.ok(offAxis < aligned * 0.03);
  assert.ok(opposite < 0.00001);
  assert.ok(storm > 0.15 && storm < aligned);
  assert.ok(distant < storm);
  assert.equal(daylight, 0);
});

test('detailed tower, small scattering shafts and world lens position update together', () => {
  const spec = { id: 'north', name: 'North', x: 900, z: -1300,
    lighthouse: { x: -40, z: 24, period: 10, phase: 0 } };
  const beacon = createOffshoreLighthouse(spec, { groundY: 58 });
  assert.equal(beacon.worldPosition.x, 860);
  assert.equal(beacon.worldPosition.y, 87.75);
  assert.equal(beacon.worldPosition.z, -1276);
  assert.equal(beacon.group.position.x, -40);
  assert.ok(beacon.tower.geometry.getAttribute('position').count > 1500);
  assert.equal(beacon.beams.length, 2);
  assert.ok(beacon.group.children.length <= 7);
  const cameraPosition = new THREE.Vector3(860, 85, 524);
  const flash = beacon.update(0, { night: 1, weather: 'storm',
    cameraPosition, fogDensity: 0.0054 });
  assert.ok(flash > 0.1);
  assert.equal(beacon.viewerFlash, flash);
  assert.ok(beacon.halo.material.opacity > 0);
  assert.ok(beacon.beamRoot.visible);
  assert.ok(beacon.beamRoot.children.every((child) =>
    !child.geometry.type?.includes('Cone')));
  const away = beacon.update(5, { night: 1, weather: 'storm',
    cameraPosition, fogDensity: 0.0054 });
  assert.ok(away < flash * 0.01);
  beacon.dispose();
});
