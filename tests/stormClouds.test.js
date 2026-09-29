import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { createStormSky } from '../src/stormClouds.js';

test('cached storm cloud noise preserves the authored density volume', () => {
  const scene = new THREE.Scene();
  const sky = createStormSky(scene);
  const texture = sky.uniforms.uDensityVolume.value;
  const { data, width, height, depth } = texture.image;
  assert.deepEqual([width, height, depth], [48, 48, 48]);
  assert.equal(data.length, 48 ** 3);
  assert.equal(
    createHash('sha256').update(data).digest('hex'),
    'b2e609e7ee72df07e8e81f143bd3e650cbe7b32f0f90556251bd5c55441247fa',
  );
  const camera = new THREE.PerspectiveCamera(72, 16 / 9, 0.08, 1900);
  camera.position.set(160, 38, -40);
  camera.lookAt(160, 38, -140);
  sky.strike(camera, 1.6, 2);
  sky.updateLightning(0.8);
  assert.equal(scene.children.filter((child) => child.name.startsWith('Forked lightning') && child.visible).length, 2);
  sky.strike(camera, 2.1, 1);
  sky.updateLightning(0.5);
  assert.equal(scene.children.filter((child) => child.name.startsWith('Forked lightning') && child.visible).length, 1);

  const cores = scene.children.filter((child) => child.name.startsWith('Forked lightning'));
  const seenX = [];
  const pans = [];
  for (let index = 0; index < 30; index++) {
    pans.push(sky.strike(camera, 2.5 + index * 7.31, 1));
    seenX.push(cores[0].position.x);
    assert.ok(Math.hypot(cores[0].position.x, cores[0].position.z) > 465,
      'a lightning fork should remain offshore even when looking across the island');
  }
  assert.ok(Math.max(...seenX) - Math.min(...seenX) > 350,
    'successive strikes should travel across the visible sky');
  assert.ok(pans.some((pan) => pan < -0.2) && pans.some((pan) => pan > 0.2),
    'primary strikes should occur on both sides of the camera');

  const firstPan = sky.strike(camera, 42.125, 3);
  sky.updateLightning(0.8);
  const positions = cores.map((core) => core.position.clone());
  assert.equal(cores.filter((core) => core.visible).length, 3);
  for (let a = 0; a < positions.length; a++) {
    for (let b = a + 1; b < positions.length; b++) {
      assert.ok(positions[a].distanceTo(positions[b]) > 135,
        'simultaneous forks should occupy distinct offshore positions');
    }
  }
  assert.equal(sky.strike(camera, 42.125, 3), firstPan,
    'the same strike time should produce deterministic stereo placement');
  assert.deepEqual(cores.map((core) => core.position.toArray()), positions.map((point) => point.toArray()));
  texture.dispose();
  sky.mesh.geometry.dispose();
  sky.mesh.material.dispose();
  scene.children.filter((child) => child.name.startsWith('Forked lightning')
    || child.name.startsWith('Lightning glow')).forEach((child) => {
    child.geometry.dispose();
    child.material.dispose();
  });
});
