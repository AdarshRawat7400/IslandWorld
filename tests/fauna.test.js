import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createWorld, islandTerrainHeightAt } from '../src/world.js';
import { isRoad } from '../src/roads.js';
import { createFauna, planCoastalFauna, SERVER_WILDLIFE_HOMES,
  WILDLIFE_POPULATION, wildlifeTargetsAt } from '../src/fauna.js';
import { birdFlightAt } from '../src/birdFlight.js';

const world = createWorld(new THREE.Scene(), new THREE.Camera());

test('fauna homes stay on the high plateau, off roads, and clear of obstacles', () => {
  const obstacle = (x, z, radius) => Math.hypot(x + 214, z - 105) < 7 + radius;
  const plan = planCoastalFauna(world.terrainHeight, {
    coastalRadius: world.coastalRadius,
    isRoad,
    isBlocked: obstacle,
  });
  assert.equal(plan.sheep.length, WILDLIFE_POPULATION.sheep);
  assert.equal(plan.rabbits.length, WILDLIFE_POPULATION.rabbits);
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
  assert.equal(plan.sheep.length, WILDLIFE_POPULATION.sheep,
    'a flooded grazing area relocates animals to other safe ground');
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
  assert.equal(result.birdsActive, WILDLIFE_POPULATION.birds);
  assert.equal(result.rabbitsActive, WILDLIFE_POPULATION.rabbits);
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
  assert.equal(result.birdsActive, 36);
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
  fauna.update(0.016, 13, 'mist');
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
  fauna.update(0.016, 17, 'mist', { playerX: 0, playerZ: 270 });
  const meshes = scene.children.filter((child) => child.isInstancedMesh);
  assert.equal(meshes.length, scene.children.length, 'wildlife uses instancing throughout');
  assert.ok(meshes.length <= 26, 'the extra anatomy stays within 26 draw calls');
  const expandedVertices = meshes.reduce((sum, mesh) =>
    sum + mesh.count * mesh.geometry.getAttribute('position').count, 0);
  assert.ok(expandedVertices < 70000,
    'distance packing keeps only a small fraction of the 250 animals in draw buffers');
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
  assert.equal(scene.getObjectByName('Coastal rabbit inner ears').count,
    WILDLIFE_POPULATION.rabbits);
  fauna.update(0.016, 19, 'storm');
  assert.equal(scene.getObjectByName('Coastal bird tails').count, 36);
  for (const mesh of meshes.filter((item) => item.name.startsWith('Coastal rabbit'))) {
    assert.equal(mesh.count, 0, `${mesh.name} shelters with the rabbits`);
  }
  fauna.dispose();
  assert.equal(scene.children.length, 0);
});

