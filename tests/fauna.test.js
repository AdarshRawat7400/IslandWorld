import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createWorld } from '../src/world.js';
import { isRoad } from '../src/roads.js';
import { createFauna, planCoastalFauna } from '../src/fauna.js';

const world = createWorld(new THREE.Scene(), new THREE.Camera());

test('fauna homes stay on the high plateau, off roads, and clear of obstacles', () => {
  const obstacle = (x, z, radius) => Math.hypot(x + 214, z - 105) < 7 + radius;
  const plan = planCoastalFauna(world.terrainHeight, {
    coastalRadius: world.coastalRadius,
    isRoad,
    isBlocked: obstacle,
  });
  assert.equal(plan.sheep.length, 6);
  assert.equal(plan.rabbits.length, 4);
  for (const [species, homes] of Object.entries(plan)) for (const home of homes) {
    const clearance = species === 'sheep' ? 4 : 2.5;
    assert.ok(home.y > 18 && Number.isFinite(home.y));
    assert.ok(world.coastalRadius(home.x, home.z) < 0.9);
    assert.equal(isRoad(home.x, home.z, 7 + clearance), false);
    assert.equal(obstacle(home.x, home.z, clearance), false);
  }
});

test('ground wildlife stays clear of inland water and its bank', () => {
  const flooded = (x, z, margin = 0) => Math.hypot(x + 214, z - 105) < 14 + margin;
  const plan = planCoastalFauna(world.terrainHeight, {
    coastalRadius: world.coastalRadius,
    isRoad,
    isLake: flooded,
  });
  assert.ok(plan.sheep.length < 6, 'a flooded grazing area removes unsafe homes');
  for (const home of plan.sheep) assert.equal(flooded(home.x, home.z, 9), false);
  for (const home of plan.rabbits) assert.equal(flooded(home.x, home.z, 7.5), false);

  let newWater = false;
  const scene = new THREE.Scene();
  const fauna = createFauna(scene, world.terrainHeight, {
    coastalRadius: world.coastalRadius,
    isRoad,
    isLake: (x, z) => newWater && Math.abs(x - fauna.homes.sheep[0].x) > 0.1,
  });
  const home = fauna.homes.sheep[0];
  const wool = scene.getObjectByName('Feral sheep wool');
  const pose = new THREE.Matrix4();
  newWater = true;
  fauna.update(0.016, 13, 'mist');
  wool.getMatrixAt(0, pose);
  assert.ok(Math.abs(pose.elements[12] - home.x) < 0.001,
    'a sheep turns back when new lake water reaches its wander path');
  fauna.dispose();
});

test('storm shelters ground wildlife and suppresses bird calls', () => {
  const scene = new THREE.Scene();
  const fauna = createFauna(scene, world.terrainHeight, {
    coastalRadius: world.coastalRadius,
    isRoad,
  });
  const context = { playerX: -270, playerZ: 100 };
  let result = fauna.update(0.1, 0.1, 'mist', context);
  assert.equal(result.birdsActive, 12);
  assert.equal(result.rabbitsActive, 4);
  let calmCalls = 0;
  for (let frame = 1; frame <= 240; frame++) {
    result = fauna.update(0.1, frame * 0.1, 'mist', context);
    calmCalls += result.birdCalls;
  }
  assert.equal(calmCalls, 1, 'one sparse coastal call near the flock');
  for (let frame = 241; frame <= 500; frame++) {
    result = fauna.update(0.1, frame * 0.1, 'storm', context);
    assert.equal(result.birdCalls, 0);
  }
  assert.equal(result.birdsActive, 4);
  assert.equal(result.rabbitsActive, 0);
  assert.equal(scene.getObjectByName('Coastal rabbit bodies').count, 0);
  fauna.dispose();
  assert.equal(scene.children.length, 0);
});

