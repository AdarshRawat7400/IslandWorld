import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createIslandResidents } from '../src/islandResidents.js';
import { createPrisonPopulation } from '../src/prisonPopulation.js';

test('resident combat state controls targets, talk, collision, and collapse', async () => {
  const scene = new THREE.Scene();
  const residents = createIslandResidents(scene, () => 12,
    { isSafe: () => true, isRoad: () => false, loadModels: false });
  await residents.ready;
  assert.equal(residents.getCombatTargets().length, 11);
  const dockhand = residents.people.find(({ id }) => id === 'dockhand');
  dockhand.root = new THREE.Group();
  dockhand.meshParts = [];
  dockhand.shadowsActive = false;
  assert.equal(residents.nearestPerson(dockhand.x, dockhand.z)?.id, dockhand.id);
  assert.equal(residents.collides(dockhand.x, dockhand.z), true);

  residents.setCombatStates([{ id: dockhand.id, x: 10, y: 20, z: 280,
    health: 0, maxHealth: 100, dead: true, alerted: true }]);
  const target = residents.getCombatTargets().find(({ id }) => id === dockhand.id);
  assert.deepEqual([target.x, target.z, target.health, target.alive], [10, 280, 0, false]);
  assert.ok(target.y > 21 && target.y < 22);
  assert.equal(residents.nearestPerson(10, 280), null);
  assert.equal(residents.collides(10, 280), false);
  residents.update(1, { dt: 0.45, cameraX: 10, cameraZ: 280,
    playerX: 10, playerZ: 281 });
  assert.ok(dockhand.root.rotation.x > 1.3, 'dead resident should visibly lie down');

  residents.resetCombatStates();
  assert.equal(residents.getCombatTargets().find(({ id }) => id === dockhand.id).alive,
    true);
  assert.equal(residents.nearestPerson(dockhand.x, dockhand.z)?.id, dockhand.id);
  residents.dispose();
});

test('resident hit and firearm cues expire without timers', async () => {
  const residents = createIslandResidents(new THREE.Scene(), () => 10,
    { isSafe: () => true, isRoad: () => false, loadModels: false });
  await residents.ready;
  const cues = residents.group.getObjectByName('NPC combat cues');
  residents.showCombatHit('dockhand');
  residents.showAttack('dockhand', { x: 4, y: 11, z: 270 });
  assert.equal(cues.children.length, 3, 'firearm adds muzzle flash and tracer');
  residents.update(1, { dt: 0.5, cameraX: 1000, cameraZ: 1000 });
  assert.equal(cues.children.length, 0);
  residents.showAttack('dockhand', { x: 4, y: 11, z: 270 },
    { noProjectile: true });
  assert.equal(cues.children.length, 1,
    'network tracer can be paired with muzzle-only NPC cue');
  residents.dispose();
});

test('prison NPCs stay targetable, but dead guards neither talk nor block the path', () => {
  const population = createPrisonPopulation(new THREE.Scene(), () => 10);
  assert.equal(population.getCombatTargets().length, 12);
  const guns = population.group.children.find(({ name }) => name === 'Prison people gunFrame');
  assert.equal(guns.count, 12, 'all prison occupants have batched firearm props');
  const gunMatrix = new THREE.Matrix4();
  guns.getMatrixAt(0, gunMatrix);
  const holsteredY = new THREE.Vector3().setFromMatrixPosition(gunMatrix).y;
  population.setCombatStates([{ id: 'gate_guard_west', alerted: true }]);
  population.update(0.1, { dt: 0.1 });
  guns.getMatrixAt(0, gunMatrix);
  assert.ok(new THREE.Vector3().setFromMatrixPosition(gunMatrix).y > holsteredY + 0.2,
    'alerted guard should visibly raise his firearm');
  const guard = population.occupants.find(({ id }) => id === 'gate_guard_west');
  assert.equal(population.nearestPerson(guard.x, guard.z)?.id, guard.id);
  assert.equal(population.collides(guard.x, guard.z), true);
  assert.equal(population.blocksMove(guard.x - 1, guard.z,
    guard.x, guard.z), true);

  const head = population.group.children.find(({ name }) => name === 'Prison people head');
  const matrix = new THREE.Matrix4();
  head.getMatrixAt(guard.index, matrix);
  const standingY = new THREE.Vector3().setFromMatrixPosition(matrix).y;
  population.setCombatStates([{ id: guard.id, health: 0, maxHealth: 100,
    dead: true, alerted: true }]);
  for (let i = 0; i < 6; i++) population.update(i * 0.1, { dt: 0.1 });
  head.getMatrixAt(guard.index, matrix);
  const fallenY = new THREE.Vector3().setFromMatrixPosition(matrix).y;
  assert.ok(fallenY < standingY - 0.7, 'fallen head should lie near the ground');
  assert.equal(population.nearestPerson(guard.x, guard.z), null);
  assert.equal(population.collides(guard.x, guard.z), false);
  assert.equal(population.blocksMove(guard.x - 1, guard.z,
    guard.x, guard.z), false);
  assert.equal(population.getCombatTargets()[guard.index].alive, false);
  population.dispose();
});

test('prison combat state uses authoritative positions and distinct guard cues', () => {
  const population = createPrisonPopulation(new THREE.Scene(), () => 7);
  const guard = population.occupants.find(({ id }) => id === 'gate_guard_west');
  population.setCombatStates([{ id: guard.id, x: -72, y: 9, z: 99,
    health: 60, maxHealth: 120, alerted: true, dead: false }]);
  population.update(1, { dt: 0.1, playerX: -70, playerZ: 96 });
  const target = population.getCombatTargets().find(({ id }) => id === guard.id);
  assert.deepEqual([target.x, target.z, target.health, target.maxHealth],
    [-72, 99, 60, 120]);
  assert.ok(Math.abs(target.y - 10.05) < 0.001);
  const cues = population.group.getObjectByName('NPC combat cues');
  population.showAttack(guard.id, { x: -69, y: 10, z: 98 },
    { noProjectile: true });
  assert.equal(cues.children.length, 1, 'network gunshot handles the tracer');
  population.showCombatHit(guard.id);
  assert.equal(cues.children.length, 2);
  for (let i = 0; i < 6; i++) population.update(1.1 + i * 0.1, { dt: 0.1 });
  assert.equal(cues.children.length, 0);
  population.resetCombatStates();
  assert.equal(population.getCombatTargets().find(({ id }) => id === guard.id).x,
    guard.spawnX);
  population.dispose();
});
