import assert from 'node:assert/strict';
import test from 'node:test';
import { createInlandLake, INLAND_LAKE, isLake, lakeSignedDistance,
  lakeWaterHeight, sculptLakeTerrain } from '../src/inlandLake.js';

test('highland lake occupies the open plateau without reaching authored routes', () => {
  assert.equal(isLake(INLAND_LAKE.x, INLAND_LAKE.z), true);
  assert.equal(isLake(-70, -27), false);
  for (const [x, z] of [
    [-190, -28], [-210, -120], [-120, -176], [-24, -207],
    [-90, 185], [-170, 60], [59, -228], [-58, 105],
  ]) assert.equal(isLake(x, z, 16), false, `${x},${z} should stay dry`);
  assert.ok(lakeSignedDistance(-70, -75) < -40);
});

test('basin is below the waterline and outside terrain is unchanged', () => {
  const centre = sculptLakeTerrain(54.6, -70, -75);
  assert.ok(centre >= 44 && centre <= 46);
  assert.ok(centre < INLAND_LAKE.waterLevel);
  assert.equal(sculptLakeTerrain(37.5, 200, 200), 37.5);
  assert.equal(sculptLakeTerrain(55, -70, 0), 55);
  assert.ok(sculptLakeTerrain(55, -70, -75 + 48) >= centre);
});

test('sampled lake height follows the lake mesh and is absent on dry ground', () => {
  assert.equal(lakeWaterHeight(200, 200, 7), null);
  const calm = lakeWaterHeight(-70, -75, 7, 0);
  const storm = lakeWaterHeight(-70, -75, 7, 1);
  assert.ok(calm > 48.98 && calm < 49.1);
  assert.ok(storm > 48.98 && storm < 49.1);
  assert.notEqual(calm, storm);
  const lake = createInlandLake();
  assert.ok(lake.mesh.geometry.getAttribute('position').count > 2000);
  assert.equal(lake.mesh.name, 'Wind-rippled highland lake');
});