test('room wildlife homes and IDs match the current deterministic island layout', () => {
  const planned = planCoastalFauna(world.terrainHeight, {
    coastalRadius: world.coastalRadius, isRoad, isLake: world.isLake,
  });
  for (const species of ['sheep', 'rabbits']) {
    assert.equal(SERVER_WILDLIFE_HOMES[species].length, planned[species].length);
    planned[species].forEach((home, index) => {
      const staticHome = SERVER_WILDLIFE_HOMES[species][index];
      for (const axis of ['x', 'y', 'z']) {
        assert.ok(Math.abs(home[axis] - staticHome[axis]) < 1e-9,
          `${species}-${index} ${axis} remains server compatible`);
      }
      assert.ok(Object.isFrozen(staticHome));
    });
  }
  const targets = wildlifeTargetsAt(SERVER_WILDLIFE_HOMES, 43, 'rain',
    { multiplayer: true });
  assert.equal(targets.length, 250);
  assert.equal(new Set(targets.map((target) => target.id)).size, 250);
  assert.equal(targets.filter((target) => target.kind === 'bird').length, 120);
  assert.equal(targets.filter((target) => target.kind === 'sheep').length, 52);
  assert.equal(targets.filter((target) => target.kind === 'rabbit').length, 78);
  const groundHomes = [...SERVER_WILDLIFE_HOMES.sheep,
    ...SERVER_WILDLIFE_HOMES.rabbits];
  for (const east of [false, true]) for (const south of [false, true]) {
    assert.ok(groundHomes.filter((home) => (home.x >= 0) === east
      && (home.z >= 0) === south).length >= 20,
    'ground wildlife is spread across every island quadrant');
  }
  for (const bird of targets.filter((target) => target.kind === 'bird')) {
    assert.ok(bird.y - islandTerrainHeightAt(bird.x, bird.z) > 9,
      `${bird.id} stays above the high terrain`);
  }
  assert.deepEqual(targets.map((target) => target.kind).slice(0, 3),
    ['bird', 'bird', 'bird']);
  assert.equal(targets.filter((target) => target.active && target.kind === 'rabbit').length, 39);
  assert.deepEqual(
    wildlifeTargetsAt(SERVER_WILDLIFE_HOMES, 43, 'mist',
      { multiplayer: true, playerX: 171, playerZ: 145 }),
    wildlifeTargetsAt(SERVER_WILDLIFE_HOMES, 43, 'mist',
      { multiplayer: true, playerX: -171, playerZ: -145 }),
    'room wildlife poses cannot depend on a local player viewpoint',
  );
  const roomScene = new THREE.Scene();
  const roomFauna = createFauna(roomScene, world.terrainHeight, {
    coastalRadius: world.coastalRadius, isRoad, isLake: world.isLake,
    isBlocked: () => true,
  });
  for (const weather of ['mist', 'rain', 'storm']) {
    for (const seconds of [0, 13, 82]) {
      roomFauna.update(0.016, seconds, weather,
        { multiplayer: true, playerX: 171, playerZ: 145 });
      const expected = wildlifeTargetsAt(SERVER_WILDLIFE_HOMES, seconds, weather,
        { multiplayer: true, terrainHeight: islandTerrainHeightAt });
      const actual = roomFauna.getTargets();
      for (let i = 0; i < expected.length; i++) {
        assert.equal(actual[i].id, expected[i].id);
        for (const axis of ['x', 'y', 'z']) {
          assert.ok(Math.abs(actual[i][axis] - expected[i][axis]) < 1e-9,
            `room ${actual[i].id} ${axis} matches server at ${seconds}s ${weather}`);
        }
      }
    }
  }
  roomFauna.dispose();
});

test('animal visuals cull by distance while all 250 combat targets remain available', () => {
  const scene = new THREE.Scene();
  const fauna = createFauna(scene, world.terrainHeight, {
    coastalRadius: world.coastalRadius, isRoad, isLake: world.isLake,
  });
  fauna.update(0.016, 19, 'mist', { playerX: 0, playerZ: 270 });
  assert.equal(fauna.getTargets().length, 250);
  const birds = scene.getObjectByName('Coastal bird bodies');
  const sheep = scene.getObjectByName('Feral sheep wool');
  const rabbits = scene.getObjectByName('Coastal rabbit bodies');
  assert.ok(birds.count > 0 && birds.count < WILDLIFE_POPULATION.birds);
  assert.ok(sheep.count > 0 && sheep.count < WILDLIFE_POPULATION.sheep);
  assert.ok(rabbits.count > 0 && rabbits.count < WILDLIFE_POPULATION.rabbits);
  assert.equal(scene.getObjectByName('Coastal bird wings').count, birds.count);
  assert.equal(scene.getObjectByName('Feral sheep legs').count, sheep.count * 4);
  assert.equal(scene.getObjectByName('Coastal rabbit paws').count, rabbits.count * 4);
  const firstVisible = fauna.getTargets().find((target) => target.kind === 'bird'
    && Math.hypot(target.x, target.z - 270) < 250);
  const matrix = new THREE.Matrix4();
  birds.getMatrixAt(0, matrix);
  assert.ok(Math.abs(matrix.elements[12] - firstVisible.x) < 1e-4);
  assert.ok(Math.abs(matrix.elements[13] - firstVisible.y) < 1e-4);
  fauna.dispose();
});

