import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createRainEffects } from '../src/rainEffects.js';

test('storm splash uploads cover every visible vertex and no reserved inactive impacts', () => {
  const originalRandom = Math.random;
  let seed = 0x12345678;
  Math.random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  try {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(72, 1, 0.1, 1000);
    camera.position.set(0, 31, 0);
    const rain = createRainEffects(scene, camera, () => 30, () => 0.055);
    for (let frame = 0; frame < 600; frame++) rain.update(1 / 60, frame / 60, 'storm');
    const ripple = scene.children.find((object) => object.name === 'Rain ground ripples');
    const fleck = scene.children.find((object) => object.name === 'Rain impact flecks');
    const rippleIndices = ripple.geometry.drawRange.count;
    const fleckPoints = fleck.geometry.drawRange.count;
    assert.ok(ripple.visible && fleck.visible);
    assert.ok(fleckPoints > 60 && fleckPoints < 510);
    assert.equal(rippleIndices, fleckPoints * 28);
    const checkRange = (mesh, name, expected) => {
      const attribute = mesh.geometry.getAttribute(name);
      assert.equal(attribute.updateRanges.length, 1);
      assert.equal(attribute.updateRanges[0].start, 0);
      assert.equal(attribute.updateRanges[0].count, expected);
      assert.ok(expected < attribute.array.length, `${name} still uploads its entire reserve`);
      for (let i = 0; i < expected; i++) {
        assert.ok(Number.isFinite(attribute.array[i]), `${name}[${i}] is non-finite`);
      }
    };
    checkRange(ripple, 'position', rippleIndices);
    checkRange(ripple, 'aAlpha', rippleIndices / 3);
    checkRange(fleck, 'position', fleckPoints * 3);
    checkRange(fleck, 'aAlpha', fleckPoints);
    checkRange(fleck, 'aSize', fleckPoints);
    rain.dispose();
  } finally {
    Math.random = originalRandom;
  }
});

test('rain impacts ripple on the elevated inland lake rather than the buried terrain', () => {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(72, 1, 0.1, 1000);
  camera.position.set(-70, 50, -75);
  const rain = createRainEffects(scene, camera, () => 44, () => 0.055,
    () => false, () => 49);
  for (let frame = 0; frame < 240; frame++) rain.update(1 / 60, frame / 60, 'storm');
  const ripple = scene.children.find((object) => object.name === 'Rain ground ripples');
  assert.ok(ripple.geometry.drawRange.count > 0);
  const positions = ripple.geometry.getAttribute('position').array;
  for (let i = 1; i < ripple.geometry.drawRange.count; i += 3) {
    assert.ok(Math.abs(positions[i] - 49.04) < 0.001);
  }
  rain.dispose();
});

test('light rain makes sparse visible road splashes that fade away when it clears', () => {
  const originalRandom = Math.random;
  let seed = 0x317ac449;
  Math.random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  try {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(72, 1, 0.1, 1000);
    camera.position.set(0, 31, 0);
    const rain = createRainEffects(scene, camera, () => 30, () => 0.055,
      () => false, () => null,
      { isRoadAt: () => true, renderedTerrainHeight: () => 30.1 });
    const ripple = scene.getObjectByName('Rain ground ripples');
    const fleck = scene.getObjectByName('Rain impact flecks');
    const inspect = () => {
      const vertexCount = ripple.geometry.drawRange.count / 3;
      const alphas = ripple.geometry.getAttribute('aAlpha').array;
      return { impacts: vertexCount / 28,
        peakAlpha: Math.max(...alphas.subarray(0, vertexCount)) };
    };

    for (let frame = 0; frame < 600; frame++) {
      rain.update(1 / 60, frame / 60, { rain: 0.08 });
    }
    const light = inspect();
    assert.ok(ripple.visible && fleck.visible);
    assert.ok(light.impacts >= 3 && light.impacts < 30);
    assert.ok(light.peakAlpha > 0.05, 'light rain rings should be discernible');
    const positions = ripple.geometry.getAttribute('position').array;
    for (let i = 1; i < light.impacts * 28 * 3; i += 3) {
      assert.ok(Math.abs(positions[i] - 30.225) < 1e-4,
        'road impacts must sit above gravel and shallow puddles');
    }

    for (let frame = 600; frame < 1200; frame++) {
      rain.update(1 / 60, frame / 60, { rain: 0.025 });
    }
    const drizzle = inspect();
    assert.ok(drizzle.impacts > 0 && drizzle.impacts < light.impacts);
    assert.ok(drizzle.peakAlpha > 0.02, 'mist drizzle should still show small rings');

    for (let frame = 1200; frame < 1800; frame++) {
      rain.update(1 / 60, frame / 60, 0);
    }
    assert.equal(ripple.visible, false);
    assert.equal(fleck.visible, false);
    rain.dispose();
  } finally {
    Math.random = originalRandom;
  }
});
