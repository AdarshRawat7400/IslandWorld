import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createWorld } from '../src/world.js';
import { MAIN_LIGHTHOUSE_SITE } from '../src/worldSites.js';
import { createDynamicWeather } from '../src/dynamicWeather.js';
import { circlesBlock } from '../src/collision.js';

test('the West Headland lighthouse is reachable and joins the shared night beacon system', () => {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(-230, 45, -120);
  const world = createWorld(scene, camera);
  const lighthouse = world.mainLighthouse;
  const { x, z } = MAIN_LIGHTHOUSE_SITE;

  assert.equal(scene.getObjectByName('West Headland Lighthouse'), lighthouse.group);
  assert.ok(world.lighthouseBeacons.includes(lighthouse));
  assert.equal(world.lighthouseBeacons.length, 3);
  assert.equal(lighthouse.worldPosition.x, x);
  assert.equal(lighthouse.worldPosition.z, z);
  assert.ok(world.coastalRadius(x, z) < 0.94, 'the tower must be inside the cliff lip');
  assert.ok(circlesBlock(x, z, 0.35, world.natureObstacles),
    'the tower foundation must block movement');
  assert.equal(circlesBlock(-261, -136, 0.35, world.natureObstacles), false,
    'the graded approach must remain open');
  assert.ok(lighthouse.group.position.y + 2.4 > world.renderedTerrainHeight(x, z),
    'the stone plinth must remain visible above the ground');
  assert.ok(lighthouse.group.position.y <= world.renderedTerrainHeight(x, z),
    'the tower must stand on its foundation, not float above it');

  const weather = createDynamicWeather();
  const noon = weather.sample(15, { weatherOverride: 'clear', timeOverride: 'noon' });
  world.update(0.05, 15, noon.mode, noon);
  assert.equal(lighthouse.beamRoot.visible, false);

  const storm = weather.sample(250,
    { weatherOverride: 'storm', timeOverride: 'night' });
  world.update(0.05, 250, storm.mode, storm);
  assert.equal(lighthouse.beamRoot.visible, true);
  assert.ok(lighthouse.core.material.opacity > 0);
  assert.ok(lighthouse.halo.material.opacity > 0);
});
