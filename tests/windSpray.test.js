import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createWindSpray, windSprayTarget } from '../src/windSpray.js';

test('coastal gale spray responds to exposure and clears under roofs', () => {
  assert.equal(windSprayTarget('storm', 0.3), 0.35);
  assert.equal(windSprayTarget('storm', 0.95), 1);
  assert.ok(windSprayTarget('storm', 0.8) > windSprayTarget('rain', 0.8));
  assert.equal(windSprayTarget('storm', 0.95, true), 0);
  assert.equal(windSprayTarget('dawn', 0.95), 0);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(180, 39, 120);
  const spray = createWindSpray(scene, camera, () => 0.95, { quality: 'desktop' });
  spray.update(0.5, 12, 'storm');
  assert.equal(spray.count, 224);
  assert.equal(spray.mesh.visible, true);
  assert.equal(spray.mesh.geometry.instanceCount, 224);
  assert.deepEqual(spray.mesh.position.toArray(), camera.position.toArray());
  assert.equal(spray.mesh.material.uniforms.uTime.value, 12);

  spray.update(0.016, 12.016, 'storm', { indoors: true });
  assert.equal(spray.mesh.visible, false);
  assert.equal(spray.mesh.geometry.instanceCount, 0);
  spray.dispose();
  assert.equal(scene.children.includes(spray.mesh), false);
});

test('mobile spray uses fewer instances and calm weather stays clear', () => {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera();
  const spray = createWindSpray(scene, camera, () => 0.8, { quality: 'mobile-high' });
  spray.update(0.5, 8, 'dawn');
  assert.equal(spray.count, 96);
  assert.equal(spray.mesh.visible, false);
  assert.equal(spray.mesh.geometry.instanceCount, 0);
  spray.dispose();
});
