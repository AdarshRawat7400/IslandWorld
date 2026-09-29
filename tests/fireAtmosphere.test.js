import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { BUILDING_SHAPES } from '../src/collision.js';
import { createSetDressing } from '../src/setDressing.js';
import {
  FIRE_SOURCE_LAYOUT, createFireAtmosphere, makeFireNoiseVolume,
} from '../src/fireAtmosphere.js';

test('fire density is a deterministic, small 3D procedural texture', () => {
  const first = makeFireNoiseVolume(16);
  const second = makeFireNoiseVolume(16);
  assert.ok(first.isData3DTexture);
  assert.equal(first.image.width, 16);
  assert.equal(first.image.height, 16);
  assert.equal(first.image.depth, 16);
  assert.equal(first.image.data.length, 16 ** 3);
  assert.deepEqual(first.image.data, second.image.data);
  assert.ok(new Set(first.image.data).size > 50, 'density should have spatial variation');
  assert.equal(first.wrapS, THREE.RepeatWrapping);
  first.dispose();
  second.dispose();
});

test('fires fit existing shelter and avoid the open prison gate route', () => {
  const scene = new THREE.Scene();
  const height = () => 34;
  const dressing = createSetDressing(scene, height);
  const lodge = FIRE_SOURCE_LAYOUT.find((source) => source.id === 'lodge_stove');
  const gate = FIRE_SOURCE_LAYOUT.find((source) => source.id === 'gatehouse_brazier');
  assert.ok(lodge && gate);
  assert.ok(Math.abs(lodge.x + 90) < BUILDING_SHAPES.lodge.halfWidth);
  assert.ok(Math.abs(lodge.z - 185) < BUILDING_SHAPES.lodge.halfDepth);
  const roof = dressing.shelters.find((shelter) => shelter.id === 'gatehouse_intake');
  assert.ok(roof, 'the brazier should use the built gatehouse canopy');
  assert.ok(Math.abs(gate.x - roof.x) + 0.4 < roof.width / 2);
  assert.ok(Math.abs(gate.z - roof.z) + 0.4 < roof.depth / 2);
  assert.ok(Math.abs(gate.x + 58) > 1.5, 'leave the centre gate lane open');
  assert.equal(dressing.collides(gate.x, gate.z, 0.32), false);
  for (let z = 108; z >= 95; z -= 0.5) {
    assert.ok(Math.hypot(gate.x + 58, gate.z - z) > 1,
      'guard brazier must not intrude on the entrance route');
  }
  dressing.dispose?.();
});

test('volumes raymarch with bounded steps and cull as the camera leaves', () => {
  const scene = new THREE.Scene();
  const fire = createFireAtmosphere(scene, () => 34);
  assert.equal(fire.sources.length, 2);
  assert.equal(fire.quality, 'desktop');
  assert.equal(fire.sources.filter((source) => source.smoke).length, 1);
  const gate = fire.sources.find((source) => source.kind === 'brazier');
  const lodge = fire.sources.find((source) => source.kind === 'stove');
  assert.ok(gate.flame.material.isShaderMaterial);
  assert.ok(gate.smoke.material.isShaderMaterial);
  assert.equal(gate.flame.material.uniforms.uSteps.value, 14);
  assert.equal(gate.smoke.material.uniforms.uSteps.value, 10);
  assert.ok(gate.smoke.material.fragmentShader.includes('sampleDensity'));
  assert.ok(gate.smoke.scale.y < 1.5, 'smoke stays below canopy');
  assert.equal(gate.smoke.material.depthWrite, false);
  assert.equal(gate.smoke.material.side, THREE.FrontSide);
  fire.update(14, { weather: 'storm',
    cameraPosition: new THREE.Vector3(gate.x, 36, gate.z + 4) });
  assert.equal(gate.root.visible, true);
  assert.equal(gate.flame.visible, true);
  assert.equal(gate.smoke.visible, true);
  assert.ok(gate.light.intensity > 0);
  assert.equal(gate.smoke.material.uniforms.uOpacity.value, 0.42);
  assert.ok(Number.isFinite(gate.flame.material.uniforms.uCameraLocal.value.x));
  fire.update(16, { weather: 'mist',
    cameraPosition: new THREE.Vector3(1000, 36, 1000) });
  assert.equal(gate.root.visible, false);
  assert.equal(lodge.root.visible, false);
  let textureDisposed = false;
  fire.noise.addEventListener('dispose', () => { textureDisposed = true; });
  fire.dispose();
  assert.equal(fire.group.parent, null);
  assert.equal(textureDisposed, true);
});

test('mobile quality preserves fires with fewer volume samples', () => {
  const fire = createFireAtmosphere(new THREE.Scene(), () => 0,
    { quality: 'mobile-standard' });
  assert.equal(fire.quality, 'mobile');
  assert.equal(fire.noise.image.width, 24);
  const gate = fire.sources.find((source) => source.kind === 'brazier');
  assert.equal(gate.flame.material.uniforms.uSteps.value, 8);
  assert.equal(gate.smoke.material.uniforms.uSteps.value, 5);
  fire.dispose();
});
