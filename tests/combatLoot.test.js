import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createWorld } from '../src/world.js';
import { SITES } from '../src/worldSites.js';
import { isRoad } from '../src/roads.js';
import { circlesBlock, buildingWallBlocks } from '../src/collision.js';
import { ancillaryBlocksMove, ancillaryFootprints } from '../src/buildingDetails.js';
import { PRISON_LAYOUT, createSetDressing } from '../src/setDressing.js';
import {
  MAX_GUNS, MAX_GRENADES, MAX_MINES, MAX_ARMOR, STARTER_GUNS,
  WORLD_PICKUP_SPAWNS,
  createInventory, canCollectItem, collectItem, consumeItem, selectGun, cycleGun,
  canApplySupply, applySupply, createWorldPickupSpawns, inventoryDrops,
} from '../src/combatLoot.js';

test('inventory stays within three gun, grenade, and mine slots with immutable changes', () => {
  const starter = createInventory();
  assert.deepEqual(starter, { guns: [...STARTER_GUNS], grenades: 0, mines: 0,
    selectedGun: 'revolver' });
  assert.equal(canCollectItem(starter, 'shotgun'), true);
  const armed = collectItem(starter, 'shotgun');
  assert.notEqual(armed, starter);
  assert.equal(armed.guns.length, MAX_GUNS);
  assert.deepEqual(starter.guns, ['revolver', 'rifle']);
  assert.equal(canCollectItem(armed, 'shotgun'), false);
  assert.equal(collectItem(armed, 'rifle'), armed);
  assert.equal(collectItem(armed, 'unknown'), armed);
  const supplied = collectItem(collectItem(armed, 'grenade', 10), 'mine', 9);
  assert.equal(supplied.grenades, MAX_GRENADES);
  assert.equal(supplied.mines, MAX_MINES);
  assert.equal(canCollectItem(supplied, 'grenade'), false);
  assert.equal(consumeItem(supplied, 'grenade', 4), supplied,
    'one action cannot spend more than held');
  const used = consumeItem(consumeItem(supplied, 'grenade'), 'mine', 2);
  assert.equal(used.grenades, 2);
  assert.equal(used.mines, 1);
  assert.equal(supplied.grenades, 3, 'consumption does not mutate a prior snapshot');
});

test('gun selection can move directly or cycle through only carried guns', () => {
  const inventory = collectItem(createInventory(), 'shotgun');
  assert.equal(selectGun(inventory, 'shotgun').selectedGun, 'shotgun');
  assert.equal(cycleGun(inventory, -1).selectedGun, 'shotgun');
  assert.equal(cycleGun(inventory, 1).selectedGun, 'rifle');
  assert.equal(selectGun(inventory, 'pistol'), inventory);
  assert.deepEqual(createInventory({ guns: ['shotgun', 'shotgun', 'bad'], grenades: 15,
    mines: -3, selectedGun: 'rifle' }),
  { guns: ['shotgun'], grenades: 3, mines: 0, selectedGun: 'shotgun' });
});

test('medkits, armor and ammo boxes apply finite effects without altering inventory or firing timers', () => {
  const inventory = collectItem(createInventory(), 'shotgun');
  const ammo = {
    revolver: { magazine: 3, reserve: 34, reloadingUntil: 4500, lastFiredAt: 2500 },
    rifle: { magazine: 1, reserve: 18, reloadingUntil: 0, lastFiredAt: 900 },
    shotgun: { magazine: 5, reserve: 25, reloadingUntil: 0, lastFiredAt: 0 },
  };
  const state = { inventory, health: 70, armor: 15, ammo };
  assert.equal(canCollectItem(inventory, 'medkit'), false,
    'supplies do not occupy carried-item slots');
  assert.equal(canCollectItem(inventory, 'ammo'), false);
  const healed = applySupply(state, 'medkit');
  assert.deepEqual(healed, { applied: true, health: 100, armor: 15, ammo });
  assert.equal(state.health, 70);
  assert.equal(canApplySupply({ ...state, health: 100 }, 'medkit'), false);
  const armored = applySupply(state, 'armor');
  assert.deepEqual(armored, { applied: true, health: 70, armor: 65, ammo });
  assert.equal(state.armor, 15);
  assert.equal(applySupply({ ...state, armor: MAX_ARMOR }, 'armor').applied, false);
  const refilled = applySupply(state, 'ammo');
  assert.equal(refilled.applied, true);
  assert.equal(refilled.health, 70);
  assert.notEqual(refilled.ammo, ammo);
  assert.deepEqual(refilled.ammo.revolver, { ...ammo.revolver, reserve: 36 });
  assert.deepEqual(refilled.ammo.rifle, { ...ammo.rifle, reserve: 23 });
  assert.equal(refilled.ammo.shotgun, ammo.shotgun,
    'full reserve remains untouched');
  assert.equal(ammo.revolver.reserve, 34);
  assert.equal(applySupply({ ...state, health: 100,
    ammo: Object.fromEntries(Object.entries(ammo).map(([id, entry]) =>
      [id, { ...entry, reserve: id === 'revolver' ? 36 : 25 }])) }, 'ammo').applied,
  false);
  const revolverOnly = { ...state, inventory: createInventory({ guns: ['revolver'] }),
    ammo: { ...ammo, revolver: { ...ammo.revolver, reserve: 36 } } };
  assert.equal(canApplySupply(revolverOnly, 'ammo'), false,
    'ammo for guns not carried is irrelevant');
});