test('rendered wildlife exposes body targets and collapses after a server death', () => {
  const scene = new THREE.Scene();
  const fauna = createFauna(scene, world.terrainHeight, {
    coastalRadius: world.coastalRadius, isRoad, isLake: world.isLake,
  });
  fauna.update(0.016, 43, 'mist', { multiplayer: true });
  const byId = new Map(fauna.getTargets().map((target) => [target.id, target]));
  const wool = scene.getObjectByName('Feral sheep wool');
  const gull = scene.getObjectByName('Coastal bird bodies');
  const matrix = new THREE.Matrix4();
  wool.getMatrixAt(0, matrix);
  assert.ok(Math.abs(matrix.elements[12] - byId.get('sheep-0').x) < 1e-4);
  assert.ok(Math.abs(matrix.elements[13] - byId.get('sheep-0').y) < 1e-4);
  gull.getMatrixAt(0, matrix);
  assert.ok(Math.abs(matrix.elements[12] - byId.get('bird-0').x) < 1e-4);
  assert.equal(fauna.setAnimalAlive('resident-0', false), false);
  assert.equal(fauna.setAnimalAlive('sheep-0', false), true);
  for (let frame = 0; frame < 7; frame++) {
    fauna.update(0.1, 43 + frame * 0.1, 'mist', { multiplayer: true });
  }
  assert.equal(fauna.getTargets().find((target) => target.id === 'sheep-0').active, false);
  wool.getMatrixAt(0, matrix);
  assert.ok(Math.abs(matrix.determinant() - 1) < 1e-5,
    'the falling sheep keeps its body proportions');
  const fallenRotation = new THREE.Quaternion();
  matrix.decompose(new THREE.Vector3(), fallenRotation, new THREE.Vector3());
  assert.ok(new THREE.Vector3(0, 1, 0).applyQuaternion(fallenRotation).y < 0.5,
    'the sheep rolls onto its side as its knees buckle');
  assert.ok(matrix.elements[13] < byId.get('sheep-0').y - 0.2);
  assert.equal(wool.count, WILDLIFE_POPULATION.sheep,
    'the body remains visible through its fall and settling');
  for (let frame = 7; frame < 38; frame++) {
    fauna.update(0.1, 43 + frame * 0.1, 'mist', { multiplayer: true });
  }
  assert.equal(wool.count, WILDLIFE_POPULATION.sheep - 1,
    'the corpse leaves the draw buffer after collapsing');
  fauna.setAnimalAlive('sheep-0', true);
  fauna.update(0.016, 45, 'mist', { multiplayer: true });
  wool.getMatrixAt(0, matrix);
  assert.ok(matrix.determinant() > 0.01);
  assert.equal(wool.count, WILDLIFE_POPULATION.sheep);
  fauna.dispose();
});

test('birds can be hit, fall from their hit position, and reappear after respawn', () => {
  const scene = new THREE.Scene();
  const fauna = createFauna(scene, world.terrainHeight, {
    coastalRadius: world.coastalRadius, isRoad, isLake: world.isLake,
  });
  fauna.update(0.016, 31, 'mist', { multiplayer: true });
  const birdBefore = fauna.getTargets().find((target) => target.id === 'bird-0');
  const bodies = scene.getObjectByName('Coastal bird bodies');
  const matrix = new THREE.Matrix4();
  bodies.getMatrixAt(0, matrix);
  const airborneY = matrix.elements[13];
  assert.equal(fauna.setAnimalAlive('bird-0', false), true);
  for (let frame = 0; frame < 8; frame++) {
    fauna.update(0.1, 31 + frame * 0.1, 'mist', { multiplayer: true });
  }
  const birdAfter = fauna.getTargets().find((target) => target.id === 'bird-0');
  assert.equal(birdAfter.active, false);
  assert.equal(birdAfter.x, birdBefore.x);
  assert.equal(birdAfter.z, birdBefore.z);
  bodies.getMatrixAt(0, matrix);
  assert.ok(matrix.elements[13] < airborneY - 1, 'the gull falls toward the terrain');
  for (let frame = 8; frame < 100; frame++) {
    fauna.update(0.1, 31 + frame * 0.1, 'mist', { multiplayer: true });
  }
  assert.equal(bodies.count, WILDLIFE_POPULATION.birds - 1);
  fauna.setAnimalAlive('bird-0', true);
  fauna.update(0.016, 32.5, 'mist', { multiplayer: true });
  assert.equal(bodies.count, WILDLIFE_POPULATION.birds);
  assert.equal(fauna.getTargets().find((target) => target.id === 'bird-0').active, true);
  fauna.dispose();
});