test('birds animate, and sheep stop their wander when a new obstruction appears', () => {
  let blocked = false;
  let home;
  const scene = new THREE.Scene();
  const fauna = createFauna(scene, world.terrainHeight, {
    coastalRadius: world.coastalRadius,
    isRoad,
    isBlocked: (x, z) => blocked && home && x > home.x + 0.1
      && Math.abs(z - home.z) < 5,
  });
  home = fauna.homes.sheep[0];
  const birds = scene.getObjectByName('Coastal bird bodies');
  const sheep = scene.getObjectByName('Feral sheep wool');
  const rabbits = scene.getObjectByName('Coastal rabbit bodies');
  const before = new THREE.Matrix4();
  const after = new THREE.Matrix4();
  birds.getMatrixAt(0, before);
  rabbits.getMatrixAt(0, after);
  assert.ok(after.elements.every(Number.isFinite), 'wildlife starts with finite transforms');
  blocked = true;
  fauna.update(0.016, 13, 'mist', { playerX: 0, playerZ: 270 });
  birds.getMatrixAt(0, after);
  assert.notDeepEqual(before.elements, after.elements, 'flock must travel around the headland');
  assert.ok(after.elements.every(Number.isFinite));
  sheep.getMatrixAt(0, after);
  assert.ok(Math.abs(after.elements[12] - home.x) < 0.001,
    'blocked sheep returns to its safe grazing home');
  fauna.dispose();
});

test('animal details stay aligned and within a small instanced rendering budget', () => {
  const scene = new THREE.Scene();
  const fauna = createFauna(scene, world.terrainHeight, {
    coastalRadius: world.coastalRadius,
    isRoad,
  });
  fauna.update(0.016, 17, 'mist');
  const meshes = scene.children.filter((child) => child.isInstancedMesh);
  assert.equal(meshes.length, scene.children.length, 'wildlife uses instancing throughout');
  assert.ok(meshes.length <= 26, 'the extra anatomy stays within 26 draw calls');
  const expandedVertices = meshes.reduce((sum, mesh) =>
    sum + mesh.count * mesh.geometry.getAttribute('position').count, 0);
  assert.ok(expandedVertices < 30000, 'procedural detail stays light enough for the island');
  const matrix = new THREE.Matrix4();
  for (const mesh of meshes) {
    assert.ok(mesh.count > 0, `${mesh.name} starts visible in calm weather`);
    mesh.getMatrixAt(0, matrix);
    assert.ok(matrix.elements.every(Number.isFinite), `${mesh.name} has a finite pose`);
    assert.ok(matrix.determinant() > 0, `${mesh.name} avoids reflected instance transforms`);
  }
  const birdBody = scene.getObjectByName('Coastal bird bodies');
  const birdHead = scene.getObjectByName('Coastal bird heads');
  for (const time of [0, 8, 17]) {
    fauna.update(0.016, time, 'mist');
    birdBody.getMatrixAt(0, matrix);
    const bodyPosition = new THREE.Vector3();
    const bodyRotation = new THREE.Quaternion();
    matrix.decompose(bodyPosition, bodyRotation, new THREE.Vector3());
    birdHead.getMatrixAt(0, matrix);
    const headPosition = new THREE.Vector3().setFromMatrixPosition(matrix);
    const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(bodyRotation);
    assert.ok(headPosition.sub(bodyPosition).dot(forward) > 0.3,
      'the gull head stays in front as the flock turns');
  }
  const head = scene.getObjectByName('Feral sheep heads');
  const eye = scene.getObjectByName('Feral sheep eyes');
  head.getMatrixAt(0, matrix);
  const headPosition = new THREE.Vector3().setFromMatrixPosition(matrix);
  eye.getMatrixAt(0, matrix);
  const eyePosition = new THREE.Vector3().setFromMatrixPosition(matrix);
  assert.ok(headPosition.distanceTo(eyePosition) < 0.4,
    'the sheep eye follows the grazing head');
  fauna.update(0.016, 18, 'rain');
  assert.equal(scene.getObjectByName('Coastal rabbit inner ears').count, 4);
  fauna.update(0.016, 19, 'storm');
  assert.equal(scene.getObjectByName('Coastal bird tails').count, 4);
  for (const mesh of meshes.filter((item) => item.name.startsWith('Coastal rabbit'))) {
    assert.equal(mesh.count, 0, `${mesh.name} shelters with the rabbits`);
  }
  fauna.dispose();
  assert.equal(scene.children.length, 0);
});