test('dead players drop carried rifle, shotgun, and throwable stacks for recovery', () => {
  const inventory = collectItem(collectItem(collectItem(createInventory(), 'shotgun'),
    'grenade', 2), 'mine', 3);
  const drops = inventoryDrops(inventory, { x: 12, z: -24 }, 'death-7');
  assert.deepEqual(drops.map((item) => [item.itemId, item.count]), [
    ['rifle', 1], ['shotgun', 1], ['grenade', 2], ['mine', 3],
  ]);
  assert.ok(drops.every((item) => item.source === 'player'
    && item.x === 12 && item.z === -24 && item.id.startsWith('drop-death-7-')));
  assert.equal(new Set(drops.map((item) => item.id)).size, drops.length);
  let looter = createInventory({ guns: ['revolver'] });
  for (const item of drops) looter = collectItem(looter, item.itemId, item.count);
  assert.deepEqual(looter.guns, ['revolver', 'rifle', 'shotgun']);
  assert.equal(looter.grenades, 2);
  assert.equal(looter.mines, 3);
});

test('seeded world pickups change by room while keeping stable IDs and item quotas', () => {
  const first = createWorldPickupSpawns(12345);
  assert.deepEqual(first, createWorldPickupSpawns(12345));
  assert.notDeepEqual(first, createWorldPickupSpawns(54321));
  assert.equal(first.length, WORLD_PICKUP_SPAWNS.length);
  assert.equal(new Set(first.map((item) => item.id)).size, first.length);
  assert.equal(new Set(first.map((item) => `${item.x},${item.z}`)).size, first.length);
  assert.equal(first.filter((item) => item.itemId === 'shotgun').length, 4);
  assert.equal(first.filter((item) => item.itemId === 'grenade').length, 12);
  assert.equal(first.filter((item) => item.itemId === 'mine').length, 10);
  assert.equal(first.filter((item) => item.itemId === 'medkit').length, 7);
  assert.equal(first.filter((item) => item.itemId === 'ammo').length, 8);
  assert.equal(first.filter((item) => item.itemId === 'armor').length, 7);
  assert.ok(first.every((item) => item.count === 1 && item.source === 'world'));
});

test('seeded pickup clearings are reachable ground away from cliffs, lake, roads, and collision', () => {
  const scene = new THREE.Scene();
  const world = createWorld(scene, new THREE.Camera());
  const dressing = createSetDressing(scene, world.terrainHeight);
  const ancillary = ancillaryFootprints(SITES);
  const prison = PRISON_LAYOUT.bounds;
  const unique = new Map();
  for (let seed = 0; seed < 35; seed += 1) {
    for (const item of createWorldPickupSpawns(seed))
      unique.set(`${item.x},${item.z}`, item);
  }
  assert.ok(unique.size >= 55, 'rooms draw from the full island clearing pool');
  for (const { x, z } of unique.values()) {
    assert.ok(world.isWalkable(x, z) && world.coastalRadius(x, z) < 0.86,
      `pickup at ${x}, ${z} is beside a cliff`);
    assert.equal(world.isLake(x, z, 10), false, `pickup at ${x}, ${z} is in lake`);
    assert.equal(isRoad(x, z, 5), false, `pickup at ${x}, ${z} blocks a road`);
    assert.ok(world.terrainHeight(x, z) >= 12,
      `pickup at ${x}, ${z} is below traversable high ground`);
    assert.equal(circlesBlock(x, z, 1.2, world.natureObstacles), false,
      `pickup at ${x}, ${z} intersects nature obstacle`);
    assert.equal(dressing.collides(x, z, 1.2), false,
      `pickup at ${x}, ${z} intersects set dressing`);
    assert.equal(ancillaryBlocksMove(ancillary, x, z, 3), false,
      `pickup at ${x}, ${z} intersects an ancillary building`);
    assert.equal(x >= prison.minX - 9 && x <= prison.maxX + 9
      && z >= prison.minZ - 9 && z <= prison.maxZ + 9, false,
    `pickup at ${x}, ${z} is in prison compound`);
    assert.ok(SITES.every((site) => !buildingWallBlocks(site, x, z, 1.2)),
      `pickup at ${x}, ${z} intersects building wall`);
    const slope = Math.max(
      Math.abs(world.terrainHeight(x + 1.5, z) - world.terrainHeight(x - 1.5, z)),
      Math.abs(world.terrainHeight(x, z + 1.5) - world.terrainHeight(x, z - 1.5)),
    ) / 3;
    assert.ok(slope <= 0.32, `pickup at ${x}, ${z} is too steep`);
  }
});