test('bird routes are reproducible smooth waypoints with varied heights and glides', () => {
  const center = { x: -270, z: 100, y: 65, radius: 30 };
  const reused = {};
  const radii = [];
  const heights = [];
  let glides = 0;
  for (let second = 0; second < 240; second += 1) {
    const pose = birdFlightAt(17, second, 'mist', center);
    const previous = birdFlightAt(17, second - 0.001, 'mist', center);
    const next = birdFlightAt(17, second + 0.001, 'mist', center);
    assert.deepEqual(birdFlightAt(17, second, 'mist', center, reused), pose);
    assert.equal(birdFlightAt(17, second, 'mist', center, reused), reused,
      'the client can reuse one pose record');
    assert.ok(Math.hypot(next.x - previous.x, next.y - previous.y,
      next.z - previous.z) < 0.03, 'flight never jumps between route legs');
    assert.ok(Math.abs(pose.bank) <= 0.45 && Math.abs(pose.pitch) <= 0.28);
    radii.push(Math.hypot(pose.x - center.x, pose.z - center.z));
    heights.push(pose.y);
    glides += pose.gliding ? 1 : 0;
    const stormPose = birdFlightAt(17, second, 'storm', center);
    for (const axis of ['x', 'y', 'z', 'heading']) assert.equal(stormPose[axis], pose[axis],
      'a weather change increases flight effort without teleporting the target');
  }
  assert.ok(Math.max(...radii) - Math.min(...radii) > 20,
    'the route explores different distances instead of circling a fixed radius');
  assert.ok(Math.max(...heights) - Math.min(...heights) > 4);
  assert.ok(glides > 0 && glides < 240, 'wingbeats alternate with gliding');
  const first = birdFlightAt(17, 30, 'mist', center);
  const later = birdFlightAt(17, 30 + Math.PI * 2 / 0.22, 'mist', center);
  assert.ok(Math.hypot(first.x - later.x, first.z - later.z) > 5,
    'the old orbit period no longer repeats the route');
  const neighbour = birdFlightAt(18, 30, 'mist', center);
  assert.ok(Math.hypot(first.x - neighbour.x, first.z - neighbour.z) > 8,
    'individual birds follow distinct routes');
});

test('fauna render poses remain authoritative independent of prior frames and culling', () => {
  const sceneA = new THREE.Scene();
  const sceneB = new THREE.Scene();
  const options = { coastalRadius: world.coastalRadius, isRoad, isLake: world.isLake };
  const a = createFauna(sceneA, world.terrainHeight, options);
  const b = createFauna(sceneB, world.terrainHeight, options);
  for (let frame = 0; frame < 90; frame++) a.update(0.016, frame * 0.016, 'mist',
    { multiplayer: true, playerX: 0, playerZ: 270 });
  a.update(0.016, 72.31, 'storm', { multiplayer: true });
  b.update(0.1, 72.31, 'storm', { multiplayer: true });
  assert.deepEqual(a.getTargets(), b.getTargets(),
    'late joining and different frame rates yield the same room targets');
  const matrixA = new THREE.Matrix4();
  const matrixB = new THREE.Matrix4();
  for (const name of ['Coastal bird bodies', 'Coastal bird wings']) {
    const meshA = sceneA.getObjectByName(name);
    const meshB = sceneB.getObjectByName(name);
    assert.equal(meshA.count, meshB.count);
    for (let index = 0; index < meshA.count; index++) {
      meshA.getMatrixAt(index, matrixA);
      meshB.getMatrixAt(index, matrixB);
      assert.deepEqual(matrixA.elements, matrixB.elements);
    }
  }
  a.dispose();
  b.dispose();
});

