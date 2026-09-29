import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { DISTANT_ISLANDS, buildDistantIslandGeometry,
  createDistantIslands, sampleDistantIslandHeight } from '../src/distantIslands.js';

test('two distant offshore landforms have island-scale high cliffs', () => {
  assert.equal(DISTANT_ISLANDS.length, 2);
  const sectors = DISTANT_ISLANDS.map(({ x, z }) => Math.atan2(z, x));
  assert.ok(sectors.some((angle) => angle < -1 && angle > -2)); // north
  assert.ok(sectors.some((angle) => angle > 2)); // southwest
  assert.ok(Math.hypot(DISTANT_ISLANDS[0].x - DISTANT_ISLANDS[1].x,
    DISTANT_ISLANDS[0].z - DISTANT_ISLANDS[1].z) > 3000);
  for (const spec of DISTANT_ISLANDS) {
    const centerDistance = Math.hypot(spec.x, spec.z);
    const area = Math.PI * spec.radiusX * spec.radiusZ;
    assert.ok(centerDistance > 1600 && centerDistance < 2000);
    assert.ok(area > 250_000 && area < 400_000);
    const geometry = buildDistantIslandGeometry(spec);
    geometry.cap.computeBoundingBox();
    geometry.cliff.computeBoundingBox();
    assert.ok(geometry.cap.boundingBox.max.y > 60);
    assert.ok(geometry.cliff.boundingBox.min.y < 0);
    assert.ok(geometry.cap.boundingBox.max.x > 0.9 * spec.radiusX);
    assert.ok(geometry.cap.boundingBox.min.x < -0.9 * spec.radiusX);
    if (spec.lighthouse) {
      const { x, z } = spec.lighthouse;
      assert.ok(Math.hypot(x / spec.radiusX, z / spec.radiusZ) < 0.7);
      assert.ok(sampleDistantIslandHeight(spec, x, z) > 55);
    }
    geometry.cap.dispose();
    geometry.cliff.dispose();
  }
});

test('distant beams rotate through 360 degrees and appear in night or storm', () => {
  const scene = new THREE.Scene();
  const distant = createDistantIslands(scene);
  assert.equal(distant.beacons.length, 2);
  assert.equal(scene.getObjectByName('Distant offshore islands'), distant.root);
  distant.update(0, { weather: 'clear', night: 0, fogColor: new THREE.Color(0x9caeaa),
    cameraPosition: new THREE.Vector3(0, 40, 0) });
  assert.ok(distant.beacons.every((beacon) => !beacon.beamRoot.visible));
  distant.update(12, { weather: 'storm', night: 0, fogDensity: 0.0054,
    cameraPosition: new THREE.Vector3(0, 40, 0) });
  assert.ok(distant.beacons.every((beacon) => beacon.beamRoot.visible));
  assert.ok(distant.beacons.every((beacon) =>
    beacon.beams[0].material.uniforms.uStrength.value > 0));
  assert.ok(distant.islands.every((island) =>
    island.detail.stats.drawCalls === 1 && island.detail.stats.treeCount > 30));
  assert.ok(distant.islands[0].cap.material.uniforms.uVisibilityFloor.value > 0);
  distant.update(12, { weather: 'clear', night: 1,
    cameraPosition: new THREE.Vector3(0, 40, 0) });
  assert.ok(distant.beacons.every((beacon) =>
    !beacon.beamRoot.visible && beacon.core.material.opacity > 0));
  const first = distant.beacons[0];
  const original = first.heading;
  distant.update(12 + first.period, { weather: 'clear', night: 1 });
  assert.ok(Math.abs(first.heading - original) < 1e-12);
  distant.dispose();
  assert.equal(scene.getObjectByName('Distant offshore islands'), undefined);
});
