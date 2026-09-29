import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createWorld } from '../src/world.js';
import {
  CLIFF_FALL, advanceCliffFall, beginCliffFall, classifyCoastalStep,
  cliffFallPresentation, createCliffFallState, rememberSafeGround,
  resolveSafeRespawn,
} from '../src/cliffFall.js';

// Use the actual sculpted shoreline so the rules cannot silently drift away
// from the coastal mesh or from the two low landing coves.
const scene = new THREE.Scene();
const world = createWorld(scene, new THREE.Camera());
const coastalWorld = {
  ...world,
  isPier: (x, z) => Math.abs(x) < 3.8 && z >= 342 && z <= 357,
};

test('a high headland can be approached past the old walk limit and stepped off', () => {
  const initial = { x: 336, z: 0 };
  assert.equal(world.isWalkable(initial.x, initial.z), false);
  assert.deepEqual(classifyCoastalStep(initial, { x: 336.4, z: 0 }, coastalWorld),
    { kind: 'ledge' });
  assert.deepEqual(classifyCoastalStep({ x: 344, z: 0 }, { x: 344.4, z: 0 }, coastalWorld),
    { kind: 'fall' });
  assert.ok(world.terrainHeight(344, 0) > CLIFF_FALL.minimumCliffHeight);
  assert.deepEqual(classifyCoastalStep({ x: 344, z: 0 }, { x: 344.4, z: 0 },
    { ...coastalWorld, coastalRadius: undefined }), { kind: 'blocked' });
});

test('visible coastal rock starts at the fall lip and meets the rendered terrain crest', () => {
  const mesh = scene.getObjectByName('Stratified coastal rock face');
  assert.ok(mesh);
  const vertices = mesh.geometry.getAttribute('position');
  for (let index = 0; index < vertices.count; index++) {
    const x = vertices.getX(index);
    const z = vertices.getZ(index);
    assert.ok(world.coastalRadius(x, z) >= CLIFF_FALL.lipRadius - 0.0005,
      `rock vertex ${index} intrudes into the walkable crest`);
  }
  for (let index = 0; index < vertices.count; index += 29) {
    const x = vertices.getX(index);
    const z = vertices.getZ(index);
    assert.ok(Math.abs(vertices.getY(index) - world.renderedTerrainHeight(x, z)) < 0.15,
      `rock rim ${index / 29} does not meet terrain`);
  }
  const terrain = scene.getObjectByName('Island terrain');
  for (const [x, z] of [[344, 0], [340, 20], [-330, -44], [0, 270]]) {
    const probe = new THREE.Raycaster(new THREE.Vector3(x, 110, z),
      new THREE.Vector3(0, -1, 0), 0, 160);
    const hit = probe.intersectObject(terrain)[0];
    assert.ok(hit, `rendered terrain missing at ${x}, ${z}`);
    assert.ok(Math.abs(hit.point.y - world.renderedTerrainHeight(x, z)) < 0.005,
      `rendered terrain sampler drifted at ${x}, ${z}`);
  }
  const ray = new THREE.Raycaster(new THREE.Vector3(344, 100, 0),
    new THREE.Vector3(0, -1, 0), 0, 150);
  assert.equal(ray.intersectObject(mesh).length, 0,
    'the walkable high lip must not be buried under the visible rock face');
});

test('landing coves and pier keep their routes; sea, teleport steps and cliff backtracking are blocked', () => {
  assert.deepEqual(classifyCoastalStep({ x: 0, z: 339 }, { x: 0, z: 339.5 }, coastalWorld),
    { kind: 'ground' });
  assert.deepEqual(classifyCoastalStep({ x: 0, z: 343 }, { x: 0, z: 343.5 }, coastalWorld),
    { kind: 'ground' });
  assert.deepEqual(classifyCoastalStep({ x: 0, z: 357 }, { x: 0, z: 357.2 }, coastalWorld),
    { kind: 'blocked' });
  assert.deepEqual(classifyCoastalStep({ x: 360, z: 0 }, { x: 359.8, z: 0 }, coastalWorld),
    { kind: 'blocked' });
  assert.deepEqual(classifyCoastalStep({ x: 335, z: 0 }, { x: 344, z: 0 }, coastalWorld),
    { kind: 'blocked' });
  assert.deepEqual(classifyCoastalStep({ x: NaN, z: 0 }, { x: 344, z: 0 }, coastalWorld),
    { kind: 'blocked' });
});

