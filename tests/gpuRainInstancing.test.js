import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { createGpuRain } from '../src/gpuRain.js';

test('storm rain preserves all seeded drops with one motion record per line', () => {
  const rain = createGpuRain();
  const geometry = rain.mesh.geometry;
  const origin = geometry.getAttribute('aOrigin');
  const drop = geometry.getAttribute('aDrop');
  const tip = geometry.getAttribute('aTip');
  assert.equal(rain.count, 16000);
  assert.equal(geometry.isInstancedBufferGeometry, true);
  assert.equal(geometry.getAttribute('position').count, 2);
  assert.deepEqual(Array.from(tip.array), [0, 1]);
  assert.equal(origin.count, rain.count);
  assert.equal(drop.count, rain.count);
  assert.equal(origin.isInstancedBufferAttribute, true);
  assert.equal(drop.isInstancedBufferAttribute, true);

  const seededValues = new Float32Array(rain.count * 7);
  for (let i = 0; i < rain.count; i++) {
    seededValues.set(origin.array.subarray(i * 3, i * 3 + 3), i * 7);
    seededValues.set(drop.array.subarray(i * 4, i * 4 + 4), i * 7 + 3);
  }
  assert.equal(createHash('sha256').update(Buffer.from(seededValues.buffer)).digest('hex'),
    '0417e923570491fe8db00336d44e6592224f6fb3ab14eab4cee3a4b10f139a14',
    'drop positions and motion must match the original rain field');

  const attributeBytes = Object.values(geometry.attributes)
    .reduce((sum, attribute) => sum + attribute.array.byteLength, 0);
  assert.equal(attributeBytes, 448032,
    'the shared endpoints must not duplicate 16,000 origins and motion records');
  geometry.dispose();
  rain.mesh.material.dispose();
});

test('storm rain instance count and shelter clipping track the current weather', () => {
  const rain = createGpuRain();
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(10, 30, -20);
  rain.setShelters([{ x: 9, z: -19, halfWidth: 5, halfDepth: 6 }]);

  rain.update(camera, 1.5, 0.5, false, 0.25);
  assert.equal(rain.mesh.visible, true);
  assert.equal(rain.mesh.geometry.instanceCount, 8000);
  assert.deepEqual(rain.mesh.position.toArray(), camera.position.toArray());
  assert.equal(rain.mesh.material.uniforms.uRoofCount.value, 1);
  assert.deepEqual(rain.mesh.material.uniforms.uRoofs.value[0].toArray(), [9, -19, 5, 6]);
  assert.equal(rain.mesh.material.uniforms.uFlash.value, 0.25);

  rain.update(camera, 2, 1, false);
  assert.equal(rain.mesh.geometry.instanceCount, 16000);
  rain.update(camera, 3, 0, false);
  assert.equal(rain.mesh.visible, false);
  rain.mesh.geometry.dispose();
  rain.mesh.material.dispose();
});
