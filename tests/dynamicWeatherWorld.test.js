import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createDynamicWeather } from '../src/dynamicWeather.js';
import { createWorld } from '../src/world.js';

test('clock and weather fronts drive the same sky, lights, rain, wind, and wet ground', () => {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(72, 16 / 9, 0.08, 1900);
  camera.position.set(90, 42, 180);
  const world = createWorld(scene, camera);
  const weather = createDynamicWeather();
  const sky = scene.getObjectByName('Procedural volumetric storm clouds');
  const sea = scene.getObjectByName('Distant open sea');
  const terrain = scene.getObjectByName('Island terrain');
  const rain = scene.getObjectByName('Shader-driven coastal rain');
  const sun = world.shadowLight;
  const moon = scene.getObjectByName('Moonlight');

  const midday = weather.sample(15, { weatherOverride: 'clear', timeOverride: 'noon' });
  world.update(0.05, 15, midday.mode, midday);
  assert.ok(sun.intensity > 0.5);
  assert.equal(sun.castShadow, true);
  assert.equal(moon.intensity, 0);
  assert.equal(rain.visible, false);
  assert.equal(sky.material.uniforms.uCover.value, midday.cloudCover);
  assert.equal(sky.material.uniforms.uDaylight.value, midday.daylight);
  assert.ok(Math.abs((sun.position.x - camera.position.x) / 370
    - midday.sunDirection.x) < 1e-9);
  assert.ok(Math.abs(sea.material.uniforms.uWindDirection.value.x
    - midday.windDirection.x) < 1e-9);
  const daySky = scene.background.clone();
  const dayRoughness = terrain.material.roughness;
  const drift = sky.material.uniforms.uWindOffset.value.clone();

  const stormNight = weather.sample(250,
    { weatherOverride: 'storm', timeOverride: 'night' });
  world.update(0.1, 250, stormNight.mode, stormNight);
  assert.equal(sun.castShadow, false);
  assert.ok(sun.intensity < 0.2);
  assert.ok(sky.material.uniforms.uNight.value > 0.99);
  assert.ok(scene.background.r + scene.background.g + scene.background.b
    < daySky.r + daySky.g + daySky.b);
  assert.equal(rain.geometry.instanceCount, rain.userData.dropCount ?? 16000);
  assert.ok(terrain.material.roughness < dayRoughness);
  assert.equal(sky.material.uniforms.uCover.value, stormNight.cloudCover);
  assert.ok(sky.material.uniforms.uWindOffset.value.distanceTo(drift) < 3,
    'cloud drift should integrate the new wind without teleporting');
});