test('animal hits flinch without moving live hitboxes and reaction resources stay bounded', () => {
  const scene = new THREE.Scene();
  const fauna = createFauna(scene, world.terrainHeight, {
    coastalRadius: world.coastalRadius, isRoad, isLake: world.isLake,
  });
  fauna.update(0.016, 42, 'mist', { multiplayer: true });
  const targetBefore = fauna.getTargets().find((item) => item.id === 'sheep-0');
  const wool = scene.getObjectByName('Feral sheep wool');
  const before = new THREE.Matrix4();
  const hit = new THREE.Matrix4();
  wool.getMatrixAt(0, before);
  const drawCalls = scene.children.length;
  assert.equal(fauna.showCombatHit('missing'), false);
  assert.equal(fauna.showCombatHit('sheep-0', { damage: 22,
    direction: { x: 1, z: 0 } }), true);
  fauna.update(0.1, 42, 'mist', { multiplayer: true });
  wool.getMatrixAt(0, hit);
  assert.notDeepEqual(hit.elements, before.elements, 'the struck rig visibly recoils');
  assert.deepEqual(fauna.getTargets().find((item) => item.id === 'sheep-0'), targetBefore,
    'nonlethal flinch cannot secretly move the room hitbox');
  for (let frame = 0; frame < 8; frame++) fauna.update(0.1, 42, 'mist', { multiplayer: true });
  wool.getMatrixAt(0, hit);
  assert.deepEqual(hit.elements, before.elements, 'the flinch ends cleanly');
  for (const target of fauna.getTargets()) for (let repeat = 0; repeat < 4; repeat++) {
    fauna.showCombatHit(target.id, { damage: 999, direction: { x: Infinity, z: NaN } });
  }
  assert.equal(fauna.activeReactionCount, 250, 'one bounded reaction per animal');
  fauna.setAnimalAlive('sheep-0', false, { direction: { x: 0, z: 1 } });
  assert.equal(fauna.showCombatHit('sheep-0'), false, 'dead animals do not restart hit effects');
  assert.equal(scene.children.length, drawCalls, 'hit effects spawn no extra meshes');
  fauna.resetAnimals();
  assert.equal(fauna.activeReactionCount, 0);
  fauna.update(0.016, 42, 'mist', { multiplayer: true });
  assert.equal(fauna.getTargets().filter((target) => target.alive).length, 250);
  fauna.dispose();
  assert.equal(fauna.showCombatHit('sheep-0'), false);
  assert.equal(fauna.setAnimalAlive('bird-0', true), false);
});

test('a killed bird accelerates downward, tumbles, settles, and only then fades', () => {
  const scene = new THREE.Scene();
  const fauna = createFauna(scene, world.terrainHeight, {
    coastalRadius: world.coastalRadius, isRoad, isLake: world.isLake,
  });
  fauna.update(0.016, 60, 'mist', { multiplayer: true });
  const birds = scene.getObjectByName('Coastal bird bodies');
  const matrix = new THREE.Matrix4();
  birds.getMatrixAt(0, matrix);
  const startY = matrix.elements[13];
  const initialRotation = new THREE.Quaternion();
  matrix.decompose(new THREE.Vector3(), initialRotation, new THREE.Vector3());
  fauna.setAnimalAlive('bird-0', false, { direction: { x: 1, z: 0 } });
  const heights = [];
  for (let frame = 0; frame < 5; frame++) {
    fauna.update(0.1, 60, 'mist', { multiplayer: true });
    birds.getMatrixAt(0, matrix);
    heights.push(matrix.elements[13]);
  }
  assert.ok(heights[3] - heights[4] > heights[0] - heights[1],
    'gravity accelerates the bird instead of flattening it');
  assert.ok(heights[4] < startY - 1);
  const fallingRotation = new THREE.Quaternion();
  matrix.decompose(new THREE.Vector3(), fallingRotation, new THREE.Vector3());
  assert.ok(initialRotation.angleTo(fallingRotation) > 0.5);
  assert.equal(birds.count, 120, 'the bird remains visible while falling');
  for (let frame = 5; frame < 90; frame++) fauna.update(0.1, 60, 'mist', { multiplayer: true });
  assert.equal(birds.count, 119);
  assert.equal(fauna.activeReactionCount, 0);
  fauna.setAnimalAlive('bird-0', true);
  fauna.update(0.016, 60, 'mist', { multiplayer: true });
  assert.equal(birds.count, 120);
  birds.getMatrixAt(0, matrix);
  assert.ok(Math.abs(matrix.elements[13] - startY) < 1e-5,
    'respawn removes gravity and tumble state');
  fauna.dispose();
});
