import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { createOceanWaveField, OCEAN_WAVE_COUNT,
  OCEAN_WAVE_GLSL, OCEAN_WEATHER } from '../src/oceanWaveField.js';
import { createWorld } from '../src/world.js';

test('wave field has one reproducible spectrum for GPU and CPU', () => {
  const first = createOceanWaveField();
  const second = createOceanWaveField();
  assert.equal(first.waves.length, OCEAN_WAVE_COUNT);
  assert.equal(first.uniforms.uOceanWaveDirs.value.length, OCEAN_WAVE_COUNT);
  assert.equal(first.uniforms.uOceanWaveParams.value.length, OCEAN_WAVE_COUNT);
  for (const [x, z, time] of [[0, 0, 0], [241.2, -375.7, 4.12], [-370, 290, 18.4]]) {
    assert.equal(first.heightAt(x, z, time), second.heightAt(x, z, time));
  }
  for (let i = 0; i < OCEAN_WAVE_COUNT; i++) {
    const wave = first.waves[i];
    const dirs = first.uniforms.uOceanWaveDirs.value[i];
    const params = first.uniforms.uOceanWaveParams.value[i];
    assert.equal(dirs.x, wave.dx);
    assert.equal(dirs.y, wave.dz);
    assert.equal(dirs.z, wave.k);
    assert.equal(dirs.w, wave.omega);
    assert.equal(params.x, wave.amplitude);
    assert.equal(params.y, wave.steepness);
    assert.equal(params.z, wave.phase);
  }
  assert.match(OCEAN_WAVE_GLSL, /oceanWaveDisplacement/);
  assert.match(OCEAN_WAVE_GLSL, /uOceanWaveDirs\[16\]/);
});

test('world-space height inverts the horizontal Gerstner displacement', () => {
  const field = createOceanWaveField();
  for (const [materialX, materialZ, time] of [
    [20.4, -310.6, 2.3], [-340.7, 180.4, 10.2], [400.2, 10.4, 30.5],
  ]) {
    const displacement = field.displacementAt(materialX, materialZ, time);
    const worldX = materialX + displacement.x;
    const worldZ = materialZ + displacement.z;
    const height = field.heightAt(worldX, worldZ, time);
    assert.ok(Math.abs(height - (field.seaLevel + displacement.y)) < 1e-5,
      `GPU/CPU water mismatch: ${height} vs ${field.seaLevel + displacement.y}`);
  }
});

test('storm grows wave energy smoothly and normals stay finite', () => {
  const field = createOceanWaveField();
  assert.ok(OCEAN_WEATHER.storm > OCEAN_WEATHER.rain);
  const initial = field.significantWaveHeight;
  field.update(1 / 60, 'storm');
  assert.ok(field.significantWaveHeight > initial);
  assert.ok(field.significantWaveHeight < OCEAN_WEATHER.storm);
  for (let frame = 2; frame <= 480; frame++) field.update(frame / 60, 'storm');
  assert.ok(field.significantWaveHeight > OCEAN_WEATHER.rain);
  assert.ok(field.significantWaveHeight <= OCEAN_WEATHER.storm);
  assert.equal(field.uniforms.uOceanWaveTime.value, 8);
  const normal = field.normalAt(-330, 245, 8);
  assert.ok(Number.isFinite(normal.x) && Number.isFinite(normal.y) && Number.isFinite(normal.z));
  assert.ok(Math.abs(normal.length() - 1) < 1e-12);
  assert.ok(normal.y > 0);
});

test('flat attenuation returns exact sea level and flat normal', () => {
  const field = createOceanWaveField({ seaLevel: 0.31 });
  assert.equal(field.heightAt(12, 34, 56, 0), 0.31);
  assert.deepEqual(field.normalAt(12, 34, 56, 0).toArray(), [0, 1, 0]);
  const partial = field.heightAt(12, 34, 56, 0.3);
  assert.ok(Number.isFinite(partial));
});

test('island ocean shader and boat sampler use the shared wave field', () => {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(0, 8, 270);
  const world = createWorld(scene, camera);
  const mesh = scene.getObjectByName('Moving nearshore swells');
  assert.match(mesh.material.vertexShader, /oceanWaveDisplacement\(p\)/);
  assert.equal(mesh.material.uniforms.uOceanWaveParams.value.length, OCEAN_WAVE_COUNT);
  world.update(1 / 60, 1 / 60, 'mist');
  const height = world.waterHeight(0, 400, 1);
  const normal = world.waterHeight.normalAt(0, 400, 1);
  assert.ok(Number.isFinite(height));
  assert.ok(normal.y > 0 && Number.isFinite(normal.x));
  assert.equal(world.waterHeight(2000, 2000, 1), 0.045);
  assert.deepEqual(world.waterHeight.normalAt(2000, 2000, 1).toArray(), [0, 1, 0]);
  assert.equal(world.isWalkable(-70, -75), false);
  assert.equal(world.isWalkable(-70, -10), true);
  assert.ok(world.terrainHeight(-70, -75) < world.lakeWaterHeight(-70, -75, 1));
});