test('respawn caches inland ground, rejects unsafe or obstructed points, and uses validated fallback', () => {
  let state = createCliffFallState({ x: 0, z: 270 });
  state = rememberSafeGround(state, { x: 329, z: 0 }, coastalWorld, () => true);
  assert.deepEqual(state.lastSafe, { x: 329, z: 0 });
  state = rememberSafeGround(state, { x: 344, z: 0 }, coastalWorld, () => true);
  assert.deepEqual(state.lastSafe, { x: 329, z: 0 }, 'edge cannot become respawn point');
  assert.deepEqual(resolveSafeRespawn(state, coastalWorld, () => true), { x: 329, z: 0 });
  assert.deepEqual(resolveSafeRespawn(state, coastalWorld, (x) => x !== 329),
    { x: 0, z: 270 }, 'a newly obstructed checkpoint is skipped');
  assert.deepEqual(resolveSafeRespawn(createCliffFallState({ x: 1000, z: 1000 }),
    coastalWorld, () => true), { x: 0, z: 270 });
  assert.equal(resolveSafeRespawn(state, coastalWorld, () => false), null,
    'never place the player into an obstructed fallback');
});

test('fall animation descends from the last supported height, impacts once, then respawns', () => {
  const from = { x: 344, z: 0 };
  const to = { x: 344.4, z: 0 };
  let state = rememberSafeGround(createCliffFallState(), { x: 329, z: 0 },
    coastalWorld, () => true);
  state = beginCliffFall(state, from, to, world.terrainHeight(from.x, from.z));
  assert.equal(state.phase, 'falling');
  assert.equal(state.eyeY, world.terrainHeight(from.x, from.z) + CLIFF_FALL.eyeHeight);
  assert.deepEqual(cliffFallPresentation(state).x, to.x);
  let impactCount = 0;
  for (let i = 0; i < 100 && state.phase === 'falling'; i++) {
    const tick = advanceCliffFall(state, 0.05, coastalWorld, () => true);
    state = tick.state;
    if (tick.event === 'impact') impactCount++;
  }
  assert.equal(impactCount, 1);
  assert.equal(state.phase, 'impact');
  assert.ok(state.position.x > 346, 'outward momentum clears the cliff as the view drops');
  assert.ok(cliffFallPresentation(state).darkness >= 0.3);
  let respawn = null;
  for (let i = 0; i < 20 && state.phase === 'impact'; i++) {
    const tick = advanceCliffFall(state, 0.05, coastalWorld, () => true);
    state = tick.state;
    if (tick.event === 'respawn') respawn = tick.respawn;
  }
  assert.deepEqual(respawn, { x: 329, z: 0 });
  assert.equal(state.phase, 'grounded');
  assert.equal(cliffFallPresentation(state), null);
});

test('a nearly tangential lip crossing still carries the fall clear of coastal rock', () => {
  const from = { x: 344, z: -0.5 };
  const to = { x: 344, z: -1.5 };
  assert.deepEqual(classifyCoastalStep(from, to, coastalWorld), { kind: 'fall' });
  for (const outwardWorld of [undefined, coastalWorld]) {
    let state = beginCliffFall(createCliffFallState(), from, to,
      world.terrainHeight(from.x, from.z), outwardWorld);
    assert.ok(state.outwardX > 0.8, 'fall momentum must point out to sea');
    for (let i = 0; i < 100 && state.phase === 'falling'; i++) {
      const tick = advanceCliffFall(state, 0.05, coastalWorld);
      state = tick.state;
      if (state.phase === 'falling') {
        assert.ok(state.eyeY - CLIFF_FALL.eyeHeight
          > world.terrainHeight(state.position.x, state.position.z) - 0.5,
        'camera feet should remain above coastal rock during the fall');
      }
    }
    assert.equal(state.phase, 'impact');
    assert.ok(world.coastalRadius(state.position.x, state.position.z) > 1,
      'impact occurs seaward of the rock face');
  }
});

test('paused time does not advance a fall and an unavailable respawn holds the impact', () => {
  const from = { x: 344, z: 0 };
  let state = beginCliffFall(createCliffFallState(), from, { x: 344.4, z: 0 },
    world.terrainHeight(from.x, from.z));
  assert.equal(advanceCliffFall(state, 0, coastalWorld).state, state);
  for (let i = 0; i < 100 && state.phase === 'falling'; i++) {
    state = advanceCliffFall(state, 0.05, coastalWorld).state;
  }
  assert.equal(state.phase, 'impact');
  const held = advanceCliffFall(state, 1, coastalWorld, () => false);
  assert.equal(held.state.phase, 'impact');
  assert.equal(held.event, null);
  assert.equal(held.respawn, null);
});
