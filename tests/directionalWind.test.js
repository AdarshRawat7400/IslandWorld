import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createGpuRain } from '../src/gpuRain.js';
import { createWindSpray } from '../src/windSpray.js';

test('rain and coastal spray follow the same supplied wind direction', () => {
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(120, 42, 180);
  const wind = { direction: { x: -3, z: 4 }, strength: 0.8 };

  const rain = createGpuRain();
  rain.update(camera, 10, 0.7, false, 0, wind);
  const rainUniforms = rain.mesh.material.uniforms;
  assert.ok(Math.abs(rainUniforms.uWindDirection.value.x + 0.6) < 1e-6);
  assert.ok(Math.abs(rainUniforms.uWindDirection.value.y - 0.8) < 1e-6);
  assert.ok(Math.abs(rainUniforms.uWind.value - 3.44) < 1e-6);
  assert.equal(rain.mesh.geometry.instanceCount, 11200);

  const scene = new THREE.Scene();
  const spray = createWindSpray(scene, camera, () => 0.95);
  spray.update(0.5, 10, 'storm', { wind });
  const sprayUniforms = spray.mesh.material.uniforms;
  assert.ok(Math.abs(sprayUniforms.uDirection.value.x + 0.6) < 1e-6);
  assert.ok(Math.abs(sprayUniforms.uDirection.value.y - 0.8) < 1e-6);
  assert.equal(sprayUniforms.uWindStrength.value, 0.8);
  assert.equal(spray.mesh.visible, true);

  spray.update(0.016, 10.016, 'storm', { indoors: true, wind });
  assert.equal(spray.mesh.visible, false);
  spray.dispose();
  rain.mesh.geometry.dispose();
  rain.mesh.material.dispose();
});

test('legacy calls and Vector2 directions remain supported', () => {
  const camera = new THREE.PerspectiveCamera();
  const rain = createGpuRain();
  rain.update(camera, 1, 0.5, false);
  assert.ok(Math.abs(rain.mesh.material.uniforms.uWind.value - 2.15) < 1e-6);
  rain.update(camera, 2, 1, false, 0, { direction: new THREE.Vector2(0, -1), strength: 1 });
  assert.deepEqual(rain.mesh.material.uniforms.uWindDirection.value.toArray(), [0, -1]);

  const scene = new THREE.Scene();
  const spray = createWindSpray(scene, camera, () => 0.95);
  spray.update(0.5, 2, 'storm');
  assert.ok(spray.mesh.material.uniforms.uDirection.value.x > 0.9);
  spray.update(0.5, 3, 'storm', { windDirection: { x: 0, z: -2 }, windStrength: 0.6 });
  assert.deepEqual(spray.mesh.material.uniforms.uDirection.value.toArray(), [0, -1]);
  assert.equal(spray.mesh.material.uniforms.uWindStrength.value, 0.6);
  spray.dispose();
  rain.mesh.geometry.dispose();
  rain.mesh.material.dispose();
});
