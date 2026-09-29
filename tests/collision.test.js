import test from 'node:test';
import assert from 'node:assert/strict';
import { buildingWallBlocks, circlesBlock, createStaticCircleObstacles, isInsideBuilding,
  isUnderBuildingRoof, roofRectangles, ARCHIVE_FURNITURE,
  archiveFurnitureBlocks, archiveFurnitureBlocksMoveFrom,
  southPierRailBlocks,
} from '../src/collision.js';

const lodge = { id: 'lodge', x: -90, z: 185 };

test('authored building walls block the body while the visible front door remains open', () => {
  assert.equal(buildingWallBlocks(lodge, -90, 190.5), false, 'front door');
  assert.equal(buildingWallBlocks(lodge, -87.5, 190.5), true, 'front wall');
  assert.equal(buildingWallBlocks(lodge, -90, 179.5), true, 'back wall');
  assert.equal(buildingWallBlocks(lodge, -82, 185), true, 'side wall');
  assert.equal(buildingWallBlocks(lodge, -90, 185), false, 'interior');
  assert.equal(buildingWallBlocks(lodge, -90, 193), false, 'open exterior');
});

test('room and roof queries use the same physical building center', () => {
  assert.equal(isInsideBuilding(lodge, -90, 185), true);
  assert.equal(isInsideBuilding(lodge, -82, 185), false);
  assert.equal(isUnderBuildingRoof(lodge, -82, 185), true);
  assert.equal(isUnderBuildingRoof(lodge, -80, 185), false);
  const roofs = roofRectangles([lodge, { id: 'landing', x: 0, z: 270 }]);
  assert.equal(roofs.length, 1);
  assert.deepEqual(roofs[0], { x: -90, z: 185, halfWidth: 8.4, halfDepth: 5.9 });
});

test('trunks and larger rocks block only within their body radius', () => {
  const obstacles = [{ x: 10, z: 12, radius: 0.7 }, { x: -4, z: 1, radius: 1.1 }];
  assert.equal(circlesBlock(10.8, 12, 0.32, obstacles), true);
  assert.equal(circlesBlock(11.3, 12, 0.32, obstacles), false);
  assert.equal(circlesBlock(0, 0, 0.32, obstacles), false);
});

test('static tree and rock index agrees with the exact circle scan across the island', () => {
  let seed = 0x4f31a9d2;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 0x100000000;
  };
  const authored = Array.from({ length: 850 }, (_, index) => ({
    x: (random() - 0.5) * 720,
    z: (random() - 0.5) * 720,
    radius: index % 13 === 0 ? -random() : 0.3 + random() * 1.7,
  }));
  authored.push({ x: NaN, z: 1, radius: 2 });
  const staticObstacles = createStaticCircleObstacles(authored);
  assert.equal(Object.isFrozen(staticObstacles), true);
  assert.equal(Object.isFrozen(staticObstacles[0]), true);
  const exactScan = (x, z, radius) => authored.some((obstacle) => {
    if (!Number.isFinite(obstacle.x) || !Number.isFinite(obstacle.z)
      || !Number.isFinite(obstacle.radius)) return false;
    const dx = x - obstacle.x;
    const dz = z - obstacle.z;
    return dx * dx + dz * dz < (radius + obstacle.radius) ** 2;
  });
  for (let query = 0; query < 1_500; query++) {
    const x = (random() - 0.5) * 760;
    const z = (random() - 0.5) * 760;
    const radius = query % 11 === 0 ? 0 : query % 17 === 0 ? 0.9 : 0.32;
    assert.equal(circlesBlock(x, z, radius, staticObstacles),
      exactScan(x, z, radius), `query ${query}`);
  }
  for (const radius of [-0.7, 300, Infinity, NaN]) {
    assert.equal(circlesBlock(17, -51, radius, staticObstacles),
      exactScan(17, -51, radius), `unusual radius ${radius}`);
  }
  assert.equal(circlesBlock(authored[0].x + authored[0].radius + 0.32,
    authored[0].z, 0.32, staticObstacles),
  exactScan(authored[0].x + authored[0].radius + 0.32,
    authored[0].z, 0.32));
});

test('ordinary obstacle lists remain live when callers move obstacles', () => {
  const moving = [{ x: 100, z: 100, radius: 1 }];
  assert.equal(circlesBlock(0, 0, 0.32, moving), false);
  moving[0].x = 0;
  moving[0].z = 0;
  assert.equal(circlesBlock(0, 0, 0.32, moving), true);
});

test('south landing west rail blocks its visible edge while the ferry side stays open', () => {
  assert.equal(southPierRailBlocks(-3.5, 350), true, 'west side rail');
  assert.equal(southPierRailBlocks(-3.5, 344.3), true, 'shore rail end');
  assert.equal(southPierRailBlocks(-3.5, 343.5), false, 'walkway beyond rail');
  assert.equal(southPierRailBlocks(2.6, 350), false, 'ferry landing handoff');
  assert.equal(southPierRailBlocks(3.65, 350), false, 'east boarding edge');
});

test('archive shelf banks and the front table block their measured Blender footprints', () => {
  const archive = { id: 'archive', x: -170, z: 60 };
  assert.equal(ARCHIVE_FURNITURE.length, 6);
  for (const shelf of ARCHIVE_FURNITURE.filter((item) => item.id.startsWith('shelves_'))) {
    assert.equal(archiveFurnitureBlocks(archive,
      archive.x + shelf.x, archive.z + shelf.z), true, shelf.id);
  }
  assert.equal(archiveFurnitureBlocks(archive, -170, 61), true, 'actual center table');
  assert.equal(archiveFurnitureBlocks(archive, -170, 58.87), true, 'center rear shelf');
  assert.equal(archiveFurnitureBlocks(archive, -170, 60.05), false, 'gap behind desk');
  assert.equal(archiveFurnitureBlocks(archive, -170, 62.4), false, 'front aisle');
  assert.equal(archiveFurnitureBlocks(archive, -175.1, 59.9), false, 'intake-facing aisle');
  assert.equal(archiveFurnitureBlocks(lodge, -170, 61), false, 'helper is archive-specific');
});

test('old saved positions inside archive shelves can move outward, not deeper in', () => {
  const archive = { id: 'archive', x: -170, z: 60 };
  const x = archive.x - 2.8, z = archive.z - 2.5;
  assert.equal(archiveFurnitureBlocksMoveFrom(archive, x, z, x, z + 0.1), false);
  assert.equal(archiveFurnitureBlocksMoveFrom(archive, x, z + 0.1, x, z), true);
  assert.equal(archiveFurnitureBlocksMoveFrom(archive, x, z, x + 3, z), true,
    'crossing directly into another shelf remains blocked');
  assert.equal(archiveFurnitureBlocksMoveFrom(archive, x, z, x, z + 2.5), false,
    'stepping fully into the aisle is free');
});
