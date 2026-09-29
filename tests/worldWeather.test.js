import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createWorld } from '../src/world.js';

const COLORS = {
  mist: {
    sky: 0x879797, fog: 0x899b9b, cloud: 0x718184,
    hemiSky: 0xe6f0e9, hemiGround: 0x85998e, sun: 0xe4ece2,
    seaDeep: 0x263f49, seaLight: 0x547078,
  },
  rain: {
    sky: 0x66757c, fog: 0x697a80, cloud: 0x45565e,
    hemiSky: 0xc0cfd0, hemiGround: 0x60736d, sun: 0xb7c5c8,
    seaDeep: 0x182f3e, seaLight: 0x3c5662,
  },
  storm: {
    sky: 0x38434e, fog: 0x46515a, cloud: 0x26323c,
    hemiSky: 0x93a5ad, hemiGround: 0x45555a, sun: 0x9eb6c1,
    seaDeep: 0x122531, seaLight: 0x30444f,
  },
  dawn: {
    sky: 0xbaa99b, fog: 0xafa99e, cloud: 0x918887,
    hemiSky: 0xf1d1b7, hemiGround: 0x53605c, sun: 0xffddb3,
    seaDeep: 0x39515b, seaLight: 0x82958e,
  },
};

function weatherColors(scene) {
  const sky = scene.getObjectByName('Procedural volumetric storm clouds');
  const sea = scene.getObjectByName('Distant open sea');
  const hemisphere = scene.children.find((item) => item.isHemisphereLight);
  const sun = scene.children.find((item) => item.isDirectionalLight);
  return {
    sky: scene.background,
    fog: scene.fog.color,
    cloud: sky.material.uniforms.uCloud.value,
    hemiSky: hemisphere.color,
    hemiGround: hemisphere.groundColor,
    sun: sun.color,
    seaDeep: sea.material.uniforms.uDeep.value,
    seaLight: sea.material.uniforms.uLight.value,
  };
}

function captureColors(scene) {
  return Object.fromEntries(Object.entries(weatherColors(scene))
    .map(([key, color]) => [key, color.clone()]));
}

function assertColors(scene, from, to, fraction) {
  const progress = fraction * fraction * (3 - 2 * fraction);
  for (const [key, actual] of Object.entries(weatherColors(scene))) {
    const expected = from[key].clone()
      .lerp(new THREE.Color(COLORS[to][key]), progress);
    assert.ok(actual.equals(expected), `${key} must match the original blend to ${to}`);
  }
}

test('weather color targets remain exact through transitions and long settled periods', () => {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(0, 8, 270);
  const world = createWorld(scene, camera);

  world.update(0.1, 1, 'mist');
  const mist = captureColors(scene);
  assertColors(scene, mist, 'mist', 1);

  world.update(0.1, 1, 'rain');
  assertColors(scene, mist, 'rain', 0.1 / 5);
  for (let i = 0; i < 60; i++) world.update(0.1, 1, 'rain');
  assertColors(scene, mist, 'rain', 1);
  for (let i = 0; i < 600; i++) world.update(0.1, 1, 'rain');
  assertColors(scene, mist, 'rain', 1);

  const rain = captureColors(scene);
  world.update(0.1, 1, 'storm');
  assertColors(scene, rain, 'storm', 0.1 / 2.8);
  for (let i = 0; i < 30; i++) world.update(0.1, 1, 'storm');
  assertColors(scene, rain, 'storm', 1);

  const storm = captureColors(scene);
  world.update(0.1, 1, 'dawn');
  assertColors(scene, storm, 'dawn', 0.1 / 5);
});
