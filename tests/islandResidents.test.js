import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { RESIDENT_SITES, selectResidentSites } from '../src/islandResidents.js';
import { isRoad } from '../src/roads.js';
import { isLake } from '../src/inlandLake.js';
import { createWorld } from '../src/world.js';
import { circlesBlock } from '../src/collision.js';

test('sparse island residents cover landmarks without occupying roads or lake water', () => {
  const world = createWorld(new THREE.Scene(), new THREE.PerspectiveCamera());
  const selected = selectResidentSites(RESIDENT_SITES, {
    isSafe: (x, z, definition) => world.isWalkable(x, z)
      && !isLake(x, z, definition.bodyRadius || 0.8)
      && !circlesBlock(x, z, definition.bodyRadius || 0.6, world.natureObstacles),
    isRoad,
  });
  assert.equal(selected.length, 11);
  assert.ok(selected.some((person) => person.id === 'south_shore_fisher'));
  assert.ok(selected.some((person) => person.id === 'north_shore_fisher'));
  assert.equal(selected.find((person) => person.id === 'lake_walker')?.model, 'mira');
  assert.equal(selected.find((person) => person.id === 'pump_mechanic')?.model, 'dane');
  assert.equal(new Set(selected.map((person) => person.id)).size, selected.length);
  assert.ok(Math.hypot(selected[0].x, selected[0].z - 270) < 4.6,
    'dockhand must be in speaking range of the landing spawn');
  for (const person of selected) {
    assert.equal(isRoad(person.x, person.z, 0.8), false, person.id);
    assert.equal(isLake(person.x, person.z, 0.8), false, person.id);
    const assetPath = person.model === 'old-fisherman-bente-schoone'
      ? '../public/assets/sketchfab-npcs/old-fisherman-bente-schoone-optimized.glb'
      : person.model.includes('-')
      ? `../public/assets/sketchfab-npcs/${person.model}.glb`
      : `../public/assets/${person.model}.glb`;
    assert.ok(existsSync(fileURLToPath(new URL(assetPath, import.meta.url))),
      `${person.id} should use a bundled, credited character`);
  }
});

test('resident placement tries a safe alternate without crowding another person', () => {
  const definitions = [
    { id: 'first', candidates: [[0, 0], [5, 0]] },
    { id: 'second', candidates: [[5, 0], [9, 0]] },
  ];
  const selected = selectResidentSites(definitions, {
    isSafe: (x) => x !== 0, isRoad: () => false,
  });
  assert.deepEqual(selected.map(({ id, x, z }) => [id, x, z]),
    [['first', 5, 0], ['second', 9, 0]]);
});
