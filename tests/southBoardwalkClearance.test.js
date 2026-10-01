import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createWorld, islandTerrainHeightAt, playerEyeHeightAt } from '../src/world.js';
import { landingBoardwalkSections, landingBoardwalkTopAt } from '../src/landingBoardwalk.js';
import { circlesBlock, PLAYER_RADIUS } from '../src/collision.js';
import {
  grassPathDistance, southBoardwalkCenterlineDistance,
} from '../src/vegetation.js';

// Match the authored deck in main.js. Its inland end joins the ground trail
// at z=268; the timber descends to the pier at z=343.
const DECK = { halfWidth: 3.3, startZ: 268, endZ: 343 };

function deckDistance(x, z) {
  return Math.hypot(Math.max(0, Math.abs(x) - DECK.halfWidth),
    Math.max(DECK.startZ - z, 0, z - DECK.endZ));
}

test('player eye height remains above the pitched landing timbers even when prone', () => {
  const sections = landingBoardwalkSections(islandTerrainHeightAt);
  for (let z = DECK.startZ; z < DECK.endZ; z += 2) {
    const deckTop = landingBoardwalkTopAt(sections, z);
    const ground = playerEyeHeightAt(0, z) - 1.88;
    assert.ok(ground >= deckTop + 0.019,
      `walking surface is below the ramp at z=${z}`);
    assert.ok(ground + 0.56 > deckTop + 0.5,
      `prone camera clips the ramp at z=${z}`);
  }
});

test('grass path mask follows the physical boardwalk rather than ending at the landing map marker', () => {
  const untrackedTerrain = () => ({ trailDistance: 50 });
  for (let z = DECK.startZ; z <= DECK.endZ; z += 5) {
    assert.equal(southBoardwalkCenterlineDistance(0, z), 0);
    assert.equal(grassPathDistance(untrackedTerrain, 0, z), 0,
      `the deck at z=${z} must remain grass-free`);
    assert.ok(grassPathDistance(untrackedTerrain, DECK.halfWidth, z) < 7.5,
      `the full timber width at z=${z} must remain grass-free`);
  }
  assert.equal(grassPathDistance(untrackedTerrain, 20, 300), 20,
    'the cove meadow beyond the narrow boardwalk corridor keeps its density');
  assert.equal(grassPathDistance(untrackedTerrain, 0, 250), 18,
    'the boardwalk mask does not extend into unrelated inland terrain');
});

test('seeded rocks, trunks, and original grass leave every boardwalk lane traversable', () => {
  const scene = new THREE.Scene();
  const world = createWorld(scene, new THREE.Camera());
  for (let z = DECK.startZ; z <= DECK.endZ; z += 1) {
    for (let x = -DECK.halfWidth; x <= DECK.halfWidth + 0.001; x += 0.55) {
      assert.equal(circlesBlock(x, z, PLAYER_RADIUS, world.natureObstacles), false,
        `generated obstacle blocks the boardwalk at ${x.toFixed(2)}, ${z}`);
    }
  }

  scene.updateMatrixWorld(true);
  const instance = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const rotation = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  let stoneCount = 0;
  scene.traverse((mesh) => {
    if (!mesh.isInstancedMesh) return;
    const stone = mesh.name === 'Scattered dark coastal stones';
    const grass = mesh.name.startsWith('Coastal grass ')
      || mesh.name.startsWith('Withered grass ');
    if (!stone && !grass) return;
    for (let index = 0; index < mesh.count; index++) {
      mesh.getMatrixAt(index, instance);
      instance.decompose(position, rotation, scale);
      if (scale.lengthSq() < 1e-8) continue; // reserved, invisible deck rock
      position.applyMatrix4(mesh.matrixWorld);
      const gap = deckDistance(position.x, position.z);
      if (stone) {
        stoneCount++;
        // The source stone is wider than its collision circle. Even its
        // visible edge must not appear to protrude through the planks.
        assert.ok(gap > Math.max(scale.x * 1.08, scale.z * 0.92),
          `stone intersects timber at ${position.x}, ${position.z}`);
      } else {
        assert.ok(gap > 0,
          `grass root grows through timber at ${position.x}, ${position.z}`);
      }
    }
  });
  assert.ok(stoneCount > 600, 'the rest of the island retains its dense rock field');
  assert.equal(circlesBlock(-0.617, 302.956, PLAYER_RADIUS,
    world.natureObstacles), false, 'the former boardwalk-center rock is gone');
});
