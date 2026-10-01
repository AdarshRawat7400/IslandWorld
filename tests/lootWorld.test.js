import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createLootWorld } from '../src/lootWorld.js';

const pickup = (id, itemId, x, z, extras = {}) => ({ id, itemId, x, z,
  count: 1, source: 'world', ...extras });

test('loot visuals mirror solo or room snapshots and expose closest interaction', () => {
  const scene = new THREE.Scene();
  const loot = createLootWorld(scene, () => 24);
  assert.ok(scene.children.includes(loot.group));
  loot.sync([
    pickup('gun', 'shotgun', 5, 0),
    pickup('grenade', 'grenade', 1, 0),
    pickup('mine', 'mine', 2, 0, { source: 'player', count: 3 }),
    pickup('medkit', 'medkit', 8, 0),
    pickup('ammo', 'ammo', 11, 0),
    pickup('armor', 'armor', 14, 0),
    pickup('hidden', 'rifle', 0, 0, { active: false }),
  ]);
  assert.equal(loot.count, 6);
  assert.equal(loot.visualCount, 6);
  assert.equal(loot.nearby(0, 0, 0.9), null);
  const near = loot.nearby(1.9, 0, 2.6);
  assert.equal(near.item.id, 'mine');
  assert.equal(near.item.count, 3);
  assert.equal(near.item.kind, 'mine');
  assert.ok(near.distance < 0.2);
  assert.equal(loot.nearby(8, 0).item.label, 'Field Medkit');
  assert.equal(loot.nearby(11, 0).item.label, 'Ammunition Box');
  assert.equal(loot.nearby(14, 0).item.label, 'Armor Plate');
  assert.deepEqual(loot.getNearby(1.9, 0, 2.6), near);
  loot.sync([pickup('grenade', 'grenade', 1, 0)]);
  assert.equal(loot.count, 1);
  assert.equal(loot.visualCount, 1);
  assert.equal(loot.nearby(1.9, 0, 2.6).item.id, 'grenade');
  loot.dispose();
  assert.equal(scene.children.includes(loot.group), false);
  assert.equal(loot.count, 0);
  assert.equal(loot.nearby(1, 0), null);
});

test('pickup meshes stay bounded and distance culled', () => {
  const scene = new THREE.Scene();
  const loot = createLootWorld(scene, () => 10, { maxVisuals: 2 });
  loot.sync(Array.from({ length: 12 }, (_, index) =>
    pickup(`item-${index}`, index % 2 ? 'grenade' : 'revolver', index * 3, 0)));
  assert.equal(loot.count, 12);
  assert.equal(loot.visualCount, 2);
  loot.update(1 / 60, 1, { position: { x: 1000, z: 1000 } });
  assert.ok(loot.group.children.every((child) => child.visible === false));
  loot.update(1 / 60, 2, { position: { x: 0, z: 0 } });
  assert.ok(loot.group.children.every((child) => child.visible === true));
  loot.dispose();
  loot.dispose();
});

test('automatic weapon pickups expose their labels with pooled, disposable geometry', () => {
  const scene = new THREE.Scene();
  const loot = createLootWorld(scene, () => 24);
  loot.sync([pickup('smg-loot', 'smg', 1, 0), pickup('lmg-loot', 'lmg', 4, 0)]);
  assert.equal(loot.visualCount, 2);
  assert.equal(loot.nearby(1, 0).item.label, 'Patrol SMG');
  assert.equal(loot.nearby(4, 0).item.label, 'Support LMG');
  const geometries = new Set();
  loot.group.traverse((object) => {
    if (!object.isMesh) return;
    assert.ok(object.geometry.attributes.position.count > 0);
    geometries.add(object.geometry);
  });
  assert.ok(geometries.size <= 4, 'automatic pickups share the four existing primitives');
  let disposals = 0;
  for (const geometry of geometries) geometry.addEventListener('dispose', () => disposals++);
  loot.dispose();
  assert.equal(disposals, geometries.size);
});
